import React, { useEffect, useState } from 'react';
import { CalendarDays, Check, Clock3, Plus, X } from 'lucide-react';
import DashboardHeader from './DashboardHeader';
import { ApiAppointment, createAppointment, listAppointments, updateAppointmentStatus } from '../lib/api';
import { Product } from '../types';
import { formatPrice, getCatalogCurrency } from '../../shared/currency';

function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

const statusLabel: Record<ApiAppointment['status'], string> = {
  REQUESTED: 'Requested',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

export default function BookingsPage({ products = [] }: { products?: Product[] }) {
  const storeCurrency = React.useMemo(() => getCatalogCurrency(products), [products]);
  const [appointments, setAppointments] = useState<ApiAppointment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    customerName: '', customerPhone: '', service: '',
    startsAt: toLocalInput(new Date(Date.now() + 60 * 60 * 1000)),
    endsAt: toLocalInput(new Date(Date.now() + 2 * 60 * 60 * 1000)),
    advanceAmount: '', advancePaymentMethod: '', advanceTransactionId: '', notes: '',
  });

  const load = () => {
    setLoading(true);
    listAppointments().then((data) => setAppointments(data.appointments)).catch((err) => setError(err.message || 'Unable to load bookings.')).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const created = await createAppointment({
        ...form,
        advanceAmount: form.advanceAmount ? Number(form.advanceAmount) : undefined,
      });
      setAppointments((current) => [...current, created].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
      setShowForm(false);
      setForm((current) => ({ ...current, customerName: '', customerPhone: '', service: '', advanceAmount: '', advancePaymentMethod: '', advanceTransactionId: '', notes: '' }));
    } catch (err: any) {
      setError(err.message || 'Unable to create booking.');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (appointment: ApiAppointment, status: ApiAppointment['status']) => {
    try {
      const updated = await updateAppointmentStatus(appointment.id, status);
      setAppointments((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (err: any) {
      setError(err.message || 'Unable to update booking.');
    }
  };

  return (
    <div className="w-full flex-grow flex flex-col text-left">
      <DashboardHeader searchPlaceholder="Search bookings…" />
      <main className="w-full flex-grow p-6 md:p-8 space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-white/40 font-bold">Services</p>
            <h1 className="mt-2 text-3xl font-bold text-white">Bookings</h1>
            <p className="mt-2 text-sm text-white/50">Review requests, record advance payments, and confirm appointment times.</p>
          </div>
          <button onClick={() => setShowForm((value) => !value)} className="btn-light-primary px-4 py-2.5 text-xs font-bold flex items-center gap-2 cursor-pointer">
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? 'Close form' : 'New booking'}
          </button>
        </header>

        {error && <div className="status-danger px-4 py-3 rounded-xl text-sm">{error}</div>}

        {showForm && (
          <form onSubmit={submit} className="zone-b-grey2 p-5 rounded-2xl border border-white/10 grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              ['customerName', 'Customer name', 'text'], ['customerPhone', 'Phone number', 'tel'], ['service', 'Service', 'text'],
              ['advanceAmount', 'Advance amount', 'number'], ['advancePaymentMethod', 'Payment method', 'text'], ['advanceTransactionId', 'Transaction ID', 'text'],
            ].map(([key, label, type]) => (
              <label key={key} className="space-y-1.5">
                <span className="text-[11px] text-white/55 font-bold uppercase tracking-wider">{label}</span>
                <input required={key === 'customerName' || key === 'service'} type={type} min={type === 'number' ? '0' : undefined} value={form[key as keyof typeof form]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="w-full bg-black/25 border border-white/15 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-white/40" />
              </label>
            ))}
            <label className="space-y-1.5"><span className="text-[11px] text-white/55 font-bold uppercase tracking-wider">Starts</span><input required type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} className="w-full bg-black/25 border border-white/15 rounded-xl px-3 py-2.5 text-sm text-white outline-none" /></label>
            <label className="space-y-1.5"><span className="text-[11px] text-white/55 font-bold uppercase tracking-wider">Ends</span><input required type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} className="w-full bg-black/25 border border-white/15 rounded-xl px-3 py-2.5 text-sm text-white outline-none" /></label>
            <label className="md:col-span-2 space-y-1.5"><span className="text-[11px] text-white/55 font-bold uppercase tracking-wider">Notes</span><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows={3} className="w-full bg-black/25 border border-white/15 rounded-xl px-3 py-2.5 text-sm text-white outline-none resize-y" /></label>
            <div className="md:col-span-2 flex justify-end"><button disabled={saving} className="btn-light-primary px-5 py-2.5 text-xs font-bold cursor-pointer disabled:opacity-50">{saving ? 'Saving…' : 'Create booking'}</button></div>
          </form>
        )}

        {loading ? <div className="zone-b-grey3 p-8 text-center text-sm text-white/45">Loading bookings…</div> : appointments.length === 0 ? <div className="zone-b-grey3 p-12 text-center"><CalendarDays className="mx-auto h-8 w-8 text-white/25" /><p className="mt-3 text-sm text-white/45">No bookings yet.</p></div> : <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">{appointments.map((appointment) => <article key={appointment.id} className="zone-b-grey3 p-5 rounded-2xl border border-white/10"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-white">{appointment.service}</h2><p className="mt-1 text-sm text-white/60">{appointment.customerName}{appointment.customerPhone ? ` · ${appointment.customerPhone}` : ''}</p></div><span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${appointment.status === 'CONFIRMED' ? 'status-success' : appointment.status === 'CANCELLED' ? 'status-danger' : 'status-warning'}`}>{statusLabel[appointment.status]}</span></div><div className="mt-4 flex items-center gap-2 text-xs text-white/65"><Clock3 className="h-4 w-4" />{formatDate(appointment.startsAt)} to {new Date(appointment.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>{appointment.advanceAmount != null && <p className="mt-3 text-xs text-white/55">Advance: {formatPrice(appointment.advanceAmount, storeCurrency)}{appointment.advancePaymentMethod ? ` via ${appointment.advancePaymentMethod}` : ''}{appointment.advanceTransactionId ? ` · ${appointment.advanceTransactionId}` : ''}</p>}{appointment.notes && <p className="mt-3 text-xs text-white/50 border-l-2 border-white/15 pl-3">{appointment.notes}</p>}<div className="mt-5 flex gap-2">{appointment.status === 'REQUESTED' && <button onClick={() => setStatus(appointment, 'CONFIRMED')} className="btn-light-primary px-3 py-2 text-xs font-bold flex items-center gap-1.5 cursor-pointer"><Check className="h-3.5 w-3.5" /> Confirm</button>}{appointment.status !== 'CANCELLED' && appointment.status !== 'COMPLETED' && <button onClick={() => setStatus(appointment, 'CANCELLED')} className="btn-glass px-3 py-2 text-xs font-bold text-red-300 flex items-center gap-1.5 cursor-pointer"><X className="h-3.5 w-3.5" /> Cancel</button>}</div></article>)}</div>}
      </main>
    </div>
  );
}