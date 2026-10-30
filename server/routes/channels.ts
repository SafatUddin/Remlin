import express from 'express';
import { prisma } from '../db';
import { requireAuth, AuthedRequest, signState, verifyState } from '../auth';
import { requireProfileComplete } from '../profileCompletion';
import { encryptSecret, decryptSecret } from '../crypto';
import {
  getFacebookOAuthUrl,
  exchangeCodeForUserToken,
  listManagedPages,
  listWhatsAppPhoneNumbers,
  subscribePageWebhook,
  ManagedPage,
} from '../meta';
import {
  verifyShopifyStore,
  fetchShopifyProducts,
  getShopifyOAuthUrl,
  verifyShopifyCallbackHmac,
  exchangeShopifyCodeForToken,
} from '../shopify';
import { verifyWooCommerceStore, fetchWooCommerceProducts, normalizeWooUrl } from '../woocommerce';
import {
  createOAuthHandoff,
  consumeOAuthHandoff,
  peekOAuthHandoff,
  purgeExpiredOAuthHandoffs,
  OAuthHandoffError,
} from '../oauthHandoff';
import {
  assertChannelExternalIdAvailable,
  ChannelOwnershipError,
  isChannelOwnershipError,
  isUniqueConstraintError,
  CHANNEL_ALREADY_CONNECTED_MESSAGE,
} from '../channelSecurity';
import { disconnectWhatsApp } from '../channels/whatsapp';
import { CHANNEL_TYPE_TO_FRONTEND } from '../publicViews';
import { assertCatalogSourceAvailable, getCatalogSource, isCatalogSource, setCatalogSource } from '../catalogSource';

export function createChannelsRouter(): express.Router {
  const router = express.Router();

  function getFacebookRedirectUri(): string {
    return `${process.env.APP_URL}/api/channels/facebook/callback`;
  }

  function getShopifyRedirectUri(): string {
    return `${process.env.APP_URL}/api/channels/shopify/callback`;
  }

  async function finalizeFacebookConnection(storeId: string, page: ManagedPage) {
    await assertChannelExternalIdAvailable('FACEBOOK', page.id, storeId);
    if (page.instagram_business_account?.id) {
      await assertChannelExternalIdAvailable('INSTAGRAM', page.instagram_business_account.id, storeId);
    }

    const credentials = { token: encryptSecret(page.access_token), name: page.name };
    try {
      await prisma.channel.upsert({
        where: { storeId_type: { storeId, type: 'FACEBOOK' } },
        update: { connected: true, externalId: page.id, credentials },
        create: { storeId, type: 'FACEBOOK', connected: true, externalId: page.id, credentials },
      });

      if (page.instagram_business_account?.id) {
        const igId = page.instagram_business_account.id;
        const igCredentials = { token: encryptSecret(page.access_token), name: `@${page.name}` };
        await prisma.channel.upsert({
          where: { storeId_type: { storeId, type: 'INSTAGRAM' } },
          update: { connected: true, externalId: igId, credentials: igCredentials },
          create: { storeId, type: 'INSTAGRAM', connected: true, externalId: igId, credentials: igCredentials },
        });
      }
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ChannelOwnershipError();
      }
      throw err;
    }

    try {
      await subscribePageWebhook(page.id, page.access_token);
    } catch (err) {
      console.error('Failed to auto-subscribe Facebook Page webhook');
    }
  }

  async function finalizeWhatsAppConnection(storeId: string, numberObj: { id: string; display_phone_number: string; token: string }) {
    await assertChannelExternalIdAvailable('WHATSAPP', numberObj.id, storeId);

    const credentials = {
      token: encryptSecret(numberObj.token),
      phoneNumberId: numberObj.id,
      phoneNumber: numberObj.display_phone_number,
    };
    try {
      await prisma.channel.upsert({
        where: { storeId_type: { storeId, type: 'WHATSAPP' } },
        update: { connected: true, externalId: numberObj.id, credentials },
        create: { storeId, type: 'WHATSAPP', connected: true, externalId: numberObj.id, credentials },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ChannelOwnershipError();
      }
      throw err;
    }
  }

  function normalizeShopifyDomain(domain: string): string {
    return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  // List this store's real channel connections (Facebook & WhatsApp)
  router.get('/api/channels', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const channels = await prisma.channel.findMany({ where: { storeId: req.auth!.storeId } });
      res.json(channels.map((c) => ({
        type: CHANNEL_TYPE_TO_FRONTEND[c.type] || c.type.toLowerCase(),
        connected: c.connected,
        name: (c.credentials as any)?.name || (c.credentials as any)?.phoneNumber || (c.credentials as any)?.phoneNumberId || null,
      })));
    } catch (err: any) {
      console.error('List channels error:', err);
      res.status(500).json({ error: 'Failed to load channels' });
    }
  });

  // Disconnect a channel
  router.delete('/api/channels/:type', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const type = req.params.type.toUpperCase();
      if (type === 'WHATSAPP') await disconnectWhatsApp(req.auth!.storeId);
      await prisma.channel.updateMany({
        where: { storeId: req.auth!.storeId, type: type as any },
        data: { connected: false, credentials: null, externalId: null },
      });
      if (type === 'SHOPIFY' || type === 'WOOCOMMERCE') {
        await prisma.store.update({ where: { id: req.auth!.storeId }, data: { catalogSource: 'CUSTOM' } });
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error('Disconnect channel error:', err);
      res.status(500).json({ error: 'Failed to disconnect channel' });
    }
  });

  router.get('/api/catalog/source', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    res.json({ catalogSource: await getCatalogSource(req.auth!.storeId) });
  });

  router.put('/api/catalog/source', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    const source = req.body?.catalogSource;
    if (!isCatalogSource(source)) return res.status(400).json({ error: 'Invalid catalog source.' });
    try {
      await setCatalogSource(req.auth!.storeId, source);
      res.json({ catalogSource: source });
    } catch (err: any) {
      if (String(err?.message).startsWith('CATALOG_SOURCE_CONNECTED:')) {
        return res.status(409).json({ error: 'Disconnect the current catalog connector before choosing another source.' });
      }
      res.status(500).json({ error: 'Unable to change catalog source.' });
    }
  });

  // Connect WhatsApp Business Cloud API with Phone Number ID and Access Token
  router.post('/api/channels/whatsapp/connect', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const { phoneNumberId, accessToken, phoneNumber } = req.body;
      if (!phoneNumberId || !accessToken) {
        return res.status(400).json({ error: 'Phone Number ID and Access Token are required' });
      }

      await assertChannelExternalIdAvailable('WHATSAPP', String(phoneNumberId), req.auth!.storeId);

      const credentials = {
        token: encryptSecret(accessToken),
        phoneNumberId,
        phoneNumber: phoneNumber || null,
      };

      await prisma.channel.upsert({
        where: { storeId_type: { storeId: req.auth!.storeId, type: 'WHATSAPP' } },
        update: { connected: true, externalId: String(phoneNumberId), credentials },
        create: { storeId: req.auth!.storeId, type: 'WHATSAPP', connected: true, externalId: String(phoneNumberId), credentials },
      });

      res.json({ success: true });
    } catch (err: any) {
      if (isChannelOwnershipError(err) || isUniqueConstraintError(err)) {
        return res.status(409).json({ error: CHANNEL_ALREADY_CONNECTED_MESSAGE });
      }
      console.error('Connect WhatsApp channel error');
      res.status(500).json({ error: 'Failed to connect WhatsApp channel' });
    }
  });

  // Enable the website chat widget. No external OAuth/credentials — the store's
  // pre-existing widgetKey (unique, auto-generated at Store creation) is the whole
  // identity. Connecting just flips the Channel row on so /api/widget/* will respond
  // and the conversation shows up in the Inbox (visibleConversations gates on this).
  router.post('/api/channels/widget/connect', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const store = await prisma.store.findUnique({ where: { id: req.auth!.storeId } });
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }

      await prisma.channel.upsert({
        where: { storeId_type: { storeId: req.auth!.storeId, type: 'WIDGET' } },
        update: { connected: true },
        create: { storeId: req.auth!.storeId, type: 'WIDGET', connected: true },
      });

      res.json({ success: true, widgetKey: store.widgetKey });
    } catch (err: any) {
      console.error('Connect widget channel error');
      res.status(500).json({ error: 'Failed to connect website widget' });
    }
  });

  // Connect a Shopify store via a merchant-supplied custom-app Admin API access
  // token (not a public OAuth app — see docs/SHOPIFY_SETUP.md). Verifies the credentials
  // actually work against the real store before saving anything.
  router.post('/api/channels/shopify/connect', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const { domain, accessToken } = req.body;
      if (!domain || !accessToken) {
        return res.status(400).json({ error: 'Store domain and Admin API access token are required' });
      }

      await assertCatalogSourceAvailable(req.auth!.storeId, 'SHOPIFY');

      const shop = await verifyShopifyStore(domain, accessToken);
      const normalizedDomain = normalizeShopifyDomain(domain);
      await assertChannelExternalIdAvailable('SHOPIFY', normalizedDomain, req.auth!.storeId);

      const credentials = {
        token: encryptSecret(accessToken),
        domain: normalizedDomain,
        name: shop.name,
      };

      await prisma.channel.upsert({
        where: { storeId_type: { storeId: req.auth!.storeId, type: 'SHOPIFY' } },
        update: { connected: true, externalId: normalizedDomain, credentials },
        create: { storeId: req.auth!.storeId, type: 'SHOPIFY', connected: true, externalId: normalizedDomain, credentials },
      });
      await setCatalogSource(req.auth!.storeId, 'SHOPIFY');

      res.json({ success: true, name: shop.name });
    } catch (err: any) {
      if (isChannelOwnershipError(err) || isUniqueConstraintError(err)) {
        return res.status(409).json({ error: CHANNEL_ALREADY_CONNECTED_MESSAGE });
      }
      console.error('Connect Shopify channel error');
      res.status(400).json({ error: 'Unable to connect integration' });
    }
  });

  // Connect a WooCommerce store via Consumer Key & Consumer Secret
  router.post('/api/channels/woocommerce/connect', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const { url, consumerKey, consumerSecret } = req.body;
      if (!url || !consumerKey || !consumerSecret) {
        return res.status(400).json({ error: 'Store URL, Consumer Key, and Consumer Secret are required' });
      }

      await assertCatalogSourceAvailable(req.auth!.storeId, 'WOOCOMMERCE');

      const shop = await verifyWooCommerceStore(url, consumerKey, consumerSecret);
      const normalizedUrl = normalizeWooUrl(url);
      await assertChannelExternalIdAvailable('WOOCOMMERCE', normalizedUrl, req.auth!.storeId);

      const credentials = {
        consumerKey: encryptSecret(consumerKey.trim()),
        consumerSecret: encryptSecret(consumerSecret.trim()),
        url: normalizedUrl,
        name: shop.name,
      };

      await prisma.channel.upsert({
        where: { storeId_type: { storeId: req.auth!.storeId, type: 'WOOCOMMERCE' } },
        update: { connected: true, externalId: normalizedUrl, credentials },
        create: { storeId: req.auth!.storeId, type: 'WOOCOMMERCE', connected: true, externalId: normalizedUrl, credentials },
      });
      await setCatalogSource(req.auth!.storeId, 'WOOCOMMERCE');

      res.json({ success: true, name: shop.name });
    } catch (err: any) {
      if (isChannelOwnershipError(err) || isUniqueConstraintError(err)) {
        return res.status(409).json({ error: CHANNEL_ALREADY_CONNECTED_MESSAGE });
      }
      console.error('Connect WooCommerce channel error:', err?.message || err);
      res.status(400).json({ error: err?.message || 'Unable to connect WooCommerce store' });
    }
  });

  // Pulls latest products from connected WooCommerce store and upserts into product catalog
  router.post('/api/channels/woocommerce/sync', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const channel = await prisma.channel.findUnique({
        where: { storeId_type: { storeId: req.auth!.storeId, type: 'WOOCOMMERCE' } },
      });
      if ((await getCatalogSource(req.auth!.storeId)) !== 'WOOCOMMERCE') {
        return res.status(409).json({ error: 'Select WooCommerce as the catalog source before syncing.' });
      }
      if (!channel?.connected || !channel.credentials) {
        return res.status(400).json({ error: 'WooCommerce is not connected' });
      }

      const { consumerKey, consumerSecret, url } = channel.credentials as { consumerKey: string; consumerSecret: string; url: string };
      const ck = decryptSecret(consumerKey);
      const cs = decryptSecret(consumerSecret);
      const wooProducts = await fetchWooCommerceProducts(url, ck, cs);

      let created = 0;
      let updated = 0;
      for (const p of wooProducts) {
        const existing = await prisma.product.findUnique({
          where: { storeId_sku: { storeId: req.auth!.storeId, sku: p.sku } },
        });
        if (existing) {
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              name: p.name,
              price: p.price,
              inventory: p.inventory,
              externalId: p.externalId,
              ...(p.description !== undefined ? { description: p.description } : {}),
              ...(p.imageUrl !== undefined ? { imageUrl: p.imageUrl } : {}),
              ...(p.rawAttributes !== undefined ? { rawAttributes: p.rawAttributes } : {}),
            },
          });
          updated++;
        } else {
          await prisma.product.create({
            data: {
              storeId: req.auth!.storeId,
              name: p.name,
              sku: p.sku,
              price: p.price,
              inventory: p.inventory,
              externalId: p.externalId,
              description: p.description || null,
              imageUrl: p.imageUrl || null,
              rawAttributes: p.rawAttributes || null,
              status: 'TRAINED',
            },
          });
          created++;
        }
      }

      res.json({ success: true, created, updated, total: wooProducts.length });
    } catch (err: any) {
      console.error('WooCommerce sync error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Unable to sync WooCommerce products' });
    }
  });

  // Pulls the latest products from the connected Shopify store and upserts them into
  // this store's catalog, matching on SKU. A manual action (button click), not a
  // background job — simplest thing that works for a beta-scale catalog.
  router.post('/api/channels/shopify/sync', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const channel = await prisma.channel.findUnique({
        where: { storeId_type: { storeId: req.auth!.storeId, type: 'SHOPIFY' } },
      });
      if ((await getCatalogSource(req.auth!.storeId)) !== 'SHOPIFY') {
        return res.status(409).json({ error: 'Select Shopify as the catalog source before syncing.' });
      }
      if (!channel?.connected || !channel.credentials) {
        return res.status(400).json({ error: 'Shopify is not connected' });
      }

      const { token, domain } = channel.credentials as { token: string; domain: string };
      const accessToken = decryptSecret(token);
      const shopifyProducts = await fetchShopifyProducts(domain, accessToken);

      let created = 0;
      let updated = 0;
      for (const p of shopifyProducts) {
        const existing = await prisma.product.findUnique({
          where: { storeId_sku: { storeId: req.auth!.storeId, sku: p.sku } },
        });
        if (existing) {
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              name: p.name,
              price: p.price,
              inventory: p.inventory,
              externalId: p.externalId,
              ...(p.description !== undefined ? { description: p.description } : {}),
              ...(p.imageUrl !== undefined ? { imageUrl: p.imageUrl } : {}),
              ...(p.rawAttributes !== undefined ? { rawAttributes: p.rawAttributes } : {}),
            },
          });
          updated++;
        } else {
          await prisma.product.create({
            data: {
              storeId: req.auth!.storeId,
              name: p.name,
              sku: p.sku,
              price: p.price,
              inventory: p.inventory,
              externalId: p.externalId,
              description: p.description || null,
              imageUrl: p.imageUrl || null,
              rawAttributes: p.rawAttributes || null,
              status: 'TRAINED',
            },
          });
          created++;
        }
      }

      res.json({ success: true, created, updated, total: shopifyProducts.length });
    } catch (err: any) {
      console.error('Shopify sync error:', err);
      res.status(500).json({ error: 'Unable to connect integration' });
    }
  });

  // Mint a short-lived opaque Shopify connect code (session JWT never goes in the URL).
  router.post('/api/channels/shopify/prepare', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const domain = typeof req.body?.domain === 'string' ? req.body.domain.trim() : '';
      if (!domain) {
        return res.status(400).json({ error: 'Store domain is required' });
      }
      void purgeExpiredOAuthHandoffs();
      const code = await createOAuthHandoff({
        purpose: 'shopify_connect',
        storeId: req.auth!.storeId,
        merchantId: req.auth!.merchantId,
        payload: { domain },
      });
      res.json({ code });
    } catch (err) {
      console.error('Shopify prepare error');
      res.status(500).json({ error: 'Unable to connect integration' });
    }
  });

  // Start the Shopify OAuth flow using a one-time opaque connect code.
  router.get('/api/channels/shopify/connect', async (req, res) => {
    try {
      const code = req.query.code as string;
      if (!code) return res.status(401).send('Missing connect code');
      const handoff = await consumeOAuthHandoff(code, 'shopify_connect');
      const domain = (handoff.payload as { domain?: string } | null)?.domain;
      if (!handoff.storeId || !domain) {
        return res.status(400).send('Invalid connect code');
      }

      const state = signState({ storeId: handoff.storeId, purpose: 'shopify_oauth' }, '10m');
      const url = getShopifyOAuthUrl(domain, getShopifyRedirectUri(), state);
      res.redirect(url);
    } catch (err) {
      console.error('Shopify connect error');
      res.status(401).send('Invalid or expired session. Please log in again and retry.');
    }
  });

  // Shopify redirects here after the merchant approves (or denies) access.
  router.get('/api/channels/shopify/callback', async (req, res) => {
    const frontendBase = process.env.APP_URL || '';
    try {
      const { code, state, shop, error: oauthError } = req.query as {
        code?: string; state?: string; shop?: string; error?: string;
      };
      if (oauthError || !code || !state || !shop) {
        return res.redirect(`${frontendBase}/#integrations?shopifyError=denied`);
      }
      if (!verifyShopifyCallbackHmac(req.query as Record<string, string>)) {
        return res.redirect(`${frontendBase}/#integrations?shopifyError=invalid_signature`);
      }

      const statePayload = verifyState<{ storeId: string; purpose?: string }>(state);
      if (statePayload.purpose && statePayload.purpose !== 'shopify_oauth') {
        return res.redirect(`${frontendBase}/#integrations?shopifyError=denied`);
      }
      const { storeId } = statePayload;
      const accessToken = await exchangeShopifyCodeForToken(shop, code);
      const shopInfo = await verifyShopifyStore(shop, accessToken);
      const normalizedDomain = normalizeShopifyDomain(shop);

      await assertChannelExternalIdAvailable('SHOPIFY', normalizedDomain, storeId);

      const credentials = {
        token: encryptSecret(accessToken),
        domain: normalizedDomain,
        name: shopInfo.name,
      };
      try {
        await prisma.channel.upsert({
          where: { storeId_type: { storeId, type: 'SHOPIFY' } },
          update: { connected: true, externalId: normalizedDomain, credentials },
          create: { storeId, type: 'SHOPIFY', connected: true, externalId: normalizedDomain, credentials },
        });
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          return res.redirect(`${frontendBase}/#integrations?shopifyError=already_connected`);
        }
        throw err;
      }

      return res.redirect(`${frontendBase}/#integrations?shopifyConnected=1`);
    } catch (err) {
      if (isChannelOwnershipError(err)) {
        return res.redirect(`${frontendBase}/#integrations?shopifyError=already_connected`);
      }
      console.error('Shopify OAuth callback error');
      res.redirect(`${frontendBase}/#integrations?shopifyError=server_error`);
    }
  });

  // Mint a short-lived opaque Facebook connect code (session JWT never goes in the URL).
  router.post('/api/channels/facebook/prepare', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      void purgeExpiredOAuthHandoffs();
      const code = await createOAuthHandoff({
        purpose: 'facebook_connect',
        storeId: req.auth!.storeId,
        merchantId: req.auth!.merchantId,
      });
      res.json({ code });
    } catch (err) {
      console.error('Facebook prepare error');
      res.status(500).json({ error: 'Unable to connect integration' });
    }
  });

  // Start the Facebook OAuth flow using a one-time opaque connect code.
  router.get('/api/channels/facebook/connect', async (req, res) => {
    try {
      const code = req.query.code as string;
      if (!code) return res.status(401).send('Missing connect code');
      const handoff = await consumeOAuthHandoff(code, 'facebook_connect');
      if (!handoff.storeId) {
        return res.status(400).send('Invalid connect code');
      }

      const state = signState({ storeId: handoff.storeId, purpose: 'facebook_oauth' }, '10m');
      const url = getFacebookOAuthUrl(getFacebookRedirectUri(), state);
      res.redirect(url);
    } catch (err) {
      console.error('Facebook connect error');
      res.status(401).send('Invalid or expired session. Please log in again and retry.');
    }
  });

  // Meta redirects here after the merchant approves (or denies) access.
  router.get('/api/channels/facebook/callback', async (req, res) => {
    const frontendBase = process.env.APP_URL || '';
    try {
      const { code, state, error: oauthError } = req.query as { code?: string; state?: string; error?: string };
      if (oauthError || !code || !state) {
        return res.redirect(`${frontendBase}/#integrations?fbError=denied`);
      }

      const statePayload = verifyState<{ storeId: string; purpose?: string }>(state);
      if (statePayload.purpose && statePayload.purpose !== 'facebook_oauth') {
        return res.redirect(`${frontendBase}/#integrations?fbError=denied`);
      }
      const { storeId } = statePayload;
      const redirectUri = getFacebookRedirectUri();
      const userAccessToken = await exchangeCodeForUserToken(code, redirectUri);

      const pages = await listManagedPages(userAccessToken);
      if (pages.length === 1) {
        await finalizeFacebookConnection(storeId, pages[0]);
      }

      // Multi-select: store provider tokens server-side; browser only gets an opaque pending code.
      if (pages.length > 1) {
        const pendingCode = await createOAuthHandoff({
          purpose: 'facebook_pending',
          storeId,
          payload: { pages },
        });
        return res.redirect(`${frontendBase}/#integrations?fbPending=${encodeURIComponent(pendingCode)}`);
      }

      if (pages.length === 0) {
        return res.redirect(`${frontendBase}/#integrations?fbError=no_pages`);
      }

      return res.redirect(`${frontendBase}/#integrations?fbConnected=1`);
    } catch (err) {
      if (isChannelOwnershipError(err)) {
        return res.redirect(`${frontendBase}/#integrations?fbError=already_connected`);
      }
      console.error('Meta OAuth callback error:', err instanceof Error ? err.message : 'unknown');
      res.redirect(`${frontendBase}/#integrations?fbError=server_error`);
    }
  });

  // Returns candidate WhatsApp phone numbers for multi-number selection (no tokens).
  router.get('/api/channels/whatsapp/pending', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const pendingCode = (req.query.code || req.query.token) as string;
      const handoff = await peekOAuthHandoff(pendingCode, 'whatsapp_pending');
      if (handoff.storeId !== req.auth!.storeId) {
        return res.status(403).json({ error: 'Unable to process request' });
      }
      const numbers = ((handoff.payload as { numbers?: any[] } | null)?.numbers) || [];
      res.json({
        numbers: numbers.map((n) => ({
          id: n.id,
          display_phone_number: n.display_phone_number,
          name: n.name,
        })),
      });
    } catch (err) {
      res.status(400).json({ error: 'Invalid or expired selection. Please reconnect.' });
    }
  });

  // Finalizes WhatsApp connection after merchant picks a number
  router.post('/api/channels/whatsapp/select', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const pendingCode = (req.body.pendingCode || req.body.pendingToken) as string;
      const { phoneNumberId } = req.body;
      // Verify ownership before consuming — otherwise a mismatched-store request burns
      // another store's still-valid pending selection (a one-shot DoS against it).
      const peeked = await peekOAuthHandoff(pendingCode, 'whatsapp_pending');
      if (peeked.storeId !== req.auth!.storeId) {
        return res.status(403).json({ error: 'Unable to process request' });
      }
      const handoff = await consumeOAuthHandoff(pendingCode, 'whatsapp_pending');
      const numbers = ((handoff.payload as { numbers?: any[] } | null)?.numbers) || [];
      const num = numbers.find((n) => n.id === phoneNumberId);
      if (!num) {
        return res.status(404).json({ error: 'Phone number not found in this selection' });
      }
      await finalizeWhatsAppConnection(handoff.storeId!, num);
      res.json({ success: true });
    } catch (err) {
      if (isChannelOwnershipError(err) || isUniqueConstraintError(err)) {
        return res.status(409).json({ error: CHANNEL_ALREADY_CONNECTED_MESSAGE });
      }
      console.error('WhatsApp number selection error');
      res.status(400).json({ error: 'Invalid or expired selection. Please reconnect.' });
    }
  });

  // Returns the candidate Pages for a pending multi-page selection (names only).
  router.get('/api/channels/facebook/pending', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const pendingCode = (req.query.code || req.query.token) as string;
      const handoff = await peekOAuthHandoff(pendingCode, 'facebook_pending');
      if (handoff.storeId !== req.auth!.storeId) {
        return res.status(403).json({ error: 'Unable to process request' });
      }
      const pages = ((handoff.payload as { pages?: ManagedPage[] } | null)?.pages) || [];
      res.json({ pages: pages.map((p) => ({ id: p.id, name: p.name })) });
    } catch (err) {
      res.status(400).json({ error: 'Invalid or expired selection. Please reconnect.' });
    }
  });

  // Finalizes the connection once the merchant picks a Page from the multi-page list.
  router.post('/api/channels/facebook/select', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const pendingCode = (req.body.pendingCode || req.body.pendingToken) as string;
      const { pageId } = req.body;
      // Verify ownership before consuming — otherwise a mismatched-store request burns
      // another store's still-valid pending selection (a one-shot DoS against it).
      const peeked = await peekOAuthHandoff(pendingCode, 'facebook_pending');
      if (peeked.storeId !== req.auth!.storeId) {
        return res.status(403).json({ error: 'Unable to process request' });
      }
      const handoff = await consumeOAuthHandoff(pendingCode, 'facebook_pending');
      const pages = ((handoff.payload as { pages?: ManagedPage[] } | null)?.pages) || [];
      const page = pages.find((p) => p.id === pageId);
      if (!page) {
        return res.status(404).json({ error: 'Page not found in this selection' });
      }
      await finalizeFacebookConnection(handoff.storeId!, page);
      res.json({ success: true });
    } catch (err) {
      if (isChannelOwnershipError(err) || isUniqueConstraintError(err)) {
        return res.status(409).json({ error: CHANNEL_ALREADY_CONNECTED_MESSAGE });
      }
      console.error('Facebook page selection error');
      res.status(400).json({ error: 'Invalid or expired selection. Please reconnect.' });
    }
  });

  return router;
}
