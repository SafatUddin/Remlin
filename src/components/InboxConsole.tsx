import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  Sparkles, 
  Facebook, 
  Instagram, 
  MessageSquare, 
  User, 
  ShieldAlert,
  Plus,
  FileText,
  Zap,
  ChevronLeft,
  Trash2,
  Paperclip,
  CheckCircle,
  MoreHorizontal,
  Archive,
  AlertOctagon
  ,Mic2
} from 'lucide-react';
import { Conversation, ChatMessage, Product } from '../types';
import { sendConversationMessage, approveDraftMessage, createOrderFromConversation, updateConversationCart, updateConversationComplaint, updateConversationArchived, updateConversationSpam, listOrders, updateOrderStatus, ApiOrder } from '../lib/api';
import DashboardHeader from './DashboardHeader';
import { formatPrice, getCatalogCurrency, getOrderCurrency, getProductCurrency } from '../../shared/currency';

// Helper function to format timestamp in merchant's local timezone
function formatMessageTime(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Helper function to check if two dates are on different days
function isDifferentDay(date1: string | Date, date2: string | Date): boolean {
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;
  return (
    d1.getFullYear() !== d2.getFullYear() ||
    d1.getMonth() !== d2.getMonth() ||
    d1.getDate() !== d2.getDate()
  );
}

// Helper function to format date separator (like Messenger)
function formatDateSeparator(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Check if today
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return 'Today';
  }

  // Check if yesterday
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return 'Yesterday';
  }

  // Otherwise show full date
  return date.toLocaleDateString([], { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

// Shows the customer's real Facebook/Instagram profile photo when we have one (never
// available for WhatsApp); falls back to initials on load failure or when there's no
// avatarUrl at all (e.g. website-widget conversations).
function ChatAvatar({ name, avatarUrl, sizeClass }: { name: string; avatarUrl?: string; sizeClass: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(avatarUrl) && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  return (
    <div className={`${sizeClass} rounded-full bg-gradient-to-b from-white/20 to-white/5 border border-white/20 text-white font-bold flex items-center justify-center font-sans text-[12.5px] uppercase shadow-inner overflow-hidden shrink-0`}>
      {showImage ? (
        <img
          src={avatarUrl}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        name.split(' ').map((n) => n[0]).join('')
      )}
    </div>
  );
}

interface InboxConsoleProps {
  conversations: Conversation[];
  products: Product[];
  onUpdateConversation: (chatId: string, updates: Partial<Conversation>) => void;
  onUpdateConversationStatus: (chatId: string, status: 'Active' | 'AI Managed' | 'Closed') => Promise<void>;
  onDeleteConversation?: (chatId: string) => Promise<void>;
}

export default function InboxConsole({
  conversations,
  products,
  onUpdateConversation,
  onUpdateConversationStatus,
  onDeleteConversation
}: InboxConsoleProps) {
  const storeCurrency = React.useMemo(() => getCatalogCurrency(products), [products]);
  const [selectedChatId, setSelectedChatId] = useState(conversations[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [activeFilter, setActiveFilter] = useState('All conversations');
  const [orderAddress, setOrderAddress] = useState('');
  const [orderPhone, setOrderPhone] = useState('');
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [orderSuccess, setOrderSuccess] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'chat' | 'info'>('list');
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [ongoingOrders, setOngoingOrders] = useState<ApiOrder[]>([]);
  const [recentOrders, setRecentOrders] = useState<ApiOrder[]>([]);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [orderCancelError, setOrderCancelError] = useState('');
  
  // Optimistic-hide for a chat mid-delete, before the server confirms and it drops out
  // of the conversations prop entirely. Archive/spam state itself is server-persisted
  // (Conversation.isArchived/isSpam) and read directly off each chat below.
  const [deletedChatIds, setDeletedChatIds] = useState<string[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getChatDisplayName = (chat: Conversation) => {
    if (!chat) return '';
    if (chat.platform !== 'websocket') return chat.customerName;

    let askedIndex = -1;
    for (let i = 0; i < chat.messages.length; i++) {
      const msg = chat.messages[i];
      if (msg.sender === 'ai' || msg.sender === 'merchant') {
        const text = msg.text.toLowerCase();
        if ((text.includes('name') && text.includes('address')) || text.includes('confirming your order') || text.includes('confirm your order')) {
          askedIndex = i;
          break;
        }
      }
    }

    if (askedIndex !== -1) {
      const customerReplies = chat.messages.slice(askedIndex + 1).filter(m => m.sender === 'customer');
      if (customerReplies.length > 0) {
        return chat.customerName;
      }
    }

    const num = chat.id.replace(/\D/g, '') || '1';
    return `Unknown #${num}`;
  };

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const userIsAtBottom = useRef(true);
  
  const activeChat = conversations.find(c => c.id === selectedChatId) || conversations[0];

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    userIsAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // When a new message arrives or typing indicator changes, only auto-scroll if the
  // user is already near the bottom — preserves scroll position when reading history.
  useEffect(() => {
    if (userIsAtBottom.current) scrollToBottom();
  }, [activeChat?.messages, isTyping]);

  // When switching conversations, always jump to the bottom and reset the flag.
  useEffect(() => {
    userIsAtBottom.current = true;
    scrollToBottom();
  }, [activeChat?.id]);

  // Load ongoing & all recent orders for the active conversation
  useEffect(() => {
    if (!activeChat?.id) {
      setOngoingOrders([]);
      setRecentOrders([]);
      return;
    }
    listOrders()
      .then((orders) => {
        const conversationOrders = orders.filter((o) => o.conversationId === activeChat.id);
        const active = conversationOrders.filter(
          (o) => o.status === 'Processing' || o.status === 'On the Way'
        );
        setOngoingOrders(active);
        setRecentOrders(conversationOrders);
      })
      .catch((err) => console.error('Failed to load orders:', err));
  }, [activeChat?.id]);

  const handleCancelOrder = async (orderId: string) => {
    setCancellingOrderId(orderId);
    setOrderCancelError('');
    try {
      const updated = await updateOrderStatus(orderId, 'Cancelled');
      setOngoingOrders((prev) =>
        prev.map((o) => (o.id === orderId ? updated : o)).filter(
          (o) => o.status === 'Processing' || o.status === 'On the Way'
        )
      );
      setRecentOrders((prev) =>
        prev.map((o) => (o.id === orderId ? updated : o))
      );
    } catch (err: any) {
      setOrderCancelError(err.message || 'Failed to cancel order.');
    } finally {
      setCancellingOrderId(null);
    }
  };

  useEffect(() => {
    if (activeChat?.detectedAddress && !orderAddress.trim()) {
      setOrderAddress(activeChat.detectedAddress);
    }
    if (activeChat?.detectedPhone && !orderPhone.trim()) {
      setOrderPhone(activeChat.detectedPhone);
    }
  }, [activeChat?.id, activeChat?.detectedAddress, activeChat?.detectedPhone]);

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || !activeChat) return;

    // Use ISO string for consistent timezone handling
    const now = new Date();
    const optimisticMsg: ChatMessage = {
      id: `m-local-${Date.now()}`,
      sender: 'merchant',
      text: textToSend,
      time: now.toISOString() // Store as ISO string
    };

    const discardDraftId = editingDraftId;
    setEditingDraftId(null);

    onUpdateConversation(activeChat.id, {
      messages: [...activeChat.messages, optimisticMsg],
      lastMessage: textToSend,
      time: 'Just now'
    });
    setInputText('');

    setIsTyping(false);

    try {
      const updated = await sendConversationMessage(
        activeChat.id,
        textToSend,
        'merchant',
        discardDraftId || undefined
      );
      onUpdateConversation(activeChat.id, updated);
      // Refresh ongoing orders in case the AI just created one
      listOrders()
        .then((orders) => {
          const active = orders.filter(
            (o) =>
              (o.status === 'Processing' || o.status === 'On the Way') &&
              o.conversationId === activeChat.id
          );
          setOngoingOrders(active);
        })
        .catch(() => {});
    } catch (err) {
      console.error(err);
    } finally {
      setIsTyping(false);
    }
  };

  const handleApproveDraft = async (messageId: string) => {
    if (!activeChat) return;
    setApprovingId(messageId);
    try {
      const updated = await approveDraftMessage(activeChat.id, messageId);
      onUpdateConversation(activeChat.id, updated);
    } catch (err) {
      console.error(err);
    } finally {
      setApprovingId(null);
    }
  };

  const handleRemoveCartItem = async (skuToRemove: string) => {
    if (!activeChat || !activeChat.cart) return;
    const updatedCart = activeChat.cart.filter((item) => item.sku !== skuToRemove);
    onUpdateConversation(activeChat.id, { cart: updatedCart });
    try {
      const updated = await updateConversationCart(activeChat.id, updatedCart);
      onUpdateConversation(activeChat.id, updated);
    } catch (err) {
      console.error('Failed to update cart on server:', err);
    }
  };

  const handleUpdateCartQty = async (sku: string, delta: number) => {
    if (!activeChat || !activeChat.cart) return;
    const updatedCart = activeChat.cart
      .map((item) => item.sku === sku ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item)
      .filter((item) => item.quantity > 0);
    onUpdateConversation(activeChat.id, { cart: updatedCart });
    try {
      const updated = await updateConversationCart(activeChat.id, updatedCart);
      onUpdateConversation(activeChat.id, updated);
    } catch (err) {
      console.error('Failed to update cart quantity:', err);
    }
  };

  const handleGenerateOrder = async () => {
    if (!activeChat) return;
    if (!orderAddress.trim()) {
      setOrderError('Enter a shipping address first.');
      return;
    }
    setOrderError('');
    setIsCreatingOrder(true);
    try {
      await createOrderFromConversation(activeChat.id, {
        address: orderAddress.trim(),
        customerPhone: orderPhone.trim() || undefined,
      });
      onUpdateConversation(activeChat.id, { cart: undefined });
      setOrderAddress('');
      setOrderPhone('');
      setOrderSuccess('Order created successfully.');
      setTimeout(() => setOrderSuccess(''), 3000);
      // Refresh ongoing & recent orders
      listOrders()
        .then((orders) => {
          const conversationOrders = orders.filter((o) => o.conversationId === activeChat.id);
          const active = conversationOrders.filter(
            (o) => o.status === 'Processing' || o.status === 'On the Way'
          );
          setOngoingOrders(active);
          setRecentOrders(conversationOrders);
        })
        .catch(() => {});
    } catch (err: any) {
      setOrderError(err.message || 'Failed to create order.');
    } finally {
      setIsCreatingOrder(false);
    }
  };

  const handleToggleAutomation = () => {
    if (!activeChat) return;
    const newStatus = activeChat.status === 'AI Managed' ? 'Active' : 'AI Managed';
    onUpdateConversationStatus(activeChat.id, newStatus);
  };

  const handleResolveComplaint = async (targetId?: string) => {
    const idToResolve = targetId || activeChat?.id;
    if (!idToResolve) return;
    onUpdateConversation(idToResolve, { isComplaint: false });
    try {
      const updated = await updateConversationComplaint(idToResolve, false);
      onUpdateConversation(idToResolve, updated);
    } catch (err) {
      console.error('Failed to resolve complaint:', err);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    setIsMenuOpen(false);
    setDeletedChatIds((prev) => [...prev, chatId]);
    if (onDeleteConversation) {
      await onDeleteConversation(chatId);
    }
  };

  const handleArchiveChat = async (chatId: string) => {
    setIsMenuOpen(false);
    const chat = conversations.find((c) => c.id === chatId);
    const nextValue = !chat?.isArchived;
    onUpdateConversation(chatId, { isArchived: nextValue });
    try {
      const updated = await updateConversationArchived(chatId, nextValue);
      onUpdateConversation(chatId, updated);
    } catch (err) {
      console.error('Failed to update archive state:', err);
      onUpdateConversation(chatId, { isArchived: !nextValue });
    }
  };

  const handleSpamChat = async (chatId: string) => {
    setIsMenuOpen(false);
    const chat = conversations.find((c) => c.id === chatId);
    const nextValue = !chat?.isSpam;
    onUpdateConversation(chatId, { isSpam: nextValue });
    try {
      const updated = await updateConversationSpam(chatId, nextValue);
      onUpdateConversation(chatId, updated);
    } catch (err) {
      console.error('Failed to update spam state:', err);
      onUpdateConversation(chatId, { isSpam: !nextValue });
    }
  };

  const filteredChats = conversations.filter(chat => {
    if (deletedChatIds.includes(chat.id)) return false;
    const displayName = getChatDisplayName(chat);
    const matchesSearch = displayName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          chat.lastMessage.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (!matchesSearch) return false;
    const f = activeFilter.toLowerCase();
    const isArchived = !!chat.isArchived;
    const isSpam = !!chat.isSpam;

    if (f === 'archived') return isArchived;
    if (f === 'spam') return isSpam;

    // For all other filters, hide archived or spam chats by default
    if (isArchived || isSpam) return false;

    if (f === 'all conversations') return true;
    if (f === 'unread') return chat.unread;
    if (f === 'complaints') return chat.isComplaint;
    if (f === 'facebook') return chat.platform === 'facebook';
    if (f === 'instagram') return chat.platform === 'instagram';
    if (f === 'whatsapp') return chat.platform === 'whatsapp';
    if (f === 'websocket') return chat.platform === 'websocket';
    if (f === 'unresolved') return chat.status === 'Active';
    if (f === 'resolved') return chat.status === 'Closed';
    return true;
  });

  const getFilterCount = (filterName: string) => {
    const f = filterName.toLowerCase();
    return conversations.filter(chat => {
      if (deletedChatIds.includes(chat.id)) return false;
      const isArchived = !!chat.isArchived;
      const isSpam = !!chat.isSpam;

      if (f === 'archived') return isArchived;
      if (f === 'spam') return isSpam;

      if (isArchived || isSpam) return false;

      if (f === 'all conversations') return true;
      if (f === 'unread') return chat.unread;
      if (f === 'complaints') return chat.isComplaint;
      if (f === 'facebook') return chat.platform === 'facebook';
      if (f === 'instagram') return chat.platform === 'instagram';
      if (f === 'whatsapp') return chat.platform === 'whatsapp';
      if (f === 'websocket') return chat.platform === 'websocket';
      if (f === 'unresolved') return chat.status === 'Active';
      if (f === 'resolved') return chat.status === 'Closed';
      return false;
    }).length;
  };

  const renderPlatformIcon = (platform: string, size = 14) => {
    switch (platform) {
      case 'facebook':
        return (
          <svg className={`h-[${size}px] w-[${size}px]`} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#1877F2"/>
          </svg>
        );
      case 'instagram':
        return (
          <svg className={`h-[${size}px] w-[${size}px]`} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none">
            <defs>
              <radialGradient id="inbox-ig-grad" cx="30%" cy="107%" r="130%">
                <stop offset="0%" stopColor="#fdf497" />
                <stop offset="5%" stopColor="#fdf497" />
                <stop offset="45%" stopColor="#fd5949" />
                <stop offset="60%" stopColor="#d6249f" />
                <stop offset="90%" stopColor="#285AEB" />
              </radialGradient>
            </defs>
            <rect width="24" height="24" rx="6" fill="url(#inbox-ig-grad)" />
            <rect x="4.5" y="4.5" width="15" height="15" rx="4.5" stroke="#ffffff" strokeWidth="1.8" fill="none" />
            <circle cx="12" cy="12" r="3.6" stroke="#ffffff" strokeWidth="1.8" fill="none" />
            <circle cx="16.3" cy="7.7" r="1.1" fill="#ffffff" />
          </svg>
        );
      case 'whatsapp':
        return (
          <svg className={`h-[${size}px] w-[${size}px]`} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="6" fill="#25D366" />
            <path 
              d="M12 4.2a7.8 7.8 0 0 0-6.75 11.7L4 20l4.24-1.21A7.8 7.8 0 1 0 12 4.2zm0 14.1a6.3 6.3 0 0 1-3.21-.88l-.23-.14-2.39.68.68-2.33-.15-.24a6.3 6.3 0 1 1 5.3 2.91zm3.46-4.73c-.19-.09-1.12-.55-1.3-.61-.17-.06-.3-.09-.43.1-.13.19-.5.61-.61.73-.11.13-.23.14-.42.05a5.27 5.27 0 0 1-1.55-.96 5.8 5.8 0 0 1-1.08-1.34c-.11-.19 0-.29.09-.38.08-.08.19-.23.29-.34.1-.11.13-.19.19-.32.06-.13.03-.24-.02-.34-.05-.09-.43-1.03-.59-1.42-.15-.37-.31-.32-.43-.32-.11 0-.24-.01-.37-.01-.13 0-.34.05-.52.24s-.69.67-.69 1.64.71 1.9 0.81 2.03c.1.13 1.39 2.12 3.37 2.97.47.2.84.32 1.13.41.48.15.91.13 1.25.08.38-.06 1.16-.47 1.32-.93.16-.46.16-.85.11-.93-.05-.08-.18-.13-.37-.22z" 
              fill="#ffffff" 
            />
          </svg>
        );
      case 'websocket':
        return (
          <svg className={`h-[${size}px] w-[${size}px]`} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="6" fill="#10B981"/>
            <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" fill="#ffffff" />
          </svg>
        );
      default:
        return <User size={size} className="text-white/40" />;
    }
  };

  const FILTERS = [
    'All conversations', 'Unread', 'Unresolved', 'Resolved', 'Complaints', 
    'Archived', 'Spam', 'Facebook', 'Instagram', 'WhatsApp', 'Websocket'
  ];

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col text-left overflow-hidden">
      <DashboardHeader 
        searchPlaceholder="Search conversations…" 
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <div className="w-full flex-grow flex flex-col min-h-0 space-y-3 p-4 md:p-5 overflow-hidden">
        {/* Filter Tabs Row matching Picture 2 Apple Glass Design */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar shrink-0 flex-nowrap">
          {FILTERS.map((f) => {
            const isActive = activeFilter === f;
            const count = getFilterCount(f);
            const isRedCount = ['unread', 'complaints', 'spam'].includes(f.toLowerCase());

            return (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`text-[12px] font-sans font-medium px-4 py-1.5 rounded-full border shrink-0 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap backdrop-blur-md ${
                  isActive 
                    ? 'bg-gradient-to-b from-white/20 to-white/10 border-white/35 text-white font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_4px_12px_rgba(0,0,0,0.4)]' 
                    : 'bg-white/[0.04] border-white/[0.08] text-white/60 hover:text-white hover:bg-white/10 hover:border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                }`}
              >
                <span>{f}</span>
                {count > 0 && (
                  <span className={`text-[10px] font-bold text-white px-2 py-0.5 rounded-full ${
                    isRedCount 
                      ? 'bg-[#ea4335]' 
                      : 'bg-white/20'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Unified Apple Glass Workspace Container */}
        <div className="flex-grow min-h-0 flex overflow-hidden w-full rounded-2xl border border-white/15 bg-[#0a0b10] shadow-2xl divide-x divide-white/[0.08]">
        
          {/* Pane 1: Left Conversation List */}
          <aside className="bg-[#101117] flex flex-col h-full lg:w-[32%] min-w-[280px] w-full overflow-hidden shrink-0">
            <header className="h-16 px-4 border-b border-white/[0.08] flex items-center justify-between shrink-0 bg-white/[0.01]">
              <h3 className="font-sans font-bold text-[15px] text-white">
                Conversations
              </h3>
              <span className="bg-white/10 border border-white/15 rounded-lg px-2.5 py-0.5 text-[11px] font-bold text-white/80 font-mono">
                {filteredChats.length}
              </span>
            </header>

            <div className="flex-grow min-h-0 overflow-y-auto p-3 space-y-2 no-scrollbar">
              {filteredChats.map((chat) => {
                const isSelected = chat.id === selectedChatId;
                return (
                  <button
                    key={chat.id}
                    onClick={() => {
                      setSelectedChatId(chat.id);
                      if (chat.unread) {
                        onUpdateConversation(chat.id, { unread: false });
                      }
                      setMobileView('chat');
                    }}
                    className={`w-full text-left p-3.5 flex gap-3 items-start transition-all cursor-pointer rounded-2xl border ${
                      isSelected 
                        ? 'bg-gradient-to-b from-white/[0.14] via-white/[0.06] to-white/[0.02] border-white/30 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_6px_20px_rgba(0,0,0,0.5)]' 
                        : 'bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.06] hover:border-white/15'
                    }`}
                  >
                    {/* Avatar with channel badge */}
                    <div className="relative shrink-0 mt-0.5">
                      <ChatAvatar name={getChatDisplayName(chat)} avatarUrl={chat.avatarUrl} sizeClass="w-10 h-10" />
                      <div className="absolute -bottom-1 -right-1 bg-[#09090b] p-0.5 rounded-full border border-white/25 shadow-md">
                        {renderPlatformIcon(chat.platform, 13)}
                      </div>
                    </div>

                    <div className="flex-grow min-w-0 space-y-0.5">
                      <div className="flex justify-between items-center">
                        <span className={`font-sans text-[13.5px] truncate ${chat.unread ? 'font-bold text-white' : 'font-semibold text-white/90'}`}>
                          {getChatDisplayName(chat)}
                        </span>
                        <span className="font-sans text-[10.5px] text-white/40 shrink-0 ml-2 font-mono">{chat.time}</span>
                      </div>
                      <p className="font-sans text-[12px] text-white/50 truncate leading-snug">
                        {chat.lastMessage}
                      </p>
                      
                      <div className="flex items-center gap-1.5 pt-1">
                        <span className={`inline-block font-sans text-[10.5px] px-2.5 py-0.5 rounded-full font-semibold border ${
                          chat.status === 'AI Managed' 
                            ? 'bg-white/10 border-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]' 
                            : 'bg-white/[0.04] border-white/10 text-white/60'
                        }`}>
                          {chat.status === 'AI Managed' ? 'AI managed' : 'Manual'}
                        </span>
                        {chat.isComplaint && (
                          <span className="inline-flex items-center gap-1 font-sans text-[10.5px] px-2 py-0.5 rounded-full font-semibold status-danger border border-red-400/30">
                            Complaint
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResolveComplaint(chat.id);
                              }}
                              className="ml-1 hover:text-white text-red-300 font-bold cursor-pointer"
                              title="Resolve complaint"
                            >
                              ✕
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Pane 2: Middle Message Thread */}
          <main className={`bg-[#07080b] flex flex-col h-full min-w-[360px] flex-1 overflow-hidden relative ${mobileView === 'chat' ? 'flex' : 'hidden lg:flex'}`}>
            <header className="h-16 px-4 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.01] shrink-0">
              <div className="flex items-center gap-3">
                <button 
                  type="button"
                  onClick={() => setMobileView('list')}
                  className="lg:hidden p-1.5 text-white/60 hover:text-white rounded-lg hover:bg-white/10 cursor-pointer shrink-0"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>

                <ChatAvatar name={activeChat ? getChatDisplayName(activeChat) : ''} avatarUrl={activeChat?.avatarUrl} sizeClass="w-10 h-10" />
                <div>
                  <h4 className="font-sans text-[15px] font-bold text-white leading-tight">{activeChat ? getChatDisplayName(activeChat) : ''}</h4>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="w-2 h-2 rounded-full bg-[#3ddc84] shadow-[0_0_8px_rgba(61,220,132,0.9)] animate-pulse-dot" />
                    <span className="font-sans text-[11.5px] text-white/50">
                      Active via {activeChat?.platform}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {activeChat?.isComplaint && (
                  <button
                    type="button"
                    onClick={() => handleResolveComplaint(activeChat.id)}
                    className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-xl font-sans text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                    title="Mark complaint as resolved"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Resolve Complaint
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMobileView('info')}
                  className="lg:hidden p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
                >
                  <FileText className="h-5 w-5" />
                </button>

                {/* 3-dot (horizontal) options menu button */}
                {activeChat && (
                  <div className="relative" ref={menuRef}>
                    <button
                      type="button"
                      onClick={() => setIsMenuOpen((prev) => !prev)}
                      className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition-all cursor-pointer flex items-center justify-center border border-white/10 bg-white/[0.04]"
                      title="More options"
                    >
                      <MoreHorizontal className="h-5 w-5" />
                    </button>

                    <AnimatePresence>
                      {isMenuOpen && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -8 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -8 }}
                          transition={{ duration: 0.15 }}
                          className="absolute right-0 mt-2 w-48 bg-[#181a20] border border-white/15 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.6)] py-1.5 z-50 overflow-hidden font-sans text-xs"
                        >
                          <button
                            type="button"
                            onClick={() => handleArchiveChat(activeChat.id)}
                            className="w-full text-left px-4 py-2.5 hover:bg-white/10 text-white/90 hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
                          >
                            <Archive className="h-4 w-4 text-blue-400" />
                            <span>{activeChat.isArchived ? 'Unarchive chat' : 'Archive chat'}</span>
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => handleSpamChat(activeChat.id)}
                            className="w-full text-left px-4 py-2.5 hover:bg-white/10 text-white/90 hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
                          >
                            <AlertOctagon className="h-4 w-4 text-amber-400" />
                            <span>{activeChat.isSpam ? 'Unmark as spam' : 'Mark as spam'}</span>
                          </button>

                          <div className="my-1 border-t border-white/10" />

                          <button
                            type="button"
                            onClick={() => handleDeleteChat(activeChat.id)}
                            className="w-full text-left px-4 py-2.5 hover:bg-red-500/20 text-red-400 hover:text-red-300 flex items-center gap-2.5 transition-colors cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                            <span className="font-semibold">Delete chat</span>
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </header>

            {/* Message Thread Area */}
            <div ref={messagesContainerRef} onScroll={handleMessagesScroll} className="flex-grow min-h-0 overflow-y-auto p-5 space-y-4 no-scrollbar">
              {activeChat?.isComplaint && (
                <div className="status-danger rounded-2xl p-3.5 flex items-center justify-between gap-3 text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <ShieldAlert className="h-5 w-5 text-[#ff9d92] mt-0.5 shrink-0" />
                    <div>
                      <p className="font-sans text-xs font-bold uppercase tracking-wider">Complaint isolation override</p>
                      <p className="text-[13px] text-white/80 leading-normal mt-0.5">Customer requested human support. Review conversation history below.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleResolveComplaint(activeChat.id)}
                    className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-xl font-sans text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer shadow-sm"
                    title="Mark complaint as resolved"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Mark Resolved
                  </button>
                </div>
              )}

              {activeChat?.messages.map((m, index) => {
                const isCustomer = m.sender === 'customer';
                const isPendingDraft = m.sender === 'ai' && m.pending;
                
                // Check if we need to show a date separator
                const showDateSeparator = index === 0 || isDifferentDay(
                  activeChat.messages[index - 1].time,
                  m.time
                );

                return (
                  <React.Fragment key={m.id}>
                    {/* Date Separator (like Messenger) */}
                    {showDateSeparator && (
                      <div className="flex items-center justify-center py-2">
                        <div className="bg-white/[0.08] border border-white/15 rounded-full px-4 py-1.5 backdrop-blur-md">
                          <span className="font-sans text-[11px] font-semibold text-white/70">
                            {formatDateSeparator(m.time)}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className={`flex w-full ${isCustomer ? 'justify-start' : 'justify-end'}`}>
                      {isPendingDraft ? (
                        <div className="zone-b-grey3 p-4 rounded-2xl max-w-[72%] text-left space-y-3 shadow-xl border border-blue-400/40">
                          <div className="flex items-center justify-between">
                            <span className="font-sans text-[11px] font-bold text-[#a9c6ff] tracking-wider flex items-center gap-1.5">
                              ✦ AI draft reply
                            </span>
                            <span className="font-sans text-[10.5px] text-white/50">{formatMessageTime(m.time)}</span>
                          </div>
                          <p className="text-[13.5px] text-white leading-relaxed">{m.text.replace(/<[^>]+>/g, '').trim()}</p>
                          {m.imageUrl && (
                            <img src={m.imageUrl} alt="" className="rounded-xl max-w-[220px] max-h-[220px] object-cover border border-white/10" />
                          )}

                          <div className="flex items-center gap-2 pt-2 border-t border-white/[0.07]">
                            <button
                              onClick={() => handleApproveDraft(m.id)}
                              disabled={approvingId === m.id}
                              className="btn-accent px-4 py-1.5 text-xs cursor-pointer disabled:opacity-50"
                            >
                              {approvingId === m.id ? 'Sending…' : 'Send now'}
                            </button>
                            <button
                              onClick={() => {
                                setInputText(m.text);
                                setEditingDraftId(m.id);
                              }}
                              className="btn-glass px-4 py-1.5 text-xs cursor-pointer"
                            >
                              Edit reply
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Message Bubbles matching Picture 1 */
                        <div className={`flex flex-col ${isCustomer ? 'items-start max-w-[62%]' : 'items-end max-w-[72%]'}`}>
                          <div className={`p-4 font-sans text-[13.5px] leading-relaxed transition-all ${
                            isCustomer
                              ? 'bg-gradient-to-b from-white/[0.08] via-white/[0.03] to-transparent border border-white/15 text-white rounded-[16px] rounded-bl-[4px] shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]'
                              : 'bg-gradient-to-b from-white/[0.12] via-[#1a1b22] to-[#121318] border border-white/20 text-white/95 rounded-[16px] rounded-br-[4px] shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_4px_16px_rgba(0,0,0,0.4)]'
                          }`}>
                            {m.sender === 'ai' && (
                              <div className="flex items-center gap-1.5 mb-1.5 text-white/80">
                                <span className="text-[11px] text-white">✦</span>
                                <span className="font-sans text-[10.5px] font-bold tracking-wider text-white uppercase">AI</span>
                              </div>
                            )}
                            <p>{m.text.replace(/<[^>]+>/g, '').trim()}</p>
                            {m.audioUrl && (
                              <div className="mt-2 space-y-2">
                                <div className="flex items-center gap-2 text-[11px] text-white/60">
                                  <Mic2 className="h-3.5 w-3.5" />
                                  <span>Voice message</span>
                                </div>
                                <audio controls preload="none" src={m.audioUrl} className="w-full max-w-[240px] h-8" />
                                {m.transcript && (
                                  <div className="border-l-2 border-white/20 pl-2 text-[11px] text-white/60 leading-relaxed">
                                    Transcript: {m.transcript}
                                  </div>
                                )}
                              </div>
                            )}
                            {m.imageUrl && (
                              <img src={m.imageUrl} alt="" className="mt-2 rounded-xl max-w-[220px] max-h-[220px] object-cover border border-white/10" />
                            )}
                          </div>
                          <span className="text-[10.5px] text-white/40 mt-1 px-1 font-mono">{formatMessageTime(m.time)}</span>
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}

              {isTyping && (
                <div className="flex w-full justify-end">
                  <div className="bg-gradient-to-b from-white/[0.12] via-[#1a1b22] to-[#121318] border border-white/20 max-w-[72%] rounded-[16px] rounded-br-[4px] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_4px_16px_rgba(0,0,0,0.4)]">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-bounce" />
                      <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-bounce [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-bounce [animation-delay:0.4s]" />
                      <span className="font-sans text-[11px] text-white/70 font-bold ml-1">
                        AI formulating response…
                      </span>
                    </div>
                  </div>
                </div>
              )}
              <div />
            </div>

            {/* Composer matching Picture 1 & 2 Apple Glass Design */}
            <footer className="p-4 border-t border-white/10 bg-black/30 backdrop-blur-xl space-y-3">
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage(inputText);
                }}
                className="flex gap-2 bg-gradient-to-b from-white/[0.09] to-white/[0.03] border border-white/20 rounded-full p-1.5 pl-3.5 items-center shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_10px_30px_rgba(0,0,0,0.4)] backdrop-blur-md"
              >
                <button 
                  type="button" 
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/15 transition-all cursor-pointer shrink-0"
                  onClick={() => setInputText("What other sizes are available?")}
                  title="Attach"
                >
                  <Plus className="h-4.5 w-4.5" />
                </button>
                
                <input
                  type="text"
                  required
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Type a message or use '/' for templates…"
                  className="flex-grow bg-transparent text-[13.5px] text-white placeholder-white/40 focus:outline-none px-2 font-sans"
                />

                <button
                  type="submit"
                  disabled={isTyping || !inputText.trim()}
                  className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center cursor-pointer disabled:opacity-40 shrink-0 shadow-[0_2px_10px_rgba(255,255,255,0.4)] transition-all hover:bg-white/90"
                >
                  <Send className="h-4 w-4 fill-current text-black" />
                </button>
              </form>

              {/* Action Chips + AI Copilot Control matching Picture 2 Apple Glass */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <button 
                  type="button"
                  onClick={() => setInputText("Here is a customized quote for a bulk order of 5 units. We can offer a discounted rate of $1,199.00 per unit.")}
                  className="bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-white/90 hover:text-white font-medium text-[11.5px] px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-md"
                >
                  <span className="text-white/60">✦</span> Suggest quote
                </button>
                <button 
                  type="button"
                  onClick={() => setInputText("The SM-99 Carbon L is one of our premium executive units featuring fully customized hardware.")}
                  className="bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-white/90 hover:text-white font-medium text-[11.5px] px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-md"
                >
                  <span className="text-white/60">📄</span> Insert SKU
                </button>

                {activeChat?.platform === 'websocket' && (
                  <button 
                    type="button"
                    onClick={() => {
                      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      const custMsg = {
                        id: `m-cust-ws-${Date.now()}`,
                        sender: 'customer' as const,
                        text: `Sure! My name is ${activeChat.customerName} and my address is House 21, Road 7, Banani, Dhaka.`,
                        time: timestamp
                      };
                      onUpdateConversation(activeChat.id, {
                        messages: [...activeChat.messages, custMsg],
                        lastMessage: custMsg.text,
                        time: 'Just now'
                      });
                    }}
                    className="bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 text-[#8cb4ff] font-medium text-[11.5px] px-3.5 py-2 rounded-xl cursor-pointer transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-md"
                  >
                    ⚡ Simulate customer order reply
                  </button>
                )}

                {/* AI Copilot toggle control matching Picture 2 prototype */}
                <div 
                  onClick={handleToggleAutomation}
                  className={`ml-auto flex items-center gap-3 px-4 py-2 rounded-full cursor-pointer select-none transition-all border backdrop-blur-xl ${
                    activeChat?.status === 'AI Managed'
                      ? 'bg-gradient-to-r from-[#2176ff] via-[#00a8e8] to-[#00d2ff] border-white/50 text-white shadow-[0_0_25px_rgba(0,168,232,0.65),inset_0_1px_0_rgba(255,255,255,0.7)] ring-1 ring-white/20'
                      : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/20 text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]'
                  }`}
                >
                  <span className="font-sans text-[12px] font-bold flex items-center gap-1">
                    ✦ AI copilot
                  </span>
                  
                  {/* Glass Pill Track & Glowing White Knob matching Picture 2 */}
                  <div className="w-[38px] h-[20px] bg-black/30 border border-white/40 rounded-full relative p-[2px] shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]">
                    <div 
                      className={`w-[14px] h-[14px] rounded-full bg-white transition-all duration-200 cubic-bezier(0.4,0,0.2,1) shadow-[0_2px_6px_rgba(0,0,0,0.4),0_0_8px_rgba(255,255,255,0.8)] ${
                        activeChat?.status === 'AI Managed' ? 'translate-x-[18px]' : 'translate-x-0'
                      }`}
                    />
                  </div>
                </div>
              </div>
            </footer>
          </main>

          {/* Pane 3: Right Cart Panel (No top header bar, section-based layout) */}
          <aside className={`bg-[#0d0e14] flex flex-col h-full lg:w-[22%] min-w-[240px] overflow-hidden shrink-0 ${mobileView === 'info' ? 'flex' : 'hidden lg:flex'}`}>
            <section className="p-4 space-y-4 flex-grow min-h-0 overflow-y-auto no-scrollbar">
              <div className="flex items-center justify-between">
                <h4 className="font-sans text-[13px] font-bold text-white/80 tracking-wide uppercase">
                  Cart
                </h4>
                {activeChat?.cart && activeChat.cart.length > 0 && (
                  <span className="status-success px-2.5 py-0.5 text-[10.5px] font-bold rounded-full">
                    Active
                  </span>
                )}
              </div>
              {!activeChat?.cart || activeChat.cart.length === 0 ? (
                <div className="bg-[#15161a] p-8 rounded-2xl border border-dashed border-white/12 text-center">
                  <p className="text-[13px] text-white/40 font-sans">No items in cart yet.</p>
                </div>
              ) : (
                <div className="zone-b-grey3 p-4 rounded-2xl space-y-3">
                  {activeChat.cart.map((item) => {
                    const product = products.find((p) => p.sku === item.sku);
                    return (
                      <div key={item.sku} className="flex justify-between items-start text-[13px] font-sans border-b border-white/[0.05] pb-2.5 last:border-0 last:pb-0">
                        <div className="flex-grow min-w-0 pr-2">
                          <span className="text-white font-bold block truncate">{product?.name || item.sku}</span>
                          <span className="text-white/50 text-[11.5px]">{formatPrice(product?.price || 0, product ? getProductCurrency(product.rawAttributes) || storeCurrency : storeCurrency)} each</span>
                          {/* Quantity controls — Section 4: allow cart quantity updates */}
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQty(item.sku, -1)}
                              className="w-5 h-5 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-xs font-bold transition-colors cursor-pointer"
                              title="Decrease quantity"
                            >−</button>
                            <span className="text-white font-bold text-xs min-w-[20px] text-center">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQty(item.sku, 1)}
                              className="w-5 h-5 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-xs font-bold transition-colors cursor-pointer"
                              title="Increase quantity"
                            >+</button>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className="text-white font-bold">{formatPrice((product?.price || 0) * item.quantity, product ? getProductCurrency(product.rawAttributes) || storeCurrency : storeCurrency)}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveCartItem(item.sku)}
                            className="text-white/40 hover:text-[#ff9d92] p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                            title="Remove item"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex justify-between items-center pt-2 border-t border-white/[0.08] text-sm font-sans font-bold text-white">
                    <span>Total</span>
                    <span>
                      {formatPrice(
                        activeChat.cart.reduce((sum, item) => sum + (products.find((p) => p.sku === item.sku)?.price || 0) * item.quantity, 0),
                        getOrderCurrency(activeChat.cart, products, storeCurrency)
                      )}
                    </span>
                  </div>

                  {orderError && (
                    <div className="status-danger text-[11px] p-2.5 rounded-xl text-center font-sans">
                      {orderError}
                    </div>
                  )}
                  {orderSuccess && (
                    <div className="status-success text-[11px] p-2.5 rounded-xl text-center font-sans">
                      {orderSuccess}
                    </div>
                  )}

                  <input
                    type="tel"
                    value={orderPhone}
                    onChange={(e) => setOrderPhone(e.target.value)}
                    placeholder="Phone number…"
                    className="w-full zone-b-input px-3 py-2.5 font-sans text-xs placeholder-white/38 outline-none"
                  />

                  <input
                    type="text"
                    value={orderAddress}
                    onChange={(e) => setOrderAddress(e.target.value)}
                    placeholder="Shipping address…"
                    className="w-full zone-b-input px-3 py-2.5 font-sans text-xs placeholder-white/38 outline-none"
                  />

                  <button
                    onClick={handleGenerateOrder}
                    disabled={isCreatingOrder}
                    className="w-full btn-light-primary py-2.5 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <FileText className="h-4 w-4" /> {isCreatingOrder ? 'Creating…' : 'Generate order'}
                  </button>
                </div>
              )}
              {/* Ongoing Orders Section */}
              <div className="pt-2">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-sans text-[13px] font-bold text-white/80">
                    Ongoing Orders
                  </h4>
                  {ongoingOrders.length > 0 && (
                    <span className="status-info px-2.5 py-0.5 text-[10.5px] font-bold rounded-full">
                      {ongoingOrders.length}
                    </span>
                  )}
                </div>

                {orderCancelError && (
                  <div className="status-danger text-[11px] p-2.5 rounded-xl text-center font-sans mb-2">
                    {orderCancelError}
                  </div>
                )}

                {ongoingOrders.length === 0 ? (
                  <div className="bg-[#15161a] p-6 rounded-2xl border border-dashed border-white/12 text-center">
                    <p className="text-[12px] text-white/35 font-sans">No ongoing orders.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {ongoingOrders.map((order) => (
                      <div key={order.id} className="zone-b-grey3 p-3.5 rounded-2xl space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-sans text-[10px] text-white/40 font-mono truncate max-w-[120px]" title={order.id}>
                            #{order.id.slice(-8).toUpperCase()}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            order.status === 'On the Way' ? 'status-info' : 'status-warning'
                          }`}>
                            {order.status}
                          </span>
                        </div>

                        <div className="space-y-1">
                          {order.items.map((item, idx) => (
                            <div key={idx} className="flex justify-between text-[11.5px] font-sans">
                              <span className="text-white/70 truncate pr-2">{item.name}</span>
                              <span className="text-white/50 shrink-0">×{item.quantity}</span>
                            </div>
                          ))}
                        </div>

                        <div className="flex justify-between items-center pt-1 border-t border-white/[0.07]">
                          <span className="font-sans text-[11px] text-white/40">
                            {new Date(order.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          </span>
                          <span className="font-sans text-[12px] font-bold text-white">
                            {formatPrice(order.total, getOrderCurrency(order.items, products, storeCurrency))}
                          </span>
                        </div>

                        {order.status !== 'Cancelled' && (
                          <button
                            onClick={() => handleCancelOrder(order.id)}
                            disabled={cancellingOrderId === order.id}
                            className="w-full px-3 py-1.5 text-[10.5px] font-bold rounded-full bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {cancellingOrderId === order.id ? 'Cancelling…' : 'Cancel Order'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Orders Section — shows all orders regardless of status */}
              <div className="pt-4 border-t border-white/[0.08]">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-sans text-[13px] font-bold text-white/80">
                    Recent Orders
                  </h4>
                  {recentOrders.length > 0 && (
                    <span className="status-neutral px-2.5 py-0.5 text-[10.5px] font-bold rounded-full">
                      {recentOrders.length}
                    </span>
                  )}
                </div>

                {recentOrders.length === 0 ? (
                  <div className="bg-[#15161a] p-6 rounded-2xl border border-dashed border-white/12 text-center">
                    <p className="text-[12px] text-white/35 font-sans">No order history.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentOrders.map((order) => {
                      const statusClass =
                        order.status === 'Delivered'
                          ? 'status-success'
                          : order.status === 'Cancelled'
                          ? 'status-danger'
                          : order.status === 'On the Way'
                          ? 'status-info'
                          : 'status-warning';

                      return (
                        <div key={order.id} className="zone-b-grey3 p-3.5 rounded-2xl space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="font-sans text-[10px] text-white/40 font-mono truncate max-w-[120px]" title={order.id}>
                              #{order.id.slice(-8).toUpperCase()}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusClass}`}>
                              {order.status}
                            </span>
                          </div>

                          <div className="space-y-1">
                            {order.items.map((item, idx) => (
                              <div key={idx} className="flex justify-between text-[11.5px] font-sans">
                                <span className="text-white/70 truncate pr-2">{item.name}</span>
                                <span className="text-white/50 shrink-0">×{item.quantity}</span>
                              </div>
                            ))}
                          </div>

                          <div className="flex justify-between items-center pt-1 border-t border-white/[0.07]">
                            <span className="font-sans text-[11px] text-white/40">
                              {new Date(order.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </span>
                            <span className="font-sans text-[12px] font-bold text-white">
                              {formatPrice(order.total, getOrderCurrency(order.items, products, storeCurrency))}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

          </aside>

        </div>
      </div>
    </div>
  );
}
