import React, { useEffect, useState } from 'react';
import {
  CycleTraceRecord,
  LearningRunRecord,
  QuantSystemState,
  REGIME_LABELS_VI,
  ReplayDatasetMetadata,
} from '../quant/types.ts';

interface AdminOperationsViewProps {
  state: QuantSystemState;
  datasetMetadata: ReplayDatasetMetadata;
  isStaleData: boolean;
  initialInspectedPositionId?: string | null;
  onStepSingleCandle: () => Promise<void>;
  onToggleLoop: () => Promise<void>;
  onResetSimulation: () => Promise<void>;
}

export const AdminOperationsView: React.FC<AdminOperationsViewProps> = ({
  state,
  datasetMetadata,
  isStaleData,
  initialInspectedPositionId,
  onStepSingleCandle,
  onToggleLoop,
  onResetSimulation,
}) => {
  const [selectedPositionId, setSelectedPositionId] = useState<string>(
    initialInspectedPositionId ||
      state.closedPositions[state.closedPositions.length - 1]?.positionId ||
      state.openPositions[0]?.positionId ||
      ''
  );
  const [selectedLearningRunId, setSelectedLearningRunId] = useState<string>(
    state.learningRuns[state.learningRuns.length - 1]?.runId || ''
  );
  const [selectedCycleId, setSelectedCycleId] = useState<string>('');

  useEffect(() => {
    if (initialInspectedPositionId) {
      setSelectedPositionId(initialInspectedPositionId);
    } else if (
      !selectedPositionId &&
      (state.closedPositions.length > 0 || state.openPositions.length > 0)
    ) {
      setSelectedPositionId(
        state.closedPositions[state.closedPositions.length - 1]?.positionId ||
          state.openPositions[0]?.positionId ||
          ''
      );
    }
  }, [initialInspectedPositionId, state.closedPositions.length, state.openPositions.length]);

  useEffect(() => {
    if (state.learningRuns.length > 0) {
      const latestRun = state.learningRuns[state.learningRuns.length - 1];
      if (!selectedLearningRunId || !state.learningRuns.some((r) => r.runId === selectedLearningRunId)) {
        setSelectedLearningRunId(latestRun.runId);
      }
    }
  }, [state.learningRuns.length]);

  const latestTrace: CycleTraceRecord | null =
    state.cycleTraces.length > 0
      ? state.cycleTraces[state.cycleTraces.length - 1]
      : null;

  const inspectedCycleTrace: CycleTraceRecord | null = selectedCycleId
    ? state.cycleTraces.find((c) => c.cycleId === selectedCycleId) || latestTrace
    : latestTrace;

  const allPositions = [...state.closedPositions, ...state.openPositions];
  const tracedPosition =
    allPositions.find((p) => p.positionId === selectedPositionId) ||
    allPositions[allPositions.length - 1] ||
    null;

  const tracedPositionEntryCycle = tracedPosition
    ? state.cycleTraces.find((c) => c.cycleId === tracedPosition.entryCycleId)
    : null;
  const tracedPositionCloseCycle =
    tracedPosition && tracedPosition.closeCycleId
      ? state.cycleTraces.find((c) => c.cycleId === tracedPosition.closeCycleId)
      : null;
  const tracedPositionReconciliation = tracedPosition
    ? state.reconciliations.find((r) => r.positionId === tracedPosition.positionId)
    : null;

  const tracedLearningRun: LearningRunRecord | null =
    state.learningRuns.find((r) => r.runId === selectedLearningRunId) ||
    state.learningRuns[state.learningRuns.length - 1] ||
    null;

  const activePolicy =
    state.policies.find((p) => p.policyId === state.activePolicyId) ||
    state.policies[0];

  const dataFreshnessSeconds = Math.max(
    0,
    Math.round((Date.now() - Date.parse(state.lastUpdatedSystemTime)) / 1000)
  );

  return (
    <div className="space-y-8">
      {/* Header & Operational Simulation Controls */}
      <section
        aria-label="Điều hành hệ thống mô phỏng"
        className="border border-slate-800 bg-slate-900/70 p-5 rounded-lg flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
      >
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-300 font-medium">
            <span>Chế độ: Mô phỏng (SIMULATION_ONLY)</span>
            <span aria-hidden="true">·</span>
            <span>Tự vận hành hoàn toàn không cần duyệt tay</span>
            <span aria-hidden="true">·</span>
            <span>Restart đã khôi phục: {state.restartCount} lần</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-100 tracking-tight">
            Bảng Vận hành Quản trị & Kiểm định Định lượng (Admin)
          </h1>
          <p className="text-xs text-slate-400">
            Độ mới dữ liệu: cập nhật {dataFreshnessSeconds} giây trước · Nhịp phát lại tự động:{' '}
            {state.replayIntervalMs}ms/nến M15 · Chu kỳ hiện tại:{' '}
            {latestTrace ? latestTrace.cycleId : 'Chưa bắt đầu'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onToggleLoop}
            className="px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {state.isLoopRunning ? 'Tạm dừng vòng tự động' : 'Tiếp tục chạy tự động'}
          </button>
          <button
            type="button"
            onClick={onStepSingleCandle}
            disabled={state.isReplayComplete}
            className="px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Bước thêm 1 nến M15
          </button>
          <button
            type="button"
            onClick={onResetSimulation}
            className="px-3.5 py-2 text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Chạy lại từ đầu (Reset)
          </button>
        </div>
      </section>

      {isStaleData && (
        <div
          role="status"
          className="border border-amber-700/60 bg-amber-950/30 px-4 py-3 rounded-lg text-xs text-amber-200 flex items-center justify-between"
        >
          <span>
            Trạng thái độ mới dữ liệu: Dữ liệu phát lại hiện đã dừng hoặc hoàn tất ({state.replayCursorIndex}/{state.totalReplayCandles} nến).
          </span>
          <span className="font-mono tabular-nums">
            Độ trễ cập nhật: {dataFreshnessSeconds}s
          </span>
        </div>
      )}

      {/* 1. Two-Team Coordination & Real-Time Operational Status */}
      <section
        aria-label="Tình trạng phối hợp hai đội Agent"
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        {/* Team 1 Card */}
        <div className="border border-slate-800 bg-slate-900/60 p-5 rounded-lg space-y-4">
          <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                {state.teamExecutionStatus.teamNameVi}
              </h2>
              <p className="text-xs text-slate-400">
                Nhận nến M15 đã đóng → Phân loại trạng thái → Chọn chiến lược → Chốt rủi ro → Khớp & Đối soát
              </p>
            </div>
            <div className="text-xs font-mono tabular-nums shrink-0">
              {state.teamExecutionStatus.isActive ? (
                <span className="text-emerald-400 font-semibold">
                  Trạng thái: Đang hoạt động
                </span>
              ) : (
                <span className="text-amber-300 font-medium">
                  Trạng thái: Đang chờ / Hoàn tất
                </span>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-slate-400">Công việc thực tế hiện tại</dt>
              <dd className="mt-0.5 text-slate-100 font-medium">
                {state.teamExecutionStatus.currentTaskVi}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Tác vụ hoàn thành gần nhất</dt>
              <dd className="mt-0.5 text-slate-200">
                {state.teamExecutionStatus.lastCompletedTaskVi}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Giờ thị trường / Giờ hệ thống gần nhất</dt>
              <dd className="mt-0.5 font-mono tabular-nums text-slate-200">
                MT:{' '}
                {state.teamExecutionStatus.lastCompletedMarketTime
                  ? state.teamExecutionStatus.lastCompletedMarketTime.slice(11, 19)
                  : '—'}{' '}
                / ST:{' '}
                {state.teamExecutionStatus.lastCompletedSystemTime
                  ? state.teamExecutionStatus.lastCompletedSystemTime.slice(11, 19)
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Lý do chờ / Khôi phục lỗi</dt>
              <dd className="mt-0.5 text-slate-300">
                {state.teamExecutionStatus.waitStateReasonVi ||
                  state.teamExecutionStatus.recoveryStatusVi ||
                  'Đang xử lý liên tục theo nhịp phát lại'}
              </dd>
            </div>
          </dl>
          {state.teamExecutionStatus.lastErrorVi && (
            <div className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded p-2.5">
              Ghi nhận cảnh báo/lỗi gần nhất: {state.teamExecutionStatus.lastErrorVi}
            </div>
          )}
        </div>

        {/* Team 2 Card */}
        <div className="border border-slate-800 bg-slate-900/60 p-5 rounded-lg space-y-4">
          <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                {state.teamResearchStatus.teamNameVi}
              </h2>
              <p className="text-xs text-slate-400">
                Mô phỏng song song ứng viên → Lọc chồng lấn Walk-Forward → Xếp hạng 1x/2x chi phí → Tự cập nhật/Quay lui
              </p>
            </div>
            <div className="text-xs font-mono tabular-nums shrink-0">
              {state.teamResearchStatus.isActive ? (
                <span className="text-emerald-400 font-semibold">
                  Trạng thái: Đang hoạt động
                </span>
              ) : (
                <span className="text-amber-300 font-medium">
                  Trạng thái: Chờ đủ mẫu / Hoàn tất
                </span>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-slate-400">Công việc thực tế hiện tại</dt>
              <dd className="mt-0.5 text-slate-100 font-medium">
                {state.teamResearchStatus.currentTaskVi}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Kết luận kiểm định gần nhất</dt>
              <dd className="mt-0.5 text-slate-200 line-clamp-2" title={state.teamResearchStatus.lastCompletedTaskVi}>
                {state.teamResearchStatus.lastCompletedTaskVi}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Số kỳ học / Tổng mẫu Shadow đã đóng</dt>
              <dd className="mt-0.5 font-mono tabular-nums text-slate-200">
                {state.learningRuns.length} kỳ học ·{' '}
                {state.shadowOutcomes.filter((s) => s.status === 'CLOSED_RECONCILED').length}/
                {state.shadowOutcomes.length} mẫu đóng
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Lý do chờ / Trạng thái khôi phục</dt>
              <dd className="mt-0.5 text-slate-300">
                {state.teamResearchStatus.waitStateReasonVi ||
                  state.teamResearchStatus.recoveryStatusVi ||
                  'Tự động chạy khi đạt lịch trình hoặc đủ mẫu đối soát mới'}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* 2. Latest Processed Candle, Market Regime, Candidates Considered, & Risk Gate */}
      <section
        aria-label="Chi tiết chu kỳ xử lý nến, trạng thái thị trường, ứng viên và chốt rủi ro"
        className="border border-slate-800 bg-slate-900/60 p-6 rounded-lg space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Chu kỳ Nến M15, Phân loại Trạng thái Thị trường, Ứng viên Đã xét & Chốt Rủi ro
            </h2>
            <p className="text-xs text-slate-400">
              Chọn bất kỳ mã chu kỳ nào để kiểm tra dữ liệu chỉ báo tại thời điểm ra quyết định (Không nhìn trước tương lai).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="cycle-select" className="text-xs text-slate-400 whitespace-nowrap">
              Chọn chu kỳ:
            </label>
            <select
              id="cycle-select"
              value={selectedCycleId}
              onChange={(e) => setSelectedCycleId(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100"
            >
              <option value="">Chu kỳ mới nhất ({latestTrace?.cycleId || '—'})</option>
              {[...state.cycleTraces].reverse().map((c) => (
                <option key={c.cycleId} value={c.cycleId}>
                  {c.cycleId} — {c.candle.candleId} (
                  {c.regimeClassification?.regime || 'INVALID'})
                </option>
              ))}
            </select>
          </div>
        </div>

        {!inspectedCycleTrace ? (
          <div className="py-8 text-center border border-dashed border-slate-800 rounded text-xs text-slate-400">
            Chưa có chu kỳ nến nào được xử lý.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Candle & Regime Classification Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
              <div className="border border-slate-800 bg-slate-950/60 p-4 rounded space-y-2">
                <div className="font-semibold text-slate-200">
                  1. Nến đã đóng & Kiểm tra Dữ liệu ({inspectedCycleTrace.candle.candleId})
                </div>
                <div className="font-mono tabular-nums text-slate-300 space-y-1">
                  <div>
                    Giờ thị trường đóng: {inspectedCycleTrace.candle.closeTime.replace('T', ' ').slice(0, 19)} UTC
                  </div>
                  <div>
                    Giờ hệ thống nhận:{' '}
                    {inspectedCycleTrace.validation.systemReceivedTime.replace('T', ' ').slice(0, 19)} UTC
                  </div>
                  <div>
                    O: {inspectedCycleTrace.candle.open.toFixed(2)} · H:{' '}
                    {inspectedCycleTrace.candle.high.toFixed(2)} · L:{' '}
                    {inspectedCycleTrace.candle.low.toFixed(2)} · C:{' '}
                    {inspectedCycleTrace.candle.close.toFixed(2)}
                  </div>
                  <div>
                    Khối lượng: {inspectedCycleTrace.candle.volume} · Spread:{' '}
                    {inspectedCycleTrace.candle.spreadPts} pts
                  </div>
                </div>
                <div className="text-emerald-400">
                  {inspectedCycleTrace.validation.reasonVi}
                </div>
              </div>

              <div className="border border-slate-800 bg-slate-950/60 p-4 rounded space-y-2">
                <div className="font-semibold text-slate-200">
                  2. Nhận diện Trạng thái Thị trường
                </div>
                {inspectedCycleTrace.regimeClassification ? (
                  <>
                    <div className="text-amber-300 font-semibold">
                      {inspectedCycleTrace.regimeClassification.regimeLabelVi}
                    </div>
                    <div className="font-mono tabular-nums text-slate-300 space-y-1">
                      <div>
                        EMA20: {inspectedCycleTrace.regimeClassification.indicators.emaFast20.toFixed(2)} · EMA50:{' '}
                        {inspectedCycleTrace.regimeClassification.indicators.emaSlow50.toFixed(2)} · Độ dốc:{' '}
                        {inspectedCycleTrace.regimeClassification.indicators.emaSlope.toFixed(2)}
                      </div>
                      <div>
                        ADX-Proxy: {inspectedCycleTrace.regimeClassification.indicators.adxProxy} (Ngưỡng{' '}
                        {inspectedCycleTrace.regimeClassification.thresholds.trendingAdxMin}) · RSI14:{' '}
                        {inspectedCycleTrace.regimeClassification.indicators.rsi14}
                      </div>
                      <div>
                        ATR Ratio: {inspectedCycleTrace.regimeClassification.indicators.atrRatio}x (Sốc &ge;{' '}
                        {inspectedCycleTrace.regimeClassification.thresholds.shockAtrRatioMin}x) · BBWidth:{' '}
                        {inspectedCycleTrace.regimeClassification.indicators.bbWidthPct.toFixed(3)}%
                      </div>
                    </div>
                    <div className="text-slate-300">
                      Lý do: {inspectedCycleTrace.regimeClassification.reasonVi}
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400">Không phân loại do nến không hợp lệ.</div>
                )}
              </div>

              <div className="border border-slate-800 bg-slate-950/60 p-4 rounded space-y-2">
                <div className="font-semibold text-slate-200">
                  3. Quyết định Điều phối & Chốt Rủi ro (Risk Gate)
                </div>
                {inspectedCycleTrace.coordinatorDecision && (
                  <div className="space-y-1.5">
                    <div className="text-slate-200 font-medium">
                      Hành động điều phối:{' '}
                      <span className="text-amber-300">
                        {inspectedCycleTrace.coordinatorDecision.action === 'SELECT_STRATEGY'
                          ? `Chọn ${inspectedCycleTrace.coordinatorDecision.selectedStrategyId}@${inspectedCycleTrace.coordinatorDecision.selectedStrategyVersion}`
                          : 'ĐỨNG NGOÀI (STAND_ASIDE)'}
                      </span>
                    </div>
                    <div className="text-slate-400">
                      {inspectedCycleTrace.coordinatorDecision.reasonVi}
                    </div>
                  </div>
                )}

                {inspectedCycleTrace.riskDecision ? (
                  <div className="pt-2 border-t border-slate-800 space-y-1">
                    <div
                      className={
                        inspectedCycleTrace.riskDecision.vetoed
                          ? 'text-rose-400 font-semibold'
                          : 'text-emerald-400 font-semibold'
                      }
                    >
                      {inspectedCycleTrace.riskDecision.vetoed
                        ? `BỊ PHỦ QUYẾT (${inspectedCycleTrace.riskDecision.vetoCode})`
                        : `ĐƯỢC DUYỆT (${inspectedCycleTrace.riskDecision.approvedLots} lot)`}
                    </div>
                    <div className="text-slate-300">
                      {inspectedCycleTrace.riskDecision.reasonVi}
                    </div>
                  </div>
                ) : (
                  <div className="pt-2 border-t border-slate-800 text-slate-400">
                    Chốt rủi ro: Không kích hoạt mở lệnh ở chu kỳ này (Bộ điều phối đã chọn đứng ngoài).
                  </div>
                )}
              </div>
            </div>

            {/* Candidates Considered Table */}
            {inspectedCycleTrace.coordinatorDecision && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-300">
                  Danh sách Ứng viên Chiến lược Đã xét tại Chu kỳ {inspectedCycleTrace.cycleId}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2 pr-3 font-medium">Mã Chiến lược & Phiên bản</th>
                        <th className="py-2 px-3 font-medium">Nhóm chiến lược</th>
                        <th className="py-2 px-3 font-medium">Đủ điều kiện vào</th>
                        <th className="py-2 px-3 font-medium text-right">Giá vào / SL / TP1 / TP2</th>
                        <th className="py-2 pl-3 font-medium">Điều kiện vào lệnh hoặc Lý do bỏ qua</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                      {inspectedCycleTrace.coordinatorDecision.candidatesConsidered.map(
                        (cand) => {
                          const isSelected =
                            inspectedCycleTrace.coordinatorDecision?.action ===
                              'SELECT_STRATEGY' &&
                            inspectedCycleTrace.coordinatorDecision?.selectedStrategyId ===
                              cand.strategyId &&
                            inspectedCycleTrace.coordinatorDecision?.selectedStrategyVersion ===
                              cand.version;
                          return (
                            <tr
                              key={`${cand.strategyId}-${cand.version}`}
                              className={isSelected ? 'bg-amber-500/10' : ''}
                            >
                              <td className="py-2.5 pr-3 font-semibold text-slate-100">
                                {cand.strategyId}@{cand.version}
                                {isSelected && (
                                  <span className="ml-2 text-amber-300 font-sans font-normal">
                                    (Được chọn)
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-sans text-slate-300">
                                {cand.strategyNameVi}
                              </td>
                              <td className="py-2.5 px-3 font-sans">
                                {cand.eligibleToEnter ? (
                                  <span className="text-emerald-400 font-medium">
                                    Đủ điều kiện ({cand.direction})
                                  </span>
                                ) : (
                                  <span className="text-slate-400">Bỏ qua</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                {cand.eligibleToEnter
                                  ? `${cand.entryPrice?.toFixed(2)} / SL ${cand.stopLoss?.toFixed(
                                      2
                                    )} / TP ${cand.takeProfit1?.toFixed(2)}–${cand.takeProfit2?.toFixed(
                                      2
                                    )}`
                                  : `Thời hạn: ${cand.expiryBars} nến`}
                              </td>
                              <td className="py-2.5 pl-3 font-sans text-slate-300">
                                {cand.eligibleToEnter
                                  ? cand.entryConditionSummaryVi
                                  : cand.skipReasonVi}
                              </td>
                            </tr>
                          );
                        }
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 3. Active Policy, Policy Version History / Rollbacks, & Walk-Forward Comparison */}
      <section
        aria-label="Chính sách đang hiệu lực, lịch sử phiên bản và kết quả kiểm định ngoài mẫu Walk-Forward"
        className="border border-slate-800 bg-slate-900/60 p-6 rounded-lg space-y-6"
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Chính sách Đang hiệu lực ({activePolicy.policyId}) & Lịch sử Phiên bản / Quay lui
            </h2>
            <p className="text-xs text-slate-400">
              Quy tắc xung đột SL/TP trong cùng nến M15:{' '}
              <span className="text-slate-200 font-mono">
                {datasetMetadata.intraCandleConflictRule}
              </span>{' '}
              (Ưu tiên khớp SL trước để ngăn thiên lệch lạc quan).
            </p>
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-300">
            Giới hạn rủi ro cố định: Max {state.riskLimits.maxOpenPositions} lệnh mở · Max{' '}
            {state.riskLimits.maxVolumeLotsPerTrade} lot/lệnh · Max DD{' '}
            {state.riskLimits.maxTotalDrawdownPct}%
          </div>
        </div>

        {/* Policy Version History Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 pr-3 font-medium">Mã Chính sách</th>
                <th className="py-2 px-3 font-medium">Trạng thái</th>
                <th className="py-2 px-3 font-medium">Phân bổ theo Trạng thái Thị trường</th>
                <th className="py-2 px-3 font-medium">Nguồn kích hoạt</th>
                <th className="py-2 pl-3 font-medium">Lý do kích hoạt hoặc Quay lui</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
              {state.policies.map((pol) => (
                <tr key={pol.policyId} className="hover:bg-slate-800/30">
                  <td className="py-3 pr-3 font-semibold text-slate-100">
                    {pol.policyId} (v{pol.versionNumber})
                  </td>
                  <td className="py-3 px-3 font-sans">
                    {pol.status === 'ACTIVE' ? (
                      <span className="text-emerald-400 font-semibold">Đang hiệu lực</span>
                    ) : pol.status === 'ROLLED_BACK' ? (
                      <span className="text-rose-400 font-semibold">Đã quay lui (Rolled Back)</span>
                    ) : pol.status === 'HALTED' ? (
                      <span className="text-rose-400 font-semibold">Đã dừng mở vị thế</span>
                    ) : (
                      <span className="text-slate-400">Đã thay thế ({pol.status})</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-slate-300">
                    <div>
                      Trending:{' '}
                      {pol.mapping.TRENDING === 'STAND_ASIDE'
                        ? 'STAND_ASIDE'
                        : `${pol.mapping.TRENDING.strategyId}@${pol.mapping.TRENDING.version}`}
                    </div>
                    <div>
                      Squeeze:{' '}
                      {pol.mapping.SQUEEZE_PRE_BREAKOUT === 'STAND_ASIDE'
                        ? 'STAND_ASIDE'
                        : `${pol.mapping.SQUEEZE_PRE_BREAKOUT.strategyId}@${pol.mapping.SQUEEZE_PRE_BREAKOUT.version}`}
                    </div>
                    <div>
                      Ranging:{' '}
                      {pol.mapping.RANGING === 'STAND_ASIDE'
                        ? 'STAND_ASIDE'
                        : `${pol.mapping.RANGING.strategyId}@${pol.mapping.RANGING.version}`}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-slate-300">
                    <div>{pol.sourceRunId}</div>
                    <div className="text-slate-400">{pol.learnerVersion}</div>
                  </td>
                  <td className="py-3 pl-3 font-sans text-slate-300">
                    <div>{pol.activationReasonVi}</div>
                    {pol.rollbackReasonVi && (
                      <div className="mt-1 text-rose-400">{pol.rollbackReasonVi}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Walk-Forward Out-of-Sample & Baseline Comparison */}
        {tracedLearningRun ? (
          <div className="space-y-4 pt-4 border-t border-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  Báo cáo So sánh Chính sách Thích nghi vs Đường cơ sở ({tracedLearningRun.runId})
                </h3>
                <p className="text-xs text-slate-400">
                  Công thức xếp hạng: <span className="font-mono text-slate-300">{tracedLearningRun.rankingFormula}</span> · Ngưỡng đủ mẫu: &ge; {tracedLearningRun.minSamplesPerRegime} mẫu/trạng thái
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="lr-select" className="text-xs text-slate-400 whitespace-nowrap">
                  Kỳ học Walk-Forward:
                </label>
                <select
                  id="lr-select"
                  value={tracedLearningRun.runId}
                  onChange={(e) => setSelectedLearningRunId(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100"
                >
                  {state.learningRuns.map((r) => (
                    <option key={r.runId} value={r.runId}>
                      {r.runId} ({r.triggerCycleId}) — {r.decision}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-3 font-medium">Trạng thái / Toàn kỳ</th>
                    <th className="py-2 px-3 font-medium">Chiến lược (Thích nghi vs Cơ sở)</th>
                    <th className="py-2 px-3 font-medium text-right">Cơ hội / Giao dịch</th>
                    <th className="py-2 px-3 font-medium text-right">Lãi ròng 1x Chi phí (USD)</th>
                    <th className="py-2 px-3 font-medium text-right">Lãi ròng 2x Chi phí (USD)</th>
                    <th className="py-2 pl-3 font-medium text-right">Sụt giảm tối đa (Max DD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {tracedLearningRun.regimeComparisons.map((row) => (
                    <tr key={row.regime}>
                      <td className="py-2.5 pr-3 font-sans font-medium text-slate-200">
                        {row.regimeLabelVi}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-amber-300">TN: {row.adaptiveStrategyLabel}</div>
                        <div className="text-slate-400">CS: {row.baselineStrategyLabel}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div>
                          TN: {row.adaptive.opportunitiesCount} / {row.adaptive.tradesCount} lệnh
                        </div>
                        <div className="text-slate-400">
                          CS: {row.baseline.opportunitiesCount} / {row.baseline.tradesCount} lệnh
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="text-emerald-400 font-semibold">
                          TN: {row.adaptive.netPnlAfterCostUsd >= 0 ? '+' : ''}
                          {row.adaptive.netPnlAfterCostUsd.toFixed(2)}
                        </div>
                        <div className="text-slate-400">
                          CS: {row.baseline.netPnlAfterCostUsd >= 0 ? '+' : ''}
                          {row.baseline.netPnlAfterCostUsd.toFixed(2)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="text-slate-200">
                          TN (2x): {row.adaptive.netPnlAt2xCostUsd >= 0 ? '+' : ''}
                          {row.adaptive.netPnlAt2xCostUsd.toFixed(2)}
                        </div>
                        <div className="text-slate-400">
                          CS (2x): {row.baseline.netPnlAt2xCostUsd >= 0 ? '+' : ''}
                          {row.baseline.netPnlAt2xCostUsd.toFixed(2)}
                        </div>
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        <div>TN: ${row.adaptive.maxDrawdownUsd.toFixed(2)}</div>
                        <div className="text-slate-400">
                          CS: ${row.baseline.maxDrawdownUsd.toFixed(2)}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {/* Overall Row */}
                  <tr className="bg-slate-950/80 font-semibold">
                    <td className="py-3 pr-3 font-sans text-slate-100">
                      TOÀN KỲ (Tất cả trạng thái)
                    </td>
                    <td className="py-3 px-3 font-sans text-amber-300">
                      {tracedLearningRun.resultingPolicyId} vs {state.baselinePolicyId}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div>
                        TN: {tracedLearningRun.overallAdaptiveMetrics.opportunitiesCount} /{' '}
                        {tracedLearningRun.overallAdaptiveMetrics.tradesCount} lệnh
                      </div>
                      <div className="text-slate-400">
                        CS: {tracedLearningRun.overallBaselineMetrics.opportunitiesCount} /{' '}
                        {tracedLearningRun.overallBaselineMetrics.tradesCount} lệnh
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right text-emerald-400">
                      <div>
                        TN: +${tracedLearningRun.overallAdaptiveMetrics.netPnlAfterCostUsd.toFixed(2)}
                      </div>
                      <div className="text-slate-400 font-normal">
                        CS: +${tracedLearningRun.overallBaselineMetrics.netPnlAfterCostUsd.toFixed(2)}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right text-slate-100">
                      <div>
                        TN (2x): +${tracedLearningRun.overallAdaptiveMetrics.netPnlAt2xCostUsd.toFixed(2)}
                      </div>
                      <div className="text-slate-400 font-normal">
                        CS (2x): +${tracedLearningRun.overallBaselineMetrics.netPnlAt2xCostUsd.toFixed(2)}
                      </div>
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <div>
                        TN: ${tracedLearningRun.overallAdaptiveMetrics.maxDrawdownUsd.toFixed(2)}
                      </div>
                      <div className="text-slate-400 font-normal">
                        CS: ${tracedLearningRun.overallBaselineMetrics.maxDrawdownUsd.toFixed(2)}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center border border-dashed border-slate-800 rounded text-xs text-slate-400">
            Đội Nghiên cứu & Kiểm định đang tích lũy kết quả đối soát đầu tiên (Kỳ học đầu tiên kích hoạt tự động tại chu kỳ 18 và 34).
          </div>
        )}
      </section>

      {/* 4. Bidirectional Audit Traceability Inspector */}
      <section
        aria-label="Trình truy vết hai chiều từ Giao dịch và Kỳ học"
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        {/* Traceability A: Trade -> Candle -> Regime -> Risk -> Deals -> Reconciliation */}
        <div className="border border-slate-800 bg-slate-900/60 p-6 rounded-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Truy vết A: Từ Giao dịch → Nến M15, Quyết định & Dữ liệu
              </h2>
              <p className="text-xs text-slate-400">
                Liên kết xuyên suốt bằng mã chu kỳ (cycleId) từ nến đóng tới đối soát.
              </p>
            </div>
            <select
              aria-label="Chọn giao dịch để truy vết"
              value={tracedPosition?.positionId || ''}
              onChange={(e) => setSelectedPositionId(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100"
            >
              {allPositions.length === 0 && <option value="">Chưa có giao dịch</option>}
              {allPositions.map((p) => (
                <option key={p.positionId} value={p.positionId}>
                  {p.positionId} ({p.strategyId}@{p.strategyVersion}) — {p.entryCycleId}
                </option>
              ))}
            </select>
          </div>

          {!tracedPosition ? (
            <div className="py-8 text-center border border-dashed border-slate-800 rounded text-xs text-slate-400">
              Chưa có giao dịch mô phỏng nào để truy vết.
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <div className="border border-slate-800 bg-slate-950/70 p-3.5 rounded space-y-1.5">
                <div className="font-semibold text-amber-300">
                  Bước 1 — Nến Mở lệnh & Dữ liệu Chỉ báo ({tracedPosition.entryCandleId} ·{' '}
                  {tracedPosition.entryCycleId})
                </div>
                {tracedPositionEntryCycle ? (
                  <div className="font-mono tabular-nums text-slate-300 space-y-1">
                    <div>
                      Giờ đóng nến: {tracedPositionEntryCycle.candle.closeTime} · Giá Close:{' '}
                      {tracedPositionEntryCycle.candle.close.toFixed(2)} USD
                    </div>
                    <div>
                      Trạng thái:{' '}
                      {tracedPositionEntryCycle.regimeClassification?.regimeLabelVi} · EMA20:{' '}
                      {tracedPositionEntryCycle.regimeClassification?.indicators.emaFast20.toFixed(2)}{' '}
                      · EMA50:{' '}
                      {tracedPositionEntryCycle.regimeClassification?.indicators.emaSlow50.toFixed(2)}{' '}
                      · Z-Score:{' '}
                      {tracedPositionEntryCycle.regimeClassification?.indicators.zScore20.toFixed(2)}
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-400">Đã lưu tham chiếu {tracedPosition.entryCycleId}</div>
                )}
              </div>

              <div className="border border-slate-800 bg-slate-950/70 p-3.5 rounded space-y-1.5">
                <div className="font-semibold text-amber-300">
                  Bước 2 — Quyết định Điều phối & Chốt Rủi ro ({tracedPosition.signalId})
                </div>
                <div className="text-slate-300">
                  Chính sách lúc mở: <span className="font-mono">{tracedPosition.openedUnderPolicyId}</span> · Chiến lược:{' '}
                  <span className="font-mono">
                    {tracedPosition.strategyId}@{tracedPosition.strategyVersion}
                  </span>
                </div>
                {tracedPositionEntryCycle?.riskDecision && (
                  <div className="text-emerald-400">
                    {tracedPositionEntryCycle.riskDecision.reasonVi}
                  </div>
                )}
              </div>

              <div className="border border-slate-800 bg-slate-950/70 p-3.5 rounded space-y-1.5">
                <div className="font-semibold text-amber-300">
                  Bước 3 — Khớp lệnh Broker Mô phỏng & Đối soát ({tracedPosition.reconciliationId || 'Đang mở'})
                </div>
                <div className="font-mono tabular-nums text-slate-300">
                  Giá vào dự kiến: {tracedPosition.expectedEntryPrice.toFixed(2)} → Giá khớp:{' '}
                  {tracedPosition.fillEntryPrice.toFixed(2)} (Trượt {tracedPosition.entrySlippagePts}{' '}
                  pts, Spread {tracedPosition.entrySpreadPts} pts)
                </div>
                <div className="font-mono tabular-nums text-slate-300">
                  Khối lượng khớp: {tracedPosition.filledVolumeLots} lot · Đã đóng:{' '}
                  {tracedPosition.closedVolumeLots} lot · Chi phí tổng: $
                  {tracedPosition.totalCostUsd.toFixed(2)}
                </div>
                {tracedPositionReconciliation ? (
                  <div className="text-emerald-400">
                    {tracedPositionReconciliation.summaryVi} (Chu kỳ đóng:{' '}
                    {tracedPositionCloseCycle?.cycleId || tracedPosition.closeCycleId})
                  </div>
                ) : (
                  <div className="text-amber-300">
                    Vị thế đang mở — sẽ tự động đối soát khi đóng hết 100% khối lượng.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Traceability B: Learning Run -> Reconciled Trades, Shadow Outcomes & Walk-Forward Exclusions */}
        <div className="border border-slate-800 bg-slate-900/60 p-6 rounded-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Truy vết B: Từ Lần học → Kết quả Đối soát & Mẫu Loại trừ
              </h2>
              <p className="text-xs text-slate-400">
                Kiểm tra khoảng dữ liệu, danh sách mẫu đã dùng và lý do loại mẫu chồng lấn.
              </p>
            </div>
          </div>

          {!tracedLearningRun ? (
            <div className="py-8 text-center border border-dashed border-slate-800 rounded text-xs text-slate-400">
              Chưa có kỳ học nào hoàn tất.
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <div className="border border-slate-800 bg-slate-950/70 p-3.5 rounded space-y-1">
                <div className="font-semibold text-amber-300">
                  Kỳ học {tracedLearningRun.runId} (Kích hoạt tại {tracedLearningRun.triggerCycleId})
                </div>
                <div className="font-mono tabular-nums text-slate-300">
                  Cửa sổ Huấn luyện: {tracedLearningRun.trainWindowStartMarketTime.slice(11, 16)} →{' '}
                  {tracedLearningRun.trainWindowEndMarketTime.slice(11, 16)} UTC · Kiểm định:{' '}
                  {tracedLearningRun.validationWindowStartMarketTime.slice(11, 16)} →{' '}
                  {tracedLearningRun.validationWindowEndMarketTime.slice(11, 16)} UTC
                </div>
                <div className="text-slate-200">{tracedLearningRun.decisionReasonVi}</div>
              </div>

              <div className="border border-slate-800 bg-slate-950/70 p-3.5 rounded space-y-1.5">
                <div className="font-semibold text-slate-200">
                  Giao dịch Thực thi Đã đối soát Tham gia Kỳ học ({tracedLearningRun.reconciledPositionIdsUsed.length})
                </div>
                <div className="font-mono text-slate-300">
                  {tracedLearningRun.reconciledPositionIdsUsed.length > 0
                    ? tracedLearningRun.reconciledPositionIdsUsed.join(', ')
                    : 'Chưa có vị thế hoàn tất tại thời điểm cắt'}
                </div>
                <div className="text-slate-400">
                  Chu kỳ mẫu Shadow & Thực thi ({tracedLearningRun.totalCompletedSamplesUsed} mẫu hoàn tất):{' '}
                  <span className="font-mono text-slate-300">
                    {tracedLearningRun.sampleCycleIdsUsed.join(', ') || '—'}
                  </span>
                </div>
              </div>

              <div className="border border-slate-800 bg-slate-950/70 p-3.5 rounded space-y-1.5">
                <div className="font-semibold text-slate-200">
                  Mẫu Bị loại trừ Để Chống Rò rỉ Dữ liệu ({tracedLearningRun.exclusions.length})
                </div>
                {tracedLearningRun.exclusions.length === 0 ? (
                  <div className="text-slate-400">Không có mẫu chồng lấn trong kỳ này.</div>
                ) : (
                  <ul className="space-y-1 max-h-32 overflow-y-auto font-mono text-slate-300">
                    {tracedLearningRun.exclusions.slice(0, 6).map((ex) => (
                      <li key={ex.shadowId} className="text-xs">
                        [{ex.exclusionCode}] {ex.shadowId}: <span className="font-sans text-slate-400">{ex.reasonVi}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
