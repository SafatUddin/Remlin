import { ORDER_MESSAGE_DEFAULTS, ORDER_MESSAGE_STATUS, ORDER_STATUS_LABEL, type OrderMessageKey } from '../shared/orderStatus';

// Free-form business details collected in the setup guide (hours, delivery, payment…).
// Stored as JSON on Store.businessProfile and fed to the AI as extra instructions.

const STR_KEYS = ['sell', 'hotline', 'address', 'hours', 'inC', 'inF', 'inS', 'outC', 'outF', 'outS', 'extra', 'pay', 'returns', 'first'] as const;
const MAX_LEN = 1000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type BusinessProfile = {
  addr?: 'sir' | 'bhaiya';
  firstName?: boolean;
  off?: string[];
  msgs?: Partial<Record<OrderMessageKey, boolean>>;
} & Partial<Record<(typeof STR_KEYS)[number], string>>;

/** Returns a cleaned profile, or null when the input is malformed. */
export function sanitizeBusinessProfile(raw: unknown): BusinessProfile | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: BusinessProfile = {};
  for (const k of STR_KEYS) {
    const v = r[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || v.length > MAX_LEN) return null;
    if (v.trim()) out[k] = v.trim();
  }
  if (r.addr !== undefined) {
    if (!['sir', 'bhaiya'].includes(r.addr as string)) return null;
    out.addr = r.addr as BusinessProfile['addr'];
  }
  if (r.firstName !== undefined) out.firstName = !!r.firstName;
  if (r.off !== undefined) {
    if (!Array.isArray(r.off) || r.off.some((d) => !DAYS.includes(d as string))) return null;
    out.off = r.off as string[];
  }
  if (r.msgs !== undefined && !Array.isArray(r.msgs)) {
    if (!r.msgs || typeof r.msgs !== 'object') return null;
    const m: Partial<Record<OrderMessageKey, boolean>> = {};
    for (const k of Object.keys(ORDER_MESSAGE_DEFAULTS) as OrderMessageKey[]) {
      const v = (r.msgs as Record<string, unknown>)[k];
      if (v !== undefined) m[k] = !!v;
    }
    out.msgs = m;
  }
  return out;
}

/** Which order-status changes message the customer (owner's tick marks, falling back to defaults). */
export function orderMessageSettings(raw: unknown): Record<OrderMessageKey, boolean> {
  const p = sanitizeBusinessProfile(raw) || {};
  return { ...ORDER_MESSAGE_DEFAULTS, ...(p.msgs || {}) };
}

/** Contact details from "Your business", in the shape the AI prompts expect. */
export function businessContact(raw: unknown) {
  const p = sanitizeBusinessProfile(raw) || {};
  return { businessPhone: p.hotline, businessType: p.sell, streetAddress: p.address };
}

export function businessProfileToText(raw: unknown, shareBusinessInfo = true): string {
  const p = sanitizeBusinessProfile(raw);
  if (!p) return '';
  const L: string[] = [];
  if (p.hours && shareBusinessInfo) L.push(`Open hours: ${p.hours}.`);
  if (p.inC || p.outC) {
    const d = (c?: string, f?: string, s?: string) => `${c ? `${c} BDT` : 'charge not fixed'}${f || s ? `, ${f || '?'}–${s || '?'} days` : ''}`;
    L.push(`Delivery inside Dhaka: ${d(p.inC, p.inF, p.inS)}. Outside Dhaka: ${d(p.outC, p.outF, p.outS)}.`);
  }
  if (p.off?.length) L.push(`No parcels are shipped on: ${p.off.join(', ')}.`);
  if (p.extra) L.push(`Delivery notes: ${p.extra}`);
  if (p.pay) L.push(`How customers pay (say exactly this): ${p.pay}`);
  if (p.returns) L.push(`Returns and exchange rule: ${p.returns}`);
  if (p.addr) L.push(`Address customers as ${p.addr === 'sir' ? 'Sir / Ma’am' : 'Bhaiya / Apu'}${p.firstName ? ', putting their first name first' : ''}.`);
  if (p.first) L.push(`First message to a new customer: ${p.first}`);
  if (p.msgs !== undefined || L.length) {
    const on = orderMessageSettings(raw);
    const keys = Object.keys(on) as OrderMessageKey[];
    const sent = keys.filter((k) => on[k]).map((k) => ORDER_STATUS_LABEL[ORDER_MESSAGE_STATUS[k]]);
    const silent = keys.filter((k) => !on[k]).map((k) => ORDER_STATUS_LABEL[ORDER_MESSAGE_STATUS[k]]);
    L.push(`Order updates: the system automatically messages the customer when an order becomes: ${sent.join(', ') || 'none'}.${silent.length ? ` The owner chose NOT to send updates for: ${silent.join(', ')} — do not announce these changes yourself; if the customer asks about their order, answer from the order's current status.` : ''} When a customer asks where their order is, reply according to its current status (Processing = being prepared; Ready to ship = packed, waiting for the courier; In transit = with the courier, share the tracking link if available; Out for delivery = rider is on the way; Delivered = thank them; Delivery failed = ask when to re-deliver).`);
  }
  if (!L.length) return '';
  L.push('Language: always reply in the language the customer writes in — Bangla, English or Banglish (Bangla written in English letters).');
  return `BUSINESS DETAILS WRITTEN BY THE OWNER (answer from these; if something is not written here, hand the chat to a person instead of guessing):\n${L.join('\n')}`;
}

export function withBusinessProfile(instructions: string | null | undefined, profile: unknown, shareBusinessInfo = true): string {
  return [instructions || '', businessProfileToText(profile, shareBusinessInfo)].filter(Boolean).join('\n\n');
}
