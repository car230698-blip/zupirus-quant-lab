import { useQuantChat } from './useQuantChat.ts';
import React, { useState, useEffect } from 'react';
import type { StrategyApprovalCardProps } from '../types/ai.ts';

export const StrategyApprovalCardUI: React.FC<StrategyApprovalCardProps> = ({
  jobId,
  report,
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
            Chờ phê duyệt
          </span>
        </div>
        <span className="text-slate-400 font-mono text-[11px]">LangGraph · Chờ quyết định</span>
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
  const { messages, sendMessage, setMessages, status: reviewStatus, error: reviewError } = useQuantChat('admin');
  const reviewing = reviewStatus === 'submitted' || reviewStatus === 'streaming';
  const review = messages.filter((message) => message.role === 'assistant').at(-1);
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
        setBanner('Đã đưa yêu cầu kiểm định Walk-Forward vào hàng đợi.');
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
    setBanner(`Đã phê duyệt ứng viên #${jobId.slice(0, 10)}.`);
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
    <section className="space-y-5">
      {/* Header with Run WFO button */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-base font-bold text-slate-100 tracking-tight">
            Phê duyệt chiến lược & Kiểm định
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

      {/* Runtime Policy vs Approved Candidates distinction banner */}
      <div className="rounded-xl border border-cyan-500/30 bg-[#0a1120] p-4 font-mono text-xs space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-bold text-sm text-slate-100">Chính Sách Thực Thi Đang Chạy (Runtime Policy)</span>
          </div>
          <span className="rounded bg-emerald-950 border border-emerald-700/60 px-2.5 py-0.5 text-[10px] text-emerald-300 font-bold">
            ĐANG CHẠY TRONG RUNTIME
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] text-slate-300">
          <div>
            <span className="text-slate-500 text-[10px] block">PHIÊN BẢN CHÍNH SÁCH</span>
            <span className="font-bold text-cyan-300">v2.1.0 Multi-Coordinator</span>
          </div>
          <div>
            <span className="text-slate-500 text-[10px] block">KHUNG THỜI GIAN NẾN</span>
            <span className="font-bold text-slate-200">M15 (Nến đã đóng)</span>
          </div>
          <div>
            <span className="text-slate-500 text-[10px] block">MÔ HÌNH QUYẾT ĐỊNH</span>
            <span className="text-slate-300">Trend + MeanRev + Breakout</span>
          </div>
          <div>
            <span className="text-slate-500 text-[10px] block">CƠ CHẾ KÍCH HOẠT</span>
            <span className="text-amber-300 font-semibold">Chưa có luồng kích hoạt tự động</span>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 border-t border-slate-800/70 pt-2 leading-relaxed">
          ℹ <b className="text-slate-300">Phân định rõ ràng:</b> &ldquo;Đã duyệt ứng viên&rdquo; là ghi nhận lưu trữ kết quả kiểm định nghiên cứu vào hệ thống. Việc này <span className="text-amber-300 underline">không tự động thay đổi</span> chính sách &ldquo;Đang chạy&rdquo; của Quant Engine. Hiện tại hệ thống chưa có luồng tự động ghi đè mã nguồn thực thi, mọi thăng cấp chính sách vào runtime cần quy trình đánh giá và bàn giao có kiểm soát.
        </p>
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

      {/* Side-by-side Layout: Left = Candidate Profiles, Right = Assistant with Context */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN: Candidate Queue & History */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold font-mono text-slate-300 uppercase tracking-wider">
              Danh Sách Hồ Sơ Ứng Viên ({candidates.length} đang chờ)
            </h3>
          </div>

          {loading ? (
            <div className="text-xs text-slate-500 font-mono italic">Đang kiểm tra hàng đợi...</div>
          ) : candidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-[#0c1322]/60 p-8 text-center text-xs text-slate-400 font-mono space-y-2">
              <div>Không có ứng viên đang chờ phê duyệt.</div>
              <div className="text-[11px] text-slate-500">
                Nhấn &ldquo;+ Chạy Walk-Forward OOS ↗&rdquo; ở góc trên để khởi chạy kiểm định 120 bar Train / 60 bar OOS mới.
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
                    onApprove={handleApprove}
                    onReject={handleReject}
                  />
                );
              })}
            </div>
          )}

          {/* History */}
          {historyJobs.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-[#0c1322] p-4 space-y-2.5">
              <div className="text-xs font-semibold text-slate-300 font-mono">
                Lịch Sử Quyết Định Walk-Forward ({historyJobs.length} ứng viên đã xử lý)
              </div>
              <div className="space-y-2">
                {historyJobs.map((j) => {
                  let resObj: Record<string, any> = {};
                  try {
                    resObj = j.result ? JSON.parse(j.result) : {};
                  } catch {
                    resObj = {};
                  }
                  const isApproved = j.decision === 1 || resObj.disposition === 'approved_for_demo_review';
                  const dispLabel = isApproved ? 'ĐÃ DUYỆT ỨNG VIÊN' : 'ĐÃ TỪ CHỐI';
                  const oos = resObj.report?.oos_net_price_units;
                  return (
                    <div
                      key={j.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-900/70 border border-slate-800/80 px-3 py-2 text-xs font-mono"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-semibold">#{j.id.slice(0, 12)}</span>
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 uppercase">
                          {j.state === 'resume' ? 'Chờ tiếp tục' : j.state}
                        </span>
                        {oos !== undefined && (
                          <span className="text-emerald-400">OOS: {oos >= 0 ? `+${oos}` : oos} pts</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                            isApproved
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/40'
                              : 'bg-rose-950/80 text-rose-300 border border-rose-600/40'
                          }`}
                        >
                          {dispLabel}
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
        </div>

        {/* RIGHT COLUMN: Trợ lý kiểm định cạnh hồ sơ ứng viên */}
        <div className="lg:col-span-5 space-y-4">
          <section className="quant-panel p-4 space-y-3 sticky top-4" aria-label="Trợ lý kiểm định">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Trợ lý kiểm định định lượng</h3>
                <span className="text-[10px] font-mono text-cyan-400">AI Contextual Review</span>
              </div>
              <button
                className="quant-quiet text-xs"
                type="button"
                disabled={reviewing}
                onClick={() => {
                  setMessages([]);
                  void sendMessage({ text: 'Kiểm tra ứng viên gần nhất đang chờ duyệt và tóm tắt rủi ro.' });
                }}
              >
                {reviewing ? 'Đang phân tích…' : 'Phân tích ứng viên ↗'}
              </button>
            </div>

            <div aria-live="polite" className="space-y-2 text-xs font-mono">
              {review?.parts ? (
                review.parts.map((part, index) => {
                  if (part.type === 'text') {
                    return (
                      <p className="text-slate-300 leading-relaxed bg-slate-950/40 p-2.5 rounded border border-slate-800/60" key={index}>
                        {part.text}
                      </p>
                    );
                  }
                  if (part.type === 'data-approval') {
                    return (
                      <div className="rounded-lg bg-amber-950/30 border border-amber-500/40 p-2.5 text-[11px] text-amber-200" key={index}>
                        <div className="font-bold">Ứng viên: #{part.data.jobId.slice(0, 12)}</div>
                        <div className="text-slate-400 mt-1">
                          Hồ sơ Walk-Forward Out-Of-Sample đang hiển thị ở cột bên cạnh. Đánh giá kỹ Max Drawdown trước khi ra quyết định.
                        </div>
                      </div>
                    );
                  }
                  return null;
                })
              ) : (
                <div className="text-slate-400 text-xs py-4 text-center leading-relaxed">
                  Nhấn &ldquo;Phân tích ứng viên ↗&rdquo; để trợ lý AI tóm tắt các chỉ số OOS Net PnL, Max Drawdown và kiểm tra quá khớp (overfitting) cho hồ sơ đang chờ duyệt.
                </div>
              )}
              {reviewError && <div className="quant-alert" role="alert">Không thể tải tóm tắt kiểm định.</div>}
            </div>

            <div className="border-t border-slate-800/80 pt-3 text-[11px] font-mono text-slate-500 space-y-1">
              <div>• Tiêu chuẩn chấp thuận: OOS PnL &gt; 0, Max DD &lt; 50 pts</div>
              <div>• Trợ lý sử dụng Vercel AI SDK 6 ToolLoop Stream</div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
};
