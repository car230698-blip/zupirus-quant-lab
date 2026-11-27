import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  apiPost,
  apiPut,
  apiDelete,
  fetchAdminAiQuota,
  updateAdminAiQuota,
  AdminAiQuota,
} from '../../api/client';
import { Panel, StatusBadge } from '../ui/Primitives';
import { BookOpen, Gauge, KeyRound, Trash2, Upload } from 'lucide-react';

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
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfTitle, setPdfTitle] = useState('');
  const [pdfCategory, setPdfCategory] = useState<'strategy' | 'macro' | 'gold' | 'general'>('macro');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestStep, setIngestStep] = useState<number>(0);
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'macro' | 'gold' | 'strategy'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newKeyInput, setNewKeyInput] = useState('');
  const [aiQuota, setAiQuota] = useState<AdminAiQuota | null>(null);
  const [quotaUpdating, setQuotaUpdating] = useState(false);

  // Inline confirm states (zero window.confirm)
  const [confirmResetQuota, setConfirmResetQuota] = useState(false);
  const [confirmDeleteSkillId, setConfirmDeleteSkillId] = useState<string | null>(null);
  const [confirmDeleteKeyId, setConfirmDeleteKeyId] = useState<string | null>(null);

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
    setConfirmResetQuota(false);
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
        setMsg(`Huấn luyện thành công: Đã bóc tách '${data.name}' [${data.detected_category || data.category}].`);
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
    setConfirmDeleteSkillId(null);
    try {
      await apiDelete(`/api/admin/skills/ingested/${encodeURIComponent(skillId)}`);
      setMsg(`Đã xóa tài liệu '${skillId}' khỏi kho tri thức.`);
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
        // ignore duplicate
      }
    }

    if (added > 0) {
      setNewKeyInput('');
      setMsg(`Đã nạp thành công ${added} Gemini API Key vào Pool.`);
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
    setConfirmDeleteKeyId(null);
    try {
      await apiDelete(`/api/admin/gemini/keys/${encodeURIComponent(kid)}`);
      setMsg('Đã xóa API Key.');
      onRefresh();
    } catch (err: any) {
      setMsg(`Lỗi khi xóa key: ${err.message || ''}`);
    }
  };

  const maskKeyDisplay = (k: any) => {
    if (k.key_masked) return k.key_masked;
    const str = String(k.id || '');
    if (str.startsWith('gemini_')) {
      return `AIzaSy****${str.slice(-4)}`;
    }
    if (str.length > 12) {
      return `${str.slice(0, 6)}****${str.slice(-4)}`;
    }
    return 'AIzaSy****';
  };

  const filteredLibrary = ingestedList.filter((item) => {
    if (libraryFilter === 'all') return true;
    const cat = item.category || 'general';
    return cat === libraryFilter;
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* LEFT: RAG INGESTION & INGESTED DOCUMENTS */}
      <div className="space-y-6">
        <Panel
          icon={<Upload className="h-4 w-4 text-cyan-300" />}
          title="Nạp Tri Thức Mới (PDF / TXT / MD)"
          subtitle="Tự động phân đoạn và đúc kết quy tắc định lượng vào kho tri thức nội bộ"
        >
          <form onSubmit={handleIngestPdf} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Tiêu đề tài liệu (Tùy chọn)
              </label>
              <input
                type="text"
                value={pdfTitle}
                onChange={(e) => setPdfTitle(e.target.value)}
                placeholder="VD: Trading in the Zone - Mark Douglas"
                className="quant-input font-mono text-xs"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Nhóm tri thức</label>
                <select
                  value={pdfCategory}
                  onChange={(e: any) => setPdfCategory(e.target.value)}
                  className="quant-input text-xs"
                >
                  <option value="macro">Kinh tế vĩ mô & Tin tức</option>
                  <option value="gold">Cấu trúc Vàng XAU/USD</option>
                  <option value="strategy">Chiến thuật Price Action / SMC</option>
                  <option value="general">Tâm lý & Quản trị rủi ro</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Tệp tài liệu</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md"
                  onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-300 file:mr-2 file:rounded-lg file:border file:border-slate-700 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:text-cyan-300 cursor-pointer"
                />
              </div>
            </div>

            {isIngesting && (
              <div className="p-3 bg-cyan-950/20 border border-cyan-500/30 rounded-xl space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between text-cyan-300">
                  <span>Đang xử lý tài liệu...</span>
                  <span>Bước {ingestStep}/4</span>
                </div>
                <div className="text-[11px] text-slate-300">
                  {ingestStep === 1 && '1/4 Trích xuất văn bản & lọc nhiễu'}
                  {ingestStep === 2 && '2/4 Phân đoạn & trích xuất quy tắc'}
                  {ingestStep === 3 && '3/4 Tổng hợp quy tắc định lượng'}
                  {ingestStep === 4 && '4/4 Hoàn tất quy nạp'}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isIngesting || !pdfFile}
              className="quant-btn-primary w-full text-xs"
            >
              {isIngesting ? 'Đang nạp tài liệu...' : 'Nạp Tri Thức Vào Hệ Thống'}
            </button>
          </form>
        </Panel>

        <Panel
          icon={<BookOpen className="h-4 w-4 text-[#12B5A6]" />}
          title={`Thư Viện Tri Thức (${ingestedList.length} Mục)`}
          action={
            <div className="flex items-center gap-1 font-mono text-[11px]">
              {(['all', 'macro', 'gold', 'strategy'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setLibraryFilter(f)}
                  className={`px-2 py-1 rounded-lg transition cursor-pointer ${
                    libraryFilter === f
                      ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/35'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f === 'all' ? 'Tất cả' : f.toUpperCase()}
                </button>
              ))}
            </div>
          }
        >
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {filteredLibrary.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs">
                Chưa có tài liệu nào trong danh mục này.
              </div>
            ) : (
              filteredLibrary.map((item: any) => {
                const sid = item.skill_id || item.id;
                const isConfirming = confirmDeleteSkillId === sid;
                return (
                  <div
                    key={sid}
                    className="p-3 bg-[#060A13] border border-slate-800 rounded-xl flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white truncate">{item.name || sid}</span>
                        <StatusBadge tone="info">{item.category || 'general'}</StatusBadge>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate font-mono">
                        {item.summary || sid}
                      </div>
                    </div>

                    {isConfirming ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleDeleteIngested(sid)}
                          className="quant-btn-danger min-h-[28px] px-2.5 py-1 text-[11px]"
                        >
                          Xác nhận xóa
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteSkillId(null)}
                          className="quant-quiet min-h-[28px] px-2 py-1 text-[11px]"
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteSkillId(sid)}
                        className="text-slate-400 hover:text-rose-300 cursor-pointer p-1.5 shrink-0"
                        title="Xóa"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Panel>
      </div>

      {/* RIGHT: QUOTA GUARD & GEMINI KEY POOL */}
      <div className="space-y-6">
        <Panel
          icon={<Gauge className="h-4 w-4 text-cyan-300" />}
          title="Hạn Mức Quota AI Trong Ngày"
          subtitle="Budget Guard bảo vệ hạn mức gọi API"
          action={
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={quotaUpdating}
                onClick={() => handleQuickQuotaOverride(60)}
                className="quant-btn-secondary min-h-[32px] px-2.5 py-1 text-[11px]"
              >
                Mở khóa 60p
              </button>
              {confirmResetQuota ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={quotaUpdating}
                    onClick={handleResetQuotaToday}
                    className="quant-btn-danger min-h-[32px] px-2.5 py-1 text-[11px]"
                  >
                    Xác nhận reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmResetQuota(false)}
                    className="quant-quiet min-h-[32px] px-2 py-1 text-[11px]"
                  >
                    Hủy
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={quotaUpdating}
                  onClick={() => setConfirmResetQuota(true)}
                  className="quant-quiet min-h-[32px] px-2.5 py-1 text-[11px]"
                >
                  Đặt lại hôm nay
                </button>
              )}
            </div>
          }
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-mono tabular-nums">
              <span className="text-slate-300">
                Tiến độ: <strong className="text-white">{aiQuota?.calls_today ?? 0}</strong> /{' '}
                <strong className="text-slate-400">{aiQuota?.daily_cap ?? 90}</strong> lượt gọi
              </span>
              <span
                className={`font-bold ${
                  (aiQuota?.usage_pct || 0) >= 100
                    ? 'text-rose-400'
                    : (aiQuota?.usage_pct || 0) >= 80
                    ? 'text-amber-300'
                    : 'text-emerald-400'
                }`}
              >
                {aiQuota?.usage_pct ?? 0}% ({aiQuota?.status || 'OK'})
              </span>
            </div>

            <div className="w-full bg-slate-800/80 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-2.5 rounded-full transition-all duration-500 ${
                  (aiQuota?.usage_pct || 0) >= 100
                    ? 'bg-rose-500'
                    : (aiQuota?.usage_pct || 0) >= 80
                    ? 'bg-amber-400'
                    : 'bg-cyan-400'
                }`}
                style={{ width: `${Math.min(100, aiQuota?.usage_pct || 0)}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px] text-slate-400 tabular-nums">
              {Object.entries(aiQuota?.breakdown || {}).map(([caller, cnt]) => (
                <span key={caller} className="rounded-md border border-slate-800 bg-[#060A13] px-2.5 py-1">
                  {caller}: <strong className="text-cyan-300">{cnt}</strong>
                </span>
              ))}
            </div>
          </div>
        </Panel>

        <Panel
          icon={<KeyRound className="h-4 w-4 text-amber-300" />}
          title={`Quản Lý Gemini API Keys (${geminiPool.length})`}
          subtitle="Xoay vòng khóa tự động cho hệ thống tổng hợp nghiên cứu"
        >
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                type="password"
                value={newKeyInput}
                onChange={(e) => setNewKeyInput(e.target.value)}
                placeholder="AIzaSy... (Ẩn mật khẩu khi nhập)"
                className="quant-input flex-1 font-mono text-xs"
              />
              <button type="button" onClick={handleAddGeminiKey} className="quant-btn-secondary text-xs shrink-0">
                + Thêm Key
              </button>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {geminiPool.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">
                  Chưa có API Key nào trong Pool.
                </div>
              ) : (
                geminiPool.map((k: any) => {
                  const isConfirming = confirmDeleteKeyId === k.id;
                  return (
                    <div
                      key={k.id}
                      className="p-3 bg-[#060A13] border border-slate-800 rounded-xl flex items-center justify-between gap-3 text-xs font-mono"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white truncate">{maskKeyDisplay(k)}</span>
                          <StatusBadge tone={k.is_active ? 'success' : 'neutral'}>
                            {k.is_active ? 'ACTIVE' : 'PAUSED'}
                          </StatusBadge>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Độ trễ: {k.latency_ms ? `${k.latency_ms}ms` : '—'} · Trạng thái: {k.status || 'OK'}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleKey(k.id)}
                          className="quant-quiet min-h-[28px] px-2.5 py-1 text-[11px]"
                        >
                          {k.is_active ? 'Tắt' : 'Bật'}
                        </button>
                        {isConfirming ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleDeleteKey(k.id)}
                              className="quant-btn-danger min-h-[28px] px-2.5 py-1 text-[11px]"
                            >
                              Xóa ngay
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteKeyId(null)}
                              className="quant-quiet min-h-[28px] px-2 py-1 text-[11px]"
                            >
                              Hủy
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteKeyId(k.id)}
                            className="quant-btn-danger min-h-[28px] px-2.5 py-1 text-[11px]"
                          >
                            Xóa
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
};
