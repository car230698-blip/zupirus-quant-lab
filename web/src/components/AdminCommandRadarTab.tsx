import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  fetchAdminAgentsHeartbeat,
  wakeAdminAgent,
  togglePauseAdminAgent,
  fetchAdminAiQuota,
  fetchStrategyReviewQueue,
  approveStrategy,
  rejectStrategy,
  AdminAgentHeartbeat,
  AdminAiQuota,
  StrategyReviewQueueItem,
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
  return `${date} ${time}`;
}

export function humanizeAuditEntry(entry: any): { title: string; subtitle?: string; isWarn: boolean; rawJson?: string } {
  if (!entry) return { title: 'Bản ghi rỗng', isWarn: false };
  const action = String(entry.action || entry.kind || 'EVENT').toUpperCase();
  const detail = entry.detail || entry.message || entry.error || '';
  const isWarn = action.includes('ERROR') || action.includes('WARN') || action.includes('FAIL') || Boolean(entry.error);

  let rawJson: string | undefined;
  if (typeof entry === 'object') {
    try {
      rawJson = JSON.stringify(entry, null, 2);
    } catch {
      // ignore
    }
  }

  switch (action) {
    case 'LOGIN':
    case 'AUTH_LOGIN':
      return { title: `Đăng nhập hệ thống: ${detail || entry.user_id || 'Quản trị viên'}`, isWarn: false, rawJson };
    case 'LOGOUT':
      return { title: 'Đăng xuất phiên làm việc', isWarn: false, rawJson };
    case 'KILL_SWITCH':
    case 'KILL_SWITCH_TRIGGERED':
      return { title: 'Cầu dao khẩn cấp (Kill-Switch) được kích hoạt', subtitle: detail, isWarn: true, rawJson };
    case 'ACCOUNT_CONNECTED':
      return { title: 'Tài khoản MT5 mới kết nối', subtitle: detail, isWarn: false, rawJson };
    case 'ACCOUNT_DISCONNECTED':
      return { title: 'Tài khoản MT5 bị ngắt kết nối', subtitle: detail, isWarn: true, rawJson };
    case 'ORDER_DISPATCH':
    case 'ORDER_FILLED':
      return { title: `Khớp lệnh tự động: ${detail}`, isWarn: false, rawJson };
    case 'ORDER_REJECTED':
      return { title: `Lệnh bị từ chối: ${detail}`, isWarn: true, rawJson };
    case 'AGENT_WAKE':
      return { title: `Đánh thức Agent: ${detail}`, isWarn: false, rawJson };
    case 'AGENT_PAUSE':
      return { title: `Tạm dừng Agent: ${detail}`, isWarn: true, rawJson };
    case 'STRATEGY_APPROVED':
      return { title: `Phê duyệt chiến lược: ${detail}`, isWarn: false, rawJson };
    case 'STRATEGY_REJECTED':
      return { title: `Từ chối chiến lược: ${detail}`, isWarn: false, rawJson };
    case 'STRATEGY_ROLLBACK':
      return { title: `Khôi phục chiến lược (Rollback): ${detail}`, isWarn: true, rawJson };
    case 'QUOTA_OVERRIDE':
      return { title: `Mở rộng hạn mức Quota: ${detail}`, isWarn: false, rawJson };
    case 'SEPAY_WEBHOOK':
      return { title: `Tín hiệu SePay: ${detail}`, isWarn: false, rawJson };
    default:
      return {
        title: entry.title || `${action}: ${detail || 'Sự kiện hệ thống'}`,
        subtitle: entry.subtitle,
        isWarn,
        rawJson,
      };
  }
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
    ai_strategy: 'Alpha Quant XAU M15',
    auto_rollback: 'ACTIVE',
    timeline: [],
    alerts: [],
    health_cards: [],
  });
  const [msg, setMsg] = useState<string>('');
  const [auditFilter, setAuditFilter] = useState<'ALL' | 'WARN_ERR'>('ALL');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<AdminErrorInfo | null>(null);
  const [ordersStats, setOrdersStats] = useState<{ total: number; open: number; error: number }>({ total: 0, open: 0, error: 0 });
  const [bottomTab, setBottomTab] = useState<'audit' | 'news'>('audit');

  // Control Plane v1.2.1 State
  const [agentsHeartbeat, setAgentsHeartbeat] = useState<AdminAgentHeartbeat[]>([]);
  const [aiQuota, setAiQuota] = useState<AdminAiQuota | null>(null);
  const [reviewQueue, setReviewQueue] = useState<StrategyReviewQueueItem[]>([]);
  const [wakingAgentId, setWakingAgentId] = useState<string | null>(null);
  const [pausingAgentId, setPausingAgentId] = useState<string | null>(null);
  const [actioningStrategyId, setActioningStrategyId] = useState<string | null>(null);

  // Dry-run & Mode Toggle
  const [signalMode, setSignalMode] = useState<'EXTERNAL_FEED' | 'HYBRID_AGENT_SCORER' | 'ZUPIRUS_AGENT'>('HYBRID_AGENT_SCORER');
  const [dryRunRunning, setDryRunRunning] = useState<boolean>(false);
  const [dryRunResult, setDryRunResult] = useState<any | null>(null);
  const [sseLive, setSseLive] = useState<boolean>(false);

  // Load telemetry & control plane data
  const loadAllControlPlaneData = useCallback(async () => {
    try {
      const [rData, hbRes, quotaData, queueRes] = await Promise.all([
        api.get<any>('/api/v1/telemetry/admin-radar'),
        fetchAdminAgentsHeartbeat().catch(() => ({ total: 0, agents: [] })),
        fetchAdminAiQuota().catch(() => null),
        fetchStrategyReviewQueue().catch(() => ({ total: 0, queue: [] })),
      ]);
      if (rData) setRadar(rData);
      if (hbRes && Array.isArray(hbRes.agents)) setAgentsHeartbeat(hbRes.agents);
      if (quotaData) setAiQuota(quotaData);
      if (queueRes && Array.isArray(queueRes.queue)) setReviewQueue(queueRes.queue);
      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner({
        status: err?.status,
        message: err?.message || 'Không thể đồng bộ Control Plane v1.2.1 với cụm máy chủ.',
      });
    }
  }, []);

  // Sync mode from system info on mount
  useEffect(() => {
    loadAllControlPlaneData();
    api.get<any>('/api/v1/system/info').then((info: any) => {
      if (info?.signal_mode) {
        setSignalMode(info.signal_mode as any);
      }
    }).catch(() => {});
  }, [loadAllControlPlaneData]);

  // Polling every 15s
  useEffect(() => {
    const timer = setInterval(() => {
      loadAllControlPlaneData();
    }, 15000);
    return () => clearInterval(timer);
  }, [loadAllControlPlaneData]);

  // Realtime SSE listener
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/v1/telemetry/stream');
      es.onopen = () => setSseLive(true);
      es.onerror = () => setSseLive(false);
      es.addEventListener('radar', (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload) {
            setRadar((prev: any) => ({ ...prev, ...payload }));
          }
        } catch {
          // ignore
        }
      });
      es.addEventListener('heartbeat', (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (Array.isArray(payload)) setAgentsHeartbeat(payload);
        } catch {
          // ignore
        }
      });
    } catch {
      setSseLive(false);
    }
    return () => {
      if (es) es.close();
    };
  }, []);

  // Action Handlers
  const handleWakeAgent = async (agentId: string) => {
    setWakingAgentId(agentId);
    try {
      const res = await wakeAdminAgent(agentId);
      if (res.ok) {
        setMsg(`✓ ${res.message || `Đã đánh thức agent ${agentId} thành công.`}`);
      } else {
        setMsg(`⚠ ${res.message || 'Không thể đánh thức agent'}`);
      }
      await loadAllControlPlaneData();
    } catch (err: any) {
      setMsg(`Lỗi kích hoạt agent: ${err?.message || 'Thất bại'}`);
    } finally {
      setWakingAgentId(null);
    }
  };

  const handleTogglePause = async (agentId: string) => {
    setPausingAgentId(agentId);
    try {
      const res = await togglePauseAdminAgent(agentId);
      setMsg(res.message || 'Đã cập nhật trạng thái tạm dừng của agent.');
      await loadAllControlPlaneData();
    } catch (err: any) {
      setMsg(`Lỗi tạm dừng agent: ${err?.message || 'Thất bại'}`);
    } finally {
      setPausingAgentId(null);
    }
  };

  const handleStrategyDecision = async (candidateId: string, approved: boolean) => {
    setActioningStrategyId(candidateId);
    try {
      if (approved) {
        const res = await approveStrategy(candidateId);
        setMsg(res.message || `✓ Đã phê duyệt chiến lược #${candidateId.slice(0, 8)} lên Production.`);
      } else {
        const res = await rejectStrategy(candidateId);
        setMsg(res.message || `Đã từ chối chiến lược #${candidateId.slice(0, 8)}.`);
      }
      await loadAllControlPlaneData();
      if (refetchMonitor) await refetchMonitor();
    } catch (err: any) {
      setMsg(`Lỗi xử lý chiến lược: ${err?.message || 'Thất bại'}`);
    } finally {
      setActioningStrategyId(null);
    }
  };

  const handleAlertAction = async (alert: any) => {
    setBusyId(alert.id);
    try {
      if (alert.action_type === 'QUOTA_OVERRIDE') {
        onNavigateTab('ai');
      } else if (alert.action_type === 'RECONCILE_BILLING') {
        onNavigateTab('business');
      } else if (alert.action_type === 'RETRY_CLOUD_DEPLOY') {
        const res = await api.post('/api/admin-radar/retry-pending', {});
        setMsg(res?.message || 'Đã gửi yêu cầu triển khai lại các tài khoản MT5 đang chờ.');
        await loadAllControlPlaneData();
        if (refetchMonitor) await refetchMonitor();
      } else {
        setMsg(`Đang điều hướng xử lý: ${alert.title}`);
      }
    } catch (err: any) {
      setMsg(`Thao tác thất bại: ${err?.message || 'Lỗi không xác định'}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleSwitchSignalMode = async (mode: 'EXTERNAL_FEED' | 'HYBRID_AGENT_SCORER' | 'ZUPIRUS_AGENT') => {
    try {
      await api.post('/api/admin/system/signal-mode', { mode });
      setSignalMode(mode);
      setMsg(`✓ Đã chuyển chế độ tín hiệu sang: ${mode}`);
    } catch (err: any) {
      setMsg(`Không thể chuyển chế độ: ${err?.message || 'Thất bại'}`);
    }
  };

  const handleRunDryRun = async () => {
    setDryRunRunning(true);
    setDryRunResult(null);
    try {
      const res = await api.post('/api/v1/telemetry/dry-run', {});
      setDryRunResult(res);
      setMsg('✓ Dry-run hoàn tất: Đã kiểm tra chu trình tạo tín hiệu không rủi ro.');
    } catch (err: any) {
      setMsg(`Lỗi Dry-run: ${err?.message || 'Thất bại'}`);
    } finally {
      setDryRunRunning(false);
    }
  };

  const isHalted = Boolean(radar.halted || monitorData?.halted);

  // KPI Computations
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

  // Upcoming Macro News (Shield threshold: ±15 minutes)
  const newsList = monitorData?.news || [];
  const nowSec = Date.now() / 1000;
  const upcomingNews = useMemo(() => {
    return newsList
      .filter((n: any) => Number(n.ts || 0) >= nowSec - 900)
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

  // Topology node status mapping from live backend health cards
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
          TẦNG 1: STATE — HỆ THỐNG ĐANG DIỄN RA CHUYỆN GÌ (TOÀN BỘ SÀN)
          ===================================================================== */}
      <div className="space-y-4">
        {/* Top Control Bar: Mode Toggle + Session Badge + Dry-run + Kill Switch */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-[#050A18] border border-white/[0.08] rounded-2xl shadow-xl">
          <div className="flex flex-wrap items-center gap-3">
            {/* Signal Mode Switch */}
            <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/40 p-1 text-xs font-mono">
              <span className="text-[10px] text-slate-400 px-2 font-bold uppercase tracking-wider">CHẾ ĐỘ TÍN HIỆU:</span>
              {(['EXTERNAL_FEED', 'HYBRID_AGENT_SCORER', 'ZUPIRUS_AGENT'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleSwitchSignalMode(m)}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer font-bold ${
                    signalMode === m
                      ? 'bg-[#12B5A6] text-slate-950 shadow-md shadow-[#12B5A6]/20'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m === 'EXTERNAL_FEED' ? 'Ngoại Vi' : m === 'HYBRID_AGENT_SCORER' ? 'Mô Hình Lai' : 'Tự Trị 100%'}
                </button>
              ))}
            </div>

            {/* Market Session Status */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-black/40 text-xs font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-300">
                Phiên: <strong className="text-white uppercase">{radar.market_session || 'New York'}</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Dry-run test button */}
            <button
              type="button"
              disabled={dryRunRunning}
              onClick={handleRunDryRun}
              className="px-3.5 py-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-bold font-mono transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <IconRadar className="w-3.5 h-3.5" />
              <span>{dryRunRunning ? 'Đang chạy test...' : 'Chạy Dry-Run Test'}</span>
            </button>

            {/* Emergency Kill Switch */}
            <button
              type="button"
              disabled={killSwitchLoading}
              onClick={() => handleToggleKillSwitch(isHalted)}
              className={`px-4 py-2 rounded-xl text-xs font-bold font-mono transition flex items-center gap-2 cursor-pointer shadow-lg disabled:opacity-50 ${
                isHalted
                  ? 'bg-rose-500 text-white hover:bg-rose-600 shadow-rose-500/20 animate-pulse'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${isHalted ? 'bg-white' : 'bg-emerald-400'}`} />
              <span>{isHalted ? 'CẦU DAO ĐANG NGẮT (DỪNG SÀN)' : 'CẦU DAO BÌNH THƯỜNG'}</span>
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

        {/* 1.1. THANH ĐÈN TÍN HIỆU HẠ TẦNG 4-NODE (GỌN GÀNG, BỎ SỐ HARDCODE GIẢ) */}
        <SpotlightBento className="px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center gap-2 text-slate-300 font-bold">
              <span className="h-2 w-2 rounded-full bg-[#12B5A6] animate-pulse" />
              <span className="tracking-wider uppercase text-[11px]">HẠ TẦNG HỆ THỐNG:</span>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-[11px]">
              {/* Node 1: TimescaleDB / Postgres */}
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${healthMap['market_data']?.ok !== false ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className="text-slate-400">PostgreSQL/Timescale:</span>
                <span className={`font-bold ${healthMap['market_data']?.ok !== false ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {healthMap['market_data']?.ok !== false ? 'ONLINE' : (healthMap['market_data']?.status_text || 'WARN')}
                </span>
              </div>

              {/* Node 2: Redis Streams */}
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-slate-400">Redis Streams:</span>
                <span className="text-emerald-300 font-bold">ONLINE</span>
              </div>

              {/* Node 3: Gemini AI Pool */}
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${aiQuota?.status === 'CAPPED_100' ? 'bg-rose-500' : 'bg-emerald-400'}`} />
                <span className="text-slate-400">Gemini Pool:</span>
                <span className={`font-bold ${aiQuota?.status === 'CAPPED_100' ? 'text-rose-400' : 'text-emerald-300'}`}>
                  {aiQuota?.calls_today ?? 0}/{aiQuota?.daily_cap ?? 90} ({aiQuota?.status || 'OK'})
                </span>
              </div>

              {/* Node 4: MetaApi Cloud G2 */}
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${healthMap['metaapi']?.ok !== false ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className="text-slate-400">MetaApi G2:</span>
                <span className={`font-bold ${healthMap['metaapi']?.ok !== false ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {healthMap['metaapi']?.status_text || 'ONLINE'}
                </span>
              </div>
            </div>

            <span className="text-[10px] text-slate-500">
              {sseLive ? '● SSE Live' : '○ Polling 15s'}
            </span>
          </div>
        </SpotlightBento>

        {/* Dải 6 KPI tổng hợp toàn hệ thống */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <SpotlightBento className="p-4 space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 font-sans">
              Tổng Vốn Quản Lý (AUM)
            </div>
            <div className="text-xl sm:text-2xl font-bold text-white font-mono tabular-nums">
              ${Math.round(totalAumUsd).toLocaleString('en-US')}
            </div>
            <div className="text-[10px] text-slate-400 font-sans">Đã chuẩn hóa USC/Cent → USD</div>
          </SpotlightBento>

          <SpotlightBento className="p-4 space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 font-sans">
              Tài Khoản MT5 Chạy
            </div>
            <div className="text-xl sm:text-2xl font-bold text-[#12B5A6] font-mono tabular-nums">
              {activeAccountsCount} / {accounts.length}
            </div>
            <div className="text-[10px] text-slate-400 font-sans">
              Auto-Trade: {accounts.length > 0 ? Math.round((activeAccountsCount / accounts.length) * 100) : 0}%
            </div>
          </SpotlightBento>

          <SpotlightBento className="p-4 space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 font-sans">
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
            <div className="text-[10px] text-slate-400 font-sans">{ordersStats.open} lệnh đang mở</div>
          </SpotlightBento>

          <SpotlightBento className="p-4 space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 font-sans">
              Chiến Lược AI Vận Hành
            </div>
            <div className="text-sm font-bold text-white truncate font-sans" title={radar.ai_strategy || 'Alpha Quant XAU M15'}>
              {radar.ai_strategy || 'Alpha Quant XAU M15'}
            </div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="rounded bg-[#12B5A6]/15 border border-[#12B5A6]/30 px-1 text-[#12B5A6] font-bold font-mono">
                LIVE
              </span>
              <span className="text-slate-400 font-sans">
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
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400 font-sans">
              <span>Hàng Đợi Cần Duyệt</span>
              <span className="text-xs text-[#12B5A6] group-hover:translate-x-0.5 transition">→</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-[#F5B700] font-mono tabular-nums">
              {totalNeedsMeCount}
            </div>
            <div className="text-[10px] text-slate-400 font-sans">
              {pendingStrategiesCount} chiến lược · {pendingBillingCount} đơn SePay
            </div>
          </SpotlightBento>

          <SpotlightBento className="p-4 space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 font-sans">
              News Shield (±15m)
            </div>
            {nextMajorNews ? (
              <>
                <div className="text-xs font-bold text-amber-300 truncate font-sans" title={nextMajorNews.title}>
                  {nextMajorNews.title} ({nextMajorNews.currency})
                </div>
                <div className="text-[10px] text-slate-400 font-sans">
                  {Math.max(0, Math.round((Number(nextMajorNews.ts) - nowSec) / 60))} phút tới cửa sổ khóa lệnh
                </div>
              </>
            ) : (
              <>
                <div className="text-xs font-bold text-emerald-400 font-sans">An toàn</div>
                <div className="text-[10px] text-slate-400 font-sans">Không có tin đỏ trong 24h</div>
              </>
            )}
          </SpotlightBento>
        </div>
      </div>

      {/* =====================================================================
          TẦNG 2: NEEDS ME — DANH SÁCH DUYỆT CHIẾN LƯỢC & HÀNG ĐỢI XỬ LÝ
          ===================================================================== */}
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="font-mono text-xs uppercase tracking-wider text-[#F5B700] font-bold">
              TẦNG 2 // ACTION QUEUE (NEEDS ME)
            </div>
            {totalNeedsMeCount > 0 ? (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[11px] font-bold font-mono">
                {totalNeedsMeCount} tác vụ chờ
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold font-mono">
                0 PENDING
              </span>
            )}
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Ưu tiên giải quyết theo thứ tự rủi ro
          </span>
        </div>

        {totalNeedsMeCount === 0 ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-xs text-emerald-300 font-sans">
                Hệ thống vận hành ổn định — Toàn bộ chiến lược, hạn mức và đơn hàng SePay đều không có việc tồn đọng.
              </span>
            </div>
            <span className="text-[10px] font-mono text-emerald-400/80">STANDBY</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Warning: AI Quota >= 80% */}
            {isQuotaWarning && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <IconAlert className="w-4 h-4 text-amber-400 shrink-0" />
                  <div className="text-xs font-sans text-amber-200">
                    <strong>Cảnh báo ngân sách Quota:</strong> Cụm AI Gemini đã đạt <strong className="text-white font-mono">{aiQuota?.usage_pct}%</strong> hạn mức hôm nay ({aiQuota?.calls_today}/{aiQuota?.daily_cap} calls).
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('ai')}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer shrink-0 font-sans"
                >
                  Quản lý Quota →
                </button>
              </div>
            )}

            {/* Warning: Pending SePay Orders */}
            {pendingBillingCount > 0 && (
              <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                  <div className="text-xs font-sans text-cyan-200">
                    Có <strong className="text-white font-mono">{pendingBillingCount}</strong> đơn nạp SePay đang chờ xác nhận hạn mức.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('business')}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition cursor-pointer shrink-0 font-sans"
                >
                  Duyệt Đơn Hàng →
                </button>
              </div>
            )}

            {/* Strategy Candidates Waiting for Approval with Side-by-side Diff */}
            {reviewQueue.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
                  Chiến Lược AI Walk-Forward Chờ Duyệt Lên LIVE ({reviewQueue.length}):
                </div>

                {reviewQueue.map((item) => {
                  const cand = item.candidate;
                  const live = item.current_live || {
                    id: 'live',
                    name: 'Bản LIVE hiện tại',
                    win_rate: 0,
                    profit_factor: 0,
                    max_drawdown_pct: 0,
                    sample_size: 0,
                    rules: {},
                  };
                  const isActioning = actioningStrategyId === cand.id;

                  const winRateDelta = item.delta?.win_rate_diff ?? (cand.win_rate - live.win_rate);
                  const pfDelta = Number((item.delta?.pf_diff ?? (cand.profit_factor - live.profit_factor)).toFixed(2));
                  const ddDelta = item.delta?.dd_diff ?? (cand.max_drawdown_pct - live.max_drawdown_pct);

                  const candRulesSummary = cand.rules && Object.keys(cand.rules).length > 0 ? JSON.stringify(cand.rules) : 'Quy tắc ICT/SMC M15';
                  const liveRulesSummary = live.rules && Object.keys(live.rules).length > 0 ? JSON.stringify(live.rules) : 'Quy tắc ICT/SMC M15';

                  return (
                    <SpotlightBento key={cand.id} className="p-4 sm:p-5 space-y-4 border-amber-500/30">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              WAITING_APPROVAL
                            </span>
                            <span className="text-xs font-mono text-slate-400">ID: {cand.id}</span>
                          </div>
                          <h4 className="text-sm font-bold text-white font-sans mt-1">
                            {cand.name}
                          </h4>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          Ứng viên WFO OOS
                        </div>
                      </div>

                      {/* Side-by-Side Diff Comparison Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs font-mono border-collapse">
                          <thead>
                            <tr className="border-b border-white/10 text-slate-400 text-[11px]">
                              <th className="py-2 px-3">CHỈ SỐ ĐỊNH LƯỢNG</th>
                              <th className="py-2 px-3 text-slate-300">BẢN LIVE HIỆN TẠI</th>
                              <th className="py-2 px-3 text-cyan-300">ỨNG VIÊN ĐỀ XUẤT</th>
                              <th className="py-2 px-3 text-right">CHÊNH LỆCH (DELTA)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            <tr>
                              <td className="py-2 px-3 text-slate-400">Tỷ lệ thắng (Win Rate)</td>
                              <td className="py-2 px-3 text-slate-300 tabular-nums">{live.win_rate}%</td>
                              <td className="py-2 px-3 text-cyan-300 font-bold tabular-nums">{cand.win_rate}%</td>
                              <td className="py-2 px-3 text-right tabular-nums">
                                <span className={winRateDelta >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                  {winRateDelta >= 0 ? `+${winRateDelta}%` : `${winRateDelta}%`}
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 text-slate-400">Hệ số lãi (Profit Factor)</td>
                              <td className="py-2 px-3 text-slate-300 tabular-nums">{live.profit_factor}</td>
                              <td className="py-2 px-3 text-emerald-400 font-bold tabular-nums">{cand.profit_factor}</td>
                              <td className="py-2 px-3 text-right tabular-nums">
                                <span className={pfDelta >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                  {pfDelta >= 0 ? `+${pfDelta}` : `${pfDelta}`}
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 text-slate-400">Sụt giảm tối đa (Max Drawdown)</td>
                              <td className="py-2 px-3 text-slate-300 tabular-nums">{live.max_drawdown_pct}%</td>
                              <td className="py-2 px-3 text-rose-300 tabular-nums">{cand.max_drawdown_pct}%</td>
                              <td className="py-2 px-3 text-right tabular-nums">
                                <span className={ddDelta <= 0 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                                  {ddDelta <= 0 ? `${ddDelta}% (Tốt hơn)` : `+${ddDelta}% (Rủi ro)`}
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 text-slate-400">Quy mô mẫu kiểm định (Sample Size)</td>
                              <td className="py-2 px-3 text-slate-300 tabular-nums">{live.sample_size} mẫu</td>
                              <td className="py-2 px-3 text-cyan-300 tabular-nums">{cand.sample_size} mẫu</td>
                              <td className="py-2 px-3 text-right text-slate-400 tabular-nums">+{cand.sample_size - live.sample_size}</td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 text-slate-400">Quy tắc quét nến (Sweep Rules)</td>
                              <td className="py-2 px-3 text-slate-400 text-[10px] font-sans truncate max-w-xs">{liveRulesSummary}</td>
                              <td className="py-2 px-3 text-white text-[10px] font-sans truncate max-w-xs">{candRulesSummary}</td>
                              <td className="py-2 px-3 text-right text-emerald-400 text-[10px] font-bold">Cập nhật mới</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Action Decision Buttons */}
                      <div className="flex items-center justify-end gap-3 pt-2">
                        <button
                          type="button"
                          disabled={isActioning}
                          onClick={() => handleStrategyDecision(cand.id, false)}
                          className="px-4 py-2 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 font-bold font-sans text-xs transition cursor-pointer disabled:opacity-50"
                        >
                          ✕ Từ Chối
                        </button>
                        <button
                          type="button"
                          disabled={isActioning}
                          onClick={() => handleStrategyDecision(cand.id, true)}
                          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold font-sans text-xs transition cursor-pointer shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                        >
                          {isActioning ? 'Đang duyệt...' : '✓ Duyệt Chạy LIVE'}
                        </button>
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
          1.3. KHU VỰC VẬN HÀNH 2 CỘT CÂN ĐỐI (LIVE ORDERS & AGENT HEARTBEATS)
          ===================================================================== */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* CỘT TRÁI (7 COLS): BẢNG LỆNH LIVE TOÀN SÀN */}
        <div className="lg:col-span-7">
          <AdminLiveOrdersPanel onOrdersCountChange={setOrdersStats} />
        </div>

        {/* CỘT PHẢI (5 COLS): NHỊP TIM 4 AGENT & THANH QUOTA AI Ở CHÂN */}
        <div className="lg:col-span-5">
          <SpotlightBento className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-wider text-[#12B5A6] font-bold">
                  TẦNG 3 // EVENT-DRIVEN HEARTBEAT
                </div>
                <h3 className="text-base font-bold text-white mt-0.5 font-sans">
                  Bảng Nhịp Tim 4 Agent Điều Hành
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                Atomic 60s Redis Lock
              </span>
            </div>

            {/* 4-Agent Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {agentsHeartbeat.map((agent) => {
                const isWaking = wakingAgentId === agent.id;
                const isPausing = pausingAgentId === agent.id;

                return (
                  <div
                    key={agent.id}
                    className="p-3.5 rounded-xl border border-white/5 bg-black/40 flex flex-col justify-between space-y-2.5 transition hover:border-white/10"
                  >
                    <div className="space-y-1.5">
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
                        <div className="font-bold text-white text-xs font-sans truncate">{agent.name}</div>
                        <div className="text-[10px] text-slate-400 font-sans leading-tight line-clamp-1">{agent.role}</div>
                      </div>

                      <div className="rounded-lg bg-black/40 p-2 text-[10px] text-slate-300 font-sans border border-white/5 line-clamp-2">
                        {agent.last_summary || 'Chờ chu kỳ kích hoạt...'}
                      </div>

                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-white/5">
                        <span>Lần chạy:</span>
                        <span className="text-slate-300 font-bold tabular-nums">
                          {agent.last_run_at ? formatAuditDateTime(agent.last_run_at).split(' ')[1] : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span>Thời lượng:</span>
                        <span className="text-cyan-300 font-bold tabular-nums">
                          {agent.last_duration_ms > 0 ? `${agent.last_duration_ms} ms` : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Agent Actions: Wake Now & Toggle Pause */}
                    <div className="pt-1 flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isWaking || agent.is_paused}
                        onClick={() => handleWakeAgent(agent.id)}
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-[11px] font-bold font-sans transition cursor-pointer flex items-center justify-center gap-1 disabled:opacity-40"
                      >
                        <IconBolt className="w-3 h-3" />
                        <span>{isWaking ? 'Đang chạy...' : 'Wake Now'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isPausing}
                        onClick={() => handleTogglePause(agent.id)}
                        className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold font-sans transition cursor-pointer disabled:opacity-40 ${
                          agent.is_paused
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                        }`}
                      >
                        {agent.is_paused ? 'Bật lại' : 'Tạm dừng'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Chân Thẻ: Thanh Quota AI mỏng & Link Quản Lý sang Tab 2 */}
            <div className="pt-3 border-t border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300">
                  Quota AI: <strong className="text-white tabular-nums">{aiQuota?.calls_today ?? 0}</strong> / <strong className="text-slate-400 tabular-nums">{aiQuota?.daily_cap ?? 90}</strong> calls
                </span>
                <div className="flex items-center gap-2">
                  <span className={`font-bold tabular-nums ${
                    (aiQuota?.usage_pct || 0) >= 100
                      ? 'text-rose-400'
                      : (aiQuota?.usage_pct || 0) >= 80
                      ? 'text-amber-300'
                      : 'text-emerald-400'
                  }`}>
                    {aiQuota?.usage_pct ?? 0}%
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('ai')}
                    className="text-[#12B5A6] hover:text-[#12B5A6]/80 text-[11px] font-bold font-sans transition cursor-pointer"
                  >
                    Quản lý Quota &amp; Keys →
                  </button>
                </div>
              </div>
              <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    (aiQuota?.usage_pct || 0) >= 100
                      ? 'bg-rose-500'
                      : (aiQuota?.usage_pct || 0) >= 80
                      ? 'bg-amber-400'
                      : 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                  }`}
                  style={{ width: `${Math.min(100, aiQuota?.usage_pct || 0)}%` }}
                />
              </div>
            </div>
          </SpotlightBento>
        </div>
      </div>

      {/* =====================================================================
          1.4. GỘP AUDIT LOG & LỊCH TIN VĨ MÔ THÀNH 2 SUB-TAB Ở CUỐI TRANG
          ===================================================================== */}
      <SpotlightBento className="p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setBottomTab('audit')}
              className={`pb-2 text-sm font-semibold transition cursor-pointer relative font-sans ${
                bottomTab === 'audit' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Nhật Ký Kiểm Toán (Audit Log)</span>
              <span className="ml-2 rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                {combinedLog.length}
              </span>
              {bottomTab === 'audit' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#12B5A6]" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setBottomTab('news')}
              className={`pb-2 text-sm font-semibold transition cursor-pointer relative font-sans ${
                bottomTab === 'news' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Lịch Tin Vĩ Mô &amp; Cảnh Báo (News Shield ±15m)</span>
              {upcomingNews.length > 0 && (
                <span className="ml-2 rounded-full bg-amber-500/20 text-amber-300 px-2 py-0.5 font-mono text-[10px]">
                  {upcomingNews.length} tin
                </span>
              )}
              {bottomTab === 'news' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#12B5A6]" />
              )}
            </button>
          </div>

          {bottomTab === 'audit' && (
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
          )}
        </div>

        {/* SUB-TAB A: AUDIT LOG */}
        {bottomTab === 'audit' && (
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
        )}

        {/* SUB-TAB B: MACRO NEWS CALENDAR & ACTIONABLE ALERTS */}
        {bottomTab === 'news' && (
          <div className="space-y-4">
            {/* Actionable Alerts (if any) */}
            {(radar.alerts || []).length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono font-bold text-amber-300 uppercase">
                  <span>Cảnh Báo Vận Hành ({radar.alerts.length}):</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {radar.alerts.map((al: any) => (
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
                          <div className="text-xs font-bold text-white font-sans">{al.title}</div>
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-300 font-sans">{al.detail}</p>
                        </div>
                        {al.action_label && (
                          <button
                            type="button"
                            disabled={busyId === al.id}
                            onClick={() => handleAlertAction(al)}
                            className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-white/20 transition cursor-pointer font-sans"
                          >
                            {busyId === al.id ? '...' : al.action_label}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming News List */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                <span>CÁC SỰ KIỆN KINH TẾ TIẾP THEO (KHÓA LỆNH ±15 PHÚT)</span>
                <StatusBadge tone={upcomingNews.length > 0 ? 'warning' : 'success'} dot>
                  {upcomingNews.length > 0 ? `${upcomingNews.length} sự kiện` : 'An toàn 24h'}
                </StatusBadge>
              </div>

              <div className="max-h-[300px] space-y-2.5 overflow-y-auto pr-1">
                {upcomingNews.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-[#040710]/60 p-6 text-center text-xs text-slate-400 font-sans">
                    Không có tin tức vĩ mô mạnh trong 24 giờ tới. Cửa sổ giao dịch an toàn.
                  </div>
                ) : (
                  upcomingNews.map((n: any, idx: number) => {
                    const evTs = Number(n.ts || 0);
                    const diffMinutes = Math.round((evTs - nowSec) / 60);
                    const isImminent = diffMinutes >= -15 && diffMinutes <= 15;
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
                            <span className="font-bold text-white text-xs font-sans">{n.title}</span>
                          </div>
                          <span className="font-mono text-cyan-300 font-bold">{timeFormatted}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                          <span>Tác động: <strong className="text-amber-300 uppercase">{n.impact || 'HIGH'}</strong></span>
                          <span className={isImminent ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                            {isImminent
                              ? '⚠ ĐANG KHÓA LỆNH (NEWS SHIELD ±15M)'
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
        )}
      </SpotlightBento>
    </div>
  );
};
