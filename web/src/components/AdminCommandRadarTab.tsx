import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { ToastNotification } from './ToastNotification';
import { Panel, SkeletonBlock, StatusBadge } from './ui/Primitives';
import { IconAlert, IconBolt, IconCheck, IconClose, IconRadar } from './Icons';
import { AdminErrorBanner, AdminErrorInfo } from './AdminErrorBanner';
import { AdminLiveOrdersPanel } from './AdminLiveOrdersPanel';
import { normalizeCentToUsd } from '../utils/currencyFormat';

export interface AdminCommandRadarTabProps {
  killSwitchLoading: boolean;
  handleToggleKillSwitch: (currentHalted: boolean) => Promise<void>;
  onNavigateTab: (tab: 'radar' | 'ai' | 'business') => void;
  monitorData?: {
    accounts?: any[];
    audit?: any[];
    jobs?: any[];
    news?: any[];
    halted?: boolean;
    pendingBillingCount?: number;
  };
  refetchMonitor?: () => Promise<void>;
}

export const AdminCommandRadarTab: React.FC<AdminCommandRadarTabProps> = ({
  killSwitchLoading,
  handleToggleKillSwitch,
  onNavigateTab,
  monitorData,
  refetchMonitor,
}) => {
  const [radar, setRadar] = useState<any>({
    halted: false,
    health_cards: [],
    timeline: [],
    alerts: [],
    ai_strategy: 'Alpha Quant XAU M15',
    auto_rollback: 'ACTIVE',
  });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [errorBanner, setErrorBanner] = useState<AdminErrorInfo | null>(null);
  const [auditFilter, setAuditFilter] = useState<'ALL' | 'WARN_ERR'>('ALL');
  const [ordersStats, setOrdersStats] = useState<{ total: number; open: number; error: number }>({
    total: 0,
    open: 0,
    error: 0,
  });

  const loadRadar = useCallback(async () => {
    try {
      const data = await api.get('/api/v1/telemetry/admin-radar');
      if (data) {
        setRadar(data);
      }
      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner({
        status: err?.status,
        message: err?.message || 'Không thể đồng bộ dữ liệu trạm quan sát hệ thống.',
      });
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
      if (refetchMonitor) await refetchMonitor();
      setMsg('Đã làm mới trạng thái hệ thống.');
      return;
    }
    if (alert.action_type === 'retry_deploy') {
      setBusyId(alert.id);
      try {
        const j = await api.post('/api/v1/telemetry/admin-radar/retry-pending');
        setMsg(j.message || 'Đã thử lại kích hoạt MT5.');
        await loadRadar();
      } catch (err: any) {
        setMsg(`Lỗi kích hoạt: ${err.message || ''}`);
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

  const isHalted = Boolean(radar.halted || monitorData?.halted);

  // === KPI COMPUTATIONS ===
  const accounts = monitorData?.accounts || [];
  const totalAumUsd = useMemo(() => {
    return accounts.reduce((acc: number, a: any) => {
      const rawEq = Number(a.equity ?? a.balance ?? 0);
      return acc + normalizeCentToUsd(rawEq, a);
    }, 0);
  }, [accounts]);

  const activeAccountsCount = useMemo(() => {
    return accounts.filter((a: any) => Number(a.auto_trade ?? a.enabled ?? 0) === 1).length;
  }, [accounts]);

  const pendingJobsCount = useMemo(() => {
    return (monitorData?.jobs || []).filter((j: any) => j.state === 'waiting_approval').length;
  }, [monitorData?.jobs]);

  const pendingBillingCount = Number(monitorData?.pendingBillingCount ?? 0);
  const totalPendingQueue = pendingJobsCount + pendingBillingCount;

  // Upcoming Macro News
  const newsList = monitorData?.news || [];
  const nowSec = Date.now() / 1000;
  const upcomingNews = useMemo(() => {
    return newsList
      .filter((n: any) => Number(n.ts || 0) >= nowSec - 300)
      .sort((a: any, b: any) => Number(a.ts || 0) - Number(b.ts || 0));
  }, [newsList, nowSec]);

  const nextMajorNews = upcomingNews[0] || null;

  // Combined Audit & Timeline Feed
  const combinedLog = useMemo(() => {
    const list: any[] = [];

    // 1. Radar timeline
    (radar.timeline || []).forEach((t: any, idx: number) => {
      list.push({
        id: `tl-${idx}-${t.ts}`,
        ts: Number(t.ts || 0),
        text: t.text,
        kind: t.kind || 'info',
        source: 'AI-SWARM',
      });
    });

    // 2. Database audit log
    (monitorData?.audit || []).forEach((au: any) => {
      const isWarn = au.action?.includes('kill_switch') || au.action?.includes('rejected') || au.action?.includes('delete');
      list.push({
        id: `au-${au.id}`,
        ts: Number(au.created || 0),
        text: `[${au.actor_id || 'ADMIN'}] ${au.action}: ${typeof au.detail === 'object' ? JSON.stringify(au.detail) : au.detail || ''}`,
        kind: isWarn ? 'warning' : 'info',
        source: 'AUDIT',
      });
    });

    list.sort((a, b) => b.ts - a.ts);
    return list;
  }, [radar.timeline, monitorData?.audit]);

  const filteredLog = useMemo(() => {
    if (auditFilter === 'WARN_ERR') {
      return combinedLog.filter((item) => item.kind === 'warning' || item.kind === 'error');
    }
    return combinedLog;
  }, [combinedLog, auditFilter]);

  return (
    <div className="space-y-6">
      <ToastNotification message={msg || null} type="info" onClose={() => setMsg('')} />

      {/* ERROR BANNER FOR DOMAIN ISOLATION / AUTH / NETWORK */}
      <AdminErrorBanner
        error={errorBanner}
        onRetry={loadRadar}
        onDismiss={() => setErrorBanner(null)}
      />

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
                if (refetchMonitor) await refetchMonitor();
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

      {/* HẠNG MỤC 3 — DẢI 6 KPI TỔNG HỢP TOÀN HỆ THỐNG */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {/* KPI 1: AUM USD */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-4 space-y-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Tổng Vốn Quản Lý (AUM)
          </div>
          <div className="text-xl sm:text-2xl font-bold text-white tabular-nums">
            ${Math.round(totalAumUsd).toLocaleString('en-US')}
          </div>
          <div className="text-[10px] text-slate-400">
            Đã chuẩn hóa USC/Cent → USD
          </div>
        </div>

        {/* KPI 2: Active Accounts */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-4 space-y-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Tài Khoản MT5 Chạy
          </div>
          <div className="text-xl sm:text-2xl font-bold text-[#12B5A6] tabular-nums">
            {activeAccountsCount} / {accounts.length}
          </div>
          <div className="text-[10px] text-slate-400">
            Auto-Trade bật: {accounts.length > 0 ? Math.round((activeAccountsCount / accounts.length) * 100) : 0}%
          </div>
        </div>

        {/* KPI 3: Orders Today & Errors */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-4 space-y-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Lệnh Thực Thi Toàn Sàn
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl sm:text-2xl font-bold text-white tabular-nums">
              {ordersStats.total}
            </span>
            {ordersStats.error > 0 && (
              <span className="rounded-md bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-400 border border-rose-500/40">
                {ordersStats.error} lỗi
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-400">
            {ordersStats.open} lệnh đang mở / hoạt động
          </div>
        </div>

        {/* KPI 4: AI Strategy & Rollback */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-4 space-y-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Chiến Lược AI Vận Hành
          </div>
          <div className="text-sm font-bold text-white truncate" title={radar.ai_strategy || 'Alpha Quant XAU M15'}>
            {radar.ai_strategy || 'Alpha Quant XAU M15'}
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="rounded bg-[#12B5A6]/15 border border-[#12B5A6]/30 px-1 text-[#12B5A6] font-bold">
              APPROVED
            </span>
            <span className="text-slate-400">
              Rollback: <strong className="text-white">{radar.auto_rollback || 'ACTIVE'}</strong>
            </span>
          </div>
        </div>

        {/* KPI 5: Pending Approvals Queue */}
        <div
          onClick={() => {
            if (pendingJobsCount > 0) onNavigateTab('ai');
            else onNavigateTab('business');
          }}
          className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-4 space-y-1 cursor-pointer hover:border-[#12B5A6]/50 transition group"
        >
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-slate-400">
            <span>Hàng Đợi Cần Duyệt</span>
            <span className="text-xs text-[#12B5A6] group-hover:translate-x-0.5 transition">→</span>
          </div>
          <div className="text-xl sm:text-2xl font-bold text-[#F5B700] tabular-nums">
            {totalPendingQueue}
          </div>
          <div className="text-[10px] text-slate-400">
            {pendingJobsCount} chiến lược · {pendingBillingCount} đơn SePay
          </div>
        </div>

        {/* KPI 6: Macro News Shield */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-4 space-y-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Lịch Tin Vĩ Mô (News Shield)
          </div>
          {nextMajorNews ? (
            <>
              <div className="text-xs font-bold text-amber-300 truncate" title={nextMajorNews.title}>
                {nextMajorNews.title} ({nextMajorNews.currency})
              </div>
              <div className="text-[10px] text-slate-400">
                {Math.max(0, Math.round((Number(nextMajorNews.ts) - nowSec) / 60))} phút tới cửa sổ khóa lệnh
              </div>
            </>
          ) : (
            <>
              <div className="text-xs font-bold text-emerald-400">
                An toàn
              </div>
              <div className="text-[10px] text-slate-400">
                Không có tin mạnh sắp tới
              </div>
            </>
          )}
        </div>
      </div>

      {/* HẠNG MỤC 2 — BẢNG GIÁM SÁT LỆNH TOÀN SÀN REALTIME */}
      <AdminLiveOrdersPanel onOrdersCountChange={setOrdersStats} />

      {/* HẠNG MỤC 4 — 12-COLUMN BENTO SPLIT (7 cols Live Activity & Audit Log + 5 cols Alert Center & News) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 7 Cols: Realtime AI & Audit Activity Log */}
        <div className="quant-panel lg:col-span-7 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400">
                AI &amp; SYSTEM AUDIT LOG
              </div>
              <h3 className="text-base font-bold text-white">
                Nhật Ký Hoạt Động &amp; Kiểm Toán Realtime
              </h3>
            </div>
            <div className="flex rounded-lg border border-slate-800 bg-[#080E1A] p-0.5 text-xs font-mono">
              <button
                type="button"
                onClick={() => setAuditFilter('ALL')}
                className={`rounded px-2.5 py-1 transition cursor-pointer ${
                  auditFilter === 'ALL'
                    ? 'bg-slate-800 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Tất cả ({combinedLog.length})
              </button>
              <button
                type="button"
                onClick={() => setAuditFilter('WARN_ERR')}
                className={`rounded px-2.5 py-1 transition cursor-pointer ${
                  auditFilter === 'WARN_ERR'
                    ? 'bg-amber-500/20 text-amber-300 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Lỗi &amp; Cảnh báo
              </button>
            </div>
          </div>

          <div className="max-h-[460px] space-y-2.5 overflow-y-auto pr-1 font-mono text-xs">
            {filteredLog.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#040710]/60 p-5 text-center text-slate-400">
                Chưa có sự kiện nào được ghi nhận. Hệ thống AI đang chạy nền 24/5.
              </div>
            ) : (
              filteredLog.map((item: any) => {
                const timeStr = item.ts > 0
                  ? new Date(item.ts > 1e11 ? item.ts : item.ts * 1000).toLocaleTimeString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })
                  : '—';

                const isWarn = item.kind === 'warning' || item.kind === 'error';
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border px-3.5 py-2.5 text-xs transition ${
                      isWarn
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                        : 'border-white/[0.06] bg-[#040710]/60 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-cyan-400">[{timeStr}]</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[9px] text-slate-400 uppercase font-sans">
                        {item.source}
                      </span>
                    </div>
                    <div className="mt-1 font-sans text-xs text-slate-200 leading-relaxed">
                      {item.text}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right 5 Cols: Alert Center + Upcoming Macro News Calendar */}
        <div className="lg:col-span-5 space-y-6">
          {/* Upper: Alert Center */}
          <div className="quant-panel p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] pb-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400">
                  ACTIONABLE ALERTS
                </div>
                <h3 className="text-base font-semibold text-white">
                  Cảnh Báo Cần Xử Lý
                </h3>
              </div>
              <StatusBadge tone={(radar.alerts || []).length > 0 ? 'danger' : 'success'} dot>
                {(radar.alerts || []).length} cảnh báo
              </StatusBadge>
            </div>

            <div className="max-h-[220px] space-y-3 overflow-y-auto pr-1">
              {(radar.alerts || []).length === 0 ? (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-center text-xs text-emerald-300">
                  Mọi phân hệ đều vận hành bình thường. Không có cảnh báo tồn đọng.
                </div>
              ) : (
                radar.alerts.map((al: any) => (
                  <div
                    key={al.id}
                    className={`rounded-xl border p-3.5 space-y-2 ${
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
                          className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-white/20 transition cursor-pointer"
                        >
                          {busyId === al.id ? '...' : al.action_label}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Lower: Upcoming Macro News Calendar */}
          <div className="quant-panel p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] pb-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-[#12B5A6]">
                  MACRO NEWS CALENDAR
                </div>
                <h3 className="text-base font-semibold text-white">
                  Lịch Tin Vĩ Mô Sắp Tới
                </h3>
              </div>
              <span className="rounded-full bg-[#12B5A6]/15 px-2.5 py-0.5 font-mono text-[10px] font-bold text-[#12B5A6]">
                NEWS SHIELD ±15M
              </span>
            </div>

            <div className="max-h-[220px] space-y-2.5 overflow-y-auto pr-1">
              {upcomingNews.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-[#040710]/60 p-4 text-center text-xs text-slate-400">
                  Không có tin tức vĩ mô mạnh trong 24 giờ tới. Cửa sổ giao dịch an toàn.
                </div>
              ) : (
                upcomingNews.map((n: any, idx: number) => {
                  const evTs = Number(n.ts || 0);
                  const diffMinutes = Math.round((evTs - nowSec) / 60);
                  const isImminent = diffMinutes >= -15 && diffMinutes <= 15;
                  const timeFormatted = evTs > 0
                    ? new Date(evTs * 1000).toLocaleTimeString('vi-VN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—';

                  return (
                    <div
                      key={n.id || idx}
                      className={`rounded-xl border p-3 text-xs space-y-1 transition ${
                        isImminent
                          ? 'border-rose-500/50 bg-rose-500/10 text-rose-200'
                          : 'border-white/[0.07] bg-[#040710]/70 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-rose-500/20 border border-rose-500/30 px-1.5 py-0.2 text-[9px] font-mono font-bold text-rose-300">
                            {n.currency || 'USD'}
                          </span>
                          <span className="font-bold text-white text-xs">{n.title}</span>
                        </div>
                        <span className="font-mono text-cyan-300 font-bold">{timeFormatted}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span>Tác động: <strong className="text-amber-300 uppercase">{n.impact || 'HIGH'}</strong></span>
                        <span className={isImminent ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                          {isImminent
                            ? '⚠ ĐANG KHÓA LỆNH (NEWS SHIELD)'
                            : diffMinutes > 0
                            ? `Khóa lệnh sau ${diffMinutes} phút`
                            : 'Vừa hoàn tất'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
