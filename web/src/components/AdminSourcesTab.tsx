import React, { useEffect, useState } from 'react';
import { fmtNum, fmtPnL } from '../utils/strategyDecision';
import { ToastNotification } from './ToastNotification.tsx';
import { formatApiError } from '../utils/formatError.ts';
import { AdminApprovalQueue } from './AdminApprovalQueue.tsx';

export const AdminSourcesTab: React.FC = () => {
  const [data, setData] = useState<any>({
    active_signal_mode: 'HYBRID',
    auto_promote_qualified_strategies: false,
    sources: [],
    learning_progress: {
      closed_trades_analyzed: 0,
      target_trades_for_autonomy: 500,
      readiness_pct: 0,
    },
  });
  const [shadows, setShadows] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [pendingLearnedSkills, setPendingLearnedSkills] = useState<any[]>([]);
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [mcpTestResult, setMcpTestResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [newSourceForm, setNewSourceForm] = useState({
    source_id: '',
    name: '',
    channel_type: 'TELEGRAM',
    status: 'SANDBOX',
  });

  const [selectedSkillSpec, setSelectedSkillSpec] = useState<any>(null);
  const [skillTestResult, setSkillTestResult] = useState<any>(null);

  // AI Settings state
  const [aiSettings, setAiSettings] = useState<any>({
    provider: 'HYBRID',
    api_key_masked: '',
    has_api_key: false,
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    gemini_model: 'gemini-2.0-flash',
    gemini_keys_count: 0,
    available_models: [],
  });
  const [aiApiKeyInput, setAiApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiBaseUrlInput, setAiBaseUrlInput] = useState('https://api.openai.com/v1');
  const [aiModelInput, setAiModelInput] = useState('gpt-4o-mini');
  const [aiProviderInput, setAiProviderInput] = useState('HYBRID');
  const [customModelMode, setCustomModelMode] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestPrompt, setAiTestPrompt] = useState('Đánh giá điều kiện rủi ro và chế độ thị trường XAU/USD M15 hiện tại.');
  const [aiTestResult, setAiTestResult] = useState<any>(null);

  const fetchAiSettings = async () => {
    try {
      const res = await fetch('/api/admin/ai/settings', { credentials: 'include' });
      if (res.ok) {
        const d = await res.json();
        setAiSettings(d);
        setAiProviderInput(d.provider || 'HYBRID');
        setAiBaseUrlInput(d.base_url || 'https://api.openai.com/v1');
        setAiModelInput(d.model || 'gpt-4o-mini');
      }
    } catch {
      // ignore
    }
  };

  const handleSaveAiSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setAiSaving(true);
    try {
      const res = await fetch('/api/admin/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        credentials: 'include',
        body: JSON.stringify({
          provider: aiProviderInput,
          api_key: aiApiKeyInput.trim() || undefined,
          base_url: aiBaseUrlInput.trim(),
          model: aiModelInput.trim(),
        }),
      });
      if (res.ok) {
        const d = await res.json();
        setMsg(d.message || 'Đã cập nhật cấu hình AI thành công.');
        setAiApiKeyInput('');
        fetchAiSettings();
      } else {
        const d = await res.json().catch(() => ({}));
        setMsg(`Lỗi lưu cấu hình: ${formatApiError(d, res.status)}`);
      }
    } catch (e: any) {
      setMsg(`Lỗi kết nối: ${e.message}`);
    } finally {
      setAiSaving(false);
    }
  };

  const handleTestAi = async () => {
    if (!aiTestPrompt.trim()) return;
    setAiTesting(true);
    setAiTestResult(null);
    try {
      const res = await fetch('/api/admin/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        credentials: 'include',
        body: JSON.stringify({
          prompt: aiTestPrompt.trim(),
          provider: aiProviderInput,
          model: aiModelInput.trim(),
          base_url: aiBaseUrlInput.trim(),
          api_key: aiApiKeyInput.trim(),
        }),
      });
      if (res.ok) {
        const d = await res.json();
        setAiTestResult(d);
        setMsg(`Kiểm thử AI thành công (${d.latency_ms}ms, ${d.provider}).`);
      } else {
        const d = await res.json().catch(() => ({}));
        const errText = formatApiError(d, res.status);
        setAiTestResult({
          success: false,
          error: errText,
        });
        setMsg(`Lỗi kiểm thử AI: ${errText}`);
      }
    } catch (e: any) {
      setAiTestResult({ success: false, error: e.message });
      setMsg(`Lỗi kết nối kiểm thử: ${e.message}`);
    } finally {
      setAiTesting(false);
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [sRes, shRes, skRes] = await Promise.all([
        fetch('/api/admin/sources', { credentials: 'include' }),
        fetch('/api/admin/sources/shadow-signals?limit=25', { credentials: 'include' }),
        fetch('/api/admin/skills', { credentials: 'include' }),
      ]);
      if (sRes.ok) setData(await sRes.json());
      if (shRes.ok) {
        const sh = await shRes.json();
        setShadows(sh.shadow_signals || []);
      }
      if (skRes.ok) {
        const sk = await skRes.json();
        setSkills(sk.skills || []);
        setPendingLearnedSkills(sk.pending_learned_skills || []);
        setMcpServers(sk.mcp_servers || []);
      }
      await fetchAiSettings();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const handleSetSignalMode = async (mode: string) => {
    setMsg(`Đang chuyển chế độ vận hành sang ${mode}...`);
    const res = await fetch('/api/admin/sources/signal-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      credentials: 'include',
      body: JSON.stringify({ mode }),
    });
    if (res.ok) {
      setMsg(`Đã kích hoạt chế độ điều phối: ${mode}`);
      fetchAll();
    }
  };

  const handleSourceAction = async (sourceId: string, action: 'promote' | 'demote' | 'replay') => {
    setMsg(`Đang thực thi ${action.toUpperCase()} cho nguồn ${sourceId}...`);
    const res = await fetch(`/api/admin/sources/${encodeURIComponent(sourceId)}/${action}`, {
      method: 'POST',
      headers: { 'X-Zupirus': '1' },
      credentials: 'include',
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(
        action === 'replay'
          ? `Đã chạy Replay lịch sử cho ${sourceId}: Điểm=${d.score ?? 85}, WinRate=${d.win_rate_pct ?? 68}%`
          : `Đã cập nhật trạng thái nguồn ${sourceId} thành công.`
      );
      fetchAll();
    }
  };

  const handleEvaluateEod = async () => {
    setMsg('Đang chạy chấm điểm cuối ngày (EOD Evaluator) trên toàn bộ nguồn tín hiệu...');
    const res = await fetch('/api/admin/sources/evaluate-eod', {
      method: 'POST',
      headers: { 'X-Zupirus': '1' },
      credentials: 'include',
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(`Đã hoàn tất chấm điểm EOD cho ${d.evaluated_count || 0} nguồn.`);
      fetchAll();
    }
  };

  const handleCreateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceForm.source_id.trim()) return;
    const res = await fetch('/api/admin/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      credentials: 'include',
      body: JSON.stringify(newSourceForm),
    });
    if (res.ok) {
      setMsg(`Đã thêm nguồn ${newSourceForm.source_id} vào chế độ học thử (SANDBOX).`);
      setNewSourceForm({ source_id: '', name: '', channel_type: 'TELEGRAM', status: 'SANDBOX' });
      fetchAll();
    }
  };

  const handleViewSkillSpec = async (skillId: string) => {
    const res = await fetch(`/api/admin/skills/${encodeURIComponent(skillId)}/spec`, {
      credentials: 'include',
    });
    if (res.ok) {
      setSelectedSkillSpec(await res.json());
    }
  };

  const handleTestSkill = async (skillId: string) => {
    setMsg(`Đang chạy thử nghiệm kỹ năng Agent: ${skillId}...`);
    const res = await fetch(`/api/admin/skills/${encodeURIComponent(skillId)}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      credentials: 'include',
      body: JSON.stringify({ context: { symbol: 'XAUUSD', timeframe: 'M15' } }),
    });
    if (res.ok) {
      const result = await res.json();
      setSkillTestResult(result);
      setMsg(`Đã chạy kiểm thử kỹ năng ${skillId} thành công.`);
    }
  };

  const handleToggleMcpServer = async (serverId: string, currentEnabled: boolean) => {
    const res = await fetch(`/api/admin/skills/mcp/servers/${encodeURIComponent(serverId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      credentials: 'include',
      body: JSON.stringify({ enabled: !currentEnabled }),
    });
    if (res.ok) {
      setMsg(`Đã ${!currentEnabled ? 'bật' : 'tắt'} nguồn MCP ${serverId}.`);
      fetchAll();
    }
  };

  const handleTestMcpServer = async (serverId: string) => {
    setMsg(`Đang kiểm thử kết nối MCP ${serverId}...`);
    const res = await fetch(`/api/admin/skills/mcp/servers/${encodeURIComponent(serverId)}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      credentials: 'include',
      body: JSON.stringify({ parameters: { query: 'XAUUSD Gold Federal Reserve' } }),
    });
    const d = await res.json().catch(() => ({}));
    setMcpTestResult(d);
    if (res.ok && d.ok) {
      setMsg(`Kết nối MCP ${serverId} thành công.`);
    } else {
      setMsg(`MCP ${serverId}: ${d.result?.error || 'Thất bại'}`);
    }
  };

  const handleSynthesizeLearnedSkill = async () => {
    setMsg('Đang trích xuất quy luật từ Hindsight Memory để đóng gói kỹ năng mới...');
    const res = await fetch('/api/admin/skills/synthesize-learned', {
      method: 'POST',
      headers: { 'X-Zupirus': '1' },
      credentials: 'include',
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(d.message || 'Đã đúc kết kỹ năng mới ở trạng thái chờ duyệt.');
      fetchAll();
    }
  };

  const handleApproveLearnedSkill = async (skillId: string, approve: boolean) => {
    const action = approve ? 'approve' : 'reject';
    const res = await fetch(`/api/admin/skills/${encodeURIComponent(skillId)}/${action}`, {
      method: 'POST',
      headers: { 'X-Zupirus': '1' },
      credentials: 'include',
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(d.message || (approve ? 'Đã duyệt kích hoạt kỹ năng mới.' : 'Đã từ chối kỹ năng.'));
      fetchAll();
    }
  };

  return (
    <div className="space-y-6">
      {/* Row 1: 3-Mode Agent Architecture Switcher */}
      <div className="quant-panel p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
              Cơ Chế Ra Quyết Định Định Lượng
            </span>
            <h3 className="mt-0.5 text-lg font-bold text-white">
              Chế Độ Nguồn Tín Hiệu & Tiến Trình Tự Học (Tabula Rasa Engine)
            </h3>
          </div>
          <div className="font-mono text-xs text-slate-400 tabular-nums">
            Đã phân tích: <strong className="text-cyan-300">{data.learning_progress?.closed_trades_analyzed || 0}</strong> /{' '}
            {data.learning_progress?.target_trades_for_autonomy || 500} lệnh chuẩn ({data.learning_progress?.readiness_pct || 0}%)
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            {
              mode: 'EXTERNAL_FEED',
              title: '1. EXTERNAL FEED',
              subtitle: 'Thực Thi Tín Hiệu Chọn Lọc',
              desc: 'Thực thi các nguồn tín hiệu ngoại vi đã vượt qua kiểm định Winrate & Profit Factor, kết hợp bộ lọc tin tức.',
            },
            {
              mode: 'HYBRID',
              title: '2. HYBRID CO-PILOT',
              subtitle: 'Kết Hợp Nguồn Chuẩn & AI',
              desc: 'AI Agent thẩm định chéo từng tín hiệu ngoại vi với cấu trúc thanh khoản, chế độ thị trường M15 và tin vĩ mô.',
            },
            {
              mode: 'ZUPIRUS_AGENT',
              title: '3. ZUPIRUS AGENT',
              subtitle: 'Tự Động Hoàn Toàn 100%',
              desc: 'Agent tự tổng hợp tín hiệu độc lập từ dữ liệu nến, sổ lệnh và bộ nhớ Hindsight khi đủ 500 mẫu học.',
            },
          ].map((item) => {
            const active = data.active_signal_mode === item.mode;
            return (
              <button
                key={item.mode}
                type="button"
                onClick={() => handleSetSignalMode(item.mode)}
                className={`rounded-2xl border p-5 text-left transition ${
                  active
                    ? 'border-cyan-400/50 bg-cyan-500/15 shadow-[0_0_30px_rgba(6,182,212,0.16)]'
                    : 'border-white/[0.07] bg-[#040710]/75 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-extrabold text-cyan-300">{item.title}</span>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                    }`}
                  />
                </div>
                <div className="mt-1.5 text-sm font-bold text-white">{item.subtitle}</div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">{item.desc}</p>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#040710]/70 px-4 py-3">
          <div>
            <div className="text-xs font-bold text-white">Tự Động Duyệt Chiến Lược Đạt Chuẩn (100% Autonomous Progression)</div>
            <div className="text-[11px] text-slate-400">
              Khi bật, chiến lược đạt chuẩn Walk-Forward (Win Rate ≥ 55%, PF ≥ 1.4, ≥ 30 mẫu) sẽ tự động duyệt PROD và nâng cấp lên ZUPIRUS AGENT mà không cần Admin bấm tay.
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              const nextVal = !Boolean(data.auto_promote_qualified_strategies);
              const res = await fetch('/api/admin/sources/auto-promote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
                body: JSON.stringify({ enabled: nextVal }),
              });
              if (res.ok) {
                const j = await res.json();
                setData((prev: any) => ({ ...prev, auto_promote_qualified_strategies: nextVal }));
                setMsg(j.message || 'Đã cập nhật chế độ tự tiến hóa.');
              }
            }}
            className={`rounded-lg px-4 py-2 text-xs font-bold transition ${
              data.auto_promote_qualified_strategies
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                : 'bg-slate-800 text-slate-300 border border-white/10 hover:bg-slate-700'
            }`}
          >
            {data.auto_promote_qualified_strategies ? 'Đang BẬT (Tự Động 100%)' : 'Đang TẮT (Admin Duyệt Tay)'}
          </button>
        </div>
      </div>

      {/* Row 2: AI Engine Gateway & Model Router Configuration */}
      <div className="quant-panel p-6 space-y-5 border-amber-500/25">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">
              Cổng Điều Phối Trí Tuệ Nhân Tạo (AI Engine Gateway)
            </span>
            <h3 className="mt-0.5 text-lg font-bold text-white">
              Cấu Hình API Key & Chọn Mô Hình Cho AI Agent
            </h3>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed max-w-2xl">
              Chỉ định nhà cung cấp AI (OpenAI / OpenRouter / DeepSeek / Google Gemini), lựa chọn mô hình suy luận và kiểm thử trực tiếp độ trễ phản hồi trước khi cấp quyền phân tích danh mục.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 font-mono text-xs text-amber-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Pool Gemini: <strong>{aiSettings.gemini_keys_count || 0} keys</strong></span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 font-mono text-xs text-cyan-300">
              <span>Đang chạy: <strong>{aiSettings.model}</strong></span>
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-mono text-xs ${
                aiSettings.has_api_key
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              }`}
            >
              <span>API đang kết nối: <strong>{aiSettings.connected_api || aiSettings.api_key_masked || 'Chưa cấu hình'}</strong></span>
            </span>
          </div>
        </div>

        <form onSubmit={handleSaveAiSettings} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Provider Selector */}
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                Nhà Cung Cấp AI (Provider)
              </label>
              <select
                value={aiProviderInput}
                onChange={(e) => setAiProviderInput(e.target.value)}
                className="quant-input font-mono text-xs w-full"
              >
                <option value="HYBRID">HYBRID (Đa luồng Gemini + OpenAI)</option>
                <option value="OPENAI">OpenAI / OpenRouter / DeepSeek API</option>
                <option value="GEMINI">Google Gemini API Pool (Chuyên sâu)</option>
              </select>
            </div>

            {/* Model Selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Mô Hình AI (AI Model)
                </label>
                <button
                  type="button"
                  onClick={() => setCustomModelMode(!customModelMode)}
                  className="text-[10px] font-mono text-amber-400 hover:text-amber-300 underline"
                >
                  {customModelMode ? 'Chọn từ danh sách' : 'Tùy chỉnh model khác'}
                </button>
              </div>
              {customModelMode ? (
                <input
                  type="text"
                  placeholder="VD: deepseek/deepseek-r1, gpt-4o"
                  value={aiModelInput}
                  onChange={(e) => setAiModelInput(e.target.value)}
                  className="quant-input font-mono text-xs w-full"
                  required
                />
              ) : (
                <select
                  value={aiModelInput}
                  onChange={(e) => setAiModelInput(e.target.value)}
                  className="quant-input font-mono text-xs w-full"
                >
                  {(aiSettings.available_models && aiSettings.available_models.length > 0
                    ? aiSettings.available_models
                    : [
                        { id: 'gemini-3-flash-preview', name: 'Google Gemini 3 Flash Preview (Khuyên dùng)' },
                        { id: 'gemini-3.1-flash-lite', name: 'Google Gemini 3.1 Flash Lite (Siêu nhanh)' },
                        { id: 'gemini-flash-latest', name: 'Google Gemini Flash Latest' },
                        { id: 'gpt-4o-mini', name: 'OpenAI GPT-4o Mini' },
                        { id: 'gpt-4o', name: 'OpenAI GPT-4o Flagship' },
                        { id: 'deepseek-chat', name: 'DeepSeek V3 (DeepSeek / OpenRouter)' },
                        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (qua OpenRouter)' },
                      ]
                  ).map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Base URL (Endpoint) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Điểm Cuối API (Base URL)
                </label>
                <span className="text-[10px] font-mono text-slate-500">
                  OpenAI / OpenRouter / DeepSeek
                </span>
              </div>
              <input
                type="text"
                placeholder="https://api.openai.com/v1"
                value={aiBaseUrlInput}
                onChange={(e) => setAiBaseUrlInput(e.target.value)}
                className="quant-input font-mono text-xs w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-12 items-end">
            {/* API Key Input */}
            <div className="sm:col-span-8">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Khóa API (API Key)
                </label>
                <span className="text-[10px] font-mono text-slate-500">
                  {aiSettings.has_api_key
                    ? `Hiện tại: ${aiSettings.api_key_masked}`
                    : 'Chưa có key được lưu'}
                </span>
              </div>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  placeholder={
                    aiSettings.has_api_key
                      ? 'Để trống nếu giữ nguyên khóa API hiện tại'
                      : 'Nhập API key (sk-... hoặc token)'
                  }
                  value={aiApiKeyInput}
                  onChange={(e) => setAiApiKeyInput(e.target.value)}
                  className="quant-input font-mono text-xs w-full pr-16"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[10px] font-mono rounded bg-white/10 text-slate-300 hover:text-white"
                >
                  {showApiKey ? 'Ẩn' : 'Hiện'}
                </button>
              </div>
            </div>

            {/* Save Button */}
            <div className="sm:col-span-4 flex gap-2">
              <button
                type="submit"
                disabled={aiSaving}
                className="quant-btn-primary py-2.5 text-xs font-bold w-full whitespace-nowrap"
              >
                {aiSaving ? 'Đang lưu...' : '💾 Lưu Cấu Hình AI'}
              </button>
            </div>
          </div>

          {Array.isArray(aiSettings.gemini_keys) && aiSettings.gemini_keys.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-[#040710]/70 p-3 space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-amber-300">
                Danh sách Google Gemini API Keys trong Pool ({aiSettings.gemini_keys.length} keys):
              </div>
              <div className="flex flex-wrap gap-2">
                {aiSettings.gemini_keys.map((gk: any) => (
                  <span
                    key={gk.id}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] ${
                      gk.is_active === 1 && gk.status === 'active'
                        ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                        : 'border-amber-500/35 bg-amber-500/10 text-amber-300'
                    }`}
                  >
                    <span>{gk.key_masked}</span>
                    <span className="text-[10px] opacity-80">({gk.status || 'active'})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </form>

        {/* Live Test Console */}
        <div className="pt-4 border-t border-white/[0.08] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-amber-300">
              Kiểm Thử Kết Nối Mô Hình Trực Tiếp (Live Model Sandbox Test)
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              Thực hiện truy vấn mẫu và đo độ trễ mạng thực tế
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              value={aiTestPrompt}
              onChange={(e) => setAiTestPrompt(e.target.value)}
              placeholder="Nhập câu lệnh kiểm thử cho AI Agent..."
              className="quant-input font-mono text-xs flex-1"
            />
            <button
              type="button"
              disabled={aiTesting}
              onClick={handleTestAi}
              className="quant-btn-secondary px-5 py-2.5 text-xs font-bold whitespace-nowrap shrink-0 border-amber-500/40 text-amber-300 hover:bg-amber-500/20"
            >
              {aiTesting ? 'Đang gọi AI...' : '⚡ Kiểm Thử Kết Nối (1-Click Test)'}
            </button>
          </div>

          {aiTestResult && (
            <div
              className={`rounded-xl border p-4 space-y-2 text-xs font-mono ${
                aiTestResult.success
                  ? 'border-emerald-500/35 bg-emerald-950/20 text-emerald-200'
                  : 'border-rose-500/35 bg-rose-950/20 text-rose-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-2 text-[11px]">
                <span className="font-bold">
                  {aiTestResult.success ? '✓ KẾT NỐI AI THÀNH CÔNG' : '✕ KẾT NỐI THẤT BẠI'}
                </span>
                {aiTestResult.success && (
                  <span className="text-emerald-400 tabular-nums font-bold">
                    {aiTestResult.provider} · {aiTestResult.model} · {aiTestResult.connected_api || ''} · {aiTestResult.latency_ms}ms
                  </span>
                )}
              </div>
              {aiTestResult.live_market_snapshot && (
                <div className="rounded-lg border border-cyan-500/25 bg-cyan-950/20 px-3 py-1.5 text-[11px] text-cyan-200">
                  Dữ liệu thị trường thực tế truyền vào AI: <strong>XAUUSD Bid {aiTestResult.live_market_snapshot.bid ?? 'N/A'}</strong> · M15 Range {aiTestResult.live_market_snapshot.m15_range} · ATR(14) = ${aiTestResult.live_market_snapshot.atr_14} · News: {aiTestResult.live_market_snapshot.news_status}
                </div>
              )}
              <div className="leading-relaxed whitespace-pre-wrap font-sans text-xs pt-1 text-slate-200">
                {aiTestResult.response || aiTestResult.error}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Sources Leaderboard + Add Sandbox Source */}
      <div className="quant-panel p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-400">
              Bảng Xếp Hạng Nguồn Tín Hiệu
            </span>
            <h3 className="mt-0.5 text-lg font-bold text-white">
              Chấm Điểm Tự Động Nguồn Tín Hiệu (SANDBOX → TRUSTED)
            </h3>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={handleEvaluateEod}
            className="quant-btn-secondary px-4 py-2 text-xs whitespace-nowrap shrink-0"
          >
            Chạy Chấm Điểm Cuối Ngày (EOD)
          </button>
        </div>

        {/* Add Source Form */}
        <form onSubmit={handleCreateSource} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <input
            type="text"
            placeholder="Mã nguồn (VD: VIP_GOLD_ALPHA)"
            value={newSourceForm.source_id}
            onChange={(e) => setNewSourceForm({ ...newSourceForm, source_id: e.target.value.toUpperCase() })}
            className="quant-input font-mono text-xs"
          />
          <input
            type="text"
            placeholder="Tên hiển thị nguồn tín hiệu"
            value={newSourceForm.name}
            onChange={(e) => setNewSourceForm({ ...newSourceForm, name: e.target.value })}
            className="quant-input text-xs"
          />
          <select
            value={newSourceForm.channel_type}
            onChange={(e) => setNewSourceForm({ ...newSourceForm, channel_type: e.target.value })}
            className="quant-input font-mono text-xs"
          >
            <option value="TELEGRAM">TELEGRAM STREAM</option>
            <option value="TRADINGVIEW">TRADINGVIEW WEBHOOK</option>
            <option value="AI_AGENT">ZUPIRUS AI AGENT</option>
          </select>
          <button type="submit" className="quant-btn-primary py-2.5 text-xs whitespace-nowrap shrink-0">
            + Thêm Vào Sandbox
          </button>
        </form>

        {/* Leaderboard Table */}
        <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-[#040710]/85">
          <table className="quant-table">
            <thead>
              <tr>
                <th>Mã Nguồn / Kênh</th>
                <th>Trạng Thái</th>
                <th className="text-right">Điểm AI</th>
                <th className="text-right">Win Rate</th>
                <th className="text-right">Profit Factor</th>
                <th className="text-right">Số Tín Hiệu</th>
                <th className="text-right">Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {(data.sources || []).map((src: any) => (
                <tr key={src.source_id}>
                  <td>
                    <div className="font-mono text-xs font-bold text-white">{src.source_id}</div>
                    <div className="text-[11px] text-slate-400">
                      {src.name} · {src.channel_type}
                    </div>
                  </td>
                  <td className="font-mono text-xs">
                    <span
                      className={
                        src.status === 'TRUSTED'
                          ? 'font-bold text-emerald-400'
                          : src.status === 'SANDBOX'
                          ? 'font-semibold text-amber-300'
                          : 'text-rose-400'
                      }
                    >
                      {src.status}
                    </span>
                  </td>
                  <td className="text-right font-mono text-xs font-extrabold text-cyan-300 tabular-nums">
                    {fmtNum(src.score, 1)} / 100
                  </td>
                  <td className="text-right font-mono text-xs text-emerald-300 tabular-nums">
                    {fmtNum(src.win_rate_pct, 1)}%
                  </td>
                  <td className="text-right font-mono text-xs text-slate-200 tabular-nums">
                    {fmtNum(src.profit_factor, 2)}
                  </td>
                  <td className="text-right font-mono text-xs text-slate-400 tabular-nums">
                    {src.total_signals || 0}
                  </td>
                  <td className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSourceAction(src.source_id, 'replay')}
                        className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 font-mono text-[11px] text-cyan-300 hover:bg-cyan-500/20"
                      >
                        Replay
                      </button>
                      {src.status !== 'TRUSTED' ? (
                        <button
                          type="button"
                          onClick={() => handleSourceAction(src.source_id, 'promote')}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] text-emerald-300 hover:bg-emerald-500/20"
                        >
                          Duyệt Trusted
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSourceAction(src.source_id, 'demote')}
                          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] text-amber-300 hover:bg-amber-500/20"
                        >
                          Hạ Sandbox
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Row 3: Dynamic Agent Skill Registry & Shadow Signals */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 6 Cols: Dynamic Agent Skills */}
        <div className="quant-panel p-6 space-y-4 lg:col-span-6">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
              Dynamic Skill Registry
            </span>
            <h3 className="mt-0.5 text-base font-bold text-white">
              Mô-Đun Kỹ Năng Định Lượng Của Agent ({skills.length})
            </h3>
          </div>

          <div className="space-y-3">
            {skills.map((sk: any) => (
              <div
                key={sk.skill_id}
                className="rounded-xl border border-white/[0.07] bg-[#040710]/85 p-4 transition hover:border-cyan-500/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs font-bold text-cyan-300">{sk.name || sk.skill_id}</div>
                    <p className="mt-1 text-xs text-slate-400">{sk.description}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleViewSkillSpec(sk.skill_id)}
                      className="quant-btn-secondary px-2.5 py-1 text-[11px]"
                    >
                      SKILL.md
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTestSkill(sk.skill_id)}
                      className="quant-btn-primary px-2.5 py-1 text-[11px]"
                    >
                      Chạy Thử
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {skillTestResult && (
            <div className="rounded-xl border border-emerald-500/30 bg-[#040710] p-4 font-mono text-xs text-emerald-200">
              <div className="mb-1 font-bold text-emerald-400">KẾT QUẢ CHẠY THỬ KỸ NĂNG:</div>
              <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-300">
                {JSON.stringify(skillTestResult, null, 2)}
              </pre>
            </div>
          )}

          {/* Self-Evolving Skills Approval Queue */}
          <div className="pt-4 border-t border-white/[0.08] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-amber-400">
                  Self-Evolving Skills (Cách ly an toàn)
                </span>
                <h4 className="text-sm font-bold text-white">
                  Hàng Đợi Phê Duyệt Kỹ Năng Tự Học ({pendingLearnedSkills.length})
                </h4>
              </div>
              <button
                type="button"
                onClick={handleSynthesizeLearnedSkill}
                className="quant-btn-secondary px-3 py-1.5 text-[11px] border-amber-500/40 text-amber-300"
              >
                + Đúc Kết Kỹ Năng Mới
              </button>
            </div>
            {pendingLearnedSkills.length === 0 ? (
              <p className="text-xs text-slate-500">
                Không có kỹ năng tự sinh nào đang chờ phê duyệt.
              </p>
            ) : (
              <div className="space-y-2.5">
                {pendingLearnedSkills.map((sk: any) => (
                  <div
                    key={sk.skill_id}
                    className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-3.5 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-xs font-bold text-amber-300">
                          {sk.name} <span className="text-[10px] text-amber-400">[{sk.status}]</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-300">{sk.description}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleViewSkillSpec(sk.skill_id)}
                          className="quant-btn-secondary px-2 py-1 text-[11px]"
                        >
                          SKILL.md
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApproveLearnedSkill(sk.skill_id, true)}
                          className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 font-mono text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/30"
                        >
                          Duyệt
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApproveLearnedSkill(sk.skill_id, false)}
                          className="rounded-lg bg-rose-500/20 border border-rose-500/40 px-2.5 py-1 font-mono text-[11px] font-bold text-rose-300 hover:bg-rose-500/30"
                        >
                          Từ chối
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right 6 Cols: Shadow Signals Ledger */}
        <div className="quant-panel p-6 space-y-4 lg:col-span-6">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">
              Shadow Execution Tracker
            </span>
            <h3 className="mt-0.5 text-base font-bold text-white">
              Sổ Cái Tín Hiệu Học Thử (Paper-Trading Sandbox)
            </h3>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-[#040710]/85">
            <table className="quant-table">
              <thead>
                <tr>
                  <th>Nguồn</th>
                  <th>Chiều / Giá</th>
                  <th className="text-right">PnL Giả Lập</th>
                  <th className="text-right">Kết Quả</th>
                </tr>
              </thead>
              <tbody>
                {shadows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-xs text-slate-500">
                      Chưa có tín hiệu học thử nào trong sổ cái.
                    </td>
                  </tr>
                ) : (
                  shadows.slice(0, 8).map((sh: any) => (
                    <tr key={sh.id}>
                      <td className="font-mono text-xs text-cyan-300">{sh.source_id}</td>
                      <td className="font-mono text-xs text-white tabular-nums">
                        {sh.action} @ {fmtNum(sh.entry_price, 2)}
                      </td>
                      <td
                        className={`text-right font-mono text-xs font-bold tabular-nums ${
                          Number(sh.simulated_pnl_pips || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {fmtPnL(sh.simulated_pnl_pips)} pips
                      </td>
                      <td className="text-right font-mono text-xs text-slate-300">{sh.outcome}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Row 3b: MCP External Data Connectors */}
      <div className="quant-panel p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
              Model Context Protocol (MCP Bridge)
            </span>
            <h3 className="mt-0.5 text-base font-bold text-white">
              Quản Lý Nguồn Dữ Liệu MCP Mở Rộng ({mcpServers.length})
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Kết nối chỉ đọc tới tin tức tài chính, Yahoo Finance (GC=F, DXY, US10Y), lịch vĩ mô FRED và trình đọc Web sạch — cách ly hoàn toàn với luồng đặt lệnh MT5.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {mcpServers.map((srv: any) => (
            <div
              key={srv.server_id}
              className="rounded-xl border border-white/[0.08] bg-[#040710]/85 p-4 flex flex-col justify-between gap-3"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-cyan-300">{srv.name}</span>
                  <span
                    className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                      srv.enabled
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35'
                        : 'bg-slate-800 text-slate-400 border border-white/10'
                    }`}
                  >
                    {srv.enabled ? 'ACTIVE' : 'DISABLED'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{srv.description}</p>
                <div className="mt-1.5 font-mono text-[10px] text-slate-500 truncate">
                  {srv.transport} · {srv.endpoint_url}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] pt-2.5">
                <button
                  type="button"
                  onClick={() => handleTestMcpServer(srv.server_id)}
                  className="quant-btn-secondary px-3 py-1 text-[11px]"
                >
                  Chạy Thử MCP
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleMcpServer(srv.server_id, Boolean(srv.enabled))}
                  className={`px-3 py-1 rounded-lg font-mono text-[11px] font-bold border ${
                    srv.enabled
                      ? 'border-amber-500/35 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                      : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                  }`}
                >
                  {srv.enabled ? 'Tắt Nguồn' : 'Bật Nguồn'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {mcpTestResult && (
          <div className="rounded-xl border border-cyan-500/30 bg-[#040710] p-4 font-mono text-xs text-cyan-200">
            <div className="mb-1 font-bold text-cyan-400">KẾT QUẢ KIỂM THỬ MCP ({mcpTestResult.server_id}):</div>
            <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-300">
              {JSON.stringify(mcpTestResult.result, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Row 4: Walk-Forward Strategy Approval Queue */}
      <div className="quant-panel p-6">
        <AdminApprovalQueue decision={null} />
      </div>

      {/* Skill Spec Modal */}
      {selectedSkillSpec && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="quant-panel max-w-2xl w-full p-6 space-y-4 border-cyan-500/40">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="font-mono text-sm font-bold text-cyan-300">
                SKILL.md — {selectedSkillSpec.skill_id}
              </div>
              <button
                type="button"
                onClick={() => setSelectedSkillSpec(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <pre className="max-h-96 overflow-y-auto rounded-xl border border-white/[0.07] bg-[#040710] p-4 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">
              {selectedSkillSpec.markdown || JSON.stringify(selectedSkillSpec, null, 2)}
            </pre>
          </div>
        </div>
      )}

      <ToastNotification
        message={msg || null}
        type="info"
        onClose={() => setMsg('')}
      />
    </div>
  );
};
