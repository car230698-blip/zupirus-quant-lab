import React, { useState, useEffect, type FormEvent } from 'react';
import { apiPost } from '../../api/client';
import { BrandMark } from '../common/BrandMark';
import { useLanguage } from '../../i18n/LanguageContext';
import { ArrowLeft, BookOpen, Lock, ShieldCheck, KeyRound } from 'lucide-react';

export interface AuthScreenProps {
  mode: 'user' | 'admin';
  loading: boolean;
  error: string | null;
  onSubmit: (email: string, password: string, register: boolean, otp?: string) => Promise<void>;
  onNavigateHome: () => void;
  onSwitchZone?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  mode,
  loading,
  error,
  onSubmit,
  onNavigateHome,
  onSwitchZone,
}) => {
  const { lang } = useLanguage();
  const isAdmin = mode === 'admin';

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
          ? 'Please enter a valid email address before requesting an OTP.'
          : 'Vui lòng nhập email hợp lệ trước khi gửi mã OTP.'
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
            ? 'Verification code sent. Check your inbox (or dev server console).'
            : 'Mã xác thực 6 chữ số đã được gửi tới email của bạn.'
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || emailInput);
    const password = String(form.get('password') || passwordInput);

    if (!isAdmin && forgotMode) {
      if (!resetOtp || resetOtp.length !== 6) {
        setOtpNotice(
          lang === 'en'
            ? 'Please enter the 6-digit OTP code from your email.'
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
            ? 'Password reset successful. Sign in with your new password.'
            : 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.'
        );
      } catch (err: any) {
        setOtpNotice(`${lang === 'en' ? 'Connection error' : 'Lỗi kết nối'}: ${err.message || String(err)}`);
      } finally {
        setResetBusy(false);
      }
      return;
    }

    const otp = !isAdmin && register ? String(form.get('otp') || '') : undefined;
    if (!isAdmin && register && !otp) {
      setOtpNotice(
        lang === 'en'
          ? 'Please request and enter the 6-digit email verification code.'
          : 'Vui lòng bấm gửi mã OTP và nhập mã xác thực 6 chữ số.'
      );
      return;
    }

    void onSubmit(email, password, !isAdmin && register, otp);
  }

  return (
    <div
      data-portal={mode}
      className="min-h-screen bg-[#060A13] text-slate-100 grid grid-cols-1 lg:grid-cols-2"
    >
      {/* Left Form Column */}
      <div className="flex flex-col justify-between p-6 sm:p-10 lg:p-14 border-r border-slate-800/80 bg-[#0B1220]">
        <div className="flex items-center justify-between gap-3">
          <BrandMark
            accent={isAdmin ? 'cyan' : 'teal'}
            subtitle={isAdmin ? 'Admin Console' : 'Customer Portal'}
            onClick={onNavigateHome}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onNavigateHome}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{lang === 'en' ? 'Landing' : 'Trang chủ'}</span>
            </button>
          </div>
        </div>

        <div className="my-auto py-8 max-w-md w-full mx-auto space-y-6">
          <div>
            <div
              className={`font-mono text-xs font-semibold uppercase tracking-wider ${
                isAdmin ? 'text-cyan-400' : 'text-[#12B5A6]'
              }`}
            >
              {isAdmin
                ? lang === 'en'
                  ? 'ADMINISTRATION ACCESS'
                  : 'CỔNG XÁC THỰC QUẢN TRỊ'
                : lang === 'en'
                ? 'CUSTOMER PORTAL'
                : 'CỔNG KHÁCH HÀNG'}
            </div>
            <h1 className="mt-1.5 text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {isAdmin
                ? lang === 'en'
                  ? 'Admin Sign In'
                  : 'Đăng Nhập Quản Trị'
                : forgotMode
                ? lang === 'en'
                  ? 'Reset Password'
                  : 'Khôi Phục Mật Khẩu'
                : register
                ? lang === 'en'
                  ? 'Create Research Account'
                  : 'Đăng Ký Tài Khoản Nghiên Cứu'
                : lang === 'en'
                ? 'Sign In to Customer Portal'
                : 'Đăng Nhập Cổng Khách Hàng'}
            </h1>
            <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
              {isAdmin
                ? lang === 'en'
                  ? 'Restricted workspace for reviewing research inquiries, approving bespoke deliverables, and managing lab operations.'
                  : 'Khu vực bảo mật dành riêng cho quản trị viên xét duyệt yêu cầu, báo giá và bàn giao nghiên cứu định lượng.'
                : forgotMode
                ? lang === 'en'
                  ? 'Enter your registered email to receive a 6-digit password reset code.'
                  : 'Nhập email đã đăng ký để nhận mã OTP đặt lại mật khẩu.'
                : register
                ? lang === 'en'
                  ? 'Verify your email via OTP to request technical analysis notes and bespoke institutional studies.'
                  : 'Xác thực email qua OTP để gửi bài toán nghiên cứu và nhận tài liệu bàn giao.'
                : lang === 'en'
                ? 'Access your quantitative research deliverables, technical analysis notes, and private files.'
                : 'Truy cập kết quả nghiên cứu định lượng, bản phân tích kỹ thuật và hồ sơ của Quý khách.'}
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-3.5 text-xs text-rose-200">
              {error}
            </div>
          )}

          {otpNotice && (
            <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-3.5 text-xs text-cyan-200">
              {otpNotice}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="auth-email" className="block text-xs font-semibold text-slate-300 mb-1.5">
                {lang === 'en' ? 'Email Address' : 'Địa chỉ Email'}
              </label>
              <div className="flex gap-2">
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder={isAdmin ? 'admin@zupirus.local' : 'trader@client.org'}
                  required
                  className="quant-input flex-1"
                />
                {!isAdmin && (register || forgotMode) && (
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={otpSending || otpCountdown > 0 || !emailInput}
                    className="quant-btn-primary px-3.5 text-xs shrink-0"
                  >
                    {otpSending
                      ? lang === 'en'
                        ? 'Sending...'
                        : 'Đang gửi...'
                      : otpCountdown > 0
                      ? `${otpCountdown}s`
                      : otpSent
                      ? lang === 'en'
                        ? 'Resend'
                        : 'Gửi lại'
                      : lang === 'en'
                      ? 'Send OTP'
                      : 'Gửi OTP'}
                  </button>
                )}
              </div>
            </div>

            {!isAdmin && register && (
              <div>
                <label htmlFor="auth-otp" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {lang === 'en' ? '6-Digit OTP Code' : 'Mã xác thực OTP (6 chữ số)'}
                </label>
                <input
                  id="auth-otp"
                  name="otp"
                  type="text"
                  placeholder="849201"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  className="quant-input font-mono tracking-widest text-center text-base font-bold"
                />
              </div>
            )}

            {!isAdmin && forgotMode && (
              <div>
                <label htmlFor="auth-reset-otp" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {lang === 'en' ? 'Recovery OTP Code' : 'Mã OTP khôi phục (6 chữ số)'}
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
                  className="quant-input font-mono tracking-widest text-center text-base font-bold"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="auth-password" className="text-xs font-semibold text-slate-300">
                  {forgotMode
                    ? lang === 'en'
                      ? 'New Password'
                      : 'Mật khẩu mới'
                    : lang === 'en'
                    ? 'Password'
                    : 'Mật khẩu'}
                </label>
                {!isAdmin && !register && !forgotMode && (
                  <button
                    type="button"
                    onClick={() => {
                      setForgotMode(true);
                      setOtpNotice(null);
                      setOtpSent(false);
                      setOtpCountdown(0);
                    }}
                    className="text-xs font-medium text-[#12B5A6] hover:underline cursor-pointer"
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
                    ? lang === 'en'
                      ? 'Minimum 8 characters'
                      : 'Tối thiểu 8 ký tự'
                    : lang === 'en'
                    ? 'Enter your password'
                    : 'Nhập mật khẩu'
                }
                required
                className="quant-input"
              />
            </div>

            <button
              type="submit"
              disabled={loading || resetBusy}
              className="quant-primary mt-2"
            >
              {resetBusy
                ? lang === 'en'
                  ? 'Resetting...'
                  : 'Đang đặt lại...'
                : loading
                ? lang === 'en'
                  ? 'Signing in...'
                  : 'Đang đăng nhập...'
                : forgotMode
                ? lang === 'en'
                  ? 'Confirm Password Reset'
                  : 'Xác nhận đặt lại mật khẩu'
                : !isAdmin && register
                ? lang === 'en'
                  ? 'Verify & Create Account'
                  : 'Xác thực & Tạo tài khoản'
                : lang === 'en'
                ? 'Sign In →'
                : 'Đăng nhập →'}
            </button>
          </form>

          {!isAdmin ? (
            <div className="pt-4 border-t border-slate-800/80 flex flex-col items-center gap-2 text-center">
              {forgotMode ? (
                <button
                  type="button"
                  className="text-xs font-medium text-amber-300 hover:underline cursor-pointer"
                  onClick={() => {
                    setForgotMode(false);
                    setOtpNotice(null);
                    setOtpSent(false);
                  }}
                >
                  {lang === 'en' ? '← Back to Sign In' : '← Quay lại đăng nhập'}
                </button>
              ) : (
                <button
                  type="button"
                  className="text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
                  onClick={() => {
                    setRegister(!register);
                    setOtpNotice(null);
                    setOtpSent(false);
                  }}
                >
                  {register
                    ? lang === 'en'
                      ? 'Already have an account? Sign In'
                      : 'Đã có tài khoản? Đăng nhập ngay'
                    : lang === 'en'
                    ? "Don't have an account? Register with email OTP →"
                    : 'Chưa có tài khoản? Đăng ký mới qua OTP →'}
                </button>
              )}
            </div>
          ) : (
            onSwitchZone && (
              <div className="pt-4 border-t border-slate-800/80 text-center">
                <button
                  type="button"
                  onClick={onSwitchZone}
                  className="text-xs font-mono text-slate-400 hover:text-[#12B5A6] cursor-pointer"
                >
                  {lang === 'en' ? '← Switch to Customer Portal Login' : '← Chuyển sang Đăng nhập Khách hàng'}
                </button>
              </div>
            )
          )}
        </div>

        <div className="text-xs text-slate-500 font-mono">
          © 2026 ZUPIRUS Quant Lab
        </div>
      </div>

      {/* Right Context Panel (Visually distinct between User vs Admin) */}
      <div className="hidden lg:flex flex-col justify-between p-12 lg:p-16 bg-[#060A13] relative overflow-hidden">
        <div className="font-mono text-xs text-slate-400">
          {isAdmin ? 'ADMIN OPERATIONS CONSOLE' : 'ZUPIRUS QUANT LAB'}
        </div>

        <div className="space-y-8 max-w-lg">
          <div>
            <span className={`font-mono text-xs font-semibold uppercase tracking-wider ${isAdmin ? 'text-cyan-400' : 'text-[#12B5A6]'}`}>
              {isAdmin
                ? lang === 'en'
                  ? 'ROLE-BASED ISOLATED WORKSPACE'
                  : 'TRẠM ĐIỀU HÀNH PHÂN QUYỀN ĐỘC LẬP'
                : lang === 'en'
                ? 'INDEPENDENT QUANT PUBLICATIONS'
                : 'ẤN PHẨM NGHIÊN CỨU ĐỘC LẬP'}
            </span>
            <h2 className="mt-2 text-3xl font-bold text-white tracking-tight leading-snug">
              {isAdmin
                ? lang === 'en'
                  ? 'Manage publications, Walk-Forward studies, and USDT settlements.'
                  : 'Xuất bản báo cáo PDF, kiểm duyệt WFO và đối soát đơn hàng USDT.'
                : lang === 'en'
                ? 'Statistical gold studies you can audit and keep as PDFs.'
                : 'Nghiên cứu thống kê XAU/USD để đọc, đối chiếu và lưu giữ dạng PDF.'}
            </h2>
          </div>

          <div className="space-y-3.5">
            {(isAdmin
              ? [
                  {
                    icon: KeyRound,
                    title: lang === 'en' ? 'Strict Admin Role Guard' : 'Kiểm soát phân quyền quản trị',
                    desc: lang === 'en'
                      ? 'Customer accounts are rejected at HTTP 403 and isolated from administrative endpoints.'
                      : 'Tài khoản khách hàng được tách biệt hoàn toàn khỏi khu vực quản trị.',
                  },
                  {
                    icon: ShieldCheck,
                    title: lang === 'en' ? 'Walk-Forward & Publication Gate' : 'Quy trình kiểm định & xuất bản PDF',
                    desc: lang === 'en'
                      ? 'Attach out-of-sample WFO candidates directly to versioned PDF editions before publishing.'
                      : 'Gắn kết quả kiểm định ngoài mẫu vào từng phiên bản báo cáo trước khi mở bán.',
                  },
                  {
                    icon: Lock,
                    title: lang === 'en' ? 'Direct On-Chain Reconciliation' : 'Đối soát thanh toán trực tiếp',
                    desc: lang === 'en'
                      ? 'Manage TRC20/BEP20 receiver wallets and audit user entitlements safely.'
                      : 'Cấu hình ví nhận USDT và cấp quyền tải PDF cho đơn hàng ngoại lệ.',
                  },
                ]
              : [
                  {
                    icon: BookOpen,
                    title: lang === 'en' ? 'Versioned PDF Library' : 'Thư viện PDF theo phiên bản',
                    desc: lang === 'en'
                      ? 'Every purchase unlocks permanent access to the exact PDF edition in your library.'
                      : 'Mỗi đơn hàng mở khóa quyền tải vĩnh viễn đúng phiên bản báo cáo đã mua.',
                  },
                  {
                    icon: ShieldCheck,
                    title: lang === 'en' ? 'No Broker or MT5 Credentials' : 'Không yêu cầu tài khoản sàn hay MT5',
                    desc: lang === 'en'
                      ? 'Pure research delivery on the web. ZUPIRUS never holds trading funds or executes orders.'
                      : 'Chỉ phân phối tài liệu nghiên cứu qua web. Không giữ tiền và không vào lệnh.',
                  },
                  {
                    icon: Lock,
                    title: lang === 'en' ? 'One-Time USDT Payment' : 'Thanh toán USDT một lần',
                    desc: lang === 'en'
                      ? 'Pay per report via BEP20 or TRC20 with automatic on-chain confirmation.'
                      : 'Mua lẻ từng báo cáo qua mạng BEP20 hoặc TRC20 không kèm phí duy trì.',
                  },
                ]
            ).map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-4 rounded-xl border border-slate-800/80 bg-[#0B1220] p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#060A13]">
                  <Icon className={`h-4 w-4 ${isAdmin ? 'text-cyan-400' : 'text-[#12B5A6]'}`} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{title}</div>
                  <div className="mt-0.5 text-xs text-slate-400 leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs font-mono text-slate-500 border-t border-slate-800/80 pt-6">
          <span>ZUPIRUS Quant Lab</span>
          <span>{isAdmin ? 'Admin Console' : 'No Automated Orders'}</span>
        </div>
      </div>
    </div>
  );
};
