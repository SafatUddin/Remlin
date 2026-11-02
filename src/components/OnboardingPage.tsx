import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Lock, ArrowRight, ArrowLeft, Building2, Plug, Package, Bot, Rocket, Truck } from 'lucide-react';
import type { Tab } from '../types';
import type { PublicMerchant, PublicStore, OnboardingResponse } from '../lib/api';
import BusinessProfileForm from './BusinessProfileForm';
import CourierStep from './CourierStep';
import PersonaStep from './PersonaStep';
import { AIPersona } from '../types';
import { getCourier } from '../lib/api';
import type { CourierStatus } from '../lib/api';

interface OnboardingPageProps {
  merchant: PublicMerchant | null;
  store: PublicStore | null;
  onProfileSaved: (response: OnboardingResponse) => void;
  channelsPanel: React.ReactNode;
  persona: AIPersona;
  onSavePersona: (p: AIPersona) => Promise<void>;
  catalogPanel: React.ReactNode;
  profileComplete: boolean;
  merchantName?: string;
  productCount: number;
  connectedPlatforms: Set<string>;
  hasPersona: boolean;
  conversationCount: number;
  onNavigate: (tab: Tab) => void;
}

interface GuideRow {
  id: string;
  title: string;
  eta: string;
  step?: string;
  done: boolean;
  locked?: boolean;
  status: string;
  text: string;
  steps: string[];
  cta?: { label: string; to: Tab };
}

const TAB_ON = 'tab-glass tab-glass-on border-[#3d7bff]/70 text-white';
const TAB_DONE = 'tab-glass tab-glass-done border-emerald-400/40 text-emerald-300';
const TAB_OFF = 'tab-glass border-white/15 text-white/60 hover:text-white';

export default function OnboardingPage({
  merchant,
  store,
  onProfileSaved,
  channelsPanel,
  persona,
  onSavePersona,
  catalogPanel,
  profileComplete,
  merchantName,
  productCount,
  connectedPlatforms,
  hasPersona,
  conversationCount,
  onNavigate,
}: OnboardingPageProps) {
  const [courier, setCourier] = useState<CourierStatus | null>(null);
  useEffect(() => {
    if (profileComplete) getCourier().then(setCourier).catch(() => {});
  }, [profileComplete]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(() => (window.location.hash.startsWith('#onboarding?') ? (/shopify/i.test(window.location.hash) ? 'products' : 'channel') : null));

  const connected = connectedPlatforms.size > 0;
  const live = connected && conversationCount > 0;

  const rows: GuideRow[] = [
    {
      id: 'channel', step: 'channel', title: 'Connect your pages', eta: '2 min', done: connected, 
      status: connected ? 'Your page is connected.' : 'No page is connected.',
      text: 'Connecting your pages is what lets the assistant read and answer messages. Instagram and WhatsApp come with Meta sign-in.',
      steps: ['Press Connect on Facebook, Instagram or WhatsApp.', 'Sign in and choose your page.', 'Leave every permission switched on.'],
      cta: { label: 'Connect your pages', to: 'integrations' },
    },
    {
      id: 'business', step: 'business', title: 'Your business', eta: '3 min', done: profileComplete,
      status: profileComplete ? 'Saved — your assistant answers from it.' : 'Still missing: business name, what you sell, hotline and address',
      text: 'Your assistant answers from what you write here. What is not written, it does not know.',
      steps: ['Write what you sell, your open hours and the number a customer can call.', 'Add your address, delivery charges and how customers pay, then press Save.'],
      cta: { label: 'Fill it in', to: 'settings' },
    },
    {
      id: 'products', step: 'products', title: 'Add your products', eta: '10 min', done: productCount > 0, locked: !profileComplete,
      status: productCount > 0 ? `${productCount} in the catalog.` : profileComplete ? 'Nothing in the catalog yet.' : 'Finish “Your business” first.',
      text: 'Your assistant sells only what is in your catalog — with the price, the stock and a photo it can recognise.',
      steps: ['Add products one by one, or connect your store.', 'Give each one a photo so the AI can match a customer’s picture.'],
      cta: { label: 'Add your products', to: 'catalog' },
    },
    {
      id: 'courier', step: 'courier', title: 'Connect your courier', eta: '5 min',
      done: !!courier && (courier.connected || courier.skipped), locked: !profileComplete,
      status: courier?.connected ? `${courier.provider === 'pathao' ? 'Pathao' : 'Steadfast'} is connected.` : courier?.skipped ? 'You book parcels yourself.' : profileComplete ? 'No courier is connected.' : 'Finish “Your business” first.',
      text: 'With a courier connected, your customer can be told where the parcel is without anybody typing it. Choose how parcels are sent — this is needed to go live.',
      steps: ['Choose Pathao or Steadfast, or “I’ll book parcels myself”.', 'Paste the keys from the courier’s panel and press Save.', 'Paste the webhook address and token shown into the courier’s panel.'],
      cta: { label: 'Connect a courier', to: 'settings' },
    },
    {
      id: 'persona', step: 'persona', title: 'Set your AI persona', eta: '3 min', done: hasPersona, locked: !profileComplete,
      status: hasPersona ? 'Instructions written.' : profileComplete ? 'Your assistant uses the default voice.' : 'Finish “Your business” first.',
      text: 'Tell your assistant how to talk and what rules to follow, such as payment and returns.',
      steps: ['Choose a tone and style.', 'Write your payment and return rules in the custom instructions.', 'Press Save.'],
      cta: { label: 'Open AI Persona', to: 'persona' },
    },
    {
      id: 'live', step: 'live', title: 'Go live', eta: 'Automatic', done: live, locked: !profileComplete || !connected || !(courier?.connected || courier?.skipped),
      status: live ? 'You are live — customers are getting answers.' : 'Starts once a channel is connected and a customer writes in.',
      text: 'After a channel is connected, your assistant answers everyone who writes to it. Conversations appear in the Inbox.',
      steps: [],
      cta: connected ? { label: 'Open Inbox', to: 'inbox' } : undefined,
    },
  ];

  const done = rows.filter((r) => r.done).length;
  const openStep = (r: GuideRow) => setStep(r.step!);
  const next = rows.find((r) => !r.done && !r.locked && r.cta);

  if (step) {
    const idx = rows.findIndex((r) => r.id === step);
    const cur = rows[idx];
    const icons: Record<string, React.ReactNode> = {
      business: <Building2 className="h-3.5 w-3.5" />, channel: <Plug className="h-3.5 w-3.5" />,
      products: <Package className="h-3.5 w-3.5" />, courier: <Truck className="h-3.5 w-3.5" />, persona: <Bot className="h-3.5 w-3.5" />, live: <Rocket className="h-3.5 w-3.5" />,
    };
    const prev = rows[idx - 1];
    const nxt = rows[idx + 1];
    const intros: Record<string, string> = {
      business: 'Everything your assistant says starts here: who you are, and where a customer can find you.',
      channel: 'Connect Facebook, Instagram and WhatsApp right here. Sign in once and your page starts receiving messages.',
      products: 'Your assistant sells only what is in your catalog. Add a few now — you can add the rest any time.',
      courier: 'Choosing how parcels are sent is needed to go live. A connected courier lets your customer get a tracking link as soon as you hand their order over.',
      persona: 'Tell your assistant how to talk and which rules to follow.',
      live: 'After a channel is connected, your assistant answers everyone who writes to it.',
    };
    const goButton = (label: string, to: Tab) => (
      <button
        onClick={() => onNavigate(to)}
        className="inline-flex items-center gap-2 glass-chip text-white font-sans text-[11px] font-bold uppercase tracking-wider px-3.5 py-2 rounded-lg transition-colors cursor-pointer"
      >
        {label}<ArrowRight className="h-3.5 w-3.5" />
      </button>
    );
    const primaryBtn = 'btn-copilot inline-flex items-center gap-2 font-sans text-xs uppercase tracking-wider px-6 py-3';
    const ghostBtn = 'glass-chip inline-flex items-center gap-2 text-white font-sans text-xs font-bold uppercase tracking-wider px-6 py-3 cursor-pointer';

    let body: React.ReactNode = null;
    if (step === 'business') {
      body = merchant && store ? (
        <BusinessProfileForm merchant={merchant} store={store} onComplete={(res) => { onProfileSaved(res); setStep('products'); }} />
      ) : null;
    } else if (step === 'channel') {
      body = <>{channelsPanel}</>;
    } else if (step === 'persona') {
      body = <PersonaStep key={persona.tone + '|' + persona.customInstructions} persona={persona} onSavePersona={onSavePersona} onDone={() => { const n = rows[idx + 1]; if (n && !n.locked) setStep(n.id); }} />;
    } else if (step === 'courier') {
      body = <CourierStep onChange={setCourier} onDone={() => { const n = rows[idx + 1]; if (n && !n.locked) setStep(n.id); }} />;
    } else if (step === 'products') {
      body = (
        <div className="flex flex-col gap-6">
          <section className="zone-b-grey2 px-6 py-4 flex items-center gap-3">
            {productCount > 0
              ? <span className="w-[18px] h-[18px] rounded-full bg-emerald-500 flex items-center justify-center"><Check className="h-3 w-3 text-black" strokeWidth={3} /></span>
              : <span className="w-[18px] h-[18px] rounded-full border border-white/30" />}
            <span className="font-sans text-[15px] font-semibold text-white">{productCount > 0 ? `${productCount} product${productCount === 1 ? '' : 's'} in your catalog` : 'Nothing in the catalog yet'}</span>
            <button onClick={() => onNavigate('catalog')} className="ml-auto font-sans text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white cursor-pointer inline-flex items-center gap-1.5">Open product catalog<ArrowRight className="h-3.5 w-3.5" /></button>
          </section>
          {catalogPanel}
        </div>
      );
    } else if (step === 'live') {
      const items: [string, boolean, boolean][] = [
        ['Your business written', profileComplete, true],
        ['Page connected', connected, true],
        ['Courier chosen', !!(courier?.connected || courier?.skipped), true],
        ['Products in the catalog', productCount > 0, false],
        ['AI persona written', hasPersona, false],
      ];
      body = (
        <section className="zone-b-grey2">
          <div className="flex items-center justify-between px-5 py-4">
            <span className="font-sans text-sm font-bold text-white">Before you go live</span>
            <span className="font-sans text-xs text-white/40">{items.filter((i) => i[1]).length} of {items.length}</span>
          </div>
          {items.map(([t, d, req]) => (
            <div key={t} className="flex items-center gap-3.5 px-5 py-3.5 ">
              {d ? (
                <span className="w-[18px] h-[18px] rounded-full bg-emerald-500 flex items-center justify-center shrink-0"><Check className="h-3 w-3 text-black" strokeWidth={3} /></span>
              ) : <span className="w-[18px] h-[18px] rounded-full border border-white/30 shrink-0" />}
              <span className="flex flex-col">
                <span className={`font-sans text-[14px] ${d ? 'font-semibold text-white' : 'text-white/60'}`}>{t}</span>
                <span className="font-sans text-xs text-white/40">{req ? 'Needed to go live' : 'Recommended'}</span>
              </span>
            </div>
          ))}
        </section>
      );
    } else {
      const info: Record<string, { text: string; label: string; to: Tab }> = {
      };
      const i = info[step];
      body = (
        <section className="zone-b-grey2 p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            {cur.done && <span className="w-[18px] h-[18px] rounded-full bg-emerald-500 flex items-center justify-center"><Check className="h-3 w-3 text-black" strokeWidth={3} /></span>}
            <span className="font-sans text-sm font-bold text-white">{cur.status}</span>
          </div>
          <p className="font-sans text-[13px] text-white/60 leading-relaxed">{i.text}</p>
          <ol className="list-decimal pl-4 space-y-1 font-sans text-[13px] text-white/60">{cur.steps.map((st) => <li key={st}>{st}</li>)}</ol>
          <div>{goButton(i.label, i.to)}</div>
        </section>
      );
    }

    const isLast = step === 'live';
    const continueNode = step === 'business' ? null : isLast ? (
      connected
        ? <button onClick={() => onNavigate('inbox')} className={primaryBtn}><Rocket className="h-3.5 w-3.5" />Open Inbox</button>
        : <button onClick={() => setStep(null)} className={primaryBtn}>Back to Onboarding<ArrowRight className="h-3.5 w-3.5" /></button>
    ) : (
      <button onClick={() => nxt && setStep(nxt.locked ? null : nxt.id)} className={primaryBtn}>Continue<ArrowRight className="h-3.5 w-3.5" /></button>
    );

    return (
      <div className="w-full flex-1 flex flex-col gap-7 px-8 lg:px-12 py-8">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="space-y-2">
            <p className="font-sans text-xs font-bold text-white/40 uppercase tracking-[0.18em]">Step {idx + 1} of {rows.length} · Let’s get you live</p>
            <h1 className="font-sans text-4xl font-bold text-white tracking-tight">{cur.title}</h1>
          </div>
          <div className="flex items-center gap-2.5 zone-b-grey2 px-4 py-2.5">
            <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${live ? 'text-emerald-300 bg-emerald-400/10' : 'text-amber-300 bg-amber-400/10'}`}>{live ? 'Live' : 'Practice mode'}</span>
            <p className="font-sans text-sm text-white/60">{live ? 'Your assistant answers every customer.' : 'Answers test chats only until you go live.'}</p>
          </div>
        </header>

        <nav className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4" aria-label="Setup steps">
          {rows.map((r) => {
            const on = r.id === step;
            const disabled = r.locked && !on;
            return (
              <button
                key={r.id}
                disabled={disabled}
                onClick={() => setStep(r.id)}
                aria-current={on ? 'step' : undefined}
                className={`flex items-center justify-center gap-2 px-4 py-3.5 rounded-full border font-sans text-sm font-semibold transition-colors ${
                  on ? TAB_ON : r.done ? TAB_DONE : TAB_OFF
                } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {r.done ? <Check className="h-4 w-4" strokeWidth={2.6} /> : disabled ? <Lock className="h-4 w-4" /> : icons[r.id]}
                <span className="truncate">{r.title}</span>
              </button>
            );
          })}
        </nav>

        <p className="rounded-xl zone-b-grey2 px-6 py-4 font-sans text-[15px] text-white/75">{intros[step]}</p>

        <div className="flex-1 flex flex-col">{body}</div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-6 ">
          <button onClick={() => setStep(prev ? prev.id : null)} className={ghostBtn}><ArrowLeft className="h-4 w-4" />Back</button>
          <p className="hidden lg:block font-sans text-xs text-white/35">Whatever you leave stays at the top of your Onboarding — it is not lost.</p>
          <div className="flex items-center gap-3">
            {!isLast && <button onClick={() => setStep(nxt && !nxt.locked ? nxt.id : null)} className={ghostBtn}>Later<ArrowRight className="h-4 w-4" /></button>}
            {continueNode}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-6 flex flex-col gap-5">
      <header className="space-y-1">
        <p className="font-sans text-[10px] font-bold text-white/40 uppercase tracking-[0.18em]">
          {merchantName ? `Welcome, ${merchantName}` : 'Welcome'}
        </p>
        <h1 className="font-sans text-2xl font-bold text-white tracking-tight">Onboarding</h1>
      </header>

      <section className="zone-b-grey2 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="font-sans text-sm font-bold text-white">Setup guide</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              live ? 'text-emerald-300 bg-emerald-400/10' : 'text-amber-300 bg-amber-400/10'
            }`}>
              {live ? 'Live' : 'Practice mode'}
            </span>
          </div>
          <button onClick={() => setStep(next?.id ?? rows.find((r) => !r.locked)!.id)} className="inline-flex items-center gap-1 font-sans text-xs text-white/50 hover:text-white cursor-pointer">
            Open the setup<ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-5 pt-5 pb-4 flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <div className="font-sans text-3xl font-bold text-white">
              {done}<span className="text-base font-semibold text-white/40"> / {rows.length}</span>
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <span className="font-sans text-xs text-white/50">{done} of {rows.length} done</span>
              <div className="w-full h-[5px] rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-white to-[#a9c6ff] transition-all" style={{ width: `${(done / rows.length) * 100}%` }} />
              </div>
            </div>
          </div>

          {next && (
            <div className="rounded-xl zone-b-grey2 p-5 flex flex-col gap-2.5">
              <span className="font-sans text-[10px] font-bold text-blue-300 uppercase tracking-[0.18em]">Next step</span>
              <h2 className="font-sans text-lg font-bold text-white">{next.title}</h2>
              <p className="font-sans text-[13px] text-white/60 leading-relaxed">{next.text}</p>
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => openStep(next)}
                  className="inline-flex items-center gap-2 btn-copilot font-sans text-xs font-bold uppercase tracking-wider px-6 py-3 rounded-lg hover:brightness-110 transition-all cursor-pointer"
                >
                  {next.cta!.label}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <span className="font-sans text-xs text-white/40">About {next.eta}.</span>
              </div>
            </div>
          )}
        </div>

        <div>
          <p className="px-5 pb-2 font-sans text-[10px] font-bold text-white/40 uppercase tracking-[0.18em]">Before you go live</p>
          <div className="">
            {rows.map((r) => {
              const open = openId === r.id;
              return (
                <div key={r.id} className="">
                  <button
                    onClick={() => setOpenId(open ? null : r.id)}
                    aria-expanded={open}
                    className={`w-full flex items-center gap-3.5 px-5 py-3.5 text-left hover:bg-white/[0.03] transition-colors cursor-pointer ${r.locked ? 'opacity-60' : ''}`}
                  >
                    {r.done ? (
                      <span className="w-[18px] h-[18px] rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                        <Check className="h-3 w-3 text-black" strokeWidth={3} />
                      </span>
                    ) : r.locked ? (
                      <Lock className="h-4 w-4 text-white/40 shrink-0" />
                    ) : (
                      <span className="w-[18px] h-[18px] rounded-full border border-white/30 shrink-0" />
                    )}
                    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="font-sans text-[14px] font-semibold text-white">{r.title}</span>
                      <span className="font-sans text-xs text-white/45 truncate">{r.status}</span>
                    </span>
                    <span className="font-sans text-xs text-white/40 shrink-0">{r.eta}</span>
                    {open ? <ChevronDown className="h-3.5 w-3.5 text-white/40" /> : <ChevronRight className="h-3.5 w-3.5 text-white/40" />}
                  </button>
                  {open && (
                    <div className="px-5 pb-5 pl-[52px] flex flex-col gap-3">
                      <p className="font-sans text-[13px] text-white/60 leading-relaxed">{r.text}</p>
                      {r.steps.length > 0 && (
                        <ol className="list-decimal pl-4 space-y-1 font-sans text-[13px] text-white/60">
                          {r.steps.map((st) => <li key={st}>{st}</li>)}
                        </ol>
                      )}
                      {r.cta && !r.locked && (
                        <div>
                          <button
                            onClick={() => openStep(r)}
                            className="inline-flex items-center gap-2 glass-chip text-white font-sans text-[11px] font-bold uppercase tracking-wider px-3.5 py-2 rounded-lg transition-colors cursor-pointer"
                          >
                            {r.cta.label}
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
