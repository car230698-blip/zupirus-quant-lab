import React, { useMemo, useState } from 'react';
import {
  AGENT_OPERATIONAL_STATE_LABELS_VI,
  AgentActivitySnapshot,
  AgentOperationalStateCode,
  EnrichedTimelineEvent,
  inspectTimelineEvent,
} from '../../quant/agentActivityTracker.ts';
import { QuantSystemState } from '../../quant/types.ts';
import {
  formatUtcShort,
  OPERATIONAL_STATE_TONES,
} from '../../utils/formatters.ts';
import { EmptyDataNotice, SectionHeader, SlideOverDrawer, StatusLabel } from '../shared/UiPrimitives.tsx';
import { TimelineEventDetail } from './TimelineEventDetail.tsx';

export interface ActivityJournalTimelineProps {
  state: QuantSystemState;
  activity: AgentActivitySnapshot;
  recentEventIds: Set<string>;
}

export const ActivityJournalTimeline: React.FC<ActivityJournalTimelineProps> = ({
  state,
  activity,
  recentEventIds,
}) => {
  const [teamFilter, setTeamFilter] = useState<
    'ALL' | 'TEAM_1_EXECUTION' | 'TEAM_2_RESEARCH' | 'ORCHESTRATOR'
  >('ALL');
  const [stateFilter, setStateFilter] = useState<'ALL' | AgentOperationalStateCode>('ALL');
  const [cycleFilter, setCycleFilter] = useState<string>('ALL');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const filteredTimeline = useMemo(() => {
    return activity.timeline.filter((ev) => {
      if (teamFilter !== 'ALL' && ev.team !== teamFilter) return false;
      if (stateFilter !== 'ALL' && ev.operationalState !== stateFilter) return false;
      if (cycleFilter !== 'ALL' && ev.cycleId !== cycleFilter) return false;
      return true;
    });
  }, [activity.timeline, teamFilter, stateFilter, cycleFilter]);

  const selectedEvent: EnrichedTimelineEvent | null = useMemo(() => {
    if (!selectedEventId) return null;
    return activity.timeline.find((e) => e.entryId === selectedEventId) ?? null;
  }, [selectedEventId, activity.timeline]);

  const activeInspection = useMemo(() => {
    if (!selectedEventId) return null;
    return inspectTimelineEvent(state, selectedEventId);
  }, [selectedEventId, state]);

  return (
    <section className="bg-[#0c1322] border border-[#1e293b] rounded-xl p-5 sm:p-6 space-y-5 shadow-sm">
      <SectionHeader
        title="Nhật ký hoạt động"
        subtitle="Dòng sự kiện kiểm định, chốt rủi ro và thực thi được đồng bộ trực tiếp từ máy chủ định lượng."
        rightSlot={
          <span className="text-xs font-mono tabular-nums text-slate-400 bg-[#080d1a] border border-slate-800/80 px-2.5 py-1 rounded-md">
            Hiển thị {filteredTimeline.length}/{activity.timeline.length} sự kiện
          </span>
        }
      />

      {/* Filter Bar with required test IDs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#080d1a] border border-slate-800/80 rounded-xl p-4 text-xs">
        <div>
          <label htmlFor="agent-team-filter" className="block text-slate-400 font-medium mb-1.5 uppercase tracking-wider text-[11px]">
            Đội
          </label>
          <select
            id="agent-team-filter"
            value={teamFilter}
            onChange={(e) =>
              setTeamFilter(e.target.value as 'ALL' | 'TEAM_1_EXECUTION' | 'TEAM_2_RESEARCH' | 'ORCHESTRATOR')
            }
            className="w-full bg-[#0c1322] border border-slate-700/80 rounded-lg px-3 py-2 text-slate-100 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 transition-colors"
          >
            <option value="ALL">Tất cả các đội</option>
            <option value="TEAM_1_EXECUTION">Phân tích &amp; thực thi</option>
            <option value="TEAM_2_RESEARCH">Nghiên cứu &amp; kiểm định</option>
            <option value="ORCHESTRATOR">Bộ điều phối Hệ thống</option>
          </select>
        </div>

        <div>
          <label htmlFor="agent-state-filter" className="block text-slate-400 font-medium mb-1.5 uppercase tracking-wider text-[11px]">
            Trạng thái
          </label>
          <select
            id="agent-state-filter"
            value={stateFilter}
            onChange={(e) =>
              setStateFilter(e.target.value as 'ALL' | AgentOperationalStateCode)
            }
            className="w-full bg-[#0c1322] border border-slate-700/80 rounded-lg px-3 py-2 text-slate-100 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 transition-colors"
          >
            <option value="ALL">Tất cả trạng thái</option>
            {(
              Object.keys(AGENT_OPERATIONAL_STATE_LABELS_VI) as AgentOperationalStateCode[]
            ).map((code) => (
              <option key={code} value={code}>
                {AGENT_OPERATIONAL_STATE_LABELS_VI[code]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="agent-cycle-filter" className="block text-slate-400 font-medium mb-1.5 uppercase tracking-wider text-[11px]">
            Chu kỳ
          </label>
          <select
            id="agent-cycle-filter"
            value={cycleFilter}
            onChange={(e) => setCycleFilter(e.target.value)}
            className="w-full bg-[#0c1322] border border-slate-700/80 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 transition-colors"
          >
            <option value="ALL">Tất cả chu kỳ ({activity.availableCycleIds.length})</option>
            {activity.availableCycleIds.map((cid) => (
              <option key={cid} value={cid}>
                {cid}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Timeline event listing */}
      {filteredTimeline.length === 0 ? (
        <EmptyDataNotice
          title="Không tìm thấy sự kiện nào"
          reasonVi="Bộ lọc hiện tại không khớp với sự kiện nào trong nhật ký hoạt động. Vui lòng thử chọn lại đội, trạng thái hoặc chu kỳ."
        />
      ) : (
        <div className="space-y-2.5 max-h-[580px] overflow-y-auto pr-1">
          {filteredTimeline.map((ev) => {
            const isRecent = recentEventIds.has(ev.entryId);
            const isSelected = selectedEventId === ev.entryId;
            const tone = OPERATIONAL_STATE_TONES[ev.operationalState] ?? 'slate';

            return (
              <article
                key={ev.entryId}
                onClick={() => setSelectedEventId(ev.entryId)}
                className={`p-3.5 sm:p-4 rounded-xl border text-xs cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-[#131d33] border-cyan-500 shadow-md ring-1 ring-cyan-500/50'
                    : isRecent
                    ? 'bg-cyan-950/20 border-cyan-500/60 animate-new-event'
                    : 'bg-[#080d1a] border-[#1e293b] hover:bg-[#101726] hover:border-slate-700'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-200">
                      {ev.teamLabelVi}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="text-slate-400">{ev.taskTitleVi}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono tabular-nums">
                    <StatusLabel label={ev.operationalStateLabelVi} tone={tone} mono />
                    <span className="text-slate-400">{formatUtcShort(ev.timestampMarket)}</span>
                  </div>
                </div>

                <p className="text-slate-300 text-xs leading-relaxed font-sans mt-1">
                  {ev.messageVi}
                </p>

                {ev.cycleId && (
                  <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-400">
                    <span>Chu kỳ: <strong className="text-cyan-400">{ev.cycleId}</strong></span>
                    <span className="text-cyan-400 font-sans hover:underline">
                      Xem chi tiết sự kiện →
                    </span>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* SlideOverDrawer for event inspection */}
      {selectedEvent && (
        <SlideOverDrawer
          isOpen={Boolean(selectedEvent)}
          title={`Sự kiện ${selectedEvent.entryId}`}
          subtitle={`${selectedEvent.teamLabelVi} · ${selectedEvent.taskTitleVi} (${selectedEvent.cycleId})`}
          onClose={() => setSelectedEventId(null)}
        >
          <TimelineEventDetail
            event={selectedEvent}
            detail={activeInspection}
            loading={false}
          />
        </SlideOverDrawer>
      )}
    </section>
  );
};
