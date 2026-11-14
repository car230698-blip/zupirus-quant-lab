import React, { useState } from 'react';
import type {
  LearningTraceResponse,
  PositionTraceResponse,
} from '../../api/quantApi.ts';
import type { DualCostStressComparison } from '../../quant/costStress.ts';
import type { QuantSystemState } from '../../quant/types.ts';
import {
  formatLots,
  formatPrice,
  formatSignedUsd,
  formatStrategyNameVi,
  formatUtcShort,
} from '../../utils/formatters.ts';
import { PositionDetailCard } from '../shared/PositionDetailCard.tsx';
import {
  EmptyDataNotice,
  MetricCard,
  SectionHeader,
  StatusLabel,
} from '../shared/UiPrimitives.tsx';
import { CostStressPanel } from './CostStressPanel.tsx';

export interface TraceabilityAndStressSectionProps {
  state: QuantSystemState;
  stressReport: DualCostStressComparison | null;
  actionPending: boolean;
  onRefreshReports: () => void;
  onFetchPositionTrace: (positionId: string) => Promise<PositionTraceResponse | null>;
  onFetchLearningTrace: (runId: string) => Promise<LearningTraceResponse | null>;
}

const SESSION_STATE_LABELS_VI: Record<string, string> = {
  OPEN: 'Đang mở cửa giao dịch',
  CLOSE_ONLY_15_15: 'Chỉ đóng lệnh (Quy tắc 15/15)',
  CLOSE_ONLY_MANUAL: 'Chỉ đóng lệnh (Thủ công)',
  MARKET_CLOSED: 'Thị trường đóng cửa',
};

export const TraceabilityAndStressSection: React.FC<TraceabilityAndStressSectionProps> = ({
  state,
  stressReport,
  actionPending,
  onRefreshReports,
  onFetchPositionTrace,
  onFetchLearningTrace,
}) => {
  const [selectedPosId, setSelectedPosId] = useState<string>('');
  const [posTrace, setPosTrace] = useState<PositionTraceResponse | null>(null);
  const [posLoading, setPosLoading] = useState(false);

  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [lrTrace, setLrTrace] = useState<LearningTraceResponse | null>(null);
  const [lrLoading, setLrLoading] = useState(false);

  const allPositions = [...state.closedPositions, ...state.openPositions].reverse();
  const allRuns = state.learningRuns.slice().reverse();

  const handleSelectPosition = async (posId: string) => {
    setSelectedPosId(posId);
    if (!posId) {
      setPosTrace(null);
      return;
    }
    setPosLoading(true);
    const res = await onFetchPositionTrace(posId);
    setPosTrace(res);
    setPosLoading(false);
  };

  const handleSelectLearningRun = async (runId: string) => {
    setSelectedRunId(runId);
    if (!runId) {
      setLrTrace(null);
      return;
    }
    setLrLoading(true);
    const res = await onFetchLearningTrace(runId);
    setLrTrace(res);
    setLrLoading(false);
  };

  const telemetry = state.dataSourceTelemetry;
  const sched = state.lastScheduleEvaluation;
  const slP95 = state.slOvershootP95;

  return (
    <div className="space-y-6">
      {/* 1. Data Source, 15/15 Schedule & P95 SL Buffer Summary */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Nguồn báo giá & Tiến độ"
          value={
            telemetry?.sourceMode === 'MT5_DEMO_LIVE'
              ? 'MT5 Demo Trực tiếp'
              : `Phát lại (${state.replayCursorIndex}/${state.totalReplayCandles})`
          }
          subtitle={
            telemetry?.connectionLabelVi ??
            'Dữ liệu nến M15 XAUUSD đã đóng hoàn chỉnh'
          }
          tone="cyan"
        />

        <MetricCard
          title="Lịch phiên & Quy tắc 15/15"
          value={
            sched
              ? SESSION_STATE_LABELS_VI[sched.sessionState] ?? sched.sessionState
              : 'Đang mở cửa'
          }
          subtitle={
            sched?.reasonVi ??
            'Chặn mở lệnh mới & đóng vị thế 15 phút trước giờ nghỉ phiên'
          }
          tone={
            sched?.sessionState === 'OPEN'
              ? 'emerald'
              : sched?.sessionState === 'CLOSE_ONLY_15_15'
              ? 'rose'
              : 'amber'
          }
        />

        <MetricCard
          title="Đệm trượt Dừng lỗ (P95 SL)"
          value={
            slP95
              ? `${slP95.effectiveBufferUsdPerOz.toFixed(2)} USD/oz`
              : '0.10 USD/oz (Mặc định)'
          }
          subtitle={
            slP95?.usedFallbackDefault === false
              ? `Tính thực nghiệm từ ${slP95.sampleCount} lệnh chạm SL`
              : 'Dùng mức dự phòng 0.10 USD/oz khi dưới 10 mẫu SL'
          }
          tone="slate"
        />

        <MetricCard
          title="Đối soát sổ cái vị thế"
          value={`${state.reconciliations.filter((r) => r.volumeMatched).length}/${state.closedPositions.length} khớp`}
          subtitle={`Số lần khôi phục tiến trình: ${state.restartCount} lần`}
          tone="emerald"
        />
      </section>

      {/* 2. Bidirectional Traceability Lookup */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-5">
        <SectionHeader
          title="Truy vết hai chiều: Vị thế ⇄ Chu kỳ nến & Đợt học ⇄ Mẫu đối soát"
          subtitle="Chọn một vị thế hoặc một đợt kiểm định để kiểm tra chuỗi bằng chứng khép kín từ nến M15 đến sổ cái đối soát"
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Trace direction 1: Position -> Candle, Decision, Risk, Reconciliation */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-4 space-y-3">
            <label className="flex flex-col gap-1.5 text-xs text-slate-300 font-medium">
              <span>Chiều 1: Truy vết từ Vị thế về Chu kỳ nến &amp; Quyết định</span>
              <select
                aria-label="Chọn vị thế cần truy vết"
                value={selectedPosId}
                onChange={(e) => void handleSelectPosition(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono rounded px-2.5 py-2"
              >
                <option value="">-- Chọn vị thế ({allPositions.length} vị thế) --</option>
                {allPositions.map((p) => (
                  <option key={p.positionId} value={p.positionId}>
                    {p.positionId} — {p.direction === 'BUY' ? 'MUA' : 'BÁN'}{' '}
                    {formatLots(p.filledVolumeLots)} ({formatStrategyNameVi(p.strategyId)})
                  </option>
                ))}
              </select>
            </label>

            {posLoading ? (
              <div className="text-xs font-mono text-cyan-300 animate-pulse py-3">
                Đang truy xuất chuỗi bằng chứng vị thế...
              </div>
            ) : posTrace ? (
              <div className="space-y-3 text-xs">
                <PositionDetailCard
                  position={posTrace.position}
                  reconciliation={posTrace.reconciliation}
                />
                {posTrace.entryCycleTrace && (
                  <details className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
                    <summary className="cursor-pointer text-cyan-300 hover:text-cyan-200 font-medium">
                      Bối cảnh nến mở lệnh ({posTrace.entryCycleTrace.cycleId}) &amp; Chốt rủi ro
                    </summary>
                    <div className="mt-2 pt-2 border-t border-slate-800 space-y-1 text-slate-300 font-mono text-[11px]">
                      <div>
                        Nến: {posTrace.entryCycleTrace.candle.candleId} (Đóng:{' '}
                        {formatPrice(posTrace.entryCycleTrace.candle.close)})
                      </div>
                      <div className="font-sans">
                        Trạng thái:{' '}
                        {posTrace.entryCycleTrace.regimeClassification?.regimeLabelVi ?? '—'}
                      </div>
                      <div className="font-sans">
                        Lý do chọn:{' '}
                        {posTrace.entryCycleTrace.coordinatorDecision?.reasonVi ?? '—'}
                      </div>
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <EmptyDataNotice
                title="Chọn một vị thế ở danh sách trên"
                reasonVi="Hệ thống sẽ hiển thị đầy đủ giá khớp, SL/TP, phí, bản ghi đối soát và nến M15 đã kích hoạt lệnh."
              />
            )}
          </div>

          {/* Trace direction 2: Learning Run -> Reconciled Positions & Shadow Outcomes */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-4 space-y-3">
            <label className="flex flex-col gap-1.5 text-xs text-slate-300 font-medium">
              <span>Chiều 2: Truy vết từ Đợt học Walk-Forward về Mẫu đối soát</span>
              <select
                aria-label="Chọn đợt học cần truy vết"
                value={selectedRunId}
                onChange={(e) => void handleSelectLearningRun(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono rounded px-2.5 py-2"
              >
                <option value="">-- Chọn đợt kiểm định ({allRuns.length} đợt) --</option>
                {allRuns.map((r) => (
                  <option key={r.runId} value={r.runId}>
                    {r.runId} — {formatUtcShort(r.executedAtMarketTime)} ({r.totalCompletedSamplesUsed} mẫu)
                  </option>
                ))}
              </select>
            </label>

            {lrLoading ? (
              <div className="text-xs font-mono text-cyan-300 animate-pulse py-3">
                Đang truy xuất mẫu đối soát của đợt học...
              </div>
            ) : lrTrace ? (
              <div className="space-y-3 text-xs">
                <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100">
                      Kết quả đợt {lrTrace.learningRun.runId}
                    </span>
                    <StatusLabel label={lrTrace.learningRun.decision} tone="cyan" mono />
                  </div>
                  <p className="text-slate-300 leading-snug">
                    {lrTrace.learningRun.decisionReasonVi}
                  </p>
                  <div className="text-slate-400 font-mono text-[11px]">
                    Vị thế thực đã đóng: {lrTrace.reconciledPositionsUsed.length} | Mẫu ứng viên song song:{' '}
                    {lrTrace.shadowOutcomesUsed.length}
                  </div>
                </div>

                <details className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
                  <summary className="cursor-pointer text-cyan-300 hover:text-cyan-200 font-medium">
                    Danh sách mẫu ứng viên &amp; vị thế thực đã dùng trong đợt kiểm định
                  </summary>
                  <div className="mt-2 pt-2 border-t border-slate-800 space-y-1.5 font-mono text-[11px] text-slate-300 max-h-48 overflow-y-auto">
                    {lrTrace.shadowOutcomesUsed.slice(0, 15).map((s) => (
                      <div
                        key={s.shadowId}
                        className="flex items-center justify-between py-1 border-b border-slate-800/60"
                      >
                        <span>
                          {s.shadowId} ({s.strategyId})
                        </span>
                        <span
                          className={s.netPnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'}
                        >
                          1×: {formatSignedUsd(s.netPnlUsd)} | 2×:{' '}
                          {formatSignedUsd(s.netPnlAt2xCostUsd)}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            ) : (
              <EmptyDataNotice
                title="Chọn một đợt kiểm định Walk-Forward"
                reasonVi="Hệ thống sẽ liệt kê các vị thế đã đối soát và các mẫu ứng viên song song được dùng để ra quyết định."
              />
            )}
          </div>
        </div>
      </section>

      {/* 3. Cost Stress 2x + Latency Panel */}
      <CostStressPanel
        stressReport={stressReport}
        actionPending={actionPending}
        onRunCostStress={onRefreshReports}
      />
    </div>
  );
};
