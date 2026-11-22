import React, { useState, useEffect, useCallback } from 'react';
import {
  apiPost,
  fetchStrategyHistory,
  rollbackStrategy,
  StrategyHistoryItem,
} from '../api/client';
import { SpotlightBento } from './ui/SpotlightBento';
import { IconAlert } from './Icons';

export interface AdminAiOverviewPanelProps {
  evo: any;
  geminiPool: any[];
  onRefresh: () => void;
  setMsg: (msg: string) => void;
}

function formatDateTime(rawTs: any): string {
  if (!rawTs) return '--:--:--';
  const num = Number(rawTs);
  if (isNaN(num) || num <= 0) return '--:--:--';
  const millis = num > 1e11 ? num : num * 1000;
  const d = new Date(millis);
  if (isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour12: false,
  });
}

export const AdminAiOverviewPanel: React.FC<AdminAiOverviewPanelProps> = ({
  evo,
  geminiPool,
  onRefresh,
  setMsg,
}) => {
  const [strategyHistory, setStrategyHistory] = useState<StrategyHistoryItem[]>([]);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [rollbackConfirmCandidate, setRollbackConfirmCandidate] = useState<StrategyHistoryItem | null>(null);

  const activeKeysCount = geminiPool.filter((k) => k.is_active && k.status !== 'error').length;
  const autoPromote = Boolean(evo?.stage?.auto_promote);
  const samplesLearned = evo?.stage?.samples_learned || 0;
  const shadowTotal = evo?.shadow_summary?.total_evaluated || 0;
  const shadowOpen = evo?.shadow_summary?.total_open || 0;
  const shadowWinRate = evo?.shadow_summary?.overall_win_rate_pct || 0;
  const learnedSkillsCount = evo?.skills_learned?.length || 0;
  const builtinSkillsCount = evo?.skills_builtin?.length || 0;

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetchStrategyHistory();
      setStrategyHistory(res.strategies || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

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

  const handleExecuteRollback = async (candidateId: string) => {
    setRollingBackId(candidateId);
    try {
      const res = await rollbackStrategy(candidateId);
      setMsg(res.message || `✓ Đã khôi phục chiến lược #${candidateId.slice(0, 8)} lên LIVE.`);
      setRollbackConfirmCandidate(null);
      await loadHistory();
      onRefresh();
    } catch (err: any) {
      setMsg(`Lỗi hoàn tác chiến lược: ${err?.message || 'Thất bại'}`);
    } finally {
      setRollingBackId(null);
    }
  };

  const candidates = evo?.wfo_candidates || [];

  return (
    <div className="space-y-6">
      {/* 1. GIÁM SÁT TRẠNG THÁI TỰ HỌC (READ-ONLY TELEMETRY) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Chu kỳ & Chế độ vận hành */}
        <SpotlightBento className="p-4 flex flex-col justify-between">
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
        </SpotlightBento>

        {/* Số mẫu Shadow Signals & Win Rate */}
        <SpotlightBento className="p-4 flex flex-col justify-between">
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
        </SpotlightBento>

        {/* Kỹ năng đang hoạt động (Learned Skills) */}
        <SpotlightBento className="p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>BỘ QUY TẮC & KỸ NĂNG</span>
            <span className="text-amber-400 font-mono">app/skills/learned</span>
          </div>
          <div className="my-2">
            <div className="text-xl font-black text-amber-300 font-mono">
              {learnedSkillsCount} <span className="text-xs font-normal text-slate-400">tự học</span> + {builtinSkillsCount} <span className="text-xs font-normal text-slate-400">cốt lõi</span>
            </div>
            <div className="text-xs text-slate-400 mt-1 font-sans">
              Quy nạp từ phản tư Hindsight &amp; lệnh thực tế
            </div>
          </div>
          <div className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
            <span>✓ Auto-synthesized</span>
          </div>
        </SpotlightBento>

        {/* Trạng thái Sức Khỏe Gemini Key Pool */}
        <SpotlightBento className="p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>GEMINI KEY POOL</span>
            <span className={`w-2 h-2 rounded-full ${activeKeysCount > 0 ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          </div>
          <div className="my-2">
            <div className="text-xl font-black text-white font-mono">
              <span className="text-emerald-400">{activeKeysCount}</span> / {geminiPool.length} <span className="text-xs font-normal text-slate-400">Khả dụng</span>
            </div>
            <div className="text-xs text-slate-400 mt-1 font-sans">
              {geminiPool.filter((k) => k.status === 'exhausted' || k.status === 'rate_limited').length > 0
                ? 'Có key đang hạ nhiệt'
                : '100% Pool hoạt động ổn định'}
            </div>
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Tự động xoay vòng &amp; phục hồi nền
          </div>
        </SpotlightBento>
      </div>

      {/* 2. CÔNG TẮC AUTO-PROMOTE CỐT LÕI (2026 SPOTLIGHT BENTO) */}
      <SpotlightBento className="p-5 flex flex-wrap items-center justify-between gap-4 border-cyan-500/30">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40">
              CÔNG TẮC ĐỘC LẬP
            </span>
            <h4 className="text-sm font-bold text-white font-sans">
              Tự Động Thăng Hạng Nguồn Tín Hiệu &amp; Chiến Lược Đạt Chuẩn (Auto-Promote)
            </h4>
          </div>
          <p className="text-xs text-slate-300/80 max-w-2xl font-sans leading-relaxed">
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
      </SpotlightBento>

      {/* 3. TÓM TẮT HÀNG ĐỢI PHÊ DUYỆT CHIẾN LƯỢC WFO (KHÔNG TRÙNG LẶP TAB 1) */}
      {candidates.length > 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-amber-300 font-bold font-sans">
              Có {candidates.length} chiến lược Walk-Forward Optimization (WFO) đang chờ phê duyệt
            </span>
          </div>
          <span className="text-slate-400 font-sans">
            Xem bảng so sánh Diff chi tiết &amp; phê duyệt tại <strong className="text-cyan-300">Tab Trạm Điều Hành (Needs Me)</strong>
          </span>
        </div>
      ) : (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center text-xs font-mono text-slate-500">
          0 chiến lược chờ duyệt · Hệ thống tự động lọc và đề xuất khi đạt ngưỡng chất lượng
        </div>
      )}

      {/* 4. LỊCH SỬ PHIÊN BẢN CHIẾN LƯỢC & ROLLBACK 1-CLICK (CHUYỂN TỪ TAB 1 SANG ĐÚNG NGỮ CẢNH) */}
      <SpotlightBento className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-[#12B5A6] font-bold">
              VERSION CONTROL // 1-CLICK ROLLBACK
            </div>
            <h3 className="text-base font-bold text-white mt-0.5 font-sans">
              Lịch Sử Phiên Bản Chiến Lược &amp; Điểm Khôi Phục
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Lưu trữ tối đa 10 phiên bản gần nhất
          </span>
        </div>

        {strategyHistory.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 font-mono">
            Chưa có lịch sử phiên bản nào được lưu trữ.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 text-[11px]">
                  <th className="py-2.5 px-3">PHIÊN BẢN &amp; TÊN</th>
                  <th className="py-2.5 px-3">TRẠNG THÁI</th>
                  <th className="py-2.5 px-3">WIN RATE</th>
                  <th className="py-2.5 px-3">PROFIT FACTOR</th>
                  <th className="py-2.5 px-3">MAX DD</th>
                  <th className="py-2.5 px-3">MẪU</th>
                  <th className="py-2.5 px-3">CẬP NHẬT</th>
                  <th className="py-2.5 px-3 text-right">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {strategyHistory.map((strat) => {
                  const isLive = strat.status === 'APPROVED_FOR_PROD';
                  const isRolling = rollingBackId === strat.id;

                  return (
                    <tr key={strat.id} className="hover:bg-white/[0.02] transition">
                      <td className="py-3 px-3">
                        <div className="font-bold text-white font-sans">{strat.name}</div>
                        <div className="text-[10px] text-slate-500">{strat.id}</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          isLive
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : strat.status === 'ROLLED_BACK'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {isLive ? 'LIVE (ĐANG CHẠY)' : strat.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-cyan-300 font-bold tabular-nums">
                        {strat.win_rate_pct}%
                      </td>
                      <td className="py-3 px-3 text-emerald-400 font-bold tabular-nums">
                        {strat.profit_factor}
                      </td>
                      <td className="py-3 px-3 text-rose-300 tabular-nums">
                        {strat.max_drawdown_pct}%
                      </td>
                      <td className="py-3 px-3 text-slate-400 tabular-nums">
                        {strat.sample_size}
                      </td>
                      <td className="py-3 px-3 text-slate-400 text-[11px] tabular-nums">
                        {formatDateTime(strat.updated_at || strat.created_at)}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {isLive ? (
                          <span className="text-[11px] text-emerald-400 font-bold font-sans">
                            ● Đang vận hành
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={isRolling}
                            onClick={() => setRollbackConfirmCandidate(strat)}
                            className="px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-bold font-sans text-[11px] transition cursor-pointer disabled:opacity-50"
                          >
                            {isRolling ? 'Đang khôi phục...' : '↺ Rollback 1-Click'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SpotlightBento>

      {/* CONFIRMATION DIALOG FOR 1-CLICK ROLLBACK */}
      {rollbackConfirmCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#070e24] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                <IconAlert className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white font-sans">Xác Nhận Rollback Chiến Lược</h4>
                <p className="text-xs text-slate-400 font-mono">Thao tác này sẽ thay thế bản LIVE tức thì</p>
              </div>
            </div>

            <div className="rounded-xl bg-black/40 p-4 border border-white/5 space-y-2 text-xs font-sans text-slate-300 leading-relaxed">
              <div>
                Bạn có chắc chắn muốn khôi phục chiến lược <strong className="text-cyan-300">{rollbackConfirmCandidate.name}</strong> (#{rollbackConfirmCandidate.id.slice(0, 8)}) lên làm bản chạy LIVE?
              </div>
              <div className="text-[11px] text-slate-400">
                Bản LIVE hiện tại sẽ được chuyển sang trạng thái <code className="text-amber-300">ROLLED_BACK</code> để làm điểm khôi phục dự phòng.
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRollbackConfirmCandidate(null)}
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 font-bold font-sans text-xs transition cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={rollingBackId === rollbackConfirmCandidate.id}
                onClick={() => handleExecuteRollback(rollbackConfirmCandidate.id)}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold font-sans text-xs transition cursor-pointer shadow-lg shadow-amber-500/20 disabled:opacity-50"
              >
                {rollingBackId === rollbackConfirmCandidate.id ? 'Đang khôi phục...' : 'Xác Nhận Khôi Phục'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
