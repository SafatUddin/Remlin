import React, { useState, useEffect } from 'react';
import { listOrders, updateOrderStatus, ApiOrder } from '../lib/api';
import DashboardHeader from './DashboardHeader';
import { Product } from '../types';
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

  const handleStatusChange = async (id: string, status: 'Processing' | 'On the Way' | 'Delivered' | 'Cancelled') => {
    setUpdatingId(id);
    try {
      const updated = await updateOrderStatus(id, status);
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
    } catch (err) {
      console.error('Failed to update order status:', err);
    } finally {
      setUpdatingId(null);
    }
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
                        order.status === 'Cancelled' ? 'status-danger' :
                        order.status === 'On the Way' ? 'status-info' : 'status-warning';

                      const phone = order.customerPhone || '';
                      const address = order.address;

                      return (
                        <tr key={order.id} className="hover:bg-white/[0.03] transition-colors">
                          <td className="p-4 font-sans font-bold text-white">{order.customerName}</td>
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
                              onChange={(e) => handleStatusChange(order.id, e.target.value as 'Processing' | 'On the Way' | 'Delivered' | 'Cancelled')}
                              className={`appearance-none rounded-full px-3 py-1.5 text-xs font-bold cursor-pointer outline-none transition-colors ${statusClass}`}
                            >
                              <option className="bg-[#121215] text-white" value="Processing">Processing</option>
                              <option className="bg-[#121215] text-white" value="On the Way">On the Way</option>
                              <option className="bg-[#121215] text-white" value="Delivered">Delivered</option>
                              <option className="bg-[#121215] text-white" value="Cancelled">Cancelled</option>
                            </select>
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
    </div>
  );
}
