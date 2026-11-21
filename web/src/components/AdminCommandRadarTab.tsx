import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { ToastNotification } from './ToastNotification.tsx';
import { Panel, SkeletonBlock, StatusBadge } from './ui/Primitives';
import { IconAlert, IconBolt, IconCheck, IconClose, IconRadar } from './Icons';

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
      const data = await api.get('/api/v1/telemetry/admin-radar');
      if (data) {
        setRadar(data);
      }
    } catch {
      // keep previous snapshot
    } finally {
      setLoading(false);
    }
  }, []);

  const [sseLive, setSseLive] = useState(false);

  useEffect(() => {
    loadRadar();
    const onRadarEvent = (ev: Event) => {
      const custom = ev as CustomEvent;
      if (custom?.detail) {
        setRadar(custom.detail);
        setLoading(false);
        setSseLive(true);
      }
    };
    window.addEventListener('zupirus:admin-radar', onRadarEvent);
    const timer = setInterval(loadRadar, 20000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('zupirus:admin-radar', onRadarEvent);
    };
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
        const j = await api.post('/api/v1/telemetry/admin-radar/retry-pending');
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
      const d = await api.post('/api/v1/telemetry/admin-radar/dry-run');
      setDryRunResult(d);
      setMsg(d.ok ? 'Dry-Run Test thông suốt (không vào tiền thật).' : 'Dry-Run Test phát hiện điểm cần kiểm tra.');
    } catch (err: any) {
      setMsg(err.message || 'Lỗi kiểm thử Dry-Run.');
    } finally {
      setDryRunLoading(false);
    }
  };

  const isHalted = Boolean(radar.halted);

  return (
    <div className="space-y-6">
      <ToastNotification message={msg || null} type="info" onClose={() => setMsg('')} />

      {/* Block 1: System Health Radar + Global Kill-Switch */}
      <Panel
        title="Giám Sát Hoạt Động AI & Cảnh Báo Lỗi"
        subtitle="Nhịp tim hệ thống tự động 100% — kiểm tra 4 phân hệ cốt lõi và điều khiển cầu dao khẩn cấp."
        icon={<IconRadar className="w-4 h-4 text-cyan-300" />}
        action={
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusBadge tone={isHalted ? 'danger' : 'success'} dot pulse={!isHalted}>
              {isHalted ? 'HALTED' : sseLive ? 'LIVE SSE' : 'LIVE OPS'}
            </StatusBadge>
            <button
              type="button"
              disabled={dryRunLoading}
              onClick={handleRunDryRun}
              className="quant-btn-secondary text-xs"
            >
              <IconBolt className="w-3.5 h-3.5 text-cyan-300" />
              {dryRunLoading ? 'Đang chạy Dry-Run...' : 'Chạy Dry-Run Test'}
            </button>
            <button
              type="button"
              disabled={killSwitchLoading}
              onClick={async () => {
                await handleToggleKillSwitch(isHalted);
                await loadRadar();
              }}
              className={isHalted ? 'quant-btn-primary text-xs' : 'quant-btn-danger text-xs'}
            >
              {killSwitchLoading
                ? 'Đang xử lý...'
                : isHalted
                ? 'Mở Lại Hệ Thống'
                : 'Cầu Dao Khẩn Cấp'}
            </button>
          </div>
        }
        bodyClassName="p-5 sm:p-6 space-y-5"
      >
        {dryRunResult && (
          <div className="rounded-xl border border-cyan-500/30 bg-slate-950/80 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-cyan-300">
                <IconCheck className="w-3.5 h-3.5" />
                Kết Quả Dry-Run Test (Không Vào Tiền Thật)
              </span>
              <button
                type="button"
                aria-label="Đóng kết quả Dry-Run"
                onClick={() => setDryRunResult(null)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
              >
                <IconClose className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(dryRunResult.steps || []).map((st: any, idx: number) => (
                <div
                  key={idx}
                  className={`rounded-xl border p-3.5 text-xs ${
                    st.ok
                      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
                      : 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                  }`}
                >
                  <div className="font-semibold flex items-center gap-1.5">
                    {st.ok ? <IconCheck className="w-3.5 h-3.5 text-emerald-400" /> : <IconAlert className="w-3.5 h-3.5 text-amber-400" />}
                    {st.step}
                  </div>
                  <div className="mt-1.5 text-[11px] text-slate-300 leading-relaxed">{st.detail}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
          {(radar.health_cards || []).map((card: any) => (
            <div
              key={card.key}
              className={`lg:col-span-3 rounded-xl border p-4 transition ${
                card.ok
                  ? 'border-emerald-500/25 bg-emerald-500/[0.04]'
                  : 'border-rose-500/40 bg-rose-500/10'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-200">{card.title}</span>
                <StatusBadge tone={card.ok ? 'success' : 'danger'} dot pulse={!card.ok}>
                  {card.ok ? 'OK' : 'WARN'}
                </StatusBadge>
              </div>
              <div
                className={`mt-2.5 text-xs font-medium leading-relaxed ${
                  card.ok ? 'text-emerald-300/90' : 'text-rose-200'
                }`}
              >
                {card.status_text}
              </div>
            </div>
          ))}
          {loading && (radar.health_cards || []).length === 0 && (
            <>
              <SkeletonBlock className="lg:col-span-3 h-20" />
              <SkeletonBlock className="lg:col-span-3 h-20" />
              <SkeletonBlock className="lg:col-span-3 h-20" />
              <SkeletonBlock className="lg:col-span-3 h-20" />
            </>
          )}
        </div>
      </Panel>

      {/* Block 2 & Block 3: 12-Column Bento Split (7 cols Live AI Feed + 5 cols Alert Center) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Live AI Decision Feed */}
        <div className="quant-panel lg:col-span-7 p-6 space-y-4">
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
        <div className="quant-panel lg:col-span-5 p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400">
                Error &amp; Alert Center
              </div>
              <h3 className="text-base font-semibold text-white">Cảnh Báo Lỗi &amp; Ngoại Lệ Cần Chú Ý</h3>
            </div>
            <StatusBadge tone={(radar.alerts || []).length > 0 ? 'danger' : 'success'} dot>
              {(radar.alerts || []).length} cảnh báo
            </StatusBadge>
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
