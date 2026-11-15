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

  const handleAction = async (approved: boolean) => {
    setSubmitting(true);
    try {
      if (approved) {
        await onApprove(jobId);
        setStatus('ĐÃ PHÊ DUYỆT (Lưu trữ ứng viên nghiên cứu)');
      } else {
        await onReject(jobId);
        setStatus('ĐÃ TỪ CHỐI (Loại bỏ ứng viên)');
      }
    } catch (e: any) {
      alert(`Lỗi: ${e.message}`);
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
            Ứng Viên Walk-Forward #{jobId.slice(0, 8)}
          </h3>
          <span className="rounded bg-amber-950/60 border border-amber-600/50 px-2 py-0.5 text-[10px] font-mono text-amber-300 font-bold">
            needsApproval: {needsApproval ? 'true' : 'false'}
          </span>
        </div>
        <span className="text-slate-400 font-mono text-[11px]">ToolLoopAgent Review</span>
      </div>

      <p className="text-slate-300 leading-relaxed text-xs">
        {report.strategy || 'Chiến lược SMA Crossover, huấn luyện rolling 120 bar / 60 bar OOS.'}
      </p>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
        <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
          <div className="text-[10px] text-slate-500">LÃI OOS RÒNG</div>
          <div className={`text-sm font-bold ${(report.oos_net_price_units || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {(report.oos_net_price_units || 0) > 0 ? '+' : ''}{report.oos_net_price_units || 0} pts
          </div>
        </div>
        <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
          <div className="text-[10px] text-slate-500">SỤT GIẢM TỐI ĐA</div>
          <div className="text-sm font-bold text-rose-400">
            {report.max_drawdown_price_units || 0} pts
          </div>
        </div>
        <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
          <div className="text-[10px] text-slate-500">SỐ CHU KỲ TEST</div>
          <div className="text-sm font-bold text-slate-200">
            {report.folds ? report.folds.length : 13} Folds
          </div>
        </div>
        <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
          <div className="text-[10px] text-slate-500">TRẠNG THÁI AI</div>
          <div className="text-sm font-bold text-cyan-400">
            Chờ Quyết Định
          </div>
        </div>
      </div>

      {status ? (
        <div className="rounded-lg bg-slate-900 p-3 text-center font-mono font-bold text-cyan-300 border border-slate-800">
          {status}
        </div>
      ) : (
        <div className="flex items-center justify-end gap-3 pt-2">
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
      )}
    </article>
  );
};

export const AdminApprovalQueue: React.FC = () => {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCandidates = async () => {
    try {
      const res = await fetch('/api/admin/monitor');
      if (res.ok) {
        const data = await res.json();
        const pending = (data.jobs || []).filter((j: any) => j.state === 'waiting_approval');
        setCandidates(pending);
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

  const handleApprove = async (jobId: string) => {
    const res = await fetch(`/api/admin/research/${jobId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({ approved: true }),
    });
    if (!res.ok) throw new Error('Không thể duyệt ứng viên.');
    await fetchCandidates();
  };

  const handleReject = async (jobId: string) => {
    const res = await fetch(`/api/admin/research/${jobId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({ approved: false }),
    });
    if (!res.ok) throw new Error('Không thể từ chối ứng viên.');
    await fetchCandidates();
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div>
          <h2 className="text-base font-bold text-slate-100 tracking-tight">
            Hàng Đợi Phê Duyệt Chiến Lược (Vercel AI SDK 6 ToolLoopAgent)
          </h2>
          <p className="text-xs text-slate-400">
            Cơ chế human-in-the-loop: Chiến lược mới từ WFO bắt buộc phải có sự chấp thuận trực tiếp của Admin.
          </p>
        </div>
        <span className="rounded-full bg-cyan-950 border border-cyan-500/40 px-3 py-1 text-xs font-mono text-cyan-300">
          {candidates.length} ứng viên chờ
        </span>
      </div>

      {loading ? (
        <div className="text-xs text-slate-500 font-mono italic">Đang kiểm tra hàng đợi...</div>
      ) : candidates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-500 font-mono">
          ✓ Không có ứng viên nào đang chờ phê duyệt. Toàn bộ vòng lặp an toàn.
        </div>
      ) : (
        <div className="space-y-4">
          {candidates.map((job) => {
            const resultData = job.result ? JSON.parse(job.result) : {};
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
    </section>
  );
};

