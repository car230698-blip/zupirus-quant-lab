import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { Panel, StatusBadge } from '../ui/Primitives';
import { FileCheck2, Upload, Plus } from 'lucide-react';

export const AdminReportsPublisher: React.FC = () => {
  const { lang } = useLanguage();
  const [reports, setReports] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [form, setForm] = useState({
    editingId: '' as string,
    title: '',
    subtitle: '',
    summary: '',
    market: 'XAUUSD',
    timeframe: 'M15 / H1',
    version: 'v1.0',
    price_vnd: '790000',
    price_usd: '32.0',
    page_count: '18',
    research_candidate_id: '',
    highlights_text:
      'Phân rã hiệu suất theo phiên London & New York\nKiểm định Walk-Forward 120/60 ngoài mẫu\nMô hình chi phí giả định 3.5 pips minh bạch',
  });

  const [fullFile, setFullFile] = useState<File | null>(null);
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [uploadReportId, setUploadReportId] = useState<string>('');
  const [uploadVersion, setUploadVersion] = useState<string>('v1.0');

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await api.get('/api/v1/admin/reports');
      if (res?.items) setReports(res.items);
      if (res?.research_candidates) setCandidates(res.research_candidates);
    } catch (err: any) {
      setMsg(err?.message || 'Không thể tải danh sách báo cáo nghiên cứu.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

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
      const payload = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        summary: form.summary.trim(),
        market: form.market.trim() || 'XAUUSD',
        timeframe: form.timeframe.trim() || 'M15 / H1',
        version: form.version.trim() || 'v1.0',
        price_vnd: Number(form.price_vnd) || 790000,
        price_usd: Number(form.price_usd) || 32.0,
        page_count: Number(form.page_count) || 18,
        research_candidate_id: form.research_candidate_id || undefined,
        highlights_json: highlights,
      };
      if (form.editingId) {
        await api.put(`/api/v1/admin/reports/${encodeURIComponent(form.editingId)}`, payload);
        setMsg(`Đã cập nhật báo cáo #${form.editingId} (${payload.version}).`);
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
        timeframe: 'M15 / H1',
        version: 'v1.0',
        price_vnd: '790000',
        price_usd: '32.0',
        page_count: '18',
        research_candidate_id: '',
        highlights_text:
          'Phân rã hiệu suất theo phiên London & New York\nKiểm định Walk-Forward 120/60 ngoài mẫu\nMô hình chi phí giả định 3.5 pips minh bạch',
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
      setMsg(`Đã tải lên và gán tệp PDF cho báo cáo #${uploadReportId} (${uploadVersion}).`);
      setFullFile(null);
      setSampleFile(null);
      await loadReports();
    } catch (err: any) {
      setMsg(`Lỗi tải PDF: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const handlePublish = async (reportId: string, version: string) => {
    setBusyId(`pub_${reportId}`);
    setMsg('');
    try {
      await api.post(`/api/v1/admin/reports/${encodeURIComponent(reportId)}/publish`, { version });
      setMsg(`Đã duyệt và xuất bản báo cáo #${reportId} (${version}) lên danh mục công khai.`);
      await loadReports();
    } catch (err: any) {
      setMsg(`Không thể xuất bản: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDiscontinue = async (reportId: string) => {
    setBusyId(`disc_${reportId}`);
    setMsg('');
    try {
      await api.post(`/api/v1/admin/reports/${encodeURIComponent(reportId)}/discontinue`, {});
      setMsg(`Đã ngừng mở bán mới báo cáo #${reportId}. Người mua cũ vẫn giữ nguyên quyền tải PDF.`);
      await loadReports();
    } catch (err: any) {
      setMsg(`Không thể ngừng bán: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (rep: any) => {
    setForm({
      editingId: rep.id,
      title: rep.title || '',
      subtitle: rep.subtitle || '',
      summary: rep.summary || '',
      market: rep.market || 'XAUUSD',
      timeframe: rep.timeframe || 'M15 / H1',
      version: rep.current_version || 'v1.0',
      price_vnd: String(rep.price_vnd || 790000),
      price_usd: String(rep.price_usd || 32.0),
      page_count: String(rep.page_count || 18),
      research_candidate_id: rep.research_candidate_id || '',
      highlights_text: Array.isArray(rep.highlights) ? rep.highlights.join('\n') : '',
    });
    setUploadReportId(rep.id);
    setUploadVersion(rep.current_version || 'v1.0');
  };

  return (
    <div className="space-y-6">
      {msg && (
        <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-3 text-xs font-medium text-cyan-200">
          {msg}
        </div>
      )}

      {/* 1. CREATE / EDIT REPORT DRAFT & UPLOAD PDF */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          icon={<FileCheck2 className="h-4 w-4 text-cyan-300" />}
          title={
            form.editingId
              ? `${lang === 'en' ? 'Edit Report' : 'Chỉnh sửa báo cáo'} #${form.editingId}`
              : lang === 'en'
              ? 'Create Quantitative Report Draft'
              : 'Tạo Bản Nháp Báo Cáo Định Lượng Mới'
          }
          subtitle={
            lang === 'en'
              ? 'Package Walk-Forward findings into a versioned PDF publication'
              : 'Biên tập thông tin ấn phẩm và đính kèm kết quả nghiên cứu WFO'
          }
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
                    timeframe: 'M15 / H1',
                    version: 'v1.0',
                    price_vnd: '790000',
                    price_usd: '32.0',
                    page_count: '18',
                    research_candidate_id: '',
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
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {lang === 'en' ? 'Report Title *' : 'Tiêu đề báo cáo *'}
                </label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="VD: Nghiên Cứu Định Lượng XAU/USD: Cấu Trúc Thanh Khoản Phiên London"
                  className="quant-input"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {lang === 'en' ? 'Subtitle' : 'Tiêu đề phụ'}
                </label>
                <input
                  type="text"
                  value={form.subtitle}
                  onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                  placeholder="Phân tích vi cấu trúc M15/H1 & kiểm định ngoài mẫu Walk-Forward"
                  className="quant-input"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {lang === 'en' ? 'Market & Timeframe' : 'Thị trường & Khung thời gian'}
                </label>
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
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {lang === 'en' ? 'Version & Page Count' : 'Phiên bản & Số trang'}
                </label>
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
                    onChange={(e) => setForm({ ...form, page_count: e.target.value })}
                    className="quant-input font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {lang === 'en' ? 'Price (VND)' : 'Giá niêm yết (VND)'}
                </label>
                <input
                  type="number"
                  value={form.price_vnd}
                  onChange={(e) => setForm({ ...form, price_vnd: e.target.value })}
                  className="quant-input font-mono text-xs text-emerald-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {lang === 'en' ? 'Price (USDT)' : 'Giá thanh toán (USDT)'}
                </label>
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
                  {lang === 'en'
                    ? 'Attach WFO Research Candidate'
                    : 'Đính kèm Ứng viên Nghiên cứu WFO'}
                </label>
                <select
                  value={form.research_candidate_id}
                  onChange={(e) => setForm({ ...form, research_candidate_id: e.target.value })}
                  className="quant-input font-mono text-xs"
                >
                  <option value="">-- Không đính kèm hoặc nhập số liệu độc lập --</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (#{c.id}) · PF {Number(c.profit_factor || 0).toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {lang === 'en' ? 'Abstract / Summary' : 'Tóm tắt nội dung & Luận điểm định lượng'}
                </label>
                <textarea
                  rows={3}
                  value={form.summary}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })}
                  className="quant-input"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {lang === 'en' ? 'Key Highlights (One per line)' : 'Điểm nhấn chính (Mỗi dòng 1 ý)'}
                </label>
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
                ? 'Cập Nhật Phiên Bản Báo Cáo'
                : 'Lưu Bản Nháp Báo Cáo'}
            </button>
          </form>
        </Panel>

        {/* 2. UPLOAD CUSTOM FULL / SAMPLE PDF */}
        <Panel
          icon={<Upload className="h-4 w-4 text-amber-300" />}
          title={lang === 'en' ? 'Attach PDF Files' : 'Gán File PDF Đầy Đủ & Đọc Thử'}
          subtitle={lang === 'en' ? 'Full edition stored privately' : 'Lưu file đầy đủ trong kho bảo mật'}
        >
          <form onSubmit={handleUploadPdfFiles} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {lang === 'en' ? 'Select Report' : 'Chọn báo cáo'}
              </label>
              <select
                value={uploadReportId}
                onChange={(e) => setUploadReportId(e.target.value)}
                className="quant-input text-xs"
              >
                <option value="">-- Chọn báo cáo --</option>
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} ({r.current_version} · {r.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {lang === 'en' ? 'Target Version' : 'Mã phiên bản áp dụng'}
              </label>
              <input
                type="text"
                value={uploadVersion}
                onChange={(e) => setUploadVersion(e.target.value)}
                className="quant-input font-mono text-xs text-amber-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {lang === 'en' ? 'Full PDF (Private Vault)' : 'File PDF Đầy Đủ (Chỉ người mua tải)'}
              </label>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setFullFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-300 file:mr-2 file:rounded-lg file:border file:border-slate-700 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:text-slate-200 cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {lang === 'en' ? 'Sample PDF (Public Preview)' : 'File PDF Bản Đọc Thử (Công khai)'}
              </label>
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
              {busyId === 'upload_pdf' ? 'Đang tải lên...' : 'Tải Lên & Gán File PDF'}
            </button>
          </form>
        </Panel>
      </div>

      {/* 3. ADMIN REPORT LIST & LIFECYCLE CONTROLS */}
      <Panel
        title={`${lang === 'en' ? 'Research Publications' : 'Danh Sách Báo Cáo Nghiên Cứu'} (${reports.length})`}
        subtitle={
          loading
            ? lang === 'en'
              ? 'Syncing catalog...'
              : 'Đang đồng bộ danh mục...'
            : lang === 'en'
            ? 'Manage draft, published, and discontinued versions'
            : 'Quản lý vòng đời xuất bản và bản đọc thử'
        }
      >
        <div className="overflow-x-auto">
          <table className="quant-table text-xs">
            <thead>
              <tr>
                <th>Mã / Tiêu Đề</th>
                <th>Phiên Bản</th>
                <th>Trạng Thái</th>
                <th className="text-right">Giá Bán</th>
                <th className="text-center">Lượt Cấp Quyền</th>
                <th className="text-right">Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const st = String(r.status || 'DRAFT').toUpperCase();
                return (
                  <tr key={r.id}>
                    <td>
                      <div className="font-semibold text-white">{r.title}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {r.id} · {r.market} ({r.timeframe})
                      </div>
                    </td>
                    <td className="font-mono font-semibold text-amber-300">{r.current_version}</td>
                    <td>
                      <StatusBadge
                        tone={st === 'PUBLISHED' ? 'success' : st === 'DISCONTINUED' ? 'danger' : 'warning'}
                      >
                        {st}
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
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="quant-quiet min-h-[30px] px-2.5 py-1 text-[11px]"
                        >
                          Sửa
                        </button>
                        <a
                          href={`/api/v1/admin/reports/${encodeURIComponent(r.id)}/preview-pdf?kind=full&version=${encodeURIComponent(r.current_version)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="quant-quiet min-h-[30px] px-2.5 py-1 text-[11px] text-amber-300"
                        >
                          Xem PDF
                        </a>
                        {st !== 'PUBLISHED' ? (
                          <button
                            type="button"
                            disabled={busyId === `pub_${r.id}`}
                            onClick={() => handlePublish(r.id, r.current_version)}
                            className="quant-btn-primary min-h-[30px] px-2.5 py-1 text-[11px]"
                          >
                            Xuất bản
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId === `disc_${r.id}`}
                            onClick={() => handleDiscontinue(r.id)}
                            className="quant-btn-danger min-h-[30px] px-2.5 py-1 text-[11px]"
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
    </div>
  );
};
