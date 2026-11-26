import React, { useState } from 'react';
import { apiPost } from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { X } from 'lucide-react';

export interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ open, onClose }) => {
  const { lang } = useLanguage();
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd.length < 8) {
      setMsg({
        type: 'err',
        text: lang === 'en' ? 'New password must be at least 8 characters.' : 'Mật khẩu mới phải có tối thiểu 8 ký tự.',
      });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiPost<{ ok?: boolean; detail?: string; message?: string }>('/api/auth/change-password', {
        current_password: curPwd,
        new_password: newPwd,
      });
      if (res?.ok) {
        setMsg({
          type: 'ok',
          text: lang === 'en' ? 'Password updated successfully.' : 'Đổi mật khẩu thành công.',
        });
        setCurPwd('');
        setNewPwd('');
        setTimeout(() => {
          setMsg(null);
          onClose();
        }, 1000);
      } else {
        setMsg({
          type: 'err',
          text: res?.detail || res?.message || (lang === 'en' ? 'Could not update password.' : 'Không thể đổi mật khẩu.'),
        });
      }
    } catch (err: any) {
      setMsg({
        type: 'err',
        text: err?.message || (lang === 'en' ? 'Connection error.' : 'Lỗi kết nối máy chủ.'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0B1220] p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-wider text-[#12B5A6]">
              {lang === 'en' ? 'ACCOUNT SECURITY' : 'BẢO MẬT TÀI KHOẢN'}
            </div>
            <h3 className="mt-0.5 text-base font-bold text-white">
              {lang === 'en' ? 'Change Password' : 'Đổi mật khẩu'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:text-white cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              {lang === 'en' ? 'Current Password' : 'Mật khẩu hiện tại'}
            </label>
            <input
              type="password"
              value={curPwd}
              onChange={(e) => setCurPwd(e.target.value)}
              required
              autoComplete="current-password"
              className="quant-input"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              {lang === 'en' ? 'New Password (min 8 chars)' : 'Mật khẩu mới (tối thiểu 8 ký tự)'}
            </label>
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="quant-input"
            />
          </div>

          {msg && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                msg.type === 'ok'
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                  : 'border-rose-500/35 bg-rose-500/10 text-rose-200'
              }`}
            >
              {msg.text}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={onClose} className="quant-btn-secondary">
              {lang === 'en' ? 'Cancel' : 'Hủy'}
            </button>
            <button type="submit" disabled={busy} className="quant-btn-primary">
              {busy
                ? lang === 'en'
                  ? 'Updating...'
                  : 'Đang lưu...'
                : lang === 'en'
                ? 'Save Password'
                : 'Lưu mật khẩu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
