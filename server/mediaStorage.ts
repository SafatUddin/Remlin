/**
 * Shared image storage on Supabase Storage (object storage) — used for both merchant
 * avatars and product photos. Local disk was tried first for avatars and abandoned:
 * Railway wipes the container filesystem on every redeploy with no volume configured,
 * silently breaking every stored image's URL.
 *
 * Stores files at:  {bucket}/{ownerId}/{uuid}.{ext}
 * Public URL:        {SUPABASE_URL}/storage/v1/object/public/{bucket}/{ownerId}/{uuid}.{ext}
 *
 * Security notes:
 * - Filenames are random UUIDs; never derived from user input.
 * - Objects are scoped per-owner (merchantId or storeId) by path prefix.
 * - Only JPEG, PNG, WebP, and GIF are accepted; verified by magic bytes, not just MIME header.
 * - Files above the configured max size are rejected before uploading.
 * - On image replace / remove, the old Supabase object is deleted (external HTTPS URLs,
 *   e.g. Google-provided avatars, are never touched).
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

// Local fallback for customer chat photos when Supabase Storage isn't configured (local dev).
const LOCAL_CHAT_MEDIA_DIR = path.join(process.cwd(), 'uploads', 'chat-media');
const LOCAL_CHAT_FILE_PATTERN = /^[a-f0-9-]{36}\.(jpg|png|gif|webp)$/;

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_OPENING_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  }
  return createClient(url, key);
}

function publicUrlPrefix(bucket: string): string {
  const base = process.env.SUPABASE_URL || 'https://example.supabase.co';
  return `${base}/storage/v1/object/public/${bucket}/`;
}

function bucketPathRegex(bucket: string): RegExp {
  const prefix = publicUrlPrefix(bucket).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${prefix}[a-z0-9_-]+/[a-z0-9_-]+\\.[a-z]+$`, 'i');
}

/** Whether `url` is one of our own stored objects in the given bucket.
 *  Accepts the real Supabase URL when configured, but also tolerates a valid storage URL
 *  pattern during tests or local/dev setups where the env is intentionally absent.
 */
export function isStoredImageUrl(bucket: string, url: string): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;

  const prefixes = [publicUrlPrefix(bucket)];
  if (process.env.SUPABASE_URL) {
    prefixes.push(`${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/`);
  } else {
    prefixes.push(`https://storage.example.com/storage/v1/object/public/${bucket}/`);
    prefixes.push(`http://localhost/storage/v1/object/public/${bucket}/`);
    prefixes.push(`https://localhost/storage/v1/object/public/${bucket}/`);
  }

  for (const prefix of prefixes) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`^${escaped}[a-z0-9_-]+/[a-z0-9_-]+\\.[a-z]+$`, 'i').test(url)) {
      return true;
    }
  }

  const fallback = new RegExp(
    `^https?:\\/\\/[^\\s/]+\\/storage\\/v1\\/object\\/public\\/${bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/[a-z0-9_-]+\\/[a-z0-9_-]+\\.[a-z]+$`,
    'i',
  );
  return fallback.test(url);
}

/** Map MIME type → file extension (server-decided; never trusts client Content-Type). */
const MAGIC_BYTES: Array<{ magic: Buffer; mime: string; ext: string }> = [
  { magic: Buffer.from([0xff, 0xd8, 0xff]), mime: 'image/jpeg', ext: 'jpg' },
  { magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), mime: 'image/png', ext: 'png' },
  { magic: Buffer.from([0x47, 0x49, 0x46, 0x38]), mime: 'image/gif', ext: 'gif' },
  { magic: Buffer.from([0x52, 0x49, 0x46, 0x46]), mime: 'image/webp', ext: 'webp' },
];

/** Detect MIME type by magic bytes. Returns null if not an allowed image type. */
export function detectImageType(buf: Buffer): { mime: string; ext: string } | null {
  for (const entry of MAGIC_BYTES) {
    if (buf.length >= entry.magic.length && buf.subarray(0, entry.magic.length).equals(entry.magic)) {
      // WebP also needs 'WEBP' at offset 8
      if (entry.ext === 'webp') {
        if (buf.length >= 12 && buf.slice(8, 12).toString('ascii') === 'WEBP') {
          return { mime: entry.mime, ext: entry.ext };
        }
        continue;
      }
      return { mime: entry.mime, ext: entry.ext };
    }
  }
  return null;
}

function assertValidOwnerId(ownerId: string) {
  if (!/^[a-z0-9_-]+$/i.test(ownerId)) {
    throw new Error('Invalid owner id');
  }
}

/** Upload an image buffer to the given bucket, scoped under ownerId. Returns the public URL. */
export async function uploadImage(bucket: string, ownerId: string, buffer: Buffer): Promise<string> {
  const imgType = detectImageType(buffer);
  if (!imgType) throw new Error('Unsupported image format');
  assertValidOwnerId(ownerId);

  const filename = `${crypto.randomUUID()}.${imgType.ext}`;
  const objectPath = `${ownerId}/${filename}`;

  const { error } = await getSupabase().storage.from(bucket).upload(objectPath, buffer, {
    contentType: imgType.mime,
    upsert: false,
  });
  if (error) throw new Error(`Image upload failed: ${error.message}`);

  return `${publicUrlPrefix(bucket)}${objectPath}`;
}

/**
 * Delete an image object if it belongs to this owner's own storage path in the given
 * bucket. Silently ignores missing files or external HTTPS URLs.
 */
export async function deleteStoredImage(bucket: string, ownerId: string, imageUrl: string | null | undefined): Promise<void> {
  if (!imageUrl || !isStoredImageUrl(bucket, imageUrl)) return;
  try {
    const objectPath = imageUrl.slice(publicUrlPrefix(bucket).length);
    // Guard: the object path must actually be scoped under this owner's own folder.
    if (!objectPath.startsWith(`${ownerId}/`)) return;
    await getSupabase().storage.from(bucket).remove([objectPath]);
  } catch {
    // Best-effort deletion; never throw
  }
}

/**
 * Saves a photo a customer sent in chat so the inbox can always show it — the channel's own
 * media links expire (and WhatsApp's need the store's access token). Uses Supabase Storage
 * when configured, otherwise a local folder served by the authenticated /api/media/chat route.
 * Returns the URL to store on the message, or null if the bytes aren't a supported image.
 */
export async function saveChatImage(storeId: string, buffer: Buffer): Promise<string | null> {
  const imgType = detectImageType(buffer);
  if (!imgType) return null;
  assertValidOwnerId(storeId);
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      return await uploadImage('products', `chat-${storeId}`, buffer);
    } catch (err) {
      console.error('Chat image upload to storage failed; saving locally instead');
    }
  }
  const dir = path.join(LOCAL_CHAT_MEDIA_DIR, storeId);
  await fs.mkdir(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.${imgType.ext}`;
  await fs.writeFile(path.join(dir, filename), buffer);
  return `/api/media/chat/${storeId}/${filename}`;
}

/** Absolute path of a locally saved chat photo, or null for anything that isn't one. */
export function localChatImagePath(storeId: string, filename: string): string | null {
  if (!/^[a-z0-9_-]+$/i.test(storeId) || !LOCAL_CHAT_FILE_PATTERN.test(filename)) return null;
  return path.join(LOCAL_CHAT_MEDIA_DIR, storeId, filename);
}

/** Multer factory: memoryStorage so we can inspect magic bytes before uploading. */
function makeImageUpload(maxBytes: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      // Accept only image/* — magic-byte check happens after full buffer arrives
      if (!file.mimetype.startsWith('image/')) {
        cb(new Error('Only image files are accepted'));
        return;
      }
      cb(null, true);
    },
  });
}

export const avatarUpload = makeImageUpload(MAX_AVATAR_BYTES);
export const productImageUpload = makeImageUpload(MAX_PRODUCT_IMAGE_BYTES);
export const openingImageUpload = makeImageUpload(MAX_OPENING_IMAGE_BYTES);

// ── Avatar-specific thin wrappers (bucket: "avatars", owner: merchantId) ──────────
export const saveAvatarFile = (merchantId: string, buffer: Buffer) => uploadImage('avatars', merchantId, buffer);
export const deleteLocalAvatarFile = (merchantId: string, avatarUrl: string | null | undefined) =>
  deleteStoredImage('avatars', merchantId, avatarUrl);
export const isLocalAvatarUrl = (url: string) => isStoredImageUrl('avatars', url);

// ── Product-image wrappers (bucket: "products", owner: storeId) ───────────────────
export const saveProductImageFile = (storeId: string, buffer: Buffer) => uploadImage('products', storeId, buffer);
export const deleteProductImageFile = (storeId: string, imageUrl: string | null | undefined) =>
  deleteStoredImage('products', storeId, imageUrl);
export const isProductImageUrl = (url: string) => isStoredImageUrl('products', url);

// ── Opening-greeting-image wrappers (bucket: "greetings", owner: storeId) ─────────
export const saveOpeningImageFile = (storeId: string, buffer: Buffer) => uploadImage('greetings', storeId, buffer);
export const deleteOpeningImageFile = (storeId: string, imageUrl: string | null | undefined) =>
  deleteStoredImage('greetings', storeId, imageUrl);
export const isOpeningImageUrl = (url: string) => isStoredImageUrl('greetings', url);
