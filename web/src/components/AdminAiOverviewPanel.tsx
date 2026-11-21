import React, { useState } from 'react';
import { apiPost } from '../api/client';

export interface AdminAiOverviewPanelProps {
  evo: any;
  geminiPool: any[];
  onRefresh: () => void;
  setMsg: (msg: string) => void;
}

export const AdminAiOverviewPanel: React.FC<AdminAiOverviewPanelProps> = ({
  evo,
  geminiPool,
  onRefresh,
  setMsg,
}) => {
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const activeKeysCount = geminiPool.filter((k) => k.is_active && k.status !== 'error').length;
  const autoPromote = Boolean(evo?.stage?.auto_promote);
  const samplesLearned = evo?.stage?.samples_learned || 0;
  const shadowTotal = evo?.shadow_summary?.total_evaluated || 0;
  const shadowOpen = evo?.shadow_summary?.total_open || 0;
  const shadowWinRate = evo?.shadow_summary?.overall_win_rate_pct || 0;
  const learnedSkillsCount = evo?.skills_learned?.length || 0;
  const builtinSkillsCount = evo?.skills_builtin?.length || 0;

  const handleToggleAutoPromote = async () => {
    try {
      const nextVal = !autoPromote;
      const j = await apiPost('/api/admin/sources/auto-promote', { enabled: nextVal });
      setMsg(j.message || (nextVal ? 'Đã BẬT tự động thăng hạng chiến lược.' : 'Đã TẮT tự động thăng hạng chiến lược.'));
      onRefresh();
    } catch (err: any) {
      setMsg(`Lỗi đổi chế độ Auto-Promote: ${err.message || ''}`);
    }
  };

  const handleDecision = async (jobId: string, approved: boolean) => {
    setApprovingId(jobId);
    try {
      await apiPost(`/api/admin/research/${encodeURIComponent(jobId)}/decision`, { approved });
      setMsg(approved ? `✓ Đã phê duyệt chiến lược #${jobId.slice(0, 8)} chạy tiền thật.` : `✗ Đã từ chối chiến lược #${jobId.slice(0, 8)}.`);
      onRefresh();
    } catch (err: any) {
      setMsg(`Lỗi duyệt chiến lược: ${err.message || ''}`);
    } finally {
      setApprovingId(null);
    }
  };

  const candidates = evo?.wfo_candidates || [];

  return (
    <div className="space-y-6">
      {/* 1. GIÁM SÁT TRẠNG THÁI TỰ HỌC (READ-ONLY TELEMETRY) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Chu kỳ & Chế độ vận hành */}
        <div className="quant-panel p-4 bg-[#060c1e] border border-white/10 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>CHẾ ĐỘ TỰ HỌC</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="my-2">
            <div className="text-xl font-black text-white font-mono">
              {evo?.stage?.active_mode || 'AUTONOMOUS'}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Tiến trình: <span className="text-cyan-300 font-bold">{evo?.stage?.readiness_pct || 0}%</span> (Mục tiêu 500 mẫu)
            </div>
          </div>
          <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, evo?.stage?.readiness_pct || 0)}%` }}
            />
          </div>
        </div>

        {/* Số mẫu Shadow Signals & Win Rate */}
        <div className="quant-panel p-4 bg-[#060c1e] border border-white/10 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>SHADOW SIGNALS</span>
            <span className="text-cyan-400 font-mono">{shadowOpen} đang mở</span>
          </div>
          <div className="my-2">
            <div className="text-xl font-black text-cyan-300 font-mono">
              {shadowTotal.toLocaleString()} <span className="text-xs font-normal text-slate-400">mẫu kiểm chứng</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Win Rate thực nghiệm: <span className="text-emerald-400 font-bold">{shadowWinRate}%</span>
            </div>
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Tổng mẫu tích lũy: {samplesLearned}
          </div>
        </div>

        {/* Kỹ năng đang hoạt động (Learned Skills) */}
        <div className="quant-panel p-4 bg-[#060c1e] border border-white/10 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>BỘ QUY TẮC & KỸ NĂNG</span>
            <span className="text-amber-400 font-mono">app/skills/learned</span>
          </div>
          <div className="my-2">
            <div className="text-xl font-black text-amber-300 font-mono">
              {learnedSkillsCount} <span className="text-xs font-normal text-slate-400">tự học</span> + {builtinSkillsCount} <span className="text-xs font-normal text-slate-400">cốt lõi</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Quy nạp từ phản tư Hindsight & lệnh thực tế
            </div>
          </div>
          <div className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
            <span>✓ Auto-synthesized</span>
          </div>
        </div>

        {/* Trạng thái Sức Khỏe Gemini Key Pool */}
        <div className="quant-panel p-4 bg-[#060c1e] border border-white/10 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>GEMINI KEY POOL</span>
            <span className={`w-2 h-2 rounded-full ${activeKeysCount > 0 ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          </div>
          <div className="my-2">
            <div className="text-xl font-black text-white font-mono">
              <span className="text-emerald-400">{activeKeysCount}</span> / {geminiPool.length} <span className="text-xs font-normal text-slate-400">Khả dụng</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {geminiPool.filter((k) => k.status === 'exhausted' || k.status === 'rate_limited').length > 0
                ? 'Có key đang hạ nhiệt'
                : '100% Pool hoạt động ổn định'}
            </div>
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Tự động xoay vòng & phục hồi nền
          </div>
        </div>
      </div>

      {/* 2. CÔNG TẮC AUTO-PROMOTE CỐT LÕI */}
      <div className="quant-panel p-5 bg-[#070e24] border border-cyan-500/30 rounded-2xl flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40">
              CÔNG TẮC ĐỘC LẬP
            </span>
            <h4 className="text-sm font-bold text-white">
              Tự Động Thăng Hạng Nguồn Tín Hiệu & Chiến Lược Đạt Chuẩn (Auto-Promote)
            </h4>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Khi bật, AI Agent sẽ tự động nâng nguồn từ <code className="text-cyan-300">SHADOW_ONLY</code> lên <code className="text-emerald-300">ACTIVE_LIVE</code> sau chu kỳ EOD nếu thỏa mãn tối thiểu 30 mẫu, WinRate ≥ 58% và kỳ vọng Expectancy &gt; 0.
          </p>
        </div>

        <button
          type="button"
          onClick={handleToggleAutoPromote}
          className={`px-5 py-2.5 rounded-xl font-mono text-xs font-bold transition flex items-center gap-2.5 cursor-pointer shadow-lg ${
            autoPromote
              ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10'
          }`}
        >
          <span className={`w-2.5 h-2.5 rounded-full ${autoPromote ? 'bg-slate-950' : 'bg-slate-500'}`} />
          <span>{autoPromote ? 'ĐANG BẬT: TỰ TIẾN HÓA' : 'ĐANG TẮT: CHỈ GIÁM SÁT'}</span>
        </button>
      </div>

      {/* 3. HÀNG ĐỢI PHÊ DUYỆT CHIẾN LƯỢC AI (APPROVED / REJECTED) */}
      <div className="quant-panel p-6 bg-[#040816] border border-white/10 rounded-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400">
              HÀNG ĐỢI DUYỆT LÊN TIỀN THẬT
            </div>
            <h3 className="mt-1 text-base font-bold text-white">
              Chiến Lược Walk-Forward Optimization (WFO) Chờ Phê Duyệt
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {candidates.length} ứng viên đã vượt qua kiểm định OOS
          </span>
        </div>

        {candidates.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs font-mono">
            Hiện không có chiến lược nào đang chờ phê duyệt. Tiến trình nền tự động lọc và đề xuất khi đạt ngưỡng chất lượng.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 font-mono text-[11px]">
                  <th className="py-2.5 px-3">CHIẾN LƯỢC</th>
                  <th className="py-2.5 px-3">TRẠNG THÁI</th>
                  <th className="py-2.5 px-3">WIN RATE OOS</th>
                  <th className="py-2.5 px-3">PROFIT FACTOR</th>
                  <th className="py-2.5 px-3">MAX DRAWDOWN</th>
                  <th className="py-2.5 px-3">MẪU TEST</th>
                  <th className="py-2.5 px-3 text-right">QUYẾT ĐỊNH CỦA ADMIN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {candidates.map((c: any) => (
                  <tr key={c.id} className="hover:bg-white/[0.02] transition">
                    <td className="py-3 px-3">
                      <div className="font-bold text-white">{c.name || c.id}</div>
                      <div className="text-[10px] text-slate-500">{c.id}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        c.status === 'APPROVED'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : c.status === 'REJECTED'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                      }`}>
                        {c.status || 'WAITING_APPROVAL'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-cyan-300 font-bold">
                      {c.win_rate_pct ? `${c.win_rate_pct}%` : '—'}
                    </td>
                    <td className="py-3 px-3 text-emerald-400 font-bold">
                      {c.profit_factor || '—'}
                    </td>
                    <td className="py-3 px-3 text-rose-400">
                      {c.max_drawdown_pct ? `${c.max_drawdown_pct}%` : '—'}
                    </td>
                    <td className="py-3 px-3 text-slate-400">
                      {c.sample_size || '—'}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {c.status !== 'APPROVED' && c.status !== 'REJECTED' ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={approvingId === c.id}
                            onClick={() => handleDecision(c.id, true)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-bold cursor-pointer text-[11px] transition"
                          >
                            ✓ Duyệt Live
                          </button>
                          <button
                            type="button"
                            disabled={approvingId === c.id}
                            onClick={() => handleDecision(c.id, false)}
                            className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold cursor-pointer text-[11px] transition"
                          >
                            ✗ Từ Chối
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500">Đã chốt</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
