// Currency detection/formatting for catalog prices. Prices are stored as plain numbers, so the
// currency comes from product data: a "Currency" column (CSV / Shopify / WooCommerce / manual),
// or a symbol found in a price-like column. When nothing is known, no symbol is shown.

const CURRENCY_KEY_PATTERN = /currency|^curr$/i;
const PRICE_KEY_PATTERN = /price|cost|msrp|amount/i;
const ISO_CODE_PATTERN = /^[A-Z]{3}$/;
const CURRENCY_WORDS: Record<string, string> = { tk: 'BDT', taka: 'BDT', rs: 'INR', usd: 'USD', dollar: 'USD', dollars: 'USD', euro: 'EUR', euros: 'EUR' };

export const CURRENCY_ATTRIBUTE_KEY = 'Currency';

let isoCodes: Set<string> | null | undefined;
function isIsoCurrency(code: string): boolean {
  if (!ISO_CODE_PATTERN.test(code)) return false;
  if (isoCodes === undefined) {
    try {
      isoCodes = new Set((Intl as any).supportedValuesOf('currency') as string[]);
    } catch {
      isoCodes = null;
    }
  }
  return isoCodes ? isoCodes.has(code) : true;
}

function normalizeMarker(marker: string): string | undefined {
  const word = CURRENCY_WORDS[marker.toLowerCase()];
  if (word) return word;
  if (/^[a-z]{3}$/i.test(marker)) return isIsoCurrency(marker.toUpperCase()) ? marker.toUpperCase() : undefined;
  return /\p{Sc}/u.test(marker) ? marker : undefined;
}

export function isCurrencyKey(key: string): boolean {
  return CURRENCY_KEY_PATTERN.test(key.trim());
}

/** Extracts a currency symbol/code from a value such as "৳1,200", "Tk 500", "1200 BDT" or "$12.99". */
export function detectCurrencyInText(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  if (!/\d/.test(text)) return undefined;
  const marker = text.replace(/[\d\s.,\-+'()]/g, '').trim();
  if (!marker || marker.length > 5) return undefined;
  return normalizeMarker(marker);
}

/** Extracts a currency from a column header such as "Price (BDT)", "Price ৳" or "price_usd". */
export function detectCurrencyInHeader(header: string): string | undefined {
  const bracket = header.match(/[([]\s*([^)\]]{1,5})\s*[)\]]/);
  const fromBracket = bracket ? normalizeMarker(bracket[1].trim()) : undefined;
  if (fromBracket) return fromBracket;
  const symbol = header.match(/\p{Sc}/u);
  if (symbol) return symbol[0];
  const code = header.match(/(?:^|[\s_-])([A-Za-z]{2,5})$/);
  return code ? normalizeMarker(code[1]) : undefined;
}

/** Finds the currency for a product from its raw attributes (currency column first, then price-like values). */
export function getProductCurrency(rawAttributes: unknown): string | undefined {
  if (!rawAttributes || typeof rawAttributes !== 'object' || Array.isArray(rawAttributes)) return undefined;
  const entries = Object.entries(rawAttributes as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (isCurrencyKey(key) && value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  for (const [key, value] of entries) {
    if (!PRICE_KEY_PATTERN.test(key)) continue;
    const found = detectCurrencyInText(value) || detectCurrencyInHeader(key);
    if (found) return found;
  }
  return undefined;
}

export function formatPrice(price: number, currency?: string): string {
  const amount = Number.isFinite(price) ? price : 0;
  const plain = amount.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const value = currency?.trim();
  if (!value) return plain;
  const upper = value.toUpperCase();
  if (isIsoCurrency(upper)) {
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: upper, currencyDisplay: 'narrowSymbol' }).format(amount);
    } catch {
      return `${plain} ${upper}`;
    }
  }
  if (/\p{Sc}/u.test(value)) return `${value}${plain}`;
  return `${value} ${plain}`;
}

export function mostCommonCurrency(currencies: (string | undefined | null)[]): string | undefined {
  const counts = new Map<string, number>();
  currencies.forEach((currency) => {
    const value = currency?.trim();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** The store-wide currency: the one most products in the catalog use. Used for order totals. */
export function getCatalogCurrency(products: { rawAttributes?: unknown }[]): string | undefined {
  return mostCommonCurrency(products.map((p) => getProductCurrency(p.rawAttributes)));
}

/** Currency for an order/cart: the one its products use, falling back to the store-wide currency. */
export function getOrderCurrency(
  items: { sku?: string | null }[],
  products: { sku: string; rawAttributes?: unknown }[],
  fallbackCurrency?: string,
): string | undefined {
  const currencies = items.map((item) => {
    const product = item.sku ? products.find((p) => p.sku === item.sku) : undefined;
    return product ? getProductCurrency(product.rawAttributes) : undefined;
  });
  return mostCommonCurrency(currencies) || fallbackCurrency;
}

/** Formats a product price using its own currency, falling back to the store-wide currency. */
export function formatProductPrice(product: { price: number; rawAttributes?: unknown }, fallbackCurrency?: string): string {
  return formatPrice(product.price, getProductCurrency(product.rawAttributes) || fallbackCurrency);
}
