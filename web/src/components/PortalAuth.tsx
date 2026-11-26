import { useState, useEffect, type FormEvent } from 'react';
import type { PortalType } from '../App.tsx';
import { Brand, type Portal } from './PortalChrome.tsx';
import { apiPost } from '../api/client.ts';
import { IconBolt, IconShield, IconReceipt } from './Icons';
import { useLanguage } from '../i18n/LanguageContext.tsx';

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
  const { lang } = useLanguage();

  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = setInterval(() => {
      setOtpCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCountdown]);

  async function handleSendOtp() {
    if (!emailInput || !emailInput.includes('@')) {
      setOtpNotice(
        lang === 'en'
          ? 'Please enter a valid email address before requesting an OTP code.'
          : 'Vui lòng nhập địa chỉ email hợp lệ trước khi yêu cầu mã OTP.'
      );
      return;
    }
    setOtpSending(true);
    setOtpNotice(null);
    try {
      const endpoint = forgotMode ? '/api/auth/forgot-password' : '/api/auth/send-otp';
      const data = await apiPost<any>(endpoint, { email: emailInput });
      if (data?.ok && data?.delivery?.ok !== false) {
        setOtpSent(true);
        setOtpCountdown(60);
        setOtpNotice(
          lang === 'en'
            ? '✓ A 6-digit verification code has been dispatched to your email.'
            : '✓ Mã xác thực OTP 6 chữ số đã được gửi tới hộp thư email của bạn.'
        );
      } else {
        setOtpNotice(
          data?.delivery?.error ||
          data?.detail ||
          data?.message ||
          (lang === 'en' ? 'Unable to send OTP. Please try again.' : 'Không thể gửi mã OTP. Vui lòng thử lại.')
        );
      }
    } catch (err: any) {
      setOtpNotice(`${lang === 'en' ? 'Connection error' : 'Lỗi kết nối'}: ${err.message || String(err)}`);
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
        setOtpNotice(
          lang === 'en'
            ? 'Please enter the complete 6-digit OTP code sent to your email.'
            : 'Vui lòng nhập đủ mã OTP 6 chữ số gửi về email.'
        );
        return;
      }
      setResetBusy(true);
      setOtpNotice(null);
      try {
        await apiPost('/api/auth/reset-password', { email, otp_code: resetOtp, new_password: password });
        setForgotMode(false);
        setResetOtp('');
        setPasswordInput('');
        setOtpSent(false);
        setOtpCountdown(0);
        setOtpNotice(
          lang === 'en'
            ? '✓ Password reset successful! Please sign in with your new password.'
            : '✓ Đặt lại mật khẩu thành công! Vui lòng đăng nhập bằng mật khẩu mới.'
        );
      } catch (err: any) {
        setOtpNotice(`${lang === 'en' ? 'Connection error' : 'Lỗi kết nối'}: ${err.message || String(err)}`);
      } finally {
        setResetBusy(false);
      }
      return;
    }

    const otp = register ? String(data.get('otp') || '') : undefined;

    if (register && !otp) {
      setOtpNotice(
        lang === 'en'
          ? 'Please click "Send OTP Code" and enter the 6-digit verification code from your email to create an account.'
          : 'Vui lòng bấm "Gửi mã OTP" và nhập mã xác thực 6 số từ email để tạo tài khoản.'
      );
      return;
    }

    void onSubmit(email, password, register, otp);
  }

  return (
    <div data-portal={portal} className="min-h-screen bg-[#0B1220] flex flex-col justify-center">
      <div className="w-full min-h-screen grid grid-cols-1 lg:grid-cols-2">
        {/* Left Column (50%): Form Area */}
        <div className="flex flex-col justify-between p-8 sm:p-12 lg:p-16 bg-[#0B1220] border-r border-slate-800/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Brand />
            </div>
            {onClosePreview && (
              <button
                type="button"
                onClick={onClosePreview}
                className="text-xs font-mono text-slate-400 hover:text-white transition"
              >
                {lang === 'en' ? '← Back to Dashboard' : '← Quay lại Dashboard'}
              </button>
            )}
          </div>

          <div className="my-auto py-8 max-w-md w-full mx-auto space-y-6">
            <div>
              <div className="font-mono text-xs font-semibold text-[#12B5A6] uppercase tracking-wider">
                {portal === 'admin'
                  ? (lang === 'en' ? 'ADMIN COMMAND RADAR' : 'TRẠM CHỈ HUY QUẢN TRỊ')
                  : (lang === 'en' ? 'QUANT TRADING PORTAL' : 'CỔNG GIAO DỊCH ĐỊNH LƯỢNG')}
              </div>
              <h1 className="mt-1.5 text-2xl sm:text-3xl font-bold text-white tracking-tight">
                {forgotMode
                  ? (lang === 'en' ? 'Reset Password' : 'Khôi Phục Mật Khẩu')
                  : register
                  ? (lang === 'en' ? 'Create Account (OTP)' : 'Đăng Ký Tài Khoản OTP')
                  : (lang === 'en' ? 'Sign In to Terminal' : 'Đăng Nhập Hệ Thống')}
              </h1>
              <p className="mt-1 text-xs text-[#94A3B8] leading-relaxed">
                {portal === 'admin'
                  ? (lang === 'en'
                      ? 'Authenticate administrative credentials for quant infrastructure operations.'
                      : 'Xác thực phân quyền quản trị viên vận hành hệ thống định lượng.')
                  : forgotMode
                  ? (lang === 'en'
                      ? 'Enter your registered email to receive a secure recovery code.'
                      : 'Nhập email để nhận mã OTP khôi phục mật khẩu bảo mật.')
                  : register
                  ? (lang === 'en'
                      ? 'Verify email via a 6-digit code to open your PDF library.'
                      : 'Xác thực email qua mã 6 số để mở thư viện PDF.')
                  : (lang === 'en'
                      ? 'Access MT5 terminal portfolio, risk configuration, and cloud execution ledger.'
                      : 'Truy cập danh mục tài khoản MT5, cấu hình rủi ro và sổ lệnh đám mây.')}
              </p>
            </div>

            {error && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300">
                {error}
              </div>
            )}
            {otpNotice && (
              <div
                className={`rounded-xl border p-3.5 text-xs ${
                  otpNotice.startsWith('✓')
                    ? 'border-[#12B5A6]/40 bg-[#12B5A6]/10 text-[#12B5A6]'
                    : 'border-slate-700 bg-slate-900/80 text-slate-300'
                }`}
              >
                {otpNotice}
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="auth-email" className="block text-xs font-medium text-slate-300 mb-1.5">
                  {lang === 'en' ? 'EMAIL ADDRESS' : 'ĐỊA CHỈ EMAIL'}
                </label>
                <div className="flex gap-2">
                  <input
                    id="auth-email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="trader@domain.com"
                    required
                    className="flex-1 h-11 rounded-xl border border-slate-800 bg-[#10192B] px-3.5 text-sm text-white placeholder-slate-500 focus:border-[#12B5A6] focus:outline-none"
                  />
                  {(register || forgotMode) && (
                    <button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={otpSending || otpCountdown > 0 || !emailInput}
                      className="h-11 rounded-xl bg-[#12B5A6] hover:bg-[#14C9B8] disabled:opacity-50 text-[#042F2E] font-bold text-xs px-4 transition cursor-pointer whitespace-nowrap"
                    >
                      {otpSending
                        ? (lang === 'en' ? 'Sending...' : 'Đang gửi...')
                        : otpCountdown > 0
                        ? (lang === 'en' ? `Wait (${otpCountdown}s)` : `Chờ (${otpCountdown}s)`)
                        : otpSent
                        ? (lang === 'en' ? 'Resend OTP' : 'Gửi lại OTP')
                        : (lang === 'en' ? 'Send OTP Code' : 'Gửi mã OTP')}
                    </button>
                  )}
                </div>
              </div>

              {register && (
                <div>
                  <label htmlFor="auth-otp" className="block text-xs font-medium text-slate-300 mb-1.5">
                    {lang === 'en' ? 'OTP VERIFICATION CODE (6 DIGITS)' : 'MÃ XÁC THỰC OTP (6 CHỮ SỐ)'}
                  </label>
                  <input
                    id="auth-otp"
                    name="otp"
                    type="text"
                    placeholder="849201"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    className="h-11 w-full rounded-xl border border-slate-800 bg-[#10192B] px-3.5 font-mono tracking-widest text-center text-lg font-bold tabular-nums text-white focus:border-[#12B5A6] focus:outline-none"
                  />
                </div>
              )}

              {forgotMode && (
                <div>
                  <label htmlFor="auth-reset-otp" className="block text-xs font-medium text-slate-300 mb-1.5">
                    {lang === 'en' ? 'RECOVERY OTP CODE (6 DIGITS)' : 'MÃ OTP KHÔI PHỤC (6 CHỮ SỐ)'}
                  </label>
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
                    className="h-11 w-full rounded-xl border border-slate-800 bg-[#10192B] px-3.5 font-mono tracking-widest text-center text-lg font-bold tabular-nums text-white focus:border-[#12B5A6] focus:outline-none"
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="auth-password" className="text-xs font-medium text-slate-300">
                    {forgotMode
                      ? (lang === 'en' ? 'NEW PASSWORD' : 'MẬT KHẨU MỚI')
                      : (lang === 'en' ? 'PASSWORD' : 'MẬT KHẨU')}
                  </label>
                  {portal === 'user' && !register && !forgotMode && (
                    <button
                      type="button"
                      onClick={() => {
                        setForgotMode(true);
                        setOtpNotice(null);
                        setOtpSent(false);
                        setOtpCountdown(0);
                      }}
                      className="text-[11px] font-mono text-[#12B5A6] hover:underline cursor-pointer"
                    >
                      {lang === 'en' ? 'Forgot password?' : 'Quên mật khẩu?'}
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
                  minLength={forgotMode || register ? 8 : undefined}
                  placeholder={
                    forgotMode || register
                      ? (lang === 'en' ? 'Minimum 8 characters' : 'Tối thiểu 8 ký tự')
                      : (lang === 'en' ? 'Enter password' : 'Nhập mật khẩu')
                  }
                  required
                  className="h-11 w-full rounded-xl border border-slate-800 bg-[#10192B] px-3.5 text-sm text-white placeholder-slate-500 focus:border-[#12B5A6] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading || resetBusy}
                className="w-full h-11 rounded-xl bg-[#12B5A6] hover:bg-[#14C9B8] disabled:opacity-50 text-[#042F2E] font-bold text-sm transition cursor-pointer flex items-center justify-center gap-2 mt-2"
              >
                <span>
                  {resetBusy
                    ? (lang === 'en' ? 'Resetting...' : 'Đang đặt lại...')
                    : loading
                    ? (lang === 'en' ? 'Authenticating…' : 'Đang xác thực…')
                    : forgotMode
                    ? (lang === 'en' ? 'Confirm Password Reset' : 'Xác Nhận Đặt Lại Mật Khẩu')
                    : register
                    ? (lang === 'en' ? 'Verify OTP & Create Account' : 'Xác Nhận OTP & Tạo Tài Khoản')
                    : (lang === 'en' ? 'Sign In to Terminal' : 'Đăng Nhập Vào Hệ Thống')}
                </span>
                <span>→</span>
              </button>
            </form>

            {portal === 'user' && (
              <div className="pt-4 border-t border-slate-800/80 text-center space-y-2">
                {forgotMode ? (
                  <button
                    type="button"
                    className="text-xs font-mono text-[#F5B700] hover:underline cursor-pointer"
                    onClick={() => {
                      setForgotMode(false);
                      setOtpNotice(null);
                      setOtpSent(false);
                    }}
                    disabled={resetBusy}
                  >
                    {lang === 'en' ? '← Back to Sign In' : '← Quay lại đăng nhập'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-xs font-mono text-slate-300 hover:text-white transition cursor-pointer"
                    onClick={() => {
                      setRegister(!register);
                      setOtpNotice(null);
                      setOtpSent(false);
                    }}
                    disabled={loading}
                  >
                    {register
                      ? (lang === 'en' ? '← Already have an account? Sign In' : '← Đã có tài khoản? Đăng nhập ngay')
                      : (lang === 'en' ? "Don't have an account? Register with OTP email →" : 'Chưa có tài khoản? Đăng ký mới với OTP email →')}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="text-xs text-slate-500 font-mono">
            <span>
              {lang === 'en'
                ? '© 2026 ZUPIRUS Quant Lab · Institutional Quant Standards'
                : '© 2026 ZUPIRUS Quant Lab · Chuẩn Quỹ Định Lượng'}
            </span>
          </div>
        </div>

        {/* Right Column (50%): Fintech Trust Panel */}
        <div className="hidden lg:flex flex-col justify-between p-12 lg:p-16 bg-[#10192B] relative overflow-hidden">
          <div className="font-mono text-xs text-slate-400">
            PDF RESEARCH LIBRARY
          </div>

          <div className="space-y-8 max-w-lg">
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
                {lang === 'en' ? 'FINTECH SECURITY STANDARDS' : 'TIÊU CHUẨN AN TOÀN FINTECH'}
              </span>
              <h2 className="mt-2 text-3xl font-bold text-white tracking-tight leading-snug">
                {lang === 'en'
                  ? 'Statistical studies you can read, recompute, and keep as PDFs.'
                  : 'Nghiên cứu thống kê để đọc, tính lại, và giữ dưới dạng PDF.'}
              </h2>
              <p className="mt-2 text-sm text-[#94A3B8] leading-relaxed">
                {lang === 'en'
                  ? 'Educational notes on gold, forex, and indices. No automated orders and no profit promise.'
                  : 'Tài liệu giáo dục về vàng, ngoại hối và chỉ số. Không có lệnh tự động và không cam kết lợi nhuận.'}
              </p>
            </div>

            {/* 3 Cam kết bảo mật có icon mảnh */}
            <div className="space-y-4">
              <div className="flex items-start gap-4 rounded-xl border border-slate-800/80 bg-[#080E1A] p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#10192B]">
                  <IconBolt className="w-4 h-4 text-[#12B5A6]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">
                    {lang === 'en' ? 'A document, not a terminal' : 'Là tài liệu, không phải phần mềm vào lệnh'}
                  </div>
                  <div className="mt-0.5 text-xs text-[#94A3B8] leading-relaxed">
                    {lang === 'en'
                      ? 'You browse a library, read a free preview, and download the PDF you bought.'
                      : 'Bạn xem thư viện, đọc bản xem thử, và tải PDF đã mua.'}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4 rounded-xl border border-slate-800/80 bg-[#080E1A] p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#10192B]">
                  <IconShield className="w-4 h-4 text-[#12B5A6]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">
                    {lang === 'en' ? 'Account password hashing' : 'Mật khẩu tài khoản được băm'}
                  </div>
                  <div className="mt-0.5 text-xs text-[#94A3B8] leading-relaxed">
                    {lang === 'en'
                      ? 'Trade credentials are encrypted at rest with deep AES-256 HSM keys. Never stored in plaintext.'
                      : 'Thông tin đăng nhập giao dịch được mã hóa tầng sâu trước khi lưu trữ, không bao giờ xuất hiện ở dạng thô.'}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4 rounded-xl border border-slate-800/80 bg-[#080E1A] p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#10192B]">
                  <IconReceipt className="w-4 h-4 text-[#12B5A6]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">
                    {lang === 'en' ? '100% Direct Broker Custody' : 'Tiền nằm 100% tại sàn của bạn'}
                  </div>
                  <div className="mt-0.5 text-xs text-[#94A3B8] leading-relaxed">
                    {lang === 'en'
                      ? 'ZUPIRUS does not take fund custody or manage pooled assets. Deposits and withdrawals occur directly at your broker.'
                      : 'ZUPIRUS không giữ tiền nạp hay ủy thác. Tài sản và lợi nhuận rút nạp trực tiếp qua tài khoản sàn MT5 của bạn.'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs font-mono text-slate-500 border-t border-slate-800/80 pt-6">
            <span>MetaApi London G2 Gateway</span>
            <span className="text-[#12B5A6]">
              {lang === 'en' ? '4 Fail-Closed Shield Layers Armed' : '4 Lớp Giáp Fail-Closed Armed'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
