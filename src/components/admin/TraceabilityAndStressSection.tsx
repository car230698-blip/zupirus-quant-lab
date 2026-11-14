import React, { useState } from 'react';
import {
  fetchLearningTraceById,
  fetchPositionTraceById,
  LearningTraceResponse,
  PositionTraceResponse,
} from '../../api/quantApi.ts';
import type { DualCostStressComparison } from '../../quant/costStress.ts';
import type { QuantSystemState } from '../../quant/types.ts';
import {
  formatPct,
  formatPrice,
  formatSignedUsd,
  formatUsd,
  formatUtcShort,
} from '../../utils/formatters.ts';
import { SectionHeader, StatusLabel } from '../shared/UiPrimitives.tsx';

export interface TraceabilityAndStressSectionProps {
  state: QuantSystemState;
  costComparison: DualCostStressComparison | null;
  authToken: string;
  simulatedHost?: string | null;
}

export const TraceabilityAndStressSection: React.FC<
  TraceabilityAndStressSectionProps
> = ({ state, costComparison, authToken, simulatedHost }) => {
  const [tracePosId, setTracePosId] = useState<string>('');
  const [posTraceResult, setPosTraceResult] =
    useState<PositionTraceResponse | null>(null);
  const [traceRunId, setTraceRunId] = useState<string>('');
  const [runTraceResult, setRunTraceResult] =
    useState<LearningTraceResponse | null>(null);

  const telemetry = state.dataSourceTelemetry;
  const schedule = state.brokerSchedule;
  const schedEval = state.lastScheduleEvaluation;

  const handleInspectPosition = async (positionId: string) => {
    setTracePosId(positionId);
    if (!positionId) {
      setPosTraceResult(null);
      return;
    }
    const res = await fetchPositionTraceById(
      positionId,
      authToken,
      simulatedHost
    );
    setPosTraceResult(res);
  };

  const handleInspectLearningRun = async (runId: string) => {
    setTraceRunId(runId);
    if (!runId) {
      setRunTraceResult(null);
      return;
    }
    const res = await fetchLearningTraceById(runId, authToken, simulatedHost);
    setRunTraceResult(res);
  };

  return (
    <div className="space-y-6">
      {/* 1. Data Source Telemetry & 15/15 Broker Session Rule */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-3 text-xs">
          <SectionHeader
            title="Giám sát Nguồn Dữ liệu & Bộ thu Tick MT5"
            subtitle="Theo dõi tính toàn vẹn của luồng báo giá Bid/Ask, tick cùng mili-giây và mất đoạn"
            rightSlot={
              <StatusLabel
                label={telemetry?.connectionState ?? 'REPLAY_OFFLINE'}
                tone={
                  telemetry?.connectionState === 'STREAMING_LIVE'
                    ? 'emerald'
                    : telemetry?.connectionState === 'DISCONNECTED'
                    ? 'rose'
                    : 'cyan'
                }
                mono
              />
            }
          />
          {telemetry && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono tabular-nums">
              <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
                <div className="text-slate-400">Mã chuẩn / Gốc</div>
                <div className="text-slate-100 mt-1">
                  {telemetry.canonicalSymbol} ({telemetry.rawSymbol})
                </div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
                <div className="text-slate-400">Lô nhận / Trùng</div>
                <div className="text-cyan-300 mt-1">
                  {telemetry.totalBatchesAccepted} / {telemetry.duplicateBatchesSkipped}
                </div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
                <div className="text-slate-400">Tick hợp lệ / Cùng ms</div>
                <div className="text-emerald-300 mt-1">
                  {telemetry.totalValidTicksAccepted} /{' '}
                  {telemetry.sameMillisecondTicksAccepted}
                </div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
                <div className="text-slate-400">Trùng / Sai thứ tự</div>
                <div className="text-amber-300 mt-1">
                  {telemetry.duplicateTicksSkipped} /{' '}
                  {telemetry.outOfOrderTicksRejected}
                </div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
                <div className="text-slate-400">Mất đoạn (Gaps)</div>
                <div className="text-rose-300 mt-1">{telemetry.gapCount} lần</div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
                <div className="text-slate-400">Nến M15 từ Tick</div>
                <div className="text-slate-100 mt-1">
                  {telemetry.closedBarsBuiltFromTicks} nến
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-3 text-xs">
          <SectionHeader
            title="Lịch Phiên Thị trường & Quy tắc 15/15 (DST-aware)"
            subtitle="Dừng mở mới và đóng toàn bộ vị thế trước giờ đóng phiên Thứ Sáu / ngày đóng sớm 15 phút"
            rightSlot={
              <StatusLabel
                label={schedEval?.sessionState ?? 'OPEN'}
                tone={
                  schedEval?.sessionState === 'OPEN'
                    ? 'emerald'
                    : schedEval?.sessionState === 'MARKET_CLOSED'
                    ? 'rose'
                    : 'amber'
                }
                mono
              />
            }
          />
          {schedule && (
            <div className="space-y-2 text-slate-300">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono tabular-nums">
                <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
                  <div className="text-slate-400">Múi giờ Phiên</div>
                  <div className="text-slate-100 mt-1">
                    {schedule.timezone} ({schedEval?.utcOffsetLabel ?? 'EST/EDT'})
                  </div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
                  <div className="text-slate-400">Đóng Thứ Sáu</div>
                  <div className="text-cyan-300 mt-1">
                    {schedule.fridayCloseLocalTime} (Cắt 15/15:{' '}
                    {schedEval?.cutoffWindowStartLocalTime ?? '16:45'})
                  </div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
                  <div className="text-slate-400">Đệm trượt SL P95</div>
                  <div className="text-amber-300 mt-1">
                    ${state.slOvershootP95?.effectiveBufferUsdPerOz.toFixed(2) ?? '0.10'}
                    /oz ({state.slOvershootP95?.sampleCount ?? 0} mẫu)
                  </div>
                </div>
              </div>
              {schedEval && (
                <div className="px-3 py-2 rounded bg-slate-950 border border-slate-800 text-slate-300">
                  {schedEval.reasonVi}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 2. Dual Cost & Latency Stress Comparison */}
      {costComparison && (
        <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
          <SectionHeader
            title="Kiểm định Sức chịu đựng Chi phí 2× & Độ trễ Khớp lệnh"
            subtitle="Tách biệt minh bạch giữa Hậu kiểm Chi phí 2× trên lệnh đã khớp và Chạy lại Mô phỏng Toàn phần dưới mô hình chi phí + độ trễ mới"
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-cyan-300">
                  A. {costComparison.postHoc2xAnalysis.titleVi}
                </span>
                <StatusLabel
                  label={costComparison.postHoc2xAnalysis.reportType}
                  tone="cyan"
                  mono
                />
              </div>
              <p className="text-slate-400">
                {costComparison.postHoc2xAnalysis.descriptionVi}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2 font-mono tabular-nums">
                <div>
                  Lệnh đánh giá:{' '}
                  <strong className="text-slate-100">
                    {costComparison.postHoc2xAnalysis.tradesEvaluated}
                  </strong>
                </div>
                <div>
                  Chi phí 1x / 2x:{' '}
                  <span className="text-amber-300">
                    {formatUsd(costComparison.postHoc2xAnalysis.cost1xUsd)} /{' '}
                    {formatUsd(costComparison.postHoc2xAnalysis.costElevatedUsd)}
                  </span>
                </div>
                <div>
                  P&amp;L Ròng 1x / 2x:{' '}
                  <span className="text-emerald-300">
                    {formatSignedUsd(costComparison.postHoc2xAnalysis.netPnl1xUsd)} /{' '}
                    {formatSignedUsd(
                      costComparison.postHoc2xAnalysis.netPnlElevatedUsd
                    )}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-cyan-300">
                  B. {costComparison.fullReSimulation2x.titleVi}
                </span>
                <StatusLabel
                  label={costComparison.fullReSimulation2x.reportType}
                  tone="amber"
                  mono
                />
              </div>
              <p className="text-slate-400">
                {costComparison.fullReSimulation2x.descriptionVi}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2 font-mono tabular-nums">
                <div>
                  Lệnh khớp / Phủ quyết:{' '}
                  <strong className="text-slate-100">
                    {costComparison.fullReSimulation2x.tradesExecuted} /{' '}
                    {costComparison.fullReSimulation2x.signalsVetoedByCostOrSpread}
                  </strong>
                </div>
                <div>
                  Tổng chi phí 2x+Trễ:{' '}
                  <span className="text-amber-300">
                    {formatUsd(costComparison.fullReSimulation2x.totalCostUsd)}
                  </span>
                </div>
                <div>
                  P&amp;L Ròng / Số dư cuối:{' '}
                  <span className="text-emerald-300">
                    {formatSignedUsd(costComparison.fullReSimulation2x.netPnlUsd)} (
                    {formatUsd(costComparison.fullReSimulation2x.finalBalanceUsd)})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 3. Bidirectional Traceability Lookup */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
        <SectionHeader
          title="Truy vết Kiểm toán Hai chiều (Vị thế ↔ Nến đóng & Kỳ học ↔ Mẫu đối soát)"
          subtitle="Truy vấn trực tiếp từ API /api/trace/position/:id và /api/trace/learning/:runId"
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
          {/* Trace 1: Position -> Candle, Regime, Risk, Reconciliation */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="trace-pos-select"
                className="font-semibold text-cyan-300"
              >
                Truy vết Vị thế → Nến &amp; Đối soát
              </label>
              <select
                id="trace-pos-select"
                value={tracePosId}
                onChange={(e) => handleInspectPosition(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-mono text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                <option value="">-- Chọn mã vị thế --</option>
                {[...state.openPositions, ...state.closedPositions].map((p) => (
                  <option key={p.positionId} value={p.positionId}>
                    {p.positionId} ({p.strategyId} · {formatSignedUsd(p.netPnlUsd)})
                  </option>
                ))}
              </select>
            </div>

            {posTraceResult ? (
              <div className="space-y-1.5 font-mono tabular-nums text-slate-300 border-t border-slate-800 pt-2.5">
                <div>
                  Vị thế: {posTraceResult.position.positionId} · Chu kỳ mở:{' '}
                  {posTraceResult.position.entryCycleId} · Nến:{' '}
                  {posTraceResult.position.entryCandleId}
                </div>
                <div>
                  Chính sách lúc mở: {posTraceResult.position.openedUnderPolicyId} · Giá
                  vào KV/Khớp: {formatPrice(posTraceResult.position.expectedEntryPrice)}{' '}
                  / {formatPrice(posTraceResult.position.fillEntryPrice)}
                </div>
                {posTraceResult.reconciliation && (
                  <div className="text-emerald-300">
                    Đối soát: {posTraceResult.reconciliation.reconciliationId} (
                    {posTraceResult.reconciliation.status}) — Khớp khối lượng:{' '}
                    {posTraceResult.reconciliation.volumeMatched ? '100%' : 'Sai lệch'}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-slate-400">
                Chọn một vị thế để truy vết ngược về nến M15 đầu vào, quyết định rủi ro và
                bản ghi đối soát.
              </div>
            )}
          </div>

          {/* Trace 2: Learning Run -> Reconciled Positions & Shadow Samples */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="trace-run-select"
                className="font-semibold text-cyan-300"
              >
                Truy vết Kỳ học Walk-Forward → Tập mẫu
              </label>
              <select
                id="trace-run-select"
                value={traceRunId}
                onChange={(e) => handleInspectLearningRun(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-mono text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                <option value="">-- Chọn kỳ học Walk-Forward --</option>
                {state.learningRuns.map((lr) => (
                  <option key={lr.runId} value={lr.runId}>
                    {lr.runId} ({lr.decision})
                  </option>
                ))}
              </select>
            </div>

            {runTraceResult ? (
              <div className="space-y-1.5 font-mono tabular-nums text-slate-300 border-t border-slate-800 pt-2.5">
                <div>
                  Kỳ học: {runTraceResult.learningRun.runId} · Quyết định:{' '}
                  {runTraceResult.learningRun.decision}
                </div>
                <div>
                  Số vị thế thực tế đã đối soát:{' '}
                  {runTraceResult.reconciledPositionsUsed.length} · Số mẫu Shadow đã đóng:{' '}
                  {runTraceResult.shadowOutcomesUsed.length}
                </div>
                <div className="text-cyan-300">
                  Chính sách kết quả: {runTraceResult.learningRun.previousPolicyId} →{' '}
                  {runTraceResult.learningRun.resultingPolicyId}
                </div>
              </div>
            ) : (
              <div className="text-slate-400">
                Chọn một kỳ học Walk-Forward để truy vết toàn bộ mẫu đã đóng và chính
                sách sinh ra.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
