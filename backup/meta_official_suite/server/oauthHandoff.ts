import crypto from 'crypto';
import { prisma } from './db';

export const OAUTH_HANDOFF_TTL_MS = 10 * 60 * 1000;

export type OAuthHandoffPurpose =
  | 'google_login'
  | 'facebook_connect'
  | 'shopify_connect'
  | 'facebook_pending'
  | 'whatsapp_pending';

function newOpaqueCode(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export async function createOAuthHandoff(input: {
  purpose: OAuthHandoffPurpose;
  storeId?: string | null;
  merchantId?: string | null;
  payload?: unknown;
  ttlMs?: number;
}): Promise<string> {
  const code = newOpaqueCode();
  const ttlMs = input.ttlMs ?? OAUTH_HANDOFF_TTL_MS;
  await prisma.oAuthHandoff.create({
    data: {
      code,
      purpose: input.purpose,
      storeId: input.storeId ?? null,
      merchantId: input.merchantId ?? null,
      payload: input.payload === undefined ? undefined : (input.payload as object),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return code;
}

export class OAuthHandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthHandoffError';
  }
}

/** Load a handoff without consuming it. Rejects expired/used/wrong-purpose. */
export async function peekOAuthHandoff(code: string, purpose: OAuthHandoffPurpose) {
  if (!code || typeof code !== 'string') {
    throw new OAuthHandoffError('Invalid handoff code');
  }
  const row = await prisma.oAuthHandoff.findUnique({ where: { code } });
  if (!row || row.purpose !== purpose) {
    throw new OAuthHandoffError('Invalid or expired handoff code');
  }
  if (row.usedAt) {
    throw new OAuthHandoffError('Handoff code already used');
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new OAuthHandoffError('Handoff code expired');
  }
  return row;
}

/** Atomically mark a handoff used and return it. Single-use. */
export async function consumeOAuthHandoff(code: string, purpose: OAuthHandoffPurpose) {
  const row = await peekOAuthHandoff(code, purpose);
  const updated = await prisma.oAuthHandoff.updateMany({
    where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (updated.count !== 1) {
    throw new OAuthHandoffError('Handoff code already used or expired');
  }
  return row;
}

/** Best-effort cleanup of expired rows (non-blocking hygiene). */
export async function purgeExpiredOAuthHandoffs(): Promise<void> {
  try {
    await prisma.oAuthHandoff.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
  } catch {
    // ignore cleanup failures
  }
}
