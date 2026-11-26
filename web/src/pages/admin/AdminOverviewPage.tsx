import React, { useState, useEffect, useCallback } from 'react';
import {
  apiGet,
  apiPost,
  fetchAdminAgentsHeartbeat,
  wakeAdminAgent,
  togglePauseAdminAgent,
  AdminAgentHeartbeat,
} from '../../api/client';
import { MetricCard, Panel, StatusBadge, EmptyState } from '../../components/ui/Primitives';
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
  ShieldCheck,
} from 'lucide-react';

export interface AdminOverviewPageProps {
  onNavigate: (to: string) => void;
}

export const AdminOverviewPage: React.FC<AdminOverviewPageProps> = ({ onNavigate }) => {
  const { lang } = useLanguage();
  const [radar, setRadar] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [reportsCount, setReportsCount] = useState<number>(0);
  const [agents, setAgents] = useState<AdminAgentHeartbeat[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [runningDryRun, setRunningDryRun] = useState(false);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<AdminErrorInfo | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [rData, sData, repData, aData, mData] = await Promise.all([
        apiGet('/api/v1/telemetry/admin-radar').catch(() => null),
        apiGet('/api/admin/billing/summary').catch(() => null),
        apiGet('/api/v1/admin/reports').catch(() => null),
        fetchAdminAgentsHeartbeat().catch(() => ({ total: 0, agents: [] })),
        apiGet('/api/admin/monitor').catch(() => null),
      ]);
      if (rData) setRadar(rData);
      if (sData) setSummary(sData);
      if (repData) setReportsCount(Number(repData.count ?? repData.items?.length ?? 0));
      if (aData?.agents) setAgents(aData.agents);
      if (mData?.audit) setAuditLogs(mData.audit);
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
  const paidOrders = Number(summary?.orders?.paid_orders ?? 0);
  const totalOrders = Number(summary?.orders?.total_orders ?? 0);
  const healthCards: any[] = Array.isArray(radar?.health_cards) ? radar.health_cards : [];

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
              ? 'Monitor publications, USDT order settlements, Walk-Forward pipeline status, and audit trail.'
              : 'Theo dõi ấn phẩm PDF, đối soát đơn USDT, tiến trình kiểm định Walk-Forward và nhật ký thao tác.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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

      {/* TOP 4 KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label={lang === 'en' ? 'Published & Draft PDFs' : 'Ấn Phẩm PDF'}
          value={reportsCount}
          subtext={
            <button
              type="button"
              onClick={() => onNavigate('/admin/reports')}
              className="text-cyan-300 hover:underline cursor-pointer"
            >
              {lang === 'en' ? 'Manage publications →' : 'Quản lý xuất bản →'}
            </button>
          }
          icon={<FileText className="h-4 w-4" />}
          tone="cyan"
        />
        <MetricCard
          label={lang === 'en' ? 'Paid USDT Revenue' : 'Doanh Thu USDT'}
          value={`$${revenueUsd.toFixed(2)}`}
          subtext={`${paidOrders} / ${totalOrders} ${lang === 'en' ? 'orders settled' : 'đơn đã hoàn tất'}`}
          icon={<DollarSign className="h-4 w-4" />}
          tone="emerald"
        />
        <MetricCard
          label={lang === 'en' ? 'Active Research Mode' : 'Chế Độ Nghiên Cứu'}
          value={radar?.signal_mode || 'AUTONOMOUS'}
          subtext={
            radar?.canary_strategy
              ? `${lang === 'en' ? 'Pending WFO:' : 'Chờ duyệt:'} ${radar.canary_strategy}`
              : lang === 'en'
              ? 'No pending candidate'
              : 'Không có ứng viên chờ duyệt'
          }
          icon={<Cpu className="h-4 w-4" />}
          tone="amber"
        />
        <MetricCard
          label={lang === 'en' ? 'Subsystems Healthy' : 'Phân Hệ Ổn Định'}
          value={`${healthCards.filter((c) => c.ok).length} / ${healthCards.length || 4}`}
          subtext={radar?.regime ? `Regime: ${radar.regime}` : 'Nominal'}
          icon={<ShieldCheck className="h-4 w-4" />}
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

      {/* SUBSYSTEM HEALTH CARDS + AGENTS HEARTBEAT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Panel
          className="lg:col-span-5"
          icon={<Activity className="h-4 w-4 text-cyan-300" />}
          title={lang === 'en' ? 'Cluster Health' : 'Sức Khỏe Phân Hệ'}
        >
          <div className="space-y-2.5">
            {healthCards.length === 0 ? (
              <div className="text-xs text-slate-400">Đang đồng bộ trạng thái phân hệ...</div>
            ) : (
              healthCards.map((card: any) => (
                <div
                  key={card.key}
                  className="rounded-xl border border-slate-800 bg-[#060A13] p-3.5 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-xs font-semibold text-white">{card.title}</div>
                    <div className="mt-0.5 text-xs text-slate-400 font-mono">{card.status_text}</div>
                  </div>
                  <StatusBadge tone={card.ok ? 'success' : 'danger'}>
                    {card.ok ? 'HEALTHY' : 'ALERT'}
                  </StatusBadge>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel
          className="lg:col-span-7"
          icon={<Bot className="h-4 w-4 text-[#12B5A6]" />}
          title={lang === 'en' ? 'Research Workers Heartbeat' : 'Nhịp Tim Tiến Trình Nghiên Cứu'}
        >
          {agents.length === 0 ? (
            <EmptyState
              icon={<Bot className="h-5 w-5" />}
              title={lang === 'en' ? 'No background agents reported' : 'Chưa có dữ liệu agent'}
              description="Tiến trình nghiên cứu sẽ hiển thị trạng thái tại đây."
            />
          ) : (
            <div className="space-y-2.5">
              {agents.map((ag) => (
                <div
                  key={ag.id}
                  className="rounded-xl border border-slate-800 bg-[#060A13] p-3.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">{ag.name}</span>
                      <StatusBadge
                        tone={
                          ag.status === 'PAUSED'
                            ? 'warning'
                            : ag.status === 'QUOTA_CAPPED'
                            ? 'danger'
                            : 'success'
                        }
                      >
                        {ag.status}
                      </StatusBadge>
                    </div>
                    <div className="text-xs text-slate-400 font-mono truncate">
                      {ag.last_summary} · {ag.calls_today} calls today
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busyAgentId === ag.id}
                      onClick={() => handleWakeAgent(ag.id)}
                      className="quant-quiet min-h-[30px] px-2.5 py-1 text-[11px]"
                    >
                      Kích hoạt
                    </button>
                    <button
                      type="button"
                      disabled={busyAgentId === ag.id}
                      onClick={() => handleTogglePause(ag.id)}
                      className="quant-quiet min-h-[30px] px-2.5 py-1 text-[11px]"
                    >
                      {ag.is_paused ? 'Tiếp tục' : 'Tạm dừng'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* RECENT AUDIT TRAIL */}
      <Panel
        title={lang === 'en' ? 'Recent System Audit Trail' : 'Nhật Ký Hoạt Động Hệ Thống'}
        subtitle={lang === 'en' ? 'Latest administrative & pipeline events' : 'Các sự kiện quản trị và đối soát gần nhất'}
      >
        {auditLogs.length === 0 ? (
          <div className="text-xs text-slate-400 py-4 text-center">Chưa có bản ghi nhật ký nào.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="quant-table font-mono text-xs tabular-nums">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Tác nhân</th>
                  <th>Sự kiện</th>
                  <th>Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.slice(0, 12).map((log: any, idx: number) => (
                  <tr key={log.id || idx}>
                    <td className="text-slate-400">
                      {log.ts ? new Date(log.ts * 1000).toLocaleString('vi-VN') : '—'}
                    </td>
                    <td className="text-cyan-300">{log.actor || 'system'}</td>
                    <td className="font-semibold text-white">{log.event}</td>
                    <td className="text-slate-400 max-w-md truncate">{log.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
};
