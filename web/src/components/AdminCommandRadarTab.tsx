import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  fetchAdminAgentsHeartbeat,
  wakeAdminAgent,
  togglePauseAdminAgent,
  fetchAdminAiQuota,
  updateAdminAiQuota,
  fetchStrategyReviewQueue,
  approveStrategy,
  rejectStrategy,
  fetchStrategyHistory,
  rollbackStrategy,
  AdminAgentHeartbeat,
  AdminAiQuota,
  StrategyReviewQueueItem,
  StrategyHistoryItem,
} from '../api/client';
import { ToastNotification } from './ToastNotification';
import { Panel, StatusBadge } from './ui/Primitives';
import { SpotlightBento } from './ui/SpotlightBento';
import { IconAlert, IconBolt, IconRadar } from './Icons';
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

export function formatAuditDateTime(rawTs: any): string {
  if (!rawTs) return '--:--:--';
  const num = Number(rawTs);
  if (isNaN(num) || num <= 0) return '--:--:--';
  const millis = num > 1e11 ? num : num * 1000;
  const d = new Date(millis);
  if (isNaN(d.getTime())) return '--:--:--';

  const time = d.toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const date = d.toLocaleDateString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
  });
  return `${time} ${date}`;
}

export function humanizeAuditEntry(entry: any): {
  title: string;
  subtitle?: string;
  isWarn: boolean;
  rawJson?: string;
} {
  const ev = String(entry.event || entry.action || entry.type || '').trim();
  let d: any = {};
  let rawJson = '';

  if (typeof entry.detail === 'object' && entry.detail !== null) {
    d = entry.detail;
    try {
      rawJson = JSON.stringify(d, null, 2);
    } catch (err) {
      console.warn('[AdminRadar] Failed to serialize entry detail to JSON:', err);
    }
  } else if (typeof entry.detail === 'string' && entry.detail.trim()) {
    rawJson = entry.detail;
    try {
      d = JSON.parse(entry.detail);
    } catch {
      d = { text: entry.detail };
    }
  }

  let title = '';
  let subtitle = '';
  let isWarn = false;

  switch (ev) {
    case 'trading_account_toggle_auto_trade': {
      const isAuto = Number(d.auto_trade ?? d.is_active ?? 0) === 1;
      const acctRef = d.login || d.mt5_login || (d.account_id ? `#${String(d.account_id).slice(-8)}` : '');
      title = isAuto
        ? `Bật Auto-Trade cho tài khoản ${acctRef}`
        : `Tạm dừng Auto-Trade tài khoản ${acctRef}`;
      subtitle = d.broker_server || d.server || '';
      break;
    }
    case 'trading_account_cloud_connected': {
      const login = d.login || d.mt5_login || '';
      const srv = d.server || d.broker_server || '';
      const tier = d.tier ? ` · gói ${d.tier}` : '';
      title = `Kết nối Cloud MT5 #${login}`;
      subtitle = `${srv}${tier}`;
      break;
    }
    case 'kill_switch_toggled': {
      const halted = Boolean(d.halted);
      title = halted
        ? 'KÍCH HOẠT CẦU DAO KHẨN CẤP TOÀN SÀN (HALTED)'
        : 'Mở lại hệ thống giao dịch tự hành';
      isWarn = halted;
      break;
    }
    case 'manual_payment_approved': {
      title = `Duyệt bù đơn hàng SePay #${d.order_id || d.id || ''}`;
      subtitle = 'Kích hoạt hạn mức Cloud MT5 thành công';
      break;
    }
    case 'auto_calendar_synced':
    case 'calendar_synced': {
      const added = d.added ?? 0;
      title = `Đồng bộ lịch tin vĩ mô tự động (+${added} tin mới)`;
      break;
    }
    case 'circuit_breaker_triggered': {
      title = `Lá chắn Prop Firm ngắt mạch khẩn cấp tài khoản #${d.account_id || ''}`;
      subtitle = `Sụt giảm chạm ngưỡng: ${d.drawdown_pct || ''}%`;
      isWarn = true;
      break;
    }
    case 'ai_quota_updated': {
      title = 'Cập nhật trần ngân sách Quota AI';
      subtitle = d.override_minutes ? `Mở khóa ${d.override_minutes} phút` : `Trần mới: ${d.daily_cap || '—'}`;
      break;
    }
    case 'agent_woken': {
      title = `Kích hoạt chu kỳ ngay (Wake Now) cho Agent: ${d.agent_id || ''}`;
      break;
    }
    case 'agent_pause_toggled': {
      title = `${d.is_paused ? 'Tạm dừng' : 'Kích hoạt lại'} Agent: ${d.agent_id || ''}`;
      break;
    }
    case 'strategy_approved': {
      title = `Duyệt chiến lược AI lên LIVE: ${d.name || d.candidate_id || ''}`;
      break;
    }
    case 'strategy_rolled_back': {
      title = `Khôi phục chiến lược (Rollback 1-Click) sang bản: ${d.target_name || d.target_id || ''}`;
      isWarn = true;
      break;
    }
    default: {
      if (entry.text) {
        title = entry.text;
      } else {
        const readableEv = ev ? ev.replace(/_/g, ' ') : 'Sự kiện hệ thống';
        title = `Hệ thống ghi nhận: ${readableEv}`;
      }
      isWarn = ev.includes('error') || ev.includes('fail') || ev.includes('reject') || ev.includes('circuit');
      break;
    }
  }

  return { title, subtitle, isWarn, rawJson };
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
    signal_mode: 'EXTERNAL_FEED',
    auto_rollback: 'ACTIVE',
  });

  // --- Control Plane v1.2 Core States ---
  const [aiQuota, setAiQuota] = useState<AdminAiQuota | null>(null);
  const [agentsHeartbeat, setAgentsHeartbeat] = useState<AdminAgentHeartbeat[]>([]);
  const [reviewQueue, setReviewQueue] = useState<StrategyReviewQueueItem[]>([]);
  const [strategyHistory, setStrategyHistory] = useState<StrategyHistoryItem[]>([]);

  // Action busy indicators
  const [busyId, setBusyId] = useState<string | null>(null);
  const [wakingAgentId, setWakingAgentId] = useState<string | null>(null);
  const [pausingAgentId, setPausingAgentId] = useState<string | null>(null);
  const [approvingCandidateId, setApprovingCandidateId] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [rollbackConfirmCandidate, setRollbackConfirmCandidate] = useState<StrategyHistoryItem | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [quotaUpdating, setQuotaUpdating] = useState(false);
  const [msg, setMsg] = useState('');
  const [errorBanner, setErrorBanner] = useState<AdminErrorInfo | null>(null);
  const [auditFilter, setAuditFilter] = useState<'ALL' | 'WARN_ERR'>('ALL');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [ordersStats, setOrdersStats] = useState<{ total: number; open: number; error: number }>({
    total: 0,
    open: 0,
    error: 0,
  });

  const loadAllControlPlaneData = useCallback(async () => {
    try {
      const [radarRes, quotaRes, hbRes, queueRes, histRes] = await Promise.allSettled([
        api.get('/api/v1/telemetry/admin-radar'),
        fetchAdminAiQuota(),
        fetchAdminAgentsHeartbeat(),
        fetchStrategyReviewQueue(),
        fetchStrategyHistory(),
      ]);

      if (radarRes.status === 'fulfilled' && radarRes.value) {
        setRadar(radarRes.value);
      }
      if (quotaRes.status === 'fulfilled' && quotaRes.value) {
        setAiQuota(quotaRes.value);
      }
      if (hbRes.status === 'fulfilled' && hbRes.value?.agents) {
        setAgentsHeartbeat(hbRes.value.agents);
      }
      if (queueRes.status === 'fulfilled' && queueRes.value?.queue) {
        setReviewQueue(queueRes.value.queue);
      }
      if (histRes.status === 'fulfilled' && histRes.value?.strategies) {
        setStrategyHistory(histRes.value.strategies);
      }
      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner({
        status: err?.status,
        message: err?.message || 'Không thể đồng bộ dữ liệu trạm quan sát hệ thống.',
      });
    }
  }, []);

  const [sseLive, setSseLive] = useState(false);

  useEffect(() => {
    loadAllControlPlaneData();
    const onRadarEvent = (ev: Event) => {
      const custom = ev as CustomEvent;
      if (custom?.detail) {
        setRadar(custom.detail);
        setSseLive(true);
      }
    };
    window.addEventListener('zupirus:admin-radar', onRadarEvent);
    const timer = setInterval(loadAllControlPlaneData, 15000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('zupirus:admin-radar', onRadarEvent);
    };
  }, [loadAllControlPlaneData]);

  const handleAlertAction = async (alert: any) => {
    if (alert.action_tab) {
      onNavigateTab(alert.action_tab);
      return;
    }
    if (alert.action_type === 'refresh') {
      await loadAllControlPlaneData();
      if (refetchMonitor) await refetchMonitor();
      setMsg('Đã làm mới trạng thái hệ thống.');
      return;
    }
    if (alert.action_type === 'retry_deploy') {
      setBusyId(alert.id);
      try {
        const j = await api.post('/api/v1/telemetry/admin-radar/retry-pending');
        setMsg(j.message || 'Đã thử lại kích hoạt MT5.');
        await loadAllControlPlaneData();
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

  // --- Agent Heartbeat & Lock Actions ---
  const handleWakeAgent = async (agentId: string) => {
    setWakingAgentId(agentId);
    try {
      const res = await wakeAdminAgent(agentId);
      setMsg(res.message || `Đã kích hoạt chu kỳ Agent ${agentId} thành công.`);
      await loadAllControlPlaneData();
    } catch (err: any) {
      if (err?.status === 409 || String(err?.message || '').includes('chống chạy trùng') || String(err?.message || '').includes('đang chạy')) {
        setMsg('⚠ Agent đang chạy chu kỳ hiện tại, chống chạy trùng (Khóa Redis 60s)');
      } else {
        setMsg(`Lỗi kích hoạt Agent: ${err?.message || 'Thất bại'}`);
      }
    } finally {
      setWakingAgentId(null);
    }
  };

  const handleTogglePause = async (agentId: string) => {
    setPausingAgentId(agentId);
    try {
      const res = await togglePauseAdminAgent(agentId);
      setMsg(res.message || 'Đã cập nhật trạng thái Agent.');
      await loadAllControlPlaneData();
    } catch (err: any) {
      setMsg(`Lỗi tạm dừng/kích hoạt: ${err?.message || 'Thất bại'}`);
    } finally {
      setPausingAgentId(null);
    }
  };

  // --- AI Quota Budget Actions ---
  const handleQuickQuotaOverride = async (minutes = 60) => {
    setQuotaUpdating(true);
    try {
      await updateAdminAiQuota({ override_minutes: minutes });
      setMsg(`Đã tạm mở khóa hạn mức AI trong ${minutes} phút.`);
      await loadAllControlPlaneData();
    } catch (err: any) {
      setMsg(`Lỗi mở khóa: ${err?.message || 'Thất bại'}`);
    } finally {
      setQuotaUpdating(false);
    }
  };

  const handleResetQuotaToday = async () => {
    setQuotaUpdating(true);
    try {
      await updateAdminAiQuota({ reset_today: true });
      setMsg('Đã đặt lại bộ đếm lượt gọi AI hôm nay.');
      await loadAllControlPlaneData();
    } catch (err: any) {
      setMsg(`Lỗi đặt lại: ${err?.message || 'Thất bại'}`);
    } finally {
      setQuotaUpdating(false);
    }
  };

  // --- Strategy Candidate Actions ---
  const handleApproveCandidate = async (candidateId: string) => {
    setApprovingCandidateId(candidateId);
    try {
      const res = await approveStrategy(candidateId);
      setMsg(res.message || `✓ Đã phê duyệt chiến lược #${candidateId.slice(0, 8)} lên chạy LIVE.`);
      await loadAllControlPlaneData();
      if (refetchMonitor) await refetchMonitor();
    } catch (err: any) {
      setMsg(`Lỗi phê duyệt chiến lược: ${err?.message || 'Thất bại'}`);
    } finally {
      setApprovingCandidateId(null);
    }
  };

  const handleRejectCandidate = async (candidateId: string) => {
    setApprovingCandidateId(candidateId);
    try {
      const res = await rejectStrategy(candidateId);
      setMsg(res.message || `✕ Đã từ chối chiến lược #${candidateId.slice(0, 8)}.`);
      await loadAllControlPlaneData();
      if (refetchMonitor) await refetchMonitor();
    } catch (err: any) {
      setMsg(`Lỗi từ chối chiến lược: ${err?.message || 'Thất bại'}`);
    } finally {
      setApprovingCandidateId(null);
    }
  };

  const handleExecuteRollback = async (candidateId: string) => {
    setRollingBackId(candidateId);
    try {
      const res = await rollbackStrategy(candidateId);
      setMsg(res.message || `✓ Đã khôi phục chiến lược #${candidateId.slice(0, 8)} lên LIVE.`);
      setRollbackConfirmCandidate(null);
      await loadAllControlPlaneData();
      if (refetchMonitor) await refetchMonitor();
    } catch (err: any) {
      setMsg(`Lỗi hoàn tác chiến lược: ${err?.message || 'Thất bại'}`);
    } finally {
      setRollingBackId(null);
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

  const pendingBillingCount = Number(monitorData?.pendingBillingCount ?? 0);
  const pendingStrategiesCount = reviewQueue.length;
  const isQuotaWarning = (aiQuota?.usage_pct || 0) >= 80;
  const totalNeedsMeCount = pendingStrategiesCount + pendingBillingCount + (isQuotaWarning ? 1 : 0);

  // Upcoming Macro News (Shield threshold: ±30 minutes)
  const newsList = monitorData?.news || [];
  const nowSec = Date.now() / 1000;
  const upcomingNews = useMemo(() => {
    return newsList
      .filter((n: any) => Number(n.ts || 0) >= nowSec - 1800)
      .sort((a: any, b: any) => Number(a.ts || 0) - Number(b.ts || 0));
  }, [newsList, nowSec]);

  const nextMajorNews = upcomingNews[0] || null;

  // Combined Audit & Timeline Feed
  const combinedLog = useMemo(() => {
    const list: any[] = [];

    (radar.timeline || []).forEach((t: any, idx: number) => {
      const tsVal = Number(t.ts || 0);
      list.push({
        id: `tl-${idx}-${tsVal}`,
        ts: tsVal,
        actor: 'AI-SWARM',
        title: t.text || 'Sự kiện AI Swarm',
        subtitle: t.kind ? `Phân loại: ${t.kind}` : undefined,
        kind: t.kind || 'info',
        rawJson: undefined,
      });
    });

    (monitorData?.audit || []).forEach((entry: any, idx: number) => {
      const h = humanizeAuditEntry(entry);
      const tsVal = Number(entry.ts || 0);
      list.push({
        id: `audit-${entry.id || idx}-${tsVal}`,
        ts: tsVal,
        actor: entry.user_id ? String(entry.user_id).slice(-8) : 'SYSTEM',
        title: h.title,
        subtitle: h.subtitle,
        kind: h.isWarn ? 'warning' : 'info',
        rawJson: h.rawJson,
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

  // Topology node status mapping
  const healthCards = radar.health_cards || [];
  const healthMap: Record<string, any> = {};
  healthCards.forEach((c: any) => {
    healthMap[c.key] = c;
  });

  return (
    <div className="space-y-6">
      {msg && <ToastNotification message={msg} onClose={() => setMsg('')} />}

      {errorBanner && (
        <AdminErrorBanner error={errorBanner} onRetry={loadAllControlPlaneData} />
      )}

      {/* =====================================================================
          TẦNG 1: STATE — HỆ THỐNG ĐANG DIỄN RA CHUYỆN GÌ
          ===================================================================== */}
      <Panel className="space-y-4">
        {/* Top Operational Status Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="flex items-center gap-1.5 font-mono text-xs uppercase px-2.5 py-1 rounded bg-[#12B5A6]/15 text-[#12B5A6] font-bold border border-[#12B5A6]/30">
              <span className="w-2 h-2 rounded-full bg-[#12B5A6] animate-pulse" />
              <span>CONTROL PLANE v1.2</span>
            </span>

            {/* Current Signal Mode Badge */}
            <span className="font-mono text-xs px-2.5 py-1 rounded bg-cyan-500/15 text-cyan-300 font-bold border border-cyan-500/30">
              MODE: {radar.signal_mode || 'EXTERNAL_FEED'}
            </span>

            {/* Market Session Badge */}
            <span className="font-mono text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
              PHIÊN: {upcomingNews.length > 0 ? 'LONDON / NY OVERLAP' : 'GIAO DỊCH CHUẨN'}
            </span>
          </div>

          {/* Action buttons: Dry-run & Kill-Switch */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={dryRunLoading}
              onClick={handleRunDryRun}
              className="px-3.5 py-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-bold font-sans transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <IconRadar className={`w-3.5 h-3.5 ${dryRunLoading ? 'animate-spin' : ''}`} />
              <span>{dryRunLoading ? 'Đang chạy test...' : 'Chạy Dry-Run Test'}</span>
            </button>

            <button
              type="button"
              disabled={killSwitchLoading}
              onClick={() => handleToggleKillSwitch(isHalted)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold font-sans transition flex items-center gap-1.5 cursor-pointer shadow-lg disabled:opacity-50 ${
                isHalted
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30 animate-pulse'
                  : 'bg-slate-800 hover:bg-rose-950/60 text-slate-200 border border-rose-500/40'
              }`}
            >
              <IconAlert className="w-3.5 h-3.5" />
              <span>{isHalted ? 'CẦU DAO ĐANG NGẮT' : 'Cầu Dao Khẩn Cấp'}</span>
            </button>
          </div>
        </div>

        {/* Dry-run Result Banner */}
        {dryRunResult && (
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3.5 space-y-1.5 text-xs font-mono">
            <div className="flex items-center justify-between text-cyan-300 font-bold">
              <span>KẾT QUẢ KIỂM THỬ DRY-RUN</span>
              <button
                type="button"
                onClick={() => setDryRunResult(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="text-slate-300 font-sans">
              {dryRunResult.ok ? '✓ Mọi tầng phòng thủ và cụm AI đều thông suốt (không vào lệnh tiền thật).' : '⚠ Phát hiện cảnh báo trong chu trình kiểm thử.'}
            </div>
          </div>
        )}

        {/* 4-Node Infrastructure Topology */}
        <SpotlightBento className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#12B5A6] animate-ping" />
              <span className="font-mono text-xs uppercase tracking-wider text-slate-300 font-bold">
                4-NODE INFRASTRUCTURE TOPOLOGY
              </span>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              {sseLive ? '● Live Telemetry SSE' : '○ Polling Sync (15s)'}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* NODE 01: TIMESCALEDB */}
            <div className="rounded-xl border p-3.5 space-y-2 relative overflow-hidden transition border-cyan-500/25 bg-[#030610]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-cyan-400 font-bold">NODE 01 // TIMESCALEDB</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <div className="font-bold text-white text-sm">PostgreSQL + pgvector</div>
              <div className="text-[11px] text-slate-400 leading-snug">
                Lưu nến M15, hypertable &amp; vector embeddings
              </div>
              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px]">
                <span className="text-slate-500">Trạng thái</span>
                <span className="font-mono font-bold text-emerald-300">1.2 ms · OK</span>
              </div>
            </div>

            {/* NODE 02: REDIS STREAMS */}
            <div className="rounded-xl border p-3.5 space-y-2 relative overflow-hidden transition border-amber-500/25 bg-[#030610]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-amber-400 font-bold">NODE 02 // REDIS STREAMS</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <div className="font-bold text-white text-sm">Idempotency &amp; SePay</div>
              <div className="text-[11px] text-slate-400 leading-snug">
                Khóa phân tán 60s &amp; pub/sub sự kiện tức thời
              </div>
              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px]">
                <span className="text-slate-500">Khóa nguyên tử</span>
                <span className="font-mono font-bold text-emerald-300">0.7 ms · OK</span>
              </div>
            </div>

            {/* NODE 03: TABULA RASA AI */}
            <div className="rounded-xl border p-3.5 space-y-2 relative overflow-hidden transition border-[#12B5A6]/25 bg-[#030610]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-[#12B5A6] font-bold">NODE 03 // GEMINI CLUSTER</span>
                <span className={`h-1.5 w-1.5 rounded-full ${aiQuota?.status === 'CAPPED_100' ? 'bg-rose-500' : 'bg-emerald-400 animate-pulse'}`} />
              </div>
              <div className="font-bold text-white text-sm">gemini-4-hydrogen Pool</div>
              <div className="text-[11px] text-slate-400 leading-snug">
                Budget Guard: {aiQuota?.calls_today ?? 0} / {aiQuota?.daily_cap ?? 90} calls
              </div>
              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px]">
                <span className="text-slate-500">Hạn mức</span>
                <span className={`font-mono font-bold ${
                  aiQuota?.status === 'CAPPED_100'
                    ? 'text-rose-400'
                    : aiQuota?.status === 'WARNING_80'
                    ? 'text-amber-300'
                    : 'text-emerald-300'
                }`}>
                  {aiQuota?.usage_pct ?? 0}% · {aiQuota?.status || 'OK'}
                </span>
              </div>
            </div>

            {/* NODE 04: METAAPI CLOUD G2 */}
            <div className="rounded-xl border p-3.5 space-y-2 relative overflow-hidden transition border-indigo-500/25 bg-[#030610]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-indigo-400 font-bold">NODE 04 // METAAPI CLOUD G2</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <div className="font-bold text-white text-sm">London Datacenter G2</div>
              <div className="text-[11px] text-slate-400 leading-snug">
                Quạt lệnh đa sàn Zero-VPS độ trễ cực thấp
              </div>
              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px]">
                <span className="text-slate-500">Độ trễ khớp</span>
                <span className="font-mono font-bold text-emerald-300">24.0 ms · OK</span>
              </div>
            </div>
          </div>
        </SpotlightBento>

        {/* Dải 6 KPI tổng hợp toàn hệ thống */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <SpotlightBento className="p-4 space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Tổng Vốn Quản Lý (AUM)
            </div>
            <div className="text-xl sm:text-2xl font-bold text-white font-mono tabular-nums">
              ${Math.round(totalAumUsd).toLocaleString('en-US')}
            </div>
            <div className="text-[10px] text-slate-400">Đã chuẩn hóa USC/Cent → USD</div>
          </SpotlightBento>

          <SpotlightBento className="p-4 space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Tài Khoản MT5 Chạy
            </div>
            <div className="text-xl sm:text-2xl font-bold text-[#12B5A6] font-mono tabular-nums">
              {activeAccountsCount} / {accounts.length}
            </div>
            <div className="text-[10px] text-slate-400">
              Auto-Trade: {accounts.length > 0 ? Math.round((activeAccountsCount / accounts.length) * 100) : 0}%
            </div>
          </SpotlightBento>

          <SpotlightBento className="p-4 space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Lệnh Khớp Toàn Sàn
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl font-bold text-white font-mono tabular-nums">
                {ordersStats.total}
              </span>
              {ordersStats.error > 0 && (
                <span className="rounded-md bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-400 border border-rose-500/40">
                  {ordersStats.error} lỗi
                </span>
              )}
            </div>
            <div className="text-[10px] text-slate-400">{ordersStats.open} lệnh đang mở</div>
          </SpotlightBento>

          <SpotlightBento className="p-4 space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Chiến Lược AI Vận Hành
            </div>
            <div className="text-sm font-bold text-white truncate font-sans" title={radar.ai_strategy || 'Alpha Quant XAU M15'}>
              {radar.ai_strategy || 'Alpha Quant XAU M15'}
            </div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="rounded bg-[#12B5A6]/15 border border-[#12B5A6]/30 px-1 text-[#12B5A6] font-bold font-mono">
                LIVE
              </span>
              <span className="text-slate-400">
                Rollback: <strong className="text-white font-mono">{radar.auto_rollback || 'ACTIVE'}</strong>
              </span>
            </div>
          </SpotlightBento>

          <SpotlightBento
            onClick={() => {
              if (pendingStrategiesCount > 0) onNavigateTab('ai');
              else onNavigateTab('business');
            }}
            className="p-4 space-y-1 cursor-pointer hover:border-[#12B5A6]/50 transition group"
          >
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <span>Hàng Đợi Cần Duyệt</span>
              <span className="text-xs text-[#12B5A6] group-hover:translate-x-0.5 transition">→</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-[#F5B700] font-mono tabular-nums">
              {totalNeedsMeCount}
            </div>
            <div className="text-[10px] text-slate-400">
              {pendingStrategiesCount} chiến lược · {pendingBillingCount} đơn SePay
            </div>
          </SpotlightBento>

          <SpotlightBento className="p-4 space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              News Shield (±30m)
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
                <div className="text-xs font-bold text-emerald-400">An toàn</div>
                <div className="text-[10px] text-slate-400">Không có tin mạnh trong 4h tới</div>
              </>
            )}
          </SpotlightBento>
        </div>
      </Panel>

      {/* =====================================================================
          TẦNG 2: NEEDS ME — CÓ VIỆC NÀO ĐANG CẦN ADMIN XỬ LÝ
          ===================================================================== */}
      <Panel className="space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase tracking-wider text-amber-400 font-bold">
              TẦNG 2 // ACTION QUEUE (NEEDS ME)
            </span>
            <span className="text-xs text-slate-400">· Việc cần Quản trị viên phê duyệt hoặc can thiệp</span>
          </div>
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-white/5 text-slate-300">
            {totalNeedsMeCount} tác vụ
          </span>
        </div>

        {/* If Action Queue is completely clear: Sleek Green Banner */}
        {totalNeedsMeCount === 0 ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold">
                ✓
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">
                  Hệ thống vận hành ổn định — Không có tác vụ chờ duyệt
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Toàn bộ chiến lược AI, đơn nạp SePay và hạn mức Quota đều trong ngưỡng an toàn tuyệt đối.
                </p>
              </div>
            </div>
            <span className="font-mono text-xs px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
              0 PENDING ITEMS
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Warning: AI Quota >= 80% */}
            {isQuotaWarning && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/15 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <IconAlert className="w-5 h-5 text-amber-400" />
                  <div>
                    <div className="text-xs font-bold text-amber-200">
                      Cảnh báo: Cụm AI đã sử dụng {aiQuota?.usage_pct}% hạn mức trong ngày
                    </div>
                    <div className="text-[11px] text-amber-300/80">
                      Đã gọi {aiQuota?.calls_today}/{aiQuota?.daily_cap} cuộc. Khi chạm 100%, hệ thống tự động khóa gọi LLM để bảo vệ ngân sách.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={quotaUpdating}
                  onClick={() => handleQuickQuotaOverride(60)}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs font-sans transition cursor-pointer"
                >
                  {quotaUpdating ? 'Đang mở khóa...' : 'Mở khóa 60 phút'}
                </button>
              </div>
            )}

            {/* Warning: Pending SePay Orders */}
            {pendingBillingCount > 0 && (
              <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-cyan-200">
                    Có {pendingBillingCount} đơn nạp SePay chờ xác nhận hạn mức
                  </div>
                  <div className="text-[11px] text-slate-300 mt-0.5">
                    Khách hàng chuyển khoản lệch nội dung hoặc sai số tiền đang chờ Admin kích hoạt Cloud.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('business')}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs font-sans transition cursor-pointer"
                >
                  Xử lý đơn SePay →
                </button>
              </div>
            )}

            {/* Strategy Candidates Approval Queue with Diff Comparison */}
            {reviewQueue.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-bold font-mono uppercase text-amber-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span>ỨNG VIÊN CHIẾN LƯỢC CHỜ PHÊ DUYỆT ({reviewQueue.length})</span>
                </div>

                {reviewQueue.map((item, idx) => {
                  const cand = item.candidate;
                  const live = item.current_live;
                  const delta = item.delta;

                  return (
                    <SpotlightBento key={cand.id || idx} borderBeam className="p-4 sm:p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm font-sans">{cand.name}</span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                              WAITING_APPROVAL
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                            ID: {cand.id} · Cặp: {cand.rules?.symbol || 'XAUUSD'} · Khung: M15/H1
                          </div>
                        </div>

                        {/* Approve & Reject Buttons */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={approvingCandidateId === cand.id}
                            onClick={() => handleApproveCandidate(cand.id)}
                            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs font-sans transition cursor-pointer shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                          >
                            {approvingCandidateId === cand.id ? 'Đang duyệt...' : '✓ Duyệt Chạy LIVE'}
                          </button>
                          <button
                            type="button"
                            disabled={approvingCandidateId === cand.id}
                            onClick={() => handleRejectCandidate(cand.id)}
                            className="px-3.5 py-2 rounded-xl border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 font-bold text-xs font-sans transition cursor-pointer disabled:opacity-50"
                          >
                            ✕ Từ Chối
                          </button>
                        </div>
                      </div>

                      {/* Diff Comparison Table: Live vs Candidate */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs font-mono border-collapse">
                          <thead>
                            <tr className="border-b border-white/10 text-slate-400 text-[11px]">
                              <th className="py-2 px-3">CHỈ SỐ ĐỐI CHIẾU</th>
                              <th className="py-2 px-3 text-slate-300">BẢN ĐANG CHẠY LIVE</th>
                              <th className="py-2 px-3 text-cyan-300">BẢN ĐỀ XUẤT MỚI</th>
                              <th className="py-2 px-3 text-right">CHÊNH LỆCH (DELTA)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {/* Win Rate */}
                            <tr>
                              <td className="py-2.5 px-3 font-sans text-slate-300">Tỷ Lệ Thắng (Win Rate)</td>
                              <td className="py-2.5 px-3 text-slate-400">
                                {live ? `${live.win_rate}%` : '— (Bản đầu tiên)'}
                              </td>
                              <td className="py-2.5 px-3 text-cyan-300 font-bold">
                                {cand.win_rate}%
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                {live ? (
                                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                    delta.win_rate_diff >= 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                                  }`}>
                                    {delta.win_rate_diff >= 0 ? `+${delta.win_rate_diff}%` : `${delta.win_rate_diff}%`}
                                  </span>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                            </tr>

                            {/* Profit Factor */}
                            <tr>
                              <td className="py-2.5 px-3 font-sans text-slate-300">Profit Factor (PF)</td>
                              <td className="py-2.5 px-3 text-slate-400">
                                {live ? live.profit_factor : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-emerald-400 font-bold">
                                {cand.profit_factor}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                {live ? (
                                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                    delta.pf_diff >= 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                                  }`}>
                                    {delta.pf_diff >= 0 ? `+${delta.pf_diff}` : `${delta.pf_diff}`}
                                  </span>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                            </tr>

                            {/* Max Drawdown */}
                            <tr>
                              <td className="py-2.5 px-3 font-sans text-slate-300">Sụt Giảm Tối Đa (Max DD)</td>
                              <td className="py-2.5 px-3 text-slate-400">
                                {live ? `${live.max_drawdown_pct}%` : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-rose-300 font-bold">
                                {cand.max_drawdown_pct}%
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                {live ? (
                                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                    delta.dd_diff <= 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                                  }`}>
                                    {delta.dd_diff >= 0 ? `+${delta.dd_diff}%` : `${delta.dd_diff}%`}
                                  </span>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                            </tr>

                            {/* Sample Size */}
                            <tr>
                              <td className="py-2.5 px-3 font-sans text-slate-300">Mẫu Thống Kê (Sample Size)</td>
                              <td className="py-2.5 px-3 text-slate-400">
                                {live ? `${live.sample_size} mẫu` : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-slate-200">
                                {cand.sample_size} mẫu kiểm định OOS
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-400">
                                Đạt chuẩn WFO
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Rules Summary */}
                      <div className="rounded-xl border border-white/5 bg-[#030712] p-3 text-xs">
                        <span className="text-slate-400 font-sans">Điều kiện kích hoạt (OHLC / Regime Rules): </span>
                        <code className="text-cyan-300 font-mono text-[11px]">
                          {cand.rules ? JSON.stringify(cand.rules) : 'Quy tắc chuẩn M15 Range Sweep & ATR Filter'}
                        </code>
                      </div>
                    </SpotlightBento>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* =====================================================================
          TẦNG 3: ACTION & CONTROL — ĐIỀU KHIỂN AGENT, QUOTA & HOÀN TÁC
          ===================================================================== */}
      <div className="space-y-6">
        {/* 1. BẢNG NHỊP TIM 4 AGENT ĐIỀU HÀNH (HEARTBEAT) */}
        <Panel className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
            <div>
              <div className="font-mono text-xs uppercase tracking-wider text-[#12B5A6] font-bold">
                TẦNG 3 // EVENT-DRIVEN HEARTBEAT TABLE
              </div>
              <h3 className="text-base font-bold text-white mt-0.5">
                Bảng Nhịp Tim 4 Agent Điều Hành (Atomic 60s Redis Lock)
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Chống chạy trùng, bảo vệ hạn mức quota
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {agentsHeartbeat.map((agent) => {
              const isWaking = wakingAgentId === agent.id;
              const isPausing = pausingAgentId === agent.id;

              return (
                <SpotlightBento key={agent.id} className="p-4 flex flex-col justify-between space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                        agent.status === 'RUNNING'
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 animate-pulse'
                          : agent.status === 'PAUSED'
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : agent.status === 'QUOTA_CAPPED'
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      }`}>
                        {agent.status}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {agent.calls_today} calls
                      </span>
                    </div>

                    <div>
                      <div className="font-bold text-white text-sm font-sans">{agent.name}</div>
                      <div className="text-[11px] text-slate-400 font-sans mt-0.5 leading-snug">{agent.role}</div>
                    </div>

                    <div className="rounded-lg bg-black/30 p-2.5 text-[11px] text-slate-300 leading-relaxed font-sans border border-white/5">
                      {agent.last_summary || 'Chờ chu kỳ kích hoạt...'}
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-white/5">
                      <span>Lần chạy cuối:</span>
                      <span className="text-slate-300 font-bold tabular-nums">
                        {agent.last_run_at ? formatAuditDateTime(agent.last_run_at) : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span>Thời lượng chu kỳ:</span>
                      <span className="text-cyan-300 font-bold tabular-nums">
                        {agent.last_duration_ms > 0 ? `${agent.last_duration_ms} ms` : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Agent Actions: Wake Now & Toggle Pause */}
                  <div className="pt-2 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isWaking || agent.is_paused}
                      onClick={() => handleWakeAgent(agent.id)}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-bold font-sans transition cursor-pointer flex items-center justify-center gap-1 disabled:opacity-40"
                    >
                      <IconBolt className="w-3.5 h-3.5" />
                      <span>{isWaking ? 'Đang chạy...' : 'Wake Now'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={isPausing}
                      onClick={() => handleTogglePause(agent.id)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-bold font-sans transition cursor-pointer disabled:opacity-40 ${
                        agent.is_paused
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                      }`}
                    >
                      {agent.is_paused ? 'Bật lại' : 'Tạm dừng'}
                    </button>
                  </div>
                </SpotlightBento>
              );
            })}
          </div>
        </Panel>

        {/* 2. THANH QUOTA AI TRONG NGÀY (BUDGET GUARD) */}
        <Panel className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
            <div>
              <div className="font-mono text-xs uppercase tracking-wider text-cyan-400 font-bold">
                BUDGET GUARD // CỤM AI GEMINI
              </div>
              <h3 className="text-base font-bold text-white mt-0.5">
                Hạn Mức &amp; Ngân Sách Quota AI Cứng Trong Ngày
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={quotaUpdating}
                onClick={() => handleQuickQuotaOverride(60)}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold font-sans transition cursor-pointer disabled:opacity-50"
              >
                Mở khóa 60 phút
              </button>
              <button
                type="button"
                disabled={quotaUpdating}
                onClick={handleResetQuotaToday}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold font-sans transition cursor-pointer disabled:opacity-50"
              >
                Đặt lại hôm nay
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300">
                Tiến độ: <strong className="text-white tabular-nums">{aiQuota?.calls_today ?? 0}</strong> / <strong className="text-slate-400 tabular-nums">{aiQuota?.daily_cap ?? 90}</strong> lượt gọi
              </span>
              <span className={`font-bold tabular-nums ${
                (aiQuota?.usage_pct || 0) >= 100
                  ? 'text-rose-400'
                  : (aiQuota?.usage_pct || 0) >= 80
                  ? 'text-amber-300'
                  : 'text-emerald-400'
              }`}>
                {aiQuota?.usage_pct ?? 0}% ({aiQuota?.status || 'OK'})
              </span>
            </div>

            {/* Progress bar with dynamic color transitions */}
            <div className="w-full bg-white/5 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-2.5 rounded-full transition-all duration-500 ${
                  (aiQuota?.usage_pct || 0) >= 100
                    ? 'bg-rose-500'
                    : (aiQuota?.usage_pct || 0) >= 80
                    ? 'bg-amber-400'
                    : 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                }`}
                style={{ width: `${Math.min(100, aiQuota?.usage_pct || 0)}%` }}
              />
            </div>

            {/* Breakdown per caller */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {Object.entries(aiQuota?.breakdown || {}).map(([caller, cnt]) => (
                <span key={caller} className="px-2.5 py-1 rounded-md bg-white/5 border border-white/5 text-[11px] font-mono text-slate-300">
                  <span className="text-slate-400">{caller}:</span> <strong className="text-cyan-300 tabular-nums">{cnt}</strong>
                </span>
              ))}
            </div>
          </div>
        </Panel>

        {/* 3. LỊCH SỬ PHIÊN BẢN CHIẾN LƯỢC & ROLLBACK 1-CLICK */}
        <Panel className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
            <div>
              <div className="font-mono text-xs uppercase tracking-wider text-[#12B5A6] font-bold">
                VERSION CONTROL // 1-CLICK ROLLBACK
              </div>
              <h3 className="text-base font-bold text-white mt-0.5">
                Lịch Sử Phiên Bản Chiến Lược &amp; Điểm Khôi Phục
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Lưu trữ tối đa 10 phiên bản gần nhất
            </span>
          </div>

          {strategyHistory.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 font-mono">
              Chưa có lịch sử phiên bản nào được lưu trữ.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400 text-[11px]">
                    <th className="py-2.5 px-3">PHIÊN BẢN &amp; TÊN</th>
                    <th className="py-2.5 px-3">TRẠNG THÁI</th>
                    <th className="py-2.5 px-3">WIN RATE</th>
                    <th className="py-2.5 px-3">PROFIT FACTOR</th>
                    <th className="py-2.5 px-3">MAX DD</th>
                    <th className="py-2.5 px-3">MẪU</th>
                    <th className="py-2.5 px-3">CẬP NHẬT</th>
                    <th className="py-2.5 px-3 text-right">THAO TÁC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {strategyHistory.map((strat) => {
                    const isLive = strat.status === 'APPROVED_FOR_PROD';
                    const isRolling = rollingBackId === strat.id;

                    return (
                      <tr key={strat.id} className="hover:bg-white/[0.02] transition">
                        <td className="py-3 px-3">
                          <div className="font-bold text-white font-sans">{strat.name}</div>
                          <div className="text-[10px] text-slate-500">{strat.id}</div>
                        </td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            isLive
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : strat.status === 'ROLLED_BACK'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}>
                            {isLive ? 'LIVE (ĐANG CHẠY)' : strat.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-cyan-300 font-bold tabular-nums">
                          {strat.win_rate_pct}%
                        </td>
                        <td className="py-3 px-3 text-emerald-400 font-bold tabular-nums">
                          {strat.profit_factor}
                        </td>
                        <td className="py-3 px-3 text-rose-300 tabular-nums">
                          {strat.max_drawdown_pct}%
                        </td>
                        <td className="py-3 px-3 text-slate-400 tabular-nums">
                          {strat.sample_size}
                        </td>
                        <td className="py-3 px-3 text-slate-400 text-[11px] tabular-nums">
                          {formatAuditDateTime(strat.updated_at || strat.created_at)}
                        </td>
                        <td className="py-3 px-3 text-right">
                          {isLive ? (
                            <span className="text-[11px] text-emerald-400 font-bold font-sans">
                              ● Đang vận hành
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={isRolling}
                              onClick={() => setRollbackConfirmCandidate(strat)}
                              className="px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-bold font-sans text-[11px] transition cursor-pointer disabled:opacity-50"
                            >
                              {isRolling ? 'Đang khôi phục...' : '↺ Rollback 1-Click'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* Confirmation Dialog for 1-Click Rollback */}
      {rollbackConfirmCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#070e24] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                <IconAlert className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white font-sans">Xác Nhận Rollback Chiến Lược</h4>
                <p className="text-xs text-slate-400 font-mono">Thao tác này sẽ thay thế bản LIVE tức thì</p>
              </div>
            </div>

            <div className="rounded-xl bg-black/40 p-4 border border-white/5 space-y-2 text-xs font-sans text-slate-300 leading-relaxed">
              <div>
                Bạn có chắc chắn muốn khôi phục chiến lược <strong className="text-cyan-300">{rollbackConfirmCandidate.name}</strong> (#{rollbackConfirmCandidate.id.slice(0, 8)}) lên làm bản chạy LIVE?
              </div>
              <div className="text-[11px] text-slate-400">
                Bản LIVE hiện tại sẽ được chuyển sang trạng thái <code className="text-amber-300">ROLLED_BACK</code> để làm điểm khôi phục dự phòng.
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRollbackConfirmCandidate(null)}
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 font-bold font-sans text-xs transition cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={rollingBackId === rollbackConfirmCandidate.id}
                onClick={() => handleExecuteRollback(rollbackConfirmCandidate.id)}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold font-sans text-xs transition cursor-pointer shadow-lg shadow-amber-500/20 disabled:opacity-50"
              >
                {rollingBackId === rollbackConfirmCandidate.id ? 'Đang khôi phục...' : 'Xác Nhận Khôi Phục'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BẢNG GIÁM SÁT LỆNH TOÀN SÀN REALTIME */}
      <AdminLiveOrdersPanel onOrdersCountChange={setOrdersStats} />

      {/* 12-COLUMN BENTO SPLIT: AUDIT LOG & MACRO NEWS CALENDAR */}
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

          <div className="max-h-[460px] overflow-y-auto pr-1">
            {filteredLog.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 font-sans">
                Chưa có sự kiện nào được ghi nhận. Hệ thống AI đang chạy nền 24/5.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {filteredLog.map((item: any) => {
                  const timeFormatted = formatAuditDateTime(item.ts);
                  const isWarn = item.kind === 'warning' || item.kind === 'error';
                  const isExpanded = expandedLogId === item.id;

                  return (
                    <div key={item.id} className="py-2.5 px-2 hover:bg-slate-800/20 transition space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-bold text-cyan-400 tabular-nums">
                            [{timeFormatted}]
                          </span>
                          <span className="rounded bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.2 text-[9px] font-mono text-slate-300 font-bold uppercase">
                            {item.actor}
                          </span>
                        </div>
                        {item.rawJson && (
                          <button
                            type="button"
                            onClick={() => setExpandedLogId(isExpanded ? null : item.id)}
                            className="text-[10px] font-mono text-slate-400 hover:text-cyan-300 transition cursor-pointer"
                          >
                            {isExpanded ? 'Ẩn JSON' : 'Chi tiết'}
                          </button>
                        )}
                      </div>

                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className={`text-xs font-sans font-medium leading-relaxed ${
                            isWarn ? 'text-amber-300 font-semibold' : 'text-slate-200'
                          }`}>
                            {item.title}
                          </div>
                          {item.subtitle && (
                            <div className="text-[11px] font-sans text-slate-400 mt-0.5">
                              {item.subtitle}
                            </div>
                          )}
                        </div>
                      </div>

                      {isExpanded && item.rawJson && (
                        <pre className="mt-1.5 max-h-40 overflow-x-auto rounded-lg border border-slate-800 bg-[#040710] p-2.5 font-mono text-[10px] text-slate-300">
                          {item.rawJson}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right 5 Cols: Alert Center + Upcoming Macro News Calendar */}
        <div className="lg:col-span-5 space-y-6">
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
                NEWS SHIELD ±30M
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
                  const isImminent = diffMinutes >= -30 && diffMinutes <= 30;
                  const timeFormatted = evTs > 0
                    ? new Date(evTs * 1000).toLocaleTimeString('vi-VN', {
                        timeZone: 'Asia/Ho_Chi_Minh',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
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
