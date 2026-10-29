// WhatsApp connection by QR code (linked device). Facebook and Instagram use the official Meta flow.
import express from 'express';
import { requireAuth, AuthedRequest } from '../auth';
import { requireProfileComplete } from '../profileCompletion';
import { isChannelOwnershipError, CHANNEL_ALREADY_CONNECTED_MESSAGE } from '../channelSecurity';
import { getWhatsAppState, startWhatsApp, disconnectWhatsApp } from '../channels/whatsapp';

export function createLocalChannelsRouter(): express.Router {
  const router = express.Router();
  const guard = [requireAuth, requireProfileComplete];

  router.post('/api/channels/local/whatsapp/start', ...guard, async (req: AuthedRequest, res) => {
    try {
      await startWhatsApp(req.auth!.storeId);
      res.json(getWhatsAppState(req.auth!.storeId));
    } catch (err: any) {
      if (isChannelOwnershipError(err)) return res.status(409).json({ error: CHANNEL_ALREADY_CONNECTED_MESSAGE });
      console.error('WhatsApp start failed:', err?.message);
      res.status(400).json({ error: err?.message || 'WhatsApp start failed' });
    }
  });

  router.get('/api/channels/local/whatsapp/status', ...guard, (req: AuthedRequest, res) => {
    res.json(getWhatsAppState(req.auth!.storeId));
  });

  router.post('/api/channels/local/whatsapp/disconnect', ...guard, async (req: AuthedRequest, res) => {
    await disconnectWhatsApp(req.auth!.storeId).catch(() => undefined);
    res.json({ success: true });
  });

  return router;
}
