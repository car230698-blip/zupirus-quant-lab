import React from 'react';

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
  return (
    <div className="space-y-6">
      <div className="quant-metrics grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ['Tài khoản', monitorData.accounts.length],
          ['Đang sao chép', monitorData.accounts.filter((account: any) => account.enabled).length],
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
                {monitorData.accounts.filter((a: any) => a.enabled).length}/{monitorData.accounts.length}
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
              {killSwitchLoading ? 'Đang xử lý...' : monitorData.halted ? 'Mở lại cấp lệnh' : 'Ngắt cấp lệnh'}
            </button>
          </div>
        </div>
      </div>

      {/* The Two Agent Teams */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* TEAM 1: Execution & Real-Time Dispatch Team */}
        <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
              <h3 className="font-bold text-sm text-slate-100">Phân tích & Thực thi</h3>
            </div>
            <span className="rounded bg-cyan-950/70 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
              Deterministic Engine
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Theo dõi báo giá XAU/USD, đánh giá chiến lược theo nến đã đóng và kiểm tra rủi ro trước khi cấp tín hiệu.
          </p>

          <div className="space-y-2 text-xs font-mono bg-slate-950/40 p-3 rounded-lg border border-slate-800/60">
            <div className="flex justify-between">
              <span className="text-slate-500">Trạng thái vận hành:</span>
              <span className="text-emerald-400 font-bold">
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
