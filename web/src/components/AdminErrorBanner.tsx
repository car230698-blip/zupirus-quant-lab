import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface AdminErrorInfo {
  status?: number;
  message: string;
}

export interface AdminErrorBannerProps {
  error: AdminErrorInfo | null;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export const AdminErrorBanner: React.FC<AdminErrorBannerProps> = ({
  error,
  onRetry,
  onDismiss,
}) => {
  if (!error) return null;

  const status = error.status;
  const is403 = status === 403 || error.message?.includes('adm.zupirus.com') || error.message?.includes('Use adm.zupirus.com');
  const is401 = status === 401 || error.message?.toLowerCase().includes('phiên') || error.message?.toLowerCase().includes('đăng nhập');

  if (is403) {
    return (
      <div className="rounded-xl border border-rose-500/40 bg-rose-950/35 p-4 sm:p-5 text-rose-200">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <div className="font-mono text-xs font-bold uppercase tracking-wider text-rose-300">
                HTTP 403 — BỊ TỪ CHỐI TRUY CẬP QUẢN TRỊ
              </div>
              <h4 className="text-sm sm:text-base font-bold text-white mt-0.5">
                Phiên hiện tại không có quyền Quản trị viên (Admin Role)
              </h4>
              <p className="mt-1 text-xs text-rose-300/80 leading-relaxed">
                {error.message || 'Vui lòng đăng nhập bằng tài khoản quản trị hợp lệ tại /admin/login.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                window.location.href = '/admin/login';
              }}
              className="flex-1 sm:flex-initial rounded-xl bg-rose-500/90 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 transition cursor-pointer"
            >
              Đăng Nhập Admin
            </button>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="p-2 text-rose-400 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
                title="Đóng cảnh báo"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (is401) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-950/35 p-4 sm:p-5 text-amber-200">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <div className="font-mono text-xs font-bold uppercase tracking-wider text-amber-300">
                PHIÊN ĐĂNG NHẬP ĐÃ HẾT HẠN (HTTP 401)
              </div>
              <h4 className="text-sm sm:text-base font-bold text-white mt-0.5">
                Phiên làm việc quản trị viên đã hết hạn hoặc chưa được xác thực
              </h4>
              <p className="mt-1 text-xs text-amber-300/80 leading-relaxed">
                {error.message || 'Hệ thống yêu cầu xác thực phiên đăng nhập hợp lệ để truy xuất dữ liệu.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                window.location.reload();
              }}
              className="flex-1 sm:flex-initial rounded-xl bg-[#12B5A6] px-4 py-2 text-xs font-bold text-[#042F2E] hover:bg-[#14C9B8] transition cursor-pointer"
            >
              Đăng Nhập Lại
            </button>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="p-2 text-amber-400 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
                title="Đóng cảnh báo"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-rose-500/35 bg-[#10192B] p-4 sm:p-5 text-slate-200 space-y-2">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <div className="font-mono text-xs font-bold uppercase tracking-wider text-rose-400">
              LỖI KẾT NỐI API QUẢN TRỊ {status ? `(HTTP ${status})` : ''}
            </div>
            <div className="text-xs sm:text-sm font-semibold text-white mt-0.5">
              {error.message || 'Không thể đồng bộ dữ liệu quản trị với máy chủ.'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0 w-full sm:w-auto">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex-1 sm:flex-initial rounded-xl border border-slate-700 bg-[#080E1A] px-3.5 py-1.5 text-xs font-bold text-slate-200 hover:text-white hover:border-slate-500 transition cursor-pointer"
            >
              Thử Lại Ngay
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
              title="Đóng cảnh báo"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
