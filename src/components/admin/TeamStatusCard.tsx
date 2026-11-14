import React from 'react';
import type {
  EnrichedTeamActivityCard,
  PipelineStepState,
} from '../../quant/agentActivityTracker.ts';
import {
  OPERATIONAL_STATE_TONES,
  formatCleanJournalMessageVi,
  formatUtcShort,
} from '../../utils/formatters.ts';
import { StatusLabel } from '../shared/UiPrimitives.tsx';

const STEP_DOT_CLASSES: Record<PipelineStepState['status'], string> = {
  COMPLETED: 'bg-emerald-400',
  ACTIVE: 'bg-cyan-400 animate-pulse',
  WAITING: 'bg-amber-400',
  VETOED_OR_HALTED: 'bg-rose-400',
  IDLE: 'bg-slate-600',
};

const STEP_STATUS_LABELS_VI: Record<PipelineStepState['status'], string> = {
  COMPLETED: 'Hoàn tất',
  ACTIVE: 'Đang chạy',
  WAITING: 'Đang chờ',
  VETOED_OR_HALTED: 'Chặn / Dừng',
  IDLE: 'Chờ kích hoạt',
};

export const TeamStatusCard: React.FC<{
  card: EnrichedTeamActivityCard;
  accentColor: 'cyan' | 'emerald';
}> = ({ card, accentColor }) => {
  const opTone = OPERATIONAL_STATE_TONES[card.operationalState] ?? 'slate';
  const topBorderClass =
    accentColor === 'cyan' ? 'border-t-2 border-t-cyan-500/80' : 'border-t-2 border-t-emerald-500/80';

  const completedStepsCount = card.pipelineSteps.filter((s) => s.status === 'COMPLETED').length;

  return (
    <article
      className={`bg-slate-900/90 border border-slate-800 ${topBorderClass} rounded-lg p-4 sm:p-5 flex flex-col justify-between gap-4`}
      aria-label={card.teamNameVi}
    >
      <div className="space-y-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-800/80">
          <div>
            <h3 className="text-base font-display font-semibold text-slate-100">
              {card.teamNameVi}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Cập nhật thị trường: <span className="font-mono tabular-nums text-slate-300">{formatUtcShort(card.lastRunMarketTime)}</span>
            </p>
          </div>
          <StatusLabel label={card.operationalStateLabelVi} tone={opTone} />
        </div>

        <dl className="space-y-2.5 text-sm">
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-md p-3">
            <dt className="text-xs font-medium text-slate-400 mb-1">Công việc hiện tại</dt>
            <dd className="text-slate-100 font-medium leading-snug">
              {formatCleanJournalMessageVi(card.currentTaskVi)}
            </dd>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 rounded-md p-3">
            <dt className="text-xs font-medium text-slate-400 mb-1">Kết quả gần nhất</dt>
            <dd className="text-slate-200 leading-snug">
              {formatCleanJournalMessageVi(card.latestOutcomeVi)}
            </dd>
          </div>

          <div
            className={`rounded-md p-3 border ${
              card.waitOrHaltReasonVi
                ? opTone === 'rose'
                  ? 'bg-rose-950/25 border-rose-500/35 text-rose-200'
                  : 'bg-amber-950/25 border-amber-500/35 text-amber-200'
                : 'bg-slate-950/40 border-slate-800/60 text-slate-400'
            }`}
          >
            <dt className="text-xs font-medium opacity-85 mb-0.5">Lý do chờ / Trạng thái tiếp theo</dt>
            <dd className="text-xs sm:text-sm leading-snug">
              {card.waitOrHaltReasonVi
                ? formatCleanJournalMessageVi(card.waitOrHaltReasonVi)
                : 'Không có rào cản — sẵn sàng xử lý ngay khi nến M15 mới đóng.'}
            </dd>
          </div>
        </dl>
      </div>

      <details className="group border-t border-slate-800/80 pt-3">
        <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-xs font-medium text-cyan-300 hover:text-cyan-200 focus-visible:outline-2 focus-visible:outline-cyan-400 rounded py-0.5">
          <span>
            Chi tiết pipeline ({completedStepsCount}/{card.pipelineSteps.length} bước hoàn tất) &amp; mã kỹ thuật
          </span>
          <span className="font-mono text-[11px] text-slate-400 group-open:rotate-180 transition-transform">
            ▼
          </span>
        </summary>

        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap gap-2 text-[11px] font-mono text-slate-400 bg-slate-950/80 border border-slate-800/80 rounded px-2.5 py-1.5">
            <span>Mã đội: {card.teamId}</span>
            <span>•</span>
            <span>Mã trạng thái: {card.operationalState}</span>
            <span>•</span>
            <span>Số lượt xử lý: {card.processedCount}</span>
          </div>

          <ol className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {card.pipelineSteps.map((step) => (
              <li
                key={step.stepId}
                className="p-2.5 rounded border border-slate-800/80 bg-slate-950/60 flex flex-col justify-between gap-1"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STEP_DOT_CLASSES[step.status]}`} />
                    {step.stepIndex}. {step.labelVi}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {STEP_STATUS_LABELS_VI[step.status]}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 leading-snug">{step.detailVi}</div>
              </li>
            ))}
          </ol>
        </div>
      </details>
    </article>
  );
};
