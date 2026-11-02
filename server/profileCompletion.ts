import type { Response, NextFunction } from 'express';
import { prisma } from './db';
import type { AuthedRequest } from './auth';
import { sanitizeBusinessProfile } from './businessProfile';

// ── Profile completion logic ───────────────────────────────────────────────

/** Minimal shape we need to evaluate completion — from Merchant and Store rows. */
export interface MerchantForCompletion {
  name: string;
  email: string;
  phone?: string | null;
}

export interface StoreForCompletion {
  name: string;
  businessProfile?: unknown;
}

export interface ProfileCompletionStatus {
  profileComplete: boolean;
  missingFields: string[];
}

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Derives profile completion from the actual field values — no separate flag column.
 * Completion requires all the mandatory personal and business fields to be non-empty.
 * Admin users are always considered to have a complete profile.
 */
export function getProfileCompletionStatus(
  merchant: MerchantForCompletion,
  store: StoreForCompletion,
  isAdmin?: boolean,
): ProfileCompletionStatus {
  // Admin users always have a complete profile
  if (isAdmin) {
    return { profileComplete: true, missingFields: [] };
  }

  const missing: string[] = [];

  if (!nonEmpty(merchant.name)) missing.push('name');
  if (!nonEmpty(merchant.email)) missing.push('email');

  if (!nonEmpty(store.name)) missing.push('storeName');
  const bp = sanitizeBusinessProfile(store.businessProfile) || {};
  if (!nonEmpty(bp.hotline)) missing.push('hotline');
  if (!nonEmpty(bp.sell)) missing.push('sell');
  if (!nonEmpty(bp.address)) missing.push('address');

  return { profileComplete: missing.length === 0, missingFields: missing };
}

// ── Allowlisted endpoints (accessible even when profile is incomplete) ─────

/**
 * Routes that an incomplete merchant must be able to call in order to finish
 * onboarding. Everything else requires a complete profile.
 */
const ONBOARDING_ALLOWED: Array<{ method: string; path: string }> = [
  { method: 'GET', path: '/api/me' },
  { method: 'PATCH', path: '/api/me' },
  { method: 'POST', path: '/api/me/complete-profile' },
  { method: 'POST', path: '/api/me/avatar' },
  { method: 'DELETE', path: '/api/me/avatar' },
  { method: 'POST', path: '/api/auth/logout' },
  { method: 'GET', path: '/api/channels' },
  { method: 'POST', path: '/api/channels/facebook/prepare' },
  { method: 'GET', path: '/api/channels/facebook/pending' },
  { method: 'POST', path: '/api/channels/facebook/select' },
  { method: 'GET', path: '/api/channels/whatsapp/pending' },
  { method: 'POST', path: '/api/channels/whatsapp/select' },
  { method: 'POST', path: '/api/channels/whatsapp/connect' },
];

export function isOnboardingAllowedRoute(method: string, path: string): boolean {
  const m = method.toUpperCase();
  // Normalize path (ignore trailing slash)
  const p = path.replace(/\/$/, '');
  return ONBOARDING_ALLOWED.some((r) => r.method === m && r.path === p);
}

// ── Middleware ─────────────────────────────────────────────────────────────

/**
 * Must be chained after `requireAuth`. Checks profile completeness and returns
 * 403 with a machine-readable code for any route not in the onboarding allowlist.
 * Admin users bypass profile completion checks.
 */
export async function requireProfileComplete(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Admin users bypass profile completion checks
  if (req.auth?.isAdmin) {
    next();
    return;
  }

  if (isOnboardingAllowedRoute(req.method, req.path)) {
    next();
    return;
  }

  try {
    const merchant = await prisma.merchant.findUnique({
      where: { id: req.auth!.merchantId },
      select: { name: true, email: true, phone: true },
    });
    const store = await prisma.store.findUnique({
      where: { merchantId: req.auth!.merchantId },
      select: { name: true, businessProfile: true },
    });

    if (!merchant || !store) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const { profileComplete, missingFields } = getProfileCompletionStatus(merchant, store);
    if (!profileComplete) {
      res.status(403).json({
        error: 'Profile incomplete',
        code: 'PROFILE_INCOMPLETE',
        missingFields,
      });
      return;
    }

    next();
  } catch {
    res.status(500).json({ error: 'Failed to verify profile status' });
  }
}
