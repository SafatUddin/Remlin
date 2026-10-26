// WooCommerce REST API v3 integration helper.
// Supports connecting WooCommerce sites via Consumer Key & Consumer Secret.

export interface WooCommerceProduct {
  externalId: string;
  name: string;
  sku: string;
  price: number;
  inventory: number;
  description?: string;
  imageUrl?: string;
  rawAttributes?: Record<string, any>;
}

export function normalizeWooUrl(url: string): string {
  let cleaned = url.trim().toLowerCase();
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = `https://${cleaned}`;
  }
  return cleaned.replace(/\/$/, '');
}

/**
  Verify WooCommerce site credentials by fetching site details or product list via REST API v3.
 */
export async function verifyWooCommerceStore(url: string, consumerKey: string, consumerSecret: string): Promise<{ name: string }> {
  const baseUrl = normalizeWooUrl(url);
  const authHeader = 'Basic ' + Buffer.from(`${consumerKey.trim()}:${consumerSecret.trim()}`).toString('base64');

  // Try fetching products (limit 1) to verify API access
  const res = await fetch(`${baseUrl}/wp-json/wc/v3/products?per_page=1`, {
    headers: {
      'Authorization': authHeader,
      'User-Agent': 'ShopMateAI-WooCommerce-Adapter/1.0',
    },
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 404 || res.status === 403) {
      throw new Error('Invalid WooCommerce URL or API credentials (Consumer Key / Secret)');
    }
    throw new Error(`Could not connect to WooCommerce store (${res.status})`);
  }

  // Attempt to extract host/site name
  try {
    const parsed = new URL(baseUrl);
    return { name: parsed.hostname };
  } catch {
    return { name: baseUrl };
  }
}

/**
  Fetch all products from connected WooCommerce store using WC REST API v3 (handles pagination).
 */
async function fetchWooCurrency(baseUrl: string, authHeader: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${baseUrl}/wp-json/wc/v3/data/currencies/current`, {
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'ShopMateAI-WooCommerce-Adapter/1.0',
      },
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return typeof data?.code === 'string' && data.code ? data.code : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchWooCommerceProducts(url: string, consumerKey: string, consumerSecret: string): Promise<WooCommerceProduct[]> {
  const baseUrl = normalizeWooUrl(url);
  const authHeader = 'Basic ' + Buffer.from(`${consumerKey.trim()}:${consumerSecret.trim()}`).toString('base64');
  const products: WooCommerceProduct[] = [];
  const currency = await fetchWooCurrency(baseUrl, authHeader);
  
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
    const apiUrl = `${baseUrl}/wp-json/wc/v3/products?per_page=${perPage}&page=${page}`;
    const res = await fetch(apiUrl, {
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'ShopMateAI-WooCommerce-Adapter/1.0',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch WooCommerce products (${res.status})`);
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      hasMore = false;
      break;
    }

    for (const p of data) {
      // Handle SKU fallback if blank
      const sku = p.sku && p.sku.trim() ? p.sku.trim() : `WOO-${p.id}`;
      
      // Clean HTML tags from description if present
      const rawDesc = p.description || p.short_description || '';
      const cleanDesc = rawDesc.replace(/<[^>]*>?/gm, '').trim();

      // Extract image URL
      const imageUrl = p.images?.[0]?.src || undefined;

      // Extract raw store attributes (Categories, Tags, Stock Status, Attributes)
      const rawAttrs: Record<string, any> = {
        'Categories': Array.isArray(p.categories) ? p.categories.map((c: any) => c.name).join(', ') : undefined,
        'Tags': Array.isArray(p.tags) ? p.tags.map((t: any) => t.name).join(', ') : undefined,
        'Stock Status': p.stock_status || undefined,
        'Manage Stock': p.manage_stock ? 'Yes' : 'No',
        'Weight': p.weight ? `${p.weight} kg` : undefined,
        'Currency': currency,
      };

      if (Array.isArray(p.attributes)) {
        p.attributes.forEach((attr: any) => {
          if (attr.name && Array.isArray(attr.options) && attr.options.length > 0) {
            rawAttrs[attr.name] = attr.options.join(', ');
          }
        });
      }

      // Remove empty/undefined entries
      Object.keys(rawAttrs).forEach((key) => {
        if (rawAttrs[key] === undefined || rawAttrs[key] === null || rawAttrs[key] === '') {
          delete rawAttrs[key];
        }
      });

      const priceNum = parseFloat(p.price || p.regular_price || '0') || 0;
      const stockQty = p.manage_stock && typeof p.stock_quantity === 'number' ? p.stock_quantity : (p.stock_status === 'instock' ? 99 : 0);

      products.push({
        externalId: String(p.id),
        name: p.name || `Product #${p.id}`,
        sku,
        price: priceNum,
        inventory: stockQty,
        description: cleanDesc || undefined,
        imageUrl,
        rawAttributes: Object.keys(rawAttrs).length > 0 ? rawAttrs : undefined,
      });
    }

    const totalPagesHeader = res.headers.get('x-wp-totalpages');
    if (totalPagesHeader) {
      const totalPages = parseInt(totalPagesHeader, 10);
      if (page >= totalPages) {
        hasMore = false;
      } else {
        page++;
      }
    } else if (data.length < perPage) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return products;
}
