import React, { useState } from 'react';
import { apiPost } from '../api/client';
import { IconClose, IconShield } from './Icons';
import { useLanguage } from '../i18n/LanguageContext';

export interface PasswordUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: any | null;
  onSuccess?: () => void;
}

export const PasswordUpdateModal: React.FC<PasswordUpdateModalProps> = ({
  isOpen,
  onClose,
  account,
  onSuccess,
}) => {
  const { lang } = useLanguage();
  const [newPassword, setNewPassword] = useState('');
  const [server, setServer] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  React.useEffect(() => {
    if (account) {
      setServer(account.broker_server || account.mt5_server || '');
      setNewPassword('');
      setMsg(null);
    }
  }, [account]);

  if (!isOpen || !account) return null;

  const accountId = account.account_id || account.id || account.login;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.trim().length < 3) {
      setMsg({
        text: lang === 'en' ? 'Password must be at least 3 characters.' : 'Mật khẩu phải có ít nhất 3 ký tự.',
        error: true,
      });
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const res: any = await apiPost(`/api/v1/accounts/${encodeURIComponent(accountId)}/update-credentials`, {
        password: newPassword.trim(),
        server: server.trim() || undefined,
        login: String(account.mt5_login || account.login || accountId),
      });

      if (res?.connected === true) {
        setMsg({
          text: res.message || (lang === 'en' ? 'Password updated and broker connected successfully! ✓' : 'Đã cập nhật mật khẩu và kết nối sàn thành công! ✓'),
          error: false,
        });
      } else {
        setMsg({
          text: res.message || (lang === 'en' ? 'Password saved. Cloud terminal is attempting to reconnect...' : 'Đã lưu mật khẩu mới. Trạm Cloud đang thử kết nối lại với sàn...'),
          error: false,
        });
      }

      if (onSuccess) {
        onSuccess();
      }

      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      setMsg({
        text: `${lang === 'en' ? 'Update failed' : 'Lỗi cập nhật'}: ${err.message || String(err)}`,
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-4 p-6 rounded-2xl bg-[#0B1221]/95 backdrop-blur-2xl border border-white/[0.1] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <IconShield className="w-5 h-5 text-amber-400" />
            <div>
              <span className="text-[10px] font-sans uppercase tracking-widest text-amber-400 font-semibold">
                {lang === 'en' ? 'SECURITY CREDENTIALS' : 'XÁC THỰC BẢO MẬT MT5'}
              </span>
              <h4 className="font-mono text-base font-bold text-white">
                {lang === 'en' ? 'Update MT5 Master Password' : 'Cập Nhật Mật Khẩu Sàn MT5'}
              </h4>
            </div>
          </div>
          <button
            type="button"
            aria-label={lang === 'en' ? 'Close dialog' : 'Đóng hộp thoại'}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-[#040710] p-3 text-xs space-y-1">
          <div className="text-slate-400 font-mono">
            {lang === 'en' ? 'Target Account: ' : 'Tài khoản: '}
            <strong className="text-white">#{accountId} ({account.account_name || 'MT5'})</strong>
          </div>
          <div className="text-slate-400 font-mono">
            {lang === 'en' ? 'Broker Server: ' : 'Máy chủ sàn: '}
            <strong className="text-cyan-300">{server || 'MT5-Cloud'}</strong>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              {lang === 'en' ? 'New Master Trading Password' : 'Mật khẩu giao dịch mới (Master Password)'}
            </label>
            <input
              type="password"
              required
              autoFocus
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••••••"
              className="quant-input font-mono text-sm"
            />
            <div className="mt-1 text-[11px] text-slate-400">
              {lang === 'en'
                ? 'Your password is encrypted with AES-256 before being sent to the MetaApi Cloud terminal.'
                : 'Mật khẩu được mã hóa chuẩn AES-256 trước khi gửi tới trạm MetaApi Cloud.'}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              {lang === 'en' ? 'Broker Server (Optional override)' : 'Máy chủ sàn (Thay đổi nếu cần)'}
            </label>
            <input
              type="text"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="e.g. Exness-MT5Real"
              className="quant-input font-mono text-sm"
            />
          </div>

          {msg && (
            <div
              className={`rounded-xl border p-3 text-xs ${
                msg.error
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {msg.text}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.08]">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="quant-btn-secondary px-4 py-2 text-xs"
            >
              {lang === 'en' ? 'Cancel' : 'Hủy'}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="quant-btn-primary px-5 py-2 text-xs font-bold"
            >
              {busy
                ? (lang === 'en' ? 'Updating & Verifying...' : 'Đang Cập Nhật & Kiểm Tra...')
                : (lang === 'en' ? 'Save & Reconnect' : 'Lưu & Kết Nối Lại')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
