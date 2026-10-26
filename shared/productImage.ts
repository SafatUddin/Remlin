// Shared by the server (API responses, AI catalog) and the dashboard (catalog thumbnails).

const IMAGE_KEY_PATTERN = /(image|img|photo|picture|pic|thumbnail|thumb|media|src|gallery)/i;
const IMAGE_EXT_PATTERN = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;
const URL_PATTERN = /https?:\/\/[^\s"'<>|;]+/gi;
const NESTED_URL_KEYS = ['src', 'url', 'href', 'original', 'large', 'medium', 'small', 'thumbnail'];

export const MAX_PRODUCT_IMAGE_URL_LENGTH = 2048;

function extractUrls(value: unknown, depth = 0): string[] {
  if (value === null || value === undefined || depth > 3) return [];
  if (typeof value === 'string') {
    return (value.match(URL_PATTERN) || [])
      .flatMap((match) => match.split(/,(?=https?:\/\/)/i))
      .map((url) => url.replace(/[),.\]]+$/, ''))
      .filter(Boolean);
  }
  if (Array.isArray(value)) return value.flatMap((item) => extractUrls(item, depth + 1));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred = NESTED_URL_KEYS.filter((key) => key in record).flatMap((key) => extractUrls(record[key], depth + 1));
    return preferred.length > 0 ? preferred : Object.values(record).flatMap((item) => extractUrls(item, depth + 1));
  }
  return [];
}

/**
 * Ordered list of image URLs for a product: the stored imageUrl first, then URLs found in
 * columns whose name indicates an image (e.g. "Image URL", "Photo", "image_src"), then any
 * other column value that looks like a direct link to an image file.
 */
export function getProductImageCandidates(product: { imageUrl?: string | null; rawAttributes?: unknown }): string[] {
  const candidates: string[] = [];
  if (product.imageUrl) candidates.push(product.imageUrl);

  const raw = product.rawAttributes;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>);
    for (const [key, value] of entries) {
      if (IMAGE_KEY_PATTERN.test(key)) candidates.push(...extractUrls(value));
    }
    for (const [key, value] of entries) {
      if (!IMAGE_KEY_PATTERN.test(key)) candidates.push(...extractUrls(value).filter((url) => IMAGE_EXT_PATTERN.test(url)));
    }
  }

  return Array.from(new Set(candidates));
}

export function resolveProductImageUrl(product: { imageUrl?: string | null; rawAttributes?: unknown }): string | undefined {
  return getProductImageCandidates(product)[0];
}

/** Validates a merchant-supplied image link: public https URL only. */
export function normalizeProductImageLink(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_PRODUCT_IMAGE_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    (!host.includes('.') && !host.includes(':')) ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host === '::1' ||
    (host.includes(':') && /^(fc|fd|fe80)/i.test(host))
  ) {
    return null;
  }
  return url.toString();
}
