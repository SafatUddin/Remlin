import { prisma } from './db';
import { notifyOrderStatus } from './orderNotifications';
import { buildTrackingUrl, buildTrackingMessage, type CourierProvider } from './courierTracking';
import type { OrderStatusEnum } from '../shared/orderStatus';

export interface CourierEvent {
  provider: CourierProvider;
  target: OrderStatusEnum | null;
  /** Our order reference as typed into the courier panel (invoice / merchant order id). */
  ref: string | null;
  consignmentId: string | null;
  trackingCode: string | null;
}

const str = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v).trim());

// Pathao events → our status. Anything else is acknowledged and ignored.
const PATHAO_EVENTS: Record<string, OrderStatusEnum> = {
  'order.picked': 'ON_THE_WAY',
  'order.at-the-sorting-hub': 'ON_THE_WAY',
  'order.in-transit': 'ON_THE_WAY',
  'order.received-at-last-mile-hub': 'ON_THE_WAY',
  'order.assigned-for-delivery': 'OUT_FOR_DELIVERY',
  'order.delivered': 'DELIVERED',
  'order.delivery-failed': 'DELIVERY_FAILED',
};

export function parsePathaoEvent(body: any): CourierEvent & { handshake: boolean } {
  const event = str(body?.event) || '';
  return {
    provider: 'pathao',
    handshake: event === 'webhook_integration',
    target: PATHAO_EVENTS[event] ?? null,
    ref: str(body?.merchant_order_id),
    consignmentId: str(body?.consignment_id),
    trackingCode: null,
  };
}

export function parseSteadfastEvent(body: any): CourierEvent {
  let target: OrderStatusEnum | null = null;
  const text = (str(body?.tracking_message) || '').toLowerCase();
  if (body?.notification_type === 'delivery_status') {
    const status = (str(body?.status) || '').toLowerCase();
    if (status === 'delivered' || status === 'partial_delivered') target = 'DELIVERED';
    else if (/out for delivery|rider|on the way/.test(text)) target = 'OUT_FOR_DELIVERY';
  } else if (/out for delivery|assigned.*(rider|delivery)|on the way to (deliver|you)|rider/.test(text)) {
    target = 'OUT_FOR_DELIVERY';
  } else if (/pick|receiv|hand|transit|sorting|hub|dispatch|shipped/.test(text)) {
    target = 'ON_THE_WAY';
  }
  return {
    provider: 'steadfast',
    target,
    ref: str(body?.invoice),
    consignmentId: str(body?.consignment_id),
    trackingCode: str(body?.tracking_code),
  };
}

const RANK: Record<OrderStatusEnum, number> = {
  PROCESSING: 0, READY_TO_SHIP: 1, ON_THE_WAY: 2, OUT_FOR_DELIVERY: 3, DELIVERY_FAILED: 3, DELIVERED: 4, CANCELLED: 4,
};

/** Courier updates only ever move an order forward (a failed delivery may be retried). */
function shouldApply(current: OrderStatusEnum, target: OrderStatusEnum) {
  if (current === 'DELIVERED' || current === 'CANCELLED' || current === target) return false;
  if (current === 'DELIVERY_FAILED') return true;
  return RANK[target] > RANK[current];
}

async function findOrder(storeId: string, ev: CourierEvent) {
  const or: any[] = [];
  const codes = [ev.consignmentId, ev.trackingCode].filter(Boolean) as string[];
  if (codes.length) or.push({ trackingCode: { in: codes } });
  const ref = (ev.ref || '').replace(/^#/, '').toLowerCase();
  if (ref.length >= 6) or.push({ id: ref }, { id: { endsWith: ref } });
  if (!or.length) return null;
  const matches = await prisma.order.findMany({ where: { storeId, OR: or }, take: 2 });
  return matches.length === 1 ? matches[0] : null;
}

export async function applyCourierEvent(storeId: string, ev: CourierEvent): Promise<'updated' | 'ignored'> {
  if (!ev.target) return 'ignored';
  const order = await findOrder(storeId, ev);
  if (!order) return 'ignored';
  const current = order.status as OrderStatusEnum;
  const data: { status?: OrderStatusEnum; trackingCode?: string; trackingUrl?: string } = {};
  let transitText: string | null = null;

  // Remember the courier's code so later updates match, and build the customer's link.
  const code = ev.provider === 'steadfast' ? ev.trackingCode || null : ev.consignmentId;
  if (code && !order.trackingCode) {
    data.trackingCode = code;
    data.trackingUrl = buildTrackingUrl(ev.provider, code, order.customerPhone);
  } else if (ev.consignmentId && !order.trackingCode) {
    data.trackingCode = ev.consignmentId;
  }
  const apply = shouldApply(current, ev.target);
  if (apply) data.status = ev.target;
  if (!Object.keys(data).length) return 'ignored';

  await prisma.order.update({ where: { id: order.id }, data });
  if (!apply) return 'ignored';

  const url = data.trackingUrl || order.trackingUrl;
  if (ev.target === 'ON_THE_WAY' && url && (data.trackingCode || order.trackingCode)) {
    transitText = buildTrackingMessage({ customerName: order.customerName, provider: ev.provider, code: (data.trackingCode || order.trackingCode)!, url });
  }
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { businessProfile: true } });
  await notifyOrderStatus(order, ev.target, store?.businessProfile, transitText);
  return 'updated';
}
