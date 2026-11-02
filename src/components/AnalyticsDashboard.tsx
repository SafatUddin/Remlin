import React, { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Bot, CalendarDays, Clock3, Gauge, Hourglass, Inbox, MessageSquare, TrendingUp, Undo2, ChevronDown, Check, User, Users, Zap, AlertTriangle, Timer } from 'lucide-react';
import { fetchAnalytics, ApiAnalytics } from '../lib/api';
import DashboardHeader from './DashboardHeader';

const COLORS = { blue: '#4d8bff', cyan: '#63d8ff', white: '#ffffff', customer: 'rgba(255,255,255,0.45)', muted: 'rgba(255,255,255,0.42)' };
const chartTooltip = { backgroundColor: '#0d0f15', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' };
const axisProps = { stroke: COLORS.muted, fontSize: 11, tickLine: false } as const;

const fmtDur = (s: number | null | undefined) => {
  if (s == null) return null;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round((s / 3600) * 10) / 10}h`;
};

function Stat({ icon: Icon, label, value, unit, sub, tone }: { icon: typeof Activity; label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; tone?: 'blue' }) {
  return (
    <div className="zone-b-grey3 p-5 flex flex-col gap-3 min-h-[118px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.12em] font-bold text-white/50">{label}</span>
        <Icon className="h-4 w-4" style={{ color: tone === 'blue' ? COLORS.blue : 'rgba(255,255,255,0.45)' }} />
      </div>
      <div className="flex items-end gap-1.5">
        <strong className="text-[30px] leading-none font-bold text-white">{value}</strong>
        {unit && <span className="text-sm text-white/45 mb-0.5">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-white/40 mt-auto">{sub}</div>}
    </div>
  );
}

function Panel({ title, icon: Icon, subtitle, children, className = '' }: { title: string; icon?: typeof Activity; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`zone-b-grey2 min-w-0 p-6 flex flex-col ${className}`}>
      <h3 className="text-[15px] font-bold text-white flex items-center gap-2">{Icon && <Icon className="h-4 w-4 text-white/60" />}{title}</h3>
      {subtitle && <p className="mt-1.5 text-xs text-white/40 font-mono">{subtitle}</p>}
      {children}
    </section>
  );
}

function SecHead({ icon: Icon, title, note }: { icon: typeof Activity; title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 pt-2">
      <b className="flex items-center gap-2 text-[15px] text-white"><Icon className="h-4 w-4 text-white/60" />{title}</b>
      <span className="text-xs text-white/40">· {note}</span>
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return <div className="flex flex-wrap gap-4 mt-3 text-xs text-white/55">{items.map(([name, color]) => <span key={name} className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />{name}</span>)}</div>;
}

function Donut({ data, center, centerLabel }: { data: { name: string; value: number; color: string }[]; center: React.ReactNode; centerLabel: string }) {
  const total = data.reduce((n, d) => n + d.value, 0);
  const shown = total > 0 ? data : [{ name: 'none', value: 1, color: 'rgba(255,255,255,0.08)' }];
  return (
    <div className="relative h-[170px] my-4">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={shown} dataKey="value" nameKey="name" innerRadius={54} outerRadius={74} paddingAngle={total > 0 ? 3 : 0} stroke="none">
            {shown.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          {total > 0 && <Tooltip contentStyle={chartTooltip} />}
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <strong className="text-2xl text-white font-bold">{center}</strong>
        <span className="text-[11px] text-white/45">{centerLabel}</span>
      </div>
    </div>
  );
}

function SplitRow({ icon: Icon, label, count, pct, color = COLORS.blue }: { icon: typeof Activity; label: string; count: number; pct: string; color?: string }) {
  return (
    <div className="flex items-center gap-3 py-2 text-sm text-white/70">
      <Icon className="h-4 w-4" style={{ color }} />
      <span className="flex-1">{label}</span>
      <b className="text-white">{count}</b>
      <span className="w-10 text-right text-white/40 text-xs">{pct}</span>
    </div>
  );
}

const RANGE_OPTIONS: { days: number; label: string }[] = [
  { days: 7, label: '7 days' },
  { days: 15, label: '15 days' },
  ...Array.from({ length: 12 }, (_, i) => ({ days: i === 11 ? 365 : (i + 1) * 30, label: `${i + 1} month${i ? 's' : ''}` })),
];

function RangeSelect({ value, onChange }: { value: number; onChange: (days: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const current = RANGE_OPTIONS.find((o) => o.days === value) ?? RANGE_OPTIONS[0];
  return (
    <div ref={ref} className="relative self-start md:self-auto">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="tab-glass tab-glass-on flex items-center gap-3 rounded-full px-5 py-2.5 text-sm font-semibold text-white cursor-pointer min-w-[170px] justify-between"
      >
        <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-white/70" />{current.label}</span>
        <ChevronDown className={`h-4 w-4 text-white/70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="listbox" className="zone-b-grey3 absolute right-0 z-30 mt-2 w-full min-w-[190px] max-h-[264px] overflow-y-auto py-2 shadow-[0_18px_44px_rgba(0,0,0,0.65)]">
          {RANGE_OPTIONS.map((o) => (
            <li key={o.days} role="option" aria-selected={o.days === value}>
              <button
                type="button"
                onClick={() => { onChange(o.days); setOpen(false); }}
                className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-left cursor-pointer transition-colors ${o.days === value ? 'text-white bg-[#3d7bff]/25' : 'text-white/65 hover:text-white hover:bg-white/[0.08]'}`}
              >
                {o.label}
                {o.days === value && <Check className="h-4 w-4 text-[#7aa8ff]" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const pctOf = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '0%');
const Empty = ({ text }: { text: string }) => <p className="mt-4 text-xs text-white/40 font-mono">{text}</p>;

export default function AnalyticsDashboard() {
  const [range, setRange] = useState<number>(30);
  const [data, setData] = useState<ApiAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetchAnalytics(range).then(setData).catch(() => setError(true)).finally(() => setLoading(false));
  }, [range]);

  const rangeLabel = (RANGE_OPTIONS.find((o) => o.days === range)?.label ?? `${range} days`).replace(/^1 months?$/, '1 month');
  const k = data?.kpis;
  const series = data?.series ?? [];
  const v = (n: number | undefined) => (loading ? '—' : n ?? 0);
  const totalConvs = (k?.aiAloneConversations ?? 0) + (k?.humanSteppedIn ?? 0);
  const aiAlonePct = totalConvs > 0 ? `${Math.round(((k?.aiAloneConversations ?? 0) / totalConvs) * 100)}%` : '—';
  const split = data?.currentSplit;
  const splitTotal = split ? split.aiManaged + split.humanActive + split.closed : 0;
  const hourly = (data?.hourly ?? new Array(24).fill(0)).map((count, hour) => ({ hour, count }));
  const sources = data?.bySource ?? [];
  const sourceTotal = sources.reduce((n, s) => n + s.conversations, 0);
  const dash = (s?: number | null) => fmtDur(s) ?? 'no replies yet';

  const chip = (active: boolean) => `px-5 py-2.5 rounded-full text-sm font-semibold cursor-pointer tab-glass ${active ? 'tab-glass-on text-white' : 'text-white/60 hover:text-white'}`;

  return (
    <div className="w-full flex-grow flex flex-col text-left">
      <DashboardHeader searchPlaceholder="Search analytics…" />
      <main className="w-full flex-grow flex flex-col gap-6 px-6 md:px-10 py-8">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-5">
          <div className="space-y-1.5 max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/40 font-bold">Analytics</p>
            <h1 className="text-[32px] font-bold text-white tracking-tight">Analytics</h1>
            <p className="text-sm text-white/55">Messages handled, how much the AI finishes alone, and how fast the first reply comes — plus handoff volume and reversions.</p>
          </div>
          <RangeSelect value={range} onChange={setRange} />
        </header>

        {error ? (
          <div className="h-64 flex items-center justify-center text-sm text-white/45">Unable to load analytics data.</div>
        ) : (
          <>
            <SecHead icon={MessageSquare} title="Conversations" note={`from your own message history · last ${rangeLabel} · Asia/Dhaka`} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              <Stat icon={Inbox} label="Messages handled" value={loading ? '—' : (k?.customerMessages ?? 0) + (k?.aiReplies ?? 0) + (k?.humanReplies ?? 0)} sub={<span className="font-mono">{k?.customerMessages ?? 0} in · {(k?.aiReplies ?? 0) + (k?.humanReplies ?? 0)} out</span>} />
              <Stat icon={Bot} tone="blue" label="AI replies" value={v(k?.aiReplies)} />
              <Stat icon={User} label="Human replies" value={v(k?.humanReplies)} />
              <Stat icon={Users} label="People reached" value={v(k?.peopleReached)} sub={<span className="font-mono">{k?.peopleReached ?? 0} conversations</span>} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              <Panel title="Messages per day" className="lg:col-span-8">
                <Legend items={[['Customer', COLORS.customer], ['AI', COLORS.blue], ['Human', COLORS.white]]} />
                <div className="h-[210px] mt-5"><ResponsiveContainer width="100%" height="100%"><BarChart data={series} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} /><XAxis dataKey="date" {...axisProps} /><YAxis {...axisProps} axisLine={false} allowDecimals={false} /><Tooltip contentStyle={chartTooltip} cursor={{ fill: 'rgba(255,255,255,0.04)' }} /><Bar name="Customer" dataKey="customerMessages" fill={COLORS.customer} radius={[3, 3, 0, 0]} /><Bar name="AI" dataKey="aiReplies" fill={COLORS.blue} radius={[3, 3, 0, 0]} /><Bar name="Human" dataKey="humanReplies" fill={COLORS.white} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
              </Panel>
              <Panel title="Handled by AI alone" subtitle="conversations the AI finished with no person stepping in" className="lg:col-span-4">
                <Donut center={aiAlonePct} centerLabel="AI only" data={[{ name: 'AI alone', value: k?.aiAloneConversations ?? 0, color: COLORS.blue }, { name: 'A person stepped in', value: k?.humanSteppedIn ?? 0, color: COLORS.white }]} />
                <SplitRow icon={Bot} label="AI handled it alone" count={k?.aiAloneConversations ?? 0} pct={pctOf(k?.aiAloneConversations ?? 0, totalConvs)} />
                <SplitRow icon={User} label="A person stepped in" count={k?.humanSteppedIn ?? 0} pct={pctOf(k?.humanSteppedIn ?? 0, totalConvs)} color={COLORS.white} />
                <p className="text-xs text-white/40 font-mono mt-2">{k?.aiAloneConversations ?? 0} of {totalConvs} conversations</p>
              </Panel>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              <Panel title="When people message" icon={CalendarDays} subtitle="hour of the day in Asia/Dhaka — when a person should be around" className="lg:col-span-8">
                <div className="h-[130px] mt-5"><ResponsiveContainer width="100%" height="100%"><AreaChart data={hourly} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} /><XAxis dataKey="hour" {...axisProps} ticks={[0, 6, 12, 18, 23]} tickFormatter={(h) => (h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`)} /><YAxis {...axisProps} axisLine={false} allowDecimals={false} /><Tooltip contentStyle={chartTooltip} labelFormatter={(h) => `${h}:00`} /><Area type="monotone" dataKey="count" name="Messages" stroke={COLORS.cyan} fill="rgba(99,216,255,0.14)" /></AreaChart></ResponsiveContainer></div>
              </Panel>
              <Panel title="How fast the first reply comes" icon={Clock3} subtitle="median wait after a customer opens a conversation" className="lg:col-span-4">
                <div className="mt-4 divide-y divide-white/[0.06]">
                  <div className="flex items-center gap-3 py-3 text-sm text-white/70"><Bot className="h-4 w-4 text-white/50" /><span className="flex-1">AI</span><b className="text-white">{dash(k?.medianAiResponseSeconds)}</b></div>
                  <div className="flex items-center gap-3 py-3 text-sm text-white/70"><User className="h-4 w-4 text-white/50" /><span className="flex-1">Human</span><b className="text-white">{dash(k?.medianHumanResponseSeconds)}</b></div>
                </div>
                <p className="text-xs text-white/45 mt-auto pt-4 leading-relaxed">The SLA clock below only counts chats a person took over. This counts every reply, so it can see what the AI answered by itself.</p>
              </Panel>
            </div>

            <div className="grid grid-cols-1 gap-5">
              <Panel title="What arrives, and where from">
                {sources.length ? <div className="mt-3">{sources.map((s) => <SplitRow key={s.source} icon={MessageSquare} label={s.source.charAt(0).toUpperCase() + s.source.slice(1)} count={s.conversations} pct={pctOf(s.conversations, sourceTotal)} />)}</div> : <Empty text="No messages in this window." />}
              </Panel>
            </div>

            <SecHead icon={Activity} title="Handoffs" note="when a chat moved between the AI and a person" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              <Stat icon={TrendingUp} label="Handoffs to humans" value={v(data?.handoffs.requestsToHumans)} />
              <Stat icon={Undo2} label="Auto-reversions" value={v(data?.handoffs.autoReturned)} />
              <Stat icon={Activity} label="Total events" value={v(data?.handoffs.totalEvents)} />
              <Stat icon={Timer} label="Avg events / day" value={v(data?.handoffs.averageEventsPerDay)} />
            </div>

            <SecHead icon={Zap} title="Response & SLA" note={`how fast humans pick up · first-response target 15m · last ${rangeLabel}`} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              <Stat icon={Gauge} label="Avg first response" value={loading ? '—' : fmtDur(k?.averageResponseTimeSeconds) ?? '0'} />
              <Stat icon={AlertTriangle} label="SLA breach rate" value={v(k?.slaBreachRate)} unit="%" />
              <Stat icon={User} label="Waiting now" value={v(k?.waitingConversations)} />
              <Stat icon={Hourglass} label="Longest wait now" value={loading ? '—' : fmtDur(k?.longestWaitingSeconds) ?? '0'} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              <Panel title="Activity over time" className="lg:col-span-8">
                <Legend items={[['Customer', COLORS.customer], ['Auto-replies', COLORS.blue]]} />
                <div className="h-[200px] mt-5"><ResponsiveContainer width="100%" height="100%"><AreaChart data={series} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} /><XAxis dataKey="date" {...axisProps} /><YAxis {...axisProps} axisLine={false} allowDecimals={false} /><Tooltip contentStyle={chartTooltip} /><Area type="monotone" dataKey="customerMessages" name="Customer" stroke={COLORS.white} fill="rgba(255,255,255,0.08)" /><Area type="monotone" dataKey="aiReplies" name="Auto-replies" stroke={COLORS.blue} fill="rgba(77,139,255,0.14)" /></AreaChart></ResponsiveContainer></div>
              </Panel>
              <Panel title="Current split" className="lg:col-span-4">
                <Donut center={splitTotal} centerLabel="Chats" data={[{ name: 'AI', value: split?.aiManaged ?? 0, color: COLORS.blue }, { name: 'Human', value: split?.humanActive ?? 0, color: COLORS.white }, { name: 'Resolved', value: split?.closed ?? 0, color: 'rgba(255,255,255,0.35)' }]} />
                <SplitRow icon={Bot} label="AI" count={split?.aiManaged ?? 0} pct={pctOf(split?.aiManaged ?? 0, splitTotal)} />
                <SplitRow icon={User} label="Human" count={split?.humanActive ?? 0} pct={pctOf(split?.humanActive ?? 0, splitTotal)} color={COLORS.white} />
                <SplitRow icon={Timer} label="Resolved" count={split?.closed ?? 0} pct={pctOf(split?.closed ?? 0, splitTotal)} color="rgba(255,255,255,0.6)" />
              </Panel>
            </div>

            <div className="grid grid-cols-1 gap-5">
              <Panel title="By source">
                {sources.length ? <div className="mt-3">{sources.map((s) => <SplitRow key={s.source} icon={MessageSquare} label={s.source.charAt(0).toUpperCase() + s.source.slice(1)} count={s.conversations} pct={pctOf(s.conversations, sourceTotal)} />)}</div> : <Empty text="No data." />}
              </Panel>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
