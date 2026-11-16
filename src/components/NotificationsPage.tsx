import React, { useState, useEffect } from 'react';
import { listNotifications, ApiNotification } from '../lib/api';
import DashboardHeader from './DashboardHeader';
import { MessageSquare, ShoppingBag, AlertCircle, Package, Clock, Bell } from 'lucide-react';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);

  // Load read IDs from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('read_notifications');
      if (saved) {
        setReadIds(new Set(JSON.parse(saved)));
      }
    } catch {
      // ignore
    }
  }, []);

  // Listen for notification read events from other components
  useEffect(() => {
    const handleNotificationRead = (e: Event) => {
      const readId = (e as CustomEvent).detail;
      setReadIds((prev) => new Set(prev).add(readId));
    };
    const handleAllNotificationsRead = () => {
      setReadIds(new Set(notifications.map((n) => n.id)));
    };
    window.addEventListener('notification_read', handleNotificationRead);
    window.addEventListener('notification_all_read', handleAllNotificationsRead);
    return () => {
      window.removeEventListener('notification_read', handleNotificationRead);
      window.removeEventListener('notification_all_read', handleAllNotificationsRead);
    };
  }, [notifications]);

  const loadNotifications = () => {
    listNotifications()
      .then(setNotifications)
      .catch((err) => console.error('Failed to load notifications:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
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
    } else if (n.type === 'message' && n.conversationId) {
      window.dispatchEvent(new CustomEvent('shopmate_open_conversation', { detail: n.conversationId }));
      window.dispatchEvent(new CustomEvent('shopmate_navigate', { detail: 'inbox' }));
    } else if (n.type === 'inventory') {
      window.dispatchEvent(new CustomEvent('shopmate_navigate', { detail: 'catalog' }));
    }
  };

  const handleCustomerNameClick = (e: React.MouseEvent, n: ApiNotification) => {
    e.stopPropagation();
    handleMarkAsRead(n.id);

    if (n.conversationId) {
      window.dispatchEvent(new CustomEvent('shopmate_open_conversation', { detail: n.conversationId }));
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

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'message':
        return MessageSquare;
      case 'order':
        return ShoppingBag;
      case 'inventory':
        return Package;
      default:
        return AlertCircle;
    }
  };

  return (
    <div className="w-full flex-grow flex flex-col text-left">
      <DashboardHeader
        searchPlaceholder="Search notifications…"
        searchValue=""
        onSearchChange={() => {}}
      />

      <div className="w-full flex-grow p-6 md:p-8">
        <div className="zone-b-grey2 p-6 space-y-5">
          <div className="flex justify-between items-center pb-4 border-b border-white/[0.11]">
            <div>
              <h3 className="font-sans font-bold text-[19px] text-white tracking-tight">Notifications</h3>
              <p className="text-[13px] text-white/62 mt-0.5">
                {unreadCount} unread notification{unreadCount === 1 ? '' : 's'}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                className="px-4 py-2 text-xs font-bold text-white bg-white/[0.08] hover:bg-white/[0.12] border border-white/16 rounded-xl transition-all cursor-pointer"
              >
                Mark all read
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-white/[0.05] flex items-center justify-center mb-4">
                <Bell className="h-8 w-8 text-white/30" />
              </div>
              <h4 className="font-sans font-bold text-sm text-white mb-2">No notifications</h4>
              <p className="font-sans text-xs text-white/45 max-w-xs">
                Notifications will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map((n) => {
                const IconComponent = getNotificationIcon(n.type);
                const isRead = readIds.has(n.id);

                return (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className="group relative p-4 rounded-xl border border-white/[0.11] hover:bg-white/[0.04] transition-all cursor-pointer"
                    style={{
                      background: isRead
                        ? 'rgba(255,255,255,0.02)'
                        : 'rgba(26,26,29,0.90)',
                    }}
                  >
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 rounded-xl bg-white/10 text-white/80 shrink-0">
                        <IconComponent className="h-4.5 w-4.5" />
                      </div>

                      <div className="flex-grow min-w-0 space-y-1.5">
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-sans text-[13px] font-semibold text-white">
                            {n.title}
                          </span>
                          {!isRead && (
                            <span className="w-2 h-2 rounded-full bg-[#3ddc84] shrink-0 mt-1.5" style={{ boxShadow: '0 0 10px rgba(61,220,132,0.9)' }} />
                          )}
                        </div>

                        <p className="font-sans text-[12px] text-white/62 leading-relaxed">
                          {n.type === 'order' && n.customerName ? (
                            <>
                              <span
                                onClick={(e) => handleCustomerNameClick(e, n)}
                                className="text-white/86 hover:text-white cursor-pointer font-medium"
                              >
                                {n.customerName}
                              </span>
                              {' '}{n.body}
                            </>
                          ) : (
                            n.body
                          )}
                        </p>

                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 text-white/45">
                            <Clock className="h-3 w-3" />
                            <span className="text-[11px] font-sans">{formatRelativeTime(n.time)}</span>
                          </div>
                          <span className="text-white/20">·</span>
                          <span className="text-[10.5px] text-white/45 font-sans capitalize">
                            {n.platform}
                          </span>
                          {n.type === 'order' && n.orderId && (
                            <>
                              <span className="text-white/20">·</span>
                              <span className="text-[10.5px] text-white/45 font-mono">
                                {n.orderId.slice(-8).toUpperCase()}
                              </span>
                            </>
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
