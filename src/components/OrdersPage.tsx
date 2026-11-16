import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Check } from 'lucide-react';
import { listOrders, updateOrderStatus, getCourier, getCachedOrders, getCachedCourier, ApiOrder } from '../lib/api';
import DashboardHeader from './DashboardHeader';
import { Product } from '../types';
import { ORDER_STATUS_OPTIONS, type OrderStatusLabel } from '../../shared/orderStatus';
import { formatPrice, getCatalogCurrency, getOrderCurrency } from '../../shared/currency';

function getStatusBadgeClass(status: string): string {
  if (status === 'Delivered') return 'status-success';
  if (status === 'Cancelled' || status === 'Delivery failed') return 'status-danger';
  if (status === 'In transit' || status === 'Out for delivery') return 'status-info';
  return 'status-warning';
}

function getStatusDotStyle(status: string): { background: string; boxShadow: string } {
  if (status === 'Delivered') {
    return { background: '#3ddc84', boxShadow: '0 0 8px rgba(61,220,132,0.85)' };
  }
  if (status === 'Cancelled' || status === 'Delivery failed') {
    return { background: '#ff7b6e', boxShadow: '0 0 8px rgba(244,72,58,0.85)' };
  }
  if (status === 'In transit' || status === 'Out for delivery') {
    return { background: '#63d8ff', boxShadow: '0 0 8px rgba(99,216,255,0.85)' };
  }
  return { background: '#ffcf6b', boxShadow: '0 0 8px rgba(240,180,60,0.85)' };
}

export default function OrdersPage({ products = [] }: { products?: Product[] }) {
  const storeCurrency = React.useMemo(() => getCatalogCurrency(products), [products]);
  const [orders, setOrders] = useState<ApiOrder[]>(() => getCachedOrders() ?? []);
  const [searchTerm, setSearchTerm] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(() => getCachedOrders() === null);

  const loadOrders = () => {
    listOrders()
      .then(setOrders)
      .catch((err) => console.error('Failed to load orders:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (getCachedOrders() === null) setLoading(true);
    loadOrders();
    const onOrdersUpdated = (e: Event) => {
      const updated = (e as CustomEvent<ApiOrder[]>).detail;
      if (Array.isArray(updated)) {
        setOrders(updated);
        setLoading(false);
      }
    };
    window.addEventListener('shopmate_orders_updated', onOrdersUpdated);
    return () => window.removeEventListener('shopmate_orders_updated', onOrdersUpdated);
  }, []);

  const [selfBooked, setSelfBooked] = useState<boolean>(() => {
    const cached = getCachedCourier();
    return cached ? !cached.connected : false;
  });
  useEffect(() => {
    getCourier().then((c) => setSelfBooked(!c.connected)).catch(() => {});
  }, []);
  const [transitFor, setTransitFor] = useState<ApiOrder | null>(null);
  const [trackingCode, setTrackingCode] = useState('');
  const [transitError, setTransitError] = useState('');
  const [statusMenu, setStatusMenu] = useState<{
    order: ApiOrder;
    top?: number;
    bottom?: number;
    left: number;
    placeAbove: boolean;
  } | null>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);

  const openStatusMenu = (order: ApiOrder, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const menuWidth = 212;
    const estimatedHeight = 290;
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < estimatedHeight && rect.top > estimatedHeight;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12));
    setStatusMenu((prev) =>
      prev?.order.id === order.id
        ? null
        : placeAbove
          ? { order, bottom: window.innerHeight - rect.top + 8, left, placeAbove: true }
          : { order, top: rect.bottom + 8, left, placeAbove: false }
    );
  };

  useEffect(() => {
    if (!statusMenu) return;
    const close = () => setStatusMenu(null);
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('[data-status-trigger]')) return;
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [statusMenu]);

  const handleStatusChange = async (id: string, status: OrderStatusLabel, code?: string) => {
    setUpdatingId(id);
    try {
      const updated = await updateOrderStatus(id, status, code);
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
      return true;
    } catch (err: any) {
      console.error('Failed to update order status:', err);
      if (status === 'In transit') setTransitError(err?.message || 'Failed to update order.');
      return false;
    } finally {
      setUpdatingId(null);
    }
  };

  const onStatusSelect = (order: ApiOrder, status: OrderStatusLabel) => {
    if (status === 'In transit' && order.status !== 'In transit') {
      setTrackingCode('');
      setTransitError('');
      setTransitFor(order);
      return;
    }
    handleStatusChange(order.id, status);
  };

  const confirmTransit = async () => {
    if (!transitFor) return;
    if (await handleStatusChange(transitFor.id, 'In transit', trackingCode.trim())) setTransitFor(null);
  };

  const handleCustomerClick = (order: ApiOrder) => {
    window.dispatchEvent(
      new CustomEvent('shopmate_open_conversation', {
        detail: {
          conversationId: order.conversationId,
          orderId: order.id,
          customerName: order.customerName,
        },
      })
    );
    window.dispatchEvent(new CustomEvent('shopmate_navigate', { detail: 'inbox' }));
  };

  const filteredOrders = orders.filter((o) =>
    o.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (o.customerPhone || '').includes(searchTerm) ||
    o.items.some((i) => i.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="w-full flex-grow flex flex-col text-left">
      <DashboardHeader
        searchPlaceholder="Search orders…"
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
      />

      <div className="w-full flex-grow space-y-4 sm:space-y-6 p-3.5 sm:p-6 md:p-8">
        <div className="zone-b-grey2 p-4 sm:p-6 space-y-4 sm:space-y-5">
          <div className="flex justify-between items-center pb-3 sm:pb-4 border-b border-white/[0.07]">
            <div>
              <h3 className="font-sans font-bold text-lg sm:text-[19px] text-white tracking-tight">Orders</h3>
              <p className="text-xs sm:text-[13px] text-white/55 mt-0.5">
                {filteredOrders.length} order{filteredOrders.length === 1 ? '' : 's'} generated from customer conversations
              </p>
            </div>
          </div>

          <div className="border border-white/[0.07] rounded-2xl overflow-hidden bg-black/30 w-full">
            <div className="max-h-[600px] overflow-y-auto overflow-x-auto scrollbar-thin scrollbar-thumb-white/10 w-full">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="p-8 text-center text-white/40 font-sans text-xs">
                  No orders recorded yet. Orders appear here once confirmed from customer conversations.
                </div>
              ) : (
                <>
                  {/* Mobile Order Cards View (< md) */}
                  <div className="md:hidden divide-y divide-white/[0.07]">
                    {filteredOrders.map((order) => {
                      const statusClass = getStatusBadgeClass(order.status);
                      const dotStyle = getStatusDotStyle(order.status);
                      const isMenuOpen = statusMenu?.order.id === order.id;

                      const phone = order.customerPhone || '';
                      const address = order.address;

                      return (
                        <div key={order.id} className="p-4 space-y-3 hover:bg-white/[0.02] transition-colors">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => handleCustomerClick(order)}
                                title="Open customer conversation in Inbox"
                                className="font-sans font-bold text-white hover:text-[#7aa8ff] hover:underline underline-offset-2 text-[15px] truncate block text-left transition-colors cursor-pointer"
                              >
                                {order.customerName}
                              </button>
                              <div className="flex items-center gap-2 mt-0.5">
                                <button
                                  type="button"
                                  onClick={() => navigator.clipboard?.writeText(order.id.slice(-8).toUpperCase())}
                                  title="Copy order reference"
                                  className="font-mono text-[11px] text-white/45 hover:text-white cursor-pointer"
                                >
                                  Ref {order.id.slice(-8).toUpperCase()} · copy
                                </button>
                                <span className="text-white/20">·</span>
                                <span className="font-sans text-[11px] text-white/40">
                                  {new Date(order.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                </span>
                              </div>
                            </div>
                            <span className="font-sans text-[15px] font-bold text-white shrink-0">
                              {formatPrice(order.total, getOrderCurrency(order.items, products, storeCurrency))}
                            </span>
                          </div>

                          <div className="text-xs font-sans text-white/75 bg-white/[0.03] border border-white/[0.06] rounded-xl p-2.5 space-y-1">
                            {order.items.map((item, idx) => (
                              <div key={idx} className="flex justify-between gap-2">
                                <span className="truncate">{item.name}</span>
                                <span className="text-white/50 shrink-0 font-semibold">×{item.quantity}</span>
                              </div>
                            ))}
                          </div>

                          {(phone || address) && (
                            <div className="space-y-1 text-xs font-sans text-white/55">
                              {phone && <div><span className="text-white/35">Phone: </span>{phone}</div>}
                              {address && <div className="break-words"><span className="text-white/35">Address: </span>{address}</div>}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <div>
                              <button
                                type="button"
                                data-status-trigger={order.id}
                                aria-haspopup="listbox"
                                aria-expanded={isMenuOpen}
                                disabled={updatingId === order.id}
                                onClick={(e) => openStatusMenu(order, e.currentTarget)}
                                className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold cursor-pointer outline-none transition-all hover:brightness-110 disabled:opacity-50 ${statusClass}`}
                              >
                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={dotStyle} />
                                <span>{order.status}</span>
                                <ChevronDown className={`h-3.5 w-3.5 opacity-75 transition-transform duration-150 ${isMenuOpen ? 'rotate-180' : ''}`} />
                              </button>
                              {order.status === 'In transit' && order.trackingUrl && (
                                <a href={order.trackingUrl} target="_blank" rel="noreferrer" className="block mt-1.5 text-[11px] text-[#7aa8ff] hover:underline truncate max-w-[200px]" title={order.trackingUrl}>
                                  Track · {order.trackingCode}
                                </a>
                              )}
                            </div>

                            {order.status !== 'Cancelled' && order.status !== 'Delivered' && (
                              <button
                                onClick={() => handleStatusChange(order.id, 'Cancelled')}
                                disabled={updatingId === order.id}
                                className="px-3.5 py-1.5 text-xs font-bold rounded-full bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-50 cursor-pointer"
                              >
                                {updatingId === order.id ? 'Cancelling…' : 'Cancel'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop Table View (md+) */}
                  <table className="hidden md:table w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-white/[0.05] border-b border-white/[0.07] text-[11px] font-sans text-white/50 tracking-[0.11em] font-bold">
                        <th className="p-4">Customer</th>
                        <th className="p-4">Items</th>
                        <th className="p-4">Phone</th>
                        <th className="p-4">Address</th>
                        <th className="p-4">Total</th>
                        <th className="p-4">Status</th>
                        <th className="p-4">Placed</th>
                        <th className="p-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.055] font-sans text-[14px]">
                      {filteredOrders.map((order) => {
                        const statusClass = getStatusBadgeClass(order.status);
                        const dotStyle = getStatusDotStyle(order.status);
                        const isMenuOpen = statusMenu?.order.id === order.id;

                        const phone = order.customerPhone || '';
                        const address = order.address;

                        return (
                          <tr key={order.id} className="hover:bg-white/[0.03] transition-colors">
                            <td className="p-4 font-sans font-bold text-white">
                              <button
                                type="button"
                                onClick={() => handleCustomerClick(order)}
                                title="Open customer conversation in Inbox"
                                className="font-sans font-bold text-white hover:text-[#7aa8ff] hover:underline underline-offset-2 text-left transition-colors cursor-pointer"
                              >
                                {order.customerName}
                              </button>
                              <button
                                type="button"
                                onClick={() => navigator.clipboard?.writeText(order.id.slice(-8).toUpperCase())}
                                title="Copy this order reference — enter it as the Invoice / Merchant Order ID when you book the parcel, so courier updates reach this order"
                                className="block mt-1 font-mono text-[11px] font-normal text-white/40 hover:text-white cursor-pointer"
                              >
                                Ref {order.id.slice(-8).toUpperCase()} · copy
                              </button>
                            </td>
                            <td className="p-4 text-white/70">
                              {order.items.map((item) => `${item.name} ×${item.quantity}`).join(', ')}
                            </td>
                            <td className="p-4 text-white/50">{phone || '—'}</td>
                            <td className="p-4 text-white/50 max-w-[240px] truncate" title={address}>{address || '—'}</td>
                            <td className="p-4 font-sans text-white font-bold">{formatPrice(order.total, getOrderCurrency(order.items, products, storeCurrency))}</td>
                            <td className="p-4">
                              <button
                                type="button"
                                data-status-trigger={order.id}
                                aria-haspopup="listbox"
                                aria-expanded={isMenuOpen}
                                disabled={updatingId === order.id}
                                onClick={(e) => openStatusMenu(order, e.currentTarget)}
                                className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold cursor-pointer outline-none transition-all hover:brightness-110 whitespace-nowrap disabled:opacity-50 ${statusClass}`}
                              >
                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={dotStyle} />
                                <span>{order.status}</span>
                                <ChevronDown className={`h-3.5 w-3.5 opacity-75 transition-transform duration-150 ${isMenuOpen ? 'rotate-180' : ''}`} />
                              </button>
                              {order.status === 'In transit' && order.trackingUrl && (
                                <a href={order.trackingUrl} target="_blank" rel="noreferrer" className="block mt-1.5 text-[11px] text-[#7aa8ff] hover:underline truncate max-w-[170px]" title={order.trackingUrl}>
                                  Track · {order.trackingCode}
                                </a>
                              )}
                            </td>
                            <td className="p-4 text-white/40 text-xs">
                              {new Date(order.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </td>
                            <td className="p-4">
                              {order.status !== 'Cancelled' && order.status !== 'Delivered' && (
                                <button
                                  onClick={() => handleStatusChange(order.id, 'Cancelled')}
                                  disabled={updatingId === order.id}
                                  className="px-3 py-1.5 text-xs font-bold rounded-full bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                  {updatingId === order.id ? 'Cancelling…' : 'Cancel'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Liquid-Glass Order Status Dropdown Menu */}
      <AnimatePresence>
        {statusMenu && (
          <motion.div
            ref={statusMenuRef}
            role="listbox"
            aria-label="Order status"
            initial={{ opacity: 0, scale: 0.96, y: statusMenu.placeAbove ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: statusMenu.placeAbove ? 6 : -6 }}
            transition={{ duration: 0.14 }}
            style={{
              top: statusMenu.top,
              bottom: statusMenu.bottom,
              left: statusMenu.left,
              boxShadow: '0 28px 70px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.16)',
            }}
            className="fixed z-[80] w-[212px] zone-b-grey3 border border-white/15 rounded-2xl p-1.5 flex flex-col gap-0.5 select-none"
          >
            <div className="px-3 py-1.5 border-b border-white/[0.07] mb-0.5">
              <span className="font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                Update status
              </span>
            </div>
            {ORDER_STATUS_OPTIONS.map((option) => {
              const isSelected = statusMenu.order.status === option;
              const optionDot = getStatusDotStyle(option);
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    const targetOrder = statusMenu.order;
                    setStatusMenu(null);
                    if (targetOrder.status !== option) {
                      onStatusSelect(targetOrder, option);
                    }
                  }}
                  className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl font-sans text-xs transition-all cursor-pointer text-left ${
                    isSelected
                      ? 'bg-white/[0.11] text-white font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
                      : 'text-white/70 hover:text-white hover:bg-white/[0.06] font-medium'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={optionDot} />
                    <span className="truncate">{option}</span>
                  </span>
                  {isSelected && <Check className="h-3.5 w-3.5 text-[#7aa8ff] shrink-0" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {transitFor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setTransitFor(null)}>
          <div className="zone-b-grey3 w-full max-w-md p-7 space-y-5 text-left" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-sans font-bold text-xl text-white">Hand over to the courier</h3>
              <p className="text-[13px] text-white/55 mt-1.5 leading-relaxed">
                {selfBooked ? `${transitFor.customerName} will be told in their chat that the order is on its way.` : `Enter the tracking code your courier gave you. ${transitFor.customerName} will be sent a tracking link in their chat.`}
              </p>
            </div>
            {!selfBooked && <input
              autoFocus
              value={trackingCode}
              onChange={(e) => setTrackingCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && trackingCode.trim()) confirmTransit(); }}
              placeholder="Tracking / consignment code"
              className="zone-b-input w-full px-4 py-3 text-[15px] text-white placeholder-white/25"
            />}
            {transitError && <div className="status-danger text-xs p-3 rounded-xl">{transitError}</div>}
            <div className="flex justify-end gap-3">
              <button onClick={() => setTransitFor(null)} className="px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white bg-white/[0.06] cursor-pointer">Cancel</button>
              <button
                onClick={confirmTransit}
                disabled={(!selfBooked && !trackingCode.trim()) || updatingId === transitFor.id}
                className="px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider text-white bg-gradient-to-br from-[#2552c6] to-[#14307c] shadow-[0_8px_22px_rgba(37,82,198,0.4)] disabled:opacity-50 cursor-pointer"
              >
                {updatingId === transitFor.id ? 'Sending…' : selfBooked ? 'Mark in transit' : 'Mark in transit & send link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
