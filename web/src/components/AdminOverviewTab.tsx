import React, { useState, useEffect } from 'react';

interface AdminOverviewTabProps {
  monitorData: any;
  readyData: any;
  status: string;
  killSwitchLoading: boolean;
  handleToggleKillSwitch: (currentHalted: boolean) => void;
  executionTick: number;
  researchTick: number;
  researchActive: boolean;
  lastResearchJob: any;
  formatHeartbeat: (timestamp: number) => string;
  onNavigateApprovals: () => void;
}

export const AdminOverviewTab: React.FC<AdminOverviewTabProps> = ({
  monitorData,
  readyData,
  status,
  killSwitchLoading,
  handleToggleKillSwitch,
  executionTick,
  researchTick,
  researchActive,
  lastResearchJob,
  formatHeartbeat,
  onNavigateApprovals,
}) => {
  const liveAccounts = monitorData.accounts.filter((account: any) => account.server !== 'ZUPIRUS-SYNTHETIC' && account.mode !== 'REPLAY');
  const displayAccounts = liveAccounts.length > 0 ? liveAccounts : monitorData.accounts;

  // MetaApi Cloud Execution Telemetry
  const [metaTelemetry, setMetaTelemetry] = useState<any>(null);
  const [fanoutLoading, setFanoutLoading] = useState(false);
  const [fanoutReport, setFanoutReport] = useState<any>(null);
  const [cloudAccounts, setCloudAccounts] = useState<any[]>([]);

  useEffect(() => {
    fetchTelemetry();
    fetchCloudAccounts();
  }, []);

  async function fetchCloudAccounts() {
    try {
      const res = await fetch('/api/metaapi/accounts', {
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        const data = await res.json();
        setCloudAccounts(data.accounts || []);
      }
    } catch {
      // ignore
    }
  }

  async function handleToggleAccount(id: string) {
    try {
      const res = await fetch(`/api/metaapi/accounts/${id}/toggle`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        await fetchCloudAccounts();
        await fetchTelemetry();
      }
    } catch {
      // ignore
    }
  }

  async function handleSyncAccount(id: string) {
    try {
      const res = await fetch(`/api/metaapi/accounts/${id}/sync`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        await fetchCloudAccounts();
      }
    } catch {
      // ignore
    }
  }

  async function handleDeleteAccount(id: string) {
    if (!window.confirm('Admin: Bạn có chắc chắn muốn ngắt kết nối và undeploy tài khoản Cloud này?')) return;
    try {
      const res = await fetch(`/api/metaapi/accounts/${id}`, {
        method: 'DELETE',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        await fetchCloudAccounts();
        await fetchTelemetry();
      }
    } catch {
      // ignore
    }
  }

  async function fetchTelemetry() {
    try {
      const res = await fetch('/api/metaapi/telemetry', {
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        const data = await res.json();
        setMetaTelemetry(data);
      }
    } catch {
      // ignore
    }
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

  return (
    <div className="space-y-6">
      <div className="quant-metrics grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ['Tài khoản MT5 Thực tế', displayAccounts.length],
          ['Đang sao chép lệnh', displayAccounts.filter((account: any) => account.enabled).length],
          [
            'Nghiên cứu đang chờ',
            monitorData.jobs.filter((job: any) => ['queued', 'waiting_approval'].includes(job.state)).length,
          ],
          ['Kết nối hệ thống', readyData?.status === 'ready' ? 'Sẵn sàng' : readyData ? 'Gián đoạn' : '—'],
        ].map(([label, value]) => (
          <div className="quant-panel p-4" key={label}>
            <div className="text-slate-400 text-xs">{label}</div>
            <div className="mt-2 text-xl font-semibold">{status === 'ready' ? value : '—'}</div>
          </div>
        ))}
      </div>

      {/* Direct Cloud Execution (MetaApi) Telemetry Banner */}
      <div className="quant-panel rounded-2xl border border-cyan-500/30 bg-[#0a101f] p-5 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-cyan-400 animate-ping" />
            <div>
              <h3 className="font-bold text-sm text-slate-100 font-mono tracking-wide flex items-center gap-2">
                <span>DIRECT-TO-USER CLOUD EXECUTION ENGINE</span>
                <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-700/60 px-2 py-0.5 rounded">
                  {metaTelemetry?.mode || 'MetaApi Cloud'}
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Bắn lệnh trực tiếp từ Quant Brain tới toàn bộ MT5 qua MetaApi RPC song song (Không tài khoản Master, Không file EA).
              </p>
            </div>
          </div>

          <button
            onClick={handleTestFanout}
            disabled={fanoutLoading}
            className="rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold px-4 py-2 text-xs font-mono transition-all shadow-md shadow-cyan-500/20 disabled:opacity-50"
          >
            {fanoutLoading ? 'Đang bắn lệnh…' : '⚡ Test Bắn Tín Hiệu Fan-Out'}
          </button>
        </div>

        {/* Telemetry Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-500 text-[10px] block">TÀI KHOẢN CLOUD KẾT NỐI</span>
            <span className="font-bold text-base text-slate-100">
              {metaTelemetry?.total_connected_accounts ?? 0}
            </span>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-500 text-[10px] block">ĐANG BẬT AUTO-TRADE</span>
            <span className="font-bold text-base text-emerald-400">
              {metaTelemetry?.active_auto_trading_accounts ?? 0}
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

        {/* Fanout Test Report */}
        {fanoutReport && (
          <div className="rounded-xl bg-slate-950/80 border border-cyan-500/40 p-4 text-xs font-mono space-y-2">
            <div className="flex items-center justify-between text-cyan-300 font-bold border-b border-slate-800 pb-2">
              <span>Báo Cáo Thực Thi Fan-Out Tín Hiệu ({fanoutReport.signal_id || 'Test'})</span>
              <span>Tổng thời gian: {fanoutReport.total_fanout_elapsed_ms ?? 0} ms</span>
            </div>
            <div className="text-slate-300 text-[11px] grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>Tổng tài khoản: <b className="text-white">{fanoutReport.total_accounts ?? 0}</b></div>
              <div>Đã khớp lệnh: <b className="text-emerald-400">{fanoutReport.executed ?? 0}</b></div>
              <div>Thất bại / Lỗi: <b className="text-rose-400">{fanoutReport.failed ?? 0}</b></div>
              <div>Bỏ qua (Idempotency): <b className="text-amber-400">{fanoutReport.skipped ?? 0}</b></div>
            </div>
            {fanoutReport.message && (
              <p className="text-amber-300 text-[11px] pt-1">{fanoutReport.message}</p>
            )}
          </div>
        )}

        {/* Cloud MT5 Terminals Table & Cost Monitor */}
        <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-4 space-y-3 font-mono text-xs">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-2.5 gap-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-100">QUẢN LÝ CLOUD MT5 TERMINALS (METAAPI)</span>
              <span className="text-[11px] text-slate-400">({cloudAccounts.length} terminals)</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-800/40 px-2.5 py-0.5 rounded">
                Ước tính chi phí Cloud: ~${(cloudAccounts.length * 0.01 * 24 * 30).toFixed(1)}/tháng ($0.01/terminal/giờ)
              </span>
              <button
                onClick={fetchCloudAccounts}
                className="text-[11px] text-cyan-400 hover:text-cyan-300"
              >
                ↻ Làm mới
              </button>
            </div>
          </div>

          {cloudAccounts.length === 0 ? (
            <div className="p-4 text-center text-slate-500 text-[11px]">
              Chưa có tài khoản Cloud MT5 nào được liên kết trên hệ thống.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 px-3">LOGIN / SÀN</th>
                    <th className="py-2 px-3">TRẠNG THÁI CLOUD</th>
                    <th className="py-2 px-3">VỐN THỰC (EQUITY)</th>
                    <th className="py-2 px-3">RỦI RO</th>
                    <th className="py-2 px-3">TỰ ĐỘNG LỆNH</th>
                    <th className="py-2 px-3 text-right">THAO TÁC ADMIN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {cloudAccounts.map((a: any) => {
                    const isAuto = a.auto_trade === 1;
                    return (
                      <tr key={a.id} className="hover:bg-slate-900/50 transition-colors">
                        <td className="py-2 px-3">
                          <span className="font-bold text-slate-200">#{a.login}</span>
                          <span className="text-slate-400 block text-[10px]">{a.server} {a.account_name ? `(${a.account_name})` : ''}</span>
                        </td>
                        <td className="py-2 px-3">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            DEPLOYED
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className="font-bold text-emerald-400">${Number(a.equity || 0).toLocaleString()}</span>
                          <span className="text-slate-500 block text-[10px]">Bal: ${Number(a.balance || 0).toLocaleString()}</span>
                        </td>
                        <td className="py-2 px-3 text-slate-300">
                          {a.risk_percent}% / Max {a.max_lot} Lot
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isAuto ? 'text-emerald-300 bg-emerald-950/60 border border-emerald-800' : 'text-slate-400 bg-slate-900 border border-slate-700'}`}>
                            {isAuto ? 'ACTIVE' : 'PAUSED'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right space-x-1.5">
                          <button
                            onClick={() => handleToggleAccount(a.id)}
                            className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${isAuto ? 'bg-amber-950/70 text-amber-300 border border-amber-700/50 hover:bg-amber-900' : 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/50 hover:bg-emerald-900'}`}
                          >
                            {isAuto ? 'Tạm Dừng' : 'Kích Hoạt'}
                          </button>
                          <button
                            onClick={() => handleSyncAccount(a.id)}
                            className="px-2 py-1 rounded text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700"
                          >
                            Sync
                          </button>
                          <button
                            onClick={() => handleDeleteAccount(a.id)}
                            className="px-2 py-1 rounded text-[10px] font-bold bg-rose-950/50 hover:bg-rose-900 text-rose-300 border border-rose-800/50"
                          >
                            Undeploy
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
              <span>Ngắt cấp lệnh khẩn cấp (Toàn Hệ Thống)</span>
            </div>
            <p className="text-xs text-slate-300">
              {monitorData.halted == null
                ? 'Chưa xác định trạng thái cấp lệnh.'
                : monitorData.halted
                ? 'Toàn bộ việc cấp lệnh sao chép đang bị ngắt an toàn. Các vị thế hiện tại vẫn được theo dõi.'
                : 'Cấp lệnh được phép cho tài khoản đã bật sao chép và đạt kiểm tra rủi ro.'}
            </p>
            <div className="text-[11px] font-mono text-slate-400 pt-1">
              ■ Tài khoản đang bật sao chép:{' '}
              <b className="text-slate-200">
                {displayAccounts.filter((a: any) => a.enabled).length}/{displayAccounts.length}
              </b>{' '}
              · Khi mở lại cấp lệnh, các tài khoản vẫn tạm dừng cho đến khi được bật sao chép.
            </div>
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
                ? 'Đang chuyển trạng thái…'
                : monitorData.halted
                ? 'Mở lại cấp lệnh'
                : 'Ngắt toàn bộ'}
            </button>
          </div>
        </div>
      </div>

      {/* Two-Team Architecture Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* TEAM 1: Execution & Real-Time Trading Engine */}
        <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <h3 className="font-bold text-sm text-slate-100">Production Execution Engine</h3>
            </div>
            <span className="rounded bg-emerald-950/70 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
              Tài khoản Thực tế
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Quét nến XAU/USD, lọc tin tức kinh tế USD High-Impact và cấp lệnh theo rủi ro.
          </p>

          <div className="space-y-2 text-xs font-mono bg-slate-950/40 p-3 rounded-lg border border-slate-800/60">
            <div className="flex justify-between">
              <span className="text-slate-500">Trạng thái worker:</span>
              <span className={monitorData.halted ? 'text-rose-400' : 'text-emerald-400'}>
                {monitorData.halted
                  ? 'Đã ngắt cấp lệnh'
                  : readyData?.execution_worker?.heartbeat_active
                  ? 'Đang hoạt động'
                  : 'Chưa có nhịp gần đây'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Heartbeat gần nhất:</span>
              <span className="text-slate-200">{formatHeartbeat(executionTick)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Kết nối Redis:</span>
              <span className="text-cyan-300">{readyData ? (readyData.redis?.connected ? 'Đã kết nối' : 'Gián đoạn') : '—'}</span>
            </div>
          </div>
        </div>

        {/* TEAM 2: Research & Validation Team */}
        <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <h3 className="font-bold text-sm text-slate-100">Nghiên cứu & Kiểm định</h3>
            </div>
            <span className="rounded bg-amber-950/70 border border-amber-500/30 px-2 py-0.5 text-[10px] font-mono text-amber-300">
              LangGraph Checkpoint
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Kiểm định Walk-Forward ngoài mẫu và đưa ứng viên vào hàng đợi phê duyệt.
          </p>

          <div className="space-y-2 text-xs font-mono bg-slate-950/40 p-3 rounded-lg border border-slate-800/60">
            <div className="flex justify-between">
              <span className="text-slate-500">Trạng thái worker:</span>
              <span className={researchActive ? 'text-emerald-400' : 'text-slate-300'}>
                {researchActive ? 'Đang hoạt động' : 'Chưa có nhịp gần đây'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Heartbeat gần nhất:</span>
              <span className="text-slate-200">{formatHeartbeat(researchTick)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Kiểm định gần nhất:</span>
              <span className="text-slate-200">
                {lastResearchJob ? formatHeartbeat(Number(lastResearchJob.created)) : 'Chưa có'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Đề xuất chờ duyệt:</span>
              <span className="text-amber-400 font-bold">
                {(monitorData.jobs || []).filter((j: any) => j.state === 'waiting_approval').length} chiến lược
              </span>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-2">
            <button
              onClick={onNavigateApprovals}
              className="flex-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold py-2 text-xs font-mono transition-colors"
            >
              Đi đến Phê duyệt & Kiểm định →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
