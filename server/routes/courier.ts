import express from 'express';
import crypto from 'crypto';
import { prisma } from '../db';
import { requireAuth, AuthedRequest } from '../auth';
import { requireProfileComplete } from '../profileCompletion';
import { encryptSecret } from '../crypto';
import { applyCourierEvent, parsePathaoEvent, parseSteadfastEvent } from '../courierWebhooks';

type Provider = 'pathao' | 'steadfast';

const FIELDS: Record<Provider, string[]> = {
  pathao: ['clientId', 'clientSecret', 'storeId'],
  steadfast: ['apiKey', 'secretKey'],
};
const SECRET_FIELDS = new Set(['clientSecret', 'secretKey', 'apiKey']);
const MAX_LEN = 300;

interface CourierConfig {
  provider: Provider | null;
  skipped: boolean;
  credentials?: Record<string, string>;
  webhookToken?: string;
}

function readConfig(raw: unknown): CourierConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<CourierConfig>;
  return { provider: c.provider ?? null, skipped: !!c.skipped, credentials: c.credentials, webhookToken: c.webhookToken };
}

function toPublic(c: CourierConfig, base: string) {
  const token = c.webhookToken ?? null;
  const url = (p: Provider) => (token ? `${base}/api/courier/webhook/${p}/${token}` : null);
  return {
    provider: c.provider,
    connected: !!c.provider && !!c.credentials,
    skipped: c.skipped,
    webhookToken: token,
    webhookUrls: { pathao: url('pathao'), steadfast: url('steadfast') },
  };
}

const baseUrl = (req: express.Request) => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
const newToken = () => `rmln_whk_${crypto.randomBytes(12).toString('hex')}`;

export function createCourierRouter(): express.Router {
  const router = express.Router();

  const load = async (storeId: string) => {
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { courier: true } });
    return store ? readConfig(store.courier) : null;
  };
  const save = (storeId: string, c: CourierConfig) =>
    prisma.store.update({ where: { id: storeId }, data: { courier: c as any } });

  router.get('/api/courier', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const c = await load(req.auth!.storeId);
      if (!c) return res.status(404).json({ error: 'Store not found' });
      if (!c.webhookToken) {
        c.webhookToken = newToken();
        await save(req.auth!.storeId, c);
      }
      res.json(toPublic(c, baseUrl(req)));
    } catch {
      res.status(500).json({ error: 'Failed to load courier settings' });
    }
  });

  // Save a courier's API credentials (secrets are encrypted at rest and never returned)
  router.put('/api/courier', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const { provider, keys } = req.body || {};
      if (provider !== 'pathao' && provider !== 'steadfast') {
        return res.status(400).json({ error: 'Choose Pathao or Steadfast.' });
      }
      if (!keys || typeof keys !== 'object') return res.status(400).json({ error: 'Credentials are required.' });
      const credentials: Record<string, string> = {};
      for (const f of FIELDS[provider as Provider]) {
        const v = keys[f];
        if (typeof v !== 'string' || !v.trim() || v.length > MAX_LEN) {
          return res.status(400).json({ error: 'Fill in every credential field.', field: f });
        }
        credentials[f] = SECRET_FIELDS.has(f) ? encryptSecret(v.trim()) : v.trim();
      }
      const prev = await load(req.auth!.storeId);
      const next: CourierConfig = {
        provider,
        skipped: false,
        credentials,
        webhookToken: prev?.webhookToken || newToken(),
      };
      await save(req.auth!.storeId, next);
      res.json(toPublic(next, baseUrl(req)));
    } catch {
      res.status(500).json({ error: 'Failed to save courier settings' });
    }
  });

  // "I book parcels myself"
  router.post('/api/courier/skip', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const prev = await load(req.auth!.storeId);
      const next: CourierConfig = { provider: null, skipped: true, webhookToken: prev?.webhookToken };
      await save(req.auth!.storeId, next);
      res.json(toPublic(next, baseUrl(req)));
    } catch {
      res.status(500).json({ error: 'Failed to save courier settings' });
    }
  });

  router.delete('/api/courier', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const prev = await load(req.auth!.storeId);
      const next: CourierConfig = { provider: null, skipped: false, webhookToken: prev?.webhookToken };
      await save(req.auth!.storeId, next);
      res.json(toPublic(next, baseUrl(req)));
    } catch {
      res.status(500).json({ error: 'Failed to disconnect courier' });
    }
  });

  // Courier status callbacks. The token in the URL identifies the store. Pathao and
  // Steadfast tell us when a parcel is picked up / out for delivery / delivered and we move
  // the matching order (found by the invoice / merchant order id or its tracking code).
  router.post('/api/courier/webhook/:provider/:token', async (req, res) => {
    try {
      const { provider, token } = req.params;
      if (provider !== 'pathao' && provider !== 'steadfast') return res.sendStatus(404);
      const store = await prisma.store.findFirst({
        where: { courier: { path: ['webhookToken'], equals: token } },
        select: { id: true },
      });
      if (!store) return res.sendStatus(404);

      if (provider === 'steadfast') {
        const auth = req.get('authorization') || '';
        const given = Buffer.from(auth.replace(/^Bearer\s+/i, ''));
        const want = Buffer.from(token);
        if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
          return res.status(401).json({ status: 'error', message: 'Invalid token' });
        }
        await applyCourierEvent(store.id, parseSteadfastEvent(req.body));
        return res.json({ status: 'success', message: 'Webhook received successfully.' });
      }

      // Pathao proves the endpoint by echoing the integration secret it sends us.
      const secret = req.get('x-pathao-signature');
      if (secret) res.set('X-Pathao-Merchant-Webhook-Integration-Secret', secret);
      const ev = parsePathaoEvent(req.body);
      if (ev.handshake) return res.status(202).json({ received: true });
      await applyCourierEvent(store.id, ev);
      res.json({ received: true });
    } catch (err) {
      console.error('Courier webhook error:', err);
      res.sendStatus(500);
    }
  });

  return router;
}
