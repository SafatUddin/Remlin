import express from 'express';
import { prisma } from '../db';
import { requireAuth, AuthedRequest } from '../auth';
import { requireProfileComplete } from '../profileCompletion';
import { aiLimiter } from '../rateLimiters';
import {
  CHANNEL_TO_PLATFORM,
  FRONTEND_TO_STATUS,
  toPublicConversation,
} from '../publicViews';
import {
  sanitizeCartInput,
  validateCartSkusInStore,
  conversationPatchHasOnlyAllowedKeys,
} from '../inputValidation';
import {
  sendMessengerMessage,
  sendMessengerImage,
  sendWhatsAppMessage,
  sendWhatsAppImage,
  sendInstagramMessage,
  sendInstagramImage,
} from '../meta';
import { generateAgentReply } from '../agent';
import { getProductCurrency } from '../../shared/currency';
import { resolveProductName } from '../../shared/catalogColumns';
import { localChatImagePath } from '../mediaStorage';
import {
  getPageAccessTokenForStore,
  getWhatsAppCredentialsForStore,
  getInstagramCredentialsForStore,
  selectRelevantCatalog,
  generateAndStoreAgentReply,
} from '../conversationEngine';
import { deliverChannelMessage } from '../channels/outbound';

const isProduction = process.env.NODE_ENV === 'production';

const inboxMessageSelect = {
  id: true,
  sender: true,
  text: true,
  imageUrl: true,
  audioUrl: true,
  transcript: true,
  mediaType: true,
  pending: true,
  createdAt: true,
} as const;

export function createConversationsRouter(): express.Router {
  const router = express.Router();

  // Customer chat photos saved on local disk (dev setups without Supabase Storage).
  // Only the store that owns the conversation can load them.
  router.get('/api/media/chat/:storeId/:file', requireAuth, (req: AuthedRequest, res) => {
    const filePath = req.params.storeId === req.auth!.storeId ? localChatImagePath(req.params.storeId, req.params.file) : null;
    if (!filePath) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.sendStatus(404);
    });
  });

  // Derived, real-time notifications: unread/complaint conversations + low-stock products.
  // Computed on the fly rather than stored, since these all resolve naturally elsewhere
  // (opening a conversation marks it read; restocking a product clears its low-stock alert).
  router.get('/api/notifications', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const storeId = req.auth!.storeId;
      const [conversations, lowStockProducts] = await Promise.all([
        prisma.conversation.findMany({
          where: { storeId },
          include: { messages: { select: inboxMessageSelect, orderBy: { createdAt: 'desc' }, take: 1 } },
          orderBy: { lastMessageAt: 'desc' },
          take: 20,
        }),
        prisma.product.findMany({ where: { storeId, inventory: { lt: 10 } }, orderBy: { inventory: 'asc' } }),
      ]);

      const notifications: any[] = [];

      for (const c of conversations) {
        const last = c.messages[0];
        if (last && last.sender === 'CUSTOMER') {
          notifications.push({
            id: `msg-${c.id}`,
            type: 'message',
            title: c.isComplaint ? 'Complaint Needs Attention' : 'New Message',
            body: `${c.customerName || 'A customer'}: "${last.text.slice(0, 60)}"`,
            time: last.createdAt,
            platform: CHANNEL_TO_PLATFORM[c.channelType] || 'websocket',
          });
        }
      }

      for (const p of lowStockProducts) {
        notifications.push({
          id: `stock-${p.id}`,
          type: 'inventory',
          title: 'Inventory Alert',
          body: `${p.name} is running low (${p.inventory} unit${p.inventory === 1 ? '' : 's'} left)`,
          time: null,
          platform: 'system',
        });
      }

      notifications.sort((a, b) => {
        if (!a.time) return 1;
        if (!b.time) return -1;
        return new Date(b.time).getTime() - new Date(a.time).getTime();
      });

      res.json(notifications.slice(0, 15));
    } catch (err: any) {
      console.error('Fetch notifications error:', err);
      res.status(500).json({ error: 'Failed to load notifications' });
    }
  });

  // List this store's conversations across all channels
  router.get('/api/conversations', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const conversations = await prisma.conversation.findMany({
        where: { storeId: req.auth!.storeId },
        include: {
          // Keep the inbox readable while the additive voice-message migration is
          // waiting for deployment on a shared database.
          messages: {
            select: inboxMessageSelect,
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
      });
      res.json(conversations.map(toPublicConversation));
    } catch (err: any) {
      console.error('List conversations error:', err);
      res.status(500).json({ error: 'Failed to load conversations' });
    }
  });

  // Update a conversation's status (AI Managed / Active / Closed) or cart
  router.patch('/api/conversations/:id', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      if (!conversationPatchHasOnlyAllowedKeys(req.body)) {
        return res.status(400).json({ error: 'Invalid request.' });
      }

      const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
      if (!conversation || conversation.storeId !== req.auth!.storeId) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const { status, cart, isComplaint, isArchived, isSpam } = req.body;
      const dataToUpdate: {
        status?: 'AI_MANAGED' | 'ACTIVE' | 'CLOSED';
        cart?: { sku: string; quantity: number }[];
        isComplaint?: boolean;
        isArchived?: boolean;
        isSpam?: boolean;
      } = {};

      if (status) {
        const mappedStatus = FRONTEND_TO_STATUS[status] as 'AI_MANAGED' | 'ACTIVE' | 'CLOSED' | undefined;
        if (!mappedStatus) {
          return res.status(400).json({ error: 'Invalid status' });
        }
        dataToUpdate.status = mappedStatus;
      }

      if (cart !== undefined) {
        const sanitizedCart = sanitizeCartInput(cart);
        if (sanitizedCart === null) {
          return res.status(400).json({ error: 'Invalid cart data.' });
        }
        if (sanitizedCart.length > 0) {
          const storeProducts = await prisma.product.findMany({
            where: { storeId: req.auth!.storeId },
            select: { sku: true },
          });
          const storeSkus = new Set(storeProducts.map((p) => p.sku));
          if (!validateCartSkusInStore(sanitizedCart, storeSkus)) {
            return res.status(400).json({ error: 'Invalid cart data.' });
          }
        }
        dataToUpdate.cart = sanitizedCart;
      }

      if (isComplaint !== undefined) {
        dataToUpdate.isComplaint = Boolean(isComplaint);
      }

      if (isArchived !== undefined) {
        dataToUpdate.isArchived = Boolean(isArchived);
      }

      if (isSpam !== undefined) {
        dataToUpdate.isSpam = Boolean(isSpam);
      }

      if (Object.keys(dataToUpdate).length === 0) {
        return res.status(400).json({ error: 'Invalid request.' });
      }

      const updated = await prisma.conversation.update({
        where: { id: conversation.id },
        data: dataToUpdate,
        include: { messages: { select: inboxMessageSelect, orderBy: { createdAt: 'asc' } } },
      });
      res.json(toPublicConversation(updated));
    } catch (err: any) {
      console.error('Update conversation error:', err);
      res.status(500).json({ error: 'Failed to update conversation' });
    }
  });

  // Delete a conversation
  router.delete('/api/conversations/:id', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
      if (!conversation || conversation.storeId !== req.auth!.storeId) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Delete associated messages first then conversation
      await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
      await prisma.conversation.delete({ where: { id: conversation.id } });

      res.json({ success: true });
    } catch (err: any) {
      console.error('Delete conversation error:', err);
      res.status(500).json({ error: 'Failed to delete conversation' });
    }
  });

  // Sends a message into a conversation. `sender: 'merchant'` posts the merchant's own
  // reply (delivered to the real customer via the channel adapter when applicable, e.g.
  // Facebook Messenger); omitting it (or 'customer') simulates an incoming customer
  // message for demo/testing channels that have no real external customer, and triggers
  // an AI reply if the conversation is AI-managed.
  router.post('/api/conversations/:id/messages', requireAuth, requireProfileComplete, aiLimiter, async (req: AuthedRequest, res) => {
    if (!isProduction) {
      console.log('[ROUTE] POST /api/conversations/:id/messages — id:', req.params.id, '| sender:', req.body?.sender);
    }
    try {
      const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
      if (!conversation || conversation.storeId !== req.auth!.storeId) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const { text, sender, discardDraftId } = req.body;
      if (!text) {
        return res.status(400).json({ error: 'Message text is required' });
      }

      if (sender === 'merchant') {
        if (discardDraftId) {
          // Merchant edited an AI draft before sending — remove the superseded draft
          // rather than leaving a stale unsent card sitting in the thread.
          await prisma.message.deleteMany({ where: { id: discardDraftId, conversationId: conversation.id, pending: true } });
        }

        await prisma.message.create({ data: { conversationId: conversation.id, sender: 'MERCHANT', text } });
        await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

        if (await deliverChannelMessage(conversation, text)) {
          // WhatsApp: delivered through the linked-device (QR) session
        } else if (conversation.channelType === 'FACEBOOK' && conversation.externalUserId) {
          const pageAccessToken = await getPageAccessTokenForStore(conversation.storeId);
          if (pageAccessToken) {
            try {
              await sendMessengerMessage(pageAccessToken, conversation.externalUserId, text);
            } catch (err) {
              console.error('Failed to deliver merchant reply to Messenger:', err);
            }
          }
        }

        else if (conversation.channelType === 'WHATSAPP' && conversation.externalUserId) {
          const waCreds = await getWhatsAppCredentialsForStore(conversation.storeId);
          if (waCreds) {
            try {
              await sendWhatsAppMessage(waCreds.phoneNumberId, waCreds.accessToken, conversation.externalUserId, text);
            } catch (err) {
              console.error('Failed to deliver merchant reply to WhatsApp:', err);
            }
          }
        }

        else if (conversation.channelType === 'INSTAGRAM' && conversation.externalUserId) {
          const igCreds = await getInstagramCredentialsForStore(conversation.storeId);
          if (igCreds) {
            try {
              await sendInstagramMessage(igCreds.igAccountId, igCreds.accessToken, conversation.externalUserId, text);
            } catch (err) {
              console.error('Failed to deliver merchant reply to Instagram:', err);
            }
          }
        }

        const updated = await prisma.conversation.findUnique({
          where: { id: conversation.id },
          include: { messages: { select: inboxMessageSelect, orderBy: { createdAt: 'asc' } } },
        });
        return res.json(toPublicConversation(updated));
      }

      await prisma.message.create({ data: { conversationId: conversation.id, sender: 'CUSTOMER', text } });
      await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
      await generateAndStoreAgentReply(conversation, text);

      const updated = await prisma.conversation.findUnique({
        where: { id: conversation.id },
        include: { messages: { select: inboxMessageSelect, orderBy: { createdAt: 'asc' } } },
      });
      res.json(toPublicConversation(updated));
    } catch (err: any) {
      console.error('Send message error:', err);
      res.status(500).json({ error: 'Unable to process request' });
    }
  });

  // Approves a pending AI draft (Copilot-off mode): delivers it to the real customer
  // (e.g. via Messenger/WhatsApp) when applicable, and marks it as sent.
  router.post('/api/conversations/:id/messages/:messageId/approve', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
      if (!conversation || conversation.storeId !== req.auth!.storeId) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      const message = await prisma.message.findUnique({ where: { id: req.params.messageId } });
      if (!message || message.conversationId !== conversation.id || !message.pending) {
        return res.status(404).json({ error: 'Pending draft not found' });
      }

      if (await deliverChannelMessage(conversation, message.text, message.imageUrl || undefined)) {
        // WhatsApp: delivered through the linked-device (QR) session
      } else if (conversation.channelType === 'FACEBOOK' && conversation.externalUserId) {
        const pageAccessToken = await getPageAccessTokenForStore(conversation.storeId);
        if (pageAccessToken) {
          try {
            await sendMessengerMessage(pageAccessToken, conversation.externalUserId, message.text);
            if (message.imageUrl) await sendMessengerImage(pageAccessToken, conversation.externalUserId, message.imageUrl);
          } catch (err) {
            console.error('Failed to deliver approved draft to Messenger:', err);
          }
        }
      }

      else if (conversation.channelType === 'WHATSAPP' && conversation.externalUserId) {
        const waCreds = await getWhatsAppCredentialsForStore(conversation.storeId);
        if (waCreds) {
          try {
            await sendWhatsAppMessage(waCreds.phoneNumberId, waCreds.accessToken, conversation.externalUserId, message.text);
            if (message.imageUrl) await sendWhatsAppImage(waCreds.phoneNumberId, waCreds.accessToken, conversation.externalUserId, message.imageUrl);
          } catch (err) {
            console.error('Failed to deliver approved draft to WhatsApp:', err);
          }
        }
      }

      else if (conversation.channelType === 'INSTAGRAM' && conversation.externalUserId) {
        const igCreds = await getInstagramCredentialsForStore(conversation.storeId);
        if (igCreds) {
          try {
            await sendInstagramMessage(igCreds.igAccountId, igCreds.accessToken, conversation.externalUserId, message.text);
            if (message.imageUrl) await sendInstagramImage(igCreds.igAccountId, igCreds.accessToken, conversation.externalUserId, message.imageUrl);
          } catch (err) {
            console.error('Failed to deliver approved draft to Instagram:', err);
          }
        }
      }

      await prisma.message.update({ where: { id: message.id }, data: { pending: false } });
      await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

      const updated = await prisma.conversation.findUnique({
        where: { id: conversation.id },
        include: { messages: { select: inboxMessageSelect, orderBy: { createdAt: 'asc' } } },
      });
      res.json(toPublicConversation(updated));
    } catch (err: any) {
      console.error('Approve draft error:', err);
      res.status(500).json({ error: 'Failed to approve draft' });
    }
  });

  // Dev-only AI sandbox. Unused by the SPA (Inbox uses /api/conversations/:id/messages).
  // Disabled in production; in development requires auth and uses the merchant's real
  // store persona/catalog — never client-supplied catalog/persona or raw error details.
  router.post('/api/chat', (req, res, next) => {
    if (isProduction) {
      return res.status(404).json({ error: 'Not found' });
    }
    next();
  }, aiLimiter, requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const { message, history = [] } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Message is required' });
      }

      const [store, products] = await Promise.all([
        prisma.store.findUnique({ where: { id: req.auth!.storeId } }),
        prisma.product.findMany({ where: { storeId: req.auth!.storeId } }),
      ]);
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }

      const persona = {
        storeName: store.name,
        tone: store.tone,
        style: store.style,
        customInstructions: store.customInstructions,
        merchantBusinessInfo: {
          businessPhone: store.businessPhone || undefined,
          businessType: store.businessType || undefined,
          website: store.website || undefined,
          streetAddress: store.streetAddress || undefined,
          city: store.city || undefined,
          country: store.country || undefined,
        },
        shareBusinessInfo: store.shareBusinessInfo,
      };
      const catalog = products.map((p) => ({
        name: resolveProductName(p),
        sku: p.sku,
        price: Number(p.price),
        inventory: p.inventory,
        status: p.status === 'TRAINED' ? 'Trained' : 'Pending',
        currency: getProductCurrency(p.rawAttributes),
      }));

      const safeHistory = Array.isArray(history)
        ? history
            .filter((h: any) => h && typeof h.text === 'string' && typeof h.sender === 'string')
            .slice(-10)
            .map((h: any) => ({ sender: h.sender, text: h.text }))
        : [];

      const promptCatalog = selectRelevantCatalog(catalog, message, safeHistory.map((h) => h.text), new Set());
      const result = await generateAgentReply({ message, history: safeHistory, persona, catalog, promptCatalog });
      return res.json(result);
    } catch (err: any) {
      console.error('Server error handling chat');
      res.status(500).json({ error: 'Unable to process request' });
    }
  });

  return router;
}
