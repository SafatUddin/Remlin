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
  LayoutDashboard

} from 'lucide-react';
import { Tab } from '../types';

import { RemlinLogo } from './RemlinLogo';

interface SidebarProps {
  activeTab: Tab;
  onNavigate: (tab: Tab) => void;
  onLogout: () => void;
  isOpen?: boolean;
  onClose?: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({ 
  activeTab, 
  onNavigate, 
  onLogout, 
  isOpen = false, 
  onClose,
  isCollapsed,
  onToggleCollapse
}: SidebarProps) {
  const menuItems = [
    { id: 'onboarding', label: 'Onboarding', icon: LayoutDashboard },
    { id: 'inbox', label: 'Unified inbox', icon: MessageSquare },
    { id: 'catalog', label: 'Product catalog', icon: Package },
    { id: 'persona', label: 'AI Persona', icon: Bot },
    { id: 'orders', label: 'Orders', icon: ClipboardList },
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

      <aside className={`zone-a-sidebar flex flex-col justify-between h-screen fixed top-0 left-0 z-50 md:z-30 select-none transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
        isCollapsed ? 'w-[92px]' : 'w-[290px]'
      } ${
        isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}>
        <div className="flex flex-col flex-grow no-scrollbar overflow-y-auto">
          <header className={`px-5 py-4 h-[72px] flex items-center ${isCollapsed ? 'justify-center px-4' : 'justify-between'} border-b border-white/[0.08] relative shrink-0`}>
            <div className={`flex items-center gap-3 cursor-pointer ${isCollapsed ? 'justify-center' : ''}`} onClick={() => onNavigate('landing')}>
              <RemlinLogo className="h-8 w-auto shrink-0" />
              {!isCollapsed && (
                <span className="font-sans text-[22px] font-bold text-white leading-none tracking-tight">Remlin</span>
              )}
            </div>
            
            {/* Collapse toggle when expanded */}
            {!isCollapsed && (
              <button 
                onClick={onToggleCollapse}
                className="hidden md:flex p-1.5 text-white/50 hover:text-white rounded-lg hover:bg-white/10 cursor-pointer transition-colors"
                title="Collapse sidebar"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}

            {/* Expand toggle when collapsed */}
            {isCollapsed && (
              <button 
                onClick={onToggleCollapse}
                className="hidden md:flex p-1 text-white/80 bg-[#163691] border border-blue-400/40 rounded-full hover:bg-white/20 cursor-pointer absolute -right-3 top-7 z-50 shadow-lg"
                title="Expand sidebar"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Mobile close */}
            <button 
              onClick={onClose}
              className="md:hidden p-1.5 text-white/50 hover:text-white rounded-lg hover:bg-white/10 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {/* Nav Items matching Picture 1 */}
          <nav className={`px-4 py-6 flex-grow space-y-2.5 ${isCollapsed ? 'flex flex-col items-center gap-2 px-0' : ''}`}>
            {menuItems.map((item) => {
              const IconComponent = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id as Tab)}
                  title={isCollapsed ? item.label : undefined}
                  className={`flex items-center transition-all duration-200 cursor-pointer ${
                    isCollapsed 
                      ? `w-12 h-12 rounded-xl justify-center ${
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
                  {!isCollapsed && <span className="font-sans text-[14px] leading-none">{item.label}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Footer / AI Training & Settings */}
        <div className={`p-4 border-t border-white/[0.08] ${isCollapsed ? 'flex flex-col items-center gap-4 px-0' : 'space-y-4'}`}>
          {/* AI Training Active Card */}
          {isCollapsed ? (
            <div className="p-2 bg-white/[0.06] border border-white/10 rounded-full" title="AI training active (78%)">
              <span className="w-2.5 h-2.5 rounded-full bg-[#3ddc84] block animate-pulse-dot shadow-[0_0_10px_rgba(61,220,132,0.9)]" />
            </div>
          ) : (
            <div className="p-3.5 bg-white/[0.06] border border-white/10 rounded-2xl">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-[#3ddc84] block animate-pulse-dot shadow-[0_0_8px_rgba(61,220,132,0.9)]" />
                <span className="font-sans text-[11.5px] font-bold text-white">AI training active</span>
              </div>
              <div className="w-full bg-white/10 h-[5px] rounded-full overflow-hidden">
                <div className="bg-gradient-to-r from-white to-[#a9c6ff] h-full w-[78%] shadow-[0_0_10px_rgba(169,198,255,0.7)]" />
              </div>
            </div>
          )}

          {/* Settings & Logout */}
          <div className={`space-y-1.5 ${isCollapsed ? 'w-full flex flex-col items-center gap-1.5' : ''}`}>
            <button
              onClick={() => onNavigate('settings')}
              title={isCollapsed ? 'Settings' : undefined}
              className={`flex items-center transition-all duration-180 cursor-pointer ${
                isCollapsed 
                  ? `w-12 h-12 rounded-xl justify-center ${activeTab === 'settings' ? 'bg-[#2757d8] text-white' : 'text-white/65 hover:text-white hover:bg-white/[0.08]'}`
                  : `w-full text-left px-4 py-2.5 rounded-xl gap-3.5 ${activeTab === 'settings' ? 'bg-[#2757d8] text-white font-medium' : 'text-white/65 hover:text-white hover:bg-white/[0.08]'}`
              }`}
            >
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                <Settings className="h-4.5 w-4.5" />
              </div>
              {!isCollapsed && <span className="font-sans text-[13.5px]">Settings</span>}
            </button>

            <button 
              onClick={onLogout}
              title={isCollapsed ? 'Log out' : undefined}
              className={`flex items-center transition-all duration-180 cursor-pointer ${
                isCollapsed 
                  ? 'w-12 h-12 rounded-xl justify-center text-white/50 hover:text-[#ffb4b4] hover:bg-[rgba(255,90,90,0.14)]'
                  : 'w-full text-left px-4 py-2.5 rounded-xl gap-3.5 text-white/50 hover:text-[#ffb4b4] hover:bg-[rgba(255,90,90,0.14)]'
              }`}
            >
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                <LogOut className="h-4.5 w-4.5" />
              </div>
              {!isCollapsed && <span className="font-sans text-[13.5px]">Log out</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
