import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useLanguage } from '../i18n/LanguageContext';

export const AdminReportsPublisherSection: React.FC = () => {
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
        <div className="rounded-xl border border-[#12B5A6]/40 bg-[#12B5A6]/10 px-4 py-3 text-xs font-bold text-[#12B5A6]">
          {msg}
        </div>
      )}

      {/* 1. CREATE / EDIT REPORT DRAFT & ATTACH WFO CANDIDATE */}
      <div className="grid gap-6 lg:grid-cols-3">
        <form
          onSubmit={handleSaveDraftOrUpdate}
          className="lg:col-span-2 rounded-2xl border border-slate-800 bg-[#10192B] p-6 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <div className="font-mono text-xs uppercase text-[#12B5A6]">
                {lang === 'en' ? 'EDITORIAL & WFO RESEARCH PACKAGING' : 'BIÊN TẬP & ĐÍNH KÈM KẾT QUẢ NGHIÊN CỨU WFO'}
              </div>
              <h3 className="text-base font-bold text-white">
                {form.editingId
                  ? `Chỉnh sửa Báo cáo #${form.editingId}`
                  : 'Tạo Bản Nháp Báo Cáo Định Lượng Mới (DRAFT)'}
              </h3>
            </div>
            {form.editingId && (
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
                className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:text-white cursor-pointer"
              >
                + Tạo mới
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Tiêu đề báo cáo *</label>
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="VD: Nghiên Cứu Định Lượng XAU/USD: Cấu Trúc Thanh Khoản Phiên London"
                className="w-full rounded-xl border border-slate-700 bg-[#080E1A] px-3.5 py-2 text-xs text-white"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Tiêu đề phụ (Subtitle)</label>
              <input
                type="text"
                value={form.subtitle}
                onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                placeholder="Phân tích vi cấu trúc M15/H1 & kiểm định ngoài mẫu Walk-Forward"
                className="w-full rounded-xl border border-slate-700 bg-[#080E1A] px-3.5 py-2 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Thị trường & Khung thời gian</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.market}
                  onChange={(e) => setForm({ ...form, market: e.target.value })}
                  className="w-1/2 rounded-xl border border-slate-700 bg-[#080E1A] px-3 py-2 text-xs font-mono text-white"
                />
                <input
                  type="text"
                  value={form.timeframe}
                  onChange={(e) => setForm({ ...form, timeframe: e.target.value })}
                  className="w-1/2 rounded-xl border border-slate-700 bg-[#080E1A] px-3 py-2 text-xs font-mono text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Phiên bản (Version) & Số trang</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.version}
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                  placeholder="v1.0"
                  className="w-1/2 rounded-xl border border-slate-700 bg-[#080E1A] px-3 py-2 text-xs font-mono text-amber-300"
                />
                <input
                  type="number"
                  value={form.page_count}
                  onChange={(e) => setForm({ ...form, page_count: e.target.value })}
                  className="w-1/2 rounded-xl border border-slate-700 bg-[#080E1A] px-3 py-2 text-xs font-mono text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Giá bán (VND)</label>
              <input
                type="number"
                value={form.price_vnd}
                onChange={(e) => setForm({ ...form, price_vnd: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-[#080E1A] px-3.5 py-2 text-xs font-mono text-emerald-400"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Giá bán (USDT)</label>
              <input
                type="number"
                step="0.5"
                value={form.price_usd}
                onChange={(e) => setForm({ ...form, price_usd: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-[#080E1A] px-3.5 py-2 text-xs font-mono text-emerald-400"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">
                Đính kèm Ứng viên Nghiên cứu Định lượng Nội bộ (WFO Candidate Queue)
              </label>
              <select
                value={form.research_candidate_id}
                onChange={(e) => setForm({ ...form, research_candidate_id: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-[#080E1A] px-3.5 py-2 text-xs font-mono text-white"
              >
                <option value="">-- Không đính kèm hoặc nhập số liệu độc lập --</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.status}] {c.name} (#{c.id}) · WR {Math.round(Number(c.win_rate || 0) * 100)}% · PF{' '}
                    {Number(c.profit_factor || 0).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Tóm tắt nội dung & Luận điểm định lượng</label>
              <textarea
                rows={3}
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-[#080E1A] px-3.5 py-2 text-xs text-white"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Điểm nhấn chính (Mỗi dòng 1 ý)</label>
              <textarea
                rows={3}
                value={form.highlights_text}
                onChange={(e) => setForm({ ...form, highlights_text: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-[#080E1A] px-3.5 py-2 text-xs text-white"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busyId === 'form_save'}
            className="rounded-xl bg-[#12B5A6] px-5 py-2.5 text-xs font-extrabold text-[#032220] hover:bg-[#14C9B8] cursor-pointer"
          >
            {busyId === 'form_save'
              ? 'Đang lưu...'
              : form.editingId
              ? 'Cập Nhật Thông Tin & Phiên Bản Báo Cáo'
              : 'Lưu Bản Nháp & Tự Sinh Khung PDF Chuẩn'}
          </button>
        </form>

        {/* 2. UPLOAD CUSTOM FULL / SAMPLE PDF */}
        <form
          onSubmit={handleUploadPdfFiles}
          className="rounded-2xl border border-slate-800 bg-[#10192B] p-6 space-y-4"
        >
          <div className="border-b border-slate-800 pb-3">
            <div className="font-mono text-xs uppercase text-amber-300">TẢI LÊN TỆP PDF</div>
            <h3 className="text-base font-bold text-white">Gán File PDF Đầy Đủ & Bản Đọc Thử</h3>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Chọn báo cáo</label>
            <select
              value={uploadReportId}
              onChange={(e) => setUploadReportId(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-[#080E1A] px-3 py-2 text-xs text-white"
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
            <label className="block text-xs text-slate-400 mb-1">Mã phiên bản áp dụng (VD: v1.0, v2.0)</label>
            <input
              type="text"
              value={uploadVersion}
              onChange={(e) => setUploadVersion(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-[#080E1A] px-3 py-2 text-xs font-mono text-amber-300"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              File PDF Đầy Đủ (Lưu kho Private chỉ người mua tải được)
            </label>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFullFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-slate-300"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">File PDF Bản Đọc Thử (Public Sample Preview)</label>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setSampleFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-slate-300"
            />
          </div>

          <button
            type="submit"
            disabled={busyId === 'upload_pdf'}
            className="w-full rounded-xl border border-amber-400/50 bg-amber-500/15 py-2.5 text-xs font-bold text-amber-300 hover:bg-amber-500/25 cursor-pointer"
          >
            {busyId === 'upload_pdf' ? 'Đang tải lên...' : 'Tải Lên & Gán File PDF'}
          </button>
        </form>
      </div>

      {/* 3. ADMIN REPORT LIST & LIFECYCLE CONTROLS */}
      <div className="rounded-2xl border border-slate-800 bg-[#10192B] p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <div className="font-mono text-xs uppercase text-[#12B5A6]">QUẢN LÝ VÒNG ĐỜI ẤN PHẨM</div>
            <h3 className="text-base font-bold text-white">
              Danh Sách Báo Cáo Nghiên Cứu ({reports.length}) {loading ? '· Đang đồng bộ...' : ''}
            </h3>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 font-mono text-[11px] uppercase text-slate-400">
                <th className="py-2.5 pr-4">Mã / Tiêu Đề</th>
                <th className="py-2.5 pr-4">Phiên Bản</th>
                <th className="py-2.5 pr-4">Trạng Thái</th>
                <th className="py-2.5 pr-4 text-right">Giá Bán</th>
                <th className="py-2.5 pr-4 text-center">Người Mua</th>
                <th className="py-2.5 text-right">Thao Tác Quản Trị</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {reports.map((r) => {
                const st = String(r.status || 'DRAFT').toUpperCase();
                return (
                  <tr key={r.id} className="hover:bg-slate-800/20">
                    <td className="py-3 pr-4">
                      <div className="font-bold text-white">{r.title}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {r.id} · {r.market} ({r.timeframe})
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-mono font-bold text-amber-300">{r.current_version}</td>
                    <td className="py-3 pr-4 font-mono">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          st === 'PUBLISHED'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : st === 'DISCONTINUED'
                            ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                            : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {st}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-emerald-400 font-bold">
                      {Number(r.price_vnd || 0).toLocaleString('vi-VN')} đ
                      <div className="text-[10px] text-slate-400">${Number(r.price_usd || 0).toFixed(2)}</div>
                    </td>
                    <td className="py-3 pr-4 text-center font-mono text-white font-bold">
                      {r.active_entitlements_count || 0}
                    </td>
                    <td className="py-3 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-200 hover:text-white cursor-pointer"
                        >
                          Sửa
                        </button>
                        <a
                          href={`/api/v1/admin/reports/${encodeURIComponent(r.id)}/preview-pdf?kind=full&version=${encodeURIComponent(r.current_version)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-amber-300 hover:border-amber-400"
                        >
                          Xem thử PDF
                        </a>
                        {st !== 'PUBLISHED' && (
                          <button
                            type="button"
                            disabled={busyId === `pub_${r.id}`}
                            onClick={() => handlePublish(r.id, r.current_version)}
                            className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/30 cursor-pointer"
                          >
                            Duyệt & Xuất Bản
                          </button>
                        )}
                        {st === 'PUBLISHED' && (
                          <button
                            type="button"
                            disabled={busyId === `disc_${r.id}`}
                            onClick={() => handleDiscontinue(r.id)}
                            className="rounded-lg bg-rose-500/15 border border-rose-500/35 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-500/25 cursor-pointer"
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
      </div>
    </div>
  );
};
