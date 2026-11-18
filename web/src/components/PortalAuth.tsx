import { useState, useEffect, type FormEvent } from 'react';
import type { PortalType } from '../App.tsx';
import { Brand, type Portal } from './PortalChrome.tsx';
import authTerminalImg from '../assets/images/auth_terminal_sculpture_1794792847915.jpg';

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
