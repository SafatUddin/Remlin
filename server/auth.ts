import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from './db';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = {
  algorithms: ['HS256'],
};

const isProduction = process.env.NODE_ENV === 'production';

// Merchant session lifetime. Independent of OAuth state / handoff tokens (signState).
export const MERCHANT_SESSION_EXPIRES_IN = '24h';
export const SESSION_COOKIE_NAME = 'shopmate_session';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export interface AuthTokenPayload {
  merchantId: string;
  storeId: string;
  /** Merchant.tokenVersion at issuance — must still match on every request. */
  tv: number;
  /** Admin flag - true if user is admin */
  isAdmin?: boolean;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: MERCHANT_SESSION_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

export function verifyToken(token: string): AuthTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS) as AuthTokenPayload;
  if (
    typeof decoded.merchantId !== 'string' ||
    typeof decoded.storeId !== 'string' ||
    typeof decoded.tv !== 'number'
  ) {
    throw new Error('Invalid token payload');
  }
  return decoded;
}

export type AuthedRequest = Request & {
  auth?: AuthTokenPayload;
};

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

export function readSessionToken(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/** HttpOnly session cookie — JWT is never exposed to frontend JavaScript. */
export function setSessionCookie(res: Response, token: string): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
    'SameSite=Lax',
  ];
  if (isProduction) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    'SameSite=Lax',
  ];
  if (isProduction) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function establishMerchantSession(res: Response, payload: AuthTokenPayload): void {
  setSessionCookie(res, signToken(payload));
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = readSessionToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication failed' });
    return;
  }
  try {
    const payload = verifyToken(token);
    const merchant = await prisma.merchant.findUnique({
      where: { id: payload.merchantId },
      select: { tokenVersion: true },
    });
    if (!merchant || merchant.tokenVersion !== payload.tv) {
      res.status(401).json({ error: 'Authentication failed' });
      return;
    }
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

export function isPasswordStrongEnough(password: unknown): boolean {
  return (
    typeof password === 'string' &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}

// Generic short-lived signed tokens for stateless server-side handoffs (OAuth `state`
// params, pending-selection tokens) — distinct from the long-lived login session token.
export function signState<T extends object>(payload: T, expiresIn: string): string {
  return jwt.sign(payload as object, JWT_SECRET, { expiresIn, algorithm: 'HS256' } as jwt.SignOptions);
}

export function verifyState<T>(token: string): T {
  return jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS) as T;
}

export function getTrustedAppOrigin(): string {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  return new URL(appUrl).origin;
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, '').toLowerCase();
}

/** Paths that must not require browser Origin/Referer (provider webhooks & OAuth redirects). */
const CSRF_EXEMPT_PREFIXES = [
  '/webhooks/',
  '/api/courier/webhook/',
  '/api/auth/google/callback',
  '/api/auth/google/connect',
  '/api/channels/facebook/callback',
  '/api/channels/facebook/connect',
  '/api/channels/shopify/callback',
  '/api/channels/shopify/connect',
  // Public, unauthenticated: trust boundary is the widgetKey, not a cookie session.
  // Requests come from arbitrary business websites, so Origin/Referer can never match APP_URL.
  '/api/widget/',
];

/**
 * Lightweight CSRF defense for cookie-authenticated merchant API calls.
 * SameSite=Lax on the session cookie plus Origin/Referer validation on unsafe methods.
 * Provider webhooks and OAuth redirects are exempt.
 */
export function requireTrustedOrigin(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  const path = req.path;
  if (CSRF_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    next();
    return;
  }

  const trusted = normalizeOrigin(getTrustedAppOrigin());
  const origin = req.headers.origin;
  if (origin && normalizeOrigin(origin) === trusted) {
    next();
    return;
  }

  const referer = req.headers.referer;
  if (referer) {
    try {
      if (normalizeOrigin(new URL(referer).origin) === trusted) {
        next();
        return;
      }
    } catch {
      // invalid referer
    }
  }

  // Development smoke tests / curl without Origin headers.
  if (!isProduction && !origin && !referer) {
    next();
    return;
  }

  res.status(403).json({ error: 'Forbidden' });
}
