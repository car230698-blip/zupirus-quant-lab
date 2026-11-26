import { useState, useEffect, type ReactNode } from 'react';
import type { PortalType } from '../App.tsx';
import { useLiveTopbarTelemetry, useRealtimePortalStream } from '../hooks/useQuantData.ts';
import { api, apiPost } from '../api/client.ts';
import { NotificationBellMenu } from './NotificationBellMenu.tsx';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import {
  LayoutDashboard,
  Server,
  ReceiptText,
  Radio,
  BrainCircuit,
  Users,
  Bell,
  User,
  Zap,
  X as IconClose,
  Menu as IconMenu,
} from 'lucide-react';
import {
  IconBolt,
  IconChevronLeft,
  IconChevronRight,
} from './Icons';

function renderNavIcon(key: string): ReactNode {
  switch (key) {
    case 'overview':
      return <LayoutDashboard className="w-4 h-4" strokeWidth={1.75} />;
    case 'accounts':
      return <Server className="w-4 h-4" strokeWidth={1.75} />;
    case 'orders':
      return <ReceiptText className="w-4 h-4" strokeWidth={1.75} />;
    case 'radar':
      return <Radio className="w-4 h-4" strokeWidth={1.75} />;
    case 'ai':
      return <BrainCircuit className="w-4 h-4" strokeWidth={1.75} />;
    case 'business':
      return <Users className="w-4 h-4" strokeWidth={1.75} />;
    default:
      return <Zap className="w-4 h-4" strokeWidth={1.75} />;
  }
}

export type Portal = 'user' | 'admin';

export const getNavigation = (lang: 'vi' | 'en' = 'vi') => ({
  user: [
    ['overview', lang === 'en' ? 'Research Catalog' : 'Danh mục báo cáo', '01'],
    ['accounts', lang === 'en' ? 'My PDF Library' : 'Thư viện của tôi', '02'],
    ['orders', lang === 'en' ? 'Orders & Audit Archive' : 'Đơn hàng & Lịch sử', '03'],
  ],
  admin: [
    ['radar', lang === 'en' ? 'System Monitor & Alerts' : 'Giám Sát & Cảnh Báo', '01'],
    ['ai', lang === 'en' ? 'Internal Quant Research' : 'Nghiên Cứu Định Lượng Nội Bộ', '02'],
    ['business', lang === 'en' ? 'PDF Reports & Billing' : 'Xuất Bản PDF & Kinh Doanh', '03'],
  ],
});

export const getPageTitles = (lang: 'vi' | 'en' = 'vi'): Record<Portal, Record<string, string>> => ({
  user: {
    overview: lang === 'en' ? 'ZUPIRUS Quant Lab · XAU/USD Research Catalog & Market Telemetry' : 'ZUPIRUS Quant Lab · Danh Mục Báo Cáo Nghiên Cứu XAU/USD',
    accounts: lang === 'en' ? 'My Quantitative PDF Report Library' : 'Thư Viện Báo Cáo PDF Của Tôi',
    orders: lang === 'en' ? 'Historical Reconciliation Archive' : 'Sổ Cái Đối Soát & Lưu Trữ Lịch Sử',
  },
  admin: {
    radar: lang === 'en' ? 'System Health Monitor & Error Alerts' : 'Giám Sát Hoạt Động Hệ Thống & Cảnh Báo Lỗi',
    ai: lang === 'en' ? 'Internal Walk-Forward Research & Hypothesis Queue' : 'Phòng Nghiên Cứu Định Lượng Nội Bộ & Hàng Chờ Kiểm Định WFO',
    business: lang === 'en' ? 'PDF Report Publisher, Billing & Customers' : 'Xuất Bản Báo Cáo PDF, Đối Soát Thanh Toán & Khách Hàng',
  },
});

export const getPageSubtitles = (lang: 'vi' | 'en' = 'vi'): Record<Portal, Record<string, string>> => ({
  user: {
    overview: lang === 'en'
      ? 'Browse published XAU/USD quantitative research reports, preview sample PDFs, and inspect real-time TimescaleDB market telemetry.'
      : 'Xem danh mục báo cáo nghiên cứu định lượng XAU/USD, đọc bản mẫu PDF miễn phí và theo dõi dữ liệu thị trường TimescaleDB 24/5.',
    accounts: lang === 'en'
      ? 'Access and download your purchased XAU/USD quantitative PDF reports directly on the web — no MT5, VPS, or broker account needed.'
      : 'Quản lý và tải xuống các báo cáo nghiên cứu định lượng XAU/USD bạn đã mua trực tiếp trên website — không cần MT5, VPS hay kết nối sàn.',
    orders: lang === 'en'
      ? 'Read-only historical execution and reconciliation archive preserved for accounting transparency.'
      : 'Lưu trữ lịch sử đối soát chỉ đọc (Read-only Archive) phục vụ tra cứu và minh bạch dữ liệu.',
    assistant: lang === 'en'
      ? 'Query XAU/USD quantitative research methodology and session microstructure insights.'
      : 'Truy vấn phương pháp nghiên cứu định lượng XAU/USD và cấu trúc thanh khoản theo phiên.',
  },
  admin: {
    radar: lang === 'en'
      ? '4-subsystem cluster health, research pipeline timeline, and error resolution box.'
      : 'Nhịp tim hệ thống 4 phân hệ, dòng thời gian nghiên cứu và hộp xử lý cảnh báo lỗi.',
    ai: lang === 'en'
      ? 'Internal hypothesis formation, out-of-sample Walk-Forward testing, Hazard Guards, and Edge Filters.'
      : 'Hình thành giả thuyết nội bộ, kiểm định ngoài mẫu Walk-Forward, Hazard Guard và Edge Filter chờ duyệt.',
    business: lang === 'en'
      ? 'Create, edit, approve, and publish PDF research reports; manage SePay/USDT orders and customer entitlements.'
      : 'Soạn thảo, đính kèm kết quả WFO, duyệt và xuất bản báo cáo PDF; quản lý đơn hàng SePay/USDT và quyền tải của khách hàng.',
  },
});

export function Brand({ onClick, collapsed }: { onClick?: () => void; collapsed?: boolean }) {
  return (
    <div
      className={`quant-brand ${onClick ? 'cursor-pointer group' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      title="ZUPIRUS Quantum OS v4.0 — Về Trang Chủ"
    >
      <div className="relative w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-cyan-400 p-[1.5px] shadow-[0_0_24px_rgba(245,158,11,0.35)] transition-transform duration-150 group-hover:scale-105">
        <div className="w-full h-full bg-[#040711] rounded-[10.5px] flex items-center justify-center font-extrabold text-amber-300 text-lg font-mono">
          Z
        </div>
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-base tracking-tight text-white font-display leading-none truncate">
              ZUPIRUS
            </span>
            <span className="rounded bg-amber-500/20 border border-amber-400/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-300 leading-none">
              v4.0
            </span>
          </div>
          <span className="text-[10.5px] text-amber-300/85 font-mono block mt-1 truncate">
            Sovereign XAU Quant OS
          </span>
        </div>
      )}
    </div>
  );
}

export function PortalShell({
  portal,
  page,
  onNavigate,
  email,
  logout,
  children,
}: {
  portal: Portal;
  page: string;
  onNavigate: (page: string) => void;
  email: string;
  switchPortal?: () => void;
  onNavigatePortal?: (target: PortalType) => void;
  onOpenAuthPreview?: () => void;
  logout: () => void;
  children: ReactNode;
}) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const { lang } = useLanguage();
  const isMac = typeof navigator !== 'undefined' && /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent || navigator.platform || '');
  const kbdShortcut = isMac ? '⌘K' : 'Ctrl+K';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);
  const [quantTheme, setQuantTheme] = useState<'gold' | 'cyber'>('gold');
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState<number>(0);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState<boolean>(false);
  const { data: telemetryData } = useLiveTopbarTelemetry();
  useRealtimePortalStream(portal, Boolean(email));

  const navigation = getNavigation(lang);
  const pageTitles = getPageTitles(lang);
  const pageSubtitles = getPageSubtitles(lang);

  const fetchNotifications = async () => {
    try {
      const data = await api.get('/api/v1/notifications?limit=20');
      if (data?.notifications) {
        setNotifications(data.notifications);
        setUnreadNotifCount(data.unread_count || 0);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 20000);
    return () => clearInterval(interval);
  }, []);

  const markAllRead = async () => {
    try {
      await api.post('/api/v1/notifications/read-all');
      setUnreadNotifCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: Date.now() / 1000 })));
    } catch {
      // ignore
    }
  };

  const markSingleRead = async (id: string) => {
    try {
      await api.post(`/api/v1/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: Date.now() / 1000 } : n))
      );
      setUnreadNotifCount((c) => Math.max(0, c - 1));
    } catch {
      // ignore
    }
  };

  const liveSpot = {
    bid: Number(telemetryData?.xauusd?.bid || 0),
    ask: Number(telemetryData?.xauusd?.ask || telemetryData?.xauusd?.bid || 0),
    spread: Number(telemetryData?.xauusd?.spread_pips || 0),
    latency: Number(telemetryData?.metaapi_latency_ms || 24),
    loaded: Boolean(telemetryData?.xauusd?.bid && telemetryData.xauusd.bid > 0),
  };

  const currentNavLabel = navigation[portal].find(([key]) => key === page)?.[1] || 'Tổng quan';

  useEffect(() => {
    document.documentElement.setAttribute('data-quant-theme', quantTheme);
  }, [quantTheme]);

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

  const handleToggleSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 1023) {
      setMobileMenuOpen((v) => !v);
    } else {
      setSidebarCollapsed((v) => !v);
    }
  };

  const filteredNavItems = navigation[portal].filter(([, label, key]) => {
    const q = cmdQuery.trim().toLowerCase();
    if (!q) return true;
    return label.toLowerCase().includes(q) || key.toLowerCase().includes(q);
  });

  return (
    <div data-portal={portal} className={`quant-app quant-cyber-grid quant-${portal}`}>
      {/* Mobile Backdrop Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Command Rail */}
      <aside
        className={`quant-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''} ${
          mobileMenuOpen ? '' : 'is-mobile-closed'
        }`}
      >
        <div className={`flex items-center ${sidebarCollapsed ? 'flex-col gap-3' : 'justify-between gap-2'}`}>
          <Brand
            collapsed={sidebarCollapsed}
            onClick={() => onNavigate(portal === 'admin' ? 'radar' : 'overview')}
          />
          <button
            type="button"
            onClick={handleToggleSidebar}
            title={
              mobileMenuOpen
                ? 'Đóng menu'
                : sidebarCollapsed
                ? 'Mở rộng thanh tác vụ (Ctrl+B)'
                : 'Thu gọn thanh tác vụ (Ctrl+B)'
            }
            aria-label={
              mobileMenuOpen ? 'Đóng menu' : sidebarCollapsed ? 'Mở rộng thanh tác vụ' : 'Thu gọn thanh tác vụ'
            }
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:border-amber-400/60 hover:bg-amber-500/20 hover:text-white transition cursor-pointer font-mono text-xs"
          >
            {mobileMenuOpen ? (
              <IconClose className="w-4 h-4" />
            ) : sidebarCollapsed ? (
              <IconChevronRight className="w-4 h-4" />
            ) : (
              <IconChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Live XAU/USD Micro Radar inside Sidebar */}
        {!sidebarCollapsed && (
          <div className="mt-4 rounded-xl border border-amber-500/25 bg-[#050914]/90 p-3 space-y-2">
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="inline-flex items-center gap-1.5 text-amber-300 font-bold">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                XAU/USD SPOT
              </span>
              <span className="text-emerald-400 font-bold tabular-nums">{lang === 'en' ? 'Reference' : 'Tham khảo'}</span>
            </div>
            <div className="flex items-baseline justify-between font-mono tabular-nums">
              <span className="text-lg font-extrabold text-white">{liveSpot.loaded && liveSpot.bid > 0 ? `$${liveSpot.bid.toFixed(2)}` : "Đang nạp..."}</span>
              <span className="text-[11px] text-amber-300">{liveSpot.loaded && liveSpot.spread > 0 ? `Spread ${liveSpot.spread.toFixed(1)}p` : "Real-time"}</span>
            </div>
            <div className="grid grid-cols-3 gap-1 pt-1 border-t border-white/[0.06] font-mono text-[9.5px] text-slate-400">
              <span className="col-span-3">{lang === 'en' ? 'Price for reference only · no orders' : 'Giá chỉ để tham khảo · không đặt lệnh'}</span>
            </div>
          </div>
        )}

        <div className="quant-workspace">
          {sidebarCollapsed
            ? portal === 'admin'
              ? 'ADM'
              : 'USR'
            : portal === 'admin'
            ? <span className="inline-flex items-center gap-1.5"><IconBolt className="w-3.5 h-3.5" />ROOT ADMIN COMMAND</span>
            : (lang === 'en' ? 'PDF LIBRARY' : 'THƯ VIỆN PDF')}
        </div>

        <nav className="quant-nav" aria-label="Menu chính">
          {navigation[portal].map(([key, label]) => (
            <button
              className="quant-nav-button"
              key={key}
              title={sidebarCollapsed ? label : undefined}
              onClick={() => {
                onNavigate(key);
                setMobileMenuOpen(false);
              }}
              aria-current={page === key ? 'page' : undefined}
            >
              <span aria-hidden="true">
                {renderNavIcon(key)}
              </span>
              {!sidebarCollapsed && <strong className="font-medium truncate">{label}</strong>}
            </button>
          ))}
        </nav>

        {/* Isolated Sidebar Footer: Cluster Status & Command Palette */}
        <div className="quant-sidebar-end">
          {!sidebarCollapsed ? (
            <>
              <div className="flex items-center justify-between text-[11px] text-slate-300 pb-2 border-b border-white/[0.08]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  {lang === 'en' ? 'Library' : 'Thư viện'}
                </span>
                <span className="text-amber-300 font-mono tabular-nums">Online</span>
              </div>
              <div className="flex flex-col gap-1.5 pt-0.5 w-full">
                <button
                  type="button"
                  onClick={() => setCmdOpen(true)}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-slate-200 bg-white/[0.04] hover:bg-amber-500/15 hover:text-amber-200 border border-white/10 transition-colors flex items-center justify-between cursor-pointer"
                >
                  <span>{lang === 'en' ? 'Quick Command' : 'Bảng Lệnh Nhanh'}</span>
                  <kbd className="text-[10px] text-amber-300 font-mono">{kbdShortcut}</kbd>
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 w-full pb-1">
              <button
                type="button"
                onClick={() => setCmdOpen(true)}
                title={lang === 'en' ? `Quick Command (${kbdShortcut})` : `Bảng Lệnh Nhanh (${kbdShortcut})`}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-amber-300 hover:border-amber-400/50 hover:bg-amber-500/15 transition cursor-pointer"
              >
                {isMac ? '⌘' : 'K'}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Execution Stage */}
      <div className={`quant-stage ${sidebarCollapsed ? 'is-collapsed' : 'is-expanded'}`}>
        {/* Top Deck 1: Institutional Global Telemetry Ribbon */}
        <div className="hidden md:flex items-center justify-between border-b border-white/[0.07] bg-[#020409]/95 px-6 py-2 font-mono text-[11px] text-slate-400">
          <div className="flex items-center gap-4 tabular-nums">
            <span className="inline-flex items-center gap-1.5 text-amber-300 font-bold">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              XAU/USD: {liveSpot.loaded && liveSpot.bid > 0 ? `$${liveSpot.bid.toFixed(2)} / $${liveSpot.ask.toFixed(2)}` : (lang === 'en' ? "Syncing..." : "Đang đồng bộ...")}
            </span>
            <span className="text-slate-600">·</span>
            <span>
              {lang === 'en' ? 'SESSION: ' : 'PHIÊN: '}
              <strong className="text-emerald-400">
                {(() => {
                  const now = new Date();
                  const day = now.getUTCDay();
                  const hour = now.getUTCHours();
                  if (day === 0 || day === 6 || (day === 5 && hour >= 22)) return lang === 'en' ? 'WEEKEND (CLOSED)' : 'CUỐI TUẦN (ĐÓNG CỬA)';
                  if (hour >= 13 && hour < 17) return 'LONDON–NY OVERLAP';
                  if (hour >= 7 && hour < 13) return lang === 'en' ? 'LONDON SESSION' : 'PHIÊN ÂU (LONDON)';
                  if (hour >= 17 && hour < 22) return lang === 'en' ? 'NEW YORK SESSION' : 'PHIÊN MỸ (NEW YORK)';
                  return lang === 'en' ? 'TOKYO SESSION' : 'PHIÊN Á (TOKYO)';
                })()}
              </strong>
            </span>
            <span className="text-slate-600">·</span>
            <span>
              <strong className="text-cyan-300">{lang === 'en' ? 'NO AUTOMATED ORDERS' : 'KHÔNG LỆNH TỰ ĐỘNG'}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-[#12B5A6]">
              <span className="pulse-wrap"><span className="pulse-core" /></span>
              ZUPIRUS QUANT LAB
            </span>
          </div>
        </div>

        {/* Mobile WebApp Header (Compact native-like header for mobile) */}
        <header className="flex lg:hidden items-center justify-between border-b border-white/[0.08] bg-[#070c18]/95 px-3.5 py-2.5 backdrop-blur-md sticky top-0 z-30 w-full max-w-full">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#12B5A6] font-mono text-sm font-extrabold text-[#042F2E]">
              Z
            </div>
            <div>
              <div className="font-display text-xs font-bold text-white tracking-tight leading-none">
                ZUPIRUS
              </div>
              <span className="font-mono text-[9px] text-amber-300">
                {portal === 'admin' ? 'ADMIN OS' : 'QUANT OS'}
              </span>
            </div>
          </div>

          {liveSpot.loaded && liveSpot.bid > 0 && (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-[#040814] px-2.5 py-0.5 font-mono text-[10.5px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-400">XAU:</span>
              <strong className="text-amber-300 tabular-nums">${liveSpot.bid.toFixed(2)}</strong>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setQuantTheme(quantTheme === 'gold' ? 'cyber' : 'gold')}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white transition cursor-pointer text-xs"
              title={lang === 'en' ? "Switch theme (Gold / Cyber)" : "Đổi chủ đề (Gold / Cyber)"}
            >
              {quantTheme === 'gold' ? '⚡' : '◈'}
            </button>
            <NotificationBellMenu
              notifications={notifications}
              unreadCount={unreadNotifCount}
              isOpen={notifDropdownOpen}
              onToggle={() => setNotifDropdownOpen(!notifDropdownOpen)}
              onClose={() => setNotifDropdownOpen(false)}
              onMarkAllRead={markAllRead}
              onMarkSingleRead={markSingleRead}
              isMobileHeader
            />
          </div>
        </header>

        {/* Top Deck 2: Clean 3-Zone Top Bar Contract (Desktop Only) */}
        <header className="quant-topbar hidden lg:flex">
          {/* Zone 1: Sidebar Toggle + Contextual Breadcrumb Trail */}
          <div className="quant-context">
            <button
              type="button"
              onClick={handleToggleSidebar}
              title={sidebarCollapsed ? (lang === 'en' ? 'Open sidebar (Ctrl+B)' : 'Mở thanh tác vụ bên trái (Ctrl+B)') : (lang === 'en' ? 'Collapse sidebar (Ctrl+B)' : 'Thu gọn thanh tác vụ bên trái (Ctrl+B)')}
              aria-label="Toggle navigation"
              className={`mr-2 flex h-9 w-9 items-center justify-center rounded-lg border transition cursor-pointer ${
                portal === 'admin'
                  ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/20'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:border-amber-400/60 hover:bg-amber-500/20'
              }`}
            >
              <IconMenu className="w-4 h-4" />
            </button>
            <span className={`hidden sm:inline font-semibold ${portal === 'admin' ? 'text-cyan-300/90' : 'text-amber-300/90'}`}>
              {portal === 'admin' ? (lang === 'en' ? 'ADMIN COMMAND' : 'TRẠM QUẢN TRỊ') : (lang === 'en' ? 'PDF LIBRARY' : 'THƯ VIỆN PDF')}
            </span>
            <span aria-hidden="true" className="text-slate-600 hidden sm:inline">/</span>
            <span className="text-white font-bold">{currentNavLabel}</span>
          </div>

          {/* Zone 2: Dedicated Workspace Telemetry Indicator (No Cross-Portal Switcher) */}
          <div className="hidden xl:flex items-center gap-2 px-3 py-1 rounded-xl bg-[#040711] border border-amber-500/20 font-mono text-[11px] text-slate-300 shrink-0">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{portal === 'admin' ? 'ADMIN · PUBLISHING' : 'PDF LIBRARY · USDT'}</span>
            
          </div>

          {/* Zone 3: Session Identity & Primary Action (Language auto-detected via IP) */}
          <div className="quant-session">
            {/* Notification Bell Dropdown */}
            <NotificationBellMenu
              notifications={notifications}
              unreadCount={unreadNotifCount}
              isOpen={notifDropdownOpen}
              onToggle={() => setNotifDropdownOpen(!notifDropdownOpen)}
              onClose={() => setNotifDropdownOpen(false)}
              onMarkAllRead={markAllRead}
              onMarkSingleRead={markSingleRead}
            />

            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="quant-quiet hidden sm:inline-flex items-center gap-1.5"
              title={lang === 'en' ? "Open Command Palette (Ctrl+K)" : "Mở bảng điều khiển nhanh (Ctrl+K)"}
            >
              <span>{lang === 'en' ? 'Quick Command' : 'Lệnh Nhanh'}</span>
              <span className="text-amber-300">⌘K</span>
            </button>
            <span className="quant-email hidden md:inline-block" title={email}>
              {email}
            </span>
            <button
              type="button"
              onClick={() => {
                setPwdMsg(null);
                setCurPwd('');
                setNewPwd('');
                setPwdModalOpen(true);
              }}
              className="quant-quiet hover:border-cyan-500/50 hover:text-cyan-300"
            >
              {lang === 'en' ? 'Password' : 'Đổi MK'}
            </button>
            <button
              className="quant-quiet hover:border-rose-500/50 hover:text-rose-300"
              onClick={logout}
            >
              {lang === 'en' ? 'Sign Out' : 'Đăng xuất'}
            </button>
          </div>
        </header>

        <main className="quant-content">
          {/* Quantum Command Header Deck */}
          <div className="quant-heading">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-amber-300">
                <span>{portal === 'admin' ? 'ZUPIRUS // ADMIN' : 'ZUPIRUS // QUANT LAB'}</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-cyan-300">PDF RESEARCH LIBRARY</span>
              </div>
              <h1>{pageTitles[portal][page]}</h1>
              <p className="text-sm text-slate-300/90 max-w-3xl leading-relaxed m-0">
                {pageSubtitles[portal][page]}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              {(() => {
                const isHalted = Boolean(telemetryData?.system_guard?.kill_switch_active);
                const isEngineHealthy = telemetryData?.system_guard?.execution_engine_healthy !== false;
                const shieldCount = telemetryData?.shields
                  ? telemetryData.shields.filter((s: any) => s.status === 'ACTIVE' || s.status === 'OK' || s.status === 'MONITORING').length
                  : (isHalted ? 0 : 4);

                return (
                  <span
                    className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 font-bold ${
                      isHalted
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                        : isEngineHealthy
                        ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                        : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        isHalted ? 'bg-rose-500 animate-ping' : isEngineHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                      }`}
                    />
                    {isHalted
                      ? (lang === 'en' ? 'SYSTEM HALTED · KILL SWITCH ENGAGED' : 'TẠM DỪNG TOÀN HỆ THỐNG · LỆNH NGẮT BẬT')
                      : portal === 'admin'
                      ? (isEngineHealthy ? 'CLUSTER HEALTHY · ENGINES ONLINE' : 'CLUSTER DEGRADED')
                      : (void shieldCount, lang === 'en' ? 'STATISTICS · NO PROFIT PROMISE' : 'THỐNG KÊ · KHÔNG CAM KẾT LỢI NHUẬN')}
                  </span>
                );
              })()}
            </div>
          </div>
          {children}
        </main>
      </div>

      {/* Mobile WebApp Floating Liquid-Glass Bottom Dock (Fixed at bottom on phones/tablets) */}
      <nav
        aria-label="Điều hướng WebApp di động"
        className="fixed bottom-3 inset-x-3 z-40 flex lg:hidden items-center justify-around rounded-2xl bg-[#0D1526]/90 backdrop-blur-2xl border border-white/15 px-2 py-2 shadow-[0_18px_40px_-10px_rgba(0,0,0,0.85)] pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        {navigation[portal].map(([key]) => {
          const active = page === key;
          const shortLabel =
            key === 'overview'
              ? (lang === 'en' ? 'Cockpit' : 'Tổng Quan')
              : key === 'accounts'
              ? (lang === 'en' ? 'Accounts' : 'Tài Khoản')
              : key === 'orders'
              ? (lang === 'en' ? 'Orders' : 'Lệnh')
              : key === 'radar'
              ? 'Radar'
              : key === 'ai'
              ? 'AI Lab'
              : (lang === 'en' ? 'Clients' : 'Khách Hàng');
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setNotifDropdownOpen(false);
                setMobileProfileOpen(false);
                onNavigate(key);
              }}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 min-w-0 min-h-[44px] flex-col items-center justify-center py-1 rounded-xl transition cursor-pointer ${
                active
                  ? portal === 'admin'
                    ? 'text-cyan-300 font-bold bg-cyan-500/10'
                    : 'text-[#12B5A6] font-bold bg-[#12B5A6]/10'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="relative">
                {renderNavIcon(key)}
                {active && (
                  <span
                    className={`absolute -bottom-1 left-1/2 h-1 w-3.5 -translate-x-1/2 rounded-full ${
                      portal === 'admin'
                        ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]'
                        : 'bg-[#12B5A6] shadow-[0_0_8px_rgba(18,181,166,0.8)]'
                    }`}
                  />
                )}
              </div>
              <span className="mt-1 font-mono text-[9.5px] tracking-tight truncate max-w-[64px]">
                {shortLabel}
              </span>
            </button>
          );
        })}

        {/* Notifications WebApp Tab */}
        <button
          type="button"
          onClick={() => {
            setMobileProfileOpen(false);
            setNotifDropdownOpen((v) => !v);
          }}
          className={`flex flex-1 min-w-0 min-h-[44px] flex-col items-center justify-center py-1 rounded-xl transition cursor-pointer ${
            notifDropdownOpen ? 'text-amber-300 font-bold bg-amber-500/10' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <Bell className="w-4 h-4" strokeWidth={1.75} />
            {unreadNotifCount > 0 && (
              <span className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-rose-500 px-0.5 text-[8.5px] font-bold text-white">
                {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
              </span>
            )}
          </div>
          <span className="mt-1 font-mono text-[9.5px] tracking-tight truncate max-w-[64px]">
            {lang === 'en' ? 'Alerts' : 'Thông Báo'}
          </span>
        </button>

        {/* Profile / Account Drawer Tab */}
        <button
          type="button"
          onClick={() => {
            setNotifDropdownOpen(false);
            setMobileProfileOpen(true);
          }}
          className={`flex flex-1 min-w-0 min-h-[44px] flex-col items-center justify-center py-1 rounded-xl transition cursor-pointer ${
            mobileProfileOpen ? 'text-[#F5B700] font-bold bg-[#F5B700]/10' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <User className="w-4 h-4" strokeWidth={1.75} />
          <span className="mt-1 font-mono text-[9.5px] tracking-tight truncate max-w-[64px]">
            {lang === 'en' ? 'Profile' : 'Cá Nhân'}
          </span>
        </button>
      </nav>

      {/* Mobile Profile & Settings Bottom Sheet */}
      {mobileProfileOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-sm lg:hidden">
          <div className="absolute inset-0" onClick={() => setMobileProfileOpen(false)} />
          <div className="relative z-10 rounded-t-3xl border-t border-white/10 bg-[#080d19] p-5 space-y-4 shadow-2xl font-mono text-xs pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto h-1 w-10 rounded-full bg-slate-700 mb-1" />

            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <div className="text-white font-bold text-sm truncate max-w-[240px]">{email}</div>
                <div className="text-[10px] text-amber-300 mt-0.5">
                  {portal === 'admin' ? 'ADMINISTRATOR' : (lang === 'en' ? 'TRADER' : 'NHÀ GIAO DỊCH')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileProfileOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <IconClose className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-white/5 bg-[#040814] p-3">
                <span className="text-slate-300">{lang === 'en' ? 'Theme:' : 'Giao diện (Theme):'}</span>
                <div className="flex items-center gap-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setQuantTheme('gold')}
                    className={`rounded px-2.5 py-1 font-bold transition cursor-pointer ${
                      quantTheme === 'gold' ? 'bg-amber-400 text-slate-950' : 'text-slate-400'
                    }`}
                  >
                    SOVEREIGN GOLD
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuantTheme('cyber')}
                    className={`rounded px-2.5 py-1 font-bold transition cursor-pointer ${
                      quantTheme === 'cyber' ? 'bg-cyan-400 text-slate-950' : 'text-slate-400'
                    }`}
                  >
                    CYBER MATRIX
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setMobileProfileOpen(false);
                  setPwdMsg(null);
                  setCurPwd('');
                  setNewPwd('');
                  setPwdModalOpen(true);
                }}
                className="w-full flex items-center justify-between rounded-xl border border-white/5 bg-[#040814] p-3 text-left text-slate-200 hover:bg-white/5 transition cursor-pointer"
              >
                <span>{lang === 'en' ? 'Change Password' : 'Đổi Mật Khẩu'}</span>
                <span className="text-slate-500">→</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileProfileOpen(false);
                  logout();
                }}
                className="w-full flex items-center justify-center rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-rose-300 font-bold hover:bg-rose-500/20 transition cursor-pointer"
              >
                {lang === 'en' ? 'Sign Out' : 'Đăng Xuất'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Command Palette Modal (⌘K) */}
      {cmdOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 pt-20 p-4 backdrop-blur-md"
          onClick={() => setCmdOpen(false)}
        >
          <div
            className="w-full max-w-xl p-5 space-y-4 rounded-2xl bg-[#0B1221]/95 backdrop-blur-2xl border border-amber-400/50 shadow-[0_0_60px_rgba(245,158,11,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 font-mono text-xs text-amber-300">
                <span className="inline-flex items-center gap-1.5"><IconBolt className="w-3.5 h-3.5" />ZUPIRUS QUANTUM OS v5.0 — COMMAND PALETTE</span>
              </div>
              <button
                type="button"
                onClick={() => setCmdOpen(false)}
                className="text-slate-400 hover:text-white font-mono text-xs cursor-pointer"
              >
                <span className="inline-flex items-center gap-1">ESC <IconClose className="w-3.5 h-3.5" /></span>
              </button>
            </div>

            <input
              type="text"
              value={cmdQuery}
              onChange={(e) => setCmdQuery(e.target.value)}
              placeholder={lang === 'en' ? "Quick search modules or navigation..." : "Tìm nhanh mô-đun điều hướng hoặc cổng giao diện..."}
              className="quant-input font-mono text-xs"
              autoFocus
            />

            <div className="space-y-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
                {lang === 'en' ? `NAVIGATION MODULES (${portal.toUpperCase()})` : `Điều Hướng Phân Hệ (${portal.toUpperCase()})`}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {filteredNavItems.map(([key, label, code]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      onNavigate(key);
                      setCmdOpen(false);
                    }}
                    className={`rounded-xl border px-3.5 py-2.5 text-left font-mono text-xs transition flex items-center gap-2.5 cursor-pointer ${
                      page === key
                        ? 'border-amber-400/50 bg-amber-500/20 text-amber-200 font-bold'
                        : 'border-white/[0.08] bg-[#040814] text-slate-300 hover:border-amber-500/35 hover:text-white'
                    }`}
                  >
                    <span className="text-amber-400 font-bold">{code}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {pwdModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
          onClick={() => setPwdModalOpen(false)}
        >
          <div
            className="w-full max-w-md p-5 space-y-4 rounded-2xl bg-[#0B1221]/95 backdrop-blur-2xl border border-white/[0.1] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <span className="font-mono text-xs font-bold uppercase tracking-widest text-cyan-300">
                {lang === 'en' ? 'Security Password Change' : 'Đổi Mật Khẩu Bảo Mật'}
              </span>
              <button
                type="button"
                onClick={() => setPwdModalOpen(false)}
                className="rounded-lg border border-white/10 px-2 py-0.5 text-[11px] font-mono text-slate-400 hover:text-white cursor-pointer"
              >
                ESC
              </button>
            </div>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setPwdBusy(true);
                setPwdMsg(null);
                try {
                  await apiPost('/api/auth/change-password', { current_password: curPwd, new_password: newPwd });
                  setPwdMsg(lang === 'en' ? '✓ Password changed successfully.' : '✓ Đã đổi mật khẩu thành công.');
                  setCurPwd('');
                  setNewPwd('');
                } catch (err: any) {
                  setPwdMsg(`${lang === 'en' ? 'Error: ' : 'Lỗi: '}${err.message || String(err)}`);
                } finally {
                  setPwdBusy(false);
                }
              }}
            >
              <input
                type="password"
                required
                value={curPwd}
                onChange={(e) => setCurPwd(e.target.value)}
                placeholder={lang === 'en' ? "Current password" : "Mật khẩu hiện tại"}
                className="quant-input text-xs"
              />
              <input
                type="password"
                required
                minLength={12}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder={lang === 'en' ? "New password (min 12 chars)" : "Mật khẩu mới (tối thiểu 12 ký tự)"}
                className="quant-input text-xs"
              />
              {pwdMsg && (
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-3 py-2 text-xs text-cyan-200">
                  {pwdMsg}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPwdModalOpen(false)}
                  className="quant-btn-secondary px-3 py-1.5 text-xs"
                >
                  {lang === 'en' ? 'Close' : 'Đóng'}
                </button>
                <button type="submit" disabled={pwdBusy} className="quant-btn-primary px-4 py-1.5 text-xs">
                  {pwdBusy ? (lang === 'en' ? 'Saving...' : 'Đang lưu...') : (lang === 'en' ? 'Update Password' : 'Cập nhật mật khẩu')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
export { PortalAuth } from './PortalAuth';
