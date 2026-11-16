import React from 'react';
import {
  MessageSquare,
  Package,
  BarChart3,
  Grid,
  Settings,
  LogOut,
  X,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Bot,
  LayoutDashboard,
  Bell
} from 'lucide-react';
import { Tab } from '../types';

import { RemlinLogo } from './RemlinLogo';

interface SidebarProps {
  activeTab: Tab;
  onNavigate: (tab: Tab) => void;
  onLogout: () => void;
  isOpen?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  /** Open (non-closed) chats and how many of them the AI is handling on autopilot. */
  copilot: { total: number; managed: number };
  resizeHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  isResizing?: boolean;
}

// Same gradient and glow as the inbox "AI copilot" toggle.
const COPILOT_GRADIENT = 'linear-gradient(to right, #2176ff, #00a8e8, #00d2ff)';
const COPILOT_GLOW = '0 0 25px rgba(0, 168, 232, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.7)';

export default function Sidebar({ 
  activeTab, 
  onNavigate, 
  onLogout, 
  isOpen = false, 
  onOpen,
  onClose,
  isCollapsed,
  onToggleCollapse,
  copilot,
  resizeHandleProps,
  isResizing = false
}: SidebarProps) {
  const [isMobile, setIsMobile] = React.useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const copilotOn = copilot.managed > 0;
  const copilotPct = copilot.total > 0 ? Math.round((copilot.managed / copilot.total) * 100) : 0;
  const copilotLabel = copilotOn ? 'Copilot on' : 'Copilot off';
  const copilotDetail = copilot.total === 0
    ? 'No open chats yet'
    : `${copilot.managed} of ${copilot.total} open chat${copilot.total === 1 ? '' : 's'} on autopilot`;

  // On mobile (< md), default to the short/collapsed icon-only sidebar unless expanded via isOpen.
  // On desktop (md+), follow isCollapsed.
  const effectiveCollapsed = isMobile ? !isOpen : isCollapsed;

  const handleLogoToggle = () => {
    if (isMobile) {
      if (effectiveCollapsed) onOpen?.();
      else onClose?.();
    } else {
      onToggleCollapse();
    }
  };

  const menuItems = [
    { id: 'onboarding', label: 'Onboarding', icon: LayoutDashboard },
    { id: 'inbox', label: 'Unified inbox', icon: MessageSquare },
    { id: 'catalog', label: 'Product catalog', icon: Package },
    { id: 'persona', label: 'AI Persona', icon: Bot },
    { id: 'orders', label: 'Orders', icon: ClipboardList },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'integrations', label: 'Integrations', icon: Grid },
  ];

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          onClick={onClose}
          className="md:hidden fixed inset-0 bg-black/80 backdrop-blur-md z-45 transition-opacity duration-300"
        />
      )}

      <aside className={`zone-a-sidebar flex flex-col justify-between h-screen h-[100dvh] fixed top-0 left-0 z-50 md:z-30 select-none translate-x-0 ${
        isResizing ? '' : 'transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]'
      } ${
        effectiveCollapsed ? 'w-[60px] sm:w-[68px] md:w-[92px]' : 'w-[270px] sm:w-[290px] md:w-[var(--sidebar-w)]'
      }`}>
        <div className="flex flex-col flex-grow no-scrollbar overflow-y-auto">
          <header className={`px-2 sm:px-5 py-3 sm:py-4 h-[60px] sm:h-[72px] flex items-center ${effectiveCollapsed ? 'justify-center px-2 md:px-4' : 'justify-between px-4 sm:px-5'} border-b border-white/[0.08] relative shrink-0`}>
            <button
              type="button"
              onClick={handleLogoToggle}
              title={effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={`flex items-center gap-3 cursor-pointer rounded-xl p-1.5 -m-1.5 hover:bg-white/[0.08] transition-colors ${effectiveCollapsed ? 'justify-center' : ''}`}
            >
              <RemlinLogo className="h-7 sm:h-8 w-auto shrink-0" />
              {!effectiveCollapsed && (
                <span className="font-sans text-[20px] sm:text-[22px] font-bold text-white leading-none tracking-tight">Remlin</span>
              )}
            </button>
          </header>

          {/* Nav Items matching Picture 1 */}
          <nav className={`px-4 py-3 sm:py-6 flex-grow ${effectiveCollapsed ? 'flex flex-col items-center gap-1.5 sm:gap-2 px-0' : 'space-y-2'}`}>
            {menuItems.map((item) => {
              const IconComponent = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id as Tab)}
                  title={effectiveCollapsed ? item.label : undefined}
                  className={`flex items-center transition-all duration-200 cursor-pointer ${
                    effectiveCollapsed 
                      ? `w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12 rounded-xl justify-center ${
                          isActive 
                            ? 'bg-[#222634] border border-white/20 text-white shadow-md' 
                            : 'bg-transparent text-white/70 hover:text-white hover:bg-white/[0.08]'
                        }`
                      : `w-full text-left px-4 py-3 rounded-xl gap-3.5 ${
                          isActive 
                            ? 'bg-[#222634] border border-white/20 text-white font-medium shadow-md' 
                            : 'bg-transparent text-white/70 hover:text-white hover:bg-white/[0.08]'
                        }`
                  }`}
                >
                  <div className="w-5 h-5 flex items-center justify-center shrink-0">
                    <IconComponent className="h-4.5 w-4.5" />
                  </div>
                  {!effectiveCollapsed && <span className="font-sans text-[14px] leading-none">{item.label}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Footer / AI Training & Settings */}
        <div className={`p-2.5 sm:p-4 border-t border-white/[0.08] ${effectiveCollapsed ? 'flex flex-col items-center gap-2.5 sm:gap-4 px-0' : 'space-y-4'}`}>
          {/* Copilot status — reflects how many open chats are actually on autopilot */}
          {effectiveCollapsed ? (
            <div
              className={`p-2 rounded-full border transition-all ${copilotOn ? 'border-white/50 ring-1 ring-white/20' : 'bg-white/[0.06] border-white/10'}`}
              style={copilotOn ? { background: COPILOT_GRADIENT, boxShadow: COPILOT_GLOW } : undefined}
              title={`${copilotLabel} — ${copilotDetail}`}
            >
              <span className={`w-2.5 h-2.5 rounded-full block ${copilotOn ? 'bg-white animate-pulse-dot shadow-[0_0_8px_rgba(255,255,255,0.9)]' : 'bg-white/30'}`} />
            </div>
          ) : (
            <div
              className={`p-3.5 rounded-2xl border transition-all ${copilotOn ? 'border-white/50 ring-1 ring-white/20' : 'bg-white/[0.06] border-white/10'}`}
              style={copilotOn ? { background: COPILOT_GRADIENT, boxShadow: COPILOT_GLOW } : undefined}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full block ${copilotOn ? 'bg-white animate-pulse-dot shadow-[0_0_8px_rgba(255,255,255,0.9)]' : 'bg-white/30'}`} />
                <span className={`font-sans text-[11.5px] font-bold text-white`}>{copilotLabel}</span>
              </div>
              <p className={`font-sans text-[10.5px] mb-2 truncate ${copilotOn ? 'text-white/80' : 'text-white/50'}`}>{copilotDetail}</p>
              <div className={`w-full h-[5px] rounded-full overflow-hidden ${copilotOn ? 'bg-black/25' : 'bg-white/10'}`}>
                <div
                  className="h-full transition-all duration-500"
                  style={{ width: `${copilotPct}%`, background: '#fff', boxShadow: '0 0 8px rgba(255,255,255,0.8)' }}
                />
              </div>
            </div>
          )}

          {/* Settings & Logout */}
          <div className={`space-y-1.5 ${effectiveCollapsed ? 'w-full flex flex-col items-center gap-1 sm:gap-1.5' : ''}`}>
            <button
              onClick={() => onNavigate('settings')}
              title={effectiveCollapsed ? 'Settings' : undefined}
              className={`flex items-center transition-all duration-180 cursor-pointer ${
                effectiveCollapsed 
                  ? `w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12 rounded-xl justify-center ${activeTab === 'settings' ? 'bg-[#2757d8] text-white' : 'text-white/65 hover:text-white hover:bg-white/[0.08]'}`
                  : `w-full text-left px-4 py-2.5 rounded-xl gap-3.5 ${activeTab === 'settings' ? 'bg-[#2757d8] text-white font-medium' : 'text-white/65 hover:text-white hover:bg-white/[0.08]'}`
              }`}
            >
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                <Settings className="h-4.5 w-4.5" />
              </div>
              {!effectiveCollapsed && <span className="font-sans text-[13.5px]">Settings</span>}
            </button>

            <button 
              onClick={onLogout}
              title={effectiveCollapsed ? 'Log out' : undefined}
              className={`flex items-center transition-all duration-180 cursor-pointer ${
                effectiveCollapsed 
                  ? 'w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12 rounded-xl justify-center text-white/50 hover:text-[#ffb4b4] hover:bg-[rgba(255,90,90,0.14)]'
                  : 'w-full text-left px-4 py-2.5 rounded-xl gap-3.5 text-white/50 hover:text-[#ffb4b4] hover:bg-[rgba(255,90,90,0.14)]'
              }`}
            >
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                <LogOut className="h-4.5 w-4.5" />
              </div>
              {!effectiveCollapsed && <span className="font-sans text-[13.5px]">Log out</span>}
            </button>
          </div>
        </div>

        {/* Drag the right edge to resize (double-click to reset) */}
        {!effectiveCollapsed && resizeHandleProps && (
          <div
            {...resizeHandleProps}
            title="Drag to resize · double-click to reset"
            className={`hidden md:block absolute top-0 -right-1 w-2 h-full z-40 cursor-col-resize transition-colors ${isResizing ? 'bg-[#00a8e8]/50' : 'hover:bg-[#00a8e8]/35'}`}
          />
        )}
      </aside>
    </>
  );
}
