// Maps spreadsheet / feed column headers to the catalog's core fields. Matching is done on whole
// words of the header ("product_id" → ["product", "id"]) and in priority order, so e.g.
// "product_name" wins over "product_id" for the name, and "product_id" is only used as a SKU
// when there is no "sku" column.

export type CatalogField = 'name' | 'sku' | 'price' | 'inventory' | 'description';
type Rule = (tokens: string[], joined: string) => boolean;

export function headerTokens(header: string): string[] {
  return header
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const has = (tokens: string[], words: string[]) => tokens.some((t) => words.includes(t));

const ID_WORDS = ['id', 'sku', 'code', 'number', 'no', 'num', 'barcode', 'ean', 'upc', 'gtin', 'mpn', 'isbn'];
const NOT_NAME_WORDS = [...ID_WORDS, 'brand', 'vendor', 'category', 'subcategory', 'type', 'image', 'img', 'photo', 'url', 'link', 'file', 'price', 'qty', 'quantity', 'stock', 'status', 'weight', 'tag', 'tags', 'description', 'desc'];

const RULES: Record<CatalogField, Rule[]> = {
  name: [
    (_t, j) => ['name', 'productname', 'producttitle', 'title', 'itemname', 'itemtitle'].includes(j),
    (t) => has(t, ['name', 'title']) && !has(t, NOT_NAME_WORDS) && !has(t, ['seo', 'meta', 'customer', 'supplier', 'manufacturer', 'variant', 'option']),
    (t, j) => ['product', 'item'].includes(j) || (has(t, ['product', 'item']) && !has(t, NOT_NAME_WORDS)),
  ],
  sku: [
    (_t, j) => j === 'sku',
    (t) => has(t, ['sku']),
    (_t, j) => ['productid', 'itemid', 'productcode', 'itemcode', 'code', 'id', 'productnumber', 'itemnumber', 'articlenumber', 'partnumber'].includes(j),
    (t) => has(t, ['code']) && !has(t, ['currency', 'zip', 'postal', 'tax', 'country', 'color', 'colour']),
  ],
  price: [
    (_t, j) => ['price', 'saleprice', 'sellingprice', 'unitprice', 'regularprice', 'retailprice'].includes(j),
    (t) => has(t, ['price']) && !has(t, ['compare', 'old', 'original', 'was', 'cost']),
    (t) => has(t, ['price', 'cost', 'msrp', 'amount', 'mrp', 'rate']),
  ],
  inventory: [
    (_t, j) => ['inventory', 'stock', 'quantity', 'qty', 'stockquantity', 'inventoryquantity', 'stockqty', 'onhand'].includes(j),
    (t) => has(t, ['inventory', 'quantity', 'qty']) && !has(t, ['min', 'max', 'minimum', 'maximum', 'order']),
    (t) => has(t, ['stock', 'units']) && !has(t, ['status', 'level', 'policy']),
  ],
  description: [
    (_t, j) => ['description', 'desc', 'productdescription', 'details', 'body', 'bodyhtml'].includes(j),
    (t) => has(t, ['description', 'desc', 'details', 'body']) && !has(t, ['short', 'meta', 'seo']),
    (t) => has(t, ['description', 'desc']),
  ],
};

/**
 * Picks the best header for each core field. A header is assigned to at most one field.
 * Fields are resolved SKU → name → price → inventory → description.
 */
export function detectCatalogColumns(headers: string[], skip: (header: string) => boolean = () => false): Partial<Record<CatalogField, string>> {
  const candidates = headers.filter((h) => h && h.trim() && !skip(h));
  const used = new Set<string>();
  const result: Partial<Record<CatalogField, string>> = {};
  for (const field of ['sku', 'name', 'price', 'inventory', 'description'] as CatalogField[]) {
    for (const rule of RULES[field]) {
      const match = candidates.find((h) => {
        if (used.has(h)) return false;
        const tokens = headerTokens(h);
        return rule(tokens, tokens.join(''));
      });
      if (match) {
        result[field] = match;
        used.add(match);
        break;
      }
    }
  }
  return result;
}

/**
 * Display name for a product. Repairs rows imported before column matching was fixed, where the
 * stored name is just the SKU while the real name sits in a name-like extra column.
 */
export function resolveProductName(product: { name: string; sku: string; rawAttributes?: unknown }): string {
  const raw = product.rawAttributes;
  if (product.name.trim() !== product.sku.trim() || !raw || typeof raw !== 'object' || Array.isArray(raw)) return product.name;
  const record = raw as Record<string, unknown>;
  const nameKey = detectCatalogColumns(Object.keys(record)).name;
  const value = nameKey ? record[nameKey] : undefined;
  return typeof value === 'string' && value.trim() && value.trim() !== product.sku ? value.trim() : product.name;
}
