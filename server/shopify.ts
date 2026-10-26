// Shopify Admin API helpers. Supports two connection paths: the original manual
// custom-app Admin API access token (still useful for quick testing, no OAuth setup
// needed), and a real self-serve OAuth flow via a custom-distributed Partners app
// (no Shopify App Store review needed — see docs/SHOPIFY_SETUP.md).

import crypto from 'crypto';

const API_VERSION = '2024-01';
const OAUTH_SCOPES = 'read_products';

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

// Builds the URL to redirect a merchant to for Shopify's OAuth consent screen.
// Unlike Facebook, Shopify's authorize URL is per-store, so the shop domain must
// already be known before this redirect happens.
export function getShopifyOAuthUrl(domain: string, redirectUri: string, state: string): string {
  const host = normalizeDomain(domain);
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY || '',
    scope: OAUTH_SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  return `https://${host}/admin/oauth/authorize?${params.toString()}`;
}

// Verifies Shopify's HMAC on the OAuth callback query params, proving the request
// really came from Shopify and wasn't forged. Same idea as verifyMetaSignature.
export function verifyShopifyCallbackHmac(query: Record<string, string>): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('&');
  const computed = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET || '')
    .update(message)
    .digest('hex');
  const expectedBuf = Buffer.from(computed, 'utf8');
  const actualBuf = Buffer.from(String(hmac), 'utf8');
  // timingSafeEqual throws if lengths differ — treat that as an invalid signature.
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

// Exchanges the OAuth callback's temporary code for a permanent Admin API access
// token — the OAuth equivalent of the manual token a merchant would otherwise paste.
export async function exchangeShopifyCodeForToken(domain: string, code: string): Promise<string> {
  const host = normalizeDomain(domain);
  const res = await fetch(`https://${host}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    }),
  });
  if (!res.ok) {
    throw new Error(`Shopify token exchange failed (${res.status})`);
  }
  const data = await res.json();
  return data.access_token;
}

// Confirms the domain + token actually work by hitting a cheap, always-available
// endpoint. Throws with a descriptive message on any failure.
export async function verifyShopifyStore(domain: string, accessToken: string): Promise<{ name: string }> {
  const host = normalizeDomain(domain);
  const res = await fetch(`https://${host}/admin/api/${API_VERSION}/shop.json`, {
    headers: { 'X-Shopify-Access-Token': accessToken },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Invalid Shopify access token for this store');
    }
    throw new Error(`Could not reach Shopify store (${res.status})`);
  }
  const data = await res.json();
  return { name: data.shop?.name || host };
}

export interface ShopifyProduct {
  externalId: string;
  name: string;
  sku: string;
  price: number;
  inventory: number;
  description?: string;
  imageUrl?: string;
  rawAttributes?: Record<string, any>;
}

// Pulls all products (paginated via Shopify's Link header, 250 per page max) and
// flattens to one row per product using its first variant — good enough for simple
// (non-variant) catalogs, which covers most small merchants.
async function fetchShopifyCurrency(host: string, accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://${host}/admin/api/${API_VERSION}/shop.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return typeof data.shop?.currency === 'string' && data.shop.currency ? data.shop.currency : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchShopifyProducts(domain: string, accessToken: string): Promise<ShopifyProduct[]> {
  const host = normalizeDomain(domain);
  const products: ShopifyProduct[] = [];
  const currency = await fetchShopifyCurrency(host, accessToken);
  let url: string | null = `https://${host}/admin/api/${API_VERSION}/products.json?limit=250`;

  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': accessToken } });
    if (!res.ok) {
      throw new Error(`Failed to fetch Shopify products (${res.status})`);
    }
    const data = await res.json();

    for (const p of data.products || []) {
      const variant = p.variants?.[0];
      if (!variant) continue;
      // Many Shopify products (gift cards, sample data) ship with no SKU set. Fall back
      // to a stable ID-derived SKU instead of dropping them, so nothing silently skips.
      const sku = variant.sku && variant.sku.trim() ? variant.sku.trim() : `SHOPIFY-${variant.id}`;
      // Clean HTML tags from body_html description if present
      const rawDesc = p.body_html || '';
      const cleanDesc = rawDesc.replace(/<[^>]*>?/gm, '').trim();
      const imageUrl = p.image?.src || p.images?.[0]?.src || undefined;

      // Capture all raw store attributes (Vendor, Product Type, Tags, Weight, Color, Option Names/Values, etc.)
      const rawAttrs: Record<string, any> = {
        'Product Type': p.product_type || undefined,
        'Vendor': p.vendor || undefined,
        'Tags': p.tags ? (Array.isArray(p.tags) ? p.tags.join(', ') : p.tags) : undefined,
        'Weight': variant.weight ? `${variant.weight} ${variant.weight_unit || 'g'}` : undefined,
        'Currency': currency,
      };

      if (p.options && Array.isArray(p.options)) {
        p.options.forEach((opt: any) => {
          if (opt.name && opt.values) {
            rawAttrs[opt.name] = Array.isArray(opt.values) ? opt.values.join(', ') : String(opt.values);
          }
        });
      }

      // Clean up undefined keys
      Object.keys(rawAttrs).forEach((key) => {
        if (rawAttrs[key] === undefined || rawAttrs[key] === null || rawAttrs[key] === '') {
          delete rawAttrs[key];
        }
      });

      products.push({
        externalId: String(variant.id),
        name: p.title,
        sku,
        price: parseFloat(variant.price) || 0,
        inventory: variant.inventory_quantity ?? 0,
        description: cleanDesc || undefined,
        imageUrl: imageUrl || undefined,
        rawAttributes: Object.keys(rawAttrs).length > 0 ? rawAttrs : undefined,
      });
    }

    const linkHeader = res.headers.get('link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }

  return products;
}
