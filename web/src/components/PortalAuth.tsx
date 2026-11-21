import { useState, useEffect, type FormEvent } from 'react';
import type { PortalType } from '../App.tsx';
import { Brand, type Portal } from './PortalChrome.tsx';
import { apiPost } from '../api/client.ts';
import { IconBolt, IconShield, IconReceipt } from './Icons';

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
      const data = await apiPost<any>(endpoint, { email: emailInput });
      if (data?.ok) {
        setOtpSent(true);
        setOtpCountdown(60);
        setOtpNotice('✓ Mã xác thực OTP 6 chữ số đã được gửi tới hộp thư email của bạn.');
      } else {
        setOtpNotice(data?.detail || data?.message || 'Không thể gửi mã OTP. Vui lòng thử lại.');
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
        await apiPost('/api/auth/reset-password', { email, otp_code: resetOtp, new_password: password });
        setForgotMode(false);
        setResetOtp('');
        setPasswordInput('');
        setOtpSent(false);
        setOtpCountdown(0);
        setOtpNotice('✓ Đặt lại mật khẩu thành công! Vui lòng đăng nhập bằng mật khẩu mới.');
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
    <div data-portal={portal} className="min-h-screen bg-[#0B1220] flex flex-col justify-center">
      <div className="w-full min-h-screen grid grid-cols-1 lg:grid-cols-2">
        {/* Left Column (50%): Form Area */}
        <div className="flex flex-col justify-between p-8 sm:p-12 lg:p-16 bg-[#0B1220] border-r border-slate-800/80">
          <div className="flex items-center justify-between">
            <Brand />
            {onClosePreview && (
              <button
                type="button"
                onClick={onClosePreview}
                className="text-xs font-mono text-slate-400 hover:text-white transition"
              >
                ← Quay lại Dashboard
              </button>
            )}
          </div>

          <div className="my-auto py-8 max-w-md w-full mx-auto space-y-6">
            <div>
              <div className="font-mono text-xs font-semibold text-[#12B5A6] uppercase tracking-wider">
                {portal === 'admin' ? 'TRẠM CHỈ HUY QUẢN TRỊ' : 'CỔNG GIAO DỊCH ĐỊNH LƯỢNG'}
              </div>
              <h1 className="mt-1.5 text-2xl sm:text-3xl font-bold text-white tracking-tight">
                {forgotMode
                  ? 'Khôi Phục Mật Khẩu'
                  : register
                  ? 'Đăng Ký Tài Khoản OTP'
                  : 'Đăng Nhập Hệ Thống'}
              </h1>
              <p className="mt-1 text-xs text-[#94A3B8] leading-relaxed">
                {portal === 'admin'
                  ? 'Xác thực phân quyền quản trị viên vận hành hệ thống định lượng.'
                  : forgotMode
                  ? 'Nhập email để nhận mã OTP khôi phục mật khẩu bảo mật.'
                  : register
                  ? 'Xác thực email qua OTP 6 số để kích hoạt không gian quản lý Cloud MT5.'
                  : 'Truy cập danh mục tài khoản MT5, cấu hình rủi ro và sổ lệnh đám mây.'}
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
                  ĐỊA CHỈ EMAIL
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
                  <label htmlFor="auth-otp" className="block text-xs font-medium text-slate-300 mb-1.5">
                    MÃ XÁC THỰC OTP (6 CHỮ SỐ)
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
                    MÃ OTP KHÔI PHỤC (6 CHỮ SỐ)
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
                    {forgotMode ? 'MẬT KHẨU MỚI' : 'MẬT KHẨU'}
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
                  minLength={forgotMode || register ? 8 : undefined}
                  placeholder={forgotMode || register ? 'Tối thiểu 8 ký tự' : 'Nhập mật khẩu'}
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
                    ? 'Đang đặt lại...'
                    : loading
                    ? 'Đang xác thực…'
                    : forgotMode
                    ? 'Xác Nhận Đặt Lại Mật Khẩu'
                    : register
                    ? 'Xác Nhận OTP & Tạo Tài Khoản'
                    : 'Đăng Nhập Vào Hệ Thống'}
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
                    ← Quay lại đăng nhập
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
                      ? '← Đã có tài khoản? Đăng nhập ngay'
                      : 'Chưa có tài khoản? Đăng ký mới với OTP email →'}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="text-xs text-slate-500 font-mono">
            <span>© 2026 ZUPIRUS Quant Lab · Chuẩn Quỹ Định Lượng</span>
          </div>
        </div>

        {/* Right Column (50%): Fintech Trust Panel */}
        <div className="hidden lg:flex flex-col justify-between p-12 lg:p-16 bg-[#10192B] relative overflow-hidden">
          <div className="font-mono text-xs text-slate-400">
            METATRADER 5 CLOUD INTEGRATION
          </div>

          <div className="space-y-8 max-w-lg">
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
                TIÊU CHUẨN AN TOÀN FINTECH
              </span>
              <h2 className="mt-2 text-3xl font-bold text-white tracking-tight leading-snug">
                Hạ tầng định lượng chuẩn tổ chức, bảo vệ nguồn vốn kỷ luật.
              </h2>
              <p className="mt-2 text-sm text-[#94A3B8] leading-relaxed">
                Được thiết kế cho nhà giao dịch cá nhân và quỹ cấp vốn Prop Firm. Loại bỏ hoàn toàn sự cố treo máy VPS và gồng lỗ cảm tính.
              </p>
            </div>

            {/* 3 Cam kết bảo mật có icon mảnh */}
            <div className="space-y-4">
              <div className="flex items-start gap-4 rounded-xl border border-slate-800/80 bg-[#080E1A] p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#10192B]">
                  <IconBolt className="w-4 h-4 text-[#12B5A6]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">100% Zero EA · Zero VPS</div>
                  <div className="mt-0.5 text-xs text-[#94A3B8] leading-relaxed">
                    Đấu nối trực tiếp máy chủ London G2 với độ trễ 24ms, không cần cài đặt phần mềm ngoài vào máy tính.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4 rounded-xl border border-slate-800/80 bg-[#080E1A] p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#10192B]">
                  <IconShield className="w-4 h-4 text-[#12B5A6]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">Mã hóa mật khẩu MT5 AES-256</div>
                  <div className="mt-0.5 text-xs text-[#94A3B8] leading-relaxed">
                    Thông tin đăng nhập giao dịch được mã hóa tầng sâu trước khi lưu trữ, không bao giờ xuất hiện ở dạng thô.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4 rounded-xl border border-slate-800/80 bg-[#080E1A] p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#10192B]">
                  <IconReceipt className="w-4 h-4 text-[#12B5A6]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">Tiền nằm 100% tại sàn của bạn</div>
                  <div className="mt-0.5 text-xs text-[#94A3B8] leading-relaxed">
                    ZUPIRUS không giữ tiền nạp hay ủy thác. Tài sản và lợi nhuận rút nạp trực tiếp qua tài khoản sàn MT5 của bạn.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs font-mono text-slate-500 border-t border-slate-800/80 pt-6">
            <span>MetaApi London G2 Gateway</span>
            <span className="text-[#12B5A6]">4 Lớp Giáp Fail-Closed Armed</span>
          </div>
        </div>
      </div>
    </div>
  );
}
