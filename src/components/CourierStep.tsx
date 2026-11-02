import React, { useEffect, useState } from 'react';
import { Check, Copy, ArrowRight } from 'lucide-react';
import { getCourier, saveCourier, skipCourier, disconnectCourier } from '../lib/api';
import type { CourierStatus } from '../lib/api';

type Choice = 'self' | 'pathao' | 'steadfast';

const FIELDS: Record<'pathao' | 'steadfast', [string, string, boolean][]> = {
  pathao: [['clientId', 'Client ID', false], ['clientSecret', 'Client Secret', true], ['storeId', 'Store ID', false]],
  steadfast: [['apiKey', 'API Key', false], ['secretKey', 'Secret Key', true]],
};
const HELP = {
  pathao: 'Pathao: merchant panel → Developer API gives the Client ID and Client Secret; your store page shows the Store ID.',
  steadfast: 'Steadfast: merchant portal → API gives the API Key and Secret Key.',
};

const card = 'zone-b-grey2';
const inputCls = 'zone-b-input w-full px-4 py-3.5 text-[15px] text-white placeholder-white/25 disabled:opacity-50';

export default function CourierStep({ onChange, onDone }: { onChange: (s: CourierStatus) => void; onDone: () => void }) {
  const [status, setStatus] = useState<CourierStatus | null>(null);
  const [choice, setChoice] = useState<Choice>('pathao');
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const apply = (s: CourierStatus) => {
    setStatus(s);
    if (s.provider) setChoice(s.provider);
    else if (s.skipped) setChoice('self');
    onChange(s);
  };

  useEffect(() => {
    getCourier().then(apply).catch(() => setError('Could not load courier settings.'));
  }, []);

  const run = async (fn: () => Promise<CourierStatus>, after?: () => void) => {
    setBusy(true);
    setError('');
    try {
      apply(await fn());
      setKeys({});
      after?.();
    } catch (e: any) {
      setError(e?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 1500);
  };

  const connected = status?.connected && status.provider === choice;
  const fields = choice === 'self' ? [] : FIELDS[choice];
  const label = choice === 'pathao' ? 'Pathao' : 'Steadfast';

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {([['self', 'I’ll book parcels myself'], ['pathao', 'Pathao'], ['steadfast', 'Steadfast']] as [Choice, string][]).map(([id, text]) => (
          <button
            key={id}
            type="button"
            onClick={() => { setChoice(id); setError(''); }}
            className={`px-5 py-4 rounded-full border font-sans text-[15px] font-semibold cursor-pointer transition-colors ${choice === id ? 'tab-glass tab-glass-on border-[#3d7bff]/70 text-white' : (id === 'self' ? status?.skipped : status?.connected && status.provider === id) ? 'tab-glass tab-glass-done border-emerald-400/40 text-emerald-300' : 'tab-glass border-white/15 text-white/60 hover:text-white'}`}
          >
            {text}
            {id === 'self' ? (status?.skipped && <span className="ml-2 text-emerald-300">· chosen</span>) : (status?.connected && status.provider === id && <span className="ml-2 text-emerald-300">· connected</span>)}
          </button>
        ))}
      </div>

      {error && <div className="status-danger text-sm p-3.5 rounded-xl font-sans">{error}</div>}

      {choice !== 'self' && (
        <section className={`${card} p-8 flex flex-col gap-6`}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {fields.map(([key, l, secret]) => (
              <div key={key} className="flex flex-col gap-2">
                <label className="font-sans text-[13px] font-bold text-white">{l}</label>
                <input
                  type={secret ? 'password' : 'text'}
                  autoComplete="off"
                  disabled={busy}
                  value={keys[key] || ''}
                  placeholder={connected ? 'Saved — type to replace' : ''}
                  onChange={(e) => setKeys((k) => ({ ...k, [key]: e.target.value }))}
                  className={inputCls}
                />
              </div>
            ))}
          </div>
          <p className="font-sans text-xs text-white/40">{HELP[choice as 'pathao' | 'steadfast']} Your keys are stored encrypted and never shown again.</p>

          <div className="flex flex-col gap-4 pt-2">
            <h3 className="font-sans text-base font-bold text-white">Tell {label} where to send its updates</h3>
            <p className="font-sans text-sm text-white/45">Paste the address and the token into the Webhook section of the courier’s panel (for Steadfast, the token is the Auth token). They are already filled in for you — just copy them. Pathao and Steadfast will then tell us when a parcel is picked up, out for delivery and delivered, and the order updates by itself.</p>
            {([['Webhook address', status?.webhookUrls[choice as 'pathao' | 'steadfast']], ['Token', status?.webhookToken]] as [string, string | null | undefined][]).map(([l, v]) => (
              <div key={l} className="flex flex-col gap-2">
                <span className="font-sans text-[13px] font-bold text-white">{l}</span>
                <div className="relative">
                  <input readOnly value={v || ''} placeholder="Loading…" className={`${inputCls} font-mono text-sm pr-14`} />
                  {v && (
                    <button type="button" onClick={() => copy(v, l)} aria-label={`Copy ${l}`} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white cursor-pointer">
                      {copied === l ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              disabled={busy || fields.some(([k]) => !(keys[k] || '').trim())}
              onClick={() => run(() => saveCourier(choice as 'pathao' | 'steadfast', keys), onDone)}
              className="inline-flex items-center gap-2.5 btn-copilot font-sans text-xs font-bold uppercase tracking-wider px-7 py-3.5"
            >
              {busy ? 'Saving…' : connected ? 'Update and continue' : 'Save and continue'}<ArrowRight className="h-4 w-4" />
            </button>
            {connected && (
              <button type="button" disabled={busy} onClick={() => run(disconnectCourier)} className="font-sans text-xs font-bold uppercase tracking-wider text-white/50 hover:text-white cursor-pointer">Disconnect</button>
            )}
            {connected && <span className="inline-flex items-center gap-1.5 font-sans text-sm text-emerald-300"><Check className="h-4 w-4" />{label} connected</span>}
          </div>
        </section>
      )}

      {choice === 'self' && (
        <section className={`${card} p-8 flex flex-col gap-5`}>
          <p className="font-sans text-[15px] text-white/70 leading-relaxed">You will book parcels with your courier yourself. When you mark an order “In transit”, your customer is told it is on its way — without a tracking link. You can connect Pathao or Steadfast any time later to send tracking links.</p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(skipCourier, onDone)}
              className="inline-flex items-center gap-2.5 btn-copilot font-sans text-xs font-bold uppercase tracking-wider px-7 py-3.5"
            >
              I book parcels myself<ArrowRight className="h-4 w-4" />
            </button>
            {status?.skipped && <span className="inline-flex items-center gap-1.5 font-sans text-sm text-emerald-300"><Check className="h-4 w-4" />Saved</span>}
          </div>
        </section>
      )}

      <p className="font-sans text-xs text-white/40 leading-relaxed">Choosing how parcels are sent is needed to go live. With Pathao or Steadfast connected, marking an order “In transit” on the Orders page sends your customer a tracking link from your assistant. When you book a parcel in the courier’s panel, type the order’s Ref from the Orders list (shown under the customer’s name) as the Invoice / Merchant Order ID — that is how updates find the right order. Parcel booking from here is not switched on yet.</p>
    </div>
  );
}
