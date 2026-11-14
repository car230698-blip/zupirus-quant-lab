import React, { useState } from 'react';
import type { UserRole } from '../../quant/types.ts';
import type { HostSurfaceMode } from '../../server/authMiddleware.ts';
import { StatusLabel } from '../shared/UiPrimitives.tsx';

export interface AdminAuthGateProps {
  currentToken: string;
  currentRole: UserRole | null;
  hostSurface: HostSurfaceMode;
  effectiveHostname: string;
  localDevTokensEnabled: boolean;
  errorMessageVi?: string | null;
  onSubmitToken: (token: string) => void;
}

export const AdminAuthGate: React.FC<AdminAuthGateProps> = ({
  currentToken,
  currentRole,
  hostSurface,
  effectiveHostname,
  localDevTokensEnabled,
  errorMessageVi,
  onSubmitToken,
}) => {
  const [inputToken, setInputToken] = useState<string>(currentToken);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitToken(inputToken.trim());
  };

  return (
    <div className="max-w-lg mx-auto my-10 bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-5">
      <div className="space-y-1.5 border-b border-slate-800 pb-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-mono text-cyan-300">{effectiveHostname}</span>
          <StatusLabel
            label={
              hostSurface === 'ADMIN_HOST'
                ? 'Cổng Quản trị (adm.zupirus.com)'
                : 'Xác thực Quyền Truy cập API'
            }
            tone="cyan"
          />
        </div>
        <h2 className="text-lg font-display font-semibold text-slate-100">
          Đăng nhập Bảng Quản trị &amp; Giám sát Định lượng
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          Phân quyền thực tế do máy chủ quyết định qua Bearer Token (
          <code className="text-slate-200 font-mono">ADMIN</code> hoặc{' '}
          <code className="text-slate-200 font-mono">VIEWER</code>). Mọi thao tác điều
          khiển đều được kiểm tra quyền tại backend.
        </p>
      </div>

      {errorMessageVi && (
        <div
          role="alert"
          className="px-3.5 py-2.5 rounded bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200"
        >
          {errorMessageVi}
        </div>
      )}

      {currentRole && (
        <div className="px-3.5 py-2 rounded bg-slate-950 border border-slate-800 text-xs flex items-center justify-between">
          <span className="text-slate-400">Quyền hiện tại do máy chủ xác nhận:</span>
          <StatusLabel
            label={`Vai trò: ${currentRole}`}
            tone={currentRole === 'ADMIN' ? 'emerald' : 'cyan'}
            mono
          />
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label
            htmlFor="bearer-token-input"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Mã xác thực Bearer Token
          </label>
          <input
            id="bearer-token-input"
            type="password"
            value={inputToken}
            onChange={(e) => setInputToken(e.target.value)}
            placeholder="Nhập ADMIN_AUTH_TOKEN hoặc VIEWER_AUTH_TOKEN..."
            className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="submit"
            className="px-4 py-2 text-xs font-medium rounded-md bg-cyan-500 hover:bg-cyan-400 active:scale-[0.98] text-slate-950 font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 whitespace-nowrap shrink-0"
          >
            Xác thực với Máy chủ
          </button>
          {currentToken && (
            <button
              type="button"
              onClick={() => {
                setInputToken('');
                onSubmitToken('');
              }}
              className="px-3 py-2 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0"
            >
              Xoá Token đã lưu
            </button>
          )}
        </div>
      </form>

      {localDevTokensEnabled && (
        <div className="pt-3 border-t border-slate-800 space-y-2">
          <div className="text-xs text-slate-400">
            Chế độ nghiệm thu Localhost (chuyển nhanh token để backend phân quyền):
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setInputToken('local-admin-token');
                onSubmitToken('local-admin-token');
              }}
              className="px-3 py-1.5 text-xs font-mono rounded border border-emerald-500/40 bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0"
            >
              Dùng quyền ADMIN (local-admin-token)
            </button>
            <button
              type="button"
              onClick={() => {
                setInputToken('local-viewer-token');
                onSubmitToken('local-viewer-token');
              }}
              className="px-3 py-1.5 text-xs font-mono rounded border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0"
            >
              Dùng quyền VIEWER (local-viewer-token)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
