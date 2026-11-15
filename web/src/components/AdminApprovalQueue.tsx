import React, { useState, useEffect } from 'react';
import type { StrategyApprovalCardProps } from '../types/ai.ts';

export const StrategyApprovalCardUI: React.FC<StrategyApprovalCardProps> = ({
  jobId,
  report,
  needsApproval,
  onApprove,
  onReject,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAction = async (approved: boolean) => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      if (approved) {
        await onApprove(jobId);
        setStatus('ĐÃ PHÊ DUYỆT (Lưu trữ ứng viên nghiên cứu)');
      } else {
        await onReject(jobId);
        setStatus('ĐÃ TỪ CHỐI (Loại bỏ ứng viên)');
      }
    } catch (e: any) {
      setErrorMsg(`Lỗi: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article className="rounded-xl border border-amber-500/40 bg-[#0d1424] p-5 text-xs shadow-lg space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-ping" />
          <h3 className="font-bold text-sm text-slate-100 tracking-tight">
            Ứng Viên Walk-Forward #{jobId.slice(0, 12)}
          </h3>
          <span className="rounded bg-amber-950/60 border border-amber-600/50 px-2 py-0.5 text-[10px] font-mono text-amber-300 font-bold">
            needsApproval: {needsApproval ? 'true' : 'false'}
          </span>
        </div>
        <span className="text-slate-400 font-mono text-[11px]">ToolLoopAgent Review · LangGraph Interrupt</span>
      </div>

      <p className="text-slate-300 leading-relaxed text-xs">
        {report.strategy || 'Chiến lược SMA Crossover, huấn luyện rolling 120 bar / 60 bar OOS.'}
      </p>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
        <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
          <div className="text-[10px] text-slate-500">LÃI OOS RÒNG</div>
          <div
            className={`text-sm font-bold ${
              (report.oos_net_price_units || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {(report.oos_net_price_units || 0) > 0 ? '+' : ''}
            {report.oos_net_price_units || 0} pts
          </div>
        </div>
        <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
          <div className="text-[10px] text-slate-500">SỤT GIẢM TỐI ĐA</div>
          <div className="text-sm font-bold text-rose-400">{report.max_drawdown_price_units || 0} pts</div>
        </div>
        <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
          <div className="text-[10px] text-slate-500">SỐ CHU KỲ TEST</div>
          <div className="text-sm font-bold text-slate-200">
            {report.folds ? report.folds.length : 13} Folds ({report.trades ?? 0} lệnh)
          </div>
        </div>
        <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
          <div className="text-[10px] text-slate-500">TRẠNG THÁI AI</div>
          <div className="text-sm font-bold text-cyan-400">Chờ Quyết Định</div>
        </div>
      </div>

      {report.folds && report.folds.length > 0 && (
        <details className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-3 py-2">
          <summary className="cursor-pointer font-mono text-[11px] text-slate-400 hover:text-slate-200">
            Xem chi tiết {report.folds.length} chu kỳ Walk-Forward Out-of-Sample (120 bar Train / 60 bar OOS)
          </summary>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[10px]">
            {report.folds.map((f, idx) => (
              <div key={idx} className="rounded bg-slate-900/90 border border-slate-800 p-1.5">
                <div className="text-slate-400">
                  Fold #{idx + 1} · Fast SMA({f.period})
                </div>
                <div className={f.oos_net_price_units >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {f.oos_net_price_units >= 0 ? '+' : ''}
                  {f.oos_net_price_units} pts ({f.trades} lệnh)
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {errorMsg && (
        <div className="rounded-lg bg-rose-950/60 border border-rose-500/40 p-2.5 text-rose-200 font-mono text-xs">
          {errorMsg}
        </div>
      )}

      {status ? (
        <div className="rounded-lg bg-slate-900 p-3 text-center font-mono font-bold text-cyan-300 border border-slate-800">
          {status}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="text-[11px] text-slate-400 font-mono">
            Phê duyệt chỉ lưu trữ ứng viên nghiên cứu; không tự động thay đổi chiến lược đang chạy.
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleAction(false)}
              className="rounded-lg border border-rose-600/50 bg-rose-950/40 px-4 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-900/50 disabled:opacity-50 transition-colors"
            >
              Từ Chối (Reject)
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleAction(true)}
              className="rounded-lg bg-emerald-500 hover:bg-emerald-400 px-5 py-2 text-xs font-bold text-slate-950 disabled:opacity-50 shadow-md transition-colors"
            >
              Phê Duyệt (Approve)
            </button>
          </div>
        </div>
      )}
    </article>
  );
};

export const AdminApprovalQueue: React.FC = () => {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [historyJobs, setHistoryJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningWfo, setRunningWfo] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const fetchCandidates = async () => {
    try {
      const res = await fetch('/api/admin/monitor');
      if (res.ok) {
        const data = await res.json();
        const allJobs = data.jobs || [];
        setCandidates(allJobs.filter((j: any) => j.state === 'waiting_approval'));
        setHistoryJobs(allJobs.filter((j: any) => j.state !== 'waiting_approval').slice(0, 6));
      }
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCandidates();
    const interval = setInterval(fetchCandidates, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleRunWalkForward = async () => {
    setRunningWfo(true);
    setBanner(null);
    try {
      const res = await fetch('/api/admin/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      });
      if (res.ok) {
        setBanner('Đã chạy Walk-Forward OOS (120 bar train / 60 bar OOS) và dừng tại checkpoint chờ Admin duyệt (needsApproval: true).');
        await fetchCandidates();
      }
    } finally {
      setRunningWfo(false);
    }
  };

  const handleApprove = async (jobId: string) => {
    const res = await fetch(`/api/admin/research/${jobId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({ approved: true }),
    });
    if (!res.ok) throw new Error('Không thể duyệt ứng viên.');
    setBanner(`Đã phê duyệt ứng viên #${jobId.slice(0, 10)} (approved_for_demo_review).`);
    await fetchCandidates();
  };

  const handleReject = async (jobId: string) => {
    const res = await fetch(`/api/admin/research/${jobId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({ approved: false }),
    });
    if (!res.ok) throw new Error('Không thể từ chối ứng viên.');
    setBanner(`Đã từ chối ứng viên #${jobId.slice(0, 10)} (rejected).`);
    await fetchCandidates();
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-base font-bold text-slate-100 tracking-tight">
            Hàng Đợi Phê Duyệt Chiến Lược (Vercel AI SDK 6 ToolLoopAgent)
          </h2>
          <p className="text-xs text-slate-400">
            Cơ chế human-in-the-loop: Chiến lược mới từ Walk-Forward OOS bắt buộc phải có sự chấp thuận trực tiếp của Admin.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="rounded-full bg-cyan-950 border border-cyan-500/40 px-3 py-1 text-xs font-mono text-cyan-300">
            {candidates.length} ứng viên chờ
          </span>
          <button
            type="button"
            disabled={runningWfo}
            onClick={handleRunWalkForward}
            className="rounded-lg bg-cyan-500 hover:bg-cyan-400 px-3.5 py-1.5 text-xs font-bold text-slate-950 transition-colors disabled:opacity-50"
          >
            {runningWfo ? 'Đang chạy WFO...' : '+ Chạy Walk-Forward OOS ↗'}
          </button>
        </div>
      </div>

      {banner && (
        <div className="rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-4 py-2.5 text-xs text-cyan-200 font-mono flex items-center justify-between">
          <span>{banner}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-cyan-400 hover:text-cyan-200 ml-3 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-slate-500 font-mono italic">Đang kiểm tra hàng đợi...</div>
      ) : candidates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-[#0c1322]/60 p-8 text-center text-xs text-slate-400 font-mono space-y-2">
          <div>✓ Không có ứng viên nào đang chờ phê duyệt. Toàn bộ vòng lặp an toàn.</div>
          <div className="text-[11px] text-slate-500">
            Nhấn &ldquo;+ Chạy Walk-Forward OOS ↗&rdquo; ở góc phải để khởi chạy kiểm định 120 bar Train / 60 bar OOS mới.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {candidates.map((job) => {
            let resultData: Record<string, any> = {};
            try {
              resultData = job.result ? JSON.parse(job.result) : {};
            } catch {
              resultData = {};
            }
            return (
              <StrategyApprovalCardUI
                key={job.id}
                jobId={job.id}
                report={resultData.report || {}}
                needsApproval={true}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            );
          })}
        </div>
      )}

      {historyJobs.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-[#0c1322] p-4 space-y-2.5">
          <div className="text-xs font-semibold text-slate-300 font-mono">
            Lịch Sử Phê Duyệt Walk-Forward Gần Đây ({historyJobs.length})
          </div>
          <div className="space-y-2">
            {historyJobs.map((j) => {
              let resObj: Record<string, any> = {};
              try {
                resObj = j.result ? JSON.parse(j.result) : {};
              } catch {
                resObj = {};
              }
              const disp = resObj.disposition || (j.decision === 1 ? 'approved_for_demo_review' : 'rejected');
              const oos = resObj.report?.oos_net_price_units;
              return (
                <div
                  key={j.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-900/70 border border-slate-800/80 px-3 py-2 text-xs font-mono"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-slate-300 font-semibold">#{j.id.slice(0, 12)}</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 uppercase">
                      {j.state}
                    </span>
                    {oos !== undefined && (
                      <span className="text-emerald-400">OOS: {oos >= 0 ? `+${oos}` : oos} pts</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                        disp === 'approved_for_demo_review'
                          ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/40'
                          : 'bg-rose-950/80 text-rose-300 border border-rose-600/40'
                      }`}
                    >
                      {disp}
                    </span>
                    <span className="text-slate-500 text-[11px]">
                      {j.created ? new Date(j.created * 1000).toLocaleTimeString('vi-VN') : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
