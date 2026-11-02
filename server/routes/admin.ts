import express from 'express';
import { businessContact } from '../businessProfile';
import { prisma } from '../db';
import { requireAuth, AuthedRequest } from '../auth';

export function createAdminRouter(): express.Router {
  const router = express.Router();

  // Middleware to check if user is admin
  const requireAdmin = (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
    if (!req.auth?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };

  // GET /api/admin/analytics - Get merchant analytics with time filter
  router.get('/api/admin/analytics', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    try {
      const { timeFilter } = req.query;
      
      console.log('[Admin Analytics] Time filter:', timeFilter);
      
      // Calculate date threshold based on filter
      let dateThreshold: Date | null = null;
      const now = new Date();
      
      switch (timeFilter) {
        case '1month':
          dateThreshold = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
          break;
        case '3months':
          dateThreshold = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
          break;
        case '6months':
          dateThreshold = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
          break;
        case 'all':
        default:
          dateThreshold = null;
          break;
      }

      // Admin email to exclude from analytics
      const ADMIN_EMAIL = 'remlin75@gmail.com';

      // Get all merchants with their stores
      const allMerchants = await prisma.merchant.findMany({
        include: {
          store: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      console.log('[Admin Analytics] Found total merchants:', allMerchants.length);

      // Filter out admin and merchants without stores
      const merchants = allMerchants.filter(m => m.email !== ADMIN_EMAIL && m.store);

      console.log('[Admin Analytics] Non-admin merchants with stores:', merchants.length);

      // Build analytics for each merchant
      const analytics = await Promise.all(
        merchants.map(async (merchant) => {
          const storeId = merchant.store!.id;

          // Build where clause for time filtering
          const whereClause: any = { storeId };
          if (dateThreshold) {
            whereClause.createdAt = { gte: dateThreshold };
          }

          // Count total conversations
          const totalConversations = await prisma.conversation.count({
            where: whereClause,
          });

          // Count AI messages (messages with sender = AI)
          const totalAiMessages = await prisma.message.count({
            where: {
              conversation: {
                storeId,
                ...(dateThreshold ? { createdAt: { gte: dateThreshold } } : {}),
              },
              sender: 'AI',
            },
          });

          // Get orders with time filter, excluding cancelled orders
          const orders = await prisma.order.findMany({
            where: {
              ...whereClause,
              status: { not: 'CANCELLED' }, // Exclude cancelled orders (enum is uppercase)
            },
            select: {
              total: true,
              conversationId: true,
            },
          });

          // Count converted conversations = total number of non-cancelled orders
          const convertedConversations = orders.length;

          // Calculate total sales (excluding cancelled orders)
          const totalSales = orders.reduce((sum, order) => sum + Number(order.total), 0);

          return {
            merchantId: merchant.id,
            merchantName: merchant.name,
            merchantEmail: merchant.email,
            merchantPhone: merchant.phone,
            merchantAvatarUrl: merchant.avatarUrl,
            storeName: merchant.store!.name,
            storeHotline: businessContact(merchant.store!.businessProfile).businessPhone ?? null,
            storeSells: businessContact(merchant.store!.businessProfile).businessType ?? null,
            storeAddress: businessContact(merchant.store!.businessProfile).streetAddress ?? null,
            totalConversations,
            convertedConversations,
            totalSales,
            totalAiMessages,
            joinedAt: merchant.createdAt.toISOString(),
          };
        })
      );

      console.log('[Admin Analytics] Returning analytics for', analytics.length, 'merchants');

      res.json(analytics);
    } catch (err: any) {
      console.error('[Admin Analytics] Error:', err);
      res.status(500).json({ error: 'Failed to load analytics', details: err.message });
    }
  });

  return router;
}
