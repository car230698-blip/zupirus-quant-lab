import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import {
  apiPost,
  fetchStrategyHistory,
  rollbackStrategy,
  StrategyHistoryItem,
} from '../../api/client';
import { MetricCard, Panel, StatusBadge, EmptyState } from '../ui/Primitives';
import { AlertTriangle, Cpu, Layers, KeyRound, Activity, History } from 'lucide-react';

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
  const { lang } = useLanguage();
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
      setMsg(
        j.message ||
          (nextVal
            ? 'Đã bật tự động thăng hạng chiến lược.'
            : 'Đã tắt tự động thăng hạng chiến lược.')
      );
      onRefresh();
    } catch (err: any) {
      setMsg(`Lỗi đổi chế độ Auto-Promote: ${err.message || ''}`);
    }
  };

  const handleExecuteRollback = async (candidateId: string) => {
    setRollingBackId(candidateId);
    try {
      const res = await rollbackStrategy(candidateId);
      setMsg(res.message || `Đã khôi phục phiên bản #${candidateId.slice(0, 8)}.`);
      setRollbackConfirmCandidate(null);
      await loadHistory();
      onRefresh();
    } catch (err: any) {
      setMsg(`Lỗi hoàn tác chiến lược: ${err?.message || 'Thất bại'}`);
    } finally {
      setRollingBackId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. TELEMETRY SUMMARY */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label={lang === 'en' ? 'Research Mode' : 'Chế Độ Nghiên Cứu'}
          value={evo?.stage?.active_mode || 'AUTONOMOUS'}
          subtext={`Tiến trình: ${evo?.stage?.readiness_pct || 0}% (mục tiêu 500 mẫu)`}
          icon={<Cpu className="h-4 w-4" />}
          tone="cyan"
        />
        <MetricCard
          label="Shadow Samples"
          value={`${shadowTotal.toLocaleString()}`}
          subtext={`Win Rate: ${shadowWinRate}% · ${shadowOpen} đang mở · ${samplesLearned} tích lũy`}
          icon={<Activity className="h-4 w-4" />}
          tone="emerald"
        />
        <MetricCard
          label={lang === 'en' ? 'Quantitative Rules' : 'Quy Tắc Định Lượng'}
          value={`${learnedSkillsCount} + ${builtinSkillsCount}`}
          subtext="Kho quy tắc định lượng nội bộ & cốt lõi"
          icon={<Layers className="h-4 w-4" />}
          tone="amber"
        />
        <MetricCard
          label="Gemini Key Pool"
          value={`${activeKeysCount} / ${geminiPool.length}`}
          subtext={
            geminiPool.filter((k) => k.status === 'exhausted' || k.status === 'rate_limited').length > 0
              ? 'Có key đang hạ nhiệt'
              : 'Pool hoạt động ổn định'
          }
          icon={<KeyRound className="h-4 w-4" />}
          tone={activeKeysCount > 0 ? 'emerald' : 'rose'}
        />
      </div>

      {/* 2. AUTO-PROMOTE TOGGLE */}
      <Panel
        title="Tự Động Thăng Hạng Nguồn Nghiên Cứu Đạt Chuẩn (Auto-Promote)"
        subtitle="Tự động chuyển nguồn từ SHADOW_ONLY sang ACTIVE_LIVE khi đạt tối thiểu 30 mẫu, WinRate >= 58% và Expectancy > 0"
        action={
          <button
            type="button"
            onClick={handleToggleAutoPromote}
            className={autoPromote ? 'quant-btn-primary text-xs' : 'quant-btn-secondary text-xs'}
          >
            {autoPromote ? 'Đang bật: Tự tiến hóa' : 'Đang tắt: Chỉ giám sát'}
          </button>
        }
        bodyClassName="hidden"
      >
        {null}
      </Panel>

      {/* 3. STRATEGY VERSION HISTORY & ROLLBACK */}
      <Panel
        icon={<History className="h-4 w-4 text-cyan-300" />}
        title={lang === 'en' ? 'Strategy Version History & Restore Points' : 'Lịch Sử Phiên Bản Chiến Lược & Khôi Phục'}
        subtitle={lang === 'en' ? 'Retains up to 10 recent versions' : 'Lưu trữ tối đa 10 phiên bản gần nhất'}
      >
        {strategyHistory.length === 0 ? (
          <EmptyState
            icon={<History className="h-5 w-5" />}
            title={lang === 'en' ? 'No version history stored' : 'Chưa có lịch sử phiên bản'}
            description={
              lang === 'en'
                ? 'Approved and rolled-back Walk-Forward iterations appear here.'
                : 'Các phiên bản chiến lược WFO đã duyệt hoặc khôi phục sẽ hiển thị tại đây.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="quant-table font-mono text-xs tabular-nums">
              <thead>
                <tr>
                  <th>{lang === 'en' ? 'Version & Name' : 'Phiên Bản & Tên'}</th>
                  <th>{lang === 'en' ? 'Status' : 'Trạng Thái'}</th>
                  <th>Win Rate</th>
                  <th>Profit Factor</th>
                  <th>Max DD</th>
                  <th>Mẫu</th>
                  <th>Cập Nhật</th>
                  <th className="text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody>
                {strategyHistory.map((strat) => {
                  const isLive = strat.status === 'APPROVED_FOR_PROD';
                  const isRolling = rollingBackId === strat.id;
                  return (
                    <tr key={strat.id}>
                      <td>
                        <div className="font-sans font-semibold text-white">{strat.name}</div>
                        <div className="text-[11px] text-slate-500">{strat.id}</div>
                      </td>
                      <td>
                        <StatusBadge
                          tone={isLive ? 'success' : strat.status === 'ROLLED_BACK' ? 'warning' : 'neutral'}
                        >
                          {isLive ? 'ACTIVE' : strat.status}
                        </StatusBadge>
                      </td>
                      <td className="text-cyan-300 font-semibold">{strat.win_rate_pct}%</td>
                      <td className="text-emerald-400 font-semibold">{strat.profit_factor}</td>
                      <td className="text-rose-300">{strat.max_drawdown_pct}%</td>
                      <td>{strat.sample_size}</td>
                      <td className="text-slate-400 text-[11px]">
                        {formatDateTime(strat.updated_at || strat.created_at)}
                      </td>
                      <td className="text-right">
                        {isLive ? (
                          <span className="font-sans text-xs font-semibold text-emerald-400">Đang kích hoạt</span>
                        ) : (
                          <button
                            type="button"
                            disabled={isRolling}
                            onClick={() => setRollbackConfirmCandidate(strat)}
                            className="quant-quiet min-h-[30px] px-2.5 py-1 text-[11px] text-amber-300"
                          >
                            {isRolling ? 'Đang khôi phục...' : 'Khôi phục'}
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
      </Panel>

      {/* ROLLBACK CONFIRMATION MODAL */}
      {rollbackConfirmCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#0B1220] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-amber-300">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white">Xác Nhận Khôi Phục Chiến Lược</h4>
                <p className="text-xs text-slate-400">Thao tác này thay thế phiên bản kích hoạt hiện tại</p>
              </div>
            </div>

            <div className="rounded-xl bg-[#060A13] p-4 border border-slate-800 space-y-2 text-xs text-slate-300 leading-relaxed">
              <div>
                Khôi phục chiến lược <strong className="text-cyan-300">{rollbackConfirmCandidate.name}</strong> (
                #{rollbackConfirmCandidate.id.slice(0, 8)}) làm phiên bản kích hoạt chính thức?
              </div>
              <div className="text-[11px] text-slate-400">
                Phiên bản hiện tại sẽ chuyển sang trạng thái ROLLED_BACK để dự phòng.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setRollbackConfirmCandidate(null)}
                className="quant-btn-secondary text-xs"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={rollingBackId === rollbackConfirmCandidate.id}
                onClick={() => handleExecuteRollback(rollbackConfirmCandidate.id)}
                className="quant-btn-primary text-xs"
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
