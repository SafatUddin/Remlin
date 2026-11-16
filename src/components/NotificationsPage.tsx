import React, { useState, useEffect } from 'react';
import { listNotifications, getCachedNotifications, ApiNotification } from '../lib/api';
import DashboardHeader from './DashboardHeader';
import { MessageSquare, ShoppingBag, AlertCircle, Package, Clock, Bell, Check, ArrowUpRight } from 'lucide-react';

const NOTIFICATION_FILTERS = ['All notifications', 'Unread', 'Orders', 'Messages', 'Inventory'] as const;
type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<ApiNotification[]>(() => getCachedNotifications() ?? []);
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('read_notifications');
      if (saved) return new Set(JSON.parse(saved));
    } catch {
      // ignore
    }
    return new Set();
  });
  const [loading, setLoading] = useState<boolean>(() => getCachedNotifications() === null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<NotificationFilter>('All notifications');

  // Listen for notification read and update events from other components
  useEffect(() => {
    const handleNotificationRead = (e: Event) => {
      const readId = (e as CustomEvent).detail;
      setReadIds((prev) => new Set(prev).add(readId));
    };
    const handleAllNotificationsRead = () => {
      setReadIds(new Set(notifications.map((n) => n.id)));
    };
    const handleNotificationsUpdated = (e: Event) => {
      const updated = (e as CustomEvent<ApiNotification[]>).detail;
      if (Array.isArray(updated)) {
        setNotifications(updated);
        setLoading(false);
      }
    };
    window.addEventListener('notification_read', handleNotificationRead);
    window.addEventListener('notification_all_read', handleAllNotificationsRead);
    window.addEventListener('shopmate_notifications_updated', handleNotificationsUpdated);
    return () => {
      window.removeEventListener('notification_read', handleNotificationRead);
      window.removeEventListener('notification_all_read', handleAllNotificationsRead);
      window.removeEventListener('shopmate_notifications_updated', handleNotificationsUpdated);
    };
  }, [notifications]);

  const loadNotifications = () => {
    listNotifications()
      .then(setNotifications)
      .catch((err) => console.error('Failed to load notifications:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (getCachedNotifications() === null) setLoading(true);
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  const saveReadIds = (ids: Set<string>) => {
    try {
      localStorage.setItem('read_notifications', JSON.stringify(Array.from(ids)));
    } catch {
      // ignore
    }
  };

  const handleMarkAsRead = (id: string) => {
    const newReadIds = new Set(readIds).add(id);
    setReadIds(newReadIds);
    saveReadIds(newReadIds);
    window.dispatchEvent(new CustomEvent('notification_read', { detail: id }));
  };

  const handleMarkAllAsRead = () => {
    const newReadIds = new Set(notifications.map((n) => n.id));
    setReadIds(newReadIds);
    saveReadIds(newReadIds);
    window.dispatchEvent(new CustomEvent('notification_all_read'));
  };

  const handleNotificationClick = (n: ApiNotification) => {
    handleMarkAsRead(n.id);

    if (n.type === 'order') {
      window.dispatchEvent(new CustomEvent('shopmate_navigate', { detail: 'orders' }));
    } else if (n.type === 'message') {
      if (n.conversationId) {
        window.dispatchEvent(new CustomEvent('shopmate_open_conversation', { detail: n.conversationId }));
      }
      window.dispatchEvent(new CustomEvent('shopmate_navigate', { detail: 'inbox' }));
    } else if (n.type === 'inventory') {
      window.dispatchEvent(new CustomEvent('shopmate_navigate', { detail: 'catalog' }));
    }
  };

  const handleCustomerNameClick = (e: React.MouseEvent, n: ApiNotification) => {
    e.stopPropagation();
    handleMarkAsRead(n.id);

    if (n.conversationId || n.customerName || n.orderId) {
      window.dispatchEvent(
        new CustomEvent('shopmate_open_conversation', {
          detail: {
            conversationId: n.conversationId,
            orderId: n.orderId,
            customerName: n.customerName,
          },
        })
      );
      window.dispatchEvent(new CustomEvent('shopmate_navigate', { detail: 'inbox' }));
    }
  };

  function formatRelativeTime(iso: string | null): string {
    if (!iso) return '';
    const diffMs = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  const getFilterCount = (filter: NotificationFilter) => {
    return notifications.filter((n) => {
      if (filter === 'Unread') return !readIds.has(n.id);
      if (filter === 'Orders') return n.type === 'order';
      if (filter === 'Messages') return n.type === 'message';
      if (filter === 'Inventory') return n.type === 'inventory';
      return true;
    }).length;
  };

  const filteredNotifications = notifications.filter((n) => {
    if (activeFilter === 'Unread' && readIds.has(n.id)) return false;
    if (activeFilter === 'Orders' && n.type !== 'order') return false;
    if (activeFilter === 'Messages' && n.type !== 'message') return false;
    if (activeFilter === 'Inventory' && n.type !== 'inventory') return false;

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const matchTitle = n.title.toLowerCase().includes(q);
      const matchBody = n.body.toLowerCase().includes(q);
      const matchCustomer = (n.customerName || '').toLowerCase().includes(q);
      const matchPlatform = n.platform.toLowerCase().includes(q);
      const matchOrder = (n.orderId || '').toLowerCase().includes(q);
      if (!matchTitle && !matchBody && !matchCustomer && !matchPlatform && !matchOrder) return false;
    }
    return true;
  });

  return (
    <div className="w-full flex-grow flex flex-col text-left">
      <DashboardHeader
        searchPlaceholder="Search notifications…"
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
      />

      <div className="w-full flex-grow space-y-4 sm:space-y-5 p-3.5 sm:p-6 md:p-8">
        {/* Filter Tabs Row matching Inbox Apple Glass Design */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar shrink-0 flex-nowrap">
          {NOTIFICATION_FILTERS.map((f) => {
            const isActive = activeFilter === f;
            const count = getFilterCount(f);
            const isRedCount = f === 'Unread' && count > 0;

            return (
              <button
                key={f}
                type="button"
                onClick={() => setActiveFilter(f)}
                className={`text-[12px] font-sans font-medium px-3.5 sm:px-4 py-1.5 rounded-full border shrink-0 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap backdrop-blur-md ${
                  isActive
                    ? 'bg-gradient-to-b from-white/20 to-white/10 border-white/35 text-white font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_4px_12px_rgba(0,0,0,0.4)]'
                    : 'bg-white/[0.04] border-white/[0.08] text-white/60 hover:text-white hover:bg-white/10 hover:border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                }`}
              >
                <span>{f}</span>
                {count > 0 && (
                  <span
                    className={`text-[10px] font-bold text-white px-2 py-0.5 rounded-full ${
                      isRedCount ? 'bg-[#ea4335]' : 'bg-white/20'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="zone-b-grey2 p-4 sm:p-6 space-y-4 sm:space-y-5">
          <div className="flex flex-wrap justify-between items-center gap-3 pb-3 sm:pb-4 border-b border-white/[0.08]">
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="font-sans font-bold text-lg sm:text-[19px] text-white tracking-tight">Notifications</h3>
                {unreadCount > 0 ? (
                  <span className="status-info px-2.5 py-0.5 rounded-full text-[11px] font-bold">
                    {unreadCount} unread
                  </span>
                ) : (
                  <span className="status-neutral px-2.5 py-0.5 rounded-full text-[11px] font-bold">
                    All caught up
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-[13px] text-white/55 mt-0.5">
                Real-time alerts for customer inquiries, confirmed orders, and low-stock products
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllAsRead}
                className="btn-glass px-3.5 sm:px-4 py-2 text-xs font-bold text-white hover:text-white rounded-xl transition-all cursor-pointer shrink-0 inline-flex items-center gap-1.5"
              >
                <Check className="h-3.5 w-3.5 text-[#7aa8ff]" />
                Mark all read
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-14">
              <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center bg-black/25 border border-white/[0.06] rounded-2xl">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.05] border border-white/10 flex items-center justify-center mb-3.5">
                <Bell className="h-6 w-6 text-white/35" />
              </div>
              <h4 className="font-sans font-bold text-sm text-white mb-1">No matching notifications</h4>
              <p className="font-sans text-xs text-white/45 max-w-xs">
                {notifications.length === 0
                  ? 'New customer messages, orders, and stock alerts will appear here.'
                  : 'Try switching filters or clearing your search query.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredNotifications.map((n) => {
                const isRead = readIds.has(n.id);
                const isComplaint = n.title.toLowerCase().includes('complaint');

                const iconBadgeClass =
                  n.type === 'order'
                    ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                    : isComplaint
                    ? 'bg-red-500/15 border-red-400/30 text-[#ff9d92]'
                    : n.type === 'message'
                    ? 'bg-[#2176ff]/15 border-[#4d8bff]/35 text-[#7aa8ff]'
                    : 'bg-amber-500/15 border-amber-400/30 text-amber-300';

                const categoryChipClass =
                  n.type === 'order'
                    ? 'status-success'
                    : isComplaint
                    ? 'status-danger'
                    : n.type === 'message'
                    ? 'status-info'
                    : 'status-warning';

                const categoryLabel =
                  n.type === 'order'
                    ? 'Order'
                    : isComplaint
                    ? 'Complaint'
                    : n.type === 'message'
                    ? 'Message'
                    : 'Inventory';

                return (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`group relative p-3.5 sm:p-4 rounded-2xl border transition-all cursor-pointer ${
                      isRead
                        ? 'bg-white/[0.02] border-white/[0.07] opacity-80 hover:opacity-100 hover:bg-white/[0.05] hover:border-white/15'
                        : 'bg-gradient-to-b from-white/[0.11] via-white/[0.05] to-white/[0.02] border-white/22 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_6px_20px_rgba(0,0,0,0.45)] hover:border-white/35'
                    }`}
                  >
                    <div className="flex items-start gap-3.5 sm:gap-4">
                      <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 transition-transform group-hover:scale-105 ${iconBadgeClass}`}>
                        {n.type === 'message' ? (
                          isComplaint ? <AlertCircle className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />
                        ) : n.type === 'order' ? (
                          <ShoppingBag className="h-5 w-5" />
                        ) : (
                          <Package className="h-5 w-5" />
                        )}
                      </div>

                      <div className="flex-grow min-w-0 space-y-1.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className={`font-sans text-[13.5px] sm:text-[14px] ${isRead ? 'font-semibold text-white/90' : 'font-bold text-white'}`}>
                              {n.title}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${categoryChipClass}`}>
                              {categoryLabel}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {!isRead && (
                              <span
                                className="w-2 h-2 rounded-full bg-[#3ddc84] shrink-0"
                                style={{ boxShadow: '0 0 10px rgba(61,220,132,0.9)' }}
                                title="Unread"
                              />
                            )}
                            <ArrowUpRight className="h-4 w-4 text-white/30 group-hover:text-white/75 transition-colors" />
                          </div>
                        </div>

                        <p className="font-sans text-[12.5px] sm:text-[13px] text-white/70 leading-relaxed">
                          {n.type === 'order' && n.customerName ? (
                            <>
                              <button
                                type="button"
                                onClick={(e) => handleCustomerNameClick(e, n)}
                                title="Open customer conversation in Inbox"
                                className="text-white hover:text-[#7aa8ff] hover:underline underline-offset-2 cursor-pointer font-bold transition-colors"
                              >
                                {n.customerName}
                              </button>
                              {' '}{n.body}
                            </>
                          ) : (
                            n.body
                          )}
                        </p>

                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          {n.time && (
                            <>
                              <div className="flex items-center gap-1.5 text-white/45">
                                <Clock className="h-3 w-3" />
                                <span className="text-[11px] font-mono">{formatRelativeTime(n.time)}</span>
                              </div>
                              <span className="text-white/20">·</span>
                            </>
                          )}
                          <span className="text-[10.5px] px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10 text-white/65 font-sans font-semibold capitalize">
                            {n.platform}
                          </span>
                          {n.type === 'order' && n.orderId && (
                            <span className="text-[10.5px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-white/50 font-mono">
                              Ref #{n.orderId.slice(-8).toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
