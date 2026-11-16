import React, { useState, useEffect, useRef } from 'react';
import { Bell, Search, Settings, LogOut, ChevronDown, MessageSquare, AlertCircle, Menu, ArrowRight, ShoppingBag, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { listNotifications, ApiNotification } from '../lib/api';

interface DashboardHeaderProps {
  title?: string;
  searchPlaceholder: string;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
}

interface HeaderProfile {
  name: string;
  email: string;
  avatarUrl: string | null;
}

function getInitials(name: string): string {
  if (!name.trim()) return 'M';
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function HeaderAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = getInitials(name);
  const showImage = Boolean(avatarUrl) && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  return (
    <div className="w-7 h-7 rounded-full border border-white/20 shrink-0 overflow-hidden bg-[#242836]">
      {showImage ? (
        <img
          src={avatarUrl!}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
          {initials}
        </div>
      )}
    </div>
  );
}

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

export default function DashboardHeader({
  title,
  searchPlaceholder,
  searchValue = '',
  onSearchChange
}: DashboardHeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);

  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());

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

  const load = () => {
    listNotifications().then(setNotifications).catch((err) => console.error('Failed to load notifications:', err));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
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

  const handleMarkAllAsRead = () => {
    const newReadIds = new Set(notifications.map((n) => n.id));
    setReadIds(newReadIds);
    saveReadIds(newReadIds);
    window.dispatchEvent(new CustomEvent('notification_all_read'));
  };

  const handleMarkAsRead = (id: string) => {
    const newReadIds = new Set(readIds).add(id);
    setReadIds(newReadIds);
    saveReadIds(newReadIds);
    window.dispatchEvent(new CustomEvent('notification_read', { detail: id }));
  };

  const handleNotificationClick = (n: ApiNotification) => {
    handleMarkAsRead(n.id);
    setNotificationsOpen(false);

    if (n.type === 'order') {
      window.dispatchEvent(new CustomEvent('shopmate_navigate', { detail: 'orders' }));
    }
  };

  const handleCustomerNameClick = (e: React.MouseEvent, n: ApiNotification) => {
    e.stopPropagation();
    handleMarkAsRead(n.id);
    setNotificationsOpen(false);

    if (n.conversationId) {
      window.dispatchEvent(new CustomEvent('shopmate_open_conversation', { detail: n.conversationId }));
      window.dispatchEvent(new CustomEvent('shopmate_navigate', { detail: 'inbox' }));
    }
  };

  const [profile, setProfile] = useState<HeaderProfile>(() => {
    const saved = localStorage.getItem('shopmate_user_profile');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<HeaderProfile>;
        return {
          name: parsed.name || 'Merchant',
          email: parsed.email || '',
          avatarUrl: typeof parsed.avatarUrl === 'string' ? parsed.avatarUrl : null,
        };
      } catch {
        // fall through to defaults below
      }
    }
    return {
      name: 'Merchant',
      email: '',
      avatarUrl: null,
    };
  });

  useEffect(() => {
    const handleUpdate = () => {
      const saved = localStorage.getItem('shopmate_user_profile');
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved) as Partial<HeaderProfile>;
        setProfile({
          name: parsed.name || 'Merchant',
          email: parsed.email || '',
          avatarUrl: typeof parsed.avatarUrl === 'string' ? parsed.avatarUrl : null,
        });
      } catch {
        // ignore malformed cache
      }
    };
    window.addEventListener('shopmate_profile_updated', handleUpdate);
    return () => {
      window.removeEventListener('shopmate_profile_updated', handleUpdate);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSettingsClick = () => {
    setDropdownOpen(false);
    window.dispatchEvent(new CustomEvent('shopmate_navigate', { detail: 'settings' }));
  };

  const handleLogoutClick = () => {
    setDropdownOpen(false);
    window.dispatchEvent(new CustomEvent('shopmate_logout'));
  };

  return (
    <header className="w-full zone-a-topbar z-40 select-none px-4 sm:px-6 md:px-8 h-[72px] flex items-center justify-between shrink-0 border-b border-white/[0.08]">
      {/* Left side: Mobile menu toggle */}
      <div className="flex items-center gap-3">
        <button 
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('shopmate_toggle_sidebar'))}
          className="md:hidden p-2 text-white/60 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Right Side Utility Cluster (§5.2) */}
      <div className="flex items-center gap-3.5 shrink-0 ml-auto">
        {/* Search Bar: 300px sunken navy gradient */}
        <div className="relative w-48 sm:w-64 md:w-[320px] search-bar-gradient rounded-xl flex items-center p-1 pl-3.5">
          <Search className="h-4 w-4 text-blue-200/50 shrink-0 mr-2" />
          <input 
            type="text"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="w-full bg-transparent border-none text-[13px] text-white placeholder-blue-200/40 focus:outline-none font-sans"
          />
          <button className="w-7 h-7 bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg flex items-center justify-center shrink-0 ml-1.5 text-white shadow-md transition-colors cursor-pointer">
            <ArrowRight className="h-3.5 w-3.5 text-white/70" />
          </button>
        </div>

        {/* Notification Bell: 38px glass button */}
        <div className="relative" ref={notificationsRef}>
          <button 
            onClick={() => setNotificationsOpen(!notificationsOpen)}
            className="w-[38px] h-[38px] btn-glass flex items-center justify-center relative focus:outline-none cursor-pointer"
            title="Notifications"
          >
            <Bell className="h-4.5 w-4.5 text-white/80" />
            {unreadCount > 0 && (
              <span className="absolute top-2 right-2 w-[7px] h-[7px] rounded-full bg-[#4d8bff] shadow-[0_0_8px_rgba(77,139,255,0.9)] animate-pulse" />
            )}
          </button>

          <AnimatePresence>
            {notificationsOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-96 zone-b-grey3 rounded-2xl p-1 flex flex-col z-50 overflow-hidden"
                style={{
                  boxShadow: '0 40px 100px rgba(0,0,0,0.70), inset 0 1px 0 rgba(255,255,255,0.16)',
                }}
              >
                <div className="px-4 py-3.5 border-b border-white/[0.11] flex justify-between items-center bg-black/40 rounded-t-xl">
                  <div className="flex items-center gap-2">
                    <span className="font-sans font-bold text-xs text-white">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-white/[0.22] text-white text-[10px] font-bold">
                        {unreadCount}
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllAsRead}
                      className="text-[10.5px] text-white/60 hover:text-white font-medium transition-colors cursor-pointer"
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-white/[0.055] no-scrollbar">
                  {notifications.length === 0 ? (
                    <div className="p-10 text-center">
                      <div className="w-12 h-12 rounded-full bg-white/[0.05] flex items-center justify-center mx-auto mb-3">
                        <Bell className="h-5 w-5 text-white/30" />
                      </div>
                      <p className="text-xs text-white/40 font-sans">No notifications</p>
                    </div>
                  ) : (
                    notifications.map((n) => {
                      const isRead = readIds.has(n.id);

                      return (
                        <div
                          key={n.id}
                          onClick={() => handleNotificationClick(n)}
                          className="p-3.5 text-left transition-colors cursor-pointer flex gap-3 items-start hover:bg-white/[0.04] group"
                          style={{
                            background: isRead ? 'rgba(255,255,255,0.02)' : 'transparent',
                          }}
                        >
                          <div className="p-2 rounded-xl bg-white/10 text-white/80 shrink-0 mt-0.5">
                            {n.type === 'message' ? (
                              <MessageSquare className="h-4 w-4" />
                            ) : n.type === 'order' ? (
                              <ShoppingBag className="h-4 w-4" />
                            ) : (
                              <AlertCircle className="h-4 w-4" />
                            )}
                          </div>

                          <div className="flex-grow min-w-0 space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-sans text-[12px] font-semibold text-white">
                                {n.title}
                              </span>
                              {!isRead && (
                                <span className="w-1.5 h-1.5 rounded-full bg-[#3ddc84] shrink-0 mt-1" style={{ boxShadow: '0 0 10px rgba(61,220,132,0.9)' }} />
                              )}
                            </div>
                            <p className="font-sans text-[11px] text-white/60 leading-relaxed line-clamp-2">
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
                            <div className="flex items-center gap-2 text-[10px] text-white/40 font-sans">
                              <span>{formatRelativeTime(n.time)}</span>
                              <span className="text-white/20">·</span>
                              <span className="capitalize">{n.platform}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="px-3 py-2 border-t border-white/[0.11] bg-black/40 rounded-b-xl">
                  <button
                    onClick={() => {
                      setNotificationsOpen(false);
                      window.dispatchEvent(new CustomEvent('shopmate_navigate', { detail: 'notifications' }));
                    }}
                    className="w-full py-2 text-[11px] text-white/60 hover:text-white font-medium transition-colors cursor-pointer"
                  >
                    View all notifications
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Profile: Royal Blue Avatar Circle inside Glass Pill */}
        <div className="relative" ref={dropdownRef}>
          <button 
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 pl-1 pr-3 py-1 btn-glass rounded-[99px] focus:outline-none cursor-pointer group"
          >
            <HeaderAvatar name={profile.name} avatarUrl={profile.avatarUrl} />
            <span className="font-sans text-xs text-white/90 font-medium hidden sm:inline">{profile.name}</span>
            <ChevronDown className="h-3.5 w-3.5 text-white/50 group-hover:text-white transition-colors" />
          </button>

          <AnimatePresence>
            {dropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-56 zone-b-grey3 p-2 flex flex-col gap-1 z-50"
              >
                <div className="px-3 py-2 border-b border-white/[0.07] mb-1">
                  <p className="font-sans font-bold text-xs text-white truncate">{profile.name}</p>
                  <p className="text-[11px] text-white/50 truncate mt-0.5">{profile.email}</p>
                </div>

                <button
                  onClick={handleSettingsClick}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-white/80 hover:text-white hover:bg-white/[0.08] rounded-xl transition-colors cursor-pointer"
                >
                  <Settings className="h-4 w-4 text-white/50" />
                  <span className="font-sans text-xs">Merchant settings</span>
                </button>

                <button
                  onClick={handleLogoutClick}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-white/50 hover:text-[#ffb4b4] hover:bg-[rgba(255,90,90,0.14)] rounded-xl transition-colors cursor-pointer"
                >
                  <LogOut className="h-4 w-4 text-white/40" />
                  <span className="font-sans text-xs">Log out</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
