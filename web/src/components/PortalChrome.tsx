import { useState, useEffect, type FormEvent, type ReactNode } from 'react';
import { LiveTopTelemetryBar } from './LiveTopTelemetryBar.tsx';

export type Portal = 'user' | 'admin';

const navigation = {
  user: [
    ['overview', 'Tổng quan', '◫'],
    ['accounts', 'Tài khoản MT5', '⌁'],
    ['orders', 'Lịch sử lệnh', '≡'],
    ['assistant', 'Trợ lý AI', '✦'],
  ],
  admin: [
    ['overview', 'Tổng quan điều hành', '◫'],
    ['billing', 'Cấu hình thanh toán & Tỷ giá', '💳'],
    ['sources', 'Nguồn tín hiệu & Phễu AI', '⚡'],
    ['orders', 'Quản lý đơn hàng & Gói cước', '≡'],
    ['infrastructure', 'Hạ tầng Cloud MT5', '⌁'],
    ['risk_users', 'Lá chắn rủi ro & Người dùng', '🛡️'],
  ],
};

const pageTitles: Record<Portal, Record<string, string>> = {
  user: {
    overview: 'Tổng quan danh mục',
    accounts: 'Tài khoản MT5 & Cấu hình rủi ro',
    orders: 'Lịch sử lệnh & Khớp lệnh Cloud',
    assistant: 'Trợ lý định lượng AI',
  },
  admin: {
    overview: 'Trạm Chỉ Huy Điều Hành (Executive Command Center)',
    billing: 'Cấu Hình Thanh Toán SePay & Quản Lý Tỷ Giá',
    sources: 'Nguồn Tín Hiệu, Phễu Cào & Kho Kỹ Năng AI Agent',
    orders: 'Quản Lý Đơn Hàng & Kích Hoạt Gói Cước',
    infrastructure: 'Quản Trị Hạ Tầng Cloud MT5 & Khóa Gemini AI',
    risk_users: 'Lá Chắn Rủi Ro Toàn Hệ Thống & Quản Trị Người Dùng',
  },
};

function Brand() {
  return (
    <div className="quant-brand">
      <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 via-teal-500 to-blue-600 p-[1px] shadow-[0_0_20px_rgba(6,182,212,0.4)]">
        <div className="w-full h-full bg-[#070c18] rounded-[11px] flex items-center justify-center font-black text-cyan-400 text-lg font-mono">
          Z
        </div>
      </div>
      <div>
        <span className="font-black text-sm tracking-wider text-slate-100 font-mono block">ZUPIRUS</span>
        <small className="text-[9px] text-cyan-400 font-mono tracking-widest uppercase block -mt-0.5 font-bold">
          QUANT LAB v2.2
        </small>
      </div>
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
  return (
    <div className={`quant-app quant-${portal}`}>
      {/* Sleek Floating Sidebar */}
      <aside className="quant-sidebar">
        <Brand />
        <div className="quant-workspace">
          {portal === 'admin' ? 'TRẠM ĐIỀU HÀNH QUANT' : 'KHÔNG GIAN GIAO DỊCH'}
        </div>
        <nav className="quant-nav" aria-label="Menu chính">
          {navigation[portal].map(([key, label, glyph]) => (
            <button
              className="quant-nav-button"
              key={key}
              onClick={() => onNavigate(key)}
              aria-current={page === key ? 'page' : undefined}
            >
              <span aria-hidden="true">{glyph}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="quant-sidebar-end">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>XAU/USD · MT5</span>
          </div>
          <span className="text-[10px] text-cyan-400 font-bold">28ms G2</span>
        </div>
      </aside>

      {/* Main Execution Stage */}
      <div className="quant-stage">
        {portal === 'admin' && <LiveTopTelemetryBar />}
        <header className="quant-topbar">
          <div className="quant-context">
            <span className="text-slate-400">{portal === 'admin' ? 'Quản trị' : 'Không gian'}</span>
            <span aria-hidden="true">/</span>
            <span className="text-cyan-300 font-bold">{navigation[portal].find(([key]) => key === page)?.[1]}</span>
          </div>
          <div className="quant-session">
            {switchPortal && (
              <button className="quant-quiet" onClick={switchPortal}>
                {portal === 'admin' ? 'Cổng người dùng ↗' : 'Cổng quản trị ↗'}
              </button>
            )}
            <span className="quant-email" title={email}>
              {email}
            </span>
            <button className="quant-quiet hover:border-rose-500/50 hover:text-rose-400" onClick={logout}>
              Đăng xuất
            </button>
          </div>
        </header>
        <main className="quant-content">
          <div className="quant-heading">
            <h1>{pageTitles[portal][page]}</h1>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

export function PortalAuth({
  portal,
  loading,
  error,
  onSubmit,
}: {
  portal: Portal;
  loading: boolean;
  error: string | null;
  onSubmit: (email: string, password: string, register: boolean, otp?: string) => Promise<void>;
}) {
  const [register, setRegister] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [otpNotice, setOtpNotice] = useState<string | null>(null);

  const title = portal === 'admin' ? 'Trạm Chỉ Huy Điều Hành' : 'Hệ Thống Giao Dịch Định Lượng Tự Hành';

  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = setInterval(() => {
      setOtpCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCountdown]);

  async function handleSendOtp() {
    if (!emailInput || !emailInput.includes('@')) {
      setOtpNotice('❌ Vui lòng nhập email hợp lệ trước khi lấy mã OTP.');
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
        setOtpNotice('✓ Mã OTP 6 chữ số đã được gửi qua email. Vui lòng kiểm tra hộp thư!');
      } else {
        setOtpNotice(`❌ ${data.detail || data.message || 'Không thể gửi mã OTP. Vui lòng thử lại.'}`);
      }
    } catch (err: any) {
      setOtpNotice(`❌ Lỗi kết nối: ${err.message || String(err)}`);
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
      setOtpNotice('❌ Vui lòng bấm "Gửi mã OTP" và nhập mã xác thực từ email để tạo tài khoản.');
      return;
    }
    void onSubmit(email, password, register, otp);
  }

  return (
    <div className={`quant-app quant-auth quant-${portal}`}>
      {/* Left Column: Visual Brand Story */}
      <div className="quant-auth-story">
        <Brand />
        <div className="space-y-4 my-auto max-w-lg">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-950/40 text-cyan-300 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            DIRECT CLOUD MT5 EXECUTION · ZERO EA
          </div>
          <h1 className="text-3xl sm:text-5xl font-black text-slate-100 tracking-tight leading-tight">
            {title}
          </h1>
          <p className="text-sm text-slate-400 font-normal leading-relaxed">
            Kết nối trực tiếp thuật toán định lượng từ đám mây tới tài khoản MT5 cá nhân của bạn với độ trễ microsecond.
            Bảo vệ nguồn vốn bằng 4 lớp giáp an toàn tuyệt đối và cơ chế Auto Break-Even (1R).
          </p>

          <div className="pt-4 grid grid-cols-2 gap-3 text-xs font-mono">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-slate-500 text-[10px] block">HẠ TẦNG KẾT NỐI</span>
              <span className="font-bold text-cyan-300">MetaApi Direct</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-slate-500 text-[10px] block">ĐỘ TRỄ TRUNG BÌNH</span>
              <span className="font-bold text-emerald-400">~28 ms London</span>
            </div>
          </div>
        </div>

        <div className="text-[11px] text-slate-600 font-mono">
          © 2026 ZUPIRUS Quant Lab · Bảo mật cấp tổ chức
        </div>
      </div>

      {/* Right Column: High-End Auth Card */}
      <div className="quant-auth-stage">
        <div className="quant-auth-box">
          <h2>{register ? 'Tạo Tài Khoản & Xác Thực' : 'Đăng Nhập'}</h2>
          <p>
            {portal === 'admin'
              ? 'Dành riêng cho ban quản trị vận hành hệ thống.'
              : register
              ? 'Xác thực mã OTP qua email để kích hoạt quyền truy cập.'
              : 'Truy cập danh mục đầu tư và tài khoản MT5 của bạn.'}
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
                  placeholder="your.email@example.com"
                  required
                  className="flex-1"
                />
                {register && (
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={otpSending || otpCountdown > 0 || !emailInput}
                    className="rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-mono font-bold text-xs px-3.5 py-2 transition-colors whitespace-nowrap shadow-md shadow-cyan-500/20"
                  >
                    {otpSending
                      ? 'Đang gửi...'
                      : otpCountdown > 0
                      ? `Chờ (${otpCountdown}s)`
                      : otpSent
                      ? 'Gửi lại OTP'
                      : '⚡ Gửi mã OTP'}
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
                  placeholder="Ví dụ: 849201"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  className="mt-1.5 font-mono tracking-widest text-center text-lg font-bold"
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
                placeholder={register ? 'Tối thiểu 8 ký tự' : 'Nhập mật khẩu'}
                required
                className="mt-1.5"
              />
            </div>

            <button className="quant-primary mt-2" disabled={loading}>
              <span>{loading ? 'Đang xử lý…' : register ? 'Xác Nhận OTP & Tạo Tài Khoản' : 'Đăng Nhập'}</span>
              <span>↗</span>
            </button>
          </form>

          {portal === 'user' && (
            <div className="mt-5 text-center">
              <button
                type="button"
                className="text-xs font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
                onClick={() => {
                  setRegister(!register);
                  setOtpNotice(null);
                  setOtpSent(false);
                }}
                disabled={loading}
              >
                {register ? '← Đã có tài khoản? Đăng nhập ngay' : 'Chưa có tài khoản? Đăng ký với mã OTP email ↗'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
