import React, { useEffect, useState } from 'react';
import { apiGet } from '../api/client.ts';
import { useLanguage } from '../i18n/LanguageContext';

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
  const { lang, t } = useLanguage();
  const [data, setData] = useState<TrackRecordPayload | null>(null);

  useEffect(() => {
    let active = true;
    apiGet<TrackRecordPayload>('/api/v1/public/track-record')
      .then((d) => {
        if (active && d?.summary) setData(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!data || !data.summary || (data.summary.total_trades ?? 0) === 0) {
    return (
      <section id="track-record" className="quant-panel p-6 sm:p-8 space-y-4 border-[#12B5A6]/25 bg-[#0B1220]/80">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-[#12B5A6]">
              <span className="h-2 w-2 rounded-full bg-[#12B5A6] animate-pulse" />
              {t.trackRecord.badge}
            </span>
            <h2 className="mt-1 font-display text-xl sm:text-2xl font-extrabold text-white">
              {t.trackRecord.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onEnterPortal}
            className="quant-btn-primary px-4 py-2 text-xs whitespace-nowrap shrink-0"
          >
            {t.trackRecord.connectBtn}
          </button>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#070D18]/90 p-5 text-center sm:text-left flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="font-mono text-sm font-bold text-[#F5B700]">
              {t.trackRecord.accumulatingTitle}
            </div>
            <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
              {t.trackRecord.accumulatingDesc}
            </p>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {t.trackRecord.verifiedTag}
          </div>
        </div>
      </section>
    );
  }

  const { summary, equity_curve = [], recent_trades = [] } = data;
  const vals = (equity_curve || []).map((p) => Number(p?.cum_pnl ?? 0));
  const minV = Math.min(...vals, 0);
  const maxV = Math.max(...vals, 1);
  const span = maxV - minV || 1;
  const polyPoints = (equity_curve || [])
    .map((p, idx) => {
      const x = 16 + (idx / Math.max(equity_curve.length - 1, 1)) * 568;
      const y = 148 - ((Number(p?.cum_pnl ?? 0) - minV) / span) * 126;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <section id="track-record" className="quant-panel p-6 sm:p-8 space-y-6 border-emerald-500/25">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            {lang === 'en' ? 'VERIFIED LIVE TRACK RECORD · 100% ANONYMOUS' : 'VERIFIED LIVE TRACK RECORD · ẨN DANH 100%'}
          </span>
          <h2 className="mt-1 font-display text-2xl sm:text-3xl font-extrabold text-white">
            {lang === 'en' ? 'Verified Real-World Performance (XAU/USD)' : 'Hiệu Suất Thực Tế Đã Kiểm Chứng (XAU/USD)'}
          </h2>
        </div>
        <button
          type="button"
          onClick={onEnterPortal}
          className="quant-btn-primary px-4 py-2 text-xs whitespace-nowrap shrink-0"
        >
          {lang === 'en' ? 'Connect MT5 Account Now →' : 'Kết Nối Tài Khoản Ngay →'}
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 font-mono tabular-nums">
        <div className="rounded-xl border border-emerald-500/25 bg-[#040814] p-3.5">
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'NET PROFIT' : 'LỢI NHUẬN RÒNG'}</div>
          <div
            className={`mt-1 text-lg font-extrabold ${
              Number(summary.net_pnl_usd ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {Number(summary.net_pnl_usd ?? 0) >= 0 ? '+' : '-'}$
            {Math.abs(Number(summary.net_pnl_usd ?? 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#040814] p-3.5">
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'WIN RATE (WR)' : 'TỶ LỆ THẮNG (WR)'}</div>
          <div className="mt-1 text-lg font-extrabold text-white">{Number(summary.win_rate_pct ?? 0).toFixed(1)}%</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#040814] p-3.5">
          <div className="text-[10px] text-slate-400">PROFIT FACTOR</div>
          <div className="mt-1 text-lg font-extrabold text-amber-300">{Number(summary.profit_factor ?? 0).toFixed(2)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#040814] p-3.5">
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'CLOSED TRADES' : 'TỔNG LỆNH ĐÓNG'}</div>
          <div className="mt-1 text-lg font-extrabold text-cyan-300">
            {summary.total_trades ?? 0}{' '}
            <span className="text-xs font-normal text-slate-400">({summary.wins ?? 0}W/{summary.losses ?? 0}L)</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#040814] p-3.5">
          <div className="text-[10px] text-slate-400">MAX DRAWDOWN</div>
          <div className="mt-1 text-lg font-extrabold text-emerald-300">{Number(summary.max_dd_pct ?? 0).toFixed(1)}%</div>
        </div>
        <div className="rounded-xl border border-amber-500/25 bg-[#040814] p-3.5">
          <div className="text-[10px] text-slate-400">{lang === 'en' ? 'LIVE PROP EQUITY' : 'VỐN QUỸ LIVE'}</div>
          <div className="mt-1 text-lg font-extrabold text-amber-300">
            ${Math.round(Number(summary.total_live_equity_usd ?? 0)).toLocaleString('en-US')}
          </div>
        </div>
      </div>

      {/* Curve + Recent Verified Trades */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-6 rounded-xl border border-white/10 bg-[#040710]/90 p-4 space-y-2">
          <div className="flex items-center justify-between font-mono text-xs">
            <span className="text-slate-300 font-bold">
              {lang === 'en' ? 'Cumulative Profit Curve (USD)' : 'Đường Cong Lợi Nhuận Tích Lũy (USD)'}
            </span>
            <span className={`font-bold ${Number(summary.roi_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {Number(summary.roi_pct ?? 0) >= 0 ? '+' : ''}
              {Number(summary.roi_pct ?? 0).toFixed(1)}% ROI
            </span>
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
          <div className="font-mono text-xs font-bold text-slate-300">
            {lang === 'en' ? 'Latest Verified XAU/USD Trades' : 'Lệnh XAU/USD Xác Thực Gần Nhất'}
          </div>
          <div className="max-h-44 overflow-y-auto space-y-1.5 font-mono text-xs tabular-nums">
            {(recent_trades || []).slice(0, 8).map((t, i) => {
              const win = (t?.profit ?? 0) >= 0;
              return (
                <div
                  key={`${t?.closed_at ?? i}-${i}`}
                  className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#071022] px-3 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className={t?.action === 'BUY' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                      {t?.action || 'TRADE'}
                    </span>
                    <span className="text-white">{t?.symbol || 'XAUUSD'}</span>
                    <span className="text-slate-400">{Number(t?.volume ?? 0).toFixed(2)} lot</span>
                    <span className="hidden sm:inline rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-300">
                      {t?.tier || 'LIVE'}
                    </span>
                  </div>
                  <span className={win ? 'font-bold text-emerald-400' : 'font-bold text-rose-400'}>
                    {win ? '+' : '-'}${Math.abs(Number(t?.profit ?? 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
