import { useState, useEffect, type FormEvent, type ReactNode } from 'react';
import type { PortalType } from '../App.tsx';
import authTerminalImg from '../assets/images/auth_terminal_sculpture_1794792847915.jpg';
import { useLiveTopbarTelemetry } from '../hooks/useQuantData.ts';

export type Portal = 'user' | 'admin';

const navigation = {
  user: [
    ['overview', 'Tổng quan danh mục', '01'],
    ['accounts', 'Tài khoản Cloud MT5', '02'],
    ['orders', 'Nhật ký khớp lệnh', '03'],
  ],
  admin: [
    ['radar', 'Giám Sát AI & Cảnh Báo', '01'],
    ['ai', 'Trí Tuệ AI & Nguồn Tín Hiệu', '02'],
    ['business', 'Kinh Doanh & Khách Hàng', '03'],
  ],
};

const pageTitles: Record<Portal, Record<string, string>> = {
  user: {
    overview: 'Tổng Quan Danh Mục & Buồng Lái Thực Thi XAU/USD',
    accounts: 'Quản Trị Trạm Cloud MT5 & Cấu Hình Giáp Rủi Ro',
    orders: 'Sổ Cái Khớp Lệnh Định Lượng & Đối Soát Đám Mây',
  },
  admin: {
    radar: 'Giám Sát Hoạt Động AI & Cảnh Báo Lỗi',
    ai: 'Trí Tuệ AI & Nguồn Tín Hiệu Tự Tiến Hóa',
    business: 'Cài Đặt Kinh Doanh, SePay & Khách Hàng',
  },
};

const pageSubtitles: Record<Portal, Record<string, string>> = {
  user: {
    overview: 'Giám sát vốn thả nổi thời gian thực, luồng nến TimescaleDB 24/5, sổ lệnh thanh khoản và trạng thái 4 lớp giáp bảo vệ vốn.',
    accounts: 'Đấu nối trực tiếp tới máy chủ MT5 qua hạ tầng đám mây London G2 mà không cần treo VPS hay cài đặt phần mềm EA.',
    orders: 'Truy vết minh bạch từng tín hiệu, giá khớp thực tế, mã Ticket/Deal, Profit Factor và nhật ký kiểm toán rủi ro.',
    assistant: 'Truy vấn trực tiếp dữ liệu danh mục và giải thích lý do vào lệnh XAU/USD M15 theo thời gian thực.',
  },
  admin: {
    radar: 'Nhịp tim hệ thống 4 phân hệ, dòng thời gian quyết định của AI theo thời gian thực và hộp xử lý cảnh báo lỗi.',
    ai: 'Lộ trình tự tiến hóa 3 giai đoạn, nguồn hạt giống, kỹ năng AI tự học và cấu hình Gemini API Pool.',
    business: 'Cấu hình nhận tiền SePay, tỷ giá USD/VND, đối soát ngoại lệ đơn hàng và quản trị tài khoản khách hàng.',
  },
};

function Brand({ onClick, collapsed }: { onClick?: () => void; collapsed?: boolean }) {
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [quantTheme, setQuantTheme] = useState<'gold' | 'cyber'>('gold');
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const { data: telemetryData } = useLiveTopbarTelemetry();

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
    if (typeof window !== 'undefined' && window.innerWidth <= 960) {
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
    <div className={`quant-app quant-cyber-grid quant-${portal}`}>
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
            {mobileMenuOpen ? '✕' : sidebarCollapsed ? '»' : '«'}
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
              <span className="text-emerald-400 font-bold tabular-nums">{liveSpot.latency}ms G2</span>
            </div>
            <div className="flex items-baseline justify-between font-mono tabular-nums">
              <span className="text-lg font-extrabold text-white">{liveSpot.loaded && liveSpot.bid > 0 ? `$${liveSpot.bid.toFixed(2)}` : "Đang nạp..."}</span>
              <span className="text-[11px] text-amber-300">{liveSpot.loaded && liveSpot.spread > 0 ? `Spread ${liveSpot.spread.toFixed(1)}p` : "Real-time"}</span>
            </div>
            <div className="grid grid-cols-3 gap-1 pt-1 border-t border-white/[0.06] font-mono text-[9.5px] text-slate-400">
              <span>SL: <strong className="text-emerald-300">100%</strong></span>
              <span>BE: <strong className="text-cyan-300">1R</strong></span>
              <span>DD: <strong className="text-amber-300">4.0%</strong></span>
            </div>
          </div>
        )}

        <div className="quant-workspace">
          {sidebarCollapsed
            ? portal === 'admin'
              ? 'ADM'
              : 'USR'
            : portal === 'admin'
            ? '⚡ ROOT ADMIN COMMAND'
            : '◈ TRADER WORKSPACE'}
        </div>

        <nav className="quant-nav" aria-label="Menu chính">
          {navigation[portal].map(([key, label, code]) => (
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
              <span aria-hidden="true" className="font-mono text-[11px] font-bold">
                {code}
              </span>
              {!sidebarCollapsed && <strong className="font-semibold truncate">{label}</strong>}
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
                  Cụm Đám Mây
                </span>
                <span className="text-amber-300 font-mono tabular-nums">London G2 · OK</span>
              </div>
              <div className="flex flex-col gap-1.5 pt-0.5 w-full">
                <button
                  type="button"
                  onClick={() => setCmdOpen(true)}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-slate-200 bg-white/[0.04] hover:bg-amber-500/15 hover:text-amber-200 border border-white/10 transition-colors flex items-center justify-between cursor-pointer"
                >
                  <span>Bảng Lệnh Nhanh</span>
                  <kbd className="text-[10px] text-amber-300">⌘K</kbd>
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 w-full">
              <button
                type="button"
                onClick={() => setCmdOpen(true)}
                title="Bảng Lệnh Nhanh (⌘K)"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-amber-300 hover:border-amber-400/50 hover:bg-amber-500/15 transition cursor-pointer"
              >
                ⌘
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Execution Stage */}
      <div className={`quant-stage ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
        {/* Top Deck 1: Institutional Global Telemetry & Theme Ribbon */}
        <div className="hidden md:flex items-center justify-between border-b border-white/[0.07] bg-[#020409]/95 px-6 py-1.5 font-mono text-[11px] text-slate-400">
          <div className="flex items-center gap-4 tabular-nums">
            <span className="inline-flex items-center gap-1.5 text-amber-300 font-bold">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              XAU/USD: {liveSpot.loaded && liveSpot.bid > 0 ? `$${liveSpot.bid.toFixed(2)} / $${liveSpot.ask.toFixed(2)}` : "Đang đồng bộ..."}
            </span>
            <span className="text-slate-600">·</span>
            <span>
              PHIÊN:{' '}
              <strong className="text-emerald-400">
                {(() => {
                  const now = new Date();
                  const day = now.getUTCDay();
                  const hour = now.getUTCHours();
                  if (day === 0 || day === 6 || (day === 5 && hour >= 22)) return 'CUỐI TUẦN (ĐÓNG CỬA)';
                  if (hour >= 13 && hour < 17) return 'LONDON–NY OVERLAP';
                  if (hour >= 7 && hour < 13) return 'PHIÊN ÂU (LONDON)';
                  if (hour >= 17 && hour < 22) return 'PHIÊN MỸ (NEW YORK)';
                  return 'PHIÊN Á (TOKYO)';
                })()}
              </strong>
            </span>
            <span className="text-slate-600">·</span>
            <span>
              GIÁP VỐN: <strong className="text-cyan-300">4/4 FAIL-CLOSED</strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setQuantTheme('gold')}
                className={`rounded px-2 py-0.5 font-bold transition cursor-pointer ${
                  quantTheme === 'gold'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                SOVEREIGN GOLD
              </button>
              <button
                type="button"
                onClick={() => setQuantTheme('cyber')}
                className={`rounded px-2 py-0.5 font-bold transition cursor-pointer ${
                  quantTheme === 'cyber'
                    ? 'bg-cyan-400 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                CYBER MATRIX
              </button>
            </div>
          </div>
        </div>

        {/* Top Deck 2: Clean 3-Zone Top Bar Contract */}
        <header className="quant-topbar">
          {/* Zone 1: Sidebar Toggle + Contextual Breadcrumb Trail */}
          <div className="quant-context">
            <button
              type="button"
              onClick={handleToggleSidebar}
              title={sidebarCollapsed ? 'Mở thanh tác vụ bên trái (Ctrl+B)' : 'Thu gọn thanh tác vụ bên trái (Ctrl+B)'}
              aria-label="Đóng mở thanh điều hướng"
              className="mr-2 flex h-8 w-8 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:border-amber-400/60 hover:bg-amber-500/20 transition cursor-pointer font-mono text-sm"
            >
              ☰
            </button>
            <span className="text-amber-300/80 hidden sm:inline font-semibold">
              {portal === 'admin' ? 'TRẠM QUẢN TRỊ' : 'CỔNG TRADER'}
            </span>
            <span aria-hidden="true" className="text-slate-600 hidden sm:inline">/</span>
            <span className="text-white font-bold">{currentNavLabel}</span>
          </div>

          {/* Zone 2: Dedicated Workspace Telemetry Indicator (No Cross-Portal Switcher) */}
          <div className="hidden xl:flex items-center gap-2 px-3 py-1 rounded-xl bg-[#040711] border border-amber-500/20 font-mono text-[11px] text-slate-300 shrink-0">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{portal === 'admin' ? 'ADMIN CLUSTER · LONDON G2' : 'CLOUD MT5 STREAM · LONDON G2'}</span>
            <span className="text-amber-300 font-bold tabular-nums">~{liveSpot.latency}ms</span>
          </div>

          {/* Zone 3: Session Identity & Primary Action */}
          <div className="quant-session">
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="quant-quiet hidden sm:inline-flex items-center gap-1.5"
              title="Mở bảng điều khiển nhanh (Ctrl+K)"
            >
              <span>Lệnh Nhanh</span>
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
              Đổi MK
            </button>
            <button
              className="quant-quiet hover:border-rose-500/50 hover:text-rose-300"
              onClick={logout}
            >
              Đăng xuất
            </button>
          </div>
        </header>

        <main className="quant-content">
          {/* Quantum Command Header Deck */}
          <div className="quant-heading">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-amber-300">
                <span>{portal === 'admin' ? 'QUANTUM OS // EXECUTIVE COMMAND' : 'QUANTUM OS // PORTFOLIO COCKPIT'}</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-cyan-300">ZERO-VPS METAAPI G2</span>
              </div>
              <h1>{pageTitles[portal][page]}</h1>
              <p className="text-sm text-slate-300/90 max-w-3xl leading-relaxed m-0">
                {pageSubtitles[portal][page]}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2 font-bold text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {portal === 'admin' ? 'CLUSTER MASTER ONLINE' : '4/4 CAPITAL SHIELD ACTIVE'}
              </span>
            </div>
          </div>
          {children}
        </main>
      </div>

      {/* Mobile WebApp Bottom Navigation Bar */}
      <nav
        aria-label="Điều hướng di động"
        className="fixed bottom-0 left-0 right-0 z-30 flex md:hidden items-center justify-around border-t border-amber-500/25 bg-[#03060f]/95 px-1 py-1.5 backdrop-blur-2xl shadow-[0_-10px_30px_rgba(0,0,0,0.85)] pb-[max(0.375rem,env(safe-area-inset-bottom))]"
      >
        {portal === 'user' ? (
          <>
            <button
              type="button"
              onClick={() => onNavigate('overview')}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'overview'
                  ? 'text-amber-300 font-bold bg-amber-500/15 border border-amber-500/35'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-sm leading-none">01</span>
              <span>Tổng quan</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('accounts')}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'accounts'
                  ? 'text-amber-300 font-bold bg-amber-500/15 border border-amber-500/35'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-sm leading-none">02</span>
              <span>Tài khoản</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('orders')}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'orders'
                  ? 'text-amber-300 font-bold bg-amber-500/15 border border-amber-500/35'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-sm leading-none">03</span>
              <span>Khớp lệnh</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl font-mono text-[10px] text-slate-400 hover:text-amber-300 transition cursor-pointer"
            >
              <span className="text-base leading-none">☰</span>
              <span>Menu</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onNavigate('radar')}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'radar'
                  ? 'text-amber-300 font-bold bg-amber-500/15 border border-amber-500/35'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-sm leading-none">01</span>
              <span>Giám sát</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('ai')}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'ai'
                  ? 'text-amber-300 font-bold bg-amber-500/15 border border-amber-500/35'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-sm leading-none">02</span>
              <span>Trí tuệ AI</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('business')}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'business'
                  ? 'text-amber-300 font-bold bg-amber-500/15 border border-amber-500/35'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-sm leading-none">03</span>
              <span>Kinh doanh</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-xl font-mono text-[10px] text-slate-400 hover:text-amber-300 transition cursor-pointer"
            >
              <span className="text-base leading-none">☰</span>
              <span>Tất cả</span>
            </button>
          </>
        )}
      </nav>

      {/* Quick Command Palette Modal (⌘K) */}
      {cmdOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 pt-20 p-4 backdrop-blur-md"
          onClick={() => setCmdOpen(false)}
        >
          <div
            className="quant-panel w-full max-w-xl p-5 space-y-4 border-amber-400/50 shadow-[0_0_60px_rgba(245,158,11,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 font-mono text-xs text-amber-300">
                <span>⚡ ZUPIRUS QUANTUM OS v4.0 — COMMAND PALETTE</span>
              </div>
              <button
                type="button"
                onClick={() => setCmdOpen(false)}
                className="text-slate-400 hover:text-white font-mono text-xs cursor-pointer"
              >
                ESC ✕
              </button>
            </div>

            <input
              type="text"
              value={cmdQuery}
              onChange={(e) => setCmdQuery(e.target.value)}
              placeholder="Tìm nhanh mô-đun điều hướng hoặc cổng giao diện..."
              className="quant-input font-mono text-xs"
              autoFocus
            />

            <div className="space-y-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
                Điều Hướng Phân Hệ ({portal.toUpperCase()})
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
            className="quant-panel w-full max-w-md border-cyan-500/40 p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <span className="font-mono text-xs font-bold uppercase tracking-widest text-cyan-300">
                Đổi Mật Khẩu Bảo Mật
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
                  const res = await fetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
                    credentials: 'include',
                    body: JSON.stringify({ current_password: curPwd, new_password: newPwd }),
                  });
                  const d = await res.json().catch(() => ({}));
                  if (res.ok) {
                    setPwdMsg('✓ Đã đổi mật khẩu thành công.');
                    setCurPwd('');
                    setNewPwd('');
                  } else {
                    setPwdMsg(`Lỗi: ${d.detail || res.status}`);
                  }
                } catch (err: any) {
                  setPwdMsg(`Lỗi mạng: ${err.message}`);
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
                placeholder="Mật khẩu hiện tại"
                className="quant-input text-xs"
              />
              <input
                type="password"
                required
                minLength={12}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="Mật khẩu mới (tối thiểu 12 ký tự)"
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
                  Đóng
                </button>
                <button type="submit" disabled={pwdBusy} className="quant-btn-primary px-4 py-1.5 text-xs">
                  {pwdBusy ? 'Đang lưu...' : 'Cập nhật mật khẩu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function PortalAuth({
  portal,
  loading,
  error,
  onSubmit,
  onClosePreview,
}: {
  portal: Portal;
  loading: boolean;
  error: string | null;
  onSubmit: (email: string, password: string, register: boolean, otp?: string) => Promise<void>;
  onSwitchPortal?: (target: PortalType) => void;
  onClosePreview?: () => void;
}) {
  const [register, setRegister] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetOtp, setResetOtp] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [otpNotice, setOtpNotice] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  const title =
    portal === 'admin'
      ? 'Trạm Chỉ Huy Điều Hành Định Lượng'
      : 'Hệ Thống Giao Dịch Định Lượng XAU/USD Đám Mây';

  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = setInterval(() => {
      setOtpCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCountdown]);

  async function handleSendOtp() {
    if (!emailInput || !emailInput.includes('@')) {
      setOtpNotice('Vui lòng nhập địa chỉ email hợp lệ trước khi yêu cầu mã OTP.');
      return;
    }
    setOtpSending(true);
    setOtpNotice(null);
    try {
      const endpoint = forgotMode ? '/api/auth/forgot-password' : '/api/auth/send-otp';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ email: emailInput }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setOtpSent(true);
        setOtpCountdown(60);
        setOtpNotice('✓ Mã xác thực OTP 6 chữ số đã được gửi tới hộp thư email của bạn.');
      } else {
        setOtpNotice(data.detail || data.message || 'Không thể gửi mã OTP. Vui lòng thử lại.');
      }
    } catch (err: any) {
      setOtpNotice(`Lỗi kết nối: ${err.message || String(err)}`);
    } finally {
      setOtpSending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') || emailInput);
    const password = String(data.get('password') || passwordInput);

    if (forgotMode) {
      if (!resetOtp || resetOtp.length !== 6) {
        setOtpNotice('Vui lòng nhập đủ mã OTP 6 chữ số gửi về email.');
        return;
      }
      setResetBusy(true);
      setOtpNotice(null);
      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
          body: JSON.stringify({ email, otp_code: resetOtp, new_password: password }),
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok) {
          setForgotMode(false);
          setResetOtp('');
          setPasswordInput('');
          setOtpSent(false);
          setOtpCountdown(0);
          setOtpNotice('✓ Đặt lại mật khẩu thành công! Vui lòng đăng nhập bằng mật khẩu mới.');
        } else {
          setOtpNotice(d.detail || d.message || 'Không thể đặt lại mật khẩu.');
        }
      } catch (err: any) {
        setOtpNotice(`Lỗi kết nối: ${err.message || String(err)}`);
      } finally {
        setResetBusy(false);
      }
      return;
    }

    const otp = register ? String(data.get('otp') || '') : undefined;

    if (register && !otp) {
      setOtpNotice('Vui lòng bấm "Gửi mã OTP" và nhập mã xác thực 6 số từ email để tạo tài khoản.');
      return;
    }
    void onSubmit(email, password, register, otp);
  }

  return (
    <div className={`quant-app quant-auth quant-cyber-grid quant-${portal}`}>
      {/* Left Column: High-Tech Architectural Story & Visual Monolith */}
      <div className="quant-auth-story">
        <div className="flex items-center justify-between">
          <Brand />
          <div className="flex items-center gap-2">
            {onClosePreview && (
              <button type="button" onClick={onClosePreview} className="quant-quiet">
                ← Quay lại Dashboard
              </button>
            )}
          </div>
        </div>

        <div className="my-auto py-8 space-y-6 max-w-xl">
          <div className="text-xs font-mono text-amber-300 flex items-center gap-2">
            <span>SOVEREIGN XAU/USD QUANT OS v4.0</span>
            <span aria-hidden="true">·</span>
            <span>ZERO EA</span>
            <span aria-hidden="true">·</span>
            <span>LONDON G2</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-[1.12] text-balance">
            {title}
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
            Kết nối trực tiếp thuật toán định lượng từ đám mây tới tài khoản MT5 cá nhân của bạn với độ trễ 24ms.
            Bảo vệ nguồn vốn bằng 4 lớp giáp an toàn bắt buộc và cơ chế Auto Break-Even (1R).
          </p>

          <div className="relative rounded-2xl overflow-hidden border border-amber-500/35 bg-[#070d1c] aspect-[16/10] shadow-2xl">
            {!imgError ? (
              <img
                src={authTerminalImg}
                alt="Kiến trúc định lượng ZUPIRUS"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (target.dataset.triedPublic !== '1') {
                    target.dataset.triedPublic = '1';
                    target.src = '/assets/images/auth_terminal_sculpture_1794792847915.jpg';
                  } else {
                    setImgError(true);
                  }
                }}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-[#030611] flex flex-col items-center justify-center p-6 text-center select-none relative overflow-hidden">
                <svg viewBox="0 0 480 240" className="w-full h-full max-h-52 overflow-visible">
                  <defs>
                    <linearGradient id="authCloudGlow" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.8" />
                    </linearGradient>
                    <pattern id="authGridPattern" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(245,158,11,0.08)" strokeWidth="0.8" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#authGridPattern)" />
                  <circle cx="240" cy="110" r="34" fill="#04091a" stroke="url(#authCloudGlow)" strokeWidth="2" />
                  <circle cx="240" cy="110" r="44" fill="none" stroke="rgba(6,182,212,0.3)" strokeDasharray="3 4" />
                  <text x="240" y="106" textAnchor="middle" fill="#fbbf24" fontSize="11" fontWeight="800" fontFamily="JetBrains Mono, monospace">QUANTUM OS</text>
                  <text x="240" y="120" textAnchor="middle" fill="#38bdf8" fontSize="8" fontFamily="JetBrains Mono, monospace">LONDON G2</text>
                  <circle cx="80" cy="80" r="24" fill="#04091a" stroke="#f59e0b" strokeWidth="1.5" />
                  <text x="80" y="83" textAnchor="middle" fill="#fde68a" fontSize="8.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">SIGNAL FEED</text>
                  <path d="M104,80 L206,110" stroke="rgba(245,158,11,0.5)" strokeWidth="1.5" strokeDasharray="4 3" />
                  <circle cx="400" cy="80" r="24" fill="#04091a" stroke="#10b981" strokeWidth="1.5" />
                  <text x="400" y="83" textAnchor="middle" fill="#6ee7b7" fontSize="8.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">MT5 CLOUD</text>
                  <path d="M274,110 L376,80" stroke="rgba(16,185,129,0.5)" strokeWidth="1.5" strokeDasharray="4 3" />
                  <rect x="150" y="172" width="180" height="26" rx="6" fill="#030816" stroke="rgba(6,182,212,0.6)" strokeWidth="1.2" />
                  <text x="240" y="189" textAnchor="middle" fill="#67e8f9" fontSize="9" fontWeight="700" fontFamily="JetBrains Mono, monospace">4-LAYER FAIL-CLOSED SHIELD</text>
                  <path d="M240,144 L240,172" stroke="rgba(6,182,212,0.7)" strokeWidth="1.5" />
                </svg>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#03050a] via-[#03050a]/45 to-transparent pointer-events-none" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-amber-400/20 to-transparent border-t border-amber-400/50 animate-laser-scan" />
            <div className="absolute bottom-4 left-4 right-4 grid grid-cols-3 gap-3 text-xs font-mono">
              <div className="p-3 rounded-xl bg-slate-950/85 backdrop-blur-md border border-white/10">
                <span className="text-slate-400 text-[10px] block">CẦU NỐI ĐÁM MÂY</span>
                <span className="font-bold text-amber-300 mt-0.5 block">MetaApi Direct</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/85 backdrop-blur-md border border-white/10">
                <span className="text-slate-400 text-[10px] block">ĐỘ TRỄ KHỚP LỆNH</span>
                <span className="font-bold text-emerald-400 mt-0.5 block tabular-nums">~24 ms London</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/85 backdrop-blur-md border border-white/10">
                <span className="text-slate-400 text-[10px] block">GIÁP BẢO VỆ VỐN</span>
                <span className="font-bold text-cyan-300 mt-0.5 block">4 Lớp Fail-Closed</span>
              </div>
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500 font-mono flex items-center justify-between">
          <span>© 2026 ZUPIRUS Quant Lab · Quantum OS v4.0</span>
          <span>Bảo mật & Kiểm toán cấp tổ chức</span>
        </div>
      </div>

      {/* Right Column: High-End Auth Stage */}
      <div className="quant-auth-stage">
        <div className="quant-auth-box">
          <h2>{register ? 'Tạo Tài Khoản & Xác Thực OTP' : 'Đăng Nhập Quantum OS'}</h2>
          <p>
            {portal === 'admin'
              ? 'Dành riêng cho ban quản trị điều hành hạ tầng định lượng.'
              : register
              ? 'Xác thực mã OTP qua email để kích hoạt không gian quản lý tài khoản MT5.'
              : 'Truy cập bảng điều khiển danh mục và cấu hình sao chép đám mây MT5.'}
          </p>

          {error && <div className="quant-alert">{error}</div>}
          {otpNotice && (
            <div
              className={`quant-alert ${
                otpNotice.startsWith('✓') ? 'border-emerald-500/50 bg-emerald-950/40 text-emerald-300' : ''
              }`}
            >
              {otpNotice}
            </div>
          )}

          <form onSubmit={submit}>
            <div>
              <label htmlFor="auth-email">ĐỊA CHỈ EMAIL</label>
              <div className="flex gap-2 mt-1.5">
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="name@domain.com"
                  required
                  className="flex-1"
                />
                {(register || forgotMode) && (
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={otpSending || otpCountdown > 0 || !emailInput}
                    className="rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-mono font-bold text-xs px-4 py-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {otpSending
                      ? 'Đang gửi...'
                      : otpCountdown > 0
                      ? `Chờ (${otpCountdown}s)`
                      : otpSent
                      ? 'Gửi lại OTP'
                      : 'Gửi mã OTP'}
                  </button>
                )}
              </div>
            </div>

            {register && (
              <div>
                <label htmlFor="auth-otp">MÃ XÁC THỰC OTP (6 CHỮ SỐ TỪ EMAIL)</label>
                <input
                  id="auth-otp"
                  name="otp"
                  type="text"
                  placeholder="849201"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  className="mt-1.5 font-mono tracking-widest text-center text-lg font-bold tabular-nums"
                />
              </div>
            )}

            {forgotMode && (
              <div>
                <label htmlFor="auth-reset-otp">MÃ XÁC THỰC OTP KHÔI PHỤC (6 CHỮ SỐ)</label>
                <input
                  id="auth-reset-otp"
                  name="reset_otp"
                  type="text"
                  value={resetOtp}
                  onChange={(e) => setResetOtp(e.target.value)}
                  placeholder="849201"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  className="mt-1.5 font-mono tracking-widest text-center text-lg font-bold tabular-nums"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="auth-password">{forgotMode ? 'MẬT KHẨU MỚI' : 'MẬT KHẨU'}</label>
                {portal === 'user' && !register && !forgotMode && (
                  <button
                    type="button"
                    onClick={() => {
                      setForgotMode(true);
                      setOtpNotice(null);
                      setOtpSent(false);
                      setOtpCountdown(0);
                    }}
                    className="text-[11px] font-mono text-cyan-300 hover:text-cyan-200 transition-colors cursor-pointer"
                  >
                    Quên mật khẩu?
                  </button>
                )}
              </div>
              <input
                id="auth-password"
                name="password"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                autoComplete={register || forgotMode ? 'new-password' : 'current-password'}
                minLength={forgotMode || register ? 12 : undefined}
                placeholder={forgotMode || register ? 'Tối thiểu 12 ký tự' : 'Nhập mật khẩu bảo mật'}
                required
                className="mt-1.5"
              />
            </div>

            <button className="quant-primary mt-2" disabled={loading || resetBusy}>
              <span>
                {resetBusy
                  ? 'Đang đặt lại...'
                  : loading
                  ? 'Đang xác thực…'
                  : forgotMode
                  ? 'Xác Nhận Đặt Lại Mật Khẩu'
                  : register
                  ? 'Xác Nhận OTP & Tạo Tài Khoản'
                  : 'Đăng Nhập Vào Hệ Thống'}
              </span>
              <span aria-hidden="true">→</span>
            </button>
          </form>

          {portal === 'user' && (
            <div className="mt-5 pt-4 border-t border-slate-800/80 text-center space-y-2">
              {forgotMode ? (
                <button
                  type="button"
                  className="text-xs font-mono text-amber-300 hover:text-amber-200 transition-colors cursor-pointer"
                  onClick={() => {
                    setForgotMode(false);
                    setOtpNotice(null);
                    setOtpSent(false);
                  }}
                  disabled={resetBusy}
                >
                  ← Quay lại đăng nhập
                </button>
              ) : (
                <button
                  type="button"
                  className="text-xs font-mono text-amber-300 hover:text-amber-200 transition-colors cursor-pointer"
                  onClick={() => {
                    setRegister(!register);
                    setOtpNotice(null);
                    setOtpSent(false);
                  }}
                  disabled={loading}
                >
                  {register ? '← Đã có tài khoản? Đăng nhập ngay' : 'Chưa có tài khoản? Đăng ký mới với OTP email →'}
                </button>
              )}
            </div>
          )}

          {onClosePreview && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={onClosePreview}
                className="quant-btn-secondary w-full py-2 text-xs"
              >
                ← Đóng Xem Trước & Quay Lại Bảng Điều Khiển
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
