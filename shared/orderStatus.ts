export type OrderStatusEnum =
  | 'PROCESSING' | 'READY_TO_SHIP' | 'ON_THE_WAY' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'DELIVERY_FAILED' | 'CANCELLED';

export type OrderStatusLabel =
  | 'Processing' | 'Ready to ship' | 'In transit' | 'Out for delivery' | 'Delivered' | 'Delivery failed' | 'Cancelled';

export const ORDER_STATUS_LABEL: Record<OrderStatusEnum, OrderStatusLabel> = {
  PROCESSING: 'Processing',
  READY_TO_SHIP: 'Ready to ship',
  ON_THE_WAY: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  DELIVERY_FAILED: 'Delivery failed',
  CANCELLED: 'Cancelled',
};

export const ORDER_LABEL_STATUS: Record<string, OrderStatusEnum> = {
  ...Object.fromEntries(Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => [v, k as OrderStatusEnum])),
  'On the Way': 'ON_THE_WAY',
};

export const ORDER_STATUS_OPTIONS: OrderStatusLabel[] = [
  'Processing', 'Ready to ship', 'In transit', 'Out for delivery', 'Delivered', 'Delivery failed', 'Cancelled',
];

/** Orders that are not finished: still cancellable and shown as ongoing. */
export const ACTIVE_ORDER_STATUSES: OrderStatusEnum[] = ['PROCESSING', 'READY_TO_SHIP', 'ON_THE_WAY', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'];

export const isActiveOrderLabel = (l: string) => l !== 'Delivered' && l !== 'Cancelled';

/** Customer-message toggles shown in "Your business" → which status changes message the customer. */
export type OrderMessageKey = 'ready' | 'transit' | 'out' | 'delivered' | 'failed';
export const ORDER_MESSAGE_STATUS: Record<OrderMessageKey, OrderStatusEnum> = {
  ready: 'READY_TO_SHIP', transit: 'ON_THE_WAY', out: 'OUT_FOR_DELIVERY', delivered: 'DELIVERED', failed: 'DELIVERY_FAILED',
};
export const ORDER_MESSAGE_DEFAULTS: Record<OrderMessageKey, boolean> = { ready: false, transit: true, out: true, delivered: true, failed: true };
