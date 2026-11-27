import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { Panel, StatusBadge } from '../ui/Primitives';
import { FileCheck2, Upload, Plus, Download, Eye, CheckCircle2, ShieldCheck, KeyRound, X } from 'lucide-react';

export const AdminReportsPublisher: React.FC = () => {
  const { lang } = useLanguage();
  const [reports, setReports] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [msg, setMsg] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Pre-publish confirmation modal state
  const [publishTarget, setPublishTarget] = useState<{
    id: string;
    title: string;
    version: string;
    is_for_sale: boolean;
  } | null>(null);

  // Quick grant trial modal state
  const [trialTarget, setTrialTarget] = useState<{
    reportId: string;
    reportTitle: string;
    version: string;
  } | null>(null);
  const [trialEmail, setTrialEmail] = useState('');
  const [trialDays, setTrialDays] = useState(30);
  const [trialNotes, setTrialNotes] = useState('Đội thử nghiệm tổ chức (Institutional Pilot)');

  const [form, setForm] = useState({
    editingId: '' as string,
    title: '',
    subtitle: '',
    summary: '',
    market: 'XAUUSD',
    timeframe: 'M15',
    version: 'v1.0',
    price_vnd: '790000',
    price_usd: '32.0',
    page_count: '',
    research_candidate_id: '',
    wfo_win_rate: '',
    wfo_profit_factor: '',
    wfo_max_drawdown: '',
    wfo_sharpe: '',
    wfo_sample_size: '',
    wfo_data_source: '',
    highlights_text: '',
  });

  const [fullFile, setFullFile] = useState<File | null>(null);
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [uploadReportId, setUploadReportId] = useState<string>('');
  const [uploadVersion, setUploadVersion] = useState<string>('v1.0');

  const loadReports = useCallback(async () => {
    try {
      const res: any = await api.get('/api/v1/admin/reports');
      if (res?.items) {
        setReports(res.items);
        if (!selectedReportId && res.items.length > 0) {
          setSelectedReportId(res.items[0].id);
        }
      }
      if (res?.research_candidates) setCandidates(res.research_candidates);
    } catch (err: any) {
      setMsg(err?.message || 'Không thể tải danh sách báo cáo nghiên cứu.');
    }
  }, [selectedReportId]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const selectedReport = reports.find((r) => r.id === selectedReportId) || reports[0] || null;

  const handleSaveDraftOrUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setMsg('Vui lòng nhập tiêu đề báo cáo nghiên cứu.');
      return;
    }
    setBusyId('form_save');
    setMsg('');
    try {
      const highlights = form.highlights_text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const payload: any = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        summary: form.summary.trim(),
        market: form.market.trim() || 'XAUUSD',
        timeframe: form.timeframe.trim() || 'M15',
        version: form.version.trim() || 'v1.0',
        price_vnd: Number(form.price_vnd) || 790000,
        price_usd: Number(form.price_usd) || 32.0,
        page_count: form.page_count ? Number(form.page_count) : undefined,
        research_candidate_id: form.research_candidate_id || undefined,
        highlights_json: highlights,
      };

      if (form.wfo_win_rate || form.wfo_profit_factor || form.wfo_max_drawdown || form.wfo_sample_size || form.wfo_sharpe) {
        payload.wfo_metrics = {
          win_rate: form.wfo_win_rate ? Number(form.wfo_win_rate) / 100 : undefined,
          profit_factor: form.wfo_profit_factor ? Number(form.wfo_profit_factor) : undefined,
          max_drawdown: form.wfo_max_drawdown ? Number(form.wfo_max_drawdown) : undefined,
          sharpe_ratio: form.wfo_sharpe ? Number(form.wfo_sharpe) : undefined,
          sample_size: form.wfo_sample_size ? Number(form.wfo_sample_size) : undefined,
          data_source: form.wfo_data_source.trim() || 'HISTORICAL_M15_VERIFIED',
          evidence_type: 'FIXED_RULES_IN_OUT_SAMPLE',
        };
      }
      if (form.editingId) {
        await api.put(`/api/v1/admin/reports/${encodeURIComponent(form.editingId)}`, payload);
        setMsg(`Đã cập nhật metadata báo cáo #${form.editingId} (${payload.version}).`);
      } else {
        const created: any = await api.post('/api/v1/admin/reports', payload);
        setMsg(`Đã tạo bản nháp báo cáo "${created?.title || payload.title}" (${created?.current_version || payload.version}).`);
      }
      setForm({
        editingId: '',
        title: '',
        subtitle: '',
        summary: '',
        market: 'XAUUSD',
        timeframe: 'M15',
        version: 'v1.0',
        price_vnd: '790000',
        price_usd: '32.0',
        page_count: '',
        research_candidate_id: '',
        wfo_win_rate: '',
        wfo_profit_factor: '',
        wfo_max_drawdown: '',
        wfo_sharpe: '',
        wfo_sample_size: '',
        wfo_data_source: '',
        highlights_text: '',
      });
      await loadReports();
    } catch (err: any) {
      setMsg(`Lỗi lưu báo cáo: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleUploadPdfFiles = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadReportId) {
      setMsg('Vui lòng chọn báo cáo cần đính kèm PDF.');
      return;
    }
    if (!fullFile && !sampleFile) {
      setMsg('Vui lòng chọn tệp PDF đầy đủ hoặc PDF bản đọc thử.');
      return;
    }
    setBusyId('upload_pdf');
    setMsg('');
    try {
      const fd = new FormData();
      if (uploadVersion.trim()) fd.append('version', uploadVersion.trim());
      if (fullFile) fd.append('full_pdf', fullFile);
      if (sampleFile) fd.append('sample_pdf', sampleFile);

      await api.post(`/api/v1/admin/reports/${encodeURIComponent(uploadReportId)}/upload-pdf`, fd);
      setMsg(`Đã tải lên và gắn tệp PDF cho báo cáo #${uploadReportId} (${uploadVersion}).`);
      setFullFile(null);
      setSampleFile(null);
      await loadReports();
    } catch (err: any) {
      setMsg(`Lỗi tải PDF: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const executePublish = async () => {
    if (!publishTarget) return;
    setBusyId(`pub_${publishTarget.id}`);
    setMsg('');
    try {
      await api.post(`/api/v1/admin/reports/${encodeURIComponent(publishTarget.id)}/publish`, { version: publishTarget.version });
      setMsg(`Đã duyệt và xuất bản báo cáo #${publishTarget.id} (${publishTarget.version}) thành công.`);
      setPublishTarget(null);
      await loadReports();
    } catch (err: any) {
      setMsg(`Không thể xuất bản: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleSale = async (reportId: string) => {
    setBusyId(`sale_${reportId}`);
    setMsg('');
    try {
      const res: any = await api.post(`/api/v1/admin/reports/${encodeURIComponent(reportId)}/toggle-sale`);
      setMsg(res?.message || `Đã cập nhật trạng thái mở bán báo cáo #${reportId}.`);
      await loadReports();
    } catch (err: any) {
      setMsg(`Lỗi đổi trạng thái mở bán: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDiscontinue = async (reportId: string) => {
    setBusyId(`disc_${reportId}`);
    setMsg('');
    try {
      await api.post(`/api/v1/admin/reports/${encodeURIComponent(reportId)}/discontinue`, {});
      setMsg(`Đã ngừng mở bán mới báo cáo #${reportId}. Quyền của người đã mua v1 vẫn được bảo toàn tuyệt đối.`);
      await loadReports();
    } catch (err: any) {
      setMsg(`Không thể ngừng bán: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleGrantTrial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trialTarget || !trialEmail.trim()) {
      setMsg('Vui lòng nhập email người nhận giấy phép dùng thử.');
      return;
    }
    setBusyId('grant_trial');
    try {
      const res: any = await api.post(`/api/v1/admin/reports/${encodeURIComponent(trialTarget.reportId)}/entitlements/grant-trial`, {
        email: trialEmail.trim(),
        version: trialTarget.version,
        trial_days: trialDays,
        notes: trialNotes,
      });
      setMsg(res?.message || `Đã cấp quyền dùng thử ${trialTarget.reportTitle} cho ${trialEmail.trim()} trong ${trialDays} ngày.`);
      setTrialTarget(null);
      setTrialEmail('');
      await loadReports();
    } catch (err: any) {
      setMsg(`Lỗi cấp quyền dùng thử: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (rep: any) => {
    const wm = rep.wfo_metrics || {};
    setForm({
      editingId: rep.id,
      title: rep.title || '',
      subtitle: rep.subtitle || '',
      summary: rep.summary || '',
      market: rep.market || 'XAUUSD',
      timeframe: rep.timeframe || 'M15',
      version: rep.current_version || 'v1.0',
      price_vnd: String(rep.price_vnd || 790000),
      price_usd: String(rep.price_usd || 32.0),
      page_count: rep.page_count ? String(rep.page_count) : '',
      research_candidate_id: rep.research_candidate_id || '',
      wfo_win_rate: wm.win_rate !== undefined ? String(Math.round(wm.win_rate * 100)) : '',
      wfo_profit_factor: wm.profit_factor !== undefined ? String(wm.profit_factor) : '',
      wfo_max_drawdown: wm.max_drawdown !== undefined ? String(wm.max_drawdown) : '',
      wfo_sharpe: wm.sharpe_ratio !== undefined ? String(wm.sharpe_ratio) : '',
      wfo_sample_size: wm.sample_size !== undefined ? String(wm.sample_size) : '',
      wfo_data_source: wm.data_source || '',
      highlights_text: Array.isArray(rep.highlights) ? rep.highlights.join('\n') : '',
    });
    setUploadReportId(rep.id);
    setUploadVersion(rep.current_version || 'v1.0');
    setSelectedReportId(rep.id);
  };

  const renderReviewStatusBadge = (r: any) => {
    const st = String(r.status || 'DRAFT').toUpperCase();
    const rst = String(r.review_status || '').toUpperCase();
    if (st === 'PUBLISHED') {
      return <StatusBadge tone="success">ĐÃ PHÁT HÀNH</StatusBadge>;
    }
    if (st === 'DISCONTINUED') {
      return <StatusBadge tone="danger">NGỪNG BÁN</StatusBadge>;
    }
    if (rst === 'READY_FOR_REVIEW') {
      return <StatusBadge tone="info">SẴN SÀNG DUYỆT</StatusBadge>;
    }
    return <StatusBadge tone="warning">BẢN NHÁP (THIẾU TỆP)</StatusBadge>;
  };

  return (
    <div className="space-y-6">
      {msg && (
        <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-3 text-xs font-medium text-cyan-200">
          {msg}
        </div>
      )}

      {/* TOP: PUBLICATION LIFECYCLE WORKFLOW GUIDE */}
      <div className="rounded-xl border border-slate-800 bg-[#060A13] p-4 text-xs font-mono text-slate-300">
        <div className="flex flex-wrap items-center gap-2 text-cyan-400 font-semibold mb-1">
          <ShieldCheck className="h-4 w-4" />
          <span>QUY TRÌNH DUYỆT & KHÓA PHIÊN BẢN NGHIÊN CỨU</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span>1. Chọn bản nháp</span>
          <span>&rarr;</span>
          <span>2. Xem số liệu nghiên cứu</span>
          <span>&rarr;</span>
          <span>3. Gắn tệp PDF thực & gói Suite</span>
          <span>&rarr;</span>
          <span>4. Xem trước đúng phiên bản</span>
          <span>&rarr;</span>
          <span>5. Admin duyệt xuất bản</span>
          <span>&rarr;</span>
          <span>6. Mở bán / Cấp dùng thử</span>
        </div>
      </div>

      {/* 1. REPORT CATALOG & SELECTION */}
      <Panel
        title={`${lang === 'en' ? 'Publications & Versions' : 'Danh Sách Ấn Phẩm & Phiên Bản'} (${reports.length})`}
        subtitle="Quản lý vòng đời ấn phẩm: Bản nháp, Sẵn sàng duyệt, Đã phát hành, Ngừng bán"
      >
        <div className="overflow-x-auto">
          <table className="quant-table text-xs">
            <thead>
              <tr>
                <th>Mã / Tiêu Đề</th>
                <th>Phiên Bản</th>
                <th>Trạng Thái Duyệt</th>
                <th>Mở Bán</th>
                <th className="text-right">Giá Niêm Yết</th>
                <th className="text-center">Người Có Quyền</th>
                <th className="text-right">Thao Tác Xem & Duyệt</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const isSelected = r.id === selectedReportId;
                const isForSale = Boolean(r.is_for_sale);
                const isPublished = String(r.status || '').toUpperCase() === 'PUBLISHED';
                return (
                  <tr
                    key={r.id}
                    className={isSelected ? 'bg-cyan-950/20 border-l-2 border-cyan-400' : ''}
                    onClick={() => setSelectedReportId(r.id)}
                  >
                    <td className="cursor-pointer">
                      <div className="font-semibold text-white">{r.title}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {r.id} · {r.market} ({r.timeframe})
                      </div>
                    </td>
                    <td className="font-mono font-semibold text-amber-300">{r.current_version}</td>
                    <td>{renderReviewStatusBadge(r)}</td>
                    <td>
                      <StatusBadge tone={isForSale ? 'success' : 'neutral'}>
                        {isForSale ? 'ĐANG MỞ BÁN' : 'ĐÃ TẮT BÁN'}
                      </StatusBadge>
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      <div className="font-semibold text-emerald-400">
                        {Number(r.price_vnd || 0).toLocaleString('vi-VN')} đ
                      </div>
                      <div className="text-[11px] text-slate-400">${Number(r.price_usd || 0).toFixed(2)}</div>
                    </td>
                    <td className="text-center font-mono font-bold text-white tabular-nums">
                      {r.active_entitlements_count || 0}
                    </td>
                    <td className="text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="quant-quiet min-h-[30px] px-2 py-1 text-[11px]"
                          title="Sửa metadata"
                        >
                          Sửa
                        </button>

                        <a
                          href={`/api/v1/admin/reports/${encodeURIComponent(r.id)}/preview-pdf?kind=full&version=${encodeURIComponent(r.current_version)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="quant-quiet min-h-[30px] px-2 py-1 text-[11px] text-cyan-300"
                          title="Xem trước PDF đầy đủ của đúng phiên bản này"
                        >
                          <Eye className="h-3 w-3 inline mr-1" />
                          Full PDF
                        </a>

                        <a
                          href={`/api/v1/admin/reports/${encodeURIComponent(r.id)}/preview-pdf?kind=sample&version=${encodeURIComponent(r.current_version)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="quant-quiet min-h-[30px] px-2 py-1 text-[11px] text-slate-300"
                          title="Xem trước bản đọc thử công khai"
                        >
                          Bản mẫu
                        </a>

                        <a
                          href={`/api/v1/admin/reports/${encodeURIComponent(r.id)}/preview-bundle?version=${encodeURIComponent(r.current_version)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="quant-quiet min-h-[30px] px-2 py-1 text-[11px] text-amber-300"
                          title="Tải gói Suite ZIP (kèm ledger CSV và manifest bằng chứng)"
                        >
                          <Download className="h-3 w-3 inline mr-1" />
                          ZIP
                        </a>

                        <button
                          type="button"
                          disabled={busyId === `sale_${r.id}`}
                          onClick={() => handleToggleSale(r.id)}
                          className={`min-h-[30px] px-2 py-1 text-[11px] rounded-lg border font-mono transition ${
                            isForSale
                              ? 'border-amber-500/40 bg-amber-950/20 text-amber-300 hover:bg-amber-950/40'
                              : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/40'
                          }`}
                        >
                          {isForSale ? 'Khóa Bán' : 'Mở Bán'}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setTrialTarget({
                              reportId: r.id,
                              reportTitle: r.title,
                              version: r.current_version,
                            })
                          }
                          className="quant-quiet min-h-[30px] px-2 py-1 text-[11px] text-indigo-300"
                          title="Cấp quyền dùng thử cho đội đánh giá"
                        >
                          <KeyRound className="h-3 w-3 inline mr-1" />
                          Dùng thử
                        </button>

                        {!isPublished ? (
                          <button
                            type="button"
                            disabled={busyId === `pub_${r.id}`}
                            onClick={() =>
                              setPublishTarget({
                                id: r.id,
                                title: r.title,
                                version: r.current_version,
                                is_for_sale: isForSale,
                              })
                            }
                            className="quant-btn-primary min-h-[30px] px-2.5 py-1 text-[11px]"
                          >
                            Xuất bản
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId === `disc_${r.id}`}
                            onClick={() => handleDiscontinue(r.id)}
                            className="quant-btn-danger min-h-[30px] px-2 py-1 text-[11px]"
                          >
                            Ngừng bán
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* 2. INSPECT SELECTED REPORT & VERIFIED METRICS */}
      {selectedReport && (
        <div className="rounded-xl border border-cyan-500/30 bg-[#060A13] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-cyan-400">CHI TIẾT ẤN PHẨM ĐƯỢC CHỌN</span>
              <h3 className="text-white font-bold text-base mt-0.5">
                {selectedReport.title} <span className="font-mono text-amber-300">({selectedReport.current_version})</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">{selectedReport.subtitle || selectedReport.summary}</p>
            </div>
            <div className="flex items-center gap-2">
              {renderReviewStatusBadge(selectedReport)}
              <StatusBadge tone={selectedReport.is_for_sale ? 'success' : 'neutral'}>
                {selectedReport.is_for_sale ? 'MỞ BÁN THƯƠNG MẠI' : 'CHỈ DÙNG THỬ / NỘI BỘ'}
              </StatusBadge>
            </div>
          </div>

          {/* Metrics summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 font-mono text-xs tabular-nums">
            <div className="rounded-lg border border-slate-800 bg-[#0A0F1D] p-2.5">
              <div className="text-[11px] text-slate-400">Nguồn Dữ Liệu</div>
              <div className="font-bold text-cyan-300 mt-0.5 truncate">{selectedReport.wfo_metrics?.data_source || 'COMEX GC=F M15'}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0A0F1D] p-2.5">
              <div className="text-[11px] text-slate-400">Profit Factor</div>
              <div className="font-bold text-amber-300 mt-0.5">{selectedReport.wfo_metrics?.profit_factor ?? 'N/A'}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0A0F1D] p-2.5">
              <div className="text-[11px] text-slate-400">Win Rate</div>
              <div className="font-bold text-emerald-400 mt-0.5">
                {selectedReport.wfo_metrics?.win_rate ? `${Math.round(selectedReport.wfo_metrics.win_rate * 100)}%` : 'N/A'}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0A0F1D] p-2.5">
              <div className="text-[11px] text-slate-400">Bảo Toàn Quyền Mua</div>
              <div className="font-bold text-white mt-0.5">Khóa Hash Phiên Bản</div>
            </div>
          </div>
        </div>
      )}

      {/* 3. CREATE / EDIT DRAFT & ATTACH PDF FILES */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          icon={<FileCheck2 className="h-4 w-4 text-cyan-300" />}
          title={
            form.editingId
              ? `${lang === 'en' ? 'Edit Metadata' : 'Chỉnh sửa thông tin'} #${form.editingId}`
              : lang === 'en'
              ? 'Create Research Draft'
              : 'Tạo Bản Nháp Ấn Phẩm Mới'
          }
          subtitle="Biên tập thông tin ấn phẩm và liên kết với kết quả nghiên cứu đã lưu"
          action={
            form.editingId ? (
              <button
                type="button"
                onClick={() =>
                  setForm({
                    editingId: '',
                    title: '',
                    subtitle: '',
                    summary: '',
                    market: 'XAUUSD',
                    timeframe: 'M15',
                    version: 'v1.0',
                    price_vnd: '790000',
                    price_usd: '32.0',
                    page_count: '',
                    research_candidate_id: '',
                    wfo_win_rate: '',
                    wfo_profit_factor: '',
                    wfo_max_drawdown: '',
                    wfo_sharpe: '',
                    wfo_sample_size: '',
                    wfo_data_source: '',
                    highlights_text: '',
                  })
                }
                className="quant-btn-secondary text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{lang === 'en' ? 'New Draft' : 'Tạo mới'}</span>
              </button>
            ) : undefined
          }
        >
          <form onSubmit={handleSaveDraftOrUpdate} className="space-y-4">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Tiêu đề ấn phẩm *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="VD: ZUPIRUS Gold Research Suite v1: Breakout & Retest M15"
                  className="quant-input"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Tiêu đề phụ</label>
                <input
                  type="text"
                  value={form.subtitle}
                  onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                  placeholder="Kiểm định theo các giai đoạn thời gian COMEX GC=F M15"
                  className="quant-input"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Thị trường & Khung thời gian</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={form.market}
                    onChange={(e) => setForm({ ...form, market: e.target.value })}
                    className="quant-input font-mono text-xs"
                  />
                  <input
                    type="text"
                    value={form.timeframe}
                    onChange={(e) => setForm({ ...form, timeframe: e.target.value })}
                    className="quant-input font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Phiên bản & Số trang</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={form.version}
                    onChange={(e) => setForm({ ...form, version: e.target.value })}
                    placeholder="v1.0"
                    className="quant-input font-mono text-xs text-amber-300"
                  />
                  <input
                    type="number"
                    value={form.page_count}
                    placeholder="Tự xác định"
                    onChange={(e) => setForm({ ...form, page_count: e.target.value })}
                    className="quant-input font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Giá niêm yết (VND)</label>
                <input
                  type="number"
                  value={form.price_vnd}
                  onChange={(e) => setForm({ ...form, price_vnd: e.target.value })}
                  className="quant-input font-mono text-xs text-emerald-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Giá thanh toán (USDT)</label>
                <input
                  type="number"
                  step="0.5"
                  value={form.price_usd}
                  onChange={(e) => setForm({ ...form, price_usd: e.target.value })}
                  className="quant-input font-mono text-xs text-emerald-300"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Đính kèm Kết quả Nghiên cứu Đã Lưu
                </label>
                <select
                  value={form.research_candidate_id}
                  onChange={(e) => setForm({ ...form, research_candidate_id: e.target.value })}
                  className="quant-input font-mono text-xs"
                >
                  <option value="">-- Chọn kết quả từ lần chạy đã lưu --</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (#{c.id}) · {c.status || 'VERIFIED'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Verified Metrics / Manual override */}
              <div className="sm:col-span-2 rounded-xl border border-slate-800 bg-[#060A13] p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-cyan-400">
                    Chỉ số Hiệu suất & Nguồn Bằng Chứng
                  </span>
                  <span className="text-[11px] text-amber-400/90 font-mono">
                    {form.research_candidate_id ? 'Đã liên kết ứng viên' : 'Nhập thủ công (Cần đối soát bằng chứng)'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Win Rate (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="Không để mẫu giả"
                      value={form.wfo_win_rate}
                      onChange={(e) => setForm({ ...form, wfo_win_rate: e.target.value })}
                      className="quant-input font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Profit Factor</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="VD: 1.85"
                      value={form.wfo_profit_factor}
                      onChange={(e) => setForm({ ...form, wfo_profit_factor: e.target.value })}
                      className="quant-input font-mono text-xs text-amber-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Max Drawdown (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="VD: 5.2"
                      value={form.wfo_max_drawdown}
                      onChange={(e) => setForm({ ...form, wfo_max_drawdown: e.target.value })}
                      className="quant-input font-mono text-xs text-rose-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Sharpe Ratio</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="VD: 1.40"
                      value={form.wfo_sharpe}
                      onChange={(e) => setForm({ ...form, wfo_sharpe: e.target.value })}
                      className="quant-input font-mono text-xs text-cyan-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Cỡ Mẫu Lệnh (Trades)</label>
                    <input
                      type="number"
                      placeholder="Số lệnh thực tế"
                      value={form.wfo_sample_size}
                      onChange={(e) => setForm({ ...form, wfo_sample_size: e.target.value })}
                      className="quant-input font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Nguồn Dữ Liệu</label>
                    <input
                      type="text"
                      placeholder="COMEX GC=F M15"
                      value={form.wfo_data_source}
                      onChange={(e) => setForm({ ...form, wfo_data_source: e.target.value })}
                      className="quant-input font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Tóm tắt nội dung & Luận điểm định lượng</label>
                <textarea
                  rows={3}
                  value={form.summary}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })}
                  className="quant-input"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Điểm nhấn chính (Mỗi dòng 1 ý)</label>
                <textarea
                  rows={3}
                  value={form.highlights_text}
                  onChange={(e) => setForm({ ...form, highlights_text: e.target.value })}
                  className="quant-input"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={busyId === 'form_save'}
              className="quant-btn-primary text-xs"
            >
              {busyId === 'form_save'
                ? 'Đang lưu...'
                : form.editingId
                ? 'Cập Nhật Bản Nháp (Không đổi trạng thái xuất bản)'
                : 'Lưu Bản Nháp Mới'}
            </button>
          </form>
        </Panel>

        {/* UPLOAD CUSTOM PDF FILES */}
        <Panel
          icon={<Upload className="h-4 w-4 text-amber-300" />}
          title="Tải Tệp Cho Phiên Bản"
          subtitle="Gắn tệp PDF thực tế và gói nghiên cứu trước khi duyệt"
        >
          <form onSubmit={handleUploadPdfFiles} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Chọn ấn phẩm</label>
              <select
                value={uploadReportId}
                onChange={(e) => setUploadReportId(e.target.value)}
                className="quant-input text-xs"
              >
                <option value="">-- Chọn ấn phẩm --</option>
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} ({r.current_version} · {r.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Mã phiên bản áp dụng</label>
              <input
                type="text"
                value={uploadVersion}
                onChange={(e) => setUploadVersion(e.target.value)}
                className="quant-input font-mono text-xs text-amber-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">File PDF Đầy Đủ (Private Vault)</label>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setFullFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-300 file:mr-2 file:rounded-lg file:border file:border-slate-700 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:text-slate-200 cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">File PDF Bản Đọc Thử (Công khai)</label>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setSampleFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-300 file:mr-2 file:rounded-lg file:border file:border-slate-700 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:text-slate-200 cursor-pointer"
              />
            </div>

            <button
              type="submit"
              disabled={busyId === 'upload_pdf'}
              className="quant-btn-secondary w-full text-xs"
            >
              {busyId === 'upload_pdf' ? 'Đang tải lên...' : 'Tải Lên & Gắn Tệp Phiên Bản'}
            </button>
          </form>
        </Panel>
      </div>

      {/* PRE-PUBLISH CONFIRMATION MODAL */}
      {publishTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-cyan-500/40 bg-[#060A13] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-cyan-300 font-semibold text-sm">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <span>Xác Nhận Xuất Bản Chính Thức</span>
              </div>
              <button
                type="button"
                onClick={() => setPublishTarget(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0A0F1D] p-4 space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Tên ấn phẩm:</span>
                <span className="text-white font-bold">{publishTarget.title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Phiên bản:</span>
                <span className="text-amber-300 font-bold">{publishTarget.version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Đối tượng truy cập:</span>
                <span className="text-cyan-300">Khách hàng bản quyền & Nhóm dùng thử</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Trạng thái bán thương mại:</span>
                <span className={publishTarget.is_for_sale ? 'text-emerald-400' : 'text-slate-400'}>
                  {publishTarget.is_for_sale ? 'Đang mở bán' : 'Tắt bán thương mại (Chỉ dùng thử)'}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Hệ thống sẽ kiểm tra tệp PDF thực tế và mã băm SHA-256 của phiên bản này trước khi chuyển sang
              trạng thái PUBLISHED. Mọi quyền truy cập của người mua các phiên bản trước vẫn được giữ nguyên.
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPublishTarget(null)}
                className="quant-btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={busyId === `pub_${publishTarget.id}`}
                onClick={executePublish}
                className="quant-btn-primary text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {busyId === `pub_${publishTarget.id}` ? 'Đang duyệt xuất bản...' : 'Duyệt & Xuất Bản Ngay'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUICK GRANT TRIAL MODAL */}
      {trialTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <form
            onSubmit={handleGrantTrial}
            className="w-full max-w-lg rounded-2xl border border-indigo-500/40 bg-[#060A13] p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-300 font-semibold text-sm">
                <KeyRound className="h-5 w-5 text-indigo-400" />
                <span>Cấp Giấy Phép Dùng Thử (Trial License)</span>
              </div>
              <button
                type="button"
                onClick={() => setTrialTarget(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-1">
              <div>Ấn phẩm: <strong className="text-white">{trialTarget.reportTitle}</strong></div>
              <div>Phiên bản: <strong className="text-amber-300">{trialTarget.version}</strong></div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Email người nhận *</label>
                <input
                  type="email"
                  required
                  value={trialEmail}
                  onChange={(e) => setTrialEmail(e.target.value)}
                  placeholder="client-team@fund.com"
                  className="quant-input text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Thời hạn dùng thử (ngày)</label>
                <input
                  type="number"
                  min="1"
                  max="180"
                  value={trialDays}
                  onChange={(e) => setTrialDays(Number(e.target.value))}
                  className="quant-input font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Ghi chú đối tác / Giấy phép</label>
                <input
                  type="text"
                  value={trialNotes}
                  onChange={(e) => setTrialNotes(e.target.value)}
                  className="quant-input text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setTrialTarget(null)}
                className="quant-btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={busyId === 'grant_trial'}
                className="quant-btn-primary text-xs bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {busyId === 'grant_trial' ? 'Đang cấp...' : 'Cấp Quyền Dùng Thử'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
