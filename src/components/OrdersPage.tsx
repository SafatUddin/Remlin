import React, { useState, useEffect } from 'react';
import { listOrders, updateOrderStatus, getCourier, ApiOrder } from '../lib/api';
import DashboardHeader from './DashboardHeader';
import { Product } from '../types';
import { ORDER_STATUS_OPTIONS, type OrderStatusLabel } from '../../shared/orderStatus';
import { formatPrice, getCatalogCurrency, getOrderCurrency } from '../../shared/currency';

export default function OrdersPage({ products = [] }: { products?: Product[] }) {
  const storeCurrency = React.useMemo(() => getCatalogCurrency(products), [products]);
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadOrders = () => {
    listOrders().then(setOrders).catch((err) => console.error('Failed to load orders:', err));
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const [selfBooked, setSelfBooked] = useState(false);
  useEffect(() => {
    getCourier().then((c) => setSelfBooked(!c.connected)).catch(() => {});
  }, []);
  const [transitFor, setTransitFor] = useState<ApiOrder | null>(null);
  const [trackingCode, setTrackingCode] = useState('');
  const [transitError, setTransitError] = useState('');

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

      <div className="w-full flex-grow space-y-6 p-6 md:p-8">
        <div className="zone-b-grey2 p-6 space-y-5">
          <div className="flex justify-between items-center pb-4 border-b border-white/[0.07]">
            <div>
              <h3 className="font-sans font-bold text-[19px] text-white tracking-tight">Orders</h3>
              <p className="text-[13px] text-white/55 mt-0.5">
                {filteredOrders.length} order{filteredOrders.length === 1 ? '' : 's'} generated from customer conversations
              </p>
            </div>
          </div>

          <div className="border border-white/[0.07] rounded-2xl overflow-hidden bg-black/30 w-full">
            <div className="max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 w-full">
              <table className="w-full text-left border-collapse">
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
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-white/40 font-sans text-xs">
                        No orders recorded yet. Orders appear here once confirmed from customer conversations.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => {
                      const statusClass = 
                        order.status === 'Delivered' ? 'status-success' :
                        order.status === 'Cancelled' || order.status === 'Delivery failed' ? 'status-danger' :
                        order.status === 'In transit' || order.status === 'Out for delivery' ? 'status-info' : 'status-warning';

                      const phone = order.customerPhone || '';
                      const address = order.address;

                      return (
                        <tr key={order.id} className="hover:bg-white/[0.03] transition-colors">
                          <td className="p-4 font-sans font-bold text-white">
                            {order.customerName}
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
                            <select
                              value={order.status}
                              disabled={updatingId === order.id}
                              onChange={(e) => onStatusSelect(order, e.target.value as OrderStatusLabel)}
                              className={`appearance-none rounded-full px-3 py-1.5 text-xs font-bold cursor-pointer outline-none transition-colors ${statusClass}`}
                            >
                              {ORDER_STATUS_OPTIONS.map((o) => (
                                <option key={o} className="bg-[#121215] text-white" value={o}>{o}</option>
                              ))}
                            </select>
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
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

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
