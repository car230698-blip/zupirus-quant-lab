import React, { useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '../api/client';
import { BrandMark } from '../components/common/BrandMark';
import { NotificationBellMenu } from '../components/common/NotificationBellMenu';
import { ChangePasswordModal } from '../components/common/ChangePasswordModal';
import { useLanguage } from '../i18n/LanguageContext';
import type { AdminPageKey } from '../hooks/useRoute';
import {
  Activity,
  FileCheck2,
  FlaskConical,
  CreditCard,
  ArrowLeft,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Search,
} from 'lucide-react';

export interface AdminLayoutProps {
  activePage: AdminPageKey;
  email: string;
  onNavigate: (to: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  activePage,
  email,
  onNavigate,
  onLogout,
  children,
}) => {
  const { lang, setLang } = useLanguage();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  const isMac =
    typeof navigator !== 'undefined' &&
    /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent || navigator.platform || '');
  const kbdShortcut = isMac ? '⌘K' : 'Ctrl+K';

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await api.get('/api/v1/notifications?limit=20');
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
    const timer = setInterval(fetchNotifications, 25000);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
      } else if (e.key === 'Escape') {
        setCmdOpen(false);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  const navItems: Array<{ key: AdminPageKey; to: string; label: string; icon: ReactNode }> = [
    {
      key: 'overview',
      to: '/admin',
      label: lang === 'en' ? 'Overview & Health' : 'Tổng quan & Hệ thống',
      icon: <Activity className="h-4 w-4" />,
    },
    {
      key: 'reports',
      to: '/admin/reports',
      label: lang === 'en' ? 'PDF Publisher' : 'Xuất bản Báo cáo PDF',
      icon: <FileCheck2 className="h-4 w-4" />,
    },
    {
      key: 'research',
      to: '/admin/research',
      label: lang === 'en' ? 'WFO Research & AI' : 'Nghiên cứu WFO & AI',
      icon: <FlaskConical className="h-4 w-4" />,
    },
    {
      key: 'orders',
      to: '/admin/orders',
      label: lang === 'en' ? 'Orders & Users' : 'Đơn hàng & Người dùng',
      icon: <CreditCard className="h-4 w-4" />,
    },
  ];

  const activeNav = navItems.find((n) => n.key === activePage) || navItems[0];
  const filteredItems = navItems.filter((item) => {
    const q = cmdQuery.trim().toLowerCase();
    if (!q) return true;
    return item.label.toLowerCase().includes(q) || item.to.toLowerCase().includes(q);
  });

  return (
    <div data-portal="admin" className="quant-app quant-cyber-grid">
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar (Admin Console Only) */}
      <aside
        className={`quant-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''} ${
          mobileMenuOpen ? '' : 'is-mobile-closed'
        }`}
      >
        <div className={`flex items-center ${sidebarCollapsed ? 'flex-col gap-3' : 'justify-between gap-2'}`}>
          <BrandMark
            compact={sidebarCollapsed}
            accent="cyan"
            subtitle={lang === 'en' ? 'Admin Console' : 'Trạm Quản Trị'}
            onClick={() => onNavigate('/admin')}
          />
          <button
            type="button"
            onClick={() =>
              typeof window !== 'undefined' && window.innerWidth <= 1023
                ? setMobileMenuOpen((v) => !v)
                : setSidebarCollapsed((v) => !v)
            }
            aria-label="Toggle sidebar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:text-white transition cursor-pointer"
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
          {sidebarCollapsed ? 'ADM' : lang === 'en' ? 'ADMIN CONSOLE' : 'ĐIỀU HÀNH HỆ THỐNG'}
        </div>

        <nav className="quant-nav" aria-label="Admin navigation">
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
            onClick={() => setCmdOpen(true)}
            className="w-full flex items-center justify-between gap-2 rounded-lg border border-slate-700/80 bg-slate-900/70 px-2.5 py-2 text-xs text-slate-200 hover:border-cyan-500/40 transition cursor-pointer"
            title={lang === 'en' ? `Quick Command (${kbdShortcut})` : `Bảng lệnh nhanh (${kbdShortcut})`}
          >
            <span className="truncate">{sidebarCollapsed ? '⌘K' : lang === 'en' ? 'Quick Command' : 'Bảng lệnh nhanh'}</span>
            {!sidebarCollapsed && <kbd className="font-mono text-[10px] text-cyan-300">{kbdShortcut}</kbd>}
          </button>
          <button
            type="button"
            onClick={() => {
              onNavigate('/');
              setMobileMenuOpen(false);
            }}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-xs text-slate-400 hover:text-white transition cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
            {!sidebarCollapsed && <span>{lang === 'en' ? 'Public Landing' : 'Trang chủ'}</span>}
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
            <BrandMark accent="cyan" subtitle={activeNav.label} onClick={() => onNavigate('/admin')} />
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
          <div className="quant-context">
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              aria-label="Toggle navigation"
              className="mr-1.5 flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:text-white transition cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <span className="font-semibold text-cyan-300">
              {lang === 'en' ? 'Admin Console' : 'Trạm Quản Trị'}
            </span>
            <span aria-hidden="true" className="text-slate-600">/</span>
            <span className="text-white font-semibold">{activeNav.label}</span>
          </div>

          <div className="flex-1" />

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
              onClick={() => setCmdOpen(true)}
              className="quant-quiet"
              title={lang === 'en' ? `Quick Command (${kbdShortcut})` : `Lệnh nhanh (${kbdShortcut})`}
            >
              <span className="font-mono text-cyan-300">{kbdShortcut}</span>
            </button>
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
            <button type="button" onClick={() => setPwdModalOpen(true)} className="quant-quiet">
              {lang === 'en' ? 'Password' : 'Đổi MK'}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="quant-quiet hover:border-rose-500/40 hover:text-rose-300"
            >
              {lang === 'en' ? 'Sign Out' : 'Đăng xuất'}
            </button>
          </div>
        </header>

        <main className="quant-content">{children}</main>
      </div>

      {/* Mobile Bottom Dock */}
      <nav
        aria-label="Admin mobile navigation"
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
                isActive ? 'text-cyan-300' : 'text-slate-400'
              }`}
            >
              {item.icon}
              <span className="truncate max-w-[80px]">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Command Palette Modal */}
      {cmdOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 backdrop-blur-sm pt-20 p-4"
          onClick={() => setCmdOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0B1220] p-4 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <Search className="h-4 w-4 text-cyan-400" />
              <input
                type="text"
                autoFocus
                value={cmdQuery}
                onChange={(e) => setCmdQuery(e.target.value)}
                placeholder={lang === 'en' ? 'Jump to admin module...' : 'Đi tới phân hệ quản trị...'}
                className="w-full bg-transparent text-sm text-white placeholder-slate-500 outline-none"
              />
              <button
                type="button"
                onClick={() => setCmdOpen(false)}
                className="rounded border border-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 cursor-pointer"
              >
                ESC
              </button>
            </div>
            <div className="space-y-1">
              {filteredItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    onNavigate(item.to);
                    setCmdOpen(false);
                    setCmdQuery('');
                  }}
                  className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-medium text-slate-200 hover:bg-cyan-500/12 hover:text-cyan-200 transition cursor-pointer"
                >
                  <span className="flex items-center gap-2.5">
                    <span className="text-cyan-400">{item.icon}</span>
                    <span>{item.label}</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">{item.to}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <ChangePasswordModal open={pwdModalOpen} onClose={() => setPwdModalOpen(false)} />
    </div>
  );
};
