import React, { useState, useRef } from 'react';
import { apiPost, apiPut, apiDelete } from '../api/client';

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
    const rawKeys = newKeyInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (rawKeys.length === 0) return;
    let added = 0;
    for (const k of rawKeys) {
      try {
        await apiPost('/api/admin/gemini/keys', { key: k });
        added++;
      } catch {
        // ignore duplicate
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
      onRefresh();
    } catch (err: any) {
      setMsg(`Lỗi đổi trạng thái key: ${err.message || ''}`);
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

  const filteredIngested = ingestedList.filter((item: any) => {
    if (libraryFilter === 'all') return true;
    const nameLower = String(item.name || '').toLowerCase();
    const descLower = String(item.description || '').toLowerCase();
    const isMacro = nameLower.includes('fed') || nameLower.includes('vĩ mô') || descLower.includes('vĩ mô') || descLower.includes('tiền tệ');
    const isGold = nameLower.includes('gold') || nameLower.includes('vàng') || descLower.includes('vàng');
    if (libraryFilter === 'macro') return isMacro;
    if (libraryFilter === 'gold') return isGold;
    if (libraryFilter === 'strategy') return !isMacro && !isGold;
    return true;
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* CỘT TRÁI: NẠP TRI THỨC PDF & TÀI LIỆU */}
      <div className="space-y-6">
        <div className="quant-panel p-6 bg-[#040816] border border-white/10 rounded-2xl space-y-4">
          <div className="border-b border-white/10 pb-3">
            <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400">
              NẠP TRI THỨC & TÀI LIỆU QUAN TRỌNG
            </div>
            <h3 className="mt-1 text-base font-bold text-white">
              Đúc Kết Tri Thức Định Lượng (PDF / Markdown)
            </h3>
          </div>

          <form onSubmit={handleIngestPdf} className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1.5">
                File tài liệu nghiên cứu (PDF, MD, TXT):
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.md,.txt"
                onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-mono file:font-bold file:bg-cyan-500/20 file:text-cyan-300 hover:file:bg-cyan-500/30 cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1.5">
                  Tiêu đề tài liệu (Tùy chọn):
                </label>
                <input
                  type="text"
                  value={pdfTitle}
                  onChange={(e) => setPdfTitle(e.target.value)}
                  placeholder="VD: Cẩm nang giao dịch Vàng 2026"
                  className="w-full bg-[#060c1e] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1.5">
                  Phân nhóm chuyên môn:
                </label>
                <select
                  value={pdfCategory}
                  onChange={(e) => setPdfCategory(e.target.value as any)}
                  className="w-full bg-[#060c1e] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400 font-mono cursor-pointer"
                >
                  <option value="macro">Kinh tế Vĩ mô & Chính sách FED</option>
                  <option value="gold">Cấu trúc Vàng XAU/USD & Mùa vụ</option>
                  <option value="strategy">Chiến thuật Kỹ thuật & SMC/ICT</option>
                  <option value="general">Tri thức Tổng hợp</option>
                </select>
              </div>
            </div>

            {/* 4-Agent Visual Step Feedback */}
            {isIngesting && (
              <div className="p-3 bg-cyan-950/40 border border-cyan-500/30 rounded-xl text-xs font-mono space-y-2">
                <div className="text-cyan-300 font-bold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  Swarm Multi-Agent Đang Xử Lý:
                </div>
                <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
                  <div className={`p-1.5 rounded ${ingestStep >= 1 ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-600'}`}>
                    1. Bóc Tách
                  </div>
                  <div className={`p-1.5 rounded ${ingestStep >= 2 ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-600'}`}>
                    2. Tổng Hợp
                  </div>
                  <div className={`p-1.5 rounded ${ingestStep >= 3 ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-600'}`}>
                    3. Kiểm Định
                  </div>
                  <div className={`p-1.5 rounded ${ingestStep >= 4 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'text-slate-600'}`}>
                    4. Đúc Kết
                  </div>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isIngesting || !pdfFile}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold font-mono text-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/20"
            >
              {isIngesting ? 'Đang Đúc Kết Tri Thức...' : 'Nạp Tài Liệu Vào Bộ Não AI'}
            </button>
          </form>
        </div>

        {/* Danh sách tài liệu đã đúc kết */}
        <div className="quant-panel p-6 bg-[#040816] border border-white/10 rounded-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <div className="font-mono text-[11px] text-slate-400 uppercase tracking-widest">KHO TRI THỨC</div>
              <h4 className="text-sm font-bold text-white">Tài Liệu Đã Nạp ({filteredIngested.length})</h4>
            </div>
            <div className="flex gap-1 text-[11px] font-mono">
              {(['all', 'macro', 'gold', 'strategy'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setLibraryFilter(tab)}
                  className={`px-2 py-1 rounded-lg uppercase ${
                    libraryFilter === tab ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {filteredIngested.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-xs font-mono">
                Chưa có tài liệu nào trong nhóm này.
              </div>
            ) : (
              filteredIngested.map((item: any) => (
                <div
                  key={item.skill_id || item.id}
                  className="p-3 bg-[#060c1e] border border-white/5 hover:border-white/10 rounded-xl flex items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-bold text-white truncate font-mono">{item.name || item.skill_id}</div>
                    <div className="text-[11px] text-slate-400 truncate">{item.description || 'Kỹ năng định lượng'}</div>
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
        </div>
      </div>

      {/* CỘT PHẢI: QUẢN LÝ GEMINI KEY POOL DỰ PHÒNG */}
      <div className="space-y-6">
        <div className="quant-panel p-6 bg-[#040816] border border-white/10 rounded-2xl space-y-4">
          <div className="border-b border-white/10 pb-3">
            <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400">
              POOL KHÓA DỰ PHÒNG
            </div>
            <h3 className="mt-1 text-base font-bold text-white">
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
        </div>
      </div>
    </div>
  );
};
