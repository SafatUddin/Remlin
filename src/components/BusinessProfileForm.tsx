import React, { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { ArrowRight, Truck, MessageSquare } from 'lucide-react';
import { completeProfile } from '../lib/api';
import type { PublicMerchant, PublicStore, OnboardingResponse } from '../lib/api';
import AutoTextarea from './AutoTextarea';
import { Feedback } from './profile/ProfileFormParts';
import type { FeedbackProps } from './profile/ProfileFormParts';

interface BusinessProfileFormProps {
  merchant: PublicMerchant;
  store: PublicStore;
  onComplete: (response: OnboardingResponse) => void;
  submitLabel?: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type MsgKey = 'ready' | 'transit' | 'out' | 'delivered' | 'failed';
const ORDER_MSGS: [MsgKey, string, string][] = [
  ['ready', 'Ready to ship', 'When the parcel is packed and waits for the courier.'],
  ['transit', 'In transit', 'When the parcel is handed to the courier — with the tracking link.'],
  ['out', 'Out for delivery', 'When the courier reports the rider is on the way, with the cash to keep ready.'],
  ['delivered', 'Delivered', 'The thank-you and the review request.'],
  ['failed', 'Delivery failed', 'When the courier could not deliver — the customer is asked when to try again.'],
];
const MSG_DEFAULT: Record<MsgKey, boolean> = { ready: false, transit: true, out: true, delivered: true, failed: true };

const inputCls = 'zone-b-input w-full px-4 py-3.5 text-[15px] text-white placeholder-white/25 disabled:opacity-50';

export default function BusinessProfileForm({ merchant, store, onComplete, submitLabel = 'Save and continue' }: BusinessProfileFormProps) {
  const bp = (store.businessProfile || {}) as Record<string, any>;
  const [f, setF] = useState({
    name: store.name || '',
    sell: bp.sell || '',
    hours: bp.hours || '',
    hotline: bp.hotline || '',
    address: bp.address || '',
    inC: bp.inC ?? '70', inF: bp.inF ?? '1', inS: bp.inS ?? '2',
    outC: bp.outC ?? '130', outF: bp.outF ?? '3', outS: bp.outS ?? '5',
    off: (bp.off as string[]) || [],
    msgs: { ...MSG_DEFAULT, ...(bp.msgs && !Array.isArray(bp.msgs) ? bp.msgs : {}) } as Record<MsgKey, boolean>,
    extra: bp.extra || '',
    pay: bp.pay || '',
    returns: bp.returns || '',
    addr: (bp.addr as string) || 'sir',
    firstName: !!bp.firstName,
    first: bp.first || '',
  });
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<FeedbackProps | null>(null);

  const fail = (message: string) => {
    setFeedback({ type: 'error', message });
    setTimeout(() => setFeedback(null), 5000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setFeedback(null);
    setSaving(true);
    try {
      const response = await completeProfile({
        name: merchant.name,
        storeName: f.name.trim(),
        businessProfile: {
          sell: f.sell.trim(), hotline: f.hotline.trim(), address: f.address.trim(),
          hours: f.hours, inC: f.inC, inF: f.inF, inS: f.inS, outC: f.outC, outF: f.outF, outS: f.outS,
          off: f.off, msgs: f.msgs, extra: f.extra, pay: f.pay, returns: f.returns,
          addr: f.addr, firstName: f.firstName, first: f.first,
        },
      });
      onComplete(response);
    } catch (err: any) {
      if (err?.fieldErrors && typeof err.fieldErrors === 'object') {
        setFieldErrors(err.fieldErrors);
        fail('Please fix the errors below.');
      } else {
        fail(err?.message || 'Failed to save. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const fg = (label: string, key: string | null, control: React.ReactNode, help?: string, full = false) => (
    <div className={`flex flex-col gap-2 ${full ? 'md:col-span-2' : ''}`}>
      <label className="font-sans text-[13px] font-bold text-white">{label}</label>
      {control}
      {key && fieldErrors[key] ? (
        <span className="font-sans text-xs text-red-400">{fieldErrors[key]}</span>
      ) : help ? (
        <span className="font-sans text-xs text-white/40 leading-relaxed">{help}</span>
      ) : null}
    </div>
  );
  const inp = (k: keyof typeof f, placeholder: string, type = 'text', extra: Record<string, any> = {}) => (
    <input type={type} value={f[k] as string} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} disabled={saving} required className={inputCls} {...extra} />
  );
  const area = (k: keyof typeof f, placeholder: string, rows = 3) => (
    <AutoTextarea value={f[k] as string} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} rows={rows} disabled={saving} required className={inputCls} />
  );
  const radio = (k: keyof typeof f, value: string, label: string) => (
    <label className="flex items-center gap-2.5 font-sans text-[14px] text-white/85 cursor-pointer">
      <input type="radio" name={k} checked={f[k] === value} onChange={() => set(k, value)} className="w-4 h-4 accent-[#00a8e8]" />
      {label}
    </label>
  );
  const subCard = 'zone-b-grey1 p-6 flex flex-col gap-5';

  return (
    <form onSubmit={handleSubmit} className="w-full flex flex-col gap-6">
      <section className="zone-b-grey2 p-8 flex flex-col gap-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
          {fg('Business name', 'storeName', inp('name', 'Your shop name', 'text', { autoComplete: 'organization' }), 'The name your customers know.')}
          {fg('What do you sell?', 'sell', inp('sell', 'Women’s clothing'), 'A few words is plenty — clothing, cosmetics, electronics.')}
          {fg('Open hours', 'hours', inp('hours', '10am–8pm, Sat–Thu'), 'So it never promises a call at midnight.')}
          {fg('Hotline', 'hotline', inp('hotline', '01XXXXXXXXX', 'tel', { autoComplete: 'tel' }), 'The number it gives a customer who asks to speak to a person.')}
          <div className="hidden md:block" />
          {fg('Address', 'address', inp('address', 'House 12, Road 4, Dhanmondi, Dhaka', 'text', { autoComplete: 'street-address' }), 'Where you are, if customers ever come to you.', true)}
        </div>

        <div className={subCard}>
          <h3 className="font-sans text-base font-bold text-white flex items-center gap-2.5"><Truck className="h-4 w-4 text-[#7aa8ff]" />Delivery</h3>
          <p className="font-sans text-sm text-white/45 leading-relaxed">Your assistant tells customers these, and an order adds the charge.</p>
          {([['Inside Dhaka', 'inC', 'inF', 'inS'], ['Outside Dhaka', 'outC', 'outF', 'outS']] as const).map(([label, c, fa, sl]) => (
            <div key={label} className="flex flex-col gap-3">
              <span className="font-sans text-sm font-bold text-white">{label}</span>
              <div className="grid grid-cols-3 gap-4">
                {fg('Charge (BDT)', c, inp(c, '', 'number', { min: 0 }))}
                {fg('Fastest (days)', fa, inp(fa, '', 'number', { min: 0 }))}
                {fg('Slowest (days)', sl, inp(sl, '', 'number', { min: 0 }))}
              </div>
            </div>
          ))}
          <p className="font-sans text-xs text-white/40">Days are counted from the day the parcel is handed to the courier.</p>
          <div className="flex flex-col gap-2.5">
            <span className="font-sans text-[13px] font-bold text-white">Days you do not ship (no parcel goes to the courier)</span>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => {
                const on = f.off.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('off', on ? f.off.filter((x) => x !== d) : [...f.off, d])}
                    className={`px-4 py-2 font-sans text-sm font-semibold cursor-pointer ${on ? 'btn-copilot' : 'glass-chip text-white/65 hover:text-white'}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className={subCard}>
          <h3 className="font-sans text-base font-bold text-white flex items-center gap-2.5"><MessageSquare className="h-4 w-4 text-[#7aa8ff]" />Messages to the customer when the order moves</h3>
          <p className="font-sans text-sm text-white/45 leading-relaxed">Sent in the customer’s chat by your assistant when you move an order to that status in the Orders list, only while the chat is still open (24 hours). Your assistant also uses these choices when a customer asks about their order.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ORDER_MSGS.map(([k, n, d]) => (
              <label key={n} className="glass-chip !rounded-2xl flex items-start gap-3 p-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={f.msgs[k]}
                  onChange={(e) => set('msgs', { ...f.msgs, [k]: e.target.checked })}
                  className="mt-1 w-4 h-4 accent-[#00a8e8]"
                />
                <span className="flex flex-col gap-1 min-w-0">
                  <span className="font-sans text-[14px] text-white"><b className="font-semibold">{n}</b> <span className="text-xs text-white/35">{MSG_DEFAULT[k] ? 'on' : 'off'} by default</span></span>
                  <span className="font-sans text-xs text-white/45 leading-relaxed">{d}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
          {fg('Anything else about delivery?', 'extra', area('extra', 'Free delivery on orders above BDT 2,000. Outside Dhaka the delivery charge is paid in advance.'), 'What the numbers above cannot say — free delivery above an amount, a charge paid in advance outside Dhaka, a charge by weight — or write “Nothing else”.')}
          {fg('How customers pay', 'pay', area('pay', 'Cash on delivery. bKash: 01XXXXXXXXX (personal). Outside Dhaka, the delivery charge is paid in advance.'), 'Write it the way you would tell a customer: cash on delivery or not, your bKash / Nagad number, and whether an advance is needed. Your assistant says exactly this.')}
          {fg('Returns and exchange', 'returns', area('returns', 'Exchange within 3 days if the product is unused and the tag is on. No cash refunds.'), 'Say within how many days and on what condition — or write “No returns or exchanges”.', true)}
          {fg('Language', null, (
            <div className={`${inputCls} opacity-70 cursor-not-allowed select-none`} aria-readonly="true">Bangla / English / Banglish — matches the customer</div>
          ), 'Fixed. Your assistant replies in whichever of Bangla, English or Banglish the customer writes in.')}
          {fg('How it addresses your customers', null, (
            <div className="flex flex-col gap-2.5 pt-1">
              {radio('addr', 'sir', 'Sir / Ma’am')}
              {radio('addr', 'bhaiya', 'Bhaiya / Apu')}
              <label className="flex items-center gap-2.5 font-sans text-[14px] text-white/85 cursor-pointer">
                <input type="checkbox" checked={f.firstName} onChange={(e) => set('firstName', e.target.checked)} className="w-4 h-4 accent-[#00a8e8]" />
                Put their first name first
              </label>
            </div>
          ), 'For example: Rina, Ma’am. Everywhere it speaks for you.')}
          {fg('First message', 'first', inp('first', 'Hello! How can we help you today?'), 'What it says when someone writes for the first time.', true)}
        </div>
      </section>

      <AnimatePresence mode="wait">
        {feedback && <Feedback key="form-fb" type={feedback.type} message={feedback.message} />}
      </AnimatePresence>

      <div className="flex items-center gap-5">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2.5 btn-copilot font-sans text-xs font-bold uppercase tracking-wider px-7 py-3.5"
        >
          {saving && <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
          {saving ? 'Saving…' : submitLabel}
          {!saving && <ArrowRight className="w-4 h-4" />}
        </button>
        <span className="font-sans text-xs text-white/35">Every field is required.</span>
      </div>
    </form>
  );
}
