import React from 'react';
import type { AgentActivitySnapshot } from '../../quant/agentActivityTracker.ts';
import type { QuantSystemState } from '../../quant/types.ts';
import { SectionHeader } from '../shared/UiPrimitives.tsx';
import { ActivityJournalTimeline } from './ActivityJournalTimeline.tsx';
import { TeamActivityCard } from './TeamActivityCard.tsx';

export interface AgentActivitySectionProps {
  state: QuantSystemState;
  activity: AgentActivitySnapshot;
  recentEventIds: Set<string>;
}

export const AgentActivitySection: React.FC<AgentActivitySectionProps> = ({
  state,
  activity,
  recentEventIds,
}) => {
  return (
    <div className="space-y-6">
      {/* 1. Two Agent Teams at the Top */}
      <section className="space-y-4">
        <SectionHeader
          title="Hai đội vận hành"
          subtitle="Hai nhóm tác tử tự hành độc lập: Đội 1 chịu trách nhiệm phân tích nến và thực thi lệnh; Đội 2 chịu trách nhiệm học thích nghi và kiểm định Walk-Forward."
          rightSlot={
            <span className="text-xs font-mono text-cyan-400 bg-cyan-950/30 border border-cyan-800/60 px-3 py-1 rounded-md">
              Chế độ {activity.executionMode}
            </span>
          }
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TeamActivityCard card={activity.team1Execution} accentTone="cyan" />
          <TeamActivityCard card={activity.team2Research} accentTone="emerald" />
        </div>
      </section>

      {/* 2. Real-time Activity Journal immediately below */}
      <ActivityJournalTimeline
        state={state}
        activity={activity}
        recentEventIds={recentEventIds}
      />
    </div>
  );
};
