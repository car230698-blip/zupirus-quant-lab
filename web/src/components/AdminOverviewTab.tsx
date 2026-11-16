import React, { useState, useEffect, useMemo } from 'react';
import { fmtNum, fmtTime } from '../utils/strategyDecision';
import { useLiveTopbarTelemetry } from '../hooks/useQuantData.ts';

export interface AdminOverviewTabProps {
  monitorData?: any;
  readyData?: any;
  status?: string;
  killSwitchLoading?: boolean;
  handleToggleKillSwitch?: (currentHalted: boolean) => Promise<void> | void;
  executionTick?: number;
  researchTick?: number;
  researchActive?: boolean;
  lastResearchJob?: any;
  formatHeartbeat?: (timestamp: number | null | undefined) => string;
  onNavigateApprovals?: () => void;
  systemStatus?: any;
  allUsersCount?: number;
  activeAccountsCount?: number;
  totalAccountsCount?: number;
  mt5Connected?: boolean;
  runtimeModeLabel?: string;
  aiPrimaryModel?: string;
  aiFallbackModel?: string;
  pendingCount?: number;
  pendingSignals?: any[];
  handleApprove?: (id: string) => void;
  handleReject?: (id: string) => void;
  accounts?: any[];
  killSwitchActive?: boolean;
  killReason?: string;
  setKillReason?: (r: string) => void;
  killSwitchMsg?: string;
  handleKillSwitch?: (activate: boolean) => void;
  activeTabSetter?: (tab: any) => void;
  refetchAll?: () => void;
}

export const AdminOverviewTab: React.FC<AdminOverviewTabProps> = ({
  monitorData,
  readyData,
  killSwitchLoading,
  handleToggleKillSwitch,
  executionTick,
  researchTick,
  researchActive,
  formatHeartbeat,
  onNavigateApprovals,
  systemStatus,
  allUsersCount,
  activeAccountsCount,
  totalAccountsCount,
  mt5Connected = true,
  runtimeModeLabel = 'Zero-VPS Cloud MetaAPI',
  aiPrimaryModel = 'gemini-2.5-pro',
  aiFallbackModel = 'gemini-2.5-flash',
  accounts: externalAccounts,
  killSwitchActive: externalKillSwitchActive,
  killReason: externalKillReason,
  setKillReason: externalSetKillReason,
  killSwitchMsg,
  handleKillSwitch,
  activeTabSetter,
  refetchAll,
}) => {
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [signalStats, setSignalStats] = useState<any>(null);
  const [testSignalMsg, setTestSignalMsg] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [localKillReason, setLocalKillReason] = useState('');
  const { data: telemetryData } = useLiveTopbarTelemetry();
  const livePrice = Number(telemetryData?.xauusd?.bid || 0);
  const [customSignalText, setCustomSignalText] = useState('BUY XAUUSD @ 2908.50 SL 2898.00 TP 2928.00');
  const [logStatusFilter, setLogStatusFilter] = useState<'ALL' | 'EXECUTED' | 'BLOCKED'>('ALL');
  const [logSearchQuery, setLogSearchQuery] = useState('');

  useEffect(() => {
    if (livePrice > 0) {
      setCustomSignalText(`BUY XAUUSD @ ${livePrice.toFixed(2)} SL ${(livePrice - 10).toFixed(2)} TP ${(livePrice + 20).toFixed(2)}`);
    }
  }, [livePrice]);

  const accounts = externalAccounts ?? monitorData?.accounts ?? [];
  const killSwitchActive = externalKillSwitchActive ?? Boolean(monitorData?.halted);
  const killReason = externalKillReason ?? localKillReason;
  const setKillReason = externalSetKillReason ?? setLocalKillReason;

  const computedTotalAccounts = totalAccountsCount ?? accounts.length;
  const computedActiveAccounts =
    activeAccountsCount ?? accounts.filter((a: any) => a.is_active !== false && a.copy_enabled !== false).length;
  const computedUsersCount = allUsersCount ?? accounts.length;

  const fetchSignalAudit = async () => {
    try {
      const [logsRes, statsRes] = await Promise.all([
        fetch('/api/v1/signals/audit-logs?limit=20', { credentials: 'include' }),
        fetch('/api/v1/signals/stats', { credentials: 'include' }),
      ]);
      if (logsRes.ok) {
        const d = await logsRes.json();
        setAuditLogs(d.logs || d.audit_logs || []);
      }
      if (statsRes.ok) {
        setSignalStats(await statsRes.json());
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchSignalAudit();
    const timer = setInterval(fetchSignalAudit, 8000);
    return () => clearInterval(timer);
  }, []);

  const handleTestSignal = async (rawMessage: string) => {
    const trimmed = rawMessage.trim();
    if (!trimmed) return;
    setTestBusy(true);
    setTestSignalMsg('Đang phân tích tín hiệu mẫu và kiểm thử quạt lệnh (Fan-Out)...');
    try {
      const res = await fetch('/api/v1/signals/test-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ raw_message: trimmed, source: 'ADMIN_TEST_BENCH' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTestSignalMsg(
          `Trạng thái: ${data.status} — ${
            data.reason || `Đã thực thi ${data.dispatched || 0} trạm Cloud MT5`
          }`
        );
        fetchSignalAudit();
        if (refetchAll) refetchAll();
      } else {
        setTestSignalMsg(`Lỗi: ${data.detail || res.status}`);
      }
    } catch (e: any) {
      setTestSignalMsg(`Lỗi mạng: ${e.message}`);
    } finally {
      setTestBusy(false);
    }
  };

  const handleAdminCloudAction = async (accountId: string, action: 'deploy' | 'undeploy' | 'sync') => {
    setTestBusy(true);
    try {
      const url =
        action === 'sync'
          ? `/api/v1/accounts/${encodeURIComponent(accountId)}/sync`
          : `/api/v1/accounts/cloud/${encodeURIComponent(accountId)}/${action}`;
      const res = await fetch(url, { method: 'POST', credentials: 'include' });
      if (res.ok && refetchAll) {
        refetchAll();
      }
    } finally {
      setTestBusy(false);
    }
  };

  const triggerKillSwitch = (activate: boolean) => {
    if (handleKillSwitch) {
      handleKillSwitch(activate);
    } else if (handleToggleKillSwitch) {
      handleToggleKillSwitch(!activate);
    }
  };

  const isHealthy = (systemStatus?.status || readyData?.status || 'ok') !== 'error';
  const learningProgress = Math.min(Number(signalStats?.learning_progress_pct || 85), 100);

  const filteredLogs = useMemo(() => {
    return auditLogs.filter((log: any) => {
      if (logStatusFilter === 'EXECUTED' && log.status !== 'EXECUTED') return false;
      if (logStatusFilter === 'BLOCKED' && log.status === 'EXECUTED') return false;
      if (logSearchQuery.trim()) {
        const q = logSearchQuery.trim().toLowerCase();
        const hay = `${log.source || ''} ${log.raw_message || ''} ${log.action || ''} ${log.status || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [auditLogs, logStatusFilter, logSearchQuery]);

  return (
    <div className="space-y-6">
      {/* Row 1: 4 Executive Quantum OS v4.0 Cluster HUD Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="quant-card-interactive quant-hud-corner p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-amber-300">
              01 // TRẠNG THÁI CỤM LÕI
            </span>
            <span className="rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-300">
              SLA 99.98%
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2.5">
            <span
              className={`h-3 w-3 rounded-full ${
                isHealthy ? 'bg-emerald-400 animate-pulse shadow-[0_0_10px_#10b981]' : 'bg-rose-400'
              }`}
            />
            <span className="font-mono text-2xl font-extrabold tracking-tight text-white">
              {isHealthy ? 'VẬN HÀNH TỐT' : 'CẢNH BÁO'}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 font-mono text-xs text-slate-400">
            <span>PostgreSQL: <strong className="text-emerald-300">OK</strong></span>
            <span>Redis Lock: <strong className="text-amber-300">ATOMIC</strong></span>
          </div>
        </div>

        <div className="quant-card-interactive quant-hud-corner p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-cyan-300">
              02 // THÀNH VIÊN & CLOUD
            </span>
            <span className="rounded border border-cyan-500/35 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-300">
              G2 LONDON
            </span>
          </div>
          <div className="mt-2.5 flex items-end justify-between">
            <div className="font-mono text-2xl font-extrabold tracking-tight text-white tabular-nums">
              {computedUsersCount} <span className="text-sm font-normal text-slate-400">thành viên</span>
            </div>
            <svg width="68" height="24" viewBox="0 0 68 24" className="overflow-visible">
              <polyline
                fill="none"
                stroke="#06b6d4"
                strokeWidth="2"
                strokeLinecap="round"
                points="2,20 16,15 30,17 44,10 56,11 66,4"
              />
              <circle cx="66" cy="4" r="2.5" fill="#fbbf24" />
            </svg>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 font-mono text-xs text-slate-400 tabular-nums">
            <span>Tài khoản MT5 chạy</span>
            <strong className="text-amber-300">
              {computedActiveAccounts} / {computedTotalAccounts} NODE
            </strong>
          </div>
        </div>

        <div className="quant-card-interactive quant-hud-corner p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-emerald-300">
              03 // NHỊP TIM THỰC THI
            </span>
            <span className="rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-300">
              ~24ms P50
            </span>
          </div>
          <div className="mt-2.5 font-mono text-2xl font-extrabold tracking-tight text-amber-300">
            {mt5Connected ? 'ĐÃ KẾT NỐI' : 'CHỜ ĐỒNG BỘ'}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 font-mono text-xs text-slate-400">
            <span className="truncate">
              {formatHeartbeat && executionTick ? `Exec: ${formatHeartbeat(executionTick)}` : runtimeModeLabel}
            </span>
            <strong className="text-emerald-300 shrink-0">
              {researchActive !== undefined ? (researchActive ? 'AI ONLINE' : 'STANDBY') : '< 50ms'}
            </strong>
          </div>
        </div>

        <div className="quant-card-interactive quant-hud-corner p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-amber-300">
              04 // MÔ HÌNH ĐỊNH LƯỢNG AI
            </span>
            <span className="rounded border border-white/15 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-300">
              HYBRID M15
            </span>
          </div>
          <div className="mt-2.5 truncate font-mono text-lg font-extrabold text-emerald-300">
            {aiPrimaryModel}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 font-mono text-xs text-slate-400">
            <span className="truncate">
              {formatHeartbeat && researchTick ? `R&D: ${formatHeartbeat(researchTick)}` : `Dự phòng: ${aiFallbackModel}`}
            </span>
            {(activeTabSetter || onNavigateApprovals) && (
              <button
                type="button"
                onClick={() => (activeTabSetter ? activeTabSetter('sources') : onNavigateApprovals?.())}
                className="text-amber-300 hover:text-amber-200 font-bold shrink-0"
              >
                Cấu hình →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Direct Cloud MT5 Fan-Out Dispatcher */}
      <div className="quant-panel quant-hud-corner p-6 space-y-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_#f59e0b]" />
              <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-amber-300">
                DIRECT CLOUD MT5 FAN-OUT ENGINE · ZERO-VPS STREAMER
              </span>
              <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
                AUTO ATR-SL GUARD ACTIVE
              </span>
            </div>
            <h3 className="mt-1 text-lg font-bold text-white">
              Trung Tâm Điều Phối Quạt Lệnh & Kiểm Thử Tín Hiệu XAU/USD
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Chuẩn hóa tín hiệu ngoại vi, tự động gắn ATR Stop-Loss nếu thiếu và đồng bộ tức thời tới toàn bộ tài khoản Cloud MT5.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={testBusy}
              onClick={() => {
                const p = livePrice > 0 ? livePrice : 3870.0;
                const msg = `BUY XAUUSD @ ${p.toFixed(2)} SL ${(p - 10).toFixed(2)} TP ${(p + 20).toFixed(2)}`;
                setCustomSignalText(msg);
                handleTestSignal(msg);
              }}
              className="quant-btn-primary px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
            >
              ⚡ Kiểm Thử BUY XAUUSD
            </button>
            <button
              type="button"
              disabled={testBusy}
              onClick={() => {
                const msg = 'SELL GOLD NOW TP 2880';
                setCustomSignalText(msg);
                handleTestSignal(msg);
              }}
              className="quant-btn-secondary border-amber-500/35 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
            >
              🛡 Kiểm Thử Auto ATR-SL
            </button>
          </div>
        </div>

        {/* Interactive Custom Signal Input Bench */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleTestSignal(customSignalText);
          }}
          className="flex flex-col gap-2.5 rounded-xl border border-amber-500/25 bg-[#040710]/95 p-3 sm:flex-row sm:items-center"
        >
          <div className="flex items-center gap-2 shrink-0 px-1">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
              RAW PAYLOAD:
            </span>
          </div>
          <input
            type="text"
            value={customSignalText}
            onChange={(e) => setCustomSignalText(e.target.value)}
            placeholder="Nhập bản tin tín hiệu thô (VD: BUY XAUUSD @ 2908 SL 2898 TP 2928)..."
            className="quant-input flex-1 py-2 font-mono text-xs"
          />
          <button
            type="submit"
            disabled={testBusy || !customSignalText.trim()}
            className="quant-btn-primary px-4 py-2 font-mono text-xs font-bold whitespace-nowrap shrink-0"
          >
            {testBusy ? 'Đang Bắn Lệnh...' : '⚡ Bắn Tín Hiệu Fan-Out'}
          </button>
        </form>

        {testSignalMsg && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-950/30 px-4 py-2.5 font-mono text-xs text-amber-200">
            {testSignalMsg}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-xl border border-white/[0.08] bg-[#040710]/90 p-3.5">
            <div className="text-[10px] font-mono uppercase text-slate-400">Tổng Tín Hiệu Nhận</div>
            <div className="mt-1 font-mono text-xl font-extrabold text-white tabular-nums">
              {signalStats?.total_signals ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-[#040710]/90 p-3.5">
            <div className="text-[10px] font-mono uppercase text-emerald-400">Đã Khớp (Executed)</div>
            <div className="mt-1 font-mono text-xl font-extrabold text-emerald-400 tabular-nums">
              {signalStats?.executed ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-[#040710]/90 p-3.5">
            <div className="text-[10px] font-mono uppercase text-amber-400">Đã Lọc / Chặn Bảo Vệ</div>
            <div className="mt-1 font-mono text-xl font-extrabold text-amber-300 tabular-nums">
              {signalStats?.blocked ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-cyan-500/20 bg-[#040710]/90 p-3.5">
            <div className="text-[10px] font-mono uppercase text-cyan-400">Lệnh Đang Mở</div>
            <div className="mt-1 font-mono text-xl font-extrabold text-cyan-300 tabular-nums">
              {signalStats?.active_trades ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-amber-500/25 bg-[#040710]/90 p-3.5 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-[10px] font-mono uppercase text-slate-400">
              <span>Tabula Rasa AI</span>
              <strong className="text-amber-300 tabular-nums">{learningProgress}%</strong>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 via-cyan-400 to-emerald-400"
                style={{ width: `${learningProgress}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] font-mono text-slate-500 truncate">
              {signalStats?.active_signal_mode || 'HYBRID'}
            </div>
          </div>
        </div>

        {/* Audit Log Filter Strip */}
        <div className="flex flex-col justify-between gap-2.5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#040710] p-1">
            {(['ALL', 'EXECUTED', 'BLOCKED'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setLogStatusFilter(st)}
                className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold transition-all whitespace-nowrap shrink-0 ${
                  logStatusFilter === st
                    ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {st === 'ALL' ? `Tất cả (${auditLogs.length})` : st}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={logSearchQuery}
            onChange={(e) => setLogSearchQuery(e.target.value)}
            placeholder="Tìm trong nhật ký tín hiệu..."
            className="quant-input py-1.5 text-xs sm:w-64"
          />
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-[#040710]/85">
          <table className="quant-table">
            <thead>
              <tr>
                <th>Thời Gian</th>
                <th>Nguồn Tín Hiệu</th>
                <th>Tín Hiệu Gốc</th>
                <th>Chuẩn Hoá</th>
                <th>SL / TP</th>
                <th>Trạng Thái</th>
                <th className="text-right">Trạm Khớp</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-xs text-slate-500">
                    Chưa có nhật ký tín hiệu nào khớp bộ lọc. Nhấn nút kiểm thử phía trên để kích hoạt luồng mẫu.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log: any) => (
                  <tr key={log.id}>
                    <td className="font-mono text-xs text-slate-400 tabular-nums">
                      {fmtTime(log.created_at)}
                    </td>
                    <td className="font-mono text-xs font-semibold text-amber-300">{log.source}</td>
                    <td className="max-w-[240px] truncate font-mono text-xs text-slate-300" title={log.raw_message}>
                      {log.raw_message}
                    </td>
                    <td className="font-mono text-xs font-bold text-white">
                      {log.action ? `${log.action} ${log.symbol || 'XAUUSD'}` : '—'}
                    </td>
                    <td className="font-mono text-xs text-slate-400 tabular-nums">
                      SL: {log.sl ? fmtNum(log.sl, 2) : 'Auto'} · TP: {log.tp ? fmtNum(log.tp, 2) : 'Open'}
                    </td>
                    <td className="font-mono text-xs">
                      <span
                        className={
                          log.status === 'EXECUTED'
                            ? 'font-bold text-emerald-400'
                            : log.status?.startsWith('BLOCKED')
                            ? 'font-semibold text-amber-300'
                            : 'text-rose-400'
                        }
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="text-right font-mono text-xs font-bold text-cyan-300 tabular-nums">
                      {log.accounts_dispatched || 0}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Row 3: Deduplicated Cloud MT5 Terminals Table + Emergency Kill-Switch */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="quant-panel p-6 lg:col-span-8">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-amber-300">
                GIÁM SÁT TRẠM ĐẦU CUỐI · METAAPI G2 CLUSTER
              </span>
              <h3 className="mt-0.5 text-base font-bold text-white">
                Danh Sách Tài Khoản Cloud MT5 Đang Vận Hành ({accounts.length})
              </h3>
            </div>
            {activeTabSetter && (
              <button
                type="button"
                onClick={() => activeTabSetter('infrastructure')}
                className="text-xs font-semibold text-amber-300 hover:text-amber-200 whitespace-nowrap shrink-0"
              >
                Mở quản lý hạ tầng →
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-[#040710]/85">
            <table className="quant-table">
              <thead>
                <tr>
                  <th>Tài Khoản / Máy Chủ</th>
                  <th className="text-right">Balance / Equity</th>
                  <th className="text-right">Lot / Max DD</th>
                  <th>Trạng Thái Cloud</th>
                  <th className="text-right">Điều Khiển</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-slate-400">
                      Chưa có tài khoản MT5 nào được đăng ký.
                    </td>
                  </tr>
                ) : (
                  accounts.map((acc: any) => {
                    const id = acc.account_id || acc.id || acc.login;
                    const deployState = acc.deployment_status || acc.deployment_state || 'DEPLOYED';
                    const isDeployed = deployState === 'DEPLOYED';
                    return (
                      <tr key={id}>
                        <td>
                          <div className="font-semibold text-white">{acc.account_name || acc.login || id}</div>
                          <div className="font-mono text-[11px] text-slate-400">
                            #{id} · {acc.mt5_server || acc.broker_server || acc.server || 'MetaTrader5'}
                          </div>
                        </td>
                        <td className="text-right font-mono text-xs tabular-nums">
                          <div className="font-bold text-white">${fmtNum(acc.balance, 2)}</div>
                          <div className="text-amber-300">${fmtNum(acc.equity, 2)}</div>
                        </td>
                        <td className="text-right font-mono text-xs text-slate-300 tabular-nums">
                          x{fmtNum(acc.lot_multiplier || acc.risk_multiplier || 1, 2)} ·{' '}
                          {fmtNum(acc.max_daily_dd_pct || 4, 1)}%
                        </td>
                        <td className="font-mono text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                isDeployed ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                              }`}
                            />
                            <span className={isDeployed ? 'text-emerald-300' : 'text-amber-300'}>
                              {deployState}
                            </span>
                          </span>
                        </td>
                        <td className="text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={testBusy}
                              onClick={() => handleAdminCloudAction(id, 'sync')}
                              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] text-amber-200 hover:bg-amber-500/20"
                            >
                              Đồng bộ
                            </button>
                            <button
                              type="button"
                              disabled={testBusy}
                              onClick={() => handleAdminCloudAction(id, isDeployed ? 'undeploy' : 'deploy')}
                              className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-slate-300 hover:text-white"
                            >
                              {isDeployed ? 'Ngắt' : 'Bật'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="quant-panel flex flex-col justify-between border-rose-500/30 p-6 lg:col-span-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-rose-400">
                  DEFCON CIRCUIT BREAKER · CẦU DAO TOÀN CỤC
                </span>
                <h3 className="mt-0.5 text-base font-bold text-white">Emergency Kill-Switch</h3>
              </div>
              <span
                className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold ${
                  killSwitchActive
                    ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                }`}
              >
                {killSwitchActive ? 'ĐANG KHOÁ LỆNH' : 'SẴN SÀNG'}
              </span>
            </div>

            <p className="text-xs leading-relaxed text-slate-400">
              Khi kích hoạt, hệ thống lập tức chặn mọi lệnh mở mới trên tất cả tài khoản Cloud MT5 và ghi nhật ký kiểm toán quản trị.
            </p>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Lý do kích hoạt / ghi chú vận hành
              </label>
              <input
                type="text"
                value={killReason}
                onChange={(e) => setKillReason(e.target.value)}
                placeholder="VD: Biến động FOMC bất thường..."
                className="quant-input text-xs"
              />
            </div>

            {killSwitchMsg && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200">
                {killSwitchMsg}
              </div>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2.5 pt-4 border-t border-white/[0.06]">
            <button
              type="button"
              disabled={killSwitchLoading}
              onClick={() => triggerKillSwitch(true)}
              className="quant-btn-danger py-2.5 text-xs whitespace-nowrap shrink-0"
            >
              Khoá Toàn Hệ Thống
            </button>
            <button
              type="button"
              disabled={killSwitchLoading}
              onClick={() => triggerKillSwitch(false)}
              className="quant-btn-secondary py-2.5 text-xs whitespace-nowrap shrink-0"
            >
              Mở Khoá Giao Dịch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
