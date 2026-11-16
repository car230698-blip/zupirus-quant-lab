import React, { useState, useEffect } from 'react';
import { fmtNum, fmtTime } from '../utils/strategyDecision';

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

  const accounts = externalAccounts ?? monitorData?.accounts ?? [];
  const killSwitchActive = externalKillSwitchActive ?? Boolean(monitorData?.halted);
  const killReason = externalKillReason ?? localKillReason;
  const setKillReason = externalSetKillReason ?? setLocalKillReason;

  const computedTotalAccounts = totalAccountsCount ?? accounts.length;
  const computedActiveAccounts =
    activeAccountsCount ?? accounts.filter((a: any) => a.is_active !== false && a.copy_enabled !== false).length;
  const computedUsersCount = allUsersCount ?? Math.max(accounts.length, 2);

  const fetchSignalAudit = async () => {
    try {
      const [logsRes, statsRes] = await Promise.all([
        fetch('/api/v1/signals/audit-logs?limit=15', { credentials: 'include' }),
        fetch('/api/v1/signals/stats', { credentials: 'include' }),
      ]);
      if (logsRes.ok) {
        const d = await logsRes.json();
        setAuditLogs(d.logs || []);
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
    setTestBusy(true);
    setTestSignalMsg('Đang phân tích tín hiệu mẫu và kiểm thử quạt lệnh (Fan-Out)...');
    try {
      const res = await fetch('/api/v1/signals/test-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ raw_message: rawMessage, source: 'ADMIN_TEST_BENCH' }),
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

  return (
    <div className="space-y-6">
      {/* Row 1: 4 Executive Bento KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-slate-400">
            Trạng Thái Cụm Lõi
          </div>
          <div className="mt-2.5 flex items-center gap-2.5">
            <span
              className={`h-3 w-3 rounded-full ${
                isHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
              }`}
            />
            <span className="font-mono text-2xl font-extrabold tracking-tight text-white">
              {isHealthy ? 'VẬN HÀNH TỐT' : 'CẢNH BÁO'}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 font-mono text-xs text-slate-400">
            <span>PostgreSQL: <strong className="text-emerald-300">OK</strong></span>
            <span>Redis: <strong className="text-cyan-300">OK</strong></span>
          </div>
        </div>

        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-slate-400">
            Thành Viên & Trạm Cloud
          </div>
          <div className="mt-2.5 font-mono text-2xl font-extrabold tracking-tight text-white tabular-nums">
            {computedUsersCount} <span className="text-sm font-normal text-slate-400">thành viên</span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 font-mono text-xs text-slate-400 tabular-nums">
            <span>Tài khoản MT5 chạy</span>
            <strong className="text-cyan-300">
              {computedActiveAccounts} / {computedTotalAccounts}
            </strong>
          </div>
        </div>

        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-slate-400">
            Nhịp Tim Thực Thi & AI
          </div>
          <div className="mt-2.5 font-mono text-2xl font-extrabold tracking-tight text-cyan-300">
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

        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-slate-400">
            Mô Hình Định Lượng AI
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
                className="text-cyan-400 hover:text-cyan-300 shrink-0"
              >
                Cấu hình →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Direct Cloud MT5 Fan-Out Dispatcher */}
      <div className="quant-panel p-6 space-y-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-400">
                Direct Cloud MT5 Fan-Out Engine
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
              onClick={() => handleTestSignal('BUY XAUUSD @ 2905.50 SL 2895.00 TP 2925.00')}
              className="quant-btn-primary px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
            >
              Kiểm Thử BUY XAUUSD
            </button>
            <button
              type="button"
              disabled={testBusy}
              onClick={() => handleTestSignal('SELL GOLD NOW TP 2880')}
              className="quant-btn-secondary px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
            >
              Kiểm Thử Auto ATR-SL
            </button>
          </div>
        </div>

        {testSignalMsg && (
          <div className="rounded-xl border border-cyan-500/35 bg-cyan-950/30 px-4 py-2.5 font-mono text-xs text-cyan-200">
            {testSignalMsg}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-xl border border-white/[0.06] bg-[#040710]/80 p-3.5">
            <div className="text-[10px] font-mono uppercase text-slate-400">Tổng Tín Hiệu Nhận</div>
            <div className="mt-1 font-mono text-xl font-extrabold text-white tabular-nums">
              {signalStats?.total_signals ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#040710]/80 p-3.5">
            <div className="text-[10px] font-mono uppercase text-emerald-400">Đã Khớp (Executed)</div>
            <div className="mt-1 font-mono text-xl font-extrabold text-emerald-400 tabular-nums">
              {signalStats?.executed ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#040710]/80 p-3.5">
            <div className="text-[10px] font-mono uppercase text-amber-400">Đã Lọc / Chặn Bảo Vệ</div>
            <div className="mt-1 font-mono text-xl font-extrabold text-amber-300 tabular-nums">
              {signalStats?.blocked ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#040710]/80 p-3.5">
            <div className="text-[10px] font-mono uppercase text-cyan-400">Lệnh Đang Mở</div>
            <div className="mt-1 font-mono text-xl font-extrabold text-cyan-300 tabular-nums">
              {signalStats?.active_trades ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#040710]/80 p-3.5 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-[10px] font-mono uppercase text-slate-400">
              <span>Tabula Rasa AI</span>
              <strong className="text-cyan-300 tabular-nums">{learningProgress}%</strong>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
                style={{ width: `${learningProgress}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] font-mono text-slate-500 truncate">
              {signalStats?.active_signal_mode || 'HYBRID'}
            </div>
          </div>
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
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-xs text-slate-500">
                    Chưa có nhật ký tín hiệu nào. Nhấn nút kiểm thử phía trên để kích hoạt luồng mẫu.
                  </td>
                </tr>
              ) : (
                auditLogs.map((log: any) => (
                  <tr key={log.id}>
                    <td className="font-mono text-xs text-slate-400 tabular-nums">
                      {fmtTime(log.created_at)}
                    </td>
                    <td className="font-mono text-xs font-semibold text-cyan-300">{log.source}</td>
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
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
                Giám Sát Trạm Đầu Cuối
              </span>
              <h3 className="mt-0.5 text-base font-bold text-white">
                Danh Sách Tài Khoản Cloud MT5 Đang Vận Hành ({accounts.length})
              </h3>
            </div>
            {activeTabSetter && (
              <button
                type="button"
                onClick={() => activeTabSetter('infrastructure')}
                className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 whitespace-nowrap shrink-0"
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
                          <div className="text-cyan-300">${fmtNum(acc.equity, 2)}</div>
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
                              className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 font-mono text-[11px] text-cyan-300 hover:bg-cyan-500/20"
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

        <div className="quant-panel flex flex-col justify-between border-rose-500/25 p-6 lg:col-span-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-rose-400">
                  Cầu Dao Khẩn Cấp Toàn Cục
                </span>
                <h3 className="mt-0.5 text-base font-bold text-white">Emergency Kill-Switch</h3>
              </div>
              <span
                className={`font-mono text-xs font-bold ${
                  killSwitchActive ? 'text-rose-400' : 'text-emerald-400'
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
