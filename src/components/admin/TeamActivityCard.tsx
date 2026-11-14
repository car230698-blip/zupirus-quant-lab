import React from 'react';
import {
  EnrichedTeamActivityCard,
} from '../../quant/agentActivityTracker.ts';
import {
  formatUtcShort,
  OPERATIONAL_STATE_TONES,
} from '../../utils/formatters.ts';
import { StatusLabel } from '../shared/UiPrimitives.tsx';

export interface TeamActivityCardProps {
  card: EnrichedTeamActivityCard;
  accentTone?: 'cyan' | 'emerald';
}

export const TeamActivityCard: React.FC<TeamActivityCardProps> = ({
  card,
  accentTone = 'cyan',
}) => {
  const tone = OPERATIONAL_STATE_TONES[card.operationalState] ?? 'slate';
  const topBorderClass =
    accentTone === 'cyan' ? 'border-t-2 border-t-cyan-500' : 'border-t-2 border-t-emerald-500';

  return (
    <div className={`bg-[#0c1322] border border-[#1e293b] ${topBorderClass} rounded-xl p-5 flex flex-col justify-between space-y-4 shadow-sm`}>
      <div className="space-y-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#1e293b] pb-3">
          <div>
            <h3 className="text-base font-display font-bold text-slate-100 tracking-tight">
              {card.teamNameVi}
            </h3>
          </div>
          <StatusLabel label={card.operationalStateLabelVi} tone={tone} pulse={card.isProcessingNow} />
        </div>

        {/* Operational Task & Outcome Metadata */}
        <div className="grid grid-cols-1 gap-2.5 text-xs">
          <div className="bg-[#080d1a] border border-slate-800/80 rounded-lg p-3">
            <div className="text-slate-400 font-medium uppercase tracking-wider text-[11px]">Tác vụ hiện tại</div>
            <div className="text-slate-100 font-semibold mt-1 leading-relaxed text-sm">
              {card.currentTaskVi || 'Chưa có sự kiện'}
            </div>
          </div>
          <div className="bg-[#080d1a] border border-slate-800/80 rounded-lg p-3">
            <div className="text-slate-400 font-medium uppercase tracking-wider text-[11px]">Kết quả gần nhất</div>
            <div className="text-slate-200 mt-1 leading-relaxed">
              {card.latestOutcomeVi || 'Chưa có sự kiện'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-400 px-1">
          <span>
            Lần chạy gần nhất:{' '}
            <strong className="text-slate-200">
              {formatUtcShort(card.lastRunMarketTime)}
            </strong>
          </span>
          <span>
            Đã xử lý:{' '}
            <strong className="text-cyan-400 font-bold">{card.processedCount}</strong>
          </span>
        </div>

        {card.waitOrHaltReasonVi && (
          <div className="px-3.5 py-2.5 rounded-lg bg-amber-950/30 border border-amber-900/60 text-xs text-amber-200">
            <span className="font-semibold text-amber-300">Lý do chờ / dừng: </span>
            {card.waitOrHaltReasonVi}
          </div>
        )}
      </div>

      {/* Expandable Pipeline Steps */}
      <details className="space-y-2 pt-3 border-t border-[#1e293b] group">
        <summary className="cursor-pointer text-xs font-semibold text-slate-300 hover:text-cyan-400 transition-colors list-none flex items-center justify-between">
          <span>Các bước xử lý ({card.pipelineSteps.length} bước)</span>
          <span className="text-slate-400 text-xs font-mono group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
          {card.pipelineSteps.map((step) => {
            const stepTone =
              step.status === 'COMPLETED'
                ? 'emerald'
                : step.status === 'ACTIVE'
                ? 'cyan'
                : step.status === 'VETOED_OR_HALTED'
                ? 'rose'
                : step.status === 'WAITING'
                ? 'amber'
                : 'slate';
            return (
              <div
                key={step.stepId}
                className="px-2.5 py-2 rounded-lg bg-[#080d1a] border border-slate-800/80 text-xs flex flex-col justify-between gap-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-200 truncate">
                    {step.stepIndex}. {step.labelVi}
                  </span>
                  <StatusLabel
                    label={
                      step.status === 'COMPLETED'
                        ? 'Hoàn tất'
                        : step.status === 'ACTIVE'
                        ? 'Đang chạy'
                        : step.status === 'VETOED_OR_HALTED'
                        ? 'Đã chặn'
                        : step.status === 'WAITING'
                        ? 'Chờ'
                        : 'Chưa chạy'
                    }
                    tone={stepTone}
                    mono
                  />
                </div>
                <div className="text-[11px] text-slate-400 leading-snug">
                  {step.detailVi}
                </div>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
};
