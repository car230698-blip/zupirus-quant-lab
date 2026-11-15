import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useExchangeRate,
  useCloudAccounts,
  useSignalAuditLogs,
  useSignalStats,
  useMetaApiTelemetry,
} from '../hooks/useQuantData.ts';

interface AdminOverviewTabProps {
  monitorData: any;
  killSwitchLoading: boolean;
  handleToggleKillSwitch: (halted: boolean) => void;
  [key: string]: any;
}

export const AdminOverviewTab: React.FC<AdminOverviewTabProps> = ({
  monitorData,
  killSwitchLoading,
  handleToggleKillSwitch,
}) => {
  const queryClient = useQueryClient();

  // TanStack Queries
  const { data: fxData } = useExchangeRate();
  const { data: accountsData } = useCloudAccounts();
  const cloudAccounts = accountsData?.accounts || [];
  const { data: auditData } = useSignalAuditLogs(15);
  const signalAuditLogs = auditData?.audit_logs || [];
  const { data: statsData } = useSignalStats();
  const signalStats = statsData || null;
  const { data: telemetryData } = useMetaApiTelemetry();
  const metaTelemetry = telemetryData || null;

  // Local Action States
  const [fanoutLoading, setFanoutLoading] = useState(false);
  const [fanoutReport, setFanoutReport] = useState<any>(null);
  const [fxRefreshing, setFxRefreshing] = useState(false);
  const [revenueData, setRevenueData] = useState<any>(null);
  const [testIngestLoading, setTestIngestLoading] = useState(false);
  const [testIngestResult, setTestIngestResult] = useState<any>(null);

  useEffect(() => {
    fetchRevenue();
  }, []);

  async function fetchRevenue() {
    try {
      const res = await fetch('/api/v1/billing/admin/revenue', {
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        const data = await res.json();
        setRevenueData(data);
      }
    } catch {}
  }

  async function handleRefreshFxRate() {
    setFxRefreshing(true);
    try {
      const res = await fetch('/api/v1/billing/refresh-exchange-rate', {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        await queryClient.invalidateQueries({ queryKey: ['exchange-rate'] });
      }
    } catch {} finally {
      setFxRefreshing(false);
    }
  }

  async function fetchCloudAccounts() {
    await queryClient.invalidateQueries({ queryKey: ['accounts'] });
  }

  async function fetchTelemetry() {
    await queryClient.invalidateQueries({ queryKey: ['metaapi', 'telemetry'] });
  }

  async function fetchSignalAudit() {
    await queryClient.invalidateQueries({ queryKey: ['signals', 'audit-logs'] });
  }

  async function fetchSignalStats() {
    await queryClient.invalidateQueries({ queryKey: ['signals', 'stats'] });
  }

  async function handleToggleAccount(id: string) {
    try {
      const res = await fetch(`/api/v1/accounts/${id}/toggle`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        await fetchCloudAccounts();
        await fetchTelemetry();
      }
    } catch {}
  }

  async function handleSyncAccount(id: string) {
    try {
      const res = await fetch(`/api/v1/accounts/${id}/sync`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        await fetchCloudAccounts();
      }
    } catch {}
  }

  async function handleDeleteAccount(id: string) {
    if (!window.confirm('Admin: Bạn có chắc chắn muốn ngắt kết nối và xóa tài khoản Cloud này?')) return;
    try {
      const res = await fetch(`/api/v1/accounts/${id}`, {
        method: 'DELETE',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        await fetchCloudAccounts();
        await fetchTelemetry();
      }
    } catch {}
  }

  async function handleTestFanout() {
    setFanoutLoading(true);
    setFanoutReport(null);
    try {
      const res = await fetch('/api/metaapi/dispatch-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({
          symbol: 'XAUUSD',
          action: 'BUY',
          entry_price: 2650.0,
          sl: 2645.0,
          tp: 2665.0,
          rationale: 'Admin Manual Fan-Out Test (Latency & Idempotency Verification)',
        }),
      });
      const data = await res.json();
      setFanoutReport(data);
      await fetchTelemetry();
    } catch (err: any) {
      setFanoutReport({ error: err.message || String(err) });
    } finally {
      setFanoutLoading(false);
    }
  }

  async function handleTestSignalIngestion() {
    setTestIngestLoading(true);
    setTestIngestResult(null);
    try {
      const res = await fetch('/api/v1/signals/test-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({
          symbol: 'XAUUSD',
          action: 'BUY',
          entry_price: 2680.5,
          sl: null, // Test auto-attach SL guard
          tp: 2695.0,
          strategy_tier: 'STANDARD',
          source: 'TEST_CLI',
        }),
      });
      const data = await res.json();
      setTestIngestResult(data);
      await fetchSignalAudit();
      await fetchSignalStats();
    } catch (e: any) {
      setTestIngestResult({ error: e.message || String(e) });
    } finally {
      setTestIngestLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Analytics: FX Rate & Revenue Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono text-xs">
        {/* Card 1: USD/VND Live Monitor */}
        <div className="quant-panel p-4 rounded-xl border border-cyan-500/30 bg-[#0a101f] space-y-2">
          <div className="flex justify-between items-center text-slate-400">
            <span>TỶ GIÁ USD/VND THỜI GIAN THỰC</span>
            <button
              onClick={handleRefreshFxRate}
              disabled={fxRefreshing}
              className="text-[10px] text-cyan-400 hover:text-cyan-300 px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800 disabled:opacity-50"
            >
              {fxRefreshing ? 'Đang tải…' : '↻ Cập nhật'}
            </button>
          </div>
          <div className="text-xl font-bold text-cyan-300">
            {fxData ? `${fxData.rate.toLocaleString('vi-VN')}₫` : '25,730₫'}
          </div>
          <div className="text-[10px] text-slate-500 flex justify-between">
            <span>Nguồn: {fxData?.source || 'API'}</span>
            <span>{fxData?.is_cached ? 'Redis Cached' : 'Live Fetch'}</span>
          </div>
        </div>

        {/* Card 2: Revenue Dual Currency */}
        <div className="quant-panel p-4 rounded-xl border border-emerald-500/30 bg-[#0a101f] space-y-2">
          <div className="text-slate-400">DOANH THU ĐĂNG KÝ (SEPAY)</div>
          <div className="text-xl font-bold text-emerald-400">
            {revenueData ? `${revenueData.total_revenue_vnd?.toLocaleString('vi-VN')}₫` : '0₫'}
          </div>
          <div className="text-[10px] text-slate-500 flex justify-between">
            <span>${revenueData?.total_revenue_usd?.toFixed(2) || '0.00'} USD</span>
            <span>{revenueData?.paid_orders_count || 0} đơn hàng thành công</span>
          </div>
        </div>

        {/* Card 3: Cloud Terminals */}
        <div className="quant-panel p-4 rounded-xl border border-slate-800 bg-[#0a101f] space-y-2">
          <div className="text-slate-400">TÀI KHOẢN CLOUD MT5</div>
          <div className="text-xl font-bold text-slate-100">
            {cloudAccounts.length} Tài khoản
          </div>
          <div className="text-[10px] text-slate-500 flex justify-between">
            <span className="text-emerald-400">● {cloudAccounts.filter((a) => Boolean(a.auto_trade)).length} Auto-Trade</span>
            <span>London G2 Bridge</span>
          </div>
        </div>

        {/* Card 4: Signal Guard Pipeline Stats */}
        <div className="quant-panel p-4 rounded-xl border border-purple-500/30 bg-[#0a101f] space-y-2">
          <div className="text-slate-400">4 MÀNG LỌC AN TOÀN TÍN HIỆU</div>
          <div className="text-xl font-bold text-purple-300">
            {signalStats?.total_audited ?? signalAuditLogs.length} Tín Hiệu
          </div>
          <div className="text-[10px] text-slate-500 flex justify-between">
            <span className="text-emerald-400">Pass: {signalStats?.approved_count || 0}</span>
            <span className="text-rose-400">Reject: {signalStats?.rejected_count || 0}</span>
          </div>
        </div>
      </div>

      {/* MetaApi Direct Cloud Execution Telemetry Banner */}
      <div className="quant-panel rounded-2xl border border-cyan-500/30 bg-[#0a101f] p-5 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-cyan-400 animate-ping" />
            <div>
              <h3 className="font-bold text-sm text-slate-100 font-mono tracking-wide flex items-center gap-2">
                <span>DIRECT CLOUD MT5 FAN-OUT DISPATCHER</span>
                <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-700/60 px-2 py-0.5 rounded">
                  {metaTelemetry?.mode || 'MetaApi Cloud'}
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                Bắn lệnh trực tiếp song song xuống toàn bộ tài khoản MT5 khách hàng (Không EA, Không Master Account).
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleTestSignalIngestion}
              disabled={testIngestLoading}
              className="rounded-xl border border-purple-700/60 bg-purple-950/60 hover:bg-purple-900/80 text-purple-200 font-bold px-3 py-2 text-xs font-mono transition-all disabled:opacity-50"
            >
              {testIngestLoading ? 'Đang test…' : '🧪 Test Lọc 4 Giáp An Toàn'}
            </button>
            <button
              onClick={handleTestFanout}
              disabled={fanoutLoading}
              className="rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold px-4 py-2 text-xs font-mono transition-all shadow-md shadow-cyan-500/20 disabled:opacity-50"
            >
              {fanoutLoading ? 'Đang bắn lệnh…' : '⚡ Test Fan-Out Lệnh Thật'}
            </button>
          </div>
        </div>

        {/* Telemetry Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-500 text-[10px] block">TÀI KHOẢN CLOUD KẾT NỐI</span>
            <span className="font-bold text-base text-slate-100">
              {cloudAccounts.length}
            </span>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-500 text-[10px] block">ĐANG BẬT AUTO-TRADE</span>
            <span className="font-bold text-base text-emerald-400">
              {cloudAccounts.filter((a) => Boolean(a.auto_trade)).length}
            </span>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-500 text-[10px] block">ĐỘ TRỄ FAN-OUT TRUNG BÌNH</span>
            <span className="font-bold text-base text-cyan-300">
              {metaTelemetry?.average_latency_ms ? `${metaTelemetry.average_latency_ms} ms` : '~32 ms'}
            </span>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-500 text-[10px] block">TỔNG LỆNH ĐÃ THỰC THI</span>
            <span className="font-bold text-base text-slate-100">
              {metaTelemetry?.total_orders_executed ?? 0}
            </span>
          </div>
        </div>

        {/* Test Result Reports */}
        {testIngestResult && (
          <div className="rounded-xl bg-slate-950/80 border border-purple-500/40 p-4 text-xs font-mono space-y-2">
            <div className="text-purple-300 font-bold border-b border-slate-800 pb-1">
              Kết Quả Thử Nghiệm 4 Màng Lọc An Toàn
            </div>
            <pre className="text-[11px] text-slate-300 overflow-x-auto">
              {JSON.stringify(testIngestResult, null, 2)}
            </pre>
          </div>
        )}

        {fanoutReport && (
          <div className="rounded-xl bg-slate-950/80 border border-cyan-500/40 p-4 text-xs font-mono space-y-2">
            <div className="flex items-center justify-between text-cyan-300 font-bold border-b border-slate-800 pb-2">
              <span>Báo Cáo Thực Thi Fan-Out Tín Hiệu ({fanoutReport.signal_id || 'Test'})</span>
              <span>Tổng thời gian: {fanoutReport.total_fanout_elapsed_ms ?? 0} ms</span>
            </div>
            <div className="grid grid-cols-3 gap-2 py-1">
              <div>Đã khớp: <b className="text-emerald-400">{fanoutReport.executed ?? 0}</b></div>
              <div>Thất bại: <b className="text-rose-400">{fanoutReport.failed ?? 0}</b></div>
              <div>Bị chặn trùng: <b className="text-amber-400">{fanoutReport.blocked_by_idempotency ?? 0}</b></div>
            </div>
          </div>
        )}
      </div>

      {/* Signal Safety Guards Audit Log Stream */}
      <div className="quant-panel rounded-2xl border border-slate-800 bg-[#0d1424] overflow-hidden">
        <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-100 font-mono">
              Nhật Ký Kiểm Toán Tín Hiệu (Signal Audit Logs)
            </span>
            <span className="text-xs text-slate-400 font-mono">
              (Ghi lại toàn bộ quyết định phê duyệt / từ chối của 4 Màng Lọc)
            </span>
          </div>
          <button
            onClick={fetchSignalAudit}
            className="text-xs font-mono text-cyan-400 hover:text-cyan-300"
          >
            ↻ Làm mới nhật ký
          </button>
        </div>

        <div className="overflow-x-auto">
          {signalAuditLogs.length === 0 ? (
            <div className="p-8 text-center text-slate-500 font-mono text-xs">
              Chưa có tín hiệu nào được tiếp nhận trong phiên này.
            </div>
          ) : (
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">SIGNAL ID</th>
                  <th className="py-2.5 px-4">NGUỒN / TIER</th>
                  <th className="py-2.5 px-4">LỆNH</th>
                  <th className="py-2.5 px-4">GIÁ VÀO / SL</th>
                  <th className="py-2.5 px-4">TRẠNG THÁI</th>
                  <th className="py-2.5 px-4">LÝ DO KIỂM TOÁN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {signalAuditLogs.map((log: any) => {
                  const isApproved = log.status === 'APPROVED';
                  return (
                    <tr key={log.id} className="hover:bg-slate-900/40">
                      <td className="py-2.5 px-4 text-slate-300 font-bold">{log.signal_id?.slice(0, 12)}</td>
                      <td className="py-2.5 px-4 text-slate-400">
                        {log.source_name} <span className="text-[10px] text-cyan-400">({log.strategy_tier})</span>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${log.side === 'BUY' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>
                          {log.side} {log.symbol}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-200">
                        {log.entry_price} / <span className="text-amber-400">{log.stop_loss || 'Auto ATR'}</span>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isApproved ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50' : 'bg-rose-950 text-rose-300 border border-rose-500/50'}`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-400 text-[11px]">
                        {log.reject_reason || 'Passed all 4 guards'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Cloud MT5 Terminals Table */}
      <div className="quant-panel rounded-2xl border border-slate-800 bg-[#0d1424] overflow-hidden">
        <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-100 font-mono">
              Quản Trị Tài Khoản Cloud MT5 ({cloudAccounts.length})
            </span>
          </div>
          <button
            onClick={fetchCloudAccounts}
            className="text-xs font-mono text-cyan-400 hover:text-cyan-300"
          >
            ↻ Làm mới
          </button>
        </div>

        <div className="overflow-x-auto">
          {cloudAccounts.length === 0 ? (
            <div className="p-8 text-center text-slate-500 font-mono text-xs">
              Chưa có tài khoản Cloud MT5 nào được kết nối.
            </div>
          ) : (
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">LOGIN / SERVER</th>
                  <th className="py-2.5 px-4">EQUITY / BALANCE</th>
                  <th className="py-2.5 px-4">RỦI RO / TIER</th>
                  <th className="py-2.5 px-4">AUTO-TRADE</th>
                  <th className="py-2.5 px-4 text-right">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {cloudAccounts.map((a: any) => {
                  const isAuto = a.auto_trade === 1;
                  return (
                    <tr key={a.id} className="hover:bg-slate-900/40">
                      <td className="py-2.5 px-4">
                        <div className="font-bold text-slate-200">#{a.login || a.mt5_login}</div>
                        <div className="text-[10px] text-slate-400">{a.server || a.broker_server}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-bold text-emerald-400">${Number(a.equity || 0).toLocaleString()}</div>
                        <div className="text-[10px] text-slate-400">${Number(a.balance || 0).toLocaleString()}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="text-cyan-300 font-bold">{a.risk_multiplier || 1.0}x Multiplier</div>
                        <div className="text-[10px] text-slate-400">
                          {a.is_prop_firm_mode ? 'Prop Firm Mode' : a.is_compounding ? 'Compounding' : 'Standard'}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isAuto ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>
                          {isAuto ? 'ACTIVE' : 'PAUSED'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right space-x-1.5">
                        <button
                          onClick={() => handleToggleAccount(a.id)}
                          className={`px-2 py-1 rounded text-[10px] font-bold ${isAuto ? 'bg-amber-950 text-amber-300' : 'bg-emerald-950 text-emerald-300'}`}
                        >
                          {isAuto ? 'Dừng' : 'Bật'}
                        </button>
                        <button
                          onClick={() => handleSyncAccount(a.id)}
                          className="px-2 py-1 rounded text-[10px] bg-slate-800 text-cyan-300"
                        >
                          Sync
                        </button>
                        <button
                          onClick={() => handleDeleteAccount(a.id)}
                          className="px-2 py-1 rounded text-[10px] bg-rose-950 text-rose-300"
                        >
                          Xóa
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Signal Safety Guards Audit Log Stream */}
      <div className="quant-panel rounded-2xl border border-slate-800 bg-[#0d1424] overflow-hidden">
        <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-100 font-mono">
              Nhật Ký Kiểm Toán Tín Hiệu (Signal Audit Logs)
            </span>
            <span className="text-xs text-slate-400 font-mono">
              (Ghi lại toàn bộ quyết định phê duyệt / từ chối của 4 Màng Lọc)
            </span>
          </div>
          <button
            onClick={fetchSignalAudit}
            className="text-xs font-mono text-cyan-400 hover:text-cyan-300"
          >
            ↻ Làm mới nhật ký
          </button>
        </div>

        <div className="overflow-x-auto">
          {signalAuditLogs.length === 0 ? (
            <div className="p-8 text-center text-slate-500 font-mono text-xs">
              Chưa có tín hiệu nào được tiếp nhận trong phiên này.
            </div>
          ) : (
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">SIGNAL ID</th>
                  <th className="py-2.5 px-4">NGUỒN / TIER</th>
                  <th className="py-2.5 px-4">LỆNH</th>
                  <th className="py-2.5 px-4">GIÁ VÀO / SL</th>
                  <th className="py-2.5 px-4">TRẠNG THÁI</th>
                  <th className="py-2.5 px-4">LÝ DO KIỂM TOÁN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {signalAuditLogs.map((log: any) => {
                  const isApproved = log.status === 'APPROVED';
                  return (
                    <tr key={log.id} className="hover:bg-slate-900/40">
                      <td className="py-2.5 px-4 text-slate-300 font-bold">{log.signal_id?.slice(0, 12)}</td>
                      <td className="py-2.5 px-4 text-slate-400">
                        {log.source_name} <span className="text-[10px] text-cyan-400">({log.strategy_tier})</span>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${log.side === 'BUY' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>
                          {log.side} {log.symbol}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-200">
                        {log.entry_price} / <span className="text-amber-400">{log.stop_loss || 'Auto ATR'}</span>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isApproved ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50' : 'bg-rose-950 text-rose-300 border border-rose-500/50'}`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-400 text-[11px]">
                        {log.reject_reason || 'Passed all 4 guards'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Cloud MT5 Terminals Table */}
      <div className="quant-panel rounded-2xl border border-slate-800 bg-[#0d1424] overflow-hidden">
        <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-100 font-mono">
              Quản Trị Tài Khoản Cloud MT5 ({cloudAccounts.length})
            </span>
          </div>
          <button
            onClick={fetchCloudAccounts}
            className="text-xs font-mono text-cyan-400 hover:text-cyan-300"
          >
            ↻ Làm mới
          </button>
        </div>

        <div className="overflow-x-auto">
          {cloudAccounts.length === 0 ? (
            <div className="p-8 text-center text-slate-500 font-mono text-xs">
              Chưa có tài khoản Cloud MT5 nào được kết nối.
            </div>
          ) : (
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">LOGIN / SERVER</th>
                  <th className="py-2.5 px-4">EQUITY / BALANCE</th>
                  <th className="py-2.5 px-4">RỦI RO / TIER</th>
                  <th className="py-2.5 px-4">AUTO-TRADE</th>
                  <th className="py-2.5 px-4 text-right">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {cloudAccounts.map((a: any) => {
                  const isAuto = a.auto_trade === 1;
                  return (
                    <tr key={a.id} className="hover:bg-slate-900/40">
                      <td className="py-2.5 px-4">
                        <div className="font-bold text-slate-200">#{a.login || a.mt5_login}</div>
                        <div className="text-[10px] text-slate-400">{a.server || a.broker_server}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-bold text-emerald-400">${Number(a.equity || 0).toLocaleString()}</div>
                        <div className="text-[10px] text-slate-400">${Number(a.balance || 0).toLocaleString()}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="text-cyan-300 font-bold">{a.risk_multiplier || 1.0}x Multiplier</div>
                        <div className="text-[10px] text-slate-400">
                          {a.is_prop_firm_mode ? 'Prop Firm Mode' : a.is_compounding ? 'Compounding' : 'Standard'}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isAuto ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>
                          {isAuto ? 'ACTIVE' : 'PAUSED'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right space-x-1.5">
                        <button
                          onClick={() => handleToggleAccount(a.id)}
                          className={`px-2 py-1 rounded text-[10px] font-bold ${isAuto ? 'bg-amber-950 text-amber-300' : 'bg-emerald-950 text-emerald-300'}`}
                        >
                          {isAuto ? 'Dừng' : 'Bật'}
                        </button>
                        <button
                          onClick={() => handleSyncAccount(a.id)}
                          className="px-2 py-1 rounded text-[10px] bg-slate-800 text-cyan-300"
                        >
                          Sync
                        </button>
                        <button
                          onClick={() => handleDeleteAccount(a.id)}
                          className="px-2 py-1 rounded text-[10px] bg-rose-950 text-rose-300"
                        >
                          Xóa
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Kill Switch Banner */}
      <div
        className={`rounded-xl border p-5 transition-colors ${
          monitorData.halted
            ? 'border-rose-500/60 bg-rose-950/40 text-rose-200'
            : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-bold text-sm">
              <span className={`h-3 w-3 rounded-full ${monitorData.halted ? 'bg-rose-500 animate-ping' : 'bg-emerald-400'}`} />
              <span>Khóa Ngắt Khẩn Cấp Toàn Hệ Thống (Global Kill Switch)</span>
            </div>
            <p className="text-xs text-slate-300">
              {monitorData.halted
                ? 'Toàn bộ việc cấp lệnh sao chép đang bị ngắt an toàn.'
                : 'Cấp lệnh được phép cho tài khoản đang bật auto-trade và vượt qua 4 màng lọc rủi ro.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleToggleKillSwitch(monitorData.halted)}
              disabled={killSwitchLoading || status !== 'ready' || monitorData.halted == null}
              className={`rounded-lg px-4 py-2 text-xs font-bold font-mono transition-colors shadow ${
                monitorData.halted
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                  : 'bg-rose-600 hover:bg-rose-500 text-white'
              }`}
            >
              {killSwitchLoading
                ? 'Đang chuyển…'
                : monitorData.halted
                ? 'Mở lại cấp lệnh'
                : 'Ngắt toàn bộ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
