import express from 'express';
import { prisma } from '../db';
import { requireAuth, AuthedRequest } from '../auth';
import { requireProfileComplete } from '../profileCompletion';
import { normalizeAiMeta } from '../agent';
import { formatPrice, getCatalogCurrency } from '../../shared/currency';

export function createAnalyticsRouter(): express.Router {
  const router = express.Router();

  // Analytics: aggregated metrics for the authenticated merchant's store.
  // Returns a day-by-day series (suitable for the existing Recharts AreaChart),
  // summary KPIs, and a combined recent-activity feed — all scoped to the JWT
  // store. No schema changes are required; data is derived at query time.
  //
  // GET /api/analytics?range=30   (default)
  // GET /api/analytics?range=90
  router.get('/api/analytics', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const storeId = req.auth!.storeId;

      // Accept the ranges shown in the analytics workspace; invalid values default to 30.
      const rawRange = Number(req.query.range);
      const range: 7 | 14 | 30 | 90 = rawRange === 7 || rawRange === 14 || rawRange === 90 ? rawRange : 30;

      // Inclusive start boundary: midnight `range` days ago in UTC.
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - range);
      start.setUTCHours(0, 0, 0, 0);

      // ------------------------------------------------------------------
      // Parallel fetch — one round-trip for each logical data category.
      // All queries are scoped to storeId; none load full message bodies.
      // ------------------------------------------------------------------
      // Previous period of equal length, immediately preceding `start` — used only
      // to compute order-count growth (no series/activity uses this window).
      const prevStart = new Date(start);
      prevStart.setUTCDate(prevStart.getUTCDate() - range);

      const [
        conversationsInRange,
        ordersInRange,
        aiMessageCount,
        aiMessages,
        recentOrders,
        recentComplaints,
        lowStockProducts,
        responseTimeMessages,
        allConversationStatuses,
        prevPeriodOrderCount,
        prevPeriodConversations,
      ] = await Promise.all([
        // Slim conversation rows: only the fields needed for series + KPIs.
        prisma.conversation.findMany({
          where: { storeId, createdAt: { gte: start } },
          select: { createdAt: true, status: true, isComplaint: true, channelType: true },
        }),

        // Slim order rows: enough for series bucketing + revenue aggregation.
        prisma.order.findMany({
          where: { storeId, createdAt: { gte: start } },
          select: { createdAt: true, status: true, total: true },
        }),

        // AI message count — scoped via the conversation relation so we never
        // load message text, and we stay within the authenticated store.
        prisma.message.count({
          where: {
            sender: 'AI',
            createdAt: { gte: start },
            conversation: { storeId },
          },
        }),

        prisma.message.findMany({
          where: {
            sender: 'AI',
            createdAt: { gte: start },
            conversation: { storeId },
          },
          select: { meta: true },
        }),

        // Activity feed: recent orders (not range-filtered — latest overall).
        prisma.order.findMany({
          where: { storeId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, customerName: true, total: true, status: true, createdAt: true },
        }),

        // Activity feed: recent complaint conversations.
        prisma.conversation.findMany({
          where: { storeId, isComplaint: true },
          orderBy: { lastMessageAt: 'desc' },
          take: 10,
          select: { id: true, customerName: true, channelType: true, lastMessageAt: true },
        }),

        // Activity feed: low-stock products — same threshold (< 10) as
        // /api/notifications so merchant sees a consistent picture across the app.
        prisma.product.findMany({
          where: { storeId, inventory: { lt: 10 } },
          orderBy: { inventory: 'asc' },
          take: 10,
          select: { id: true, name: true, inventory: true },
        }),

        // Every message in range, ordered so first-reply latency can be paired up
        // per conversation in a single pass below. Only pending: false messages
        // count as a "reply" — an unapproved AI draft was never actually delivered.
        prisma.message.findMany({
          where: { conversation: { storeId }, createdAt: { gte: start } },
          orderBy: [{ conversationId: 'asc' }, { createdAt: 'asc' }],
          select: { conversationId: true, sender: true, createdAt: true, pending: true },
        }),

        prisma.conversation.findMany({
          where: { storeId },
          select: { status: true, channelType: true },
        }),

        prisma.order.count({ where: { storeId, createdAt: { gte: prevStart, lt: start } } }),

        prisma.conversation.findMany({
          where: { storeId, createdAt: { gte: prevStart, lt: start } },
          select: { status: true },
        }),
      ]);

      // ------------------------------------------------------------------
      // Series: one entry per calendar day in [start, today].
      // Both conversations and FULFILLED orders (verified as the only
      // "completed" OrderStatus in this project — schema: PENDING | FULFILLED
      // | CANCELLED; creation always writes PENDING; the merchant promotes to
      // FULFILLED via PATCH /api/orders/:id) are bucketed by their UTC date.
      //
      // If the store has no data at all we return series: [] (empty state).
      // ------------------------------------------------------------------
      const hasData = conversationsInRange.length > 0 || ordersInRange.length > 0;

      // Helper: ISO date string key e.g. "2024-10-14" from a Date.
      const dayKey = (d: Date) => d.toISOString().slice(0, 10);

      // Helper: human-readable label matching the mock style ("Oct 14").
      const dayLabel = (isoKey: string) => {
        const d = new Date(`${isoKey}T00:00:00Z`);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      };

      let series: { date: string; conversations: number; convertedSales: number; customerMessages: number; aiReplies: number; humanReplies: number }[] = [];

      if (hasData) {
        // Build a map of all days in the window → zero counts.
        const dayMap = new Map<string, { conversations: number; convertedSales: number; customerMessages: number; aiReplies: number; humanReplies: number }>();
        const cursor = new Date(start);
        const today = new Date();
        while (cursor <= today) {
          dayMap.set(dayKey(cursor), { conversations: 0, convertedSales: 0, customerMessages: 0, aiReplies: 0, humanReplies: 0 });
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        // Bucket conversations.
        for (const c of conversationsInRange) {
          const key = dayKey(c.createdAt);
          const entry = dayMap.get(key);
          if (entry) entry.conversations += 1;
        }

        // Bucket converted sales — DELIVERED orders only.
        for (const o of ordersInRange) {
          if (o.status === 'DELIVERED') {
            const key = dayKey(o.createdAt);
            const entry = dayMap.get(key);
            if (entry) entry.convertedSales += 1;
          }
        }

        for (const message of responseTimeMessages) {
          const entry = dayMap.get(dayKey(message.createdAt));
          if (!entry || message.pending) continue;
          if (message.sender === 'CUSTOMER') entry.customerMessages += 1;
          if (message.sender === 'AI') entry.aiReplies += 1;
          if (message.sender === 'MERCHANT') entry.humanReplies += 1;
        }

        series = Array.from(dayMap.entries()).map(([key, counts]) => ({
          date: dayLabel(key),
          ...counts,
        }));
      }

      // ------------------------------------------------------------------
      // KPIs
      // ------------------------------------------------------------------

      // Automation rate: % of in-range conversations handled by AI.
      const totalConvs = conversationsInRange.length;
      const aiManagedCount = conversationsInRange.filter(c => c.status === 'AI_MANAGED').length;
      const automationRate = totalConvs > 0 ? Math.round((aiManagedCount / totalConvs) * 100) : 0;

      // Automation rate delta vs. the immediately preceding period of equal length.
      // Null when there were no conversations at all in that prior window.
      const prevTotalConvs = prevPeriodConversations.length;
      const prevAutomationRate = prevTotalConvs > 0
        ? Math.round((prevPeriodConversations.filter(c => c.status === 'AI_MANAGED').length / prevTotalConvs) * 100)
        : null;
      const automationRateDeltaPoints = prevAutomationRate !== null ? automationRate - prevAutomationRate : null;

      // Average first-reply latency: for each conversation, pair its first CUSTOMER
      // message with the next actually-delivered (pending: false) AI or MERCHANT
      // message that follows it, then average the gap across conversations that
      // have both. Conversations with no reply yet (or a reply still awaiting
      // merchant approval) are excluded rather than counted as instant/zero.
      const responseTimesMs: number[] = [];
      const aiResponseTimesMs: number[] = [];
      const humanResponseTimesMs: number[] = [];
      let longestWaitingMs = 0;
      let waitingConversations = 0;
      const customerConversationIds = new Set<string>();
      let customerMessageCount = 0;
      let aiReplyCount = 0;
      let humanReplyCount = 0;
      let slaBreaches = 0;
      {
        let i = 0;
        while (i < responseTimeMessages.length) {
          const conversationId = responseTimeMessages[i].conversationId;
          let j = i;
          while (j < responseTimeMessages.length && responseTimeMessages[j].conversationId === conversationId) j++;
          const thread = responseTimeMessages.slice(i, j);

          for (const message of thread) {
            if (message.sender === 'CUSTOMER') {
              customerMessageCount += 1;
              customerConversationIds.add(conversationId);
            } else if (!message.pending && message.sender === 'AI') {
              aiReplyCount += 1;
            } else if (!message.pending && message.sender === 'MERCHANT') {
              humanReplyCount += 1;
            }
          }

          const firstCustomerMsg = thread.find(m => m.sender === 'CUSTOMER');
          if (firstCustomerMsg) {
            const reply = thread.find(m =>
              m.sender !== 'CUSTOMER' && !m.pending && m.createdAt > firstCustomerMsg.createdAt
            );
            if (reply) {
              responseTimesMs.push(reply.createdAt.getTime() - firstCustomerMsg.createdAt.getTime());
              if (reply.createdAt.getTime() - firstCustomerMsg.createdAt.getTime() > 15 * 60 * 1000) slaBreaches += 1;
              if (reply.sender === 'AI') aiResponseTimesMs.push(reply.createdAt.getTime() - firstCustomerMsg.createdAt.getTime());
              if (reply.sender === 'MERCHANT') humanResponseTimesMs.push(reply.createdAt.getTime() - firstCustomerMsg.createdAt.getTime());
            }
          }

          const lastCustomer = [...thread].reverse().find(m => m.sender === 'CUSTOMER');
          const hasReplyAfterLastCustomer = lastCustomer && thread.some(m => m.sender !== 'CUSTOMER' && !m.pending && m.createdAt > lastCustomer.createdAt);
          if (lastCustomer && !hasReplyAfterLastCustomer) {
            const waitMs = Math.max(0, Date.now() - lastCustomer.createdAt.getTime());
            longestWaitingMs = Math.max(longestWaitingMs, waitMs);
            waitingConversations += 1;
          }
          i = j;
        }
      }
      const averageResponseTimeSeconds = responseTimesMs.length > 0
        ? Math.round((responseTimesMs.reduce((sum, ms) => sum + ms, 0) / responseTimesMs.length) / 1000)
        : null;
      const averageAiResponseTimeSeconds = aiResponseTimesMs.length > 0
        ? Math.round((aiResponseTimesMs.reduce((sum, ms) => sum + ms, 0) / aiResponseTimesMs.length) / 1000)
        : null;
      const averageHumanResponseTimeSeconds = humanResponseTimesMs.length > 0
        ? Math.round((humanResponseTimesMs.reduce((sum, ms) => sum + ms, 0) / humanResponseTimesMs.length) / 1000)
        : null;

      const orderCount = ordersInRange.length;

      // Order uplift: % change in order count vs. the immediately preceding period
      // of equal length. Null (not 0% or Infinity) when there's no prior-period
      // baseline to compare against, so the frontend can show "New" honestly.
      const orderUpliftPercent = prevPeriodOrderCount > 0
        ? Math.round(((orderCount - prevPeriodOrderCount) / prevPeriodOrderCount) * 1000) / 10
        : null;

      // Revenue: sum of all order totals in range regardless of status, so
      // merchants see gross committed revenue, not just fulfilled orders.
      const revenue = ordersInRange.reduce((sum, o) => sum + Number(o.total), 0);

      const complaints = conversationsInRange.filter(c => c.isComplaint).length;
      const currentSplit = {
        aiManaged: allConversationStatuses.filter(c => c.status === 'AI_MANAGED').length,
        humanActive: allConversationStatuses.filter(c => c.status === 'ACTIVE').length,
        closed: allConversationStatuses.filter(c => c.status === 'CLOSED').length,
      };
      const handoffRequests = conversationsInRange.filter(c => c.status === 'ACTIVE' || c.isComplaint).length;
      const bySource = new Map<string, number>();
      for (const conversation of conversationsInRange) {
        const source = conversation.channelType.toLowerCase();
        bySource.set(source, (bySource.get(source) ?? 0) + 1);
      }

      const aiMetaSamples = aiMessages.map((m) => normalizeAiMeta((m.meta as Record<string, any>) ?? undefined));
      const aiHealth = aiMetaSamples.length > 0
        ? (() => {
            let totalLatencyMs = 0;
            let latencyCount = 0;
            let fallbackCount = 0;
            let totalTokens = 0;
            const modelCounts = new Map<string, number>();

            for (const item of aiMetaSamples) {
              if (item.latencyMs > 0) {
                totalLatencyMs += item.latencyMs;
                latencyCount += 1;
              }
              if (item.fallback) fallbackCount += 1;
              totalTokens += item.responseTokens;
              const key = item.model || 'unknown';
              modelCounts.set(key, (modelCounts.get(key) ?? 0) + 1);
            }

            const payload = Array.from(modelCounts.entries()).map(([model, count]) => ({
              model,
              count,
              percentage: aiMetaSamples.length > 0 ? Math.round((count / aiMetaSamples.length) * 100) : 0,
            }));

            return {
              totalMessages: aiMetaSamples.length,
              averageLatencyMs: latencyCount > 0 ? Math.round(totalLatencyMs / latencyCount) : null,
              fallbackRate: aiMetaSamples.length > 0 ? Math.round((fallbackCount / aiMetaSamples.length) * 100) : 0,
              tokensUsed: totalTokens,
              modelBreakdown: payload,
            };
          })()
        : {
            totalMessages: 0,
            averageLatencyMs: null,
            fallbackRate: 0,
            tokensUsed: 0,
            modelBreakdown: [],
          };

      // ------------------------------------------------------------------
      // Recent activity: merge orders, complaints, and low-stock alerts
      // into one consistent array, sorted newest-first, capped at 10 items.
      // ------------------------------------------------------------------

      // Map order status enum back to the display value already used across
      // the project (same logic as toPublicOrder above).
      const orderStatusLabel = (s: string) =>
        s === 'DELIVERED' ? 'Delivered' : s === 'CANCELLED' ? 'Cancelled' : s === 'ON_THE_WAY' ? 'On the Way' : 'Processing';

      const storeCurrency = getCatalogCurrency(
        await prisma.product.findMany({ where: { storeId }, select: { rawAttributes: true } })
      );

      const activityItems: {
        id: string;
        type: 'order' | 'complaint' | 'inventory';
        title: string;
        body: string;
        time: string | null;
      }[] = [
        ...recentOrders.map(o => ({
          id: `order-${o.id}`,
          type: 'order' as const,
          title: `Order`,
          body: `${o.customerName} · ${formatPrice(Number(o.total), storeCurrency)} · ${orderStatusLabel(o.status)}`,
          time: o.createdAt.toISOString(),
        })),
        ...recentComplaints.map(c => ({
          id: `complaint-${c.id}`,
          type: 'complaint' as const,
          title: 'Complaint',
          body: `${c.customerName || 'A customer'} via ${c.channelType.toLowerCase()}`,
          time: c.lastMessageAt.toISOString(),
        })),
        // Inventory alerts have no meaningful timestamp; they sort after timed items.
        ...lowStockProducts.map(p => ({
          id: `inventory-${p.id}`,
          type: 'inventory' as const,
          title: 'Inventory Alert',
          body: `${p.name} is running low (${p.inventory} unit${p.inventory === 1 ? '' : 's'} left)`,
          time: null,
        })),
      ];

      // Sort: timed items newest-first; null-time items always last.
      activityItems.sort((a, b) => {
        if (!a.time && !b.time) return 0;
        if (!a.time) return 1;
        if (!b.time) return -1;
        return new Date(b.time).getTime() - new Date(a.time).getTime();
      });

      const recentActivity = activityItems.slice(0, 10);

      // ------------------------------------------------------------------
      // Response
      // ------------------------------------------------------------------
      res.json({
        range,
        series,
        kpis: {
          automationRate,
          automationRateDeltaPoints,
          averageResponseTimeSeconds,
          orderCount,
          orderUpliftPercent,
          revenue: Math.round(revenue * 100) / 100,
          aiMessages: aiMessageCount,
          complaints,
          customerMessages: customerMessageCount,
          aiReplies: aiReplyCount,
          humanReplies: humanReplyCount,
          peopleReached: customerConversationIds.size,
          averageAiResponseTimeSeconds,
          averageHumanResponseTimeSeconds,
          longestWaitingSeconds: longestWaitingMs > 0 ? Math.round(longestWaitingMs / 1000) : null,
          waitingConversations,
          slaBreachRate: responseTimesMs.length > 0 ? Math.round((slaBreaches / responseTimesMs.length) * 100) : 0,
          averageHandlingTimeSeconds: null,
        },
        aiHealth,
        currentSplit,
        handoffs: {
          requestsToHumans: handoffRequests,
          autoReturned: 0,
          totalEvents: handoffRequests,
          averageEventsPerDay: range > 0 ? Math.round((handoffRequests / range) * 10) / 10 : 0,
        },
        busiestPages: [],
        bySource: Array.from(bySource.entries()).map(([source, conversations]) => ({ source, conversations })),
        recentActivity,
      });
    } catch (err: any) {
      console.error('Analytics error:', err);
      res.status(500).json({ error: 'Failed to load analytics' });
    }
  });

  return router;
}
