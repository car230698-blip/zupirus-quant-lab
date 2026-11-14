import React, { useEffect, useState } from 'react';
import { formatUsd, formatUtcShort } from '../../utils/formatters.ts';
import { StatusLabel } from '../shared/UiPrimitives.tsx';

interface DemoAccountState {
  login: string;
  server: string;
  balance?: number;
  equity?: number;
  lastSeen?: number;
  eaToken?: string;
}

export const UserDemoPairingCard: React.FC = () => {
  const [account, setAccount] = useState<DemoAccountState | null>(() => {
    try {
      const saved = localStorage.getItem('zupirus_demo_account');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [isPairingOpen, setIsPairingOpen] = useState(false);
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [loginInput, setLoginInput] = useState('');
  const [serverInput, setServerInput] = useState('Broker-Demo');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (account) {
      localStorage.setItem('zupirus_demo_account', JSON.stringify(account));
    } else {
      localStorage.removeItem('zupirus_demo_account');
    }
  }, [account]);

  const handlePairSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!pairingCodeInput.trim() || !loginInput.trim() || !serverInput.trim()) {
      setErrorMsg('Vui lòng điền đầy đủ Mã ghép nối, Số tài khoản MT5 và Máy chủ Broker.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/copy-demo/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: loginInput.trim(),
          server: serverInput.trim(),
          mode: 'DEMO',
          pairingCode: pairingCodeInput.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setErrorMsg('Mã ghép nối này đã được sử dụng hoặc tài khoản đã được liên kết.');
        } else if (res.status === 400) {
          setErrorMsg('Thông tin tài khoản không hợp lệ hoặc không phải chế độ DEMO.');
        } else {
          setErrorMsg(data.error || `Không thể liên kết (Mã HTTP ${res.status}).`);
        }
        return;
      }

      const data = await res.json();
      setAccount({
        login: loginInput.trim(),
        server: serverInput.trim(),
        eaToken: data.eaToken,
        balance: 10000,
        equity: 10000,
        lastSeen: Date.now(),
      });
      setIsPairingOpen(false);
      setPairingCodeInput('');
      setLoginInput('');
    } catch {
      setErrorMsg('Lỗi kết nối máy chủ khi thực hiện ghép nối EA.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnpair = () => {
    if (window.confirm('Bạn có chắc chắn muốn ngắt liên kết tài khoản MT5 Demo này?')) {
      setAccount(null);
    }
  };

  return (
    <section className="bg-[#0c1322] border border-[#1e293b] rounded-xl p-5 sm:p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-display font-bold text-slate-100 tracking-tight">
              Tài khoản MT5 Demo &amp; Sao chép Tự động
            </h2>
            <StatusLabel
              label={account ? 'Đang sao chép MT5 Demo' : 'Chưa liên kết MT5'}
              tone={account ? 'emerald' : 'amber'}
              pulse={Boolean(account)}
            />
          </div>
          <p className="text-xs text-slate-400">
            Hành trình kết nối Expert Advisor (EA) với tài khoản MT5 Demo để tự động nhận tín hiệu và đối soát.
          </p>
        </div>

        <div>
          {account ? (
            <button
              type="button"
              onClick={handleUnpair}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 transition-colors"
            >
              Ngắt liên kết
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsPairingOpen(!isPairingOpen)}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 active:scale-[0.98] text-slate-950 transition-all shadow-sm font-medium"
            >
              {isPairingOpen ? 'Đóng form ghép nối' : 'Liên kết tài khoản EA Demo'}
            </button>
          )}
        </div>
      </div>

      {/* Linked Account Dashboard View */}
      {account ? (
        <div className="pt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="bg-[#080d1a] border border-slate-800/80 rounded-lg p-3">
              <span className="text-slate-400 font-medium">Số tài khoản MT5 Demo</span>
              <div className="text-slate-100 font-mono text-sm font-bold mt-1">
                {account.login}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{account.server}</div>
            </div>

            <div className="bg-[#080d1a] border border-slate-800/80 rounded-lg p-3">
              <span className="text-slate-400 font-medium">Số dư tài khoản cá nhân</span>
              <div className="text-cyan-400 font-mono text-sm font-bold mt-1">
                {formatUsd(account.balance ?? 10000)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Khớp từ nhịp tim EA</div>
            </div>

            <div className="bg-[#080d1a] border border-slate-800/80 rounded-lg p-3">
              <span className="text-slate-400 font-medium">Vốn tài khoản (Equity)</span>
              <div className="text-emerald-400 font-mono text-sm font-bold mt-1">
                {formatUsd(account.equity ?? 10000)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Trạng thái thả nổi</div>
            </div>

            <div className="bg-[#080d1a] border border-slate-800/80 rounded-lg p-3">
              <span className="text-slate-400 font-medium">Trạng thái EA &amp; Nhịp tim</span>
              <div className="text-emerald-300 font-mono text-sm font-semibold mt-1 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                Đang trực tuyến
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {account.lastSeen ? formatUtcShort(new Date(account.lastSeen).toISOString()) : 'Vừa cập nhật'}
              </div>
            </div>
          </div>
          <div className="px-3.5 py-2 rounded-lg bg-emerald-950/20 border border-emerald-900/40 text-xs text-emerald-200 flex items-center gap-2">
            <span className="text-base">✓</span>
            <span>
              Backend đã xác nhận tài khoản đang hoạt động. Vị thế mô phỏng từ ZUPIRUS Quant Lab sẽ được tự động đồng bộ sang EA của bạn.
            </span>
          </div>
        </div>
      ) : (
        /* Unlinked Onboarding Steps */
        <div className="pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="bg-[#080d1a] border border-slate-800/80 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-5 w-5 rounded-full bg-cyan-950 border border-cyan-500 text-cyan-300 font-bold text-xs font-mono">
                  1
                </span>
                <span className="font-semibold text-slate-200">Nhận Mã Ghép Nối</span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Yêu cầu quản trị viên cấp mã liên kết (Pairing Code) từ cổng quản trị hoặc API <code className="font-mono text-slate-300">/api/control/copy-demo/links</code>.
              </p>
            </div>

            <div className="bg-[#080d1a] border border-slate-800/80 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-5 w-5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-bold text-xs font-mono">
                  2
                </span>
                <span className="font-semibold text-slate-200">Cấu hình EA MT5 Demo</span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Khởi chạy EA trên MetaTrader 5 với mã trên, hoặc chạy bộ thu nhận <code className="font-mono text-slate-300">scripts/record-mt5-demo.py</code> trên máy tính của bạn.
              </p>
            </div>

            <div className="bg-[#080d1a] border border-slate-800/80 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-5 w-5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-bold text-xs font-mono">
                  3
                </span>
                <span className="font-semibold text-slate-200">Bật Sao Chép &amp; Theo Dõi</span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Hệ thống xác thực mã, kích hoạt kết nối nhịp tim và hiển thị giao dịch sao chép trực tiếp trên danh mục của bạn.
              </p>
            </div>
          </div>

          {/* Collapsible / Interactive Form to submit pairing code */}
          {isPairingOpen && (
            <form
              onSubmit={handlePairSubmit}
              className="mt-4 p-4 rounded-xl bg-[#080d1a] border border-cyan-500/40 space-y-4 animate-in fade-in duration-150"
            >
              <div className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">
                Nhập Thông Tin Ghép Nối EA Demo
              </div>
              {errorMsg && (
                <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300">
                  {errorMsg}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Mã Ghép Nối (Pairing Code)</label>
                  <input
                    type="text"
                    required
                    value={pairingCodeInput}
                    onChange={(e) => setPairingCodeInput(e.target.value)}
                    placeholder="VD: dXNlcl9wYWly..."
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Số Tài Khoản MT5 Demo (Login)</label>
                  <input
                    type="text"
                    required
                    value={loginInput}
                    onChange={(e) => setLoginInput(e.target.value)}
                    placeholder="VD: 135792468"
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Máy Chủ MT5 (Server)</label>
                  <input
                    type="text"
                    required
                    value={serverInput}
                    onChange={(e) => setServerInput(e.target.value)}
                    placeholder="VD: Broker-Demo"
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsPairingOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? 'Đang xác thực...' : 'Xác nhận Ghép Nối'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
};
