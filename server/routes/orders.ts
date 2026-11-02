import express from 'express';
import { prisma } from '../db';
import { requireAuth, AuthedRequest } from '../auth';
import { requireProfileComplete } from '../profileCompletion';
import { createOrderForConversation } from '../orderCreation';
import { splitContactDetails } from '../contactDetails';
import { buildTrackingUrl, buildTrackingMessage, type CourierProvider } from '../courierTracking';
import { notifyOrderStatus } from '../orderNotifications';
import { ORDER_STATUS_LABEL, ORDER_LABEL_STATUS, type OrderStatusEnum, type OrderStatusLabel } from '../../shared/orderStatus';

const toPublicOrder = (o: { id: string; conversationId: string | null; items: any; customerName: string; customerPhone: string | null; address: string; status: string; total: any; createdAt: Date; trackingCode?: string | null; trackingUrl?: string | null }) => {
  const publicStatus: OrderStatusLabel = ORDER_STATUS_LABEL[o.status as OrderStatusEnum] || 'Processing';
  return {
    id: o.id,
    conversationId: o.conversationId,
    items: o.items,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    address: o.address,
    status: publicStatus,
    total: Number(o.total),
    createdAt: o.createdAt,
    trackingCode: o.trackingCode ?? null,
    trackingUrl: o.trackingUrl ?? null,
  };
};

export function createOrdersRouter(): express.Router {
  const router = express.Router();

  // List this store's orders
  router.get('/api/orders', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const orders = await prisma.order.findMany({
        where: { storeId: req.auth!.storeId },
        orderBy: { createdAt: 'desc' },
      });
      res.json(orders.map(toPublicOrder));
    } catch (err: any) {
      console.error('List orders error:', err);
      res.status(500).json({ error: 'Failed to load orders' });
    }
  });

  // Update an order's status
  router.patch('/api/orders/:id', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const { status, trackingCode } = req.body;
      const mapped = ORDER_LABEL_STATUS[status] as OrderStatusEnum | undefined;
      if (!mapped) return res.status(400).json({ error: 'Invalid status' });

      const order = await prisma.order.findUnique({ where: { id: req.params.id } });
      if (!order || order.storeId !== req.auth!.storeId) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Business Rule: Restrict cancelling delivered orders
      if (order.status === 'DELIVERED' && mapped === 'CANCELLED') {
        return res.status(400).json({ error: 'Delivered orders cannot be cancelled.' });
      }

      // If transitioning to CANCELLED from a non-cancelled state, restore inventory
      if (mapped === 'CANCELLED' && order.status !== 'CANCELLED') {
        await prisma.$transaction(async (tx) => {
          const items = (order.items as any[]) || [];
          for (const item of items) {
            if (item.sku && item.quantity > 0) {
              await tx.product.updateMany({
                where: { storeId: order.storeId, sku: item.sku },
                data: { inventory: { increment: item.quantity } },
              });
            }
          }
          await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
        });
        const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
        return res.json(toPublicOrder(updatedOrder!));
      }

      const data: { status: OrderStatusEnum; trackingCode?: string; trackingUrl?: string } = { status: mapped };
      let transitText: string | null = null;
      const store = await prisma.store.findUnique({ where: { id: order.storeId }, select: { courier: true, businessProfile: true } });

      // Handing the parcel to the courier: needs the courier set up and, for a connected
      // courier, its tracking code (turned into the customer's tracking link).
      if (mapped === 'ON_THE_WAY' && order.status !== 'ON_THE_WAY') {
        const courier = (store?.courier || {}) as { provider?: CourierProvider; credentials?: unknown; skipped?: boolean };
        if (courier.provider && courier.credentials) {
          const code = typeof trackingCode === 'string' ? trackingCode.trim() : '';
          if (!/^[A-Za-z0-9._-]{3,80}$/.test(code)) {
            return res.status(400).json({ error: 'Enter the courier tracking code (letters and numbers, 3–80 characters).' });
          }
          data.trackingCode = code;
          data.trackingUrl = buildTrackingUrl(courier.provider, code, order.customerPhone);
          transitText = buildTrackingMessage({ customerName: order.customerName, provider: courier.provider, code, url: data.trackingUrl });
        } else if (!courier.skipped) {
          return res.status(400).json({ error: 'Set up your courier in the setup guide before marking an order In transit.' });
        }
      }

      const updated = await prisma.order.update({ where: { id: order.id }, data });

      // Message the customer when the owner ticked this step in "Your business".
      if (mapped !== order.status) {
        await notifyOrderStatus(order, mapped, store?.businessProfile, transitText);
      }
      res.json(toPublicOrder(updated));
    } catch (err: any) {
      console.error('Update order error:', err);
      res.status(500).json({ error: 'Failed to update order' });
    }
  });

  router.post('/api/conversations/:id/orders', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
      if (!conversation || conversation.storeId !== req.auth!.storeId) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const cart: { sku: string; quantity: number }[] = (conversation.cart as any) || [];
      if (cart.length === 0) {
        return res.status(400).json({ error: 'This conversation has no items in its cart yet' });
      }

      const contact = splitContactDetails({
        address: typeof req.body.address === 'string' ? req.body.address : '',
        phone: typeof req.body.customerPhone === 'string' ? req.body.customerPhone : '',
      });
      if (!contact.address) {
        return res.status(400).json({ error: 'A shipping address is required' });
      }

      const order = await createOrderForConversation(conversation, cart, contact, req.body.customerName);
      res.status(201).json(toPublicOrder(order));
    } catch (err: any) {
      if (err?.code === 'INSUFFICIENT_STOCK') {
        return res.status(409).json({ error: 'Insufficient stock to create this order' });
      }
      console.error('Create order error:', err);
      res.status(500).json({ error: 'Unable to process request' });
    }
  });

  return router;
}
