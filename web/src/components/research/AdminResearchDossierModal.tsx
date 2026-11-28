import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../../api/client';
import { StatusBadge } from '../ui/Primitives';
import { OrderChatModal } from './OrderChatModal';
import {
  X,
  FileText,
  DollarSign,
  Play,
  RotateCcw,
  CheckCircle2,
  Clock,
  Archive,
  Download,
  ShieldAlert,
  MessageSquare,
  Layers,
  Sparkles,
  RefreshCw,
  Sliders,
  AlertCircle,
} from 'lucide-react';

export interface AdminResearchDossierModalProps {
  requestId: string;
  onClose: () => void;
  onUpdated: () => void;
}

export const AdminResearchDossierModal: React.FC<AdminResearchDossierModalProps> = ({
  requestId,
  onClose,
  onUpdated,
}) => {
  const [order, setOrder] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'chat' | 'runs' | 'exceptions'>('overview');
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Proposal / Quote form
  const [quotePrice, setQuotePrice] = useState<number>(10000);
  const [turnaroundHours, setTurnaroundHours] = useState<number>(48);
  const [scopeNotes, setScopeNotes] = useState<string>('');
  const [researchQuestion, setResearchQuestion] = useState<string>('');
  const [draftProposal, setDraftProposal] = useState<any | null>(null);

  // Exception form
  const [rerunReason, setRerunReason] = useState<string>('');
  const [overrideStatus, setOverrideStatus] = useState<string>('READY_FOR_REVIEW');
  const [overrideReason, setOverrideReason] = useState<string>('');

  const loadDetail = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res: any = await api.get(`/api/v1/research/orders/${encodeURIComponent(requestId)}`);
      if (res?.order) {
        setOrder(res.order);
        setQuotePrice(Number(res.order.quoted_price_usd || 10000));
        setTurnaroundHours(Number(res.order.turnaround_hours || 48));
        setScopeNotes(res.order.scope_notes || '');
        setResearchQuestion(res.order.hypothesis_prompt || res.order.problem_description || '');
      }

      // Also fetch AI draft proposal and ambiguities
      try {
        const draftRes: any = await api.get(`/api/v1/admin/research/requests/${encodeURIComponent(requestId)}/draft-proposal`);
        if (draftRes?.draft_proposal) {
          setDraftProposal(draftRes.draft_proposal);
        }
      } catch {
        // ignore draft fetch
      }
    } catch (err: any) {
      setError(err?.message || 'Không thể tải chi tiết hồ sơ nghiên cứu.');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSendProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api.post(`/api/v1/admin/research/requests/${encodeURIComponent(requestId)}/proposal`, {
        research_question: researchQuestion,
        quoted_price_usd: Number(quotePrice),
        turnaround_hours: Number(turnaroundHours),
        scope_notes: scopeNotes,
      });
      setActionMsg('Đã gửi đề xuất & báo giá chính thức thành công.');
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      setActionMsg(`Lỗi gửi đề xuất: ${err?.message || 'Thất bại'}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleRunStudy = async () => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api.post(`/api/v1/admin/research/requests/${encodeURIComponent(requestId)}/run`, {});
      setActionMsg('Đã kích hoạt engine nghiên cứu thành công.');
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      setActionMsg(`Lỗi chạy nghiên cứu: ${err?.message || 'Thất bại'}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleRerunStudy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rerunReason.trim()) {
      setActionMsg('Vui lòng nhập lý do chạy lại.');
      return;
    }
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api.post(`/api/v1/admin/research/requests/${encodeURIComponent(requestId)}/rerun`, {
        reason: rerunReason.trim(),
      });
      setActionMsg('Đã kích hoạt chạy lại nghiên cứu thành công.');
      setRerunReason('');
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      setActionMsg(`Lỗi chạy lại: ${err?.message || 'Thất bại'}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleOverrideStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideReason.trim()) {
      setActionMsg('Vui lòng nhập lý do can thiệp thay đổi trạng thái.');
      return;
    }
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api.post(`/api/v1/admin/research/requests/${encodeURIComponent(requestId)}/override-status`, {
        new_status: overrideStatus,
        reason: overrideReason.trim(),
      });
      setActionMsg(`Đã can thiệp chuyển trạng thái sang ${overrideStatus}.`);
      setOverrideReason('');
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      setActionMsg(`Lỗi can thiệp: ${err?.message || 'Thất bại'}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleApproveDeliverable = async (runId?: string) => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api.post(`/api/v1/admin/research/requests/${encodeURIComponent(requestId)}/approve`, {
        run_id: runId || undefined,
      });
      setActionMsg('Đã duyệt và bàn giao riêng hồ sơ thành công cho khách hàng.');
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      setActionMsg(`Lỗi duyệt bàn giao: ${err?.message || 'Thất bại'}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleArchive = async () => {
    if (!window.confirm('Bạn có chắc chắn muốn lưu trữ hồ sơ này không? Hồ sơ sẽ được ẩn khỏi hàng đợi hoạt động nhưng bảo toàn bằng chứng.')) {
      return;
    }
    setActionBusy(true);
    try {
      await api.post(`/api/v1/admin/research/requests/${encodeURIComponent(requestId)}/archive`, {});
      onUpdated();
      onClose();
    } catch (err: any) {
      setActionMsg(`Lỗi lưu trữ: ${err?.message || 'Thất bại'}`);
      setActionBusy(false);
    }
  };

  if (loading && !order) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="p-8 rounded-xl bg-slate-900 border border-slate-700 text-center text-xs text-cyan-300 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Đang tải hồ sơ nghiên cứu {requestId}...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-[#0B1220] border border-slate-700/80 rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/60 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-cyan-400 font-bold text-sm">{order?.id}</span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                {order?.product_type}
              </span>
              <StatusBadge
                tone={
                  order?.status === 'DELIVERED' || order?.status === 'COMPLETED'
                    ? 'success'
                    : order?.status === 'READY_FOR_REVIEW'
                    ? 'info'
                    : order?.status === 'FAILED' || order?.status === 'REJECTED'
                    ? 'danger'
                    : 'warning'
                }
              >
                {order?.status}
              </StatusBadge>
              {order?.retry_count > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950/60 text-amber-300 border border-amber-800/40">
                  Lần chạy lại: {order.retry_count}/5
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 flex flex-wrap items-center gap-3">
              <span>Khách: <strong className="text-white">{order?.client_email}</strong></span>
              <span>Mã: <strong className="font-mono text-cyan-300">{order?.symbol} ({order?.timeframe})</strong></span>
              <span>Phiên bản: <strong className="text-slate-200">v{order?.proposal_version || 1}</strong></span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {order?.status === 'CONFIRMED' && (
              <button
                type="button"
                disabled={actionBusy}
                onClick={handleRunStudy}
                className="quant-button quant-button-primary text-xs py-1.5 px-3.5 flex items-center gap-1.5 shadow-lg shadow-cyan-950"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{actionBusy ? 'Đang thực thi...' : 'Chạy Nghiên Cứu'}</span>
              </button>
            )}

            {order?.status === 'READY_FOR_REVIEW' && (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => handleApproveDeliverable()}
                className="quant-button bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-1.5 px-3.5 flex items-center gap-1.5 shadow-lg shadow-emerald-950"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{actionBusy ? 'Đang duyệt...' : 'Duyệt & Bàn Giao Riêng'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              title="Đóng hồ sơ (Esc)"
              aria-label="Đóng hồ sơ"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ERROR BANNER */}
        {error && (
          <div className="bg-rose-950/50 border-b border-rose-800/60 px-5 py-2.5 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* WAITING REASON BANNER */}
        {order?.waiting_reason_vi && (
          <div className="bg-slate-900/90 border-b border-slate-800/80 px-5 py-2 text-xs flex items-center justify-between gap-3 text-cyan-300">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Tiến độ hiện tại: <strong>{order.waiting_reason_vi}</strong></span>
            </div>
            {actionMsg && <span className="text-emerald-400 font-semibold">{actionMsg}</span>}
          </div>
        )}

        {/* DOSSIER TABS NAVIGATION */}
        <div className="border-b border-slate-800 px-5 flex items-center gap-6 text-xs font-semibold bg-slate-950/40 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`py-3 transition relative cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'overview' ? 'text-cyan-400 border-b-2 border-cyan-400 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Đề Xuất & Báo Giá</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`py-3 transition relative cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'chat' ? 'text-cyan-400 border-b-2 border-cyan-400 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Trao Đổi & Tệp Tin</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('runs')}
            className={`py-3 transition relative cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'runs' ? 'text-cyan-400 border-b-2 border-cyan-400 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Lượt Chạy ({order?.runs?.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('exceptions')}
            className={`py-3 transition relative cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'exceptions' ? 'text-amber-400 border-b-2 border-amber-400 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Khu Ngoại Lệ & Audit Log ({order?.audit_logs?.length || 0})</span>
          </button>
        </div>

        {/* TAB CONTENTS (SCROLLABLE BODY) */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {/* 1. OVERVIEW & PROPOSAL */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Problem Description */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">
                  Mô Tả Bài Toán Từ Khách Hàng
                </div>
                <div className="text-sm text-slate-200 leading-relaxed font-sans">
                  {order?.problem_description || order?.hypothesis_prompt || 'Không có mô tả chi tiết'}
                </div>
              </div>

              {/* AI Ambiguity Warnings */}
              {draftProposal?.ambiguities_vi && draftProposal.ambiguities_vi.length > 0 && (
                <div className="p-4 rounded-xl bg-amber-950/25 border border-amber-800/40 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-300 font-mono">
                    <Sparkles className="w-4 h-4" />
                    <span>Hệ Thống Tự Động Rà Soát Tính Rõ Ràng & Bất Định:</span>
                  </div>
                  <ul className="list-disc list-inside text-xs text-amber-200/90 space-y-1">
                    {draftProposal.ambiguities_vi.map((amb: string, idx: number) => (
                      <li key={idx}>{amb}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Merged Proposal + Quote Form */}
              <form onSubmit={handleSendProposal} className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-emerald-400" />
                    <span>Cập Nhật Đề Xuất & Báo Giá (Phiên Bản v{Number(order?.proposal_version || 1) + 1})</span>
                  </h4>
                  <span className="text-xs text-slate-400">1-click gửi đề xuất chính thức</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Giá báo hợp đồng (USD)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={quotePrice}
                      onChange={(e) => setQuotePrice(Number(e.target.value))}
                      className="quant-input text-xs w-full font-mono text-emerald-300 font-bold"
                      required
                    />
                    <p className="text-[11px] text-slate-500 mt-1">Mức 10.000 USD là mục tiêu cho hợp đồng phù hợp.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Thời hạn hoàn thành (Giờ)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={turnaroundHours}
                      onChange={(e) => setTurnaroundHours(Number(e.target.value))}
                      className="quant-input text-xs w-full font-mono"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Câu hỏi kiểm định định lượng (Research Question)
                  </label>
                  <input
                    type="text"
                    value={researchQuestion}
                    onChange={(e) => setResearchQuestion(e.target.value)}
                    className="quant-input text-xs w-full"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Ghi chú phạm vi & điều khoản bổ sung (Scope Notes)
                  </label>
                  <textarea
                    rows={3}
                    value={scopeNotes}
                    onChange={(e) => setScopeNotes(e.target.value)}
                    className="quant-input text-xs w-full"
                    placeholder="Bao gồm phân tích độ trễ CPI, rổ tài sản Vàng & FX, kiểm định chi phí trượt giá..."
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={actionBusy}
                    className="quant-button quant-button-primary text-xs py-2 px-4 shadow-lg shadow-cyan-950"
                  >
                    {actionBusy ? 'Đang gửi...' : `Gửi Đề Xuất & Báo Giá (v${Number(order?.proposal_version || 1) + 1})`}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 2. REAL-TIME CHAT */}
          {activeTab === 'chat' && (
            <div className="h-[560px]">
              <OrderChatModal
                requestId={order.id}
                orderTitle={order.hypothesis_prompt || order.problem_description}
                currentStatus={order.status}
                userRole="admin"
                embedded={true}
                onClose={() => setActiveTab('overview')}
                onOrderUpdated={loadDetail}
              />
            </div>
          )}

          {/* 3. RUNS & DELIVERABLES */}
          {activeTab === 'runs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
                  Lịch Sử Các Lần Thực Thi Định Lượng ({order?.runs?.length || 0})
                </h4>
                {order?.deliverable_pdf_path && (
                  <div className="flex items-center gap-2">
                    <a
                      href={`/api/v1/research/orders/${encodeURIComponent(order.id)}/download-pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="quant-button quant-button-secondary text-xs py-1 px-3 flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Xem / Tải PDF</span>
                    </a>
                    {order?.deliverable_bundle_path && (
                      <a
                        href={`/api/v1/research/orders/${encodeURIComponent(order.id)}/download-bundle`}
                        target="_blank"
                        rel="noreferrer"
                        className="quant-button quant-button-secondary text-xs py-1 px-3 flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Tải Bundle ZIP</span>
                      </a>
                    )}
                  </div>
                )}
              </div>

              {(!order?.runs || order.runs.length === 0) ? (
                <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs font-mono">
                  Chưa có lần chạy nào được ghi nhận. Khi hoàn tất thanh toán, worker sẽ tự động thực thi.
                </div>
              ) : (
                <div className="space-y-3">
                  {order.runs.map((r: any) => (
                    <div
                      key={r.id}
                      className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-white">Lượt #{r.run_number}</span>
                          <span className="font-mono text-[11px] text-slate-400">({r.id})</span>
                          <StatusBadge tone={r.status === 'COMPLETED' ? 'success' : r.status === 'RUNNING' ? 'info' : 'danger'}>
                            {r.status}
                          </StatusBadge>
                          {r.is_approved === 1 && (
                            <span className="px-2 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold text-[10px]">
                              Đã Phê Duyệt
                            </span>
                          )}
                        </div>
                        <div className="text-slate-400 text-[11px]">
                          Bắt đầu: {new Date(r.started_at * 1000).toLocaleString('vi-VN')}
                          {r.completed_at && ` · Hoàn thành: ${new Date(r.completed_at * 1000).toLocaleString('vi-VN')}`}
                        </div>
                        {r.deliverable_bundle_sha256 && (
                          <div className="font-mono text-[10px] text-slate-500">
                            SHA-256: {r.deliverable_bundle_sha256}
                          </div>
                        )}
                        {r.error_details && (
                          <div className="text-rose-300 text-[11px]">
                            Lỗi: {r.error_details}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {r.status === 'COMPLETED' && (
                          <>
                            <a
                              href={`/api/v1/research/orders/${encodeURIComponent(order.id)}/download-pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="quant-button quant-button-secondary text-[11px] py-1 px-2.5 flex items-center gap-1"
                            >
                              <Download className="w-3 h-3 text-cyan-400" />
                              <span>Xem PDF</span>
                            </a>
                            {r.is_approved !== 1 && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => handleApproveDeliverable(r.id)}
                                className="quant-button bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] py-1 px-2.5 flex items-center gap-1 shadow-sm"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Duyệt Lần Chạy Này</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 4. EXCEPTIONS & AUDIT LOG */}
          {activeTab === 'exceptions' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Rerun Panel */}
                <form onSubmit={handleRerunStudy} className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5 font-mono">
                      <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                      <span>Chạy Lại Nghiên Cứu (Re-run)</span>
                    </span>
                    <span className="text-[11px] text-slate-400">Giới hạn: {order?.retry_count || 0}/5 lần</span>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Lý do chạy lại (bắt buộc ghi nhận audit)</label>
                    <input
                      type="text"
                      required
                      placeholder="Ví dụ: Cập nhật lại nến bổ sung hoặc điều chỉnh tham số..."
                      value={rerunReason}
                      onChange={(e) => setRerunReason(e.target.value)}
                      className="quant-input text-xs w-full"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={actionBusy || (order?.retry_count || 0) >= 5}
                    className="quant-button quant-button-secondary text-xs w-full py-1.5"
                  >
                    {(order?.retry_count || 0) >= 5 ? 'Đã đạt giới hạn (5 lần)' : 'Kích Hoạt Chạy Lại'}
                  </button>
                </form>

                {/* Status Override Panel */}
                <form onSubmit={handleOverrideStatus} className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5 font-mono">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                      <span>Can Thiệp Trạng Thái Thủ Công</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Trạng thái mới</label>
                      <select
                        value={overrideStatus}
                        onChange={(e) => setOverrideStatus(e.target.value)}
                        className="quant-input text-xs w-full"
                      >
                        <option value="READY_FOR_REVIEW">READY_FOR_REVIEW</option>
                        <option value="NEEDS_DATA">NEEDS_DATA</option>
                        <option value="CONFIRMED">CONFIRMED</option>
                        <option value="DELIVERED">DELIVERED</option>
                        <option value="FAILED">FAILED</option>
                        <option value="REJECTED">REJECTED</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Lý do can thiệp</label>
                      <input
                        type="text"
                        required
                        placeholder="Lý do can thiệp..."
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        className="quant-input text-xs w-full"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={actionBusy}
                    className="quant-button bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-800 text-xs w-full py-1.5"
                  >
                    Xác Nhận Can Thiệp Trạng Thái
                  </button>
                </form>
              </div>

              {/* Archive Action */}
              <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Archive className="w-3.5 h-3.5 text-slate-400" />
                    <span>Lưu Trữ Hồ Sơ (Archive)</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Ẩn hồ sơ khỏi hàng đợi nhưng bảo tồn vĩnh viễn thanh toán và lịch sử kiểm toán.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleArchive}
                  className="quant-button quant-button-secondary text-xs py-1.5 px-3"
                >
                  Lưu Trữ Hồ Sơ
                </button>
              </div>

              {/* Audit Log Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
                  Nhật Ký Kiểm Toán (Audit Trail)
                </h4>
                {(!order?.audit_logs || order.audit_logs.length === 0) ? (
                  <div className="p-4 text-center text-xs text-slate-500 font-mono">
                    Chưa có nhật ký can thiệp.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {order.audit_logs.map((log: any) => (
                      <div
                        key={log.id}
                        className="p-3 rounded-lg bg-[#060A13] border border-slate-800/80 text-xs font-mono flex items-start justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-cyan-300">{log.action}</span>
                            <span className="text-slate-500 text-[11px]">bởi {log.operator_role} ({log.operator_id})</span>
                          </div>
                          {log.reason && (
                            <div className="text-slate-300 text-[11px] font-sans">
                              Lý do: {log.reason}
                            </div>
                          )}
                          {log.details_json && (
                            <div className="text-slate-500 text-[10px]">
                              Chi tiết: {log.details_json}
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 whitespace-nowrap">
                          {new Date(log.created_at * 1000).toLocaleString('vi-VN')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
