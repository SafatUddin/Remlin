/**
 * Server-side input validation helpers (Security Phase 7 + Settings).
 * Small, reusable checks — no external validation framework.
 */

export const JSON_BODY_LIMIT = '1mb';

import { sanitizeBusinessProfile, type BusinessProfile } from './businessProfile';

export const MAX_PRODUCT_NAME_LENGTH = 200;
export const MAX_PRODUCT_DESCRIPTION_LENGTH = 5000;
export const MAX_SKU_LENGTH = 100;
export const MAX_PRODUCT_PRICE = 1_000_000;
export const MAX_PRODUCT_INVENTORY = 1_000_000;
export const MAX_CART_QUANTITY = 10_000;
export const MAX_CART_ITEMS = 50;
export const MAX_PERSONA_TONE_LENGTH = 500;
export const MAX_PERSONA_STYLE_LENGTH = 50;
export const MAX_PERSONA_INSTRUCTIONS_LENGTH = 10_000;
export const MAX_OPENING_TEXT_LENGTH = 2000;
export const MAX_KNOWLEDGE_TITLE_LENGTH = 200;
export const MAX_KNOWLEDGE_BODY_LENGTH = 20_000;
export const MAX_ADVANCE_TRANSACTION_ID_LENGTH = 200;

// Profile / merchant settings limits
export const MAX_MERCHANT_NAME_LENGTH = 200;
export const MAX_PHONE_LENGTH = 30;
export const MAX_STORE_NAME_LENGTH = 200;
export const MAX_WEBSITE_LENGTH = 2048;
export const MAX_ADDRESS_FIELD_LENGTH = 200;
export const MAX_POSTAL_CODE_LENGTH = 20;
export const MAX_COUNTRY_LENGTH = 100;

const CART_ITEM_KEYS = new Set(['sku', 'quantity']);

const DANGEROUS_URL_SCHEMES = /^(javascript|data|vbscript|file|blob):/i;

export type ValidatedProductInput = {
  name: string;
  sku: string;
  price: number;
  inventory: number;
  description?: string;
  status: 'PENDING' | 'TRAINED';
};

export type ValidatedKnowledgeInput = {
  title: string;
  body: string;
  enabled?: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  return trimmed;
}

function optionalString(value: unknown, maxLen: number): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  if (value.length > maxLen) return null;
  return value;
}

export function validateKnowledgeInput(body: unknown, partial = false): ValidatedKnowledgeInput | null {
  if (!isPlainObject(body)) return null;
  const result: ValidatedKnowledgeInput = { title: '', body: '' };

  if (!partial || body.title !== undefined) {
    const title = nonEmptyString(body.title, MAX_KNOWLEDGE_TITLE_LENGTH);
    if (title === null) return null;
    result.title = title;
  }
  if (!partial || body.body !== undefined) {
    const text = nonEmptyString(body.body, MAX_KNOWLEDGE_BODY_LENGTH);
    if (text === null) return null;
    result.body = text;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return null;
    result.enabled = body.enabled;
  }
  return result;
}

export function parseValidatedPrice(price: unknown): number | null {
  if (price === null || price === undefined) return null;
  if (typeof price === 'object' || typeof price === 'boolean') return null;
  const n = typeof price === 'number' ? price : Number(price);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRODUCT_PRICE) return null;
  return n;
}

export function parseValidatedInventory(inventory: unknown): number | null {
  if (inventory === undefined || inventory === null || inventory === '') return 0;
  if (typeof inventory === 'object' || typeof inventory === 'boolean') return null;
  const n = typeof inventory === 'number' ? inventory : Number(inventory);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAX_PRODUCT_INVENTORY) return null;
  return n;
}

export function validateProductInput(body: unknown): ValidatedProductInput | null {
  if (!isPlainObject(body)) return null;

  const name = nonEmptyString(body.name, MAX_PRODUCT_NAME_LENGTH);
  const sku = nonEmptyString(body.sku, MAX_SKU_LENGTH);
  const price = parseValidatedPrice(body.price);
  const inventory = parseValidatedInventory(body.inventory);
  if (name === null || sku === null || price === null || inventory === null) return null;

  const description = optionalString(body.description, MAX_PRODUCT_DESCRIPTION_LENGTH);
  if (description === null) return null;

  let status: 'PENDING' | 'TRAINED' = 'TRAINED';
  if (body.status !== undefined) {
    if (body.status === 'Pending') status = 'PENDING';
    else if (body.status === 'Trained') status = 'TRAINED';
    else if (body.status !== 'PENDING' && body.status !== 'TRAINED') return null;
    else status = body.status as 'PENDING' | 'TRAINED';
  }

  const result: ValidatedProductInput = { name, sku, price, inventory, status };
  if (description !== undefined) result.description = description;
  return result;
}

export function sanitizeCartInput(cart: unknown): { sku: string; quantity: number }[] | null {
  if (!Array.isArray(cart)) return null;
  if (cart.length > MAX_CART_ITEMS) return null;

  const sanitized: { sku: string; quantity: number }[] = [];
  for (const item of cart) {
    if (!isPlainObject(item)) return null;
    const keys = Object.keys(item);
    if (keys.length !== CART_ITEM_KEYS.size || !keys.every((k) => CART_ITEM_KEYS.has(k))) {
      return null;
    }

    const sku = nonEmptyString(item.sku, MAX_SKU_LENGTH);
    if (sku === null) return null;

    const quantity = item.quantity;
    if (typeof quantity === 'object' || typeof quantity === 'boolean') return null;
    const qty = typeof quantity === 'number' ? quantity : Number(quantity);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1 || qty > MAX_CART_QUANTITY) {
      return null;
    }

    sanitized.push({ sku, quantity: qty });
  }
  return sanitized;
}

export function validateCartSkusInStore(
  cart: { sku: string; quantity: number }[],
  storeSkus: Set<string>,
): boolean {
  if (cart.length === 0) return true;
  return cart.every((item) => storeSkus.has(item.sku));
}

const ALLOWED_CONVERSATION_PATCH_KEYS = new Set(['status', 'cart', 'isComplaint', 'isArchived', 'isSpam']);

export function conversationPatchHasOnlyAllowedKeys(body: unknown): boolean {
  if (!isPlainObject(body)) return false;
  return Object.keys(body).every((k) => ALLOWED_CONVERSATION_PATCH_KEYS.has(k));
}


// ── Control-char regex (used in profile text fields) ────────────────────────
const CONTROL_CHARS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

function hasControlChars(s: string): boolean {
  return CONTROL_CHARS_RE.test(s);
}

/** Validate an optional phone/fax string (E.164-ish or local). */
export function validatePhone(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed.length > MAX_PHONE_LENGTH) return null;
  if (hasControlChars(trimmed)) return null;
  // Allow digits, spaces, +, -, (, ), .
  if (!/^[0-9+\-()./ ]+$/.test(trimmed)) return null;
  return trimmed;
}

/** Validate a merchant name (required, non-empty). */
export function validateMerchantName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_MERCHANT_NAME_LENGTH) return null;
  if (hasControlChars(trimmed)) return null;
  return trimmed;
}

// ── Onboarding-specific validators ───────────────────────────────────────────

/** Phone is required during onboarding (non-empty). */
export function validateRequiredPhone(value: unknown): string | null {
  const result = validatePhone(value);
  if (result === undefined || result === null || result === '') return null;
  return result;
}

/** Postal code: required, ≤MAX_POSTAL_CODE_LENGTH, alphanumeric + space/dash only. */
export function validateRequiredPostalCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_POSTAL_CODE_LENGTH) return null;
  if (hasControlChars(trimmed)) return null;
  if (!/^[A-Za-z0-9 -]+$/.test(trimmed)) return null;
  return trimmed;
}


export type ValidatedOnboardingInput = {
  merchant: { name: string };
  store: { name: string; businessProfile: BusinessProfile };
};

/**
 * Validates the "Your business" payload in one pass, returning field-level errors.
 * Email comes from the authenticated session. Sell / hotline / address live inside businessProfile.
 */
export function validateOnboardingInput(
  body: unknown,
): { data: ValidatedOnboardingInput } | { fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};

  if (!isPlainObject(body)) {
    return { fieldErrors: { _form: 'Invalid request body.' } };
  }
  for (const key of Object.keys(body)) {
    if (!['name', 'storeName', 'businessProfile'].includes(key)) {
      return { fieldErrors: { _form: 'Unexpected field in request.' } };
    }
  }

  const name = validateMerchantName(body.name);
  if (name === null) fieldErrors.name = 'Full name is required and must be ≤200 characters.';

  const storeName = nonEmptyString(body.storeName, MAX_STORE_NAME_LENGTH);
  if (storeName === null) fieldErrors.storeName = 'Business name is required and must be ≤200 characters.';

  const profile = sanitizeBusinessProfile(body.businessProfile);
  if (profile === null) {
    fieldErrors.businessProfile = 'Business details are invalid.';
  } else {
    const hotline = validateRequiredPhone(profile.hotline);
    if (hotline === null) fieldErrors.hotline = 'A valid hotline number is required.';
    else profile.hotline = hotline;
    if (!profile.sell) fieldErrors.sell = 'Tell us what you sell.';
    if (!profile.address) fieldErrors.address = 'Address is required.';
    for (const k of ['hours', 'inC', 'inF', 'inS', 'outC', 'outF', 'outS', 'extra', 'pay', 'returns', 'first'] as const) {
      if (!profile[k]) fieldErrors[k] = 'This field is required.';
    }
    if (!profile.addr) fieldErrors.addr = 'Choose how to address customers.';
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };
  return { data: { merchant: { name: name! }, store: { name: storeName!, businessProfile: profile! } } };
}

export type ValidatedPersonaInput = {
  tone: string;
  style: string;
  customInstructions: string;
  autoFinalizeOrdersAlways: boolean;
  openingText: string;
  shareBusinessInfo: boolean;
};

export function validatePersonaInput(body: unknown): ValidatedPersonaInput | null {
  if (!isPlainObject(body)) return null;

  const tone = nonEmptyString(body.tone, MAX_PERSONA_TONE_LENGTH);
  const style = nonEmptyString(body.style, MAX_PERSONA_STYLE_LENGTH);
  if (tone === null || style === null) return null;
  if (style !== 'bullets' && style !== 'narrative') return null;

  const customInstructions =
    body.customInstructions === undefined || body.customInstructions === null
      ? ''
      : optionalString(body.customInstructions, MAX_PERSONA_INSTRUCTIONS_LENGTH);
  if (customInstructions === null) return null;

  const openingText =
    body.openingText === undefined || body.openingText === null
      ? ''
      : optionalString(body.openingText, MAX_OPENING_TEXT_LENGTH);
  if (openingText === null) return null;

  return {
    tone,
    style,
    customInstructions: customInstructions ?? '',
    autoFinalizeOrdersAlways: !!body.autoFinalizeOrdersAlways,
    openingText: openingText ?? '',
    shareBusinessInfo: body.shareBusinessInfo === undefined ? true : !!body.shareBusinessInfo,
  };
}
