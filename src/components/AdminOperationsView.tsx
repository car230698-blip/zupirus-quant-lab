import { fetchPositionTraceById, fetchLearningTraceById } from '../api/quantApi.ts';
import React, { useState } from 'react';
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
import { StatusLabel } from './shared/UiPrimitives.tsx';

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
      {/* 1. Admin Operations Header & Replay Control Bar (controls strictly restricted to ADMIN role) */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Vận hành</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <StatusLabel
                label={isLiveMt5 ? 'MT5 demo' : state.isReplayComplete ? 'Replay hoàn tất' : state.isLoopRunning ? 'Đang phát lại' : 'Replay tạm dừng'}
                tone="slate"
              />
              {!isLiveMt5 && <span>{state.replayCursorIndex}/{state.totalReplayCandles} nến M15</span>}
            </div>
            <p className="text-xs text-slate-400">
              Giờ thị trường gần nhất: {formatUtcShort(state.lastProcessedMarketTime)} ·
              Cập nhật máy chủ: {formatUtcShort(state.lastUpdatedSystemTime)}
            </p>
          </div>

          {/* Admin-only simulation controls */}
          {isAdmin && !isLiveMt5 ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={actionBusy || state.isReplayComplete}
                onClick={onToggleAutoLoop}
                className="px-3.5 py-2 text-sm font-medium rounded-md bg-cyan-500 hover:bg-cyan-400 active:scale-[0.98] disabled:opacity-50 text-slate-950 font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 whitespace-nowrap shrink-0"
              >
                {state.isLoopRunning ? 'Tạm dừng' : 'Tiếp tục'}
              </button>
              <button
                type="button"
                disabled={actionBusy || state.isReplayComplete}
                onClick={onStepNextCandle}
                className="px-3.5 py-2 text-sm font-medium rounded-md bg-slate-800 hover:bg-slate-700 active:scale-[0.98] disabled:opacity-50 text-slate-100 border border-slate-700 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0"
              >
                Chạy 1 nến
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={onResetSimulation}
                className="px-3.5 py-2 text-sm font-medium rounded-md bg-rose-950/70 hover:bg-rose-900/70 active:scale-[0.98] disabled:opacity-50 text-rose-200 border border-rose-500/40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 whitespace-nowrap shrink-0"
              >
                Đặt lại replay
              </button>
            </div>
          ) : (
            <div className="text-xs text-slate-400 font-mono">
              {isLiveMt5
                ? 'Luồng MT5 Demo Trực tiếp (Tự vận hành theo báo giá)'
                : 'Chế độ Chỉ xem (VIEWER — Các nút điều khiển yêu cầu quyền ADMIN)'}
            </div>
          )}
        </div>

        {actionFeedbackVi && (
          <div className="px-3 py-2 rounded bg-slate-950 border border-slate-800 text-xs text-cyan-300 font-mono">
            {actionFeedbackVi}
          </div>
        )}

        {/* Sub-navigation Tabs */}
        <div
          className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800"
          role="navigation"
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
                className={`px-3.5 py-2 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                {tab.labelVi}
              </button>
            );
          })}
        </div>
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
          onFetchPositionTrace={id => fetchPositionTraceById(id, authToken, simulatedHost)}
          onFetchLearningTrace={id => fetchLearningTraceById(id, authToken, simulatedHost)}
        />
      )}
    </div>
  );
};
