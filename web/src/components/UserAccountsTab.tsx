import React from 'react';

interface UserAccountsTabProps {
  accounts: any[];
  newDemoLogin: string;
  setNewDemoLogin: (v: string) => void;
  newDemoServer: string;
  setNewDemoServer: (v: string) => void;
  handleAddDemoAccount: (e: React.FormEvent) => void;
  handleCreateReplay: () => void;
  handleToggleCopy: (account: any) => void;
  handleCreatePairCode: (aid: string) => void;
  handleRevoke: (aid: string) => void;
  pairCodes: Record<string, string>;
}

export const UserAccountsTab: React.FC<UserAccountsTabProps> = ({
  accounts,
  newDemoLogin,
  setNewDemoLogin,
  newDemoServer,
  setNewDemoServer,
  handleAddDemoAccount,
  handleCreateReplay,
  handleToggleCopy,
  handleCreatePairCode,
  handleRevoke,
  pairCodes,
}) => {
  return (
    <div className="space-y-6">
      {/* Form Add Demo Account & Pair EA */}
      <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
        <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
          <span>Ghép nối EA MT5</span>
          <span className="text-xs font-normal text-slate-400">(Nhận tín hiệu trực tiếp qua WebRequest HTTP)</span>
        </h3>

        <form onSubmit={handleAddDemoAccount} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="mt5-login" className="block text-[11px] font-mono text-slate-400 mb-1">
              Số đăng nhập MT5
            </label>
            <input
              id="mt5-login"
              type="text"
              required
              value={newDemoLogin}
              onChange={(e) => setNewDemoLogin(e.target.value)}
              placeholder="Ví dụ: 61713217"
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
            />
          </div>

          <div>
            <label htmlFor="mt5-server" className="block text-[11px] font-mono text-slate-400 mb-1">
              Máy chủ MT5
            </label>
            <input
              id="mt5-server"
              type="text"
              required
              value={newDemoServer}
              onChange={(e) => setNewDemoServer(e.target.value)}
              placeholder="Nhập máy chủ từ MT5"
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2 text-xs transition-colors"
            >
              Tạo & Sinh Mã Ghép Nối ↗
            </button>
          </div>
        </form>

        {/* Secondary Option: Replay Account */}
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div>
            <span className="text-slate-300 font-semibold">Tùy chọn phụ: Tài khoản phát lại (Replay Mode)</span>
            <p className="text-slate-500 text-[11px] mt-0.5">
              Mô phỏng khớp nến XAUUSD tự động mà không cần kết nối phần mềm MT5 bên ngoài.
            </p>
          </div>
          <button
            id="new-replay"
            type="button"
            onClick={handleCreateReplay}
            className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs text-cyan-300 font-mono transition-colors whitespace-nowrap"
            title="Theo dõi danh mục bằng dữ liệu phát lại"
          >
            + Tạo tài khoản phát lại
          </button>
        </div>
      </div>

      {/* Account List */}
      <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] overflow-hidden">
        <div className="border-b border-slate-800 px-5 py-3 flex items-center justify-between">
          <span className="font-bold text-sm text-slate-200">Danh Sách Tài Khoản Đang Liên Kết</span>
          <span className="text-xs font-mono text-slate-400">{accounts.length} tài khoản</span>
        </div>

        {accounts.length === 0 ? (
          <div className="p-8 text-center text-slate-500 font-mono text-xs">
            Chưa có tài khoản MT5 nào được liên kết.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {accounts.map((a: any) => {
              const code = pairCodes[a.id];
              const isOnline = a.seen && Date.now() / 1000 - a.seen < 30;
              return (
                <div key={a.id} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                      <span className="font-bold font-mono text-sm text-slate-100">
                        #{a.login} · {a.server}
                      </span>
                      <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                        {a.mode}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-mono ${
                          a.enabled ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' : 'bg-rose-950 text-rose-300 border border-rose-700/50'
                        }`}
                      >
                        {a.enabled ? 'ĐANG SAO CHÉP' : 'TẠM DỪNG'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => handleToggleCopy(a)}
                        className={`rounded-lg px-3 py-1 text-xs font-mono font-medium transition-colors ${
                          a.enabled
                            ? 'bg-amber-950/80 text-amber-300 border border-amber-700/40 hover:bg-amber-900/80'
                            : 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/40 hover:bg-emerald-900/80'
                        }`}
                      >
                        {a.enabled ? 'Tạm Dừng Sao Chép' : 'Bật Sao Chép'}
                      </button>

                      <button
                        hidden={a.mode === 'REPLAY'}
                        onClick={() => handleCreatePairCode(a.id)}
                        className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1 text-xs font-mono text-slate-300 transition-colors"
                      >
                        Cấp Mã Ghép Nối
                      </button>

                      <button
                        hidden={a.mode === 'REPLAY'}
                        onClick={() => handleRevoke(a.id)}
                        className="rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 px-3 py-1 text-xs font-mono text-rose-300 transition-colors"
                      >
                        Thu Hồi
                      </button>
                    </div>
                  </div>

                  {/* Metrics details */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono bg-slate-950/40 p-3 rounded-lg border border-slate-800/50">
                    <div>
                      <span className="text-slate-500 text-[10px] block">SỐ DƯ (BALANCE)</span>
                      <span className="font-bold text-slate-200">${Number(a.balance || 0).toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">VỐN (EQUITY)</span>
                      <span className="font-bold text-cyan-300">${Number(a.equity || 0).toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">DRAWDOWN HIỆN TẠI</span>
                      <span className="font-bold text-slate-300">
                        {(((a.peak - a.equity) / Math.max(a.peak, 1)) * 100).toFixed(2)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">HEARTBEAT GẦN NHẤT</span>
                      <span className="text-slate-400">
                        {a.seen ? `${Math.round(Date.now() / 1000 - a.seen)}s trước` : 'Chưa có'}
                      </span>
                    </div>
                  </div>

                  {/* Pairing box if generated */}
                  {code && (
                    <div className="rounded-lg border border-cyan-500/40 bg-cyan-950/20 p-3 text-xs font-mono space-y-1">
                      <div className="text-cyan-300 font-bold flex items-center justify-between">
                        <span>
                          Mã dùng một lần: <code className="break-all">{code}</code>
                        </span>
                        <span className="text-[10px] text-slate-400">Hết hạn sau 5 phút</span>
                      </div>
                      <p className="text-slate-400 text-[11px]">
                        Trong MT5 chart XAUUSD, mở Inputs của EA <code className="text-cyan-200">Zupirus_Copy_EA</code>:
                      </p>
                      <div className="bg-slate-900/80 p-2 rounded text-[11px] text-slate-300 select-all">
                        ApiURL = <span className="text-cyan-300">{window.location.origin}</span>
                        <br />
                        PairingCode = <span className="text-cyan-300">{code}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
