export type CourierProvider = 'pathao' | 'steadfast';

export const COURIER_LABEL: Record<CourierProvider, string> = { pathao: 'Pathao', steadfast: 'Steadfast' };

export function buildTrackingUrl(provider: CourierProvider, code: string, phone?: string | null): string {
  const c = encodeURIComponent(code);
  if (provider === 'steadfast') return `https://steadfast.com.bd/t/${c}`;
  const digits = (phone || '').replace(/\D/g, '').slice(-11);
  return `https://merchant.pathao.com/tracking?consignment_id=${c}${digits ? `&phone=${digits}` : ''}`;
}

export function buildTrackingMessage(opts: { customerName?: string | null; provider: CourierProvider; code: string; url: string }): string {
  const first = (opts.customerName || '').trim().split(/\s+/)[0];
  return `${first ? `${first}, your` : 'Your'} order is on its way! It has been handed to ${COURIER_LABEL[opts.provider]} (tracking code ${opts.code}). Track your parcel here: ${opts.url}`;
}
