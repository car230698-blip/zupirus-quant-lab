import React, { useEffect, useState } from 'react';

interface TrackRecordPayload {
  verified: boolean;
  summary: {
    total_trades: number;
    wins: number;
    losses: number;
    win_rate_pct: number;
    profit_factor: number;
    net_pnl_usd: number;
    roi_pct: number;
    max_dd_pct: number;
    funded_live_accounts: number;
    total_live_equity_usd: number;
  };
  equity_curve: Array<{ idx: number; ts: number; cum_pnl: number }>;
  recent_trades: Array<{
    symbol: string;
    action: string;
    volume: number;
    entry_price: number;
    profit: number;
    latency_ms: number;
    tier: string;
    closed_at: number;
  }>;
}

export const PublicTrackRecordSection: React.FC<{ onEnterPortal: () => void }> = ({ onEnterPortal }) => {
  const [data, setData] = useState<TrackRecordPayload | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/public/track-record')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d?.summary) setData(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!data || data.summary.total_trades === 0) return null;

  const { summary, equity_curve, recent_trades } = data;
  const vals = equity_curve.map((p) => p.cum_pnl);
  const minV = Math.min(...vals, 0);
  const maxV = Math.max(...vals, 1);
  const span = maxV - minV || 1;
  const polyPoints = equity_curve
    .map((p, idx) => {
      const x = 16 + (idx / Math.max(equity_curve.length - 1, 1)) * 568;
      const y = 148 - ((p.cum_pnl - minV) / span) * 126;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <section id="track-record" className="quant-panel p-6 sm:p-8 space-y-6 border-emerald-500/25">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            VERIFIED LIVE TRACK RECORD · ẨN DANH 100%
          </span>
          <h2 className="mt-1 font-display text-2xl sm:text-3xl font-extrabold text-white">
            Hiệu Suất Thực Tế Đã Kiểm Chứng (XAU/USD)
          </h2>
        </div>
        <button
          type="button"
          onClick={onEnterPortal}
          className="quant-btn-primary px-4 py-2 text-xs whitespace-nowrap shrink-0"
        >
          Kết Nối Tài Khoản Ngay →
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 font-mono tabular-nums">
        <div className="rounded-xl border border-emerald-500/25 bg-[#040814] p-3.5">
          <div className="text-[10px] text-slate-400">LỢI NHUẬN RÒNG</div>
          <div className="mt-1 text-lg font-extrabold text-emerald-400">
            +${summary.net_pnl_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#040814] p-3.5">
          <div className="text-[10px] text-slate-400">TỶ LỆ THẮNG (WR)</div>
          <div className="mt-1 text-lg font-extrabold text-white">{summary.win_rate_pct}%</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#040814] p-3.5">
          <div className="text-[10px] text-slate-400">PROFIT FACTOR</div>
          <div className="mt-1 text-lg font-extrabold text-amber-300">{summary.profit_factor.toFixed(2)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#040814] p-3.5">
          <div className="text-[10px] text-slate-400">TỔNG LỆNH ĐÓNG</div>
          <div className="mt-1 text-lg font-extrabold text-cyan-300">
            {summary.total_trades}{' '}
            <span className="text-xs font-normal text-slate-400">({summary.wins}W/{summary.losses}L)</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#040814] p-3.5">
          <div className="text-[10px] text-slate-400">MAX DRAWDOWN</div>
          <div className="mt-1 text-lg font-extrabold text-emerald-300">{summary.max_dd_pct}%</div>
        </div>
        <div className="rounded-xl border border-amber-500/25 bg-[#040814] p-3.5">
          <div className="text-[10px] text-slate-400">VỐN QUỸ LIVE</div>
          <div className="mt-1 text-lg font-extrabold text-amber-300">
            ${Math.round(summary.total_live_equity_usd).toLocaleString('en-US')}
          </div>
        </div>
      </div>

      {/* Curve + Recent Verified Trades */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-6 rounded-xl border border-white/10 bg-[#040710]/90 p-4 space-y-2">
          <div className="flex items-center justify-between font-mono text-xs">
            <span className="text-slate-300 font-bold">Đường Cong Lợi Nhuận Tích Lũy (USD)</span>
            <span className="text-emerald-400 font-bold">+{summary.roi_pct}% ROI</span>
          </div>
          <svg viewBox="0 0 600 165" className="w-full h-44 select-none">
            <defs>
              <linearGradient id="tr-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            {polyPoints && (
              <>
                <polygon points={`16,148 ${polyPoints} 584,148`} fill="url(#tr-fill)" />
                <polyline fill="none" stroke="#10b981" strokeWidth="2.4" points={polyPoints} />
              </>
            )}
          </svg>
        </div>

        <div className="lg:col-span-6 rounded-xl border border-white/10 bg-[#040710]/90 p-4 space-y-2">
          <div className="font-mono text-xs font-bold text-slate-300">Lệnh XAU/USD Xác Thực Gần Nhất</div>
          <div className="max-h-44 overflow-y-auto space-y-1.5 font-mono text-xs tabular-nums">
            {recent_trades.slice(0, 8).map((t, i) => {
              const win = t.profit >= 0;
              return (
                <div
                  key={`${t.closed_at}-${i}`}
                  className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#071022] px-3 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className={t.action === 'BUY' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                      {t.action}
                    </span>
                    <span className="text-white">{t.symbol}</span>
                    <span className="text-slate-400">{t.volume.toFixed(2)} lot</span>
                    <span className="hidden sm:inline rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-300">
                      {t.tier}
                    </span>
                  </div>
                  <span className={win ? 'font-bold text-emerald-400' : 'font-bold text-rose-400'}>
                    {win ? '+' : '-'}${Math.abs(t.profit).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
