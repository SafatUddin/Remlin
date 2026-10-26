import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Tab, Product, Integration, AIPersona, Conversation, ChatMessage } from './types';
import {
  INITIAL_INTEGRATIONS,
  DEFAULT_AI_PERSONA,
} from './data/mockData';
import {
  clearLegacyTokenStorage,
  logout,
  fetchMe,
  updateProfile,
  updateStoreProfile,
  uploadAvatar,
  deleteAvatar,
  listProducts,
  createProduct,
  updateProduct,
  deleteProducts,
  uploadProductImage,
  deleteProductImage,
  setProductImageUrl,
  getPersona,
  updatePersona,
  uploadOpeningImage,
  deleteOpeningImage,
  listConversations,
  updateConversationStatus,
  deleteConversation,
  listChannels,
  exchangeGoogleCode,
  AuthResponse,
  OnboardingResponse,
  PublicMerchant,
  PublicStore,
} from './lib/api';

// Component Imports
import LandingPage from './components/LandingPage';
import LoginPage from './components/LoginPage';
import SignupPage from './components/SignupPage';
import OnboardingPage from './components/OnboardingPage';
import Sidebar from './components/Sidebar';
import InboxConsole from './components/InboxConsole';
import ProductCatalog from './components/ProductCatalog';
import AgentPersona from './components/AgentPersona';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import IntegrationsHub from './components/IntegrationsHub';
import OrdersPage from './components/OrdersPage';
import BookingsPage from './components/BookingsPage';
import SettingsPage from './components/SettingsPage';
import AdminDashboard from './components/AdminDashboard';
import AdminSettings from './components/AdminSettings';

// Dashboard pages a logged-in merchant is returned to after a browser refresh.
const RESTORABLE_TABS: Tab[] = ['inbox', 'catalog', 'persona', 'orders', 'bookings', 'analytics', 'integrations', 'settings', 'support'];

// ─────────────────────────────────────────────────────────────────────────
// App is the single root component: it owns navigation, the auth session,
// and every domain's data (products/persona/conversations/integrations),
// then routes to one of the page components in src/components/ based on
// activeTab. This file mixes several concerns that would normally live in
// separate custom hooks (useAuthSession, useAppNavigation, useProducts,
// etc.) — everything below is grouped and commented by responsibility so
// it reads that way even though it hasn't been physically split yet.
// ─────────────────────────────────────────────────────────────────────────
export default function App() {
  // ── Navigation state ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('landing');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  // Reset scroll to top whenever the active tab changes
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [activeTab]);

  // Pushes a browser history entry per tab change so the back button undoes the last
  // in-app navigation instead of leaving the whole app.
  // Safe navigation: if authenticated but profile is incomplete, only allow onboarding-related tabs.
  // We reference `profileComplete` via a ref so the function doesn't need to re-bind on every state change.
  const profileCompleteRef = useRef(false);
  const isAuthenticatedRef = useRef(false);
  // The URL hash at page load (e.g. "#catalog"), captured before it gets rewritten, so a
  // browser refresh can put the merchant back on the page they were on.
  const initialHashRef = useRef(window.location.hash);

  const navigateTo = (tab: Tab, replace = false) => {
    const dashboard_tabs: Tab[] = ['inbox', 'catalog', 'persona', 'orders', 'bookings', 'analytics', 'integrations', 'settings', 'support'];
    const effectiveTab: Tab =
      isAuthenticatedRef.current && !profileCompleteRef.current && dashboard_tabs.includes(tab)
        ? 'onboarding'
        : tab;
    setActiveTab(effectiveTab);
    if (replace) {
      window.history.replaceState({ tab: effectiveTab }, '', `#${effectiveTab}`);
    } else {
      window.history.pushState({ tab: effectiveTab }, '', `#${effectiveTab}`);
    }
  };

  useEffect(() => {
    // Don't overwrite the URL if the Google OAuth callback hash is still present —
    // the Google callback useEffect (below) needs to read it before it is cleaned.
    const incomingHash = window.location.hash;
    const hasGoogleParams = incomingHash.includes('googleCode') || incomingHash.includes('googleError');
    if (!hasGoogleParams) {
      window.history.replaceState({ tab: activeTab }, '', `#${activeTab}`);
    }
    const handlePopState = (e: PopStateEvent) => {
      const requested = (e.state?.tab as Tab) || 'landing';
      const dashboard_tabs: Tab[] = ['inbox', 'catalog', 'persona', 'orders', 'bookings', 'analytics', 'integrations', 'settings', 'support'];
      const tab: Tab =
        isAuthenticatedRef.current && !profileCompleteRef.current && dashboard_tabs.includes(requested)
          ? 'onboarding'
          : requested;
      setActiveTab(tab);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // ── Auth session state ────────────────────────────────────────────────
  // Real auth state — merchant is null when logged out
  const [merchant, setMerchant] = useState<PublicMerchant | null>(null);
  const [store, setStore] = useState<PublicStore | null>(null);
  const [profileComplete, setProfileComplete] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [authFlashError, setAuthFlashError] = useState('');
  const isAuthenticated = !!merchant;

  // DashboardHeader reads this shape straight out of localStorage; keep it in sync
  // with whatever the backend says is the current merchant.
  const syncProfileToLocalStorage = (m: PublicMerchant) => {
    const profile = {
      name: m.name,
      email: m.email,
      avatarUrl: m.avatarUrl,
    };
    localStorage.setItem('shopmate_user_profile', JSON.stringify(profile));
    window.dispatchEvent(new Event('shopmate_profile_updated'));
  };

  // On load, verify session via HttpOnly cookie (/api/me) instead of localStorage.
  useEffect(() => {
    clearLegacyTokenStorage();
    fetchMe()
      .then((res) => {
        isAuthenticatedRef.current = true;
        profileCompleteRef.current = res.profileComplete;
        setMerchant(res.merchant);
        setStore(res.store);
        setProfileComplete(res.profileComplete);
        setIsAdmin(res.isAdmin ?? false);
        syncProfileToLocalStorage(res.merchant);
        // Admin goes to admin dashboard; others return to the page they refreshed on,
        // falling back to inbox (or onboarding if the profile is incomplete).
        if (res.isAdmin) {
          navigateTo('admin', true);
        } else if (!res.profileComplete) {
          navigateTo('onboarding', true);
        } else {
          const initialHash = initialHashRef.current;
          const hashTab = initialHash.slice(1).split('?')[0] as Tab;
          const restoreTab = RESTORABLE_TABS.includes(hashTab) ? hashTab : null;
          navigateTo(restoreTab ?? 'inbox', true);
          // Keep any query (e.g. "#integrations?shopifyConnected=1") for the page to read
          if (restoreTab && initialHash.includes('?')) {
            window.history.replaceState({ tab: restoreTab }, '', initialHash);
          }
        }
      })
      .catch(() => {
        // Not authenticated — expected on first visit or after logout.
      })
      .finally(() => setIsCheckingAuth(false));
  }, []);

  // Detect a successful Google OAuth callback — backend redirects to
  // /#login?googleCode=<opaque> ; exchange establishes HttpOnly session (never in URL).
  useEffect(() => {
    const hash = window.location.hash;
    const queryIndex = hash.indexOf('?');
    if (queryIndex === -1) return;
    const params = new URLSearchParams(hash.slice(queryIndex + 1));

    const googleCode = params.get('googleCode');
    const googleError = params.get('googleError');
    if (!googleCode && !googleError) return;

    // Clean the URL before any state change
    window.history.replaceState(null, '', '#login');

    if (googleError) {
      setAuthFlashError(googleError);
      setActiveTab('login');
      setIsCheckingAuth(false);
      return;
    }

    setIsCheckingAuth(true);
    exchangeGoogleCode(googleCode!)
      .then((auth) => handleAuthSuccess(auth))
      .catch(() => {
        setAuthFlashError('Google sign-in failed');
        setActiveTab('login');
      })
      .finally(() => setIsCheckingAuth(false));
  }, []);

  // Listen to custom header actions for seamless routing & logging out
  useEffect(() => {
    const handleNavigateEvent = (e: Event) => {
      const tab = (e as CustomEvent).detail as Tab;
      navigateTo(tab);
      setIsSidebarOpen(false);
    };
    const handleLogoutEvent = () => {
      handleLogout();
    };
    const handleToggleSidebarEvent = () => {
      setIsSidebarOpen(prev => !prev);
    };
    // When a dashboard API call receives PROFILE_INCOMPLETE 403, redirect to onboarding.
    const handleProfileIncomplete = () => {
      profileCompleteRef.current = false;
      setProfileComplete(false);
      setActiveTab('onboarding');
      window.history.replaceState({ tab: 'onboarding' }, '', '#onboarding');
    };
    window.addEventListener('shopmate_navigate', handleNavigateEvent);
    window.addEventListener('shopmate_logout', handleLogoutEvent);
    window.addEventListener('shopmate_toggle_sidebar', handleToggleSidebarEvent);
    window.addEventListener('shopmate_profile_incomplete', handleProfileIncomplete);
    return () => {
      window.removeEventListener('shopmate_navigate', handleNavigateEvent);
      window.removeEventListener('shopmate_logout', handleLogoutEvent);
      window.removeEventListener('shopmate_toggle_sidebar', handleToggleSidebarEvent);
      window.removeEventListener('shopmate_profile_incomplete', handleProfileIncomplete);
    };
  }, []);

  const handleAuthSuccess = (auth: AuthResponse) => {
    clearLegacyTokenStorage();
    isAuthenticatedRef.current = true;
    profileCompleteRef.current = auth.profileComplete ?? false;
    setMerchant(auth.merchant);
    setStore(auth.store);
    setProfileComplete(auth.profileComplete ?? false);
    setIsAdmin(auth.isAdmin ?? false);
    setAuthFlashError('');
    syncProfileToLocalStorage(auth.merchant);
    // Admin goes to admin dashboard, others go to inbox or onboarding
    if (auth.isAdmin) {
      navigateTo('admin');
    } else {
      navigateTo(auth.profileComplete ? 'inbox' : 'onboarding');
    }
    setIsSidebarOpen(false);
  };

  const handleOnboardingComplete = (response: OnboardingResponse) => {
    profileCompleteRef.current = true;
    setProfileComplete(true);
    if (response.merchant) {
      setMerchant(response.merchant);
      syncProfileToLocalStorage(response.merchant);
    }
    if (response.store) setStore(response.store);
    navigateTo('inbox');
  };

  const handleUpdateProfile = async (updates: {
    name?: string;
    phone?: string;
    email?: string;
    currentPassword?: string;
    password?: string;
  }) => {
    const result = await updateProfile(updates);
    setMerchant(result.merchant);
    syncProfileToLocalStorage(result.merchant);
    if (typeof result.profileComplete === 'boolean') {
      profileCompleteRef.current = result.profileComplete;
      setProfileComplete(result.profileComplete);
      if (!result.profileComplete) navigateTo('onboarding');
    }
  };

  const handleUpdateStore = async (updates: Partial<PublicStore>) => {
    const result = await updateStoreProfile(updates);
    setStore(result.store);
    if (typeof result.profileComplete === 'boolean') {
      profileCompleteRef.current = result.profileComplete;
      setProfileComplete(result.profileComplete);
      if (!result.profileComplete) navigateTo('onboarding');
    }
  };

  const handleUploadAvatar = async (file: File) => {
    const { merchant: updated } = await uploadAvatar(file);
    setMerchant(updated);
    syncProfileToLocalStorage(updated);
  };

  const handleDeleteAvatar = async () => {
    const { merchant: updated } = await deleteAvatar();
    setMerchant(updated);
    syncProfileToLocalStorage(updated);
  };

  // ── Domain data state (products/integrations/persona/conversations) ────
  // Each domain below owns its own state + fetch/mutation handlers, all scoped
  // to this one component — see "Product mutations" / "Persona save" /
  // "Conversations updating" / "Integration mutations" comments further down
  // for where each domain's handlers live.
  const [products, setProducts] = useState<Product[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>(INITIAL_INTEGRATIONS);
  const [persona, setPersona] = useState<AIPersona>(DEFAULT_AI_PERSONA);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Which channel types actually have a connected Channel row right now — the Inbox
  // only shows chat for channels a merchant has genuinely connected, not just any
  // conversation that happens to exist in the DB (e.g. a channel disconnected after
  // real messages already came in).
  const [connectedPlatforms, setConnectedPlatforms] = useState<Set<string>>(new Set());

  const refreshChannels = () => {
    listChannels()
      .then((channels) => setConnectedPlatforms(new Set(channels.filter((c) => c.connected).map((c) => c.type))))
      .catch((err) => console.error('Failed to load channels:', err));
  };

  const [isWebsiteConnected, setIsWebsiteConnected] = useState(false);

  const reloadProducts = async () => {
    const res = await listProducts();
    setProducts(res.products);
    setIsWebsiteConnected(!!res.isWebsiteConnected);
  };

  // Load real catalog + persona + conversations from the backend once we know who's logged in.
  // Skip all dashboard fetches until onboarding is complete — they would all 403 anyway.
  useEffect(() => {
    if (!merchant || !profileComplete) return;
    reloadProducts().catch((err) => console.error('Failed to load products:', err));
    getPersona()
      .then((p) => setPersona({ 
        tone: p.tone, 
        style: p.style as AIPersona['style'], 
        customInstructions: p.customInstructions, 
        autoFinalizeOrdersAlways: p.autoFinalizeOrdersAlways, 
        openingText: p.openingText, 
        openingImageUrl: p.openingImageUrl,
        shareBusinessInfo: p.shareBusinessInfo,
        businessInfo: p.businessInfo
      }))
      .catch((err) => console.error('Failed to load persona:', err));
    listConversations().then(setConversations).catch((err) => console.error('Failed to load conversations:', err));
    refreshChannels();
  }, [merchant, profileComplete]);

  // Poll for new conversations/messages (e.g. real incoming Facebook messages) and channel
  // connection state so the Inbox reflects them without requiring a manual page refresh.
  useEffect(() => {
    if (!merchant || !profileComplete) return;
    const interval = setInterval(() => {
      listConversations().then(setConversations).catch((err) => console.error('Failed to refresh conversations:', err));
      refreshChannels();
    }, 5000);
    return () => clearInterval(interval);
  }, [merchant, profileComplete]);

  // Keep stored conversations visible even when a provider is disconnected or its
  // connection check is temporarily unavailable. Connection state controls whether new
  // provider messages can arrive/send, not whether the merchant can inspect history.
  const visibleConversations = conversations;

  // Navigation controller
  const handleNavigate = (tab: Tab) => {
    navigateTo(tab);
    setIsSidebarOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    isAuthenticatedRef.current = false;
    profileCompleteRef.current = false;
    setMerchant(null);
    setStore(null);
    setProfileComplete(false);
    setIsAdmin(false);
    navigateTo('landing');
    setIsSidebarOpen(false);
  };

  // Product mutations
  const handleAddProduct = async (newProduct: Omit<Product, 'id'>) => {
    const created = await createProduct(newProduct);
    setProducts((prev) => [created, ...prev]);
    return created;
  };

  const handleEditProduct = async (id: string, updates: Omit<Product, 'id' | 'imageUrl' | 'imageSource'>) => {
    const updated = await updateProduct(id, updates);
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    return updated;
  };

  const handleDeleteProducts = async (ids: string[]) => {
    const { deletedIds } = await deleteProducts(ids);
    const deleted = new Set(deletedIds);
    setProducts((prev) => prev.filter(p => !deleted.has(p.id)));
  };

  const handleUploadProductImage = async (id: string, file: File) => {
    const updated = await uploadProductImage(id, file);
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
  };

  const handleSetProductImageUrl = async (id: string, imageUrl: string) => {
    const updated = await setProductImageUrl(id, imageUrl);
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
  };

  const handleDeleteProductImage = async (id: string) => {
    const updated = await deleteProductImage(id);
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
  };

  // Integration mutations
  const handleToggleIntegration = (id: string) => {
    setIntegrations((prev) => prev.map((item) => {
      if (item.id === id) {
        const nextConnected = !item.connected;
        return {
          ...item,
          connected: nextConnected,
          statusText: nextConnected ? 'Active Sync' : 'Sync Paused'
        };
      }
      return item;
    }));
  };

  const handleRefreshAllIntegrations = async () => {
    // Simulating deep inventory pull
    setIntegrations((prev) => prev.map((item) => {
      if (item.connected) {
        return {
          ...item,
          statusText: 'Synchronized ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
      }
      return item;
    }));
  };

  // Persona save
  const handleSavePersona = async (newPersona: AIPersona) => {
    const saved = await updatePersona(newPersona);
    setPersona((prev) => ({
      tone: saved.tone,
      style: saved.style as AIPersona['style'],
      customInstructions: saved.customInstructions,
      autoFinalizeOrdersAlways: saved.autoFinalizeOrdersAlways,
      openingText: saved.openingText,
      openingImageUrl: saved.openingImageUrl ?? prev.openingImageUrl,
      shareBusinessInfo: saved.shareBusinessInfo,
      businessInfo: saved.businessInfo,
    }));
  };

  const handleUploadOpeningImage = async (file: File) => {
    const { openingImageUrl } = await uploadOpeningImage(file);
    setPersona((prev) => ({ ...prev, openingImageUrl }));
  };

  const handleDeleteOpeningImage = async () => {
    await deleteOpeningImage();
    setPersona((prev) => ({ ...prev, openingImageUrl: undefined }));
  };

  // Conversations updating
  const handleUpdateConversation = (chatId: string, updates: Partial<Conversation>) => {
    setConversations((prev) => prev.map((chat) => {
      if (chat.id === chatId) {
        const updated = {
          ...chat,
          ...updates,
        };
        if (updates.messages) {
          updated.lastMessage = updates.messages[updates.messages.length - 1]?.text || chat.lastMessage;
          updated.unread = false;
        }
        return updated;
      }
      return chat;
    }));
  };

  const handleUpdateConversationStatus = async (chatId: string, status: 'Active' | 'AI Managed' | 'Closed') => {
    const updated = await updateConversationStatus(chatId, status);
    setConversations((prev) => prev.map((chat) => (chat.id === chatId ? { ...chat, ...updated } : chat)));
  };

  const handleDeleteConversation = async (chatId: string) => {
    setConversations((prev) => prev.filter((chat) => chat.id !== chatId));
    try {
      await deleteConversation(chatId);
    } catch (err) {
      console.error('Failed to delete conversation on server:', err);
    }
  };

  // ── Page routing ─────────────────────────────────────────────────────
  // renderPageContent below is the switch that maps activeTab to a page
  // component, passing it the relevant domain state + handlers as props.
  // Shared by the 'inbox' tab and the authenticated default fallback below.
  const renderInbox = () => {
    if (connectedPlatforms.size === 0 && conversations.length === 0) {
      return (
        <div className="w-full flex-grow flex flex-col items-center justify-center text-center px-6 h-full overflow-x-hidden">
          <h3 className="font-sans font-bold text-sm text-white uppercase tracking-wider">No Channels Connected</h3>
          <p className="font-sans text-xs text-white/40 max-w-xs mt-2 leading-relaxed">
            Connect a channel like Facebook Messenger to start receiving and replying to real customer conversations here.
          </p>
          <button
            onClick={() => handleNavigate('integrations')}
            className="mt-5 bg-white hover:bg-white/90 text-black font-sans font-extrabold text-[10px] uppercase tracking-wider px-4 py-2 rounded transition-all cursor-pointer"
          >
            Go to Integrations
          </button>
        </div>
      );
    }
    return (
      <InboxConsole
        conversations={visibleConversations}
        products={products}
        onUpdateConversation={handleUpdateConversation}
        onUpdateConversationStatus={handleUpdateConversationStatus}
        onDeleteConversation={handleDeleteConversation}
      />
    );
  };

  // Main page rendering logic based on active tab and authentication
  const renderPageContent = () => {
    if (!isAuthenticated) {
      switch (activeTab) {
        case 'landing':
          return <LandingPage onNavigate={handleNavigate} />;
        case 'login':
          return (
            <LoginPage
              onNavigate={handleNavigate}
              onLoginSuccess={handleAuthSuccess}
              initialError={authFlashError}
            />
          );
        case 'signup':
          return <SignupPage onNavigate={handleNavigate} onSignupSuccess={handleAuthSuccess} />;
        default:
          return <LandingPage onNavigate={handleNavigate} />;
      }
    }

    // Authenticated but profile incomplete — mandatory onboarding gate.
    // Render the onboarding page outside the sidebar layout below.
    if (!profileComplete) {
      return null; // rendered separately in the layout below
    }

    // Authenticated + complete views
    switch (activeTab) {
      case 'admin':
        return <AdminDashboard />;
      case 'settings':
        // If admin, show admin settings; otherwise show merchant settings
        if (isAdmin) {
          return (
            <AdminSettings
              merchant={merchant}
              onUpdateProfile={handleUpdateProfile}
              onLogout={handleLogout}
            />
          );
        }
        return (
          <SettingsPage
            merchant={merchant}
            store={store}
            onUpdateProfile={handleUpdateProfile}
            onUpdateStore={handleUpdateStore}
            onUploadAvatar={handleUploadAvatar}
            onDeleteAvatar={handleDeleteAvatar}
          />
        );
      case 'inbox':
        return renderInbox();
      case 'catalog':
        return (
          <ProductCatalog
            products={products}
            isWebsiteConnected={isWebsiteConnected}
            onAddProduct={handleAddProduct}
            onEditProduct={handleEditProduct}
            onDeleteProducts={handleDeleteProducts}
            onUploadProductImage={handleUploadProductImage}
            onSetProductImageUrl={handleSetProductImageUrl}
            onDeleteProductImage={handleDeleteProductImage}
          />
        );
      case 'persona':
        return (
          <AgentPersona
            persona={persona}
            onSavePersona={handleSavePersona}
            onUploadOpeningImage={handleUploadOpeningImage}
            onDeleteOpeningImage={handleDeleteOpeningImage}
          />
        );
      case 'orders':
        return <OrdersPage products={products} />;
      case 'bookings':
        return <BookingsPage products={products} />;
      case 'analytics':
        return <AnalyticsDashboard />;
      case 'integrations':
        return (
          <IntegrationsHub 
            integrations={integrations}
            onToggleConnection={handleToggleIntegration}
            onRefreshAll={handleRefreshAllIntegrations}
            onReloadProducts={reloadProducts}
            onGoToCatalog={() => handleNavigate('catalog')}
          />
        );
      default:
        return renderInbox();
    }
  };

  // ── Layout / render ──────────────────────────────────────────────────
  // Below: a loading spinner while the session check is in flight, then the
  // onboarding gate (no Sidebar chrome), then the real app shell — Sidebar
  // + main content — for authenticated users, or the raw page for guests.
  if (isCheckingAuth) {
    return (
      <div className="bg-background min-h-screen w-full flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  // Authenticated but profile incomplete: render onboarding without Sidebar chrome
  if (isAuthenticated && !profileComplete && merchant && store) {
    return (
      <OnboardingPage
        merchant={merchant}
        store={store}
        onComplete={handleOnboardingComplete}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="app-bg-gradient min-h-screen text-on-surface w-full relative overflow-x-hidden">
      {/* Ambient bloom effects */}
      <div className="ambient-bloom-tl" />
      <div className="ambient-bloom-br" />

      {/* If authenticated and profile complete, wrap in persistent Sidebar layout */}
      {isAuthenticated ? (
        isAdmin ? (
          /* Admin layout - no sidebar */
          <main ref={mainRef} className="h-screen flex flex-col flex-1 min-w-0 overflow-y-auto no-scrollbar relative z-10">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="flex-1 min-h-0 w-full flex flex-col"
              >
                {renderPageContent()}
              </motion.div>
            </AnimatePresence>
          </main>
        ) : (
          /* Regular merchant layout - with sidebar */
          <div className="flex w-full min-h-screen">
            {/* Sidebar Left Navigation */}
            <Sidebar 
              activeTab={activeTab} 
              onNavigate={handleNavigate} 
              onLogout={handleLogout} 
              isOpen={isSidebarOpen}
              onClose={() => setIsSidebarOpen(false)}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
            />

            {/* Core Content Area — h-screen, inner page content scrolls without visible scrollbar */}
            <main ref={mainRef} className={`pl-0 ${isSidebarCollapsed ? 'md:pl-24' : 'md:pl-[290px]'} h-screen flex flex-col flex-1 min-w-0 ${activeTab === 'inbox' ? 'overflow-hidden' : 'overflow-y-auto'} no-scrollbar transition-all duration-300 relative z-10`}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className={`flex-1 min-h-0 w-full flex flex-col ${activeTab === 'inbox' ? 'overflow-hidden' : ''}`}
                >
                  {renderPageContent()}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        )
      ) : (
        /* If unauthenticated, render raw consumer view directly */
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full min-h-screen"
          >
            {renderPageContent()}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
