import React, { useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '../api/client';
import { BrandMark } from '../components/common/BrandMark';
import { NotificationBellMenu } from '../components/common/NotificationBellMenu';
import { ChangePasswordModal } from '../components/common/ChangePasswordModal';
import { useLanguage } from '../i18n/LanguageContext';
import type { UserPageKey } from '../hooks/useRoute';
import {
  BookOpen,
  Layers,
  ReceiptText,
  ArrowLeft,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export interface UserLayoutProps {
  activePage: UserPageKey;
  email: string;
  onNavigate: (to: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

export const UserLayout: React.FC<UserLayoutProps> = ({
  activePage,
  email,
  onNavigate,
  onLogout,
  children,
}) => {
  const { lang, setLang, t } = useLanguage();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await api.get('/api/v1/notifications?limit=15');
      if (data?.notifications) {
        setNotifications(data.notifications);
        setUnreadCount(data.unread_count || 0);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 30000);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  const markAllRead = async () => {
    try {
      await api.post('/api/v1/notifications/read-all');
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: Date.now() / 1000 })));
    } catch {
      // ignore
    }
  };

  const markSingleRead = async (id: string) => {
    try {
      await api.post(`/api/v1/notifications/${encodeURIComponent(id)}/read`);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: Date.now() / 1000 } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // ignore
    }
  };

  const navItems: Array<{ key: UserPageKey; to: string; label: string; icon: ReactNode }> = [
    { key: 'catalog', to: '/portal', label: t.portal.catalog, icon: <BookOpen className="h-4 w-4" /> },
    { key: 'library', to: '/portal/library', label: t.portal.library, icon: <Layers className="h-4 w-4" /> },
    { key: 'billing', to: '/portal/billing', label: t.portal.billing, icon: <ReceiptText className="h-4 w-4" /> },
  ];

  const activeNav = navItems.find((n) => n.key === activePage) || navItems[0];

  return (
    <div data-portal="user" className="quant-app quant-cyber-grid">
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar (User Portal Only) */}
      <aside
        className={`quant-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''} ${
          mobileMenuOpen ? '' : 'is-mobile-closed'
        }`}
      >
        <div className={`flex items-center ${sidebarCollapsed ? 'flex-col gap-3' : 'justify-between gap-2'}`}>
          <BrandMark
            compact={sidebarCollapsed}
            accent="teal"
            subtitle={lang === 'en' ? 'Customer Portal' : 'Cổng Khách Hàng'}
            onClick={() => onNavigate('/portal')}
          />
          <button
            type="button"
            onClick={() =>
              typeof window !== 'undefined' && window.innerWidth <= 1023
                ? setMobileMenuOpen((v) => !v)
                : setSidebarCollapsed((v) => !v)
            }
            aria-label="Toggle sidebar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/70 text-slate-300 hover:text-white transition cursor-pointer"
          >
            {mobileMenuOpen ? (
              <X className="h-4 w-4" />
            ) : sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        <div className="quant-workspace">
          {sidebarCollapsed ? 'USR' : lang === 'en' ? 'CUSTOMER LIBRARY' : 'THƯ VIỆN PDF'}
        </div>

        <nav className="quant-nav" aria-label="Customer navigation">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className="quant-nav-button"
              title={sidebarCollapsed ? item.label : undefined}
              aria-current={activePage === item.key ? 'page' : undefined}
              onClick={() => {
                onNavigate(item.to);
                setMobileMenuOpen(false);
              }}
            >
              <span aria-hidden="true">{item.icon}</span>
              {!sidebarCollapsed && <strong className="font-medium truncate">{item.label}</strong>}
            </button>
          ))}
        </nav>

        <div className="quant-sidebar-end">
          <button
            type="button"
            onClick={() => {
              onNavigate('/');
              setMobileMenuOpen(false);
            }}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/60 px-2.5 py-2 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-600 transition cursor-pointer"
            title={lang === 'en' ? 'Back to Landing Page' : 'Về Trang giới thiệu'}
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
            {!sidebarCollapsed && <span>{lang === 'en' ? 'Landing Page' : 'Trang giới thiệu'}</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Stage */}
      <div className={`quant-stage ${sidebarCollapsed ? 'is-collapsed' : 'is-expanded'}`}>
        {/* Mobile Header */}
        <header className="flex lg:hidden items-center justify-between border-b border-slate-800/80 bg-[#080D18]/95 px-4 py-2.5 sticky top-0 z-30">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-200 cursor-pointer"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <BrandMark compact={false} subtitle={activeNav.label} onClick={() => onNavigate('/portal')} />
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}
              className="h-8 rounded-lg border border-slate-800 bg-slate-900 px-2 font-mono text-[11px] font-semibold text-slate-300 cursor-pointer"
            >
              {lang === 'vi' ? 'VI' : 'EN'}
            </button>
            <NotificationBellMenu
              notifications={notifications}
              unreadCount={unreadCount}
              isOpen={notifOpen}
              onToggle={() => setNotifOpen((v) => !v)}
              onClose={() => setNotifOpen(false)}
              onMarkAllRead={markAllRead}
              onMarkSingleRead={markSingleRead}
              isMobileHeader
            />
          </div>
        </header>

        {/* Clean 3-Zone Desktop Top Bar */}
        <header className="quant-topbar hidden lg:flex">
          {/* Zone 1: Sidebar Toggle & Breadcrumb */}
          <div className="quant-context">
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              aria-label="Toggle navigation"
              className="mr-1.5 flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/70 text-slate-300 hover:text-white transition cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <span className="font-semibold text-[#12B5A6]">
              {lang === 'en' ? 'Customer Portal' : 'Cổng Khách Hàng'}
            </span>
            <span aria-hidden="true" className="text-slate-600">/</span>
            <span className="text-white font-semibold">{activeNav.label}</span>
          </div>

          {/* Zone 2: Clean Spacer */}
          <div className="flex-1" />

          {/* Zone 3: Notifications, Language, User Identity, Password, Logout */}
          <div className="quant-session">
            <NotificationBellMenu
              notifications={notifications}
              unreadCount={unreadCount}
              isOpen={notifOpen}
              onToggle={() => setNotifOpen((v) => !v)}
              onClose={() => setNotifOpen(false)}
              onMarkAllRead={markAllRead}
              onMarkSingleRead={markSingleRead}
            />
            <button
              type="button"
              onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}
              className="quant-quiet font-mono"
            >
              {lang === 'vi' ? 'VI' : 'EN'}
            </button>
            <span className="quant-email hidden xl:inline-block" title={email}>
              {email}
            </span>
            <button
              type="button"
              onClick={() => setPwdModalOpen(true)}
              className="quant-quiet"
            >
              {t.portal.changePassword}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="quant-quiet hover:border-rose-500/40 hover:text-rose-300"
            >
              {t.portal.logout}
            </button>
          </div>
        </header>

        {/* Main Workspace Content */}
        <main className="quant-content">{children}</main>
      </div>

      {/* Mobile Bottom Dock */}
      <nav
        aria-label="Mobile navigation"
        className="fixed bottom-0 inset-x-0 z-30 flex lg:hidden items-center justify-around border-t border-slate-800 bg-[#080D18]/95 backdrop-blur-md px-2 py-2"
      >
        {navItems.map((item) => {
          const isActive = activePage === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.to)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition cursor-pointer ${
                isActive ? 'text-[#12B5A6]' : 'text-slate-400'
              }`}
            >
              {item.icon}
              <span className="truncate max-w-[100px]">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <ChangePasswordModal open={pwdModalOpen} onClose={() => setPwdModalOpen(false)} />
    </div>
  );
};
