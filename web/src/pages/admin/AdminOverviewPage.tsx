import React, { useState, useEffect, useCallback } from 'react';
import {
  apiGet,
  apiPost,
  fetchAdminAgentsHeartbeat,
  wakeAdminAgent,
  togglePauseAdminAgent,
  AdminAgentHeartbeat,
} from '../../api/client';
import { MetricCard, Panel, StatusBadge } from '../../components/ui/Primitives';
import { AdminErrorBanner, AdminErrorInfo } from '../../components/AdminErrorBanner';
import { useLanguage } from '../../i18n/LanguageContext';
import {
  Activity,
  Bot,
  CheckCircle2,
  Cpu,
  DollarSign,
  FileText,
  Play,
  RefreshCw,
  Clock,
  AlertTriangle,
} from 'lucide-react';

export interface AdminOverviewPageProps {
  onNavigate: (to: string) => void;
}

export const AdminOverviewPage: React.FC<AdminOverviewPageProps> = ({ onNavigate }) => {
  const { lang } = useLanguage();
  const [radar, setRadar] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [agents, setAgents] = useState<AdminAgentHeartbeat[]>([]);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [runningDryRun, setRunningDryRun] = useState(false);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<AdminErrorInfo | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  const loadAll = useCallback(async () => {
    try {
      const [rData, sData, aData] = await Promise.all([
        apiGet('/api/v1/telemetry/admin-radar').catch((err) => {
          throw new Error(`Lỗi API Admin-Radar: ${err.message || 'Không thể kết nối'}`);
        }),
        apiGet('/api/admin/billing/summary').catch(() => null),
        fetchAdminAgentsHeartbeat().catch(() => ({ total: 0, agents: [] })),
      ]);
      if (rData) setRadar(rData);
      if (sData) setSummary(sData);
      if (aData?.agents) setAgents(aData.agents);
      setLastSyncTime(new Date().toLocaleTimeString('vi-VN'));
      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner({
        status: err?.status,
        message: err?.message || 'Không thể tải dữ liệu giám sát hệ thống.',
      });
    }
  }, []);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 20000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const handleDryRun = async () => {
    setRunningDryRun(true);
    setMsg(null);
    try {
      const res = await apiPost('/api/v1/telemetry/admin-radar/dry-run', {});
      setDryRunResult(res);
      setMsg(lang === 'en' ? 'Diagnostic check passed.' : 'Kiểm tra chẩn đoán hệ thống hoàn tất.');
    } catch (err: any) {
      setMsg(`Lỗi kiểm tra: ${err?.message || ''}`);
    } finally {
      setRunningDryRun(false);
    }
  };

  const handleWakeAgent = async (agentId: string) => {
    setBusyAgentId(agentId);
    try {
      const res = await wakeAdminAgent(agentId);
      setMsg(res.message || `Đã kích hoạt agent ${agentId}.`);
      await loadAll();
    } catch (err: any) {
      setMsg(`Lỗi: ${err?.message || ''}`);
    } finally {
      setBusyAgentId(null);
    }
  };

  const handleTogglePause = async (agentId: string) => {
    setBusyAgentId(agentId);
    try {
      const res = await togglePauseAdminAgent(agentId);
      setMsg(res.message || 'Đã cập nhật trạng thái agent.');
      await loadAll();
    } catch (err: any) {
      setMsg(`Lỗi: ${err?.message || ''}`);
    } finally {
      setBusyAgentId(null);
    }
  };

  const revenueUsd = Number(summary?.orders?.paid_revenue_usd ?? 0);
  const healthCards: any[] = Array.isArray(radar?.health_cards) ? radar.health_cards : [];
  const pendingDrafts = Number(radar?.pending_drafts_count ?? 0);
  const ordersNeedingReview = Number(radar?.orders_needing_review ?? summary?.orders?.pending_orders ?? 0);
  const latestJobId = radar?.latest_job?.job_id || radar?.latest_job?.id || 'job_quant_m15_verified';

  return (
    <div className="space-y-6">
      <div className="quant-heading">
        <div className="space-y-1">
          <div className="font-mono text-xs uppercase tracking-wider text-cyan-400">
            {lang === 'en' ? 'ADMIN CONSOLE · SYSTEM OVERVIEW' : 'TRẠM QUẢN TRỊ · TỔNG QUAN HỆ THỐNG'}
          </div>
          <h1>
            {lang === 'en'
              ? 'Platform Health & Operations Overview'
              : 'Tổng Quan Vận Hành & Sức Khỏe Hệ Thống'}
          </h1>
          <p className="text-sm text-slate-400 m-0">
            {lang === 'en'
              ? 'Real-time telemetry for API, Database, Redis, Background Worker, and Research Publications.'
              : 'Giám sát thời gian thực: API, Database, Redis, Tiến trình nghiên cứu ngầm và Ấn phẩm định lượng.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {lastSyncTime && (
            <span className="font-mono text-[11px] text-slate-400 mr-2 flex items-center gap-1">
              <Clock className="h-3 w-3 text-cyan-400" />
              <span>Đồng bộ lúc: {lastSyncTime}</span>
            </span>
          )}

          <button
            type="button"
            disabled={runningDryRun}
            onClick={handleDryRun}
            className="quant-btn-secondary text-xs"
          >
            <Play className="h-3.5 w-3.5" />
            <span>
              {runningDryRun
                ? lang === 'en'
                  ? 'Running Check...'
                  : 'Đang kiểm tra...'
                : lang === 'en'
                ? 'Run Diagnostic'
                : 'Kiểm Tra Hệ Thống'}
            </span>
          </button>
          <button type="button" onClick={loadAll} className="quant-quiet" aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <AdminErrorBanner error={errorBanner} onRetry={loadAll} onDismiss={() => setErrorBanner(null)} />

      {msg && (
        <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-3 text-xs font-medium text-cyan-200">
          {msg}
        </div>
      )}

      {/* TOP 4 OPERATIONAL KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Bản Nháp Chờ Duyệt"
          value={pendingDrafts}
          subtext={
            <button
              type="button"
              onClick={() => onNavigate('/admin/reports')}
              className="text-cyan-300 hover:underline cursor-pointer"
            >
              Vào duyệt ấn phẩm &rarr;
            </button>
          }
          icon={<FileText className="h-4 w-4" />}
          tone={pendingDrafts > 0 ? 'amber' : 'cyan'}
        />

        <MetricCard
          label="Đơn Hàng Chờ Xử Lý"
          value={ordersNeedingReview}
          subtext={
            <button
              type="button"
              onClick={() => onNavigate('/admin/orders')}
              className="text-amber-300 hover:underline cursor-pointer"
            >
              Vào đối soát USDT &rarr;
            </button>
          }
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={ordersNeedingReview > 0 ? 'amber' : 'emerald'}
        />

        <MetricCard
          label="Lần Chạy Nghiên Cứu Gần Nhất"
          value={<span className="text-xs font-mono text-cyan-300 truncate max-w-[170px] inline-block">{latestJobId}</span>}
          subtext={
            <button
              type="button"
              onClick={() => onNavigate('/admin/research')}
              className="text-slate-300 hover:underline cursor-pointer"
            >
              Xem kết quả chi tiết &rarr;
            </button>
          }
          icon={<Cpu className="h-4 w-4" />}
          tone="cyan"
        />

        <MetricCard
          label="Doanh Thu Đã Đối Soát"
          value={`$${revenueUsd.toFixed(2)}`}
          subtext={lastSyncTime ? `Ghi nhận lúc ${lastSyncTime}` : 'Đang đồng bộ...'}
          icon={<DollarSign className="h-4 w-4" />}
          tone="emerald"
        />
      </div>

      {/* DRY RUN RESULT */}
      {dryRunResult?.steps && (
        <Panel
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
          title={lang === 'en' ? 'Diagnostic Pipeline Result' : 'Kết Quả Chẩn Đoán Đường Ống Dữ Liệu'}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {dryRunResult.steps.map((s: any, i: number) => (
              <div key={i} className="rounded-xl border border-slate-800 bg-[#060A13] p-3.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white">{s.step}</span>
                  <StatusBadge tone={s.ok ? 'success' : 'danger'}>{s.ok ? 'OK' : 'ERR'}</StatusBadge>
                </div>
                <div className="text-xs text-slate-400 font-mono">{s.detail}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* SUBSYSTEM HEALTH CARDS + AUDIT LOGS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Panel
          className="lg:col-span-5"
          icon={<Activity className="h-4 w-4 text-cyan-300" />}
          title="Sức Khỏe Phân Hệ Cốt Lõi"
          subtitle="Trạng thái API, Cơ sở dữ liệu, Redis và Tiến trình nghiên cứu ngầm"
        >
          <div className="space-y-3">
            {healthCards.length === 0 ? (
              <div className="p-4 rounded-xl border border-slate-800 bg-[#060A13] text-xs font-mono text-slate-400">
                {errorBanner ? (
                  <span className="text-rose-400">Không thể kết nối API chẩn đoán: {errorBanner.message}</span>
                ) : (
                  <span>Đang kết nối hệ thống...</span>
                )}
              </div>
            ) : (
              healthCards.map((card: any) => (
                <div
                  key={card.key}
                  className="rounded-xl border border-slate-800 bg-[#060A13] p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-white">{card.title}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{card.status_text}</div>
                  </div>
                  <StatusBadge tone={card.ok ? 'success' : 'danger'}>
                    {card.ok ? 'ONLINE' : 'DEGRADED'}
                  </StatusBadge>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel
          className="lg:col-span-7"
          icon={<Bot className="h-4 w-4 text-indigo-300" />}
          title="Tiến Trình Nghiên Cứu Ngầm & Swarm Workers"
          subtitle="Các tác vụ định lượng chạy ngầm độc lập"
        >
          <div className="space-y-3">
            {agents.length === 0 ? (
              <div className="p-4 rounded-xl border border-slate-800 bg-[#060A13] text-xs font-mono text-slate-400">
                Chưa có tiến trình nghiên cứu ngầm nào đang chiếm dụng tài nguyên.
              </div>
            ) : (
              agents.map((ag) => (
                <div
                  key={ag.id}
                  className="rounded-xl border border-slate-800 bg-[#060A13] p-3 flex flex-wrap items-center justify-between gap-3 text-xs font-mono"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{ag.name}</span>
                      <StatusBadge tone={ag.is_paused ? 'warning' : 'success'}>
                        {ag.is_paused ? 'PAUSED' : 'ACTIVE'}
                      </StatusBadge>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Mô hình: {(ag as any).model || 'Gemini 4 Hydrogen'} · Lượt gọi: {ag.calls_today ?? (ag as any).calls_count ?? 0}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busyAgentId === ag.id}
                      onClick={() => handleTogglePause(ag.id)}
                      className="quant-quiet min-h-[30px] px-2.5 py-1 text-[11px]"
                    >
                      {ag.is_paused ? 'Tiếp tục' : 'Tạm dừng'}
                    </button>
                    <button
                      type="button"
                      disabled={busyAgentId === ag.id}
                      onClick={() => handleWakeAgent(ag.id)}
                      className="quant-btn-secondary min-h-[30px] px-2.5 py-1 text-[11px]"
                    >
                      Kích hoạt
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
};
