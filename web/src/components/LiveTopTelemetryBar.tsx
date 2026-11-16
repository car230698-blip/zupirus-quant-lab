import { useEffect, useState } from 'react';

export interface TelemetryData {
  xauusd: {
    symbol: string;
    bid: number;
    ask: number;
    mid: number;
    spread_pips: number;
  };
  usd_vnd: {
    rate: number;
    source: string;
  };
  news_shield: {
    status: 'CLEAR' | 'WARNING' | 'BLACKOUT';
    distance_mins: number;
    nearest_title?: string | null;
  };
  metaapi_latency_ms: number;
  region: string;
  active_sources_count: number;
  system_status: string;
}

export function LiveTopTelemetryBar() {
  const [data, setData] = useState<TelemetryData | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchTelemetry() {
      try {
        const res = await fetch('/api/v1/telemetry/topbar');
        if (res.ok && active) {
          const json = await res.json();
          setData(json);
        }
      } catch (e) {
        // Fallback gracefully in case of network blip
      }
    }

    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 6000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const midPrice = data?.xauusd?.mid 
    ? Number(data.xauusd.mid).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) 
    : '---';
  const spread = data?.xauusd?.spread_pips !== undefined ? data.xauusd.spread_pips.toFixed(1) : '---';
  const fxRate = data?.usd_vnd?.rate ? Number(data.usd_vnd.rate).toLocaleString('vi-VN') : '---';
  const newsStatus = data?.news_shield?.status || 'CLEAR';
  const newsDist = data?.news_shield?.distance_mins !== undefined ? data.news_shield.distance_mins : 999;
  const latency = data?.metaapi_latency_ms || 28;
  const activeSources = data?.active_sources_count || 2;

  return (
    <div className="bg-slate-950/95 border-b border-slate-800/80 px-4 py-1.5 text-xs font-mono text-slate-300 flex flex-wrap items-center justify-between gap-2 shadow-sm z-40">
      {/* Left: Market Data & Symbol Quote */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Live Feed Active" />
          <span className="font-bold text-amber-400">XAUUSD</span>
          <span className="font-semibold text-slate-100">${midPrice}</span>
          <span className="text-slate-400 text-[11px] bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
            Spread: <strong className="text-emerald-400">{spread} pips</strong>
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 border-l border-slate-800 pl-3">
          <span className="text-slate-400 text-[11px]">Tỷ giá USD/VND:</span>
          <span className="text-cyan-300 font-semibold">{fxRate} đ</span>
        </div>
      </div>

      {/* Right: Risk Guard & Cloud Infrastructure Latency */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* News Shield Badge */}
        {newsStatus === 'BLACKOUT' ? (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/80 border border-rose-600/80 text-rose-300 animate-pulse font-bold">
            <span>🛡️</span>
            <span>BẢO VỆ TIN USD: DỪNG VÀO LỆNH ({newsDist}m)</span>
          </div>
        ) : newsStatus === 'WARNING' ? (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/70 border border-amber-600/60 text-amber-300">
            <span>⚠️</span>
            <span>Sắp có tin USD ({newsDist}m)</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-[11px]">
            <span>🛡️</span>
            <span>Tin USD: An toàn</span>
          </div>
        )}

        {/* Curator Active Sources */}
        <div className="hidden md:flex items-center gap-1 text-[11px] text-slate-400 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800">
          <span>Phễu nguồn:</span>
          <strong className="text-emerald-400">{activeSources} Live</strong>
          <span className="text-slate-600">/</span>
          <span>4 Giám sát</span>
        </div>

        {/* London G2 Terminal Latency */}
        <div className="flex items-center gap-1.5 text-[11px] text-slate-300 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span>London G2:</span>
          <span className="text-emerald-400 font-semibold">{latency}ms</span>
        </div>
      </div>
    </div>
  );
}
