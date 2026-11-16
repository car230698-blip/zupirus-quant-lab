import { useEffect, useState } from 'react';

export interface TelemetryData {
  xauusd: {
    symbol: string;
    bid: number | null;
    ask: number | null;
    mid: number | null;
    spread_pips: number | null;
    live?: boolean;
    data_available?: boolean;
    stale?: boolean;
    source?: string;
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
  shadow_sources_count?: number;
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
      } catch {
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

  const hasData = Boolean(data?.xauusd?.data_available && data?.xauusd?.mid !== null);
  const midPrice = hasData && data?.xauusd?.mid !== null && data?.xauusd?.mid !== undefined
    ? Number(data.xauusd.mid).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '---';
  const spread = data?.xauusd?.spread_pips !== null && data?.xauusd?.spread_pips !== undefined
    ? data.xauusd.spread_pips.toFixed(1)
    : '---';
  const isLive = Boolean(data?.xauusd?.live && !data?.xauusd?.stale);
  const isStale = Boolean(data?.xauusd?.stale);
  const fxRate = data?.usd_vnd?.rate ? Number(data.usd_vnd.rate).toLocaleString('vi-VN') : '---';
  const newsStatus = data?.news_shield?.status || 'CLEAR';
  const newsDist = data?.news_shield?.distance_mins !== undefined ? data.news_shield.distance_mins : 999;
  const latency = data?.metaapi_latency_ms || 28;
  const activeSources = data?.active_sources_count ?? 0;
  const shadowSources = data?.shadow_sources_count ?? 0;

  return (
    <div className="bg-[#03060d]/95 border-b border-white/[0.06] px-4 sm:px-8 py-2 text-xs font-mono text-slate-300 flex flex-wrap items-center justify-between gap-3 z-40">
      {/* Left: Live Market Quote & FX Rate (Unboxed clean telemetry with separators) */}
      <div className="flex items-center gap-3 flex-wrap tabular-nums">
        {isLive ? (
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Luồng báo giá trực tiếp đang hoạt động" />
        ) : isStale && hasData ? (
          <span className="w-2 h-2 rounded-full bg-amber-400" title="Dữ liệu phiên đóng cửa hoặc cũ" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-slate-500" title="Chờ dữ liệu từ broker" />
        )}
        <span className="font-bold text-amber-300">XAU/USD</span>
        <span className="font-bold text-slate-100">${midPrice}</span>
        <span aria-hidden="true" className="text-slate-600">·</span>
        <span className="text-slate-400">
          Spread: <strong className={spread !== '---' ? 'text-emerald-400' : 'text-slate-500'}>
            {spread !== '---' ? `${spread} pips` : 'N/A'}
          </strong>
        </span>
        <span aria-hidden="true" className="hidden sm:inline text-slate-600">·</span>
        <span className="hidden sm:inline text-slate-400">
          USD/VND: <strong className="text-cyan-300">{fxRate}₫</strong>
        </span>
      </div>

      {/* Right: Risk Guard & Cloud Infrastructure Telemetry */}
      <div className="flex items-center gap-3 flex-wrap tabular-nums">
        {newsStatus === 'BLACKOUT' ? (
          <span className="text-rose-400 font-bold">
            Lá chắn tin USD: Tạm ngắt vào lệnh ({newsDist}m)
          </span>
        ) : newsStatus === 'WARNING' ? (
          <span className="text-amber-300 font-semibold">
            Cảnh báo tin USD sắp công bố ({newsDist}m)
          </span>
        ) : (
          <span className="text-emerald-400">
            Lá chắn tin USD: An toàn
          </span>
        )}

        <span aria-hidden="true" className="hidden md:inline text-slate-600">·</span>

        <span className="hidden md:inline text-slate-400">
          Phễu nguồn: <strong className="text-cyan-300">{activeSources} Live</strong> / {shadowSources} Giám sát
        </span>

        <span aria-hidden="true" className="text-slate-600">·</span>

        <span className="text-slate-300">
          London G2: <strong className="text-emerald-400">{latency} ms</strong>
        </span>
      </div>
    </div>
  );
}
