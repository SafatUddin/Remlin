import { Type } from '@google/genai';
import { ai } from './gemini';
import { detectImageType } from './mediaStorage';
import { normalizeProductImageLink } from '../shared/productImage';

export const MAX_INBOUND_IMAGE_BYTES = 5 * 1024 * 1024;
// Catalog photos are compared visually in batches of this size (in parallel); the best of each
// batch go to a final round. Catalogs above MAX_COMPARE_PRODUCTS are first narrowed by a text
// shortlist (see shortlistCatalog), since comparing hundreds of photos per message is too slow.
export const COMPARE_BATCH_SIZE = Number(process.env.IMAGE_MATCH_BATCH) || 8;
export const MAX_COMPARE_PRODUCTS = 240;
const FINALISTS_PER_BATCH = 3;
const FAILED_DOWNLOAD_CACHE_MS = 5 * 60 * 1000;
const IMAGE_MODEL = process.env.IMAGE_MATCH_MODEL || 'gemini-3.5-flash-lite';
// Used when the primary model stays overloaded after retries.
const IMAGE_FALLBACK_MODEL = 'gemini-2.5-flash';
const RETRY_DELAYS_MS = [1500, 4000];
const DEBUG = process.env.IMAGE_MATCH_DEBUG === '1';

const isRetryableAiError = (err: any) => {
  const text = `${err?.status ?? ''} ${err?.code ?? ''} ${err?.message ?? ''}`;
  return /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|fetch failed|ECONNRESET|ETIMEDOUT/i.test(text);
};

/** generateContent with retries on overload/transient errors, then one try on a fallback model. */
async function generateWithRetry(request: Omit<Parameters<NonNullable<typeof ai>['models']['generateContent']>[0], 'model'>) {
  let lastError: unknown;
  for (const [attempt, model] of [IMAGE_MODEL, IMAGE_MODEL, IMAGE_MODEL, IMAGE_FALLBACK_MODEL].entries()) {
    try {
      const response = await ai!.models.generateContent({ ...request, model });
      if (DEBUG) console.log(`[IMAGE MATCH DEBUG] model=${model} attempt=${attempt + 1}`);
      return response;
    } catch (err) {
      if (DEBUG) console.log(`[IMAGE MATCH DEBUG] model=${model} attempt=${attempt + 1} failed: ${String((err as any)?.message || err).slice(0, 160)}`);
      lastError = err;
      if (!isRetryableAiError(err)) throw err;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
const MAX_REDIRECTS = 3;
const CATALOG_IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const CATALOG_IMAGE_CACHE_MAX = 300;

export interface ImageRecognitionCatalogItem {
  name: string;
  sku: string;
  price: number;
  description?: string | null;
  imageUrl?: string | null;
  /** Extra searchable product facts, e.g. "color: Black; category: Electronics; tags: keyboard". */
  attributes?: string;
}

export interface ImageMatchCandidate {
  sku: string;
  confidence: number;
  reason: string;
}

/**
 * What the customer wants with the photo:
 * - inquiry: "do you have this?", "price?", or no text at all
 * - purchase: wants to order it (possibly with a quantity)
 * - question: a specific question about it (size, material, delivery, …)
 * - inventory_request: asks the store to add / stock / start selling it
 */
export type ImageIntent = 'inquiry' | 'purchase' | 'question' | 'inventory_request';

export interface ImageRecognitionResult {
  /** exact = same product; similar = closest alternative of the same kind; none = nothing comparable */
  match: 'exact' | 'similar' | 'none' | 'unavailable';
  sku: string | null;
  confidence: number;
  candidates: ImageMatchCandidate[];
  intent: ImageIntent;
  /** Main color visible in the customer's photo, when the model could tell. */
  detectedColor?: string;
}

/** Result of comparing the photo with the catalog (independent of what the customer wrote). */
export type VisualMatch = Omit<ImageRecognitionResult, 'intent'>;

const INTENTS: ImageIntent[] = ['inquiry', 'purchase', 'question', 'inventory_request'];
export const EXACT_MATCH_THRESHOLD = 0.85;
export const SIMILAR_MATCH_THRESHOLD = 0.3;

// Backstop for the model's intent label: requests to stock / list / start selling an item.
const INVENTORY_REQUEST_PATTERN = new RegExp(
  [
    String.raw`\b(add|put|include|list|upload)\b.{0,25}\b(inventory|stock|catalog(ue)?|store|shop|collection|page|website)\b`,
    String.raw`\b(start|begin|please|can you|could you|will you|should)\b.{0,20}\b(selling|sell|stocking|stock|carry|carrying|bring(ing)?|import(ing)?)\b.{0,15}\b(this|it|these|that|one)\b`,
    String.raw`\b(restock|bring this|get this in|order this for your (shop|store))\b`,
    String.raw`\b(eta|eita|egula|eigula)\b.{0,25}\b(add|stock|ana|anen|anben|rakhen|rakhben|tolen|tulen)\b`,
    String.raw`(এটা|এইটা|এগুলো).{0,25}(যোগ|স্টক|আনেন|আনবেন|রাখেন|রাখবেন|তুলেন)`,
  ].join('|'),
  'iu',
);

export function isInventoryRequest(text: string): boolean {
  return INVENTORY_REQUEST_PATTERN.test(text || '');
}

export function validateInboundImage(buffer: Buffer): { mime: string; size: number } | null {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_INBOUND_IMAGE_BYTES) return null;
  const type = detectImageType(buffer);
  return type ? { mime: type.mime, size: buffer.length } : null;
}

export function normalizeImageRecognitionResult(
  raw: unknown,
  catalog: ImageRecognitionCatalogItem[],
  customerText = '',
): ImageRecognitionResult {
  const validSkus = new Set(catalog.map((item) => item.sku));
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const rawCandidates = Array.isArray(value.candidates) ? value.candidates : [];
  const candidates: ImageMatchCandidate[] = [];

  for (const candidate of rawCandidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const item = candidate as Record<string, unknown>;
    const sku = typeof item.sku === 'string' ? item.sku.trim() : '';
    const confidence = Number(item.confidence);
    if (!validSkus.has(sku) || !Number.isFinite(confidence)) continue;
    if (candidates.some((entry) => entry.sku === sku)) continue;
    candidates.push({
      sku,
      confidence: Math.max(0, Math.min(1, confidence)),
      reason: typeof item.reason === 'string' ? item.reason.slice(0, 300) : '',
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const top = candidates[0];
  const rawMatch = value.match;
  let match: ImageRecognitionResult['match'];
  // Decided from the calibrated confidence scale; the model's label can only downgrade "exact".
  if (!top) match = 'none';
  else if (rawMatch !== 'similar' && rawMatch !== 'none' && top.confidence >= EXACT_MATCH_THRESHOLD) match = 'exact';
  else if (top.confidence >= SIMILAR_MATCH_THRESHOLD) match = 'similar';
  else match = 'none';

  const rawIntent = typeof value.intent === 'string' ? value.intent as ImageIntent : 'inquiry';
  const intent: ImageIntent = isInventoryRequest(customerText)
    ? 'inventory_request'
    : INTENTS.includes(rawIntent) ? rawIntent : 'inquiry';
  const detectedColor = typeof value.detectedColor === 'string' && value.detectedColor.trim()
    ? value.detectedColor.trim().slice(0, 40)
    : undefined;

  return {
    match,
    sku: match === 'exact' || match === 'similar' ? top!.sku : null,
    confidence: top?.confidence ?? 0,
    candidates: candidates.slice(0, 3),
    intent,
    detectedColor,
  };
}

// ── Image downloads ──────────────────────────────────────────────────────────

/**
 * Downloads an image over https, following a few redirects (each hop re-validated as a public
 * https URL; the access token is only sent to the original host). Returns null unless the bytes
 * are a supported image under the size limit.
 */
export async function downloadInboundImage(url: string, accessToken?: string): Promise<Buffer | null> {
  try {
    let current = url;
    const originalHost = new URL(url).host;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!/^https:\/\//i.test(current) || !normalizeProductImageLink(current)) return null;
      const headers: Record<string, string> = { Accept: 'image/jpeg,image/png,image/webp,image/gif;q=0.9,*/*;q=0.5' };
      if (accessToken && new URL(current).host === originalHost) headers.Authorization = `Bearer ${accessToken}`;
      const response = await fetch(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return null;
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok) return null;
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_INBOUND_IMAGE_BYTES) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      return validateInboundImage(buffer) ? buffer : null;
    }
    return null;
  } catch {
    return null;
  }
}

type ImagePart = { inlineData: { mimeType: string; data: string } };
const catalogImageCache = new Map<string, { part: ImagePart | null; at: number }>();

async function fetchCatalogImagePart(url: string): Promise<ImagePart | null> {
  const cached = catalogImageCache.get(url);
  if (cached && Date.now() - cached.at < (cached.part ? CATALOG_IMAGE_CACHE_TTL_MS : FAILED_DOWNLOAD_CACHE_MS)) return cached.part;
  // One retry: catalog CDNs occasionally time out
  const buffer = (await downloadInboundImage(url)) || (await downloadInboundImage(url));
  const type = buffer ? validateInboundImage(buffer) : null;
  const part = buffer && type ? { inlineData: { mimeType: type.mime, data: buffer.toString('base64') } } : null;
  if (catalogImageCache.size >= CATALOG_IMAGE_CACHE_MAX) {
    const oldest = catalogImageCache.keys().next().value;
    if (oldest) catalogImageCache.delete(oldest);
  }
  catalogImageCache.set(url, { part, at: Date.now() });
  return part;
}

// ── Candidate shortlist (large catalogs) ─────────────────────────────────────

const tokenize = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length > 1);

/** Ranks catalog items by overlap with the photo's description; items with photos win ties. */
export function shortlistCatalog(
  catalog: ImageRecognitionCatalogItem[],
  keywords: string[],
  limit = MAX_COMPARE_PRODUCTS,
): ImageRecognitionCatalogItem[] {
  if (catalog.length <= limit) return catalog;
  const wanted = new Set(keywords.flatMap(tokenize));
  const scored = catalog.map((item, index) => {
    const nameTokens = tokenize(item.name);
    const otherTokens = tokenize(`${item.description || ''} ${item.attributes || ''}`);
    const score =
      nameTokens.filter((t) => wanted.has(t)).length * 3 +
      new Set(otherTokens.filter((t) => wanted.has(t))).size +
      (item.imageUrl ? 0.5 : 0);
    return { item, score, index };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.item);
}

async function describeCustomerImage(image: ImagePart): Promise<string[]> {
  if (!ai) return [];
  try {
    const response = await generateWithRetry({
      contents: [{
        role: 'user',
        parts: [
          { text: 'Describe the main product in this photo for a shop catalog search. Return the product type, its category, colors, material, brand if visible, and other short search keywords.' },
          image,
        ],
      }],
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            productType: { type: Type.STRING },
            category: { type: Type.STRING },
            colors: { type: Type.ARRAY, items: { type: Type.STRING } },
            keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['productType', 'keywords'],
        },
      },
    });
    const parsed = JSON.parse(response.text || '{}');
    return [parsed.productType, parsed.category, ...(parsed.colors || []), ...(parsed.keywords || [])]
      .filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

// ── Main entry points ────────────────────────────────────────────────────────

/**
 * Compares a customer's photo with the store catalog — by the photos only, never influenced by
 * the customer's words. Reports the closest product as "similar" when no identical one exists.
 * Can be started as soon as the photo arrives (see inboundBatcher).
 */
export async function matchCatalogImage(image: Buffer, catalog: ImageRecognitionCatalogItem[]): Promise<VisualMatch> {
  const imageType = validateInboundImage(image);
  if (!imageType || !ai) return { match: 'unavailable', sku: null, confidence: 0, candidates: [] };
  if (catalog.length === 0) return { match: 'none', sku: null, confidence: 0, candidates: [] };

  const customerPart: ImagePart = { inlineData: { mimeType: imageType.mime, data: image.toString('base64') } };
  try {
    const pool = catalog.length > MAX_COMPARE_PRODUCTS
      ? shortlistCatalog(catalog, await describeCustomerImage(customerPart))
      : catalog;
    const photos = new Map<string, ImagePart | null>();
    await Promise.all(pool.map(async (item) => {
      photos.set(item.sku, item.imageUrl ? await fetchCatalogImagePart(item.imageUrl) : null);
    }));

    if (pool.length <= COMPARE_BATCH_SIZE) return await compareWithCatalog(customerPart, pool, photos);

    // Round 1: compare small batches in parallel (more reliable than one huge comparison)
    const batches: ImageRecognitionCatalogItem[][] = [];
    for (let i = 0; i < pool.length; i += COMPARE_BATCH_SIZE) batches.push(pool.slice(i, i + COMPARE_BATCH_SIZE));
    const rounds = await Promise.all(batches.map((batch) => compareWithCatalog(customerPart, batch, photos)));
    const roundOneBest = rounds
      .flatMap((round) => round.candidates)
      .sort((a, b) => b.confidence - a.confidence)[0];
    const finalistSkus = new Set(rounds.flatMap((round) => round.candidates.slice(0, FINALISTS_PER_BATCH).map((c) => c.sku)));
    const finalists = pool.filter((item) => finalistSkus.has(item.sku));
    if (finalists.length === 0) return { match: 'none', sku: null, confidence: 0, candidates: [], detectedColor: rounds[0]?.detectedColor };

    // Round 2: the batch winners side by side
    const final = await compareWithCatalog(customerPart, finalists, photos);
    // A confident same-item match from round 1 is kept if the crowded final round lost it.
    if (final.match !== 'exact' && roundOneBest && roundOneBest.confidence >= EXACT_MATCH_THRESHOLD) {
      const others = final.candidates.filter((c) => c.sku !== roundOneBest.sku);
      return {
        match: 'exact',
        sku: roundOneBest.sku,
        confidence: roundOneBest.confidence,
        candidates: [roundOneBest, ...others].slice(0, 3),
        detectedColor: final.detectedColor ?? rounds.find((r) => r.detectedColor)?.detectedColor,
      };
    }
    return final;
  } catch (err: any) {
    console.error('Image recognition failed:', err?.message || err);
    return { match: 'unavailable', sku: null, confidence: 0, candidates: [] };
  }
}

/** What the customer wants with their photo, from the words sent with / right after it. */
export async function classifyImageIntent(customerText: string): Promise<ImageIntent> {
  const text = customerText.trim();
  if (!text) return 'inquiry';
  if (isInventoryRequest(text)) return 'inventory_request';
  if (!ai) return 'inquiry';
  try {
    const response = await generateWithRetry({
      contents: [{
        role: 'user',
        parts: [{
          text: [
            'A shop customer sent a product photo together with this message. Classify what they want:',
            '"inquiry" = asks if it is available, its price, or what it is;',
            '"purchase" = wants to buy / order it (possibly with a quantity);',
            '"question" = asks something specific about it (size, material, delivery, warranty, other colors…);',
            '"inventory_request" = asks the shop to add, stock, list, bring in or start selling this item.',
            'The message may be in English, Bangla or Banglish (Bangla in English letters).',
            `Message: ${JSON.stringify(text.slice(0, 1000))}`,
          ].join('\n'),
        }],
      }],
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: { intent: { type: Type.STRING, enum: INTENTS } },
          required: ['intent'],
        },
      },
    });
    const intent = JSON.parse(response.text || '{}').intent;
    return INTENTS.includes(intent) ? intent : 'inquiry';
  } catch (err: any) {
    console.error('Image intent classification failed:', err?.message || err);
    return 'inquiry';
  }
}

/** Visual match + intent in one call (both run in parallel). */
export async function recognizeCatalogImage(
  image: Buffer,
  catalog: ImageRecognitionCatalogItem[],
  customerText = '',
  precomputedMatch?: Promise<VisualMatch>,
): Promise<ImageRecognitionResult> {
  const [visual, intent] = await Promise.all([
    precomputedMatch ?? matchCatalogImage(image, catalog),
    classifyImageIntent(customerText),
  ]);
  return { ...visual, intent };
}

async function compareWithCatalog(
  customerPart: ImagePart,
  items: ImageRecognitionCatalogItem[],
  photos: Map<string, ImagePart | null>,
): Promise<VisualMatch> {
  const catalogParts: Array<Record<string, unknown>> = [];
  items.forEach((item, index) => {
    const photo = photos.get(item.sku);
    catalogParts.push({
      text: `Catalog product #${index + 1}: SKU=${item.sku}; name=${item.name}; price=${item.price}; ${item.attributes ? `${item.attributes}; ` : ''}description=${(item.description || 'none').slice(0, 200)}${photo ? ' — its photo:' : ' (no photo available)'}`,
    });
    if (photo) catalogParts.push(photo);
  });

  if (DEBUG) console.log(`[IMAGE MATCH DEBUG] comparing with ${items.length} products, ${items.filter((i) => photos.get(i.sku)).length} photos loaded`);
  const response = await generateWithRetry({
    contents: [{
      role: 'user',
      parts: [
        {
          text: [
            'You match a customer\'s photo to a shop\'s catalog. The next image is the CUSTOMER PHOTO; after it, each catalog product is listed with its details and photo.',
            'Judge mainly by comparing the PHOTOS (shape, design, color, details). Product names and descriptions can be inaccurate — when a catalog photo shows the same item as the customer photo, it is a match even if the name suggests otherwise.',
            'ALWAYS list the 3 catalog products closest to the customer photo (best first), even when none of them is a good match. Only use SKUs listed below.',
            'Score each with this confidence scale:',
            '  0.85–1.0 = the same item (same type, design and color; the same photo also counts)',
            '  0.50–0.84 = the same kind of product but not identical (e.g. different color, model or brand; earbuds vs headphones)',
            '  0.30–0.49 = a related product from the same category or with a similar purpose',
            '  0.00–0.29 = unrelated (or the photo does not show a product)',
            'match = "exact" if the best scores 0.85+, "similar" if it scores 0.30–0.84, otherwise "none".',
            'detectedColor = the main color of the product in the customer photo.',
          ].join('\n'),
        },
        customerPart,
        ...catalogParts,
      ],
    }],
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          match: { type: Type.STRING, enum: ['exact', 'similar', 'none'] },
          detectedColor: { type: Type.STRING },
          candidates: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sku: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                reason: { type: Type.STRING },
              },
              required: ['sku', 'confidence', 'reason'],
            },
          },
        },
        required: ['match', 'candidates'],
      },
    },
  });
  if (DEBUG) console.log('[IMAGE MATCH DEBUG] raw:', (response.text || '').slice(0, 600));
  const { intent: _intent, ...visual } = normalizeImageRecognitionResult(JSON.parse(response.text || '{}'), items);
  return visual;
}
