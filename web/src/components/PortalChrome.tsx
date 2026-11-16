import { useState, useEffect, type FormEvent, type ReactNode } from 'react';
import type { PortalType } from '../App.tsx';

export type Portal = 'user' | 'admin';

const navigation = {
  user: [
    ['overview', 'Tổng quan danh mục', '◫'],
    ['accounts', 'Tài khoản Cloud MT5', '⌁'],
    ['orders', 'Nhật ký khớp lệnh', '≡'],
    ['assistant', 'Trợ lý định lượng AI', '✦'],
  ],
  admin: [
    ['overview', 'Trạm điều hành trung tâm', '◫'],
    ['billing', 'Thanh toán & Tỷ giá', '◈'],
    ['sources', 'Phễu nguồn & Kỹ năng AI', '⚡'],
    ['orders', 'Đơn hàng & Gói cước', '≡'],
    ['infrastructure', 'Hạ tầng Cloud MT5', '⌁'],
    ['risk_users', 'Lá chắn rủi ro & Quyền', '⛨'],
  ],
};

const pageTitles: Record<Portal, Record<string, string>> = {
  user: {
    overview: 'Tổng Quan Danh Mục & Biểu Đồ Thực Thi',
    accounts: 'Tài Khoản Cloud MT5 & Cấu Hình Rủi Ro',
    orders: 'Nhật Ký Khớp Lệnh & Đối Soát Đám Mây',
    assistant: 'Trợ Lý Phân Tích Danh Mục Định Lượng',
  },
  admin: {
    overview: 'Trạm Chỉ Huy Điều Hành Định Lượng',
    billing: 'Cấu Hình Cổng Thanh Toán SePay & Tỷ Giá',
    sources: 'Phễu Tuyển Chọn Nguồn Tín Hiệu & Kỹ Năng Agent',
    orders: 'Quản Lý Đơn Hàng VietQR & Phân Cấp Gói Cước',
    infrastructure: 'Quản Trị Cụm Terminal Cloud MT5 London G2',
    risk_users: 'Lá Chắn Rủi Ro Toàn Hệ Thống & Phân Quyền',
  },
};

const pageSubtitles: Record<Portal, Record<string, string>> = {
  user: {
    overview: 'Giám sát vốn thả nổi thời gian thực, luồng nến TimescaleDB 24/5 và trạng thái 4 lớp giáp bảo vệ vốn.',
    accounts: 'Kết nối trực tiếp tới máy chủ MT5 qua hạ tầng đám mây London G2 mà không cần treo máy hay cài đặt EA.',
    orders: 'Truy vết minh bạch từng tín hiệu, giá khớp thực tế, mã Ticket/Deal và nhật ký kiểm toán rủi ro.',
    assistant: 'Truy vấn trực tiếp dữ liệu danh mục và lịch sử thực thi của riêng bạn với giao diện trực quan.',
  },
  admin: {
    overview: 'Điều phối luồng bắn lệnh song song (Fan-Out), giám sát mô hình học quy nạp Tabula Rasa và nhật ký kiểm toán.',
    billing: 'Quản lý tài khoản ngân hàng thụ hưởng VietQR, đồng bộ tỷ giá USD/VND và kiểm thử mã QR trực tiếp.',
    sources: 'Đánh giá hiệu suất nguồn tín hiệu ẩn (Shadow Signals), chấm điểm EOD M1 và điều khiển kho kỹ năng AI.',
    orders: 'Theo dõi doanh thu thời gian thực, đối soát giao dịch SePay Webhook và phê duyệt kích hoạt thủ công.',
    infrastructure: 'Quản trị trạng thái kết nối MetaApi Cloud, phân loại tài khoản Standard/Cent/Prop và điều khiển triển khai.',
    risk_users: 'Kích hoạt khóa ngắt khẩn cấp toàn hệ thống (Kill-Switch), lịch chặn tin tức USD Đỏ và quản lý tài khoản.',
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
      title="ZUPIRUS Quant Execution Lab"
    >
      <div className="relative w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-cyan-400 via-teal-400 to-emerald-500 p-[1px] shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-transform duration-150 group-hover:scale-105">
        <div className="w-full h-full bg-[#040814] rounded-[11px] flex items-center justify-center font-extrabold text-cyan-300 text-lg font-mono">
          Z
        </div>
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <span className="font-extrabold text-base tracking-tight text-slate-100 font-display block leading-none truncate">
            ZUPIRUS
          </span>
          <span className="text-[11px] text-cyan-400/90 font-mono block mt-1 truncate">
            Quant Execution Lab
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
  switchPortal,
  logout,
  children,
}: {
  portal: Portal;
  page: string;
  onNavigate: (page: string) => void;
  email: string;
  switchPortal?: () => void;
  logout: () => void;
  children: ReactNode;
}) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const currentNavLabel = navigation[portal].find(([key]) => key === page)?.[1] || 'Tổng quan';

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

  return (
    <div className={`quant-app quant-cyber-grid quant-${portal}`}>
      {/* Mobile Backdrop Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Collapsible Left Sidebar Navigation */}
      <aside
        className={`quant-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''} ${
          mobileMenuOpen ? '' : 'is-mobile-closed'
        }`}
      >
        <div className={`flex items-center ${sidebarCollapsed ? 'flex-col gap-3' : 'justify-between gap-2'}`}>
          <Brand collapsed={sidebarCollapsed} />
          <button
            type="button"
            onClick={handleToggleSidebar}
            title={mobileMenuOpen ? 'Đóng menu' : sidebarCollapsed ? 'Mở rộng thanh tác vụ (Ctrl+B)' : 'Thu gọn thanh tác vụ (Ctrl+B)'}
            aria-label={mobileMenuOpen ? 'Đóng menu' : sidebarCollapsed ? 'Mở rộng thanh tác vụ' : 'Thu gọn thanh tác vụ'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-500/10 text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/20 hover:text-white transition cursor-pointer font-mono text-xs"
          >
            {mobileMenuOpen ? '✕' : sidebarCollapsed ? '»' : '«'}
          </button>
        </div>

        <div className="quant-workspace">
          {sidebarCollapsed ? (portal === 'admin' ? 'ADM' : 'USR') : portal === 'admin' ? 'Executive Command' : 'Client Workspace'}
        </div>

        <nav className="quant-nav" aria-label="Menu chính">
          {navigation[portal].map(([key, label, glyph]) => (
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
              <span aria-hidden="true">{glyph}</span>
              {!sidebarCollapsed && <strong className="font-semibold truncate">{label}</strong>}
            </button>
          ))}
        </nav>

        {/* Quick Portal Mode Switcher in Sidebar Footer */}
        <div className="quant-sidebar-end">
          {!sidebarCollapsed ? (
            <>
              <div className="flex items-center justify-between text-[11px] text-slate-300 pb-2 border-b border-slate-800/80">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  XAU/USD · MT5 Cloud
                </span>
                <span className="text-cyan-300 font-mono tabular-nums">London G2</span>
              </div>
              <div className="flex flex-col gap-1.5 pt-0.5 w-full">
                <button
                  type="button"
                  onClick={() => setCmdOpen(true)}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-slate-200 bg-white/[0.04] hover:bg-cyan-500/15 hover:text-cyan-200 border border-white/10 transition-colors flex items-center justify-between cursor-pointer"
                >
                  <span>Bảng Lệnh Nhanh</span>
                  <kbd className="text-[10px] text-cyan-300">⌘K</kbd>
                </button>
                {portal === 'admin' && switchPortal && (
                  <button
                    type="button"
                    onClick={switchPortal}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-cyan-300 bg-cyan-950/45 hover:bg-cyan-900/60 border border-cyan-500/35 transition-colors flex items-center justify-between cursor-pointer"
                  >
                    <span>Chuyển sang Cổng User</span>
                    <span aria-hidden="true">⇄</span>
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 w-full">
              <button
                type="button"
                onClick={() => setCmdOpen(true)}
                title="Bảng Lệnh Nhanh (⌘K)"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-500/15 transition cursor-pointer"
              >
                ⌘
              </button>
              {portal === 'admin' && switchPortal && (
                <button
                  type="button"
                  onClick={switchPortal}
                  title="Chuyển sang Cổng User"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/35 bg-cyan-950/45 text-cyan-300 hover:bg-cyan-900/60 transition cursor-pointer"
                >
                  ⇄
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main Execution Stage */}
      <div className={`quant-stage ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
        {/* Clean 3-Zone Top Bar Contract (Telemetry bar removed per user request) */}
        <header className="quant-topbar">
          {/* Zone 1: Sidebar Toggle + Contextual Breadcrumb Trail */}
          <div className="quant-context">
            <button
              type="button"
              onClick={handleToggleSidebar}
              title={sidebarCollapsed ? 'Mở thanh tác vụ bên trái (Ctrl+B)' : 'Thu gọn thanh tác vụ bên trái (Ctrl+B)'}
              className="mr-2 flex h-8 w-8 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-500/10 text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/20 transition cursor-pointer font-mono text-sm"
            >
              ☰
            </button>
            <span className="text-slate-400 hidden sm:inline">
              {portal === 'admin' ? 'Trạm quản trị' : 'Không gian giao dịch'}
            </span>
            <span aria-hidden="true" className="text-slate-600 hidden sm:inline">/</span>
            <span className="text-slate-100 font-semibold">{currentNavLabel}</span>
          </div>

          {/* Zone 2: Optional Cross-Portal Switcher */}
          {portal === 'admin' && switchPortal && (
            <div className="hidden xl:flex items-center gap-1 p-1 rounded-xl bg-slate-950/90 border border-cyan-500/20">
              <button
                type="button"
                onClick={switchPortal}
                className="px-3 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                📊 Xem Cổng Khách Hàng ↗
              </button>
            </div>
          )}

          {/* Zone 3: Session Identity & Primary Action */}
          <div className="quant-session">
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="quant-quiet hidden sm:inline-flex items-center gap-1.5"
              title="Mở bảng điều khiển nhanh (Ctrl+K)"
            >
              <span>Lệnh Nhanh</span>
              <span className="text-cyan-400">⌘K</span>
            </button>
            <span className="quant-email hidden md:inline-block" title={email}>
              {email}
            </span>
            <button
              className="quant-quiet hover:border-rose-500/50 hover:text-rose-300"
              onClick={logout}
            >
              Đăng xuất
            </button>
          </div>
        </header>

        <main className="quant-content">
          <div className="quant-heading">
            <div className="space-y-1.5">
              <h1>{pageTitles[portal][page]}</h1>
              <p className="text-sm text-slate-400 max-w-3xl leading-relaxed m-0">
                {pageSubtitles[portal][page]}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <span>XAU/USD M15</span>
              <span aria-hidden="true">·</span>
              <span className="text-cyan-300">Direct Cloud Bridge</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400">4 Lớp Giáp Bật</span>
            </div>
          </div>
          {children}
        </main>
      </div>

      {/* Mobile WebApp Bottom Navigation Bar */}
      <nav
        aria-label="Điều hướng di động"
        className="fixed bottom-0 left-0 right-0 z-30 flex md:hidden items-center justify-around border-t border-cyan-500/20 bg-[#030712]/95 px-1 py-1.5 backdrop-blur-2xl shadow-[0_-10px_30px_rgba(0,0,0,0.8)] pb-[max(0.375rem,env(safe-area-inset-bottom))]"
      >
        {portal === 'user' ? (
          <>
            <button
              type="button"
              onClick={() => onNavigate('overview')}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'overview'
                  ? 'text-cyan-300 font-bold bg-cyan-500/15 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-base leading-none">◫</span>
              <span>Tổng quan</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('accounts')}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'accounts'
                  ? 'text-cyan-300 font-bold bg-cyan-500/15 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-base leading-none">⌁</span>
              <span>Tài khoản</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('orders')}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'orders'
                  ? 'text-cyan-300 font-bold bg-cyan-500/15 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-base leading-none">⇄</span>
              <span>Khớp lệnh</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('assistant')}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'assistant'
                  ? 'text-cyan-300 font-bold bg-cyan-500/15 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-base leading-none">✧</span>
              <span>Trợ lý AI</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl font-mono text-[10px] text-slate-400 hover:text-cyan-300 transition cursor-pointer"
            >
              <span className="text-base leading-none">☰</span>
              <span>Menu</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onNavigate('overview')}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'overview'
                  ? 'text-cyan-300 font-bold bg-cyan-500/15 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-base leading-none">◫</span>
              <span>Tổng quan</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('sources')}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'sources'
                  ? 'text-cyan-300 font-bold bg-cyan-500/15 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-base leading-none">🎯</span>
              <span>Tín hiệu</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('infrastructure')}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'infrastructure'
                  ? 'text-cyan-300 font-bold bg-cyan-500/15 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-base leading-none">⌁</span>
              <span>MT5 Cloud</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('risk_users')}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-xl font-mono text-[10px] transition cursor-pointer ${
                page === 'risk_users'
                  ? 'text-rose-300 font-bold bg-rose-500/15 border border-rose-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-base leading-none">🛡️</span>
              <span>Lá chắn</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-xl font-mono text-[10px] text-slate-400 hover:text-cyan-300 transition cursor-pointer"
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
            className="quant-panel w-full max-w-xl p-5 space-y-4 border-cyan-400/50 shadow-[0_0_60px_rgba(6,182,212,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 font-mono text-xs text-cyan-300">
                <span>⚡ ZUPIRUS QUANTUM COMMAND PALETTE</span>
              </div>
              <button
                type="button"
                onClick={() => setCmdOpen(false)}
                className="text-slate-400 hover:text-white font-mono text-xs"
              >
                ESC ✕
              </button>
            </div>

            <div className="space-y-3">
              {portal === 'admin' && switchPortal && (
                <>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
                    1. Chuyển Đổi Cổng Giao Diện
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCmdOpen(false);
                        switchPortal();
                      }}
                      className="quant-btn-secondary py-2.5 px-3 text-xs justify-start"
                    >
                      📊 Xem Cổng Khách Hàng ↗
                    </button>
                  </div>
                </>
              )}

              <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400 pt-2">
                2. Điều Hướng Phân Hệ Hiện Tại ({portal.toUpperCase()})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {navigation[portal].map(([key, label, glyph]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      onNavigate(key);
                      setCmdOpen(false);
                    }}
                    className={`rounded-xl border px-3.5 py-2.5 text-left font-mono text-xs transition flex items-center gap-2.5 cursor-pointer ${
                      page === key
                        ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-200 font-bold'
                        : 'border-white/[0.08] bg-[#040814] text-slate-300 hover:border-cyan-500/35 hover:text-white'
                    }`}
                  >
                    <span className="text-cyan-400">{glyph}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
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
  onSwitchPortal,
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
  const [emailInput, setEmailInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [otpNotice, setOtpNotice] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  const title =
    portal === 'admin'
      ? 'Trạm Chỉ Huy Điều Hành Định Lượng'
      : 'Hệ Thống Giao Dịch Định Lượng Tự Hành Đám Mây';

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
      const res = await fetch('/api/auth/send-otp', {
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') || emailInput);
    const password = String(data.get('password'));
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
          <Brand onClick={onSwitchPortal ? () => onSwitchPortal('landing') : undefined} />
          <div className="flex items-center gap-2">
            {onClosePreview && (
              <button type="button" onClick={onClosePreview} className="quant-quiet">
                ← Quay lại Dashboard
              </button>
            )}
            {onSwitchPortal && (
              <button
                type="button"
                onClick={() => onSwitchPortal('landing')}
                className="quant-quiet"
              >
                🌐 Trang chủ
              </button>
            )}
          </div>
        </div>

        <div className="my-auto py-8 space-y-6 max-w-xl">
          <div className="text-xs font-mono text-cyan-300 flex items-center gap-2">
            <span>DIRECT CLOUD MT5 EXECUTION</span>
            <span aria-hidden="true">·</span>
            <span>ZERO EA</span>
            <span aria-hidden="true">·</span>
            <span>LONDON G2</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-100 tracking-tight leading-[1.12] text-balance">
            {title}
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
            Kết nối trực tiếp thuật toán định lượng từ đám mây tới tài khoản MT5 cá nhân của bạn với độ trễ microsecond.
            Bảo vệ nguồn vốn bằng 4 lớp giáp an toàn bắt buộc và cơ chế Auto Break-Even (1R).
          </p>

          <div className="relative rounded-2xl overflow-hidden border border-cyan-500/30 bg-[#070d1c] aspect-[16/10] shadow-2xl">
            {!imgError ? (
              <img
                src="/src/assets/images/auth_terminal_sculpture_1794792847915.jpg"
                alt="Kiến trúc định lượng ZUPIRUS"
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-cyan-950/50 via-slate-900 to-emerald-950/40 flex items-center justify-center font-mono text-xs text-cyan-300">
                ZUPIRUS QUANTUM ARCHITECTURE
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#02040a] via-[#02040a]/45 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-cyan-400/20 to-transparent border-t border-cyan-400/50 animate-laser-scan" />
            <div className="absolute bottom-4 left-4 right-4 grid grid-cols-3 gap-3 text-xs font-mono">
              <div className="p-3 rounded-xl bg-slate-950/85 backdrop-blur-md border border-white/10">
                <span className="text-slate-400 text-[10px] block">CẦU NỐI ĐÁM MÂY</span>
                <span className="font-bold text-cyan-300 mt-0.5 block">MetaApi Direct</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/85 backdrop-blur-md border border-white/10">
                <span className="text-slate-400 text-[10px] block">ĐỘ TRỄ KHỚP LỆNH</span>
                <span className="font-bold text-emerald-400 mt-0.5 block tabular-nums">~28 ms London</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/85 backdrop-blur-md border border-white/10">
                <span className="text-slate-400 text-[10px] block">GIÁP BẢO VỆ VỐN</span>
                <span className="font-bold text-amber-300 mt-0.5 block">4 Lớp Fail-Closed</span>
              </div>
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500 font-mono flex items-center justify-between">
          <span>© 2026 ZUPIRUS Quant Lab</span>
          <span>Bảo mật & Kiểm toán cấp tổ chức</span>
        </div>
      </div>

      {/* Right Column: High-End Auth Stage */}
      <div className="quant-auth-stage">
        <div className="quant-auth-box">
          {portal === 'admin' && onSwitchPortal && (
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950/90 border border-slate-800 mb-6 font-mono text-xs">
              <button
                type="button"
                onClick={() => onSwitchPortal('user')}
                className="flex-1 py-1.5 px-3 rounded-lg text-slate-400 hover:text-slate-200 transition-colors whitespace-nowrap cursor-pointer"
              >
                Cổng Khách Hàng ↗
              </button>
              <button
                type="button"
                className="flex-1 py-1.5 px-3 rounded-lg bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30 whitespace-nowrap"
              >
                Cổng Quản Trị
              </button>
            </div>
          )}

          <h2>{register ? 'Tạo Tài Khoản & Xác Thực OTP' : 'Đăng Nhập Hệ Thống'}</h2>
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
                {register && (
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={otpSending || otpCountdown > 0 || !emailInput}
                    className="rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-mono font-bold text-xs px-4 py-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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

            <div>
              <label htmlFor="auth-password">MẬT KHẨU</label>
              <input
                id="auth-password"
                name="password"
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                minLength={register ? 8 : undefined}
                placeholder={register ? 'Tối thiểu 8 ký tự' : 'Nhập mật khẩu bảo mật'}
                required
                className="mt-1.5"
              />
            </div>

            <button className="quant-primary mt-2" disabled={loading}>
              <span>{loading ? 'Đang xác thực…' : register ? 'Xác Nhận OTP & Tạo Tài Khoản' : 'Đăng Nhập Vào Hệ Thống'}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>

          {portal === 'user' && (
            <div className="mt-5 pt-4 border-t border-slate-800/80 text-center">
              <button
                type="button"
                className="text-xs font-mono text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
                onClick={() => {
                  setRegister(!register);
                  setOtpNotice(null);
                  setOtpSent(false);
                }}
                disabled={loading}
              >
                {register ? '← Đã có tài khoản? Đăng nhập ngay' : 'Chưa có tài khoản? Đăng ký mới với OTP email →'}
              </button>
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
