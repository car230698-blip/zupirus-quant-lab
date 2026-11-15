import { useState, useEffect } from 'react';

export function AdminSourcesTab() {
  const [sources, setSources] = useState<any[]>([]);
  const [shadowSignals, setShadowSignals] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [signalMode, setSignalMode] = useState<'EXTERNAL_FEED' | 'HYBRID' | 'ZUPIRUS_AGENT'>('EXTERNAL_FEED');

  // Skill inspection & testing modal state
  const [selectedSkillSpec, setSelectedSkillSpec] = useState<{ skill_id: string; skill_md: string } | null>(null);
  const [testResult, setTestResult] = useState<{ skill_id: string; result: any } | null>(null);
  const [testingSkillId, setTestingSkillId] = useState<string | null>(null);

  async function fetchSourcesData() {
    setLoading(true);
    try {
      const [resSrc, resShd, resSkills] = await Promise.all([
        fetch('/api/admin/sources', { headers: { 'X-Zupirus': '1' } }),
        fetch('/api/admin/sources/shadow-signals?limit=30', { headers: { 'X-Zupirus': '1' } }),
        fetch('/api/admin/skills', { headers: { 'X-Zupirus': '1' } }),
      ]);
      if (resSrc.ok) {
        const dataSrc = await resSrc.json();
        setSources(dataSrc.sources || []);
      }
      if (resShd.ok) {
        const dataShd = await resShd.json();
        setShadowSignals(dataShd.signals || []);
      }
      if (resSkills.ok) {
        const dataSkills = await resSkills.json();
        setSkills(dataSkills.skills || []);
      }
    } catch (e: any) {
      setActionMsg({ text: 'Lỗi tải dữ liệu: ' + e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleSkill(skillId: string, currentEnabled: boolean) {
    try {
      const res = await fetch(`/api/admin/skills/${skillId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg({ text: data.message || 'Cập nhật trạng thái skill thành công.', type: 'success' });
        await fetchSourcesData();
      } else {
        setActionMsg({ text: data.detail || 'Lỗi cập nhật skill.', type: 'error' });
      }
    } catch (e: any) {
      setActionMsg({ text: e.message, type: 'error' });
    }
  }

  async function handleViewSkillSpec(skillId: string) {
    try {
      const res = await fetch(`/api/admin/skills/${skillId}/spec`, {
        headers: { 'X-Zupirus': '1' },
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedSkillSpec(data);
      } else {
        setActionMsg({ text: data.detail || 'Không thể tải tài liệu đặc tả.', type: 'error' });
      }
    } catch (e: any) {
      setActionMsg({ text: e.message, type: 'error' });
    }
  }

  async function handleTestSkill(skillId: string) {
    setTestingSkillId(skillId);
    try {
      const res = await fetch(`/api/admin/skills/${skillId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ parameters: {} }),
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult({ skill_id: skillId, result: data.result });
      } else {
        setActionMsg({ text: data.detail || 'Lỗi chạy thử nghiệm skill.', type: 'error' });
      }
    } catch (e: any) {
      setActionMsg({ text: e.message, type: 'error' });
    } finally {
      setTestingSkillId(null);
    }
  }

  useEffect(() => {
    fetchSourcesData();
  }, []);

  async function handlePromote(sourceId: string) {
    try {
      const res = await fetch(`/api/admin/sources/${sourceId}/promote`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg({ text: data.message || 'Thăng hạng thành công.', type: 'success' });
        await fetchSourcesData();
      } else {
        setActionMsg({ text: data.detail || 'Lỗi thăng hạng.', type: 'error' });
      }
    } catch (e: any) {
      setActionMsg({ text: e.message, type: 'error' });
    }
  }

  async function handleDemote(sourceId: string) {
    try {
      const res = await fetch(`/api/admin/sources/${sourceId}/demote`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg({ text: data.message || 'Hạ cấp thành công.', type: 'success' });
        await fetchSourcesData();
      } else {
        setActionMsg({ text: data.detail || 'Lỗi hạ cấp.', type: 'error' });
      }
    } catch (e: any) {
      setActionMsg({ text: e.message, type: 'error' });
    }
  }

  async function handleReplay(sourceId: string) {
    setReplayingId(sourceId);
    try {
      const res = await fetch(`/api/admin/sources/${sourceId}/replay?days=90`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      const data = await res.json();
      if (res.ok) {
        const r = data.result;
        setActionMsg({
          text: `Kiểm định 90 ngày hoàn tất: ${r.simulated_trades} lệnh, PF=${r.profit_factor}, WinRate=${(r.win_rate * 100).toFixed(0)}%, TrustScore=${r.trust_score}.`,
          type: 'success',
        });
        await fetchSourcesData();
      } else {
        setActionMsg({ text: data.detail || 'Lỗi chạy replay.', type: 'error' });
      }
    } catch (e: any) {
      setActionMsg({ text: e.message, type: 'error' });
    } finally {
      setReplayingId(null);
    }
  }

  async function handleEvaluateEod() {
    try {
      const res = await fetch('/api/admin/sources/evaluate-eod', {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg({ text: `Đã chấm điểm EOD thành công: ${data.evaluated_count} tín hiệu shadow.`, type: 'success' });
        await fetchSourcesData();
      } else {
        setActionMsg({ text: data.detail || 'Lỗi chấm điểm EOD.', type: 'error' });
      }
    } catch (e: any) {
      setActionMsg({ text: e.message, type: 'error' });
    }
  }

  const activeSources = sources.filter((s) => s.status === 'ACTIVE_LIVE');

  return (
    <div className="space-y-6 font-mono text-xs">
      {actionMsg && (
        <div
          className={`p-3.5 rounded-xl border text-xs ${
            actionMsg.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
              : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
          }`}
        >
          {actionMsg.text}
        </div>
      )}

      {/* Mode Switcher & Funnel Overview */}
      <div className="quant-panel rounded-2xl border border-indigo-500/30 bg-[#0c1222] p-5 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <h3 className="font-bold text-sm text-slate-100 tracking-wide">
              PHỄU TUYỂN CHỌN NGUỒN TÍN HIỆU & CHẾ ĐỘ AGENT
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleEvaluateEod}
              className="px-3 py-1 rounded-lg bg-indigo-950 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 text-xs font-bold"
            >
              ⚖ Chấm Điểm EOD M1
            </button>
            <button
              onClick={fetchSourcesData}
              className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-xs font-bold"
            >
              ↻ Làm Mới
            </button>
          </div>
        </div>

        {/* 3-Mode Switcher */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            onClick={() => setSignalMode('EXTERNAL_FEED')}
            className={`p-3 rounded-xl border text-left transition-all ${
              signalMode === 'EXTERNAL_FEED'
                ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200 shadow-md'
                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between font-bold text-xs mb-1">
              <span>GIAI ĐOẠN 1: EXTERNAL FEED</span>
              {signalMode === 'EXTERNAL_FEED' && <span className="text-cyan-400">● ĐANG CHẠY</span>}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
              100% lệnh khớp từ nguồn ngoài (TradingView / MetaApi Feed). Agent học từ trang giấy trắng.
            </p>
          </button>

          <button
            onClick={() => setSignalMode('HYBRID')}
            className={`p-3 rounded-xl border text-left transition-all ${
              signalMode === 'HYBRID'
                ? 'bg-purple-950/60 border-purple-500 text-purple-200 shadow-md'
                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between font-bold text-xs mb-1">
              <span>CHẾ ĐỘ HYBRID (ĐỐI CHIẾU)</span>
              {signalMode === 'HYBRID' && <span className="text-purple-400">● ĐANG CHẠY</span>}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
              Song song nguồn ngoài và các chiến lược tự học của Agent. Chỉ cho phép các chiến lược đã qua phê duyệt.
            </p>
          </button>

          <button
            onClick={() => setSignalMode('ZUPIRUS_AGENT')}
            className={`p-3 rounded-xl border text-left transition-all ${
              signalMode === 'ZUPIRUS_AGENT'
                ? 'bg-emerald-950/60 border-emerald-500 text-emerald-200 shadow-md'
                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between font-bold text-xs mb-1">
              <span>GIAI ĐOẠN 2: ZUPIRUS AGENT</span>
              {signalMode === 'ZUPIRUS_AGENT' && <span className="text-emerald-400">● ĐANG CHẠY</span>}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
              Tự hành hoàn toàn. Ngắt phụ thuộc tín hiệu bên ngoài. Agent tự động phát hiện và sinh lệnh.
            </p>
          </button>
        </div>
      </div>

      {/* Sources Leaderboard */}
      <div className="quant-panel rounded-2xl border border-slate-800 bg-[#0d1424] overflow-hidden">
        <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-100">
              Bảng Xếp Hạng & Quản Lý Nguồn ({sources.length} Nguồn)
            </span>
            <span className="text-xs text-slate-400">
              (Tối đa 2–3 nguồn ACTIVE_LIVE chạy thật xuống tài khoản khách hàng)
            </span>
          </div>
          <span className="text-xs text-cyan-400">
            {activeSources.length} / 3 Live Đang Khớp
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800 text-[11px]">
              <tr>
                <th className="py-2.5 px-4">TÊN NGUỒN</th>
                <th className="py-2.5 px-4">LOẠI</th>
                <th className="py-2.5 px-4">TRẠNG THÁI</th>
                <th className="py-2.5 px-4">TRUST SCORE</th>
                <th className="py-2.5 px-4">PROFIT FACTOR</th>
                <th className="py-2.5 px-4">WIN RATE</th>
                <th className="py-2.5 px-4">MAX DD (PIPS)</th>
                <th className="py-2.5 px-4">ĐÃ ĐỐI CHIẾU</th>
                <th className="py-2.5 px-4 text-right">THAO TÁC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {sources.map((s) => {
                const isLive = s.status === 'ACTIVE_LIVE';
                const isReplaying = replayingId === s.id;

                return (
                  <tr key={s.id} className="hover:bg-slate-900/40">
                    <td className="py-3 px-4 font-bold text-slate-200">
                      {s.name}
                      <span className="block text-[10px] text-slate-500 font-normal">{s.id}</span>
                    </td>
                    <td className="py-3 px-4 text-slate-400">{s.source_type}</td>
                    <td className="py-3 px-4">
                      {isLive ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/50">
                          ● ACTIVE LIVE
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                          ○ SHADOW ONLY
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-bold text-cyan-300 text-sm">{s.trust_score || 50.0}</span>
                      <span className="text-slate-600 text-[10px]">/100</span>
                    </td>
                    <td className="py-3 px-4 text-slate-200 font-semibold">{s.profit_factor || 1.0}</td>
                    <td className="py-3 px-4 text-emerald-400 font-semibold">
                      {((s.win_rate || 0.5) * 100).toFixed(0)}%
                    </td>
                    <td className="py-3 px-4 text-amber-400">{s.max_drawdown_pips || 0}p</td>
                    <td className="py-3 px-4 text-slate-400">{s.evaluated_signals || 0} lệnh</td>
                    <td className="py-3 px-4 text-right space-x-1.5">
                      <button
                        onClick={() => handleReplay(s.id)}
                        disabled={isReplaying}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] disabled:opacity-50"
                      >
                        {isReplaying ? 'Đang Replay…' : 'Replay 90D'}
                      </button>

                      {isLive ? (
                        <button
                          onClick={() => handleDemote(s.id)}
                          className="px-2 py-1 rounded bg-amber-950/80 hover:bg-amber-900 border border-amber-700/60 text-amber-300 text-[11px]"
                        >
                          Hạ Cấp
                        </button>
                      ) : (
                        <button
                          onClick={() => handlePromote(s.id)}
                          className="px-2 py-1 rounded bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-300 text-[11px]"
                        >
                          Thăng Hạng
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Shadow Signals Ledger Table */}
      <div className="quant-panel rounded-2xl border border-slate-800 bg-[#0d1424] overflow-hidden">
        <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-100">
              Sổ Theo Dõi Tín Hiệu Ẩn (Shadow Signals Ledger)
            </span>
            <span className="text-xs text-slate-400">
              (0 VNĐ chi phí khớp lệnh · Dùng để đối chiếu M1 & học quy nạp)
            </span>
          </div>
          <span className="text-xs text-slate-500">{shadowSignals.length} Tín hiệu gần nhất</span>
        </div>

        <div className="overflow-x-auto">
          {shadowSignals.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              Chưa có tín hiệu shadow nào được ghi nhận.
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800 text-[11px]">
                <tr>
                  <th className="py-2.5 px-4">SIGNAL ID</th>
                  <th className="py-2.5 px-4">NGUỒN</th>
                  <th className="py-2.5 px-4">LỆNH</th>
                  <th className="py-2.5 px-4">GIÁ VÀO / SL / TP</th>
                  <th className="py-2.5 px-4">ĐỐI CHIẾU M1 (EOD)</th>
                  <th className="py-2.5 px-4">PNL THỰC TẾ</th>
                  <th className="py-2.5 px-4">MAE / MFE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {shadowSignals.map((shd) => {
                  const isPending = shd.eval_status === 'PENDING';
                  const isHitTp = shd.eval_status === 'HIT_TP';
                  const isHitSl = shd.eval_status === 'HIT_SL' || shd.eval_status === 'CONSERVATIVE_DUAL_HIT_SL';

                  return (
                    <tr key={shd.id} className="hover:bg-slate-900/40">
                      <td className="py-2.5 px-4 font-bold text-slate-300">{shd.id?.slice(0, 12)}</td>
                      <td className="py-2.5 px-4 text-slate-400">{shd.source_name || shd.source_id}</td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          shd.side === 'BUY' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
                        }`}>
                          {shd.side} {shd.symbol}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-200">
                        {shd.entry_price} / <span className="text-amber-400">{shd.stop_loss}</span> / <span className="text-emerald-400">{shd.take_profit || '—'}</span>
                      </td>
                      <td className="py-2.5 px-4">
                        {isPending ? (
                          <span className="text-slate-500 text-[11px]">Đang theo dõi nến</span>
                        ) : isHitTp ? (
                          <span className="text-emerald-400 font-bold text-[11px]">✓ Hit TP</span>
                        ) : isHitSl ? (
                          <span className="text-rose-400 font-bold text-[11px]">✗ Hit SL</span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">{shd.eval_status}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        {shd.pnl_pips != null ? (
                          <span className={`font-bold ${shd.pnl_pips >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {shd.pnl_pips >= 0 ? '+' : ''}{shd.pnl_pips.toFixed(1)} pips
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-slate-400 text-[11px]">
                        MAE: <span className="text-rose-400">-{shd.mae_pips || 0}p</span> · MFE: <span className="text-emerald-400">+{shd.mfe_pips || 0}p</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Kho Lưu Trữ Kỹ Năng Động (Dynamic Agent Skill Registry) */}
      <div className="quant-panel rounded-2xl border border-indigo-500/30 bg-[#0c1222] overflow-hidden shadow-xl">
        <div className="border-b border-slate-800 px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-slate-900/40">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-bold text-sm text-slate-100">
              KHO LƯU TRỮ KỸ NĂNG ĐỘNG CHO AI AGENT (DYNAMIC AGENT SKILL REGISTRY)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-700/60">
              {skills.filter((s) => s.is_builtin === 1).length} Nền Tảng (Built-in)
            </span>
            <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-700/60">
              {skills.filter((s) => s.is_builtin === 0).length} Tự Học (Self-Learned)
            </span>
            <span className="text-slate-400 text-[11px] hidden sm:inline">
              Nạp On-Demand (Progressive Disclosure)
            </span>
          </div>
        </div>

        <div className="p-4 bg-slate-950/40 border-b border-slate-800/80 text-[11px] text-slate-400 leading-relaxed font-sans">
          Toàn bộ công cụ phân tích độc lập (ATR Scanner, Kiểm toán giãn Spread, Thông dịch tin tức vĩ mô, Chấm điểm nguồn, và Tổng hợp chiến lược). Agent duy trì trạng thái <strong>Tabula Rasa</strong> (không gán cứng thuật toán vào lệnh) và chỉ nạp tài liệu hướng dẫn khi phát sinh tác vụ tương ứng.
        </div>

        <div className="overflow-x-auto">
          {skills.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              Đang tải danh mục kỹ năng của Agent...
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800 text-[11px]">
                <tr>
                  <th className="py-2.5 px-4">TÊN KỸ NĂNG / MÃ (SKILL ID)</th>
                  <th className="py-2.5 px-4">PHÂN LOẠI</th>
                  <th className="py-2.5 px-4">ĐIỀU KIỆN KÍCH HOẠT (TRIGGER)</th>
                  <th className="py-2.5 px-4">SỐ LẦN DÙNG</th>
                  <th className="py-2.5 px-4">TRẠNG THÁI</th>
                  <th className="py-2.5 px-4 text-right">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {skills.map((sk) => {
                  const isBuiltin = sk.is_builtin === 1;
                  const isEnabled = sk.enabled === 1;
                  const isTesting = testingSkillId === sk.skill_id;

                  return (
                    <tr key={sk.skill_id} className="hover:bg-slate-900/40">
                      <td className="py-3 px-4 font-bold text-slate-200">
                        {sk.name}
                        <span className="block text-[10px] text-cyan-400 font-mono font-normal">
                          {sk.skill_id}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {isBuiltin ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-700/50">
                            NỀN TẢNG
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950/80 text-purple-300 border border-purple-700/50">
                            TỰ HỌC (REFLECTIVE)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-300 text-[11px] max-w-xs font-sans">
                        {sk.trigger_condition || sk.description}
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-bold">
                        {sk.usage_count || 0} <span className="text-[10px] text-slate-500 font-normal">lượt</span>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => handleToggleSkill(sk.skill_id, isEnabled)}
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-all border ${
                            isEnabled
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/60 hover:bg-emerald-900'
                              : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-750'
                          }`}
                        >
                          {isEnabled ? '● ĐANG BẬT' : '○ TẠM TẮT'}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right space-x-1.5">
                        <button
                          onClick={() => handleViewSkillSpec(sk.skill_id)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] border border-slate-700"
                        >
                          Xem SKILL.md
                        </button>
                        <button
                          onClick={() => handleTestSkill(sk.skill_id)}
                          disabled={isTesting}
                          className="px-2 py-1 rounded bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 text-[11px] disabled:opacity-50"
                        >
                          {isTesting ? 'Đang chạy…' : 'Chạy Thử'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal: View SKILL.md Specification */}
      {selectedSkillSpec && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0b101c] border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
              <span className="font-bold text-sm text-cyan-300 font-mono">
                ĐẶC TẢ KỸ NĂNG: {selectedSkillSpec.skill_id}
              </span>
              <button
                onClick={() => setSelectedSkillSpec(null)}
                className="text-slate-400 hover:text-slate-100 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3 font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed bg-[#080d18]">
              {selectedSkillSpec.skill_md}
            </div>
            <div className="px-5 py-3 border-t border-slate-800 flex justify-end bg-slate-900/40">
              <button
                onClick={() => setSelectedSkillSpec(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Test Run Execution Result */}
      {testResult && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0b101c] border border-cyan-500/40 rounded-2xl max-w-xl w-full max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
              <span className="font-bold text-sm text-emerald-400 font-mono">
                KẾT QUẢ THỰC THI TOOL: {testResult.skill_id}
              </span>
              <button
                onClick={() => setTestResult(null)}
                className="text-slate-400 hover:text-slate-100 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-2 font-mono text-xs text-emerald-300 bg-[#070b14]">
              <pre className="whitespace-pre-wrap">{JSON.stringify(testResult.result, null, 2)}</pre>
            </div>
            <div className="px-5 py-3 border-t border-slate-800 flex justify-end bg-slate-900/40">
              <button
                onClick={() => setTestResult(null)}
                className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-bold"
              >
                Xác Nhận
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
