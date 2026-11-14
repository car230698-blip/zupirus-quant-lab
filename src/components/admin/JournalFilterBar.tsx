import React from 'react';
import {
  AGENT_OPERATIONAL_STATE_LABELS_VI,
  type AgentOperationalStateCode,
} from '../../quant/agentActivityTracker.ts';

export interface JournalFilterProps {
  teamFilter: 'ALL' | 'TEAM_1_EXECUTION' | 'TEAM_2_RESEARCH' | 'ORCHESTRATOR';
  onChangeTeamFilter: (val: 'ALL' | 'TEAM_1_EXECUTION' | 'TEAM_2_RESEARCH' | 'ORCHESTRATOR') => void;
  stateFilter: 'ALL' | AgentOperationalStateCode;
  onChangeStateFilter: (val: 'ALL' | AgentOperationalStateCode) => void;
  cycleFilter: string;
  onChangeCycleFilter: (val: string) => void;
  availableCycleIds: string[];
  totalCount: number;
  filteredCount: number;
  onResetFilters: () => void;
}

export const JournalFilterBar: React.FC<JournalFilterProps> = ({
  teamFilter,
  onChangeTeamFilter,
  stateFilter,
  onChangeStateFilter,
  cycleFilter,
  onChangeCycleFilter,
  availableCycleIds,
  totalCount,
  filteredCount,
  onResetFilters,
}) => {
  const hasActiveFilter =
    teamFilter !== 'ALL' || stateFilter !== 'ALL' || cycleFilter !== 'ALL';

  return (
    <div className="flex flex-wrap items-end justify-between gap-3 bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 flex-1 min-w-[260px]">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          <span>Đội vận hành</span>
          <select
            aria-label="Lọc theo đội"
            value={teamFilter}
            onChange={(e) =>
              onChangeTeamFilter(e.target.value as JournalFilterProps['teamFilter'])
            }
            className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2.5 py-1.5 focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <option value="ALL">Tất cả đội ({totalCount})</option>
            <option value="TEAM_1_EXECUTION">Đội 1 — Phân tích &amp; Thực thi</option>
            <option value="TEAM_2_RESEARCH">Đội 2 — Nghiên cứu &amp; Kiểm định</option>
            <option value="ORCHESTRATOR">Bộ điều phối Hệ thống</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-400">
          <span>Trạng thái vận hành</span>
          <select
            aria-label="Lọc theo trạng thái"
            value={stateFilter}
            onChange={(e) =>
              onChangeStateFilter(e.target.value as 'ALL' | AgentOperationalStateCode)
            }
            className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2.5 py-1.5 focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <option value="ALL">Mọi trạng thái</option>
            {(Object.keys(AGENT_OPERATIONAL_STATE_LABELS_VI) as AgentOperationalStateCode[]).map(
              (code) => (
                <option key={code} value={code}>
                  {AGENT_OPERATIONAL_STATE_LABELS_VI[code]}
                </option>
              )
            )}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-400">
          <span>Chu kỳ M15</span>
          <select
            aria-label="Lọc theo chu kỳ"
            value={cycleFilter}
            onChange={(e) => onChangeCycleFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono rounded px-2.5 py-1.5 focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <option value="ALL">Tất cả chu kỳ ({availableCycleIds.length})</option>
            {availableCycleIds.slice(0, 60).map((cid) => (
              <option key={cid} value={cid}>
                {cid}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2.5 text-xs">
        <span className="text-slate-400 font-mono tabular-nums">
          Hiển thị {filteredCount}/{totalCount} sự kiện
        </span>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={onResetFilters}
            className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-colors cursor-pointer"
          >
            Xóa bộ lọc
          </button>
        )}
      </div>
    </div>
  );
};
