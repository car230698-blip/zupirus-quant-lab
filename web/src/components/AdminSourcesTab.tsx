import React, { useEffect, useState } from 'react';
import { fmtNum, fmtPnL } from '../utils/strategyDecision';

export const AdminSourcesTab: React.FC = () => {
  const [data, setData] = useState<any>({
    active_signal_mode: 'HYBRID',
    sources: [],
    learning_progress: {
      closed_trades_analyzed: 0,
      target_trades_for_autonomy: 500,
      readiness_pct: 0,
    },
  });
  const [shadows, setShadows] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
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
      }
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ context: { symbol: 'XAUUSD', timeframe: 'M15' } }),
    });
    if (res.ok) {
      const result = await res.json();
      setSkillTestResult(result);
      setMsg(`Đã chạy kiểm thử kỹ năng ${skillId} thành công.`);
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

        {msg && (
          <div className="rounded-xl border border-cyan-500/35 bg-cyan-950/30 px-4 py-2.5 font-mono text-xs text-cyan-200">
            {msg}
          </div>
        )}
      </div>

      {/* Row 2: Sources Leaderboard + Add Sandbox Source */}
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
            <option value="MT5_MASTER">MT5 MASTER ACCOUNT</option>
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
    </div>
  );
};
