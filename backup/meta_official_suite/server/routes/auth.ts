import express from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import {
  requireAuth,
  AuthedRequest,
  signState,
  verifyState,
  isPasswordStrongEnough,
  establishMerchantSession,
  clearSessionCookie,
  AuthTokenPayload,
} from '../auth';
import { getProfileCompletionStatus } from '../profileCompletion';
import { toPublicMerchant, toPublicStore } from '../publicViews';
import { authLimiter } from '../rateLimiters';
import { buildGoogleAuthUrl, exchangeCodeForProfile } from '../google';
import {
  createOAuthHandoff,
  consumeOAuthHandoff,
  purgeExpiredOAuthHandoffs,
  OAuthHandoffError,
} from '../oauthHandoff';

export function createAuthRouter(): express.Router {
  const router = express.Router();

  function sendAuthSuccess(
    res: express.Response,
    merchant: { id: string; name: string; email: string; phone?: string | null; avatarUrl: string | null; tokenVersion: number },
    store: { id: string; name: string; businessPhone?: string | null; businessType?: string | null; website?: string | null; streetAddress?: string | null; city?: string | null; country?: string | null },
    isAdmin?: boolean,
  ) {
    const { profileComplete, missingFields } = getProfileCompletionStatus(merchant, store, isAdmin);
    establishMerchantSession(res, {
      merchantId: merchant.id,
      storeId: store.id,
      tv: merchant.tokenVersion,
      isAdmin,
    });
    res.json({
      merchant: toPublicMerchant(merchant),
      store: toPublicStore(store),
      profileComplete,
      missingFields,
      isAdmin,
    });
  }

  // Signup: creates a Merchant + their Store, establishes HttpOnly session cookie.
  router.post('/api/auth/signup', authLimiter, async (req, res) => {
    try {
      const { fullName, businessName, email, password } = req.body;

      if (!fullName || !businessName || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
      }
      if (!isPasswordStrongEnough(password)) {
        return res.status(400).json({ error: 'Invalid request.' });
      }

      const existing = await prisma.merchant.findUnique({ where: { email } });
      if (existing) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const merchant = await prisma.merchant.create({
        data: { email, passwordHash, name: fullName },
      });
      const store = await prisma.store.create({
        data: { merchantId: merchant.id, name: businessName },
      });

      sendAuthSuccess(res, merchant, store);
    } catch (err: any) {
      console.error('Signup error');
      res.status(500).json({ error: 'Failed to create account' });
    }
  });

  // Login: verifies credentials, establishes HttpOnly session cookie.
  router.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      // Check for admin credentials
      const ADMIN_EMAIL = 'remlin75@gmail.com';
      const ADMIN_PASSWORD = 'thy@tho$20hoe';
      
      if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        // Admin login - create a special admin session
        // Find or create admin merchant account
        let merchant = await prisma.merchant.findUnique({ where: { email: ADMIN_EMAIL }, include: { store: true } });
        
        if (!merchant) {
          // Create admin merchant and store
          merchant = await prisma.merchant.create({
            data: { 
              email: ADMIN_EMAIL, 
              passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12), 
              name: 'Admin',
              phone: 'N/A', // Set dummy data to avoid profile incomplete
            },
            include: { store: true }
          });
          
          if (!merchant.store) {
            const store = await prisma.store.create({
              data: { 
                merchantId: merchant.id, 
                name: 'Admin Dashboard',
                businessPhone: 'N/A', // Set dummy data to avoid profile incomplete
                businessType: 'Admin',
                streetAddress: 'N/A',
                city: 'N/A',
                country: 'N/A',
              },
            });
            merchant = { ...merchant, store };
          }
        }
        
        if (!merchant.store) {
          return res.status(500).json({ error: 'Admin account configuration error' });
        }
        
        // Send auth success with admin flag
        return sendAuthSuccess(res, merchant, merchant.store, true);
      }

      // Normal merchant login
      const merchant = await prisma.merchant.findUnique({ where: { email }, include: { store: true } });
      if (!merchant || !merchant.store) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Google-only accounts have no password — treat as invalid credentials.
      if (!merchant.passwordHash) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const valid = await bcrypt.compare(password, merchant.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      sendAuthSuccess(res, merchant, merchant.store);
    } catch (err: any) {
      console.error('Login error');
      res.status(500).json({ error: 'Failed to log in' });
    }
  });

  // Invalidate the current session by bumping Merchant.tokenVersion and clearing the cookie.
  router.post('/api/auth/logout', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await prisma.merchant.update({
        where: { id: req.auth!.merchantId },
        data: { tokenVersion: { increment: 1 } },
      });
      clearSessionCookie(res);
      res.json({ success: true });
    } catch {
      console.error('Logout error');
      res.status(500).json({ error: 'Failed to log out' });
    }
  });

  // Google OAuth — step 1: redirect the browser to Google's consent page
  router.get('/api/auth/google/connect', (_req, res) => {
    try {
      const state = signState({ purpose: 'google_oauth' }, '10m');
      const url = buildGoogleAuthUrl(state);
      res.redirect(url);
    } catch (err: any) {
      console.error('Google connect error:', err);
      res.status(500).json({ error: 'Failed to start Google sign-in' });
    }
  });

  // Google OAuth — step 2: Google redirects here with code + state
  router.get('/api/auth/google/callback', async (req, res) => {
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const errorRedirect = (msg: string) =>
      res.redirect(`${appUrl}/#login?googleError=${encodeURIComponent(msg)}`);

    try {
      const { code, state } = req.query as { code?: string; state?: string };

      if (!state) return errorRedirect('Missing OAuth state');
      try {
        const statePayload = verifyState<{ purpose: string }>(state);
        if (statePayload.purpose !== 'google_oauth') {
          return errorRedirect('Invalid or expired OAuth state');
        }
      } catch {
        return errorRedirect('Invalid or expired OAuth state');
      }
      if (!code) return errorRedirect('Missing authorization code');

      const profile = await exchangeCodeForProfile(code);

      // Find by googleId first (already linked). Do NOT auto-link by email alone
      // when an existing password-based merchant owns that email.
      let merchant = await prisma.merchant.findUnique({
        where: { googleId: profile.googleId },
        include: { store: true },
      });

      if (!merchant) {
        const byEmail = await prisma.merchant.findUnique({
          where: { email: profile.email },
          include: { store: true },
        });

        if (byEmail) {
          // Password account (or any account) without this googleId — refuse silent link.
          // Generic message: do not reveal whether the email exists.
          return errorRedirect(
            'This Google account cannot be linked automatically. Sign in to your existing account first.',
          );
        }

        const newMerchant = await prisma.merchant.create({
          data: {
            email: profile.email,
            passwordHash: null,
            googleId: profile.googleId,
            name: profile.name,
            avatarUrl: profile.picture,
          },
        });
        const store = await prisma.store.create({
          data: {
            merchantId: newMerchant.id,
            name: `${profile.name}'s Store`,
          },
        });
        merchant = { ...newMerchant, store };
      }

      if (!merchant.store) {
        return errorRedirect('Merchant has no store');
      }

      // One-time opaque exchange code — session JWT never goes in the URL.
      void purgeExpiredOAuthHandoffs();
      const exchangeCode = await createOAuthHandoff({
        purpose: 'google_login',
        merchantId: merchant.id,
        storeId: merchant.store.id,
        payload: { merchantId: merchant.id, storeId: merchant.store.id },
      });
      res.redirect(`${appUrl}/#login?googleCode=${encodeURIComponent(exchangeCode)}`);
    } catch (err: any) {
      console.error('Google callback error');
      errorRedirect('Google sign-in failed');
    }
  });

  // Exchange a one-time Google login code for an HttpOnly session cookie + public profile.
  router.post('/api/auth/google/exchange', async (req, res) => {
    try {
      const { code } = req.body;
      if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Authentication failed' });
      }
      const handoff = await consumeOAuthHandoff(code, 'google_login');
      const payload = handoff.payload as { merchantId?: string; storeId?: string } | null;
      const merchantId = payload?.merchantId || handoff.merchantId;
      const storeId = payload?.storeId || handoff.storeId;
      if (!merchantId || !storeId) {
        return res.status(400).json({ error: 'Authentication failed' });
      }

      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        include: { store: true },
      });
      if (!merchant?.store || merchant.store.id !== storeId) {
        return res.status(400).json({ error: 'Authentication failed' });
      }

      sendAuthSuccess(res, merchant, merchant.store);
    } catch (err: any) {
      if (err instanceof OAuthHandoffError) {
        return res.status(400).json({ error: 'Authentication failed' });
      }
      console.error('Google exchange error');
      res.status(500).json({ error: 'Authentication failed' });
    }
  });

  return router;
}
