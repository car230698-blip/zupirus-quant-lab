import { useState, useEffect, type FormEvent, type ReactNode } from 'react';
import { LiveTopTelemetryBar } from './LiveTopTelemetryBar.tsx';

export type Portal = 'user' | 'admin';

const navigation = {
  user: [
    ['overview', 'Tổng quan', '◫'], ['accounts', 'Tài khoản MT5', '⌁'],
    ['orders', 'Lịch sử lệnh', '≡'], ['assistant', 'Trợ lý AI', '✦'],
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
  user: { overview: 'Tổng quan danh mục', accounts: 'Tài khoản MT5', orders: 'Lịch sử lệnh', assistant: 'Trợ lý định lượng' },
  admin: {
    overview: 'Tổng Quan Điều Hành (Executive Overview)',
    billing: 'Cấu Hình Thanh Toán SePay & Quản Lý Tỷ Giá',
    sources: 'Nguồn Tín Hiệu, Phễu Cào & Kho Kỹ Năng AI Agent',
    orders: 'Quản Lý Đơn Hàng & Kích Hoạt Gói Cước',
    infrastructure: 'Quản Trị Hạ Tầng Cloud MT5 & Kết Nối MetaApi',
    risk_users: 'Lá Chắn Rủi Ro Toàn Hệ Thống & Quản Trị Người Dùng',
  },
};

function Brand() {
  return <div className="quant-brand"><span className="quant-mark" aria-hidden="true">Z</span><span>ZUPIRUS<small>QUANT LAB</small></span></div>;
}

export function PortalShell({ portal, page, onNavigate, email, switchPortal, logout, children }: {
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
      <div className="quant-sidebar">
        <Brand />
        <div className="quant-workspace">{portal === 'admin' ? 'VẬN HÀNH' : 'KHÔNG GIAN GIAO DỊCH'}</div>
        <nav className="quant-nav" aria-label="Menu chính">
          {navigation[portal].map(([key, label, glyph]) => (
            <button className="quant-nav-button" key={key} onClick={() => onNavigate(key)} aria-current={page === key ? 'page' : undefined}>
              <span aria-hidden="true">{glyph}</span>{label}
            </button>
          ))}
        </nav>
        <div className="quant-sidebar-end"><span aria-hidden="true">↘</span> XAU/USD <small>·</small> MT5</div>
      </div>
      <div className="quant-stage">
        {portal === 'admin' && <LiveTopTelemetryBar />}
        <div className="quant-topbar">
          <span className="quant-context">{portal === 'admin' ? 'Quản trị' : 'Danh mục'} <span aria-hidden="true">/</span> {navigation[portal].find(([key]) => key === page)?.[1]}</span>
          <div className="quant-session">
            {switchPortal && <button className="quant-quiet" onClick={switchPortal}>{portal === 'admin' ? 'Cổng người dùng' : 'Cổng quản trị'}</button>}
            <span className="quant-email" title={email}>{email}</span>
            <button className="quant-quiet" onClick={logout}>Đăng xuất</button>
          </div>
        </div>
        <main className="quant-content">
          <div className="quant-heading"><h1>{pageTitles[portal][page]}</h1></div>
          {children}
        </main>
      </div>
    </div>
  );
}

export function PortalAuth({ portal, loading, error, onSubmit }: {
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

  const title = portal === 'admin' ? 'Điều hành hệ thống' : 'Không gian giao dịch';

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
        setOtpNotice('✓ Mã OTP gồm 6 chữ số đã được gửi qua email. Vui lòng kiểm tra hộp thư!');
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
      <div className="quant-auth-story">
        <Brand />
        <div className="quant-auth-art" aria-hidden="true">
          <div className="quant-orbit" /><div className="quant-orbit quant-orbit-inner" /><div className="quant-core"><span /><span /><span /></div>
        </div>
        <div className="quant-auth-title"><span>{portal === 'admin' ? 'VẬN HÀNH' : 'XAU/USD · MT5'}</span><h1>{title}</h1></div>
      </div>
      <div className="quant-auth-stage">
        <div className="quant-auth-box">
          <h2>{register ? 'Tạo tài khoản & Xác thực Email' : 'Đăng nhập'}</h2>
          <p>{portal === 'admin' ? 'Dành cho tài khoản có quyền quản trị.' : register ? 'Xác thực OTP qua email để kích hoạt quyền truy cập.' : 'Truy cập danh mục và các tài khoản MT5 của bạn.'}</p>
          {error && <div className="quant-alert" role="alert">{error}</div>}
          {otpNotice && (
            <div className={`quant-alert ${otpNotice.startsWith('✓') ? 'border-emerald-500/50 bg-emerald-950/40 text-emerald-300' : ''}`} role="alert">
              {otpNotice}
            </div>
          )}
          <form onSubmit={submit}>
            <label htmlFor="auth-email">Email</label>
            <div className="flex gap-2">
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
                  className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-mono text-xs px-3 py-2 transition-colors whitespace-nowrap shadow"
                >
                  {otpSending ? 'Đang gửi...' : otpCountdown > 0 ? `Gửi lại (${otpCountdown}s)` : otpSent ? 'Gửi lại OTP' : '⚡ Gửi mã OTP'}
                </button>
              )}
            </div>

            {register && (
              <>
                <label htmlFor="auth-otp">Mã xác thực OTP (6 chữ số gửi qua email)</label>
                <input
                  id="auth-otp"
                  name="otp"
                  type="text"
                  placeholder="Ví dụ: 849201"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  className="font-mono tracking-widest text-base"
                />
              </>
            )}

            <label htmlFor="auth-password">Mật khẩu</label>
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              minLength={register ? 12 : undefined}
              placeholder={register ? 'Tối thiểu 12 ký tự' : 'Mật khẩu của bạn'}
              required
            />

            <button className="quant-primary" disabled={loading}>
              {loading ? 'Đang xử lý…' : register ? 'Xác nhận OTP & Tạo tài khoản' : 'Đăng nhập'}{' '}
              <span aria-hidden="true">↗</span>
            </button>
          </form>
          {portal === 'user' && (
            <button
              className="quant-quiet"
              onClick={() => {
                setRegister(!register);
                setOtpNotice(null);
                setOtpSent(false);
              }}
              disabled={loading}
            >
              {register ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký với OTP'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
