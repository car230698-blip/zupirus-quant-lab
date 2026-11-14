import React, { useState } from 'react';
import type { AgentActivitySnapshot } from '../quant/agentActivityTracker.ts';
import type { DualCostStressComparison } from '../quant/costStress.ts';
import type { LearningBranchFixtureSuiteReport } from '../quant/fixtures.ts';
import type {
  QuantSystemState,
  ReplayDatasetMetadata,
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

export interface AdminOperationsViewProps {
  state: QuantSystemState;
  datasetMetadata: ReplayDatasetMetadata;
  storagePaths: {
    stateFilePath: string;
    journalFilePath: string;
    tickBatchLogPath?: string;
  };
  currentRole: UserRole;
  agentActivity: AgentActivitySnapshot;
  costComparison: DualCostStressComparison | null;
  fixturesReport: LearningBranchFixtureSuiteReport | null;
  recentEventIds: Set<string>;
  authToken: string;
  simulatedHost?: string | null;
  initialSubTab?: AdminSubTabId;
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
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <StatusLabel
                label={`Quyền Backend: ${currentRole}`}
                tone={isAdmin ? 'emerald' : 'cyan'}
                mono
              />
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-200">
                Tiến độ: {state.replayCursorIndex}/{state.totalReplayCandles} nến M15
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Vòng lặp:{' '}
                <strong className="text-cyan-300">
                  {state.isLoopRunning
                    ? 'Đang tự chạy'
                    : state.isReplayComplete
                    ? 'Đã hoàn tất'
                    : 'Đang tạm dừng'}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">
                Khôi phục sau khởi động lại: {state.restartCount} lần
              </span>
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
                className="px-3.5 py-2 text-xs font-medium rounded-md bg-cyan-500 hover:bg-cyan-400 active:scale-[0.98] disabled:opacity-50 text-slate-950 font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 whitespace-nowrap shrink-0"
              >
                {state.isLoopRunning ? 'Tạm dừng Vòng lặp' : 'Tiếp tục Vòng lặp'}
              </button>
              <button
                type="button"
                disabled={actionBusy || state.isReplayComplete}
                onClick={onStepNextCandle}
                className="px-3.5 py-2 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 active:scale-[0.98] disabled:opacity-50 text-slate-100 border border-slate-700 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0"
              >
                Chạy 1 Nến M15
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={onResetSimulation}
                className="px-3.5 py-2 text-xs font-medium rounded-md bg-rose-950/70 hover:bg-rose-900/70 active:scale-[0.98] disabled:opacity-50 text-rose-200 border border-rose-500/40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 whitespace-nowrap shrink-0"
              >
                Đặt lại Mô phỏng
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
          role="tablist"
          aria-label="Các phân khu quản trị định lượng"
        >
          {(
            [
              {
                id: 'AGENT_ACTIVITY',
                label: 'Hoạt động Agent & Nhật ký Dòng thời gian',
              },
              {
                id: 'WALK_FORWARD',
                label: 'Kiểm định Walk-Forward & Chính sách',
              },
              {
                id: 'CYCLE_INSPECTOR',
                label: 'Kiểm tra Chu kỳ Nến & Chốt Rủi ro',
              },
              {
                id: 'TRACEABILITY_STRESS',
                label: 'Nguồn Dữ liệu, Chi phí 2× & Truy vết',
              },
            ] as const
          ).map((tab) => {
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSubTab(tab.id)}
                className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                {tab.label}
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
          dataProvenance={agentActivity.dataProvenance}
          fixturesReport={fixturesReport}
        />
      )}

      {subTab === 'CYCLE_INSPECTOR' && <CycleInspectorSection state={state} />}

      {subTab === 'TRACEABILITY_STRESS' && (
        <TraceabilityAndStressSection
          state={state}
          costComparison={costComparison}
          authToken={authToken}
          simulatedHost={simulatedHost}
        />
      )}
    </div>
  );
};
