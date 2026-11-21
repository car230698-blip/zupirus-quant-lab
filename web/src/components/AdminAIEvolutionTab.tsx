import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';
import { ToastNotification } from './ToastNotification.tsx';

interface EvolutionStage {
  active_mode: string;
  auto_promote: boolean;
  samples_learned: number;
  target_samples: number;
  readiness_pct: number;
}

interface EvolutionData {
  stage?: EvolutionStage;
  sources?: any[];
  hindsight_lessons?: any[];
  skills_builtin?: any[];
  skills_learned?: any[];
}

type SubTabKey = 'pipeline' | 'brain' | 'maturity';

export const AdminAIEvolutionTab: React.FC = () => {
  const [subTab, setSubTab] = useState<SubTabKey>('pipeline');
  const [evo, setEvo] = useState<EvolutionData>({});
  const [geminiPool, setGeminiPool] = useState<any[]>([]);
  const [newKeysText, setNewKeysText] = useState('');
  const [aiSettings, setAiSettings] = useState<any>({
    primary_provider: 'gemini_pool',
    model_name: 'gemini-3-flash-preview',
    api_key_masked: '',
  });
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestMsg, setAiTestMsg] = useState('');
  const [msg, setMsg] = useState('');

  // Key Ping Health state
  const [pingingKeys, setPingingKeys] = useState(false);
  const [keyPingResults, setKeyPingResults] = useState<Record<string, any>>({});

  // PDF / Document Ingestion state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfTitle, setPdfTitle] = useState('');
  const [pdfCategory] = useState('AUTO');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestStep, setIngestStep] = useState(0);
  const [lastIngestedResult, setLastIngestedResult] = useState<any>(null);
  const [ingestedList, setIngestedList] = useState<any[]>([]);
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'macro' | 'gold' | 'strategy'>('all');

  const loadAll = useCallback(async () => {
    try {
      const [eData, gData, sData, iData] = await Promise.all([
        api.get('/api/v1/telemetry/ai-evolution').catch(() => null),
        api.get('/api/admin/gemini/keys').catch(() => null),
        api.get('/api/admin/ai/settings').catch(() => null),
        api.get('/api/admin/skills/ingested').catch(() => null),
      ]);
      if (eData) setEvo(eData);
      if (gData) {
        setGeminiPool(gData.keys || []);
      }
      if (sData) {
        setAiSettings((prev: any) => {
          if (prev._hydrated) return prev;
          return { ...prev, ...(sData.settings || sData), api_key: '', _hydrated: true };
        });
      }
      if (iData) {
        setIngestedList(iData.skills || iData.ingested_skills || []);
      }
    } catch {
      // keep existing state
    }
  }, []);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 10000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const handleToggleAutoPromote = async () => {
    const nextVal = !Boolean(evo.stage?.auto_promote);
    try {
      const j = await api.post('/api/admin/sources/auto-promote', { enabled: nextVal });
      setMsg(j.message || 'Đã cập nhật chế độ tự tiến hóa.');
      await loadAll();
    } catch (err: any) {
      setMsg(`Lỗi: ${err.message || ''}`);
    }
  };

  const handleSaveGeminiKeys = async () => {
    const keys = newKeysText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (keys.length === 0) return;
    let addedCount = 0;
    for (const k of keys) {
      try {
        await api.post('/api/admin/gemini/keys', { key: k });
        addedCount++;
      } catch {
        // ignore duplicate
      }
    }
    if (addedCount > 0) {
      setNewKeysText('');
      setMsg(`Đã nạp ${addedCount} Gemini API Key vào Pool.`);
      await loadAll();
    } else {
      setMsg('Không thể nạp Gemini Key (kiểm tra định dạng hoặc key đã tồn tại).');
    }
  };

  const handleToggleGeminiKey = async (kid: string) => {
    try {
      await api.put(`/api/admin/gemini/keys/${encodeURIComponent(kid)}/toggle`);
      await loadAll();
    } catch {
      // ignore
    }
  };

  const handleDeleteGeminiKey = async (kid: string) => {
    if (!window.confirm('Bạn có chắc muốn xóa API Key này khỏi hệ thống?')) return;
    try {
      await api.delete(`/api/admin/gemini/keys/${encodeURIComponent(kid)}`);
      await loadAll();
    } catch {
      // ignore
    }
  };

  const handlePingAllKeys = async () => {
    setPingingKeys(true);
    setMsg('Đang gửi tín hiệu kiểm tra trực tiếp (Ping Live) tới toàn bộ API Key trong Pool...');
    try {
      const d = await api.post('/api/admin/gemini/keys/ping-all');
      if (d && d.ok) {
        const mapping: Record<string, any> = {};
        for (const k of d.keys || []) {
          mapping[k.id] = k;
        }
        setKeyPingResults(mapping);
        setMsg(`✓ ${d.message}`);
        await loadAll();
      } else {
        setMsg(`Lỗi kiểm tra key: ${d?.detail || ''}`);
      }
    } catch (e: any) {
      setMsg(`Lỗi kết nối kiểm tra: ${e.message}`);
    } finally {
      setPingingKeys(false);
    }
  };

  const handlePingSingleKey = async (kid: string) => {
    try {
      const d = await api.post(`/api/admin/gemini/keys/${encodeURIComponent(kid)}/ping`);
      if (d && d.ok) {
        setKeyPingResults((prev) => ({ ...prev, [kid]: d }));
        setMsg(`✓ Key ${d.key_masked}: ${d.status} (${d.latency_ms}ms)`);
        await loadAll();
      } else {
        setKeyPingResults((prev) => ({ ...prev, [kid]: { ...d, ok: false } }));
        setMsg(`Lỗi key ${kid}: ${d?.message || d?.detail}`);
      }
    } catch (e: any) {
      setMsg(`Lỗi mạng: ${e.message}`);
    }
  };

  const handleSaveAiSettings = async () => {
    try {
      await api.post('/api/admin/ai/settings', aiSettings);
      setMsg('Đã lưu cấu hình Provider AI nâng cao.');
      await loadAll();
    } catch (err: any) {
      setMsg(`Lỗi: ${err.message || ''}`);
    }
  };

  const handleTestAiConnection = async () => {
    setTestingAi(true);
    setAiTestMsg('');
    try {
      const d = await api.post('/api/admin/ai/test', { prompt: 'Kiểm tra kết nối AI Swarm ZUPIRUS.' });
      setAiTestMsg(`Kết nối thành công (${d.model || 'Gemini'} • ${d.latency_ms || 0}ms)`);
    } catch (err: any) {
      setAiTestMsg(`Lỗi: ${err.message || ''}`);
    } finally {
      setTestingAi(false);
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
    setLastIngestedResult(null);

    const formData = new FormData();
    formData.append('file', pdfFile);
    if (pdfTitle.trim()) formData.append('title', pdfTitle.trim());
    formData.append('category', pdfCategory);

    try {
      const stepTimer1 = setTimeout(() => setIngestStep(2), 1200);
      const stepTimer2 = setTimeout(() => setIngestStep(3), 3500);

      const data = await api.post('/api/admin/skills/ingest-pdf', formData);

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      setIngestStep(4);

      if (data && data.ok) {
        setLastIngestedResult(data);
        setMsg(`✓ Huấn luyện thành công: Đã bóc tách '${data.name}' [${data.detected_category || data.category}].`);
        setPdfFile(null);
        setPdfTitle('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        await loadAll();
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
      await api.delete(`/api/admin/skills/ingested/${encodeURIComponent(skillId)}`);
      setMsg(`Đã xóa tài liệu '${skillId}' khỏi bộ não AI.`);
      await loadAll();
    } catch (e: any) {
      setMsg(`Lỗi khi xóa: ${e.message}`);
    }
  };

  const handleReclassifyAll = async () => {
    if (!window.confirm('Tái phân loại toàn bộ tài liệu đã nạp theo chuẩn phân biệt: Kiến Thức Thị Trường & Vĩ Mô vs Phương Pháp Kỹ Thuật?')) return;
    try {
      setMsg('Đang tái phân tích và chuẩn hóa danh mục tài liệu...');
      const d = await api.post('/api/admin/skills/reclassify-all');
      if (d && d.ok) {
        setMsg(`✓ Đã tái phân loại thành công ${d.reclassified_count} tài liệu sang đúng nhóm Vĩ Mô & Kiến Thức Thị Trường.`);
        await loadAll();
      } else {
        setMsg(`Lỗi tái phân loại: ${d?.detail || ''}`);
      }
    } catch (e: any) {
      setMsg(`Lỗi mạng: ${e.message}`);
    }
  };

  // Filtered ingested list
  const filteredIngestedList = ingestedList.filter((item: any) => {
    if (libraryFilter === 'all') return true;
    const nameLower = String(item.name || '').toLowerCase();
    const descLower = String(item.description || '').toLowerCase();
    const isMacro = nameLower.includes('fed') || nameLower.includes('vĩ mô') || nameLower.includes('waller') || nameLower.includes('dollar') || descLower.includes('vĩ mô') || descLower.includes('tiền tệ');
    const isGold = nameLower.includes('gold') || nameLower.includes('vàng') || descLower.includes('vàng');
    if (libraryFilter === 'macro') return isMacro;
    if (libraryFilter === 'gold') return isGold;
    if (libraryFilter === 'strategy') return !isMacro && !isGold;
    return true;
  });

  return (
    <div className="space-y-6">
      <ToastNotification message={msg || null} type="info" onClose={() => setMsg('')} />

      {/* TOP SUB-NAVIGATION TABS */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('pipeline')}
            className={`px-4 py-2.5 rounded-xl font-mono text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              subTab === 'pipeline'
                ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-400 text-cyan-200 shadow-lg shadow-cyan-500/20'
                : 'bg-[#040816] border border-white/10 text-slate-400 hover:text-white hover:border-white/20'
            }`}
          >
            <span>📚</span>
            <span>QUY TRÌNH SWARM &amp; NẠP TRI THỨC</span>
            <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] text-cyan-300">
              {ingestedList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('brain')}
            className={`px-4 py-2.5 rounded-xl font-mono text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              subTab === 'brain'
                ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-400 text-amber-200 shadow-lg shadow-amber-500/20'
                : 'bg-[#040816] border border-white/10 text-slate-400 hover:text-white hover:border-white/20'
            }`}
          >
            <span>🧠</span>
            <span>BỘ NÃO AI &amp; GEMINI POOL OPS</span>
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">
              {geminiPool.length} Keys
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('maturity')}
            className={`px-4 py-2.5 rounded-xl font-mono text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              subTab === 'maturity'
                ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-400 text-emerald-200 shadow-lg shadow-emerald-500/20'
                : 'bg-[#040816] border border-white/10 text-slate-400 hover:text-white hover:border-white/20'
            }`}
          >
            <span>📈</span>
            <span>LỘ TRÌNH TIẾN HÓA &amp; ĐỐI SOÁT</span>
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300">
              {evo.stage?.active_mode || 'STAGE 1'}
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={loadAll}
          className="rounded-xl border border-white/10 bg-[#040814] px-3 py-2 text-xs text-slate-300 hover:bg-white/10 cursor-pointer font-mono flex items-center gap-1.5"
        >
          <span>↻</span>
          <span>Đồng Bộ Dữ Liệu</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* PHÂN HỆ 1: QUY TRÌNH SWARM & HUẤN LUYỆN TRI THỨC                          */}
      {/* ========================================================================= */}
      {subTab === 'pipeline' && (
        <div className="space-y-6">
          {/* Swarm Multi-Agent Pipeline Visualization */}
          <div className="quant-panel p-6 space-y-4 border border-cyan-500/30 bg-gradient-to-b from-[#060c1e] to-[#020510]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  Quy Trình Xử Lý Tri Thức Qua 4 Agent Độc Lập
                </div>
                <h3 className="mt-1 text-base font-bold text-white">
                  Kiến Trúc Swarm Agents Nạp &amp; Đúc Kết Tri Thức Định Lượng
                </h3>
              </div>
              <span className="text-xs font-mono text-cyan-300/80">
                Chuẩn hóa tri thức thị trường &amp; Chiến lược tự động
              </span>
            </div>

            {/* 4-Stage Agent Diagram */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2">
              <div className={`p-4 rounded-xl border transition ${
                ingestStep === 1
                  ? 'border-cyan-400 bg-cyan-950/50 shadow-lg shadow-cyan-500/20 ring-1 ring-cyan-400'
                  : 'border-white/10 bg-[#030614]'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-bold text-cyan-300">AGENT 1</span>
                  <span className="text-xl">🕵️</span>
                </div>
                <div className="font-bold text-white text-xs mb-1">DocReader Agent</div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Tiếp nhận tài liệu PDF (tới 35MB), giải mã văn bản 100 trang, bóc tách cấu trúc và lọc nhiễu định dạng.
                </p>
                {ingestStep === 1 && <div className="mt-2 text-[10px] font-mono text-cyan-300 animate-pulse">⏳ Đang đọc tài liệu...</div>}
              </div>

              <div className={`p-4 rounded-xl border transition ${
                ingestStep === 2
                  ? 'border-cyan-400 bg-cyan-950/50 shadow-lg shadow-cyan-500/20 ring-1 ring-cyan-400'
                  : 'border-white/10 bg-[#030614]'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-bold text-cyan-300">AGENT 2</span>
                  <span className="text-xl">🧠</span>
                </div>
                <div className="font-bold text-white text-xs mb-1">Taxonomy Agent</div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Phân tích nội dung, nhận diện bản chất: Kiến thức vĩ mô/Fed Policy, Dòng tiền Vàng, hay Kỹ thuật SMC/Price Action.
                </p>
                {ingestStep === 2 && <div className="mt-2 text-[10px] font-mono text-cyan-300 animate-pulse">⏳ Đang phân loại bản chất...</div>}
              </div>

              <div className={`p-4 rounded-xl border transition ${
                ingestStep === 3
                  ? 'border-amber-400 bg-amber-950/50 shadow-lg shadow-amber-500/20 ring-1 ring-amber-400'
                  : 'border-white/10 bg-[#030614]'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-bold text-amber-300">AGENT 3</span>
                  <span className="text-xl">🛡️</span>
                </div>
                <div className="font-bold text-white text-xs mb-1">RiskGuard Agent</div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Kiểm định chuẩn Fail-Closed: Ép buộc Stop-Loss cứng ATR(14) M15 hoặc quy tắc News Shield đóng băng giờ tin tức.
                </p>
                {ingestStep === 3 && <div className="mt-2 text-[10px] font-mono text-amber-300 animate-pulse">⏳ Đang kiểm định rủi ro...</div>}
              </div>

              <div className={`p-4 rounded-xl border transition ${
                ingestStep === 4
                  ? 'border-emerald-400 bg-emerald-950/50 shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-400'
                  : 'border-white/10 bg-[#030614]'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-bold text-emerald-300">AGENT 4</span>
                  <span className="text-xl">⚡</span>
                </div>
                <div className="font-bold text-white text-xs mb-1">MemoryIntegrator</div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Biên soạn file SKILL.md chuẩn hóa, cấp định danh UUID, nạp vào cơ sở dữ liệu và bộ nhớ hoạt động của Swarm AI.
                </p>
                {ingestStep === 4 && <div className="mt-2 text-[10px] font-mono text-emerald-300 animate-pulse">✓ Đã tích hợp thành công!</div>}
              </div>
            </div>
          </div>

          {/* Form Nạp Tài Liệu */}
          <div className="quant-panel p-6 space-y-4 border border-cyan-500/20 bg-[#030715]">
            <div className="border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Cổng Tiếp Nhận Tài Liệu &amp; Báo Cáo Thị Trường</span>
                <span className="rounded bg-cyan-500/20 border border-cyan-400/40 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                  Hỗ trợ tối đa 35MB
                </span>
              </h3>
              <p className="mt-1 text-xs text-slate-300">
                Tải lên sách phân tích, báo cáo ngân hàng trung ương Fed, tài liệu kinh tế vĩ mô hoặc cẩm nang giao dịch. Swarm AI sẽ bóc tách và phân loại tự động.
              </p>
            </div>

            <form onSubmit={handleIngestPdf} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-mono text-slate-400 mb-1">
                    CHỌN FILE TÀI LIỆU (.PDF, .TXT, .MD — TỐI ĐA 35MB)
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,.md"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setPdfFile(f);
                        if (!pdfTitle) {
                          setPdfTitle(f.name.replace(/\.[^/.]+$/, ''));
                        }
                      }
                    }}
                    className="w-full text-xs text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-cyan-500/20 file:text-cyan-300 hover:file:bg-cyan-500/30 cursor-pointer rounded-xl border border-white/10 bg-[#040710] p-1.5"
                  />
                  {pdfFile && (
                    <div className="mt-2 flex items-center justify-between rounded-lg border border-cyan-400/30 bg-cyan-950/40 px-3 py-1.5 text-xs text-cyan-200">
                      <span className="font-mono truncate">📄 {pdfFile.name} ({(pdfFile.size / 1024 / 1024).toFixed(2)} MB)</span>
                      <button
                        type="button"
                        onClick={() => {
                          setPdfFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="text-slate-400 hover:text-rose-400 ml-2 font-mono text-xs cursor-pointer"
                      >
                        ✕ Hủy
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-slate-400 mb-1">
                    TÊN TÀI LIỆU / ĐỀ MỤC (TỰ ĐỘNG ĐIỀN HOẶC TÙY CHỈNH)
                  </label>
                  <input
                    type="text"
                    value={pdfTitle}
                    onChange={(e) => setPdfTitle(e.target.value)}
                    placeholder="Tự động đặt theo tên file hoặc nội dung sách"
                    className="w-full rounded-xl border border-white/10 bg-[#040710] px-3 py-2.5 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="text-[11px] font-mono text-emerald-300/90 flex items-center gap-1.5">
                  <span>✨ AI Tự Động Phân Biệt:</span>
                  <span className="text-slate-300">
                    Kinh tế Vĩ mô / Chính sách Fed / Dòng tiền Vàng vs Phương pháp Kỹ thuật (SMC / Price Action).
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={isIngesting || !pdfFile}
                  className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-2.5 text-xs font-bold text-white hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition cursor-pointer shadow-lg shadow-cyan-500/20 whitespace-nowrap"
                >
                  {isIngesting ? 'Swarm Đang Xử Lý & Bóc Tách...' : '⚡ Bắt Đầu Bóc Tách & Nạp Tri Thức'}
                </button>
              </div>
            </form>

            {/* Ingest Progress Stepper */}
            {isIngesting && (
              <div className="rounded-xl border border-cyan-500/30 bg-[#04091a] p-4 space-y-2">
                <div className="text-xs font-bold text-cyan-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  Luồng Thực Thi Tuyến Tính Của 4 Agent:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                  <div className={`p-2 rounded border ${ingestStep >= 1 ? 'border-cyan-400 bg-cyan-500/10 text-cyan-200' : 'border-white/10 text-slate-500'}`}>
                    1. DocReader: Đọc văn bản {ingestStep === 1 && '⏳'}
                  </div>
                  <div className={`p-2 rounded border ${ingestStep >= 2 ? 'border-cyan-400 bg-cyan-500/10 text-cyan-200' : 'border-white/10 text-slate-500'}`}>
                    2. Taxonomy: Phân loại {ingestStep === 2 && '⏳'}
                  </div>
                  <div className={`p-2 rounded border ${ingestStep >= 3 ? 'border-amber-400 bg-amber-500/10 text-amber-200' : 'border-white/10 text-slate-500'}`}>
                    3. RiskGuard: Ép chuẩn SL {ingestStep === 3 && '⏳'}
                  </div>
                  <div className={`p-2 rounded border ${ingestStep >= 4 ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300' : 'border-white/10 text-slate-500'}`}>
                    4. Integrator: Nạp Swarm {ingestStep >= 4 && '✓'}
                  </div>
                </div>
              </div>
            )}

            {/* Result summary card */}
            {lastIngestedResult && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-emerald-300 flex items-center gap-2">
                    <span>✓ Kỹ Năng / Tri Thức Đã Biên Soạn Thành Công:</span>
                    <span className="text-white font-mono">{lastIngestedResult.name}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-cyan-500/20 border border-cyan-400/40 px-2.5 py-0.5 font-mono text-[10.5px] font-bold text-cyan-300">
                      🎯 Phân Loại: {lastIngestedResult.detected_category || lastIngestedResult.category || 'Tự Động'}
                    </span>
                    <span className="rounded bg-emerald-500/20 border border-emerald-400/40 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                      ACTIVE
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {lastIngestedResult.description}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-white/10 bg-[#030611] p-2.5">
                    <span className="font-mono text-[10px] uppercase text-amber-400 block mb-1">Quy Tắc Quản Trị Rủi Ro / Stop-Loss</span>
                    <span className="text-slate-200">{lastIngestedResult.stop_loss_rule || 'Tuân thủ bảo vệ vốn Fail-Closed'}</span>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-[#030611] p-2.5">
                    <span className="font-mono text-[10px] uppercase text-cyan-400 block mb-1">Chốt Lời &amp; Ứng Dụng Vị Thế</span>
                    <span className="text-slate-200">{lastIngestedResult.take_profit_rule || 'Theo dõi xu hướng chu kỳ và quản trị tỷ trọng'}</span>
                  </div>
                </div>
                {Array.isArray(lastIngestedResult.rules_summary) && lastIngestedResult.rules_summary.length > 0 && (
                  <ul className="text-xs text-slate-300 space-y-1 list-disc pl-4 font-mono">
                    {lastIngestedResult.rules_summary.map((r: string, idx: number) => (
                      <li key={idx}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Thư Viện Tri Thức AI Đã Bóc Tách */}
          <div className="quant-panel p-6 space-y-4 border border-cyan-500/30 bg-[#040816]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-cyan-400" />
                  Kho Tri Thức Định Lượng Trong Bộ Nhớ AI
                </div>
                <h3 className="mt-1 text-base font-bold text-white flex items-center gap-2">
                  <span>Sách, Báo Cáo Vĩ Mô &amp; Kỹ Năng Đã Huấn Luyện</span>
                  <span className="rounded-full bg-cyan-500/20 border border-cyan-400/40 px-2.5 py-0.5 text-xs font-mono text-cyan-300">
                    {ingestedList.length} tài liệu
                  </span>
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleReclassifyAll}
                  title="Quét lại các tài liệu cũ và phân loại lại sang đúng nhóm Kinh Tế Vĩ Mô & Fed Policy"
                  className="rounded-lg border border-cyan-400/30 bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/25 cursor-pointer font-mono font-bold transition"
                >
                  ⚡ Tái Phân Loại Chuẩn Vĩ Mô
                </button>
                <button
                  type="button"
                  onClick={loadAll}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 cursor-pointer font-mono"
                >
                  ↻ Làm Mới
                </button>
              </div>
            </div>

            {/* Filter Chips */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono text-slate-400 mr-1">Bộ lọc danh mục:</span>
              <button
                type="button"
                onClick={() => setLibraryFilter('all')}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition cursor-pointer ${
                  libraryFilter === 'all'
                    ? 'bg-cyan-500/25 border border-cyan-400 text-cyan-200 font-bold'
                    : 'bg-[#030612] border border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                Tất cả ({ingestedList.length})
              </button>
              <button
                type="button"
                onClick={() => setLibraryFilter('macro')}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition cursor-pointer ${
                  libraryFilter === 'macro'
                    ? 'bg-purple-500/25 border border-purple-400 text-purple-200 font-bold'
                    : 'bg-[#030612] border border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                🌐 Vĩ Mô &amp; Fed
              </button>
              <button
                type="button"
                onClick={() => setLibraryFilter('gold')}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition cursor-pointer ${
                  libraryFilter === 'gold'
                    ? 'bg-amber-500/25 border border-amber-400 text-amber-200 font-bold'
                    : 'bg-[#030612] border border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                🪙 Dòng Tiền Vàng
              </button>
              <button
                type="button"
                onClick={() => setLibraryFilter('strategy')}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition cursor-pointer ${
                  libraryFilter === 'strategy'
                    ? 'bg-cyan-500/25 border border-cyan-400 text-cyan-200 font-bold'
                    : 'bg-[#030612] border border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                ⚡ Chiến Lược Quant
              </button>
            </div>

            {filteredIngestedList.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-slate-400 text-xs">
                <div className="text-2xl mb-2">📚</div>
                Chưa có tài liệu nào trong nhóm này. Hãy tải lên sách chiến lược, cẩm nang SMC, Price Action hoặc báo cáo vĩ mô ở bảng phía trên.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredIngestedList.map((item: any) => {
                  const nameLower = String(item.name || '').toLowerCase();
                  const descLower = String(item.description || '').toLowerCase();
                  const isMacro = nameLower.includes('fed') || nameLower.includes('vĩ mô') || nameLower.includes('waller') || nameLower.includes('dollar') || descLower.includes('vĩ mô') || descLower.includes('tiền tệ');
                  const isGold = nameLower.includes('gold') || nameLower.includes('vàng') || descLower.includes('vàng');

                  return (
                    <div
                      key={item.skill_id}
                      className="rounded-xl border border-white/10 bg-[#02050f]/80 p-4 space-y-3 hover:border-cyan-500/40 transition"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-white text-sm truncate flex items-center gap-2">
                            <span>{isMacro ? '🌐' : isGold ? '🪙' : '📘'}</span>
                            <span title={item.name}>{item.name || item.skill_id}</span>
                          </div>
                          <div className="font-mono text-[10px] text-slate-400 truncate mt-0.5">
                            ID: {item.skill_id}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
                            isMacro
                              ? 'bg-purple-500/15 border-purple-400/40 text-purple-200'
                              : isGold
                              ? 'bg-amber-500/15 border-amber-400/40 text-amber-200'
                              : 'bg-cyan-500/15 border-cyan-400/30 text-cyan-300'
                          }`}>
                            {isMacro ? 'VĨ MÔ & FED' : isGold ? 'DÒNG TIỀN VÀNG' : 'CHIẾN LƯỢC QUANT'}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                              item.enabled
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                                : 'bg-slate-700 text-slate-400'
                            }`}
                          >
                            {item.enabled ? 'ACTIVE' : 'OFF'}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                        {item.description || 'Hồ sơ tri thức được AI bóc tách từ tài liệu.'}
                      </p>

                      {item.trigger_condition && (
                        <div className="rounded border border-white/5 bg-[#030612] px-2.5 py-1.5 text-[11px] font-mono text-cyan-200/90 leading-snug">
                          <span className="text-amber-400 font-bold">🎯 Ứng dụng: </span>
                          <span>{item.trigger_condition}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-[11px] font-mono">
                        <span className="text-slate-400">
                          Đã tham vấn: <strong className="text-amber-300">{item.usage_count || 0}</strong> lần
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await api.patch(`/api/admin/skills/${encodeURIComponent(item.skill_id)}`, {
                                  enabled: !Boolean(item.enabled),
                                });
                                await loadAll();
                              } catch (e: any) {
                                setMsg(`Lỗi đổi trạng thái: ${e.message}`);
                              }
                            }}
                            className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer transition ${
                              item.enabled
                                ? 'bg-amber-500/15 text-amber-300 border border-amber-400/30 hover:bg-amber-500/25'
                                : 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30 hover:bg-emerald-500/25'
                            }`}
                          >
                            {item.enabled ? 'Tạm Dừng' : 'Kích Hoạt'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteIngested(item.skill_id)}
                            className="px-2 py-1 rounded text-[10px] font-bold text-rose-300 bg-rose-500/15 border border-rose-400/30 hover:bg-rose-500/25 cursor-pointer transition"
                          >
                            Xóa
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* PHÂN HỆ 2: CẤU HÌNH BỘ NÃO & KIỂM TRA GEMINI POOL                        */}
      {/* ========================================================================= */}
      {subTab === 'brain' && (
        <div className="space-y-6">
          {/* Key Health Matrix Panel */}
          <div className="quant-panel p-6 space-y-4 border border-amber-500/30 bg-[#050817]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400">
                  Quản Trị Tải &amp; Giám Sát Sức Khỏe API Key
                </div>
                <h3 className="mt-1 text-base font-bold text-white flex items-center gap-2">
                  <span>Google Gemini API Key Pool ({geminiPool.length} Keys)</span>
                  <span className="rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2 py-0.5 text-xs font-mono text-emerald-300">
                    Tự Động Luân Chuyển Quota
                  </span>
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={pingingKeys || geminiPool.length === 0}
                  onClick={handlePingAllKeys}
                  className="rounded-xl border border-emerald-400/50 bg-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50 cursor-pointer shadow-lg shadow-emerald-500/20 font-mono flex items-center gap-1.5 transition"
                >
                  <span>⚡</span>
                  <span>{pingingKeys ? 'Đang Kiểm Tra Live...' : 'Kiểm Tra Toàn Bộ Key (Live Ping)'}</span>
                </button>

                <button
                  type="button"
                  disabled={testingAi}
                  onClick={handleTestAiConnection}
                  className="rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50 cursor-pointer font-mono"
                >
                  {testingAi ? 'Đang Thử...' : 'Thử Prompt AI'}
                </button>
              </div>
            </div>

            {aiTestMsg && (
              <div className={`p-3 rounded-xl border text-xs font-mono ${
                aiTestMsg.startsWith('Kết nối')
                  ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                  : 'border-rose-500/40 bg-rose-950/30 text-rose-300'
              }`}>
                {aiTestMsg}
              </div>
            )}

            {/* Keys Table */}
            <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#02050e]">
              <table className="w-full text-left text-xs font-mono">
                <thead className="border-b border-white/10 bg-white/[0.02] text-slate-400 text-[11px] uppercase">
                  <tr>
                    <th className="p-3">Mã Định Danh Key</th>
                    <th className="p-3">Trạng Thái Live</th>
                    <th className="p-3">Độ Trễ (Latency)</th>
                    <th className="p-3">Số Lần Đã Dùng</th>
                    <th className="p-3 text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {geminiPool.map((k: any) => {
                    const pingInfo = keyPingResults[k.id];

                    return (
                      <tr key={k.id} className="hover:bg-white/[0.02] transition">
                        <td className="p-3">
                          <div className="font-bold text-white">{k.key_masked || k.id}</div>
                          <div className="text-[10px] text-slate-500">ID: {k.id}</div>
                        </td>
                        <td className="p-3">
                          {pingInfo ? (
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-bold text-[10px] ${
                              pingInfo.ok
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                                : pingInfo.status === 'rate_limited'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-400/40'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${pingInfo.ok ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                              {pingInfo.message || (pingInfo.ok ? 'Hoạt Động' : 'Lỗi')}
                            </span>
                          ) : (
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-bold text-[10px] ${
                              k.is_active
                                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/30'
                                : 'bg-slate-700/50 text-slate-400'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${k.is_active ? 'bg-cyan-400' : 'bg-slate-500'}`} />
                              {k.is_active ? 'Sẵn Sàng (Chờ Ping)' : 'Đã Tắt'}
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          {pingInfo?.latency_ms ? (
                            <span className="text-emerald-300 font-bold">{pingInfo.latency_ms} ms</span>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>
                        <td className="p-3 text-slate-300">
                          {k.calls_count || 0} lần
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handlePingSingleKey(k.id)}
                              className="px-2 py-1 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/25 text-[10px] cursor-pointer"
                            >
                              Ping
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleGeminiKey(k.id)}
                              className={`px-2 py-1 rounded text-[10px] cursor-pointer ${
                                k.is_active
                                  ? 'border border-amber-400/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                                  : 'border border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                              }`}
                            >
                              {k.is_active ? 'Tắt' : 'Bật'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteGeminiKey(k.id)}
                              className="px-2 py-1 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 text-[10px] cursor-pointer"
                            >
                              Xóa
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Form Thêm Key Mới */}
            <div className="pt-2">
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                NẠP THÊM GEMINI API KEY VÀO POOL (Dán 1 hoặc nhiều key, cách nhau bằng dấu phẩy hoặc xuống dòng)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKeysText}
                  onChange={(e) => setNewKeysText(e.target.value)}
                  placeholder="AIzaSy..., AQ.Ab8..."
                  className="flex-1 rounded-xl border border-white/10 bg-[#020510] px-3.5 py-2.5 text-xs text-white font-mono placeholder-slate-600 focus:border-amber-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveGeminiKeys}
                  className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-5 py-2.5 text-xs font-bold text-white hover:from-amber-400 hover:to-orange-500 cursor-pointer shadow-lg shadow-amber-500/20 whitespace-nowrap font-mono"
                >
                  + Lưu Vào Pool
                </button>
              </div>
            </div>
          </div>

          {/* Provider AI Nâng Cao */}
          <div className="quant-panel p-6 space-y-4 border border-white/10 bg-[#040816]">
            <div className="border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white">
                Cấu Hình Provider AI Nâng Cao (Gemini / OpenAI / DeepSeek / OpenRouter)
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Cho phép kết nối linh hoạt các cụm mô hình AI độc lập để thực hiện bóc tách chiến lược và phân tích vĩ mô.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">Nhà Cung Cấp (Provider)</label>
                <select
                  value={aiSettings.primary_provider || 'gemini_pool'}
                  onChange={(e) => setAiSettings({ ...aiSettings, primary_provider: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-[#020510] px-3 py-2 text-xs text-white"
                >
                  <option value="gemini_pool">Google Gemini Pool (Khuyên Dùng)</option>
                  <option value="openai">OpenAI (GPT-4o / GPT-4.1 Mini)</option>
                  <option value="deepseek">DeepSeek (V3 / R1 Reasoner)</option>
                  <option value="openrouter">OpenRouter Multi-Model</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">Tên Model</label>
                <input
                  type="text"
                  value={aiSettings.model_name || ''}
                  onChange={(e) => setAiSettings({ ...aiSettings, model_name: e.target.value })}
                  placeholder="gemini-3-flash-preview"
                  className="w-full rounded-xl border border-white/10 bg-[#020510] px-3 py-2 text-xs text-white font-mono"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleSaveAiSettings}
                  className="w-full rounded-xl border border-cyan-400/40 bg-cyan-500/15 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500/25 cursor-pointer font-mono"
                >
                  Lưu Cấu Hình Provider
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* PHÂN HỆ 3: LỘ TRÌNH TIẾN HÓA & ĐỐI SOÁT TÍN HIỆU                           */}
      {/* ========================================================================= */}
      {subTab === 'maturity' && (
        <div className="space-y-6">
          {/* 3-Stage Maturity Progress Bar */}
          <div className="quant-panel p-6 space-y-5 border border-white/10 bg-[#040816]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400">
                  Lộ Trình Trưởng Thành 3 Chặng Của AI ZUPIRUS
                </div>
                <h3 className="mt-1 text-lg font-extrabold text-white">
                  Giám Sát Quá Trình Học &amp; Tự Tiến Hóa (Tự Động 100%)
                </h3>
              </div>
              <button
                type="button"
                onClick={handleToggleAutoPromote}
                className={`rounded-full px-4 py-1.5 text-xs font-bold transition font-mono cursor-pointer ${
                  evo.stage?.auto_promote
                    ? 'border border-emerald-400/60 bg-emerald-500/20 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                    : 'border border-white/15 bg-white/5 text-slate-400'
                }`}
              >
                {evo.stage?.auto_promote ? '● Tự Động Nâng Cấp: ĐANG BẬT' : '○ Tự Động Nâng Cấp: ĐÃ TẮT'}
              </button>
            </div>

            {/* Explanation Note for user transparency */}
            <div className="rounded-xl border border-white/10 bg-[#020512] p-4 text-xs text-slate-300 space-y-2 font-mono">
              <div className="flex items-center justify-between text-xs">
                <span>
                  Số mẫu tín hiệu đã đối soát ngầm: <strong className="text-cyan-300 text-sm">{evo.stage?.samples_learned || 0}</strong> / {evo.stage?.target_samples || 500} mẫu
                </span>
                <span className="text-emerald-400 font-bold">{evo.stage?.readiness_pct || 0}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 transition-all duration-500"
                  style={{ width: `${evo.stage?.readiness_pct || 0}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-400 pt-1 leading-relaxed">
                ℹ️ <strong>Giải thích minh bạch</strong>: Con số <strong>{evo.stage?.samples_learned || 0} mẫu</strong> là tổng số lượt tín hiệu kiểm thử ngầm (Shadow Signals &amp; Audit Logs) mà hệ thống đã cào và đối soát qua dữ liệu nến M1 từ luồng dữ liệu chuẩn (TradingView M15/H1, DXY, US10Y). Khi chạm mốc 500 mẫu với tỷ lệ thắng vượt trội, AI sẽ tự động kích hoạt quyền phát lệnh tự chủ 100%.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              {[
                { key: 'EXTERNAL_FEED', title: 'Chặng 1: EXTERNAL_FEED', desc: 'Học từ nguồn chuẩn & cào ngầm nến M1' },
                { key: 'HYBRID', title: 'Chặng 2: HYBRID_AGENT_SCORER', desc: 'AI lọc nhiễu & đúc kết quy luật Hindsight' },
                { key: 'ZUPIRUS_AGENT', title: 'Chặng 3: ZUPIRUS_AGENT', desc: 'AI tự chủ quét nến M15 & phát lệnh 100%' },
              ].map((s) => {
                const isActive = (evo.stage?.active_mode || 'EXTERNAL_FEED') === s.key;
                return (
                  <div
                    key={s.key}
                    className={`rounded-xl border p-4 space-y-1 transition ${
                      isActive
                        ? 'border-cyan-400/70 bg-cyan-950/30 shadow-[0_0_20px_rgba(6,182,212,0.15)] ring-1 ring-cyan-400/40'
                        : 'border-white/10 bg-[#030612]/70 opacity-70'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-white">{s.title}</span>
                      <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-cyan-400 animate-ping' : 'bg-slate-600'}`} />
                    </div>
                    <p className="text-xs text-slate-300">{s.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bảng Chấm Điểm Nguồn Tín Hiệu & Bài Học Hindsight */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Source Grading */}
            <div className="quant-panel p-6 space-y-4 border border-white/10 bg-[#040816]">
              <div className="border-b border-white/10 pb-3">
                <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400">
                  Đối Chiếu Nến M1 Thực Tế
                </div>
                <h3 className="mt-1 text-base font-bold text-white">
                  Nhật Ký Chấm Điểm Nguồn Tín Hiệu ({evo.stage?.samples_learned || 0} đã chấm)
                </h3>
              </div>

              <div className="space-y-2">
                {(evo.sources || []).map((src: any) => (
                  <div
                    key={src.id}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-[#020510] p-3 text-xs font-mono"
                  >
                    <div>
                      <div className="font-bold text-white">{src.name}</div>
                      <div className="text-[10px] text-slate-400">
                        {src.status === 'RUNNING' ? 'Đang chạy thật' : 'Đang học ngầm (M1)'} · {src.evaluated_signals} đã chấm
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold ${src.win_rate_pct >= 50 ? 'text-emerald-400' : 'text-slate-300'}`}>
                        WR {src.win_rate_pct}%
                      </div>
                      <div className="text-[10px] text-slate-400">
                        PF {src.profit_factor} · Điểm {src.trust_score}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Hindsight Lessons */}
            <div className="quant-panel p-6 space-y-4 border border-white/10 bg-[#040816]">
              <div className="border-b border-white/10 pb-3">
                <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400">
                  Hindsight &amp; Walk-Forward OOS
                </div>
                <h3 className="mt-1 text-base font-bold text-white">
                  Bài Học Phòng Tránh Rủi Ro &amp; Kiểm Định WFO
                </h3>
              </div>

              <div className="space-y-2">
                {(evo.hindsight_lessons || []).slice(0, 5).map((l: any, idx: number) => (
                  <div
                    key={l.id || idx}
                    className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-200/90 leading-relaxed font-mono"
                  >
                    {l.content}
                  </div>
                ))}
                {(!evo.hindsight_lessons || evo.hindsight_lessons.length === 0) && (
                  <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-slate-400 text-xs">
                    Chưa có bài học Hindsight nào mới. Hệ thống sẽ tự tổng hợp khi các lệnh đóng PnL.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Công Cụ Walk-Forward & Test Signals */}
          <div className="quant-panel p-6 space-y-4 border border-white/10 bg-[#040816]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400">
                  Thử Nghiệm &amp; Kiểm Định Hệ Thống
                </div>
                <h3 className="mt-1 text-base font-bold text-white">
                  Chạy Walk-Forward Research, Đồng Bộ News Shield &amp; Test Ingest
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await api.post('/api/admin/research');
                      setMsg('Đã kích hoạt chạy kiểm định WFO Research.');
                      await loadAll();
                    } catch (e: any) {
                      setMsg(`Lỗi WFO: ${e.message}`);
                    }
                  }}
                  className="rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/25 cursor-pointer font-mono"
                >
                  + Chạy WFO Research
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const d = await api.post('/api/admin/news/sync');
                      setMsg(`Đã đồng bộ News Shield (${d?.added ?? d?.synced ?? d?.count ?? 'OK'}).`);
                    } catch (e: any) {
                      setMsg(`Lỗi News Sync: ${e.message}`);
                    }
                  }}
                  className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 cursor-pointer font-mono"
                >
                  Đồng bộ News Shield
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
