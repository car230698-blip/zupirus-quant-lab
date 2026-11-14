import React, { useState } from 'react';
import { fetchLearningTraceById, fetchPositionTraceById } from '../api/quantApi.ts';
import type { AgentActivitySnapshot } from '../quant/agentActivityTracker.ts';
import type { DualCostStressComparison } from '../quant/costStress.ts';
import type { LearningBranchFixtureSuiteReport } from '../quant/fixtures.ts';
import type {
  QuantSystemState,
  UserRole,
} from '../quant/types.ts';
import { formatUtcShort } from '../utils/formatters.ts';
import { AgentActivitySection } from './admin/AgentActivitySection.tsx';
import { CycleInspectorSection } from './admin/CycleInspectorSection.tsx';
import { TraceabilityAndStressSection } from './admin/TraceabilityAndStressSection.tsx';
import { WalkForwardSection } from './admin/WalkForwardSection.tsx';
import { ProvenanceBadge, StatusLabel } from './shared/UiPrimitives.tsx';

export type AdminSubTabId =
  | 'AGENT_ACTIVITY'
  | 'WALK_FORWARD'
  | 'CYCLE_INSPECTOR'
  | 'TRACEABILITY_STRESS';

export const ADMIN_TABS = [
  { id: 'AGENT_ACTIVITY', labelVi: 'Hoạt động' },
  { id: 'WALK_FORWARD', labelVi: 'Kiểm định' },
  { id: 'CYCLE_INSPECTOR', labelVi: 'Chu kỳ' },
  { id: 'TRACEABILITY_STRESS', labelVi: 'Truy vết' },
] as const;

export interface AdminOperationsViewProps {
  state: QuantSystemState;
  currentRole: UserRole;
  agentActivity: AgentActivitySnapshot;
  costComparison: DualCostStressComparison | null;
  fixturesReport: LearningBranchFixtureSuiteReport | null;
  recentEventIds: Set<string>;
  authToken: string;
  simulatedHost?: string | null;
  initialSubTab?: AdminSubTabId;
  onRefreshReports: () => void;
  actionBusy: boolean;
  actionFeedbackVi: string | null;
  onStepNextCandle: () => void;
  onToggleAutoLoop: () => void;
  onResetSimulation: () => void;
}

export const AdminOperationsView: React.FC<AdminOperationsViewProps> = ({
  state,
  currentRole,
  agentActivity,
  costComparison,
  fixturesReport,
  recentEventIds,
  authToken,
  simulatedHost,
  initialSubTab = 'AGENT_ACTIVITY',
  actionBusy,
  onRefreshReports,
  actionFeedbackVi,
  onStepNextCandle,
  onToggleAutoLoop,
  onResetSimulation,
}) => {
  const [subTab, setSubTab] = useState<AdminSubTabId>(initialSubTab);

  const isAdmin = currentRole === 'ADMIN';
  const isLiveMt5 = state.dataSourceTelemetry?.sourceMode === 'MT5_DEMO_LIVE';

  return (
    <div className="space-y-6">
      {/* 1. Admin Operations Control Bar */}
      <section className="bg-[#0c1322] border border-[#1e293b] rounded-xl p-5 sm:p-6 space-y-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-slate-100">
                Vận hành
              </h1>
              <ProvenanceBadge mode={isLiveMt5 ? 'MT5_DEMO' : 'REPLAY'} />
              <StatusLabel
                label={
                  isLiveMt5
                    ? 'MT5 demo'
                    : state.isReplayComplete
                    ? 'Replay hoàn tất'
                    : state.isLoopRunning
                    ? 'Đang phát lại'
                    : 'Replay tạm dừng'
                }
                tone={state.isLoopRunning ? 'cyan' : state.isReplayComplete ? 'emerald' : 'amber'}
                pulse={state.isLoopRunning}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-slate-400">
              {!isLiveMt5 && (
                <span className="bg-[#080d1a] border border-slate-800/80 px-2.5 py-1 rounded-md text-slate-300">
                  Tiến độ: <strong className="text-cyan-400">{state.replayCursorIndex}/{state.totalReplayCandles}</strong> nến M15
                </span>
              )}
              <span>Giờ thị trường gần nhất: {formatUtcShort(state.lastProcessedMarketTime)}</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>Cập nhật máy chủ: {formatUtcShort(state.lastUpdatedSystemTime)}</span>
            </div>
          </div>

          {/* Admin Controls (strictly restricted to ADMIN role) */}
          {isAdmin && !isLiveMt5 ? (
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                disabled={actionBusy || state.isReplayComplete}
                onClick={onToggleAutoLoop}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-cyan-500 hover:bg-cyan-400 active:scale-[0.98] disabled:opacity-50 text-slate-950 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 shadow-sm whitespace-nowrap shrink-0"
              >
                {state.isLoopRunning ? 'Tạm dừng' : 'Tiếp tục'}
              </button>
              <button
                type="button"
                disabled={actionBusy || state.isReplayComplete}
                onClick={onStepNextCandle}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#141e33] hover:bg-[#1a2845] active:scale-[0.98] disabled:opacity-50 text-slate-200 border border-slate-700/80 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0"
              >
                Chạy 1 nến
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={onResetSimulation}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-rose-950/40 hover:bg-rose-900/60 active:scale-[0.98] disabled:opacity-50 text-rose-300 border border-rose-800/50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 whitespace-nowrap shrink-0"
              >
                Đặt lại replay
              </button>
            </div>
          ) : (
            <div className="text-xs text-slate-400 font-mono bg-[#080d1a] border border-slate-800/80 px-3 py-1.5 rounded-lg">
              {isLiveMt5
                ? 'Luồng MT5 Demo Trực tiếp (Tự vận hành theo báo giá)'
                : 'Chế độ Chỉ xem (VIEWER — Các nút điều khiển yêu cầu quyền ADMIN)'}
            </div>
          )}
        </div>

        {actionFeedbackVi && (
          <div className="px-3.5 py-2.5 rounded-lg bg-cyan-950/30 border border-cyan-800/60 text-xs text-cyan-300 font-mono animate-in fade-in duration-150">
            {actionFeedbackVi}
          </div>
        )}

        {/* Single-level navigation: Hoạt động, Kiểm định, Chu kỳ, Truy vết */}
        <nav
          className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#1e293b]"
          aria-label="Các phân khu quản trị định lượng"
        >
          {ADMIN_TABS.map((tab) => {
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setSubTab(tab.id)}
                className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/60 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                }`}
              >
                {tab.labelVi}
              </button>
            );
          })}
        </nav>
      </section>

      {/* 2. Active Admin Sub-Section */}
      {subTab === 'AGENT_ACTIVITY' && (
        <AgentActivitySection
          state={state}
          activity={agentActivity}
          recentEventIds={recentEventIds}
        />
      )}

      {subTab === 'WALK_FORWARD' && (
        <WalkForwardSection
          state={state}
          fixtureReport={fixturesReport}
          actionPending={actionBusy}
          onRefreshReports={onRefreshReports}
        />
      )}

      {subTab === 'CYCLE_INSPECTOR' && <CycleInspectorSection state={state} />}

      {subTab === 'TRACEABILITY_STRESS' && (
        <TraceabilityAndStressSection
          state={state}
          stressReport={costComparison}
          actionPending={actionBusy}
          onRefreshReports={onRefreshReports}
          onFetchPositionTrace={(id) => fetchPositionTraceById(id, authToken, simulatedHost)}
          onFetchLearningTrace={(id) => fetchLearningTraceById(id, authToken, simulatedHost)}
        />
      )}
    </div>
  );
};
