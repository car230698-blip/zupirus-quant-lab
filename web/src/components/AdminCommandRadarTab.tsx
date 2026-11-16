import React, { useCallback, useEffect, useState } from 'react';
import { ToastNotification } from './ToastNotification.tsx';

export interface AdminCommandRadarTabProps {
  killSwitchLoading: boolean;
  handleToggleKillSwitch: (currentHalted: boolean) => Promise<void>;
  onNavigateTab: (tab: 'radar' | 'ai' | 'business') => void;
}

export const AdminCommandRadarTab: React.FC<AdminCommandRadarTabProps> = ({
  killSwitchLoading,
  handleToggleKillSwitch,
  onNavigateTab,
}) => {
  const [radar, setRadar] = useState<any>({
    halted: false,
    health_cards: [],
    timeline: [],
    alerts: [],
  });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [msg, setMsg] = useState('');

  const loadRadar = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/telemetry/admin-radar');
      if (res.ok) {
        setRadar(await res.json());
      }
    } catch {
      // keep previous snapshot
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRadar();
    const timer = setInterval(loadRadar, 5000);
    return () => clearInterval(timer);
  }, [loadRadar]);

  const handleAlertAction = async (alert: any) => {
    if (alert.action_tab) {
      onNavigateTab(alert.action_tab);
      return;
    }
    if (alert.action_type === 'refresh') {
      await loadRadar();
      setMsg('Đã làm mới trạng thái hệ thống.');
      return;
    }
    if (alert.action_type === 'retry_deploy') {
      setBusyId(alert.id);
      try {
        const res = await fetch('/api/v1/telemetry/admin-radar/retry-pending', {
          method: 'POST',
          headers: { 'X-Zupirus': '1' },
        });
        const j = await res.json();
        setMsg(j.message || 'Đã thử lại kích hoạt MT5.');
        await loadRadar();
      } finally {
        setBusyId(null);
      }
    }
  };

  const handleRunDryRun = async () => {
    setDryRunLoading(true);
    try {
      const res = await fetch('/api/v1/telemetry/admin-radar/dry-run', {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        const d = await res.json();
        setDryRunResult(d);
        setMsg(d.ok ? 'Dry-Run Test thông suốt (không vào tiền thật).' : 'Dry-Run Test phát hiện điểm cần kiểm tra.');
      }
    } finally {
      setDryRunLoading(false);
    }
  };

  const isHalted = Boolean(radar.halted);

  return (
    <div className="space-y-6">
      <ToastNotification message={msg || null} type="info" onClose={() => setMsg('')} />

      {/* Block 1: System Health Radar + Global Kill-Switch */}
      <div className="quant-panel p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400">
              Nhịp Tim Hệ Thống Tự Động 100%
            </div>
            <h2 className="mt-1 text-lg font-extrabold text-white">
              Giám Sát Hoạt Động AI &amp; Cảnh Báo Lỗi
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={dryRunLoading}
              onClick={handleRunDryRun}
              className="rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-3 text-xs font-extrabold text-cyan-300 hover:bg-cyan-500/25 transition cursor-pointer"
            >
              {dryRunLoading ? 'Đang chạy Dry-Run...' : 'Chạy Thử Nghiệm Toàn Hệ Thống (Dry-Run Test)'}
            </button>
            <button
              type="button"
              disabled={killSwitchLoading}
              onClick={async () => {
                await handleToggleKillSwitch(isHalted);
                await loadRadar();
              }}
              className={`rounded-xl px-5 py-3 text-xs font-extrabold uppercase tracking-wider shadow-lg transition cursor-pointer ${
                isHalted
                  ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                  : 'bg-rose-600 text-white hover:bg-rose-500 shadow-rose-600/30'
              }`}
            >
              {killSwitchLoading
                ? 'Đang xử lý...'
                : isHalted
                ? 'MỞ LẠI HỆ THỐNG (ĐANG TẠM DỪNG)'
                : 'CẦU DAO KHẨN CẤP (DỪNG TOÀN BỘ)'}
            </button>
          </div>
        </div>

        {dryRunResult && (
          <div className="rounded-2xl border border-cyan-500/30 bg-[#040710]/80 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-bold uppercase text-cyan-300">
                Kết Quả Dry-Run Test (Không Vào Tiền Thật)
              </span>
              <button
                type="button"
                onClick={() => setDryRunResult(null)}
                className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
              >
                Đóng
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(dryRunResult.steps || []).map((st: any, idx: number) => (
                <div
                  key={idx}
                  className={`rounded-xl border p-3 text-xs ${
                    st.ok
                      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
                      : 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                  }`}
                >
                  <div className="font-bold">{st.step}</div>
                  <div className="mt-1 text-[11px] opacity-90">{st.detail}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(radar.health_cards || []).map((card: any) => (
            <div
              key={card.key}
              className={`rounded-2xl border p-4 transition ${
                card.ok
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-rose-500/40 bg-rose-500/10'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">{card.title}</span>
                <span
                  className={`h-3 w-3 rounded-full ${
                    card.ok
                      ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]'
                      : 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.8)] animate-pulse'
                  }`}
                />
              </div>
              <div
                className={`mt-2 text-xs font-semibold ${
                  card.ok ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {card.status_text}
              </div>
            </div>
          ))}
          {loading && (radar.health_cards || []).length === 0 && (
            <div className="col-span-4 text-xs text-slate-400">Đang kiểm tra trạng thái hệ thống...</div>
          )}
        </div>
      </div>

      {/* Block 2 & Block 3: Live AI Decision Feed & Error/Exception Alert Center */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Live AI Decision Feed */}
        <div className="quant-panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400">
                Live AI Decision Feed
              </div>
              <h3 className="text-base font-bold text-white">AI Đang Làm Gì (Thời Gian Thực)</h3>
            </div>
            <span className="rounded-full bg-cyan-500/15 px-3 py-1 font-mono text-[10px] font-bold text-cyan-300">
              TỰ ĐỘNG CẬP NHẬT
            </span>
          </div>

          <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
            {(radar.timeline || []).length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#040710]/60 p-4 text-xs text-slate-400">
                Chưa có hoạt động nào được ghi nhận. Hệ thống AI đang chạy nền 24/5.
              </div>
            ) : (
              radar.timeline.map((item: any, idx: number) => {
                const timeStr = new Date((item.ts || 0) * 1000).toLocaleTimeString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const badgeColor =
                  item.kind === 'success'
                    ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
                    : item.kind === 'warning'
                    ? 'text-amber-300 border-amber-500/30 bg-amber-500/10'
                    : 'text-slate-200 border-white/10 bg-[#040710]/60';
                return (
                  <div key={idx} className={`rounded-xl border px-4 py-3 text-xs ${badgeColor}`}>
                    <span className="mr-2 font-mono font-bold text-cyan-300">[{timeStr}]</span>
                    <span>{item.text}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Error & Exception Alert Center */}
        <div className="quant-panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400">
                Error &amp; Alert Center
              </div>
              <h3 className="text-base font-bold text-white">Cảnh Báo Lỗi &amp; Ngoại Lệ Cần Chú Ý</h3>
            </div>
            <span
              className={`rounded-full px-3 py-1 font-mono text-[10px] font-bold ${
                (radar.alerts || []).length > 0
                  ? 'bg-rose-500/20 text-rose-300'
                  : 'bg-emerald-500/20 text-emerald-300'
              }`}
            >
              {(radar.alerts || []).length} CẢNH BÁO
            </span>
          </div>

          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {(radar.alerts || []).length === 0 ? (
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-5 text-center text-xs text-emerald-300">
                Mọi phân hệ đều đang vận hành bình thường. Không có lỗi hay ngoại lệ nào cần can thiệp.
              </div>
            ) : (
              radar.alerts.map((al: any) => (
                <div
                  key={al.id}
                  className={`rounded-xl border p-4 space-y-2 ${
                    al.severity === 'error'
                      ? 'border-rose-500/40 bg-rose-500/10'
                      : 'border-amber-500/35 bg-amber-500/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-extrabold text-white">{al.title}</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{al.detail}</p>
                    </div>
                    {al.action_label && (
                      <button
                        type="button"
                        disabled={busyId === al.id}
                        onClick={() => handleAlertAction(al)}
                        className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-white/20 cursor-pointer"
                      >
                        {busyId === al.id ? 'Đang xử lý...' : al.action_label}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
