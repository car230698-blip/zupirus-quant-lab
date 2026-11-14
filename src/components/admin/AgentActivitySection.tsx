import React, { useMemo, useState } from 'react';
import {
  AGENT_OPERATIONAL_STATE_LABELS_VI,
  AgentActivitySnapshot,
  AgentOperationalStateCode,
  EnrichedTeamActivityCard,
  EnrichedTimelineEvent,
  inspectTimelineEvent,
} from '../../quant/agentActivityTracker.ts';
import { QuantSystemState, REGIME_LABELS_VI } from '../../quant/types.ts';
import {
  formatPct,
  formatPrice,
  formatSignedUsd,
  formatUsd,
  formatUtcShort,
  OPERATIONAL_STATE_TONES,
} from '../../utils/formatters.ts';
import {
  EmptyDataNotice,
  SectionHeader,
  StatusLabel,
} from '../shared/UiPrimitives.tsx';

export interface AgentActivitySectionProps {
  state: QuantSystemState;
  activity: AgentActivitySnapshot;
  recentEventIds: Set<string>;
}

const TeamActivityCardView: React.FC<{ card: EnrichedTeamActivityCard }> = ({
  card,
}) => {
  const tone = OPERATIONAL_STATE_TONES[card.operationalState] ?? 'slate';
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 flex flex-col justify-between space-y-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-display font-semibold text-slate-100 mt-0.5">
              {card.teamNameVi}
            </h3>
          </div>
          <StatusLabel label={card.operationalStateLabelVi} tone={tone} />
        </div>

        {/* Key Operational Metadata */}
        <div className="grid grid-cols-1 gap-2 text-sm">
          <div className="min-w-0">
            <div className="text-slate-400">Tác vụ hiện tại</div>
            <div className="text-slate-100 font-medium mt-1 leading-relaxed">
              {card.currentTaskVi || 'Chưa có sự kiện'}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-slate-400">Kết quả gần nhất</div>
            <div className="text-slate-200 mt-1 leading-relaxed">
              {card.latestOutcomeVi || 'Chưa có sự kiện'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-400">
          <span>
            Lần chạy gần nhất:{' '}
            <strong className="text-slate-200">
              {formatUtcShort(card.lastRunMarketTime)}
            </strong>
          </span>
          <span>
            Đã xử lý:{' '}
            <strong className="text-cyan-300">{card.processedCount}</strong>
          </span>
        </div>

        {card.waitOrHaltReasonVi && (
          <div className="px-3 py-2 rounded bg-slate-950 border border-slate-800 text-xs text-amber-200">
            <span className="font-medium text-amber-300">Lý do chờ / dừng: </span>
            {card.waitOrHaltReasonVi}
          </div>
        )}
      </div>

      {/* Pipeline Steps */}
      <details className="space-y-2 pt-3 border-t border-slate-800/80">
        <summary className="cursor-pointer text-sm font-medium text-slate-300">Các bước xử lý</summary>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                className="px-2.5 py-2 rounded bg-slate-950/80 border border-slate-800/80 text-xs flex flex-col justify-between gap-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-200">
                    {step.stepIndex}. {step.labelVi}
                  </span>
                  <StatusLabel label={step.status === 'COMPLETED' ? 'Hoàn tất' : step.status === 'ACTIVE' ? 'Đang xử lý' : step.status === 'VETOED_OR_HALTED' ? 'Đã chặn' : step.status === 'WAITING' ? 'Chờ' : 'Chưa chạy'} tone={stepTone} mono />
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

export const AgentActivitySection: React.FC<AgentActivitySectionProps> = ({
  state,
  activity,
  recentEventIds,
}) => {
  const [teamFilter, setTeamFilter] = useState<
    'ALL' | 'TEAM_1_EXECUTION' | 'TEAM_2_RESEARCH' | 'ORCHESTRATOR'
  >('ALL');
  const [stateFilter, setStateFilter] = useState<'ALL' | AgentOperationalStateCode>(
    'ALL'
  );
  const [cycleFilter, setCycleFilter] = useState<string>('ALL');
  const detailRef = React.useRef<HTMLElement>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const filteredTimeline = useMemo(() => {
    return activity.timeline.filter((ev) => {
      if (teamFilter !== 'ALL' && ev.team !== teamFilter) return false;
      if (stateFilter !== 'ALL' && ev.operationalState !== stateFilter) return false;
      if (cycleFilter !== 'ALL' && ev.cycleId !== cycleFilter) return false;
      return true;
    });
  }, [activity.timeline, teamFilter, stateFilter, cycleFilter]);

  const inspectedDetail = useMemo(() => {
    if (!selectedEventId) return null;
    return inspectTimelineEvent(state, selectedEventId);
  }, [state, selectedEventId]);

  React.useEffect(() => {
    if (selectedEventId) detailRef.current?.focus();
  }, [selectedEventId]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Hai đội vận hành</h2>
        <span className="text-sm text-slate-400">{activity.dataProvenance.labelVi}</span>
      </div>

      {/* Two Team Status Cards */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TeamActivityCardView card={activity.team1Execution} />
        <TeamActivityCardView card={activity.team2Research} />
      </section>

      {/* Filterable Timeline Journal */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
        <SectionHeader
          title="Nhật ký hoạt động"
          rightSlot={
            <span className="text-xs font-mono tabular-nums text-slate-400">
              Hiển thị {filteredTimeline.length}/{activity.timeline.length} sự kiện
            </span>
          }
        />

        {/* Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/70 border border-slate-800 rounded-lg p-3 text-xs">
          <div>
            <label
              htmlFor="agent-team-filter"
              className="block text-slate-400 mb-1 font-medium"
            >
              Đội
            </label>
            <select
              id="agent-team-filter"
              value={teamFilter}
              onChange={(e) =>
                setTeamFilter(
                  e.target.value as
                    | 'ALL'
                    | 'TEAM_1_EXECUTION'
                    | 'TEAM_2_RESEARCH'
                    | 'ORCHESTRATOR'
                )
              }
              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              <option value="ALL">Tất cả các đội</option>
              <option value="TEAM_1_EXECUTION">
                Phân tích &amp; thực thi
              </option>
              <option value="TEAM_2_RESEARCH">
                Nghiên cứu &amp; kiểm định
              </option>
              <option value="ORCHESTRATOR">Bộ điều phối Hệ thống</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="agent-state-filter"
              className="block text-slate-400 mb-1 font-medium"
            >
              Trạng thái
            </label>
            <select
              id="agent-state-filter"
              value={stateFilter}
              onChange={(e) =>
                setStateFilter(e.target.value as 'ALL' | AgentOperationalStateCode)
              }
              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              <option value="ALL">Tất cả trạng thái</option>
              {(
                Object.keys(
                  AGENT_OPERATIONAL_STATE_LABELS_VI
                ) as AgentOperationalStateCode[]
              ).map((code) => (
                <option key={code} value={code}>
                  {AGENT_OPERATIONAL_STATE_LABELS_VI[code]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="agent-cycle-filter"
              className="block text-slate-400 mb-1 font-medium"
            >
              Chu kỳ
            </label>
            <select
              id="agent-cycle-filter"
              value={cycleFilter}
              onChange={(e) => setCycleFilter(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
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

        {/* Timeline Rows */}
        {filteredTimeline.length === 0 ? (
          <EmptyDataNotice
            title="Chưa có sự kiện phù hợp bộ lọc"
            reasonVi={
              activity.timeline.length === 0
                ? 'Chưa có sự kiện nào được ghi nhận. Hệ thống đang chờ nến M15 đầu tiên đóng cửa.'
                : 'Không có dòng sự kiện nào khớp với bộ lọc Đội / Trạng thái / Chu kỳ đang chọn.'
            }
            lastUpdatedIso={state.lastUpdatedSystemTime}
          />
        ) : (
          <div className="max-h-[460px] overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800/70">
            {filteredTimeline.map((ev: EnrichedTimelineEvent) => {
              const isSelected = selectedEventId === ev.entryId;
              const isNew = recentEventIds.has(ev.entryId);
              const tone = OPERATIONAL_STATE_TONES[ev.operationalState] ?? 'slate';
              return (
                <button
                  key={ev.entryId}
                  type="button"
                  onClick={() =>
                    setSelectedEventId(isSelected ? null : ev.entryId)
                  }
                  className={`w-full text-left p-3 sm:px-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400 ${
                    isSelected
                      ? 'bg-cyan-950/35'
                      : 'hover:bg-slate-800/40 bg-slate-950/40'
                  } ${isNew ? 'animate-new-event' : ''}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-200">{ev.teamLabelVi}</span>
                      <span className="text-slate-400">{ev.taskTitleVi}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusLabel
                        label={ev.operationalStateLabelVi}
                        tone={tone}
                      />
                      <span className="font-mono tabular-nums text-slate-400">
                        {formatUtcShort(ev.timestampMarket)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1.5 text-sm text-slate-300 leading-relaxed">
                    {ev.messageVi}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Timeline Event Drill-Down Drawer / Card when an event row is clicked */}
      {inspectedDetail && (
        <section
          className="bg-slate-900 border border-cyan-500/40 rounded-lg p-4 sm:p-5 space-y-4"
          ref={detailRef}
          tabIndex={-1}
          aria-label="Chi tiết sự kiện đã chọn"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono">
                <span className="text-cyan-300 font-semibold">
                  {inspectedDetail.event.entryId}
                </span>
                <span aria-hidden="true">·</span>
                <span>{inspectedDetail.event.cycleId}</span>
                <span aria-hidden="true">·</span>
                <span>{inspectedDetail.event.eventCode}</span>
                <span aria-hidden="true">·</span>
                <span>{formatUtcShort(inspectedDetail.event.timestampMarket)}</span>
              </div>
              <h3 className="text-sm sm:text-base font-display font-semibold text-slate-100 mt-1">
                {inspectedDetail.event.teamLabelVi}: {inspectedDetail.event.taskTitleVi}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setSelectedEventId(null)}
              className="px-3 py-1.5 text-xs font-medium rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0"
            >
              Đóng bảng tra cứu
            </button>
          </div>

          <div className="px-3 py-2.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-200 leading-relaxed">
            {inspectedDetail.event.messageVi}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* 1. Input Candle & Market Regime */}
            <div className="bg-slate-950/80 border border-slate-800 rounded p-3.5 space-y-2">
              <div className="font-semibold text-cyan-300">
                1. Dữ liệu Đầu vào &amp; Trạng thái Thị trường
              </div>
              {inspectedDetail.cycleTrace ? (
                <div className="space-y-1.5 font-mono tabular-nums text-slate-300">
                  <div>
                    Nến: {inspectedDetail.cycleTrace.candle.candleId} (Đóng:{' '}
                    {formatPrice(inspectedDetail.cycleTrace.candle.close)})
                  </div>
                  <div>
                    OHLC: {formatPrice(inspectedDetail.cycleTrace.candle.open)} /{' '}
                    {formatPrice(inspectedDetail.cycleTrace.candle.high)} /{' '}
                    {formatPrice(inspectedDetail.cycleTrace.candle.low)} /{' '}
                    {formatPrice(inspectedDetail.cycleTrace.candle.close)}
                  </div>
                  <div>
                    Spread: {inspectedDetail.cycleTrace.candle.spreadPts} pts · Hợp lệ:{' '}
                    {inspectedDetail.cycleTrace.validation.valid ? 'Có' : 'Không'}
                  </div>
                  {inspectedDetail.cycleTrace.regimeClassification && (
                    <div className="font-sans pt-1 border-t border-slate-800 text-slate-200">
                      Trạng thái:{' '}
                      <strong>
                        {
                          REGIME_LABELS_VI[
                            inspectedDetail.cycleTrace.regimeClassification.regime
                          ]
                        }
                      </strong>{' '}
                      (ADX{' '}
                      {inspectedDetail.cycleTrace.regimeClassification.indicators.adxProxy.toFixed(
                        1
                      )}
                      , ATR Ratio{' '}
                      {inspectedDetail.cycleTrace.regimeClassification.indicators.atrRatio.toFixed(
                        2
                      )}
                      )
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-slate-400">
                  Sự kiện cấp hệ thống ({inspectedDetail.event.cycleId}) — không gắn nến
                  M15 đơn lẻ.
                </div>
              )}
            </div>

            {/* 2. Strategy Version, Coordinator & Risk Gate Decision */}
            <div className="bg-slate-950/80 border border-slate-800 rounded p-3.5 space-y-2">
              <div className="font-semibold text-cyan-300">
                2. Phiên bản Chiến lược &amp; Chốt Rủi ro
              </div>
              {inspectedDetail.cycleTrace?.coordinatorDecision ? (
                <div className="space-y-1.5 text-slate-300">
                  <div className="font-mono">
                    Chính sách:{' '}
                    {inspectedDetail.cycleTrace.coordinatorDecision.activePolicyId}
                  </div>
                  <div>
                    Quyết định điều phối:{' '}
                    <strong className="font-mono text-slate-100">
                      {inspectedDetail.cycleTrace.coordinatorDecision.action}
                    </strong>
                  </div>
                  {inspectedDetail.cycleTrace.coordinatorDecision.selectedStrategyId && (
                    <div className="font-mono text-emerald-300">
                      Chiến lược:{' '}
                      {inspectedDetail.cycleTrace.coordinatorDecision.selectedStrategyId}{' '}
                      ({inspectedDetail.cycleTrace.coordinatorDecision.selectedStrategyVersion})
                    </div>
                  )}
                  <div className="text-slate-400">
                    {inspectedDetail.cycleTrace.coordinatorDecision.reasonVi}
                  </div>
                  {inspectedDetail.cycleTrace.riskDecision && (
                    <div className="pt-1 border-t border-slate-800">
                      Chốt rủi ro:{' '}
                      <strong
                        className={
                          inspectedDetail.cycleTrace.riskDecision.approved
                            ? 'text-emerald-300'
                            : 'text-rose-300'
                        }
                      >
                        {inspectedDetail.cycleTrace.riskDecision.approved
                          ? `DUYỆT (${inspectedDetail.cycleTrace.riskDecision.approvedLots.toFixed(
                              2
                            )} lot)`
                          : `PHỦ QUYẾT (${inspectedDetail.cycleTrace.riskDecision.vetoCode})`}
                      </strong>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-slate-400">
                  Không phát sinh quyết định chọn chiến lược ở bước này.
                </div>
              )}
            </div>

            {/* 3. Reconciliation or Walk-Forward Learning Run */}
            <div className="bg-slate-950/80 border border-slate-800 rounded p-3.5 space-y-2">
              <div className="font-semibold text-cyan-300">
                3. Đối soát Khớp lệnh / Kiểm định Walk-Forward
              </div>
              {inspectedDetail.linkedPosition ? (
                <div className="space-y-1.5 font-mono tabular-nums text-slate-300">
                  <div>
                    Vị thế: {inspectedDetail.linkedPosition.positionId} (
                    {inspectedDetail.linkedPosition.direction}{' '}
                    {inspectedDetail.linkedPosition.filledVolumeLots.toFixed(2)} lot)
                  </div>
                  <div>
                    Giá vào KV/Khớp:{' '}
                    {formatPrice(inspectedDetail.linkedPosition.expectedEntryPrice)} /{' '}
                    {formatPrice(inspectedDetail.linkedPosition.fillEntryPrice)}
                  </div>
                  <div>
                    Chi phí: {formatUsd(inspectedDetail.linkedPosition.totalCostUsd)} · P&amp;L:{' '}
                    <span
                      className={
                        inspectedDetail.linkedPosition.netPnlUsd >= 0
                          ? 'text-emerald-300'
                          : 'text-rose-300'
                      }
                    >
                      {formatSignedUsd(inspectedDetail.linkedPosition.netPnlUsd)}
                    </span>
                  </div>
                  {inspectedDetail.linkedReconciliation && (
                    <div className="text-emerald-300 pt-1 border-t border-slate-800">
                      Đối soát {inspectedDetail.linkedReconciliation.reconciliationId}:{' '}
                      {inspectedDetail.linkedReconciliation.status}
                    </div>
                  )}
                </div>
              ) : inspectedDetail.linkedLearningRun ? (
                <div className="space-y-1.5 text-slate-300">
                  <div className="font-mono text-cyan-300">
                    Kỳ Walk-Forward: {inspectedDetail.linkedLearningRun.runId} (
                    {inspectedDetail.linkedLearningRun.decision})
                  </div>
                  <div className="font-mono tabular-nums">
                    Mẫu hợp lệ: {inspectedDetail.linkedLearningRun.totalCompletedSamplesUsed}{' '}
                    · Loại: {inspectedDetail.linkedLearningRun.totalExcludedSamples}
                  </div>
                  <div className="font-mono tabular-nums">
                    Chính sách: {inspectedDetail.linkedLearningRun.previousPolicyId} →{' '}
                    {inspectedDetail.linkedLearningRun.resultingPolicyId}
                  </div>
                  <div className="text-slate-400">
                    {inspectedDetail.linkedLearningRun.decisionReasonVi}
                  </div>
                </div>
              ) : (
                <div className="text-slate-400">
                  Chu kỳ không phát sinh mở/đóng vị thế mới hoặc đợt cập nhật chính sách.
                </div>
              )}
            </div>
          </div>
        </section>
      )}


    </div>
  );
};
