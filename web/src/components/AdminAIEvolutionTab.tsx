import React, { useCallback, useEffect, useState } from 'react';
import { ToastNotification } from './ToastNotification.tsx';

export const AdminAIEvolutionTab: React.FC = () => {
  const [evo, setEvo] = useState<any>({
    stage: { active_mode: 'EXTERNAL_FEED', auto_promote: false, samples_learned: 0, target_samples: 500, readiness_pct: 0 },
    shadow_summary: { total_evaluated: 0, overall_win_rate_pct: 0, sources: [] },
    hindsight_lessons: [],
    wfo_candidates: [],
    skills_builtin: [],
    skills_learned: [],
  });
  const [geminiPool, setGeminiPool] = useState<any[]>([]);
  const [newKeysText, setNewKeysText] = useState('');
  const [aiSettings, setAiSettings] = useState<any>({
    provider: 'GEMINI',
    model: 'gemini-3-flash-preview',
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    api_key_masked: '',
  });
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestMsg, setAiTestMsg] = useState('');
  const [msg, setMsg] = useState('');

  const loadAll = useCallback(async () => {
    try {
      const [eRes, gRes, sRes] = await Promise.all([
        fetch('/api/v1/telemetry/ai-evolution'),
        fetch('/api/admin/gemini/keys'),
        fetch('/api/admin/ai/settings'),
      ]);
      if (eRes.ok) setEvo(await eRes.json());
      if (gRes.ok) {
        const gd = await gRes.json();
        setGeminiPool(gd.keys || []);
      }
      if (sRes.ok) {
        const sd = await sRes.json();
        setAiSettings((prev: any) => {
          // Only hydrate editable settings on first load so 10s polling doesn't clobber unsaved edits
          if (prev._hydrated) return prev;
          return { ...prev, ...(sd.settings || sd), api_key: '', _hydrated: true };
        });
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
    const res = await fetch('/api/admin/sources/auto-promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({ enabled: nextVal }),
    });
    if (res.ok) {
      const j = await res.json();
      setMsg(j.message || 'Đã cập nhật chế độ tự tiến hóa.');
      await loadAll();
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
      const res = await fetch('/api/admin/gemini/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ key: k }),
      });
      if (res.ok) addedCount++;
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
    const res = await fetch(`/api/admin/gemini/keys/${encodeURIComponent(kid)}/toggle`, {
      method: 'PUT',
      headers: { 'X-Zupirus': '1' },
    });
    if (res.ok) await loadAll();
  };

  const handleDeleteGeminiKey = async (kid: string) => {
    const res = await fetch(`/api/admin/gemini/keys/${encodeURIComponent(kid)}`, {
      method: 'DELETE',
      headers: { 'X-Zupirus': '1' },
    });
    if (res.ok) await loadAll();
  };

  const handleSaveAiSettings = async () => {
    const res = await fetch('/api/admin/ai/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify(aiSettings),
    });
    if (res.ok) {
      setMsg('Đã lưu cấu hình Provider AI nâng cao.');
      await loadAll();
    }
  };

  const handleTestAiConnection = async () => {
    setTestingAi(true);
    setAiTestMsg('');
    try {
      const res = await fetch('/api/admin/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ prompt: 'Kiểm tra kết nối AI Swarm ZUPIRUS.' }),
      });
      const d = await res.json();
      setAiTestMsg(res.ok ? `Kết nối thành công (${d.model || 'Gemini'} • ${d.latency_ms || 0}ms)` : `Lỗi: ${d.detail || d.error}`);
    } finally {
      setTestingAi(false);
    }
  };

  const activeMode = String(evo.stage?.active_mode || 'EXTERNAL_FEED').toUpperCase();
  const stages = [
    { key: 'EXTERNAL_FEED', title: 'Chặng 1: EXTERNAL_FEED', desc: 'Học từ nguồn chuẩn & cào ngầm nến M1' },
    { key: 'HYBRID', title: 'Chặng 2: HYBRID_AGENT_SCORER', desc: 'AI lọc nhiễu & đúc kết quy luật Hindsight' },
    { key: 'ZUPIRUS_AGENT', title: 'Chặng 3: ZUPIRUS_AGENT', desc: 'AI tự chủ quét nến M15 & phát lệnh 100%' },
  ];

  return (
    <div className="space-y-6">
      <ToastNotification message={msg || null} type="info" onClose={() => setMsg('')} />

      {/* 1. 3-Stage Maturity Progress Bar */}
      <div className="quant-panel p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400">
              Giám Sát Quá Trình Học &amp; Tiến Hóa (Tự Động 100%)
            </div>
            <h2 className="mt-1 text-lg font-extrabold text-white">
              Lộ Trình Trưởng Thành 3 Chặng Của AI
            </h2>
          </div>

          <button
            type="button"
            onClick={handleToggleAutoPromote}
            className={`rounded-xl px-4 py-2.5 text-xs font-bold transition cursor-pointer ${
              evo.stage?.auto_promote
                ? 'border border-emerald-400/40 bg-emerald-500/20 text-emerald-300'
                : 'border border-white/10 bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {evo.stage?.auto_promote ? 'Tự động nâng cấp 100%: ĐANG BẬT' : 'Tự động nâng cấp 100%: ĐANG TẮT'}
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300">
              Số mẫu đã học: <strong className="font-mono text-cyan-300">{evo.stage?.samples_learned || 0}</strong> /{' '}
              <span className="font-mono text-slate-400">{evo.stage?.target_samples || 500}</span> mẫu
            </span>
            <span className="font-mono font-bold text-emerald-300">{evo.stage?.readiness_pct || 0}%</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
              style={{ width: `${Math.min(100, Number(evo.stage?.readiness_pct || 0))}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {stages.map((st) => {
            const isCurrent = activeMode === st.key || (st.key === 'HYBRID' && activeMode === 'HYBRID_AGENT_SCORER');
            return (
              <div
                key={st.key}
                className={`rounded-2xl border p-4 ${
                  isCurrent
                    ? 'border-cyan-400/50 bg-cyan-500/15 shadow-[0_0_25px_rgba(6,182,212,0.15)]'
                    : 'border-white/10 bg-[#040710]/60 opacity-75'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-extrabold text-cyan-300">{st.title}</span>
                  <span className={`h-2.5 w-2.5 rounded-full ${isCurrent ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                </div>
                <p className="mt-2 text-xs text-slate-300">{st.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. AI Learning Journal: Shadow M1 Grading + Hindsight Lessons + Walk-Forward */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Shadow M1 Sources Win-Rate */}
        <div className="quant-panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400">
                Đối Chiếu Nến M1 Thực Tế
              </div>
              <h3 className="text-base font-bold text-white">
                Nhật Ký Chấm Điểm Nguồn Tín Hiệu ({evo.shadow_summary?.total_evaluated || 0} đã chấm
                {Number(evo.shadow_summary?.total_open || 0) > 0 ? ` • ${evo.shadow_summary.total_open} đang mở` : ''})
              </h3>
            </div>
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 font-mono text-xs font-bold text-emerald-300">
              Win Rate chung: {evo.shadow_summary?.overall_win_rate_pct || 0}%
            </span>
          </div>

          <div className="space-y-2.5">
            {(evo.shadow_summary?.sources || []).length === 0 ? (
              <div className="text-xs text-slate-400">Chưa có nguồn tín hiệu nào được ghi nhận.</div>
            ) : (
              evo.shadow_summary.sources.map((src: any) => (
                <div
                  key={src.id}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-[#040710]/65 px-4 py-3 text-xs"
                >
                  <div>
                    <div className="font-bold text-white">{src.name}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {src.status === 'ACTIVE_LIVE' ? 'Đang chạy thật' : src.status === 'DEMOTED' ? 'Đã hạ cấp' : 'Đang học ngầm (M1)'} • {src.evaluated_signals} đã chấm
                      {Number(src.open_signals || 0) > 0 ? ` • ${src.open_signals} đang mở` : ''}
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="font-bold text-emerald-300">WR {src.win_rate_pct}%</div>
                    <div className="text-[11px] text-cyan-300">PF {src.profit_factor} • Điểm {src.trust_score}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Hindsight Risk Lessons & Walk-Forward Validation */}
        <div className="quant-panel p-6 space-y-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400">
              Hindsight &amp; Walk-Forward OOS
            </div>
            <h3 className="text-base font-bold text-white">Bài Học Phòng Tránh Rủi Ro &amp; Kiểm Định</h3>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase text-slate-400">Bài học mới từ Hindsight</div>
            {(evo.hindsight_lessons || []).length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#040710]/60 p-3 text-xs text-slate-400">
                AI đang tiếp tục tích lũy mẫu giao dịch để đúc kết quy luật Hindsight.
              </div>
            ) : (
              evo.hindsight_lessons.slice(0, 4).map((hl: any) => (
                <div key={hl.id} className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3.5 py-2.5 text-xs text-slate-200">
                  <span className="mr-2 font-mono text-[10px] font-bold text-amber-300">[{hl.category}]</span>
                  {hl.content}
                </div>
              ))
            )}
          </div>

          <div className="space-y-2 pt-2">
            <div className="text-[11px] font-bold uppercase text-slate-400">Kết quả kiểm định Walk-Forward</div>
            {(evo.wfo_candidates || []).length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#040710]/60 p-3 text-xs text-slate-400">
                Chưa có ứng viên Walk-Forward nào.
              </div>
            ) : (
              evo.wfo_candidates.slice(0, 4).map((wc: any) => (
                <div
                  key={wc.id}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-[#040710]/65 px-3.5 py-2.5 text-xs"
                >
                  <div>
                    <div className="font-bold text-white">{wc.name}</div>
                    <div className="text-[11px] text-slate-400">{wc.status} • {wc.sample_size} mẫu</div>
                  </div>
                  <div className="text-right font-mono">
                    <span className="text-emerald-300 font-bold">WR {wc.win_rate_pct}%</span> •{' '}
                    <span className="text-cyan-300">PF {wc.profit_factor}</span> •{' '}
                    <span className="text-rose-300">DD {wc.max_drawdown_pct}%</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 3. Skill Upgrade History (5 Built-in vs Self-Learned Skills) */}
      <div className="quant-panel p-6 space-y-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-emerald-400">
            Lịch Sử Nâng Cấp Kỹ Năng AI
          </div>
          <h3 className="mt-1 text-base font-bold text-white">
            Phân Biệt 5 Kỹ Năng Gốc &amp; Kỹ Năng AI Tự Đúc Kết
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-2.5">
            <div className="text-xs font-bold text-cyan-300">
              5 Kỹ Năng Gốc Hệ Thống ({(evo.skills_builtin || []).length})
            </div>
            {(evo.skills_builtin || []).map((sk: any) => (
              <div key={sk.skill_id} className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-3.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">{sk.name}</span>
                  <span className="font-mono text-[11px] text-cyan-300">Đã dùng: {sk.usage_count} lần</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">{sk.description}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2.5">
            <div className="text-xs font-bold text-emerald-300">
              Kỹ Năng Mới Do AI Tự Đúc Kết &amp; Tự Kích Hoạt ({(evo.skills_learned || []).length})
            </div>
            {(evo.skills_learned || []).length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#040710]/60 p-4 text-xs text-slate-400">
                AI chưa tự sinh kỹ năng mới. Khi Hindsight tích lũy đủ quy luật lặp lại, kỹ năng mới sẽ tự động xuất hiện tại đây.
              </div>
            ) : (
              evo.skills_learned.map((sk: any) => (
                <div key={sk.skill_id} className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">{sk.name}</span>
                    <span className="font-mono text-[11px] text-emerald-300">
                      {sk.enabled ? 'Tự kích hoạt' : 'Chờ đủ mẫu'} • Đã dùng {sk.usage_count} lần
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-300">Lý do tạo: {sk.trigger_condition}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 4. Gemini API Pool Configuration */}
      <div className="quant-panel p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400">
              Cấu Hình Bộ Não AI
            </div>
            <h3 className="text-base font-bold text-white">Google Gemini API Key Pool ({geminiPool.length} Keys)</h3>
          </div>
          <button
            type="button"
            disabled={testingAi}
            onClick={handleTestAiConnection}
            className="rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500/25 cursor-pointer"
          >
            {testingAi ? 'Đang kiểm tra...' : 'Kiểm Tra Kết Nối AI'}
          </button>
        </div>

        {aiTestMsg && <div className="rounded-xl border border-white/10 bg-[#040710]/70 px-4 py-2 text-xs text-cyan-300">{aiTestMsg}</div>}

        <div className="flex flex-wrap gap-2">
          {geminiPool.map((k: any) => (
            <div
              key={k.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1 font-mono text-[11px] ${
                k.status === 'active' && k.is_active
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}
            >
              <span>{k.key_masked || k.masked_key || 'AIza***'} ({k.is_active ? k.status : 'disabled'})</span>
              <button
                type="button"
                onClick={() => handleToggleGeminiKey(k.id)}
                className="text-[10px] underline hover:text-white cursor-pointer"
              >
                {k.is_active ? 'Tắt' : 'Bật'}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteGeminiKey(k.id)}
                className="text-[10px] text-rose-300 underline hover:text-rose-200 cursor-pointer"
              >
                Xóa
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={newKeysText}
            onChange={(e) => setNewKeysText(e.target.value)}
            placeholder="Dán 1 hoặc nhiều Gemini API Key (cách nhau bằng dấu phẩy)"
            className="flex-1 rounded-xl border border-white/10 bg-[#040710] px-4 py-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSaveGeminiKeys}
            className="rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-amber-400 cursor-pointer"
          >
            Lưu API Key
          </button>
        </div>

        {/* Advanced AI Provider Settings */}
        <div className="mt-4 border-t border-white/10 pt-4 space-y-3">
          <div className="text-xs font-bold text-slate-200">
            Cấu Hình Provider AI Nâng Cao (OpenAI / OpenRouter / DeepSeek / Gemini)
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <select
              value={aiSettings.provider || 'GEMINI'}
              onChange={(e) => setAiSettings({ ...aiSettings, provider: e.target.value })}
              className="rounded-xl border border-white/10 bg-[#040710] px-3 py-2 text-xs text-white"
            >
              <option value="HYBRID">Hybrid (Gemini + OpenAI)</option>
              <option value="GEMINI">Google Gemini Pool</option>
              <option value="OPENAI">OpenAI</option>
              <option value="OPENROUTER">OpenRouter</option>
              <option value="DEEPSEEK">DeepSeek</option>
            </select>
            <input
              type="text"
              value={aiSettings.model || ''}
              onChange={(e) => setAiSettings({ ...aiSettings, model: e.target.value })}
              placeholder="Model (VD: gpt-4o-mini)"
              className="rounded-xl border border-white/10 bg-[#040710] px-3 py-2 text-xs text-white"
            />
            <input
              type="password"
              value={aiSettings.api_key || ''}
              onChange={(e) => setAiSettings({ ...aiSettings, api_key: e.target.value })}
              placeholder={aiSettings.api_key_masked ? `Đã lưu: ${aiSettings.api_key_masked}` : 'API Key riêng (nếu dùng)'}
              className="rounded-xl border border-white/10 bg-[#040710] px-3 py-2 text-xs text-white"
            />
            <button
              type="button"
              onClick={handleSaveAiSettings}
              className="rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500/25 cursor-pointer"
            >
              Lưu Provider
            </button>
          </div>
        </div>
      </div>

      {/* Learned Skills & Research WFO Operations */}
      <div className="quant-panel p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400">
              Quản Trị Kỹ Năng Tự Học &amp; Kiểm Định WFO
            </div>
            <h3 className="mt-1 text-base font-bold text-white">
              Bật/Tắt Agent Skills, Chạy Walk-Forward &amp; Test Ingest Tín Hiệu
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  const r = await fetch('/api/admin/research', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
                  });
                  const d = await r.json().catch(() => ({}));
                  setMsg(r.ok ? 'Đã kích hoạt chạy kiểm định WFO Research.' : `Lỗi WFO: ${d.detail || r.status}`);
                  await loadAll();
                } catch (e: any) {
                  setMsg(`Lỗi mạng: ${e.message}`);
                }
              }}
              className="rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/25 cursor-pointer"
            >
              + Chạy WFO Research
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const r = await fetch('/api/admin/news/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
                  });
                  const d = await r.json().catch(() => ({}));
                  setMsg(r.ok ? `Đã đồng bộ News Shield (${d.added ?? d.synced ?? d.count ?? 'OK'}).` : `Lỗi News Sync: ${d.detail || r.status}`);
                } catch (e: any) {
                  setMsg(`Lỗi mạng: ${e.message}`);
                }
              }}
              className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 cursor-pointer"
            >
              Đồng bộ News Shield
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const r = await fetch('/api/v1/signals/test-ingest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
                    body: JSON.stringify({ symbol: 'XAUUSD', action: 'BUY', source: 'ADMIN_BENCH' }),
                  });
                  const d = await r.json().catch(() => ({}));
                  setMsg(r.ok ? `Test Ingest: ${d.status || 'OK'} (${d.reject_reason || d.reason || '4-Layer Checked'})` : `Lỗi Test Ingest: ${d.detail || r.status}`);
                } catch (e: any) {
                  setMsg(`Lỗi mạng: ${e.message}`);
                }
              }}
              className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/25 cursor-pointer"
            >
              Test Ingest 4-Layer
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[...(evo.skills_builtin || []), ...(evo.skills_learned || [])].map((sk: any) => (
            <div
              key={sk.skill_id}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#040710]/70 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="truncate font-mono font-bold text-slate-200">{sk.name || sk.skill_id}</div>
                <div className="text-[10px] text-slate-400">
                  {sk.is_builtin ? 'Builtin' : 'Learned'} · Dùng {sk.usage_count || 0} lần
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await fetch(`/api/admin/skills/${encodeURIComponent(sk.skill_id)}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
                      body: JSON.stringify({ enabled: !sk.enabled }),
                    });
                    if (r.ok) {
                      setMsg(`Đã ${sk.enabled ? 'tắt' : 'bật'} skill ${sk.skill_id}.`);
                      await loadAll();
                    }
                  } catch (e: any) {
                    setMsg(`Lỗi toggle skill: ${e.message}`);
                  }
                }}
                className={`rounded-lg px-2.5 py-1 text-[10px] font-bold cursor-pointer ${
                  sk.enabled
                    ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : 'border border-slate-600 bg-slate-800 text-slate-400'
                }`}
              >
                {sk.enabled ? 'ACTIVE' : 'DISABLED'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
