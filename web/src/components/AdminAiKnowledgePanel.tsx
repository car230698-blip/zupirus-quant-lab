import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  apiPost,
  apiPut,
  apiDelete,
  fetchAdminAiQuota,
  updateAdminAiQuota,
  AdminAiQuota,
} from '../api/client';
import { SpotlightBento } from './ui/SpotlightBento';

export interface AdminAiKnowledgePanelProps {
  geminiPool: any[];
  ingestedList: any[];
  onRefresh: () => void;
  setMsg: (msg: string) => void;
}

export const AdminAiKnowledgePanel: React.FC<AdminAiKnowledgePanelProps> = ({
  geminiPool,
  ingestedList,
  onRefresh,
  setMsg,
}) => {
  // Knowledge Ingestion state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfTitle, setPdfTitle] = useState('');
  const [pdfCategory, setPdfCategory] = useState<'strategy' | 'macro' | 'gold' | 'general'>('macro');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestStep, setIngestStep] = useState<number>(0);
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'macro' | 'gold' | 'strategy'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Gemini Key Pool state
  const [newKeyInput, setNewKeyInput] = useState('');

  // AI Quota state
  const [aiQuota, setAiQuota] = useState<AdminAiQuota | null>(null);
  const [quotaUpdating, setQuotaUpdating] = useState(false);

  const loadQuota = useCallback(async () => {
    try {
      const q = await fetchAdminAiQuota();
      setAiQuota(q);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadQuota();
  }, [loadQuota]);

  const handleQuickQuotaOverride = async (minutes: number = 60) => {
    setQuotaUpdating(true);
    try {
      await updateAdminAiQuota({ override_minutes: minutes });
      setMsg(`Đã mở khóa quota thêm ${minutes} phút.`);
      await loadQuota();
      onRefresh();
    } catch (err: any) {
      setMsg(`Lỗi mở khóa quota: ${err?.message || 'Thất bại'}`);
    } finally {
      setQuotaUpdating(false);
    }
  };

  const handleResetQuotaToday = async () => {
    if (!window.confirm('Xác nhận đặt lại hạn mức và số lượt gọi trong ngày về 0?')) return;
    setQuotaUpdating(true);
    try {
      await updateAdminAiQuota({ reset_today: true });
      setMsg('Đã đặt lại bộ đếm quota hôm nay về 0.');
      await loadQuota();
      onRefresh();
    } catch (err: any) {
      setMsg(`Lỗi đặt lại quota: ${err?.message || 'Thất bại'}`);
    } finally {
      setQuotaUpdating(false);
    }
  };

  const handleIngestPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pdfFile) {
      setMsg('Vui lòng chọn file PDF, TXT hoặc MD để nạp vào hệ thống.');
      return;
    }
    setIsIngesting(true);
    setIngestStep(1);

    const formData = new FormData();
    formData.append('file', pdfFile);
    if (pdfTitle.trim()) formData.append('title', pdfTitle.trim());
    formData.append('category', pdfCategory);

    try {
      const stepTimer1 = setTimeout(() => setIngestStep(2), 1200);
      const stepTimer2 = setTimeout(() => setIngestStep(3), 3500);

      const data = await apiPost('/api/admin/skills/ingest-pdf', formData);

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      setIngestStep(4);

      if (data && data.ok) {
        setMsg(`✓ Huấn luyện thành công: Đã bóc tách '${data.name}' [${data.detected_category || data.category}].`);
        setPdfFile(null);
        setPdfTitle('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        onRefresh();
      } else {
        setMsg(`Lỗi bóc tách tài liệu: ${data?.detail || data?.message || 'Không thể xử lý'}`);
      }
    } catch (err: any) {
      setMsg(`Lỗi kết nối khi nạp tài liệu: ${err.message || String(err)}`);
    } finally {
      setIsIngesting(false);
      setTimeout(() => setIngestStep(0), 4000);
    }
  };

  const handleDeleteIngested = async (skillId: string) => {
    if (!window.confirm(`Bạn có chắc muốn xóa tài liệu / kỹ năng '${skillId}' khỏi hệ thống?`)) return;
    try {
      await apiDelete(`/api/admin/skills/ingested/${encodeURIComponent(skillId)}`);
      setMsg(`Đã xóa tài liệu '${skillId}' khỏi bộ não AI.`);
      onRefresh();
    } catch (e: any) {
      setMsg(`Lỗi khi xóa: ${e.message}`);
    }
  };

  const handleAddGeminiKey = async () => {
    if (!newKeyInput.trim()) return;
    const rawKeys = newKeyInput
      .split(/[\n,]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 10);

    if (rawKeys.length === 0) {
      setMsg('Vui lòng nhập định dạng khóa API Key hợp lệ (bắt đầu bằng AIzaSy...).');
      return;
    }

    let added = 0;
    for (const key of rawKeys) {
      try {
        await apiPost('/api/admin/gemini/keys', { api_key: key });
        added++;
      } catch {
        // ignore duplicate / invalid
      }
    }

    if (added > 0) {
      setNewKeyInput('');
      setMsg(`✓ Đã nạp thành công ${added} Gemini API Key vào Pool.`);
      onRefresh();
    } else {
      setMsg('Không thể nạp key (kiểm tra định dạng hoặc key đã tồn tại).');
    }
  };

  const handleToggleKey = async (kid: string) => {
    try {
      await apiPut(`/api/admin/gemini/keys/${encodeURIComponent(kid)}/toggle`);
      setMsg('Đã cập nhật trạng thái Key.');
      onRefresh();
    } catch (err: any) {
      setMsg(`Lỗi khi cập nhật key: ${err.message || ''}`);
    }
  };

  const handleDeleteKey = async (kid: string) => {
    if (!window.confirm('Xác nhận xóa API Key này khỏi Pool?')) return;
    try {
      await apiDelete(`/api/admin/gemini/keys/${encodeURIComponent(kid)}`);
      setMsg('Đã xóa API Key.');
      onRefresh();
    } catch (err: any) {
      setMsg(`Lỗi khi xóa key: ${err.message || ''}`);
    }
  };

  const filteredLibrary = ingestedList.filter((item) => {
    if (libraryFilter === 'all') return true;
    const cat = item.category || 'general';
    return cat === libraryFilter;
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* CỘT TRÁI: NẠP VÀ QUẢN TRỊ KHO TÀI LIỆU SÁCH TRADING (RAG INGESTION) */}
      <div className="space-y-6">
        <SpotlightBento className="p-6 space-y-4">
          <div className="border-b border-white/10 pb-3">
            <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400">
              RAG INGESTION PIPELINE
            </div>
            <h3 className="mt-1 text-base font-bold text-white font-sans">
              Nạp Tri Thức Mới Vào Bộ Não AI (PDF / TXT / MD)
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed font-sans">
              Hệ thống tự động sử dụng 4 sub-agent để bóc tách quy tắc, phân loại ngữ cảnh và đúc kết thành kỹ năng định lượng lưu trữ vào <code className="text-cyan-300">app/skills/learned</code>.
            </p>
          </div>

          <form onSubmit={handleIngestPdf} className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1">
                Tiêu đề tài liệu (Tùy chọn):
              </label>
              <input
                type="text"
                value={pdfTitle}
                onChange={(e) => setPdfTitle(e.target.value)}
                placeholder="VD: Trading in the Zone - Mark Douglas"
                className="w-full bg-[#060c1e] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Nhóm tri thức:
                </label>
                <select
                  value={pdfCategory}
                  onChange={(e: any) => setPdfCategory(e.target.value)}
                  className="w-full bg-[#060c1e] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
                >
                  <option value="macro">Kinh tế vĩ mô & Tin tức</option>
                  <option value="gold">Cấu trúc Vàng XAU/USD</option>
                  <option value="strategy">Chiến thuật Price Action / SMC</option>
                  <option value="general">Tâm lý & Quản trị rủi ro</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Tệp tài liệu:
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md"
                  onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                  className="w-full bg-[#060c1e] border border-white/10 rounded-xl px-2 py-1.5 text-xs text-slate-300 file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[11px] file:font-mono file:bg-cyan-500/20 file:text-cyan-300 hover:file:bg-cyan-500/30 font-mono cursor-pointer"
                />
              </div>
            </div>

            {/* Ingestion Steps Progress Indicator */}
            {isIngesting && (
              <div className="p-3 bg-cyan-950/20 border border-cyan-500/30 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-cyan-300">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                    <span>Đang tổng hợp tri thức tự trị...</span>
                  </span>
                  <span>Bước {ingestStep}/4</span>
                </div>
                <div className="text-[11px] text-slate-300 font-mono">
                  {ingestStep === 1 && '1/4. Trích xuất văn bản & Lọc nhiễu tài liệu...'}
                  {ingestStep === 2 && '2/4. Phân đoạn Vector & Trích xuất quy tắc giao dịch...'}
                  {ingestStep === 3 && '3/4. Sub-agent Alpha đúc kết kỹ năng định lượng...'}
                  {ingestStep === 4 && '4/4. Quy nạp thành công vào cơ sở dữ liệu tri thức!'}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isIngesting || !pdfFile}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-[#12B5A6] hover:from-cyan-500 hover:to-[#14C5B5] text-slate-950 font-mono text-xs font-bold transition flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer shadow-lg shadow-cyan-500/10"
            >
              <span>{isIngesting ? 'Đang Nạp Tài Liệu...' : 'Nạp Tri Thức Vào Não AI'}</span>
              <span>⚡</span>
            </button>
          </form>
        </SpotlightBento>

        {/* DANH SÁCH TÀI LIỆU ĐÃ NẠP (INGESTED KNOWLEDGE BASE) */}
        <SpotlightBento className="p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-[#12B5A6]">
                KHO KỸ NĂNG ĐÃ QUY NẠP
              </div>
              <h3 className="mt-1 text-base font-bold text-white font-sans">
                Thư Viện Tri Thức AI ({ingestedList.length} Mục)
              </h3>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 font-mono text-xs">
              {(['all', 'macro', 'gold', 'strategy'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setLibraryFilter(f)}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer text-[11px] ${
                    libraryFilter === f
                      ? 'bg-[#12B5A6]/20 text-[#12B5A6] font-bold border border-[#12B5A6]/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f === 'all' ? 'Tất cả' : f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {filteredLibrary.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs font-mono">
                Chưa có tài liệu nào trong danh mục này. Hãy nạp file tài liệu ở biểu mẫu phía trên.
              </div>
            ) : (
              filteredLibrary.map((item: any) => (
                <div
                  key={item.skill_id || item.id}
                  className="p-3 bg-[#060c1e] border border-white/5 hover:border-white/10 rounded-xl flex items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white truncate font-sans">{item.name || item.skill_id}</span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 shrink-0">
                        {item.category || 'general'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate font-mono">
                      {item.summary || item.skill_id}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteIngested(item.skill_id || item.id)}
                    className="text-slate-500 hover:text-rose-400 font-mono text-[11px] shrink-0 cursor-pointer px-2 py-1"
                  >
                    Xóa
                  </button>
                </div>
              ))
            )}
          </div>
        </SpotlightBento>
      </div>

      {/* CỘT PHẢI: BUDGET GUARD & QUẢN LÝ GEMINI KEY POOL */}
      <div className="space-y-6">
        {/* KHỐI 1: HẠN MỨC & NGÂN SÁCH QUOTA AI (BUDGET GUARD) */}
        <SpotlightBento className="p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
            <div>
              <div className="font-mono text-xs uppercase tracking-wider text-cyan-400 font-bold">
                BUDGET GUARD // CỤM AI GEMINI
              </div>
              <h3 className="text-base font-bold text-white mt-0.5 font-sans">
                Hạn Mức &amp; Ngân Sách Quota AI Trong Ngày
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={quotaUpdating}
                onClick={() => handleQuickQuotaOverride(60)}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold font-sans transition cursor-pointer disabled:opacity-50"
              >
                Mở khóa 60 phút
              </button>
              <button
                type="button"
                disabled={quotaUpdating}
                onClick={handleResetQuotaToday}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold font-sans transition cursor-pointer disabled:opacity-50"
              >
                Đặt lại hôm nay
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300">
                Tiến độ: <strong className="text-white tabular-nums">{aiQuota?.calls_today ?? 0}</strong> / <strong className="text-slate-400 tabular-nums">{aiQuota?.daily_cap ?? 90}</strong> lượt gọi
              </span>
              <span className={`font-bold tabular-nums ${
                (aiQuota?.usage_pct || 0) >= 100
                  ? 'text-rose-400'
                  : (aiQuota?.usage_pct || 0) >= 80
                  ? 'text-amber-300'
                  : 'text-emerald-400'
              }`}>
                {aiQuota?.usage_pct ?? 0}% ({aiQuota?.status || 'OK'})
              </span>
            </div>

            {/* Progress bar with dynamic color transitions */}
            <div className="w-full bg-white/5 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-2.5 rounded-full transition-all duration-500 ${
                  (aiQuota?.usage_pct || 0) >= 100
                    ? 'bg-rose-500'
                    : (aiQuota?.usage_pct || 0) >= 80
                    ? 'bg-amber-400'
                    : 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                }`}
                style={{ width: `${Math.min(100, aiQuota?.usage_pct || 0)}%` }}
              />
            </div>

            {/* Breakdown per caller */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {Object.entries(aiQuota?.breakdown || {}).map(([caller, cnt]) => (
                <span key={caller} className="px-2.5 py-1 rounded-md bg-white/5 border border-white/5 text-[11px] font-mono text-slate-300">
                  <span className="text-slate-400">{caller}:</span> <strong className="text-cyan-300 tabular-nums">{cnt}</strong>
                </span>
              ))}
            </div>
          </div>
        </SpotlightBento>

        {/* KHỐI 2: QUẢN LÝ GEMINI KEY POOL DỰ PHÒNG */}
        <SpotlightBento className="p-6 space-y-4">
          <div className="border-b border-white/10 pb-3">
            <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400">
              POOL KHÓA DỰ PHÒNG
            </div>
            <h3 className="mt-1 text-base font-bold text-white font-sans">
              Quản Lý Danh Sách Gemini API Key ({geminiPool.length} Keys)
            </h3>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-mono text-slate-300">
              Thêm khóa mới (Mỗi dòng một key hoặc phân tách bằng dấu phẩy):
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newKeyInput}
                onChange={(e) => setNewKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                className="flex-1 bg-[#060c1e] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-400 font-mono"
              />
              <button
                type="button"
                onClick={handleAddGeminiKey}
                className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-xl font-mono text-xs font-bold transition cursor-pointer shrink-0"
              >
                + Thêm Key
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {geminiPool.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs font-mono">
                Chưa có API Key nào trong Pool. Hệ thống sẽ tạm dùng key trong .env nếu có.
              </div>
            ) : (
              geminiPool.map((k: any) => (
                <div
                  key={k.id}
                  className="p-3 bg-[#060c1e] border border-white/5 hover:border-white/10 rounded-xl flex items-center justify-between gap-3 text-xs font-mono"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">{k.key_masked || k.id}</span>
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                        k.is_active
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-700 text-slate-400'
                      }`}>
                        {k.is_active ? 'HOẠT ĐỘNG' : 'TẠM TẮT'}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Độ trễ: {k.latency_ms ? `${k.latency_ms}ms` : '—'} • Trạng thái: {k.status || 'OK'}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleKey(k.id)}
                      className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] cursor-pointer"
                    >
                      {k.is_active ? 'Tắt' : 'Bật'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteKey(k.id)}
                      className="px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-[11px] cursor-pointer"
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SpotlightBento>
      </div>
    </div>
  );
};
