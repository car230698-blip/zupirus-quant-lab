import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildDeterministicReplayDataset,
  validateIncomingCandle,
} from '../src/quant/dataReplay.ts';
import { classifyMarketRegime } from '../src/quant/regimeDetector.ts';
import {
  BASELINE_POLICY_ID,
  evaluateAllStrategyCandidates,
  evaluateMultiTimeframeCandidates,
  selectStrategyForCycle,
} from '../src/quant/strategies.ts';
import {
  cloneRiskLimits,
  evaluateRiskGate,
  guardLearnerCannotModifyRiskLimits,
} from '../src/quant/riskGate.ts';
import {
  assertSimulationOnlyBroker,
  openSimulatedPosition,
  stepOpenPositionOnCandle,
} from '../src/quant/simBroker.ts';
import { reconcileClosedPosition } from '../src/quant/reconciliation.ts';
import { latestClosedContext } from '../src/quant/timeframes.ts';
import { executeWalkForwardLearningRun } from '../src/quant/researchTeam.ts';
import { QuantLabOrchestrator } from '../src/quant/orchestrator.ts';
import { createQuantServer } from '../server.ts';
import { ExecutionMode, M15Candle } from '../src/quant/types.ts';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `zupirus-${prefix}-`));
}

describe('ZUPIRUS Quant Lab — Kiểm thử toàn diện hệ thống XAUUSD M15 tự vận hành', () => {
  it('1. Luồng đầu cuối qua Server (End-to-End): Nến đóng -> Quyết định -> Lệnh mô phỏng -> Đối soát -> Học Walk-Forward', async () => {
    const tmpDir = createTempDir('e2e');
    const replayFile = path.join(tmpDir, 'xauusd_m15_replay.json');

    const { orchestrator } = await createQuantServer({
      dataDir: path.join(tmpDir, 'runtime'),
      replayFilePath: replayFile,
      replayIntervalMs: 5000,
      autoStart: false,
      attachFrontend: false,
    });

    assert.equal(orchestrator.getState().activePolicyId, BASELINE_POLICY_ID);

    // Chạy trọn 72 nến M15 qua đúng luồng điều phối của server
    let traceCount = 0;
    while (!orchestrator.getState().isReplayComplete) {
      const trace = orchestrator.stepNextReplayCandle();
      if (!trace) break;
      traceCount++;
    }

    const finalState = orchestrator.getState();
    assert.equal(traceCount, 72, 'Phải xử lý đủ 72 nến M15 trong bộ phát lại');
    assert.equal(finalState.replayCursorIndex, 72);
    assert.equal(finalState.isReplayComplete, true);

    // Kiểm tra đã phát sinh giao dịch mô phỏng, đóng một phần TP1, đóng hết TP2 và đối soát
    assert.ok(
      finalState.closedPositions.length >= 6,
      `Phải có ít nhất 6 vị thế đã đóng và đối soát (Thực tế: ${finalState.closedPositions.length})`
    );
    assert.ok(
      finalState.reconciliations.every((r) => r.status === 'RECONCILED_OK' && r.volumeMatched),
      'Mọi vị thế đã đóng phải đối soát khớp 100% khối lượng'
    );
    assert.ok(
      finalState.closedPositions.some((p) => p.partialTp1Hit),
      'Phải có vị thế thực hiện đóng một phần (50%) tại TP1 trước khi đóng hết'
    );

    const highSpread = finalState.cycleTraces.find((trace) => trace.candle.spreadPts === 48);
    assert.ok(highSpread);
    assert.ok(highSpread.coordinatorDecision?.candidatesConsidered.some((candidate) => candidate.eligibleToEnter));
    assert.deepEqual(highSpread.shadowOutcomeIds, []);

    const selectedShadows = finalState.shadowOutcomes.filter((sample) => sample.wasSelectedByActivePolicy);
    assert.ok(selectedShadows.length > 0);
    for (const shadow of selectedShadows) {
      const trace = finalState.cycleTraces.find((cycle) => cycle.cycleId === shadow.cycleId);
      assert.equal(shadow.riskSizedVolumeLots, trace?.riskDecision?.approvedLots);
    }

    assert.equal(finalState.learningRuns.length, 5);
    assert.equal(finalState.activePolicyId, BASELINE_POLICY_ID,
      'Bộ phát lại ngắn giữ chính sách cơ sở khi chưa đủ bằng chứng ngoài mẫu');
    const learningRun = finalState.learningRuns.at(-1)!;
    assert.ok(learningRun.trainingSampleIds!.length > 0);
    assert.ok(learningRun.validationSampleIds!.length > 0);

    // Kiểm tra truy vết hai chiều: Từ giao dịch về nến & quyết định, và từ lần học về kết quả đối soát
    const samplePos = finalState.closedPositions[0];
    const posTrace = orchestrator.getPositionFullTrace(samplePos.positionId);
    assert.ok(posTrace);
    assert.equal(posTrace.entryCycleTrace?.cycleId, samplePos.entryCycleId);
    assert.ok(posTrace.reconciliation?.volumeMatched);

    const lrTrace = orchestrator.getLearningRunFullTrace(learningRun.runId);
    assert.ok(lrTrace);
    assert.ok(lrTrace.reconciledPositionsUsed.length > 0);
    assert.ok(lrTrace.shadowOutcomesUsed.length > 0);
  });

  it('2. Tự động vận hành sau khi khởi động mà không cần bấm nút (Auto-Start Loop)', async () => {
    const tmpDir = createTempDir('autoloop');
    const replayFile = path.join(tmpDir, 'xauusd_m15_replay.json');

    const { orchestrator } = await createQuantServer({
      dataDir: path.join(tmpDir, 'runtime'),
      replayFilePath: replayFile,
      replayIntervalMs: 25,
      autoStart: true,
      attachFrontend: false,
    });

    // Chờ 160ms mà không gọi bất kỳ hàm step hay nút bấm nào
    await new Promise((resolve) => setTimeout(resolve, 160));
    orchestrator.stopAutoLoop();

    const state = orchestrator.getState();
    assert.ok(
      state.replayCursorIndex >= 3,
      `Hệ thống phải tự động xử lý nến ngay sau khi khởi động mà không cần bấm nút (Đã xử lý: ${state.replayCursorIndex} nến)`
    );
    assert.ok(state.cycleTraces.length >= 3);
  });

  it('3. Kiểm tra đứng ngoài khi Thiếu dữ liệu (INSUFFICIENT_DATA) và Biến động sốc (VOLATILITY_SHOCK)', () => {
    const tmpDir = createTempDir('standaside');
    const replayFile = path.join(tmpDir, 'xauusd_m15_replay.json');
    const orchestrator = new QuantLabOrchestrator({
      dataDir: path.join(tmpDir, 'runtime'),
      replayFilePath: replayFile,
      autoStart: false,
    });

    // Nến 1..14: Thiếu dữ liệu lịch sử (< 15 nến) -> Phải đứng ngoài
    for (let i = 0; i < 14; i++) {
      const trace = orchestrator.stepNextReplayCandle()!;
      assert.equal(trace.regimeClassification?.regime, 'INSUFFICIENT_DATA');
      assert.equal(trace.coordinatorDecision?.action, 'STAND_ASIDE');
      assert.equal(trace.openedPositionId, undefined);
    }

    // Chạy tới nến 59 (Biến động sốc vĩ mô: biên độ > 15 USD trong 15 phút)
    let trace59 = null;
    while (orchestrator.getState().replayCursorIndex < 59) {
      trace59 = orchestrator.stepNextReplayCandle();
    }
    assert.ok(trace59);
    assert.equal(trace59.regimeClassification?.regime, 'VOLATILITY_SHOCK');
    assert.equal(trace59.regimeClassification?.allowTrading, false);
    assert.equal(trace59.coordinatorDecision?.action, 'STAND_ASIDE');
    assert.equal(trace59.openedPositionId, undefined);
  });

  it('4. Chốt rủi ro có quyền phủ quyết (Risk Veto) và Bộ học không được sửa giới hạn rủi ro', () => {
    const dataset = buildDeterministicReplayDataset();
    const candle = dataset.candles[21]; // Nến có spreadPts = 48 (> trần 40 pts)
    const regime = classifyMarketRegime('CYCLE-TEST', dataset.candles.slice(0, 22));
    const candidates = evaluateAllStrategyCandidates(
      dataset.candles.slice(0, 22),
      regime
    );
    const eligible = candidates.find((c) => c.eligibleToEnter)!;
    assert.ok(eligible, 'Phải có ứng viên đủ điều kiện kỹ thuật');

    const limits = cloneRiskLimits();

    // 4a. Phủ quyết do Spread vượt trần (48 pts > 40 pts)
    const spreadVeto = evaluateRiskGate({
      cycleId: 'CYCLE-0022',
      candle,
      signalId: 'SIG-TEST-1',
      candidate: eligible,
      openPositions: [],
      currentDrawdownPct: 0.5,
      dailyDrawdownPct: 0.5,
      riskLimits: limits,
      requestedLots: 0.5,
    });
    assert.equal(spreadVeto.vetoed, true);
    assert.equal(spreadVeto.approved, false);
    assert.equal(spreadVeto.vetoCode, 'EXCESSIVE_SPREAD');

    // 4b. Phủ quyết do Sụt giảm vượt ngưỡng tối đa
    const normalCandle = { ...candle, spreadPts: 16 };
    const ddVeto = evaluateRiskGate({
      cycleId: 'CYCLE-0023',
      candle: normalCandle,
      signalId: 'SIG-TEST-2',
      candidate: eligible,
      openPositions: [],
      currentDrawdownPct: 8.5,
      dailyDrawdownPct: 2.0,
      riskLimits: limits,
      requestedLots: 0.5,
    });
    assert.equal(ddVeto.vetoed, true);
    assert.equal(ddVeto.vetoCode, 'MAX_TOTAL_DRAWDOWN_EXCEEDED');

    // 4c. Phủ quyết do Khối lượng vượt giới hạn
    const volVeto = evaluateRiskGate({
      cycleId: 'CYCLE-0024',
      candle: normalCandle,
      signalId: 'SIG-TEST-3',
      candidate: eligible,
      openPositions: [],
      currentDrawdownPct: 0.2,
      dailyDrawdownPct: 0.2,
      riskLimits: limits,
      requestedLots: 1.5, // > maxVolumeLotsPerTrade (1.0)
    });
    assert.equal(volVeto.vetoed, true);
    assert.equal(volVeto.vetoCode, 'MAX_VOLUME_EXCEEDED');

    const sizedOrder = evaluateRiskGate({
      cycleId: 'CYCLE-0025',
      candle: normalCandle,
      signalId: 'SIG-SIZED',
      candidate: { ...eligible, entryPrice: 3968.89, stopLoss: 3957.97 },
      openPositions: [],
      currentDrawdownPct: 0,
      dailyDrawdownPct: 0,
      riskLimits: limits,
      requestedLots: 0.5,
      accountEquityUsd: 10000,
    });
    assert.equal(sizedOrder.approved, true);
    assert.equal(sizedOrder.approvedLots, 0.08);

    // 4d. Bộ học bị chặn nếu cố sửa đổi giới hạn rủi ro cốt lõi
    const tamperedLimits = { ...limits, maxTotalDrawdownPct: 25.0 };
    assert.throws(
      () => guardLearnerCannotModifyRiskLimits(limits, tamperedLimits),
      /VIOLATION_RISK_GOVERNANCE/
    );
  });

  it('5. Thiếu mẫu (Insufficient Samples) giữ nguyên chính sách hiện tại, Không nhìn trước dữ liệu và Ngăn rò rỉ giữa các kỳ Walk-Forward', () => {
    const tmpDir = createTempDir('wf-leakage');
    const replayFile = path.join(tmpDir, 'xauusd_m15_replay.json');
    const orchestrator = new QuantLabOrchestrator({
      dataDir: path.join(tmpDir, 'runtime'),
      replayFilePath: replayFile,
      autoStart: false,
    });

    // Chạy đến chu kỳ 18 (Kỳ học đầu tiên khi mới có rất ít mẫu)
    while (orchestrator.getState().replayCursorIndex < 18) {
      orchestrator.stepNextReplayCandle();
    }

    const stateAt18 = orchestrator.getState();
    assert.equal(stateAt18.learningRuns.length, 1);
    const firstRun = stateAt18.learningRuns[0];
    assert.equal(
      firstRun.decision,
      'KEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES',
      'Khi thiếu mẫu phải ghi rõ KEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES và giữ nguyên chính sách'
    );
    assert.equal(stateAt18.activePolicyId, BASELINE_POLICY_ID);

    // Chạy tiếp tới chu kỳ 34 và kiểm tra việc loại mẫu chồng lấn ranh giới Walk-Forward (OVERLAPS_WF_BOUNDARY) & mẫu chưa đóng (UNCLOSED_AT_CUTOFF)
    while (orchestrator.getState().replayCursorIndex < 34) {
      orchestrator.stepNextReplayCandle();
    }
    const stateAt34 = orchestrator.getState();
    const run2 = stateAt34.learningRuns[1];
    assert.ok(run2);

    // Kiểm tra bằng dữ liệu nhân tạo có thời gian giữ lệnh chồng qua ranh giới train/validation
    const syntheticOverlappingOutcome = {
      ...stateAt34.shadowOutcomes[0],
      shadowId: 'SHDW-OVERLAP-TEST',
      status: 'CLOSED_RECONCILED' as const,
      entryMarketTime: '2026-03-02T11:30:00.000Z',
      closeMarketTime: '2026-03-02T16:15:00.000Z', // Chồng qua ranh giới split
    };
    const syntheticUnclosedFutureOutcome = {
      ...stateAt34.shadowOutcomes[0],
      shadowId: 'SHDW-FUTURE-UNCLOSED',
      status: 'CLOSED_RECONCILED' as const,
      entryMarketTime: '2026-03-02T15:45:00.000Z',
      closeMarketTime: '2026-03-02T19:00:00.000Z', // Đóng sau thời điểm cutoff 16:30 UTC
    };

    const wfCheck = executeWalkForwardLearningRun({
      runId: 'LR-LEAK-TEST',
      triggerCycleId: 'CYCLE-0034',
      decisionMarketTime: '2026-03-02T16:30:00.000Z',
      triggerReasonVi: 'Kiểm thử chống rò rỉ Walk-Forward',
      allShadowOutcomes: [
        ...stateAt34.shadowOutcomes,
        syntheticOverlappingOutcome,
        syntheticUnclosedFutureOutcome,
      ],
      reconciledPositions: stateAt34.closedPositions,
      activePolicy: stateAt34.policies[0],
      baselinePolicy: stateAt34.policies[0],
      allPolicies: stateAt34.policies,
      minSamplesPerRegime: 2,
    });

    assert.ok(
      wfCheck.learningRun.exclusions.some(
        (e) =>
          e.shadowId === 'SHDW-OVERLAP-TEST' &&
          e.exclusionCode === 'OVERLAPS_WF_BOUNDARY'
      ),
      'Phải loại bỏ mẫu có thời gian giữ lệnh chồng qua ranh giới huấn luyện và kiểm định (OVERLAPS_WF_BOUNDARY)'
    );
    assert.ok(
      wfCheck.learningRun.exclusions.some(
        (e) =>
          e.shadowId === 'SHDW-FUTURE-UNCLOSED' &&
          e.exclusionCode === 'UNCLOSED_AT_CUTOFF'
      ),
      'Phải loại bỏ mẫu đóng sau thời điểm ra quyết định học (UNCLOSED_AT_CUTOFF)'
    );
  });

  it('6. Xử lý trùng sự kiện (Idempotency) và Khôi phục sau Restart không tạo lệnh trùng hay tính P&L hai lần', () => {
    const tmpDir = createTempDir('restart-idempotent');
    const replayFile = path.join(tmpDir, 'xauusd_m15_replay.json');
    const runtimeDir = path.join(tmpDir, 'runtime');

    const orch1 = new QuantLabOrchestrator({
      dataDir: runtimeDir,
      replayFilePath: replayFile,
      autoStart: false,
    });

    // Chạy 25 nến đầu tiên
    for (let i = 0; i < 25; i++) {
      orch1.stepNextReplayCandle();
    }

    const stateBeforeDup = structuredClone(orch1.getState());
    const candle25 = stateBeforeDup.cycleTraces[24].candle;

    // Gửi lại đúng nến thứ 25 đã xử lý -> Phải trả về kết quả cũ, không tạo thêm lệnh hay cộng P&L lần 2
    const dupTrace = orch1.processClosedCandle(candle25);
    const stateAfterDup = orch1.getState();

    assert.equal(dupTrace.cycleId, stateBeforeDup.cycleTraces[24].cycleId);
    assert.equal(stateAfterDup.balanceUsd, stateBeforeDup.balanceUsd);
    assert.equal(stateAfterDup.equityUsd, stateBeforeDup.equityUsd);
    assert.equal(
      stateAfterDup.closedPositions.length,
      stateBeforeDup.closedPositions.length
    );
    assert.equal(
      stateAfterDup.openPositions.length,
      stateBeforeDup.openPositions.length
    );

    // Kiểm tra từ chối nến chưa đóng (isClosed = false)
    const unclosedCandle: M15Candle = {
      ...candle25,
      candleId: 'XAU-UNCLOSED-9999',
      closeTime: '2026-03-02T14:30:00.000Z',
      isClosed: false,
    };
    const unclosedVal = validateIncomingCandle(
      unclosedCandle,
      stateAfterDup.lastProcessedMarketTime,
      new Set(stateAfterDup.processedCandleIds)
    );
    assert.equal(unclosedVal.valid, false);
    assert.equal(unclosedVal.errorCode, 'NOT_CLOSED');

    // Khởi tạo Orchestrator mới trên cùng thư mục lưu trữ (Mô phỏng Restart tiến trình)
    const orchRestarted = new QuantLabOrchestrator({
      dataDir: runtimeDir,
      replayFilePath: replayFile,
      autoStart: false,
    });

    const recoveredState = orchRestarted.getState();
    assert.equal(recoveredState.restartCount, 1);
    assert.equal(recoveredState.replayCursorIndex, 25);
    assert.equal(recoveredState.balanceUsd, stateBeforeDup.balanceUsd);
    assert.equal(
      recoveredState.closedPositions.length,
      stateBeforeDup.closedPositions.length
    );

    // Tiếp tục xử lý nến thứ 26 sau restart
    const trace26 = orchRestarted.stepNextReplayCandle();
    assert.ok(trace26);
    assert.equal(orchRestarted.getState().replayCursorIndex, 26);
  });

  it('7. Đóng một phần, Chi phí 1x/2x, Xung đột SL/TP trong cùng nến (CONSERVATIVE_SL_FIRST), Từ chối & Hết hạn lệnh', () => {
    const dataset = buildDeterministicReplayDataset();
    const entryCandle = dataset.candles[14];
    const regime = classifyMarketRegime('CYCLE-0015', dataset.candles.slice(0, 15));
    const candidate = evaluateAllStrategyCandidates(
      dataset.candles.slice(0, 15),
      regime
    ).find((c) => c.eligibleToEnter)!;

    // Mở vị thế 1.0 lot
    const openPos = openSimulatedPosition({
      executionMode: 'SIMULATION_ONLY',
      positionId: 'POS-TEST-01',
      signalId: 'SIG-TEST-01',
      cycleId: 'CYCLE-0015',
      candle: entryCandle,
      regime: 'TRENDING',
      openedUnderPolicyId: BASELINE_POLICY_ID,
      candidate,
      volumeLots: 1.0,
    });

    assert.equal(openPos.status, 'FILLED');
    assert.equal(openPos.filledVolumeLots, 1.0);
    assert.equal(openPos.remainingVolumeLots, 1.0);

    // Bước qua nến chạm TP1 nhưng chưa chạm TP2 -> Đóng một phần 50% (0.5 lot)
    const tp1Candle: M15Candle = {
      ...entryCandle,
      candleId: 'XAU-TP1-BAR',
      high: openPos.takeProfit1 + 0.1,
      low: openPos.fillEntryPrice - 0.1,
      close: openPos.takeProfit1,
    };
    const afterTp1 = stepOpenPositionOnCandle(openPos, 'CYCLE-0016', tp1Candle);
    assert.equal(afterTp1.status, 'PARTIAL_CLOSED');
    assert.equal(afterTp1.partialTp1Hit, true);
    assert.equal(afterTp1.closedVolumeLots, 0.5);
    assert.equal(afterTp1.remainingVolumeLots, 0.5);

    // Khi mới đóng một phần (0.5/1.0 lot), đối soát KHÔNG được xác nhận đã đóng hết
    const prematureRecon = reconcileClosedPosition(afterTp1);
    assert.equal(prematureRecon.record.volumeMatched, false);
    assert.equal(prematureRecon.reconciledPosition.reconciled, false);

    // Bước qua nến chạm TP2 -> Đóng hết 0.5 lot còn lại -> Đối soát khớp 1.0/1.0 lot
    const tp2Candle: M15Candle = {
      ...entryCandle,
      candleId: 'XAU-TP2-BAR',
      high: openPos.takeProfit2 + 0.2,
      low: openPos.fillEntryPrice,
      close: openPos.takeProfit2,
    };
    const afterTp2 = stepOpenPositionOnCandle(afterTp1, 'CYCLE-0017', tp2Candle);
    assert.equal(afterTp2.status, 'CLOSED');
    assert.equal(afterTp2.closedVolumeLots, 1.0);
    assert.equal(afterTp2.remainingVolumeLots, 0);
    assert.ok(afterTp2.totalCostUsd > 0);
    assert.equal(
      afterTp2.netPnlAt2xCostUsd,
      Number((afterTp2.grossPnlUsd - 2 * afterTp2.totalCostUsd).toFixed(2))
    );

    const finalRecon = reconcileClosedPosition(afterTp2);
    assert.equal(finalRecon.record.volumeMatched, true);
    assert.equal(finalRecon.record.status, 'RECONCILED_OK');
    assert.equal(finalRecon.reconciledPosition.reconciled, true);

    // Kiểm tra xung đột SL và TP cùng chạm trong 1 nến -> Phải ưu tiên khớp SL trước (CONSERVATIVE_SL_FIRST)
    const conflictCandle: M15Candle = {
      ...entryCandle,
      candleId: 'XAU-CONFLICT-BAR',
      high: openPos.takeProfit2 + 1.0,
      low: openPos.stopLoss - 1.0,
      close: openPos.expectedEntryPrice,
    };
    const conflictPos = stepOpenPositionOnCandle(
      openPos,
      'CYCLE-CONFLICT',
      conflictCandle
    );
    assert.equal(conflictPos.status, 'CLOSED');
    assert.equal(
      conflictPos.exitReason,
      'INTRA_BAR_SL_TP_CONFLICT_SL_FIRST'
    );
    assert.ok(conflictPos.netPnlUsd < 0);

    // Kiểm tra mô phỏng lệnh bị từ chối (REJECTED) và lệnh hết hạn (EXPIRED)
    const rejectedOrder = openSimulatedPosition({
      executionMode: 'SIMULATION_ONLY',
      positionId: 'POS-REJECT',
      signalId: 'SIG-REJECT',
      cycleId: 'CYCLE-REJ',
      candle: entryCandle,
      regime: 'TRENDING',
      openedUnderPolicyId: BASELINE_POLICY_ID,
      candidate,
      volumeLots: 0.5,
      forceBrokerRejectReasonVi: 'Từ chối lệnh do biên độ trượt giá vượt giới hạn',
    });
    assert.equal(rejectedOrder.status, 'REJECTED');
    assert.equal(rejectedOrder.filledVolumeLots, 0);

    const expiredOrder = openSimulatedPosition({
      executionMode: 'SIMULATION_ONLY',
      positionId: 'POS-EXPIRED',
      signalId: 'SIG-EXPIRED',
      cycleId: 'CYCLE-EXP',
      candle: entryCandle,
      regime: 'TRENDING',
      openedUnderPolicyId: BASELINE_POLICY_ID,
      candidate,
      volumeLots: 0.5,
      forceOrderExpired: true,
    });
    assert.equal(expiredOrder.status, 'EXPIRED');
  });

  it('8. Quay lui tự động (Auto-Rollback), Dừng mở vị thế khi suy giảm và Giữ nguyên quy tắc quản lý cho vị thế đang mở', () => {
    const tmpDir = createTempDir('rollback');
    const replayFile = path.join(tmpDir, 'xauusd_m15_replay.json');
    const orchestrator = new QuantLabOrchestrator({
      dataDir: path.join(tmpDir, 'runtime'),
      replayFilePath: replayFile,
      autoStart: false,
    });

    // Tạo trạng thái đủ dữ liệu rồi mô phỏng một chính sách đã được kích hoạt
    while (orchestrator.getState().replayCursorIndex < 48) {
      orchestrator.stepNextReplayCandle();
    }
    const state = orchestrator.getState();
    const baseline = state.policies[0];
    baseline.status = 'SUPERSEDED';
    state.policies.push({ ...structuredClone(baseline), policyId: 'POLICY_ADAPTIVE_V2',
      versionNumber: 2, status: 'ACTIVE', isBaseline: false });
    state.activePolicyId = 'POLICY_ADAPTIVE_V2';

    // Mở một vị thế dưới POLICY_ADAPTIVE_V2 và lưu lại snapshot quy tắc quản lý của nó
    const dataset = buildDeterministicReplayDataset();
    const candle48 = dataset.candles[47];
    const regime15 = classifyMarketRegime('CYCLE-0015', dataset.candles.slice(0, 15));
    const cand35 = evaluateAllStrategyCandidates(
      dataset.candles.slice(0, 15),
      regime15
    ).find((c) => c.eligibleToEnter)!;

    const openPosUnderV2 = openSimulatedPosition({
      executionMode: 'SIMULATION_ONLY',
      positionId: 'POS-PINNED-V2',
      signalId: 'SIG-PINNED-V2',
      cycleId: 'CYCLE-0048',
      candle: candle48,
      regime: 'SQUEEZE_PRE_BREAKOUT',
      openedUnderPolicyId: 'POLICY_ADAPTIVE_V2',
      candidate: cand35,
      volumeLots: 0.5,
    });
    const originalSnapshot = structuredClone(openPosUnderV2.managementRulesSnapshot);
    state.openPositions.push(openPosUnderV2);

    // Giả lập một giao dịch đã đóng dưới POLICY_ADAPTIVE_V2 bị lỗ nặng (-280 USD <= ngưỡng -220 USD)
    state.closedPositions.push({
      ...openPosUnderV2,
      positionId: 'POS-DEGRADED-LOSS',
      status: 'CLOSED',
      reconciled: true,
      closeMarketTime: candle48.closeTime,
      netPnlUsd: -280,
      grossPnlUsd: -270,
      totalCostUsd: 10,
    });

    // Kích hoạt kỳ học kiểm định -> Phải tự động QUAY LUI (ROLLBACK_TO_PREVIOUS_POLICY) về POLICY_BASELINE_FIXED_V1
    const rbResult = orchestrator.runResearchAndValidationCycle(
      'CYCLE-0048-RB',
      candle48.closeTime,
      'Kiểm tra cơ chế tự quay lui khi chính sách suy giảm qua ngưỡng'
    );

    assert.equal(rbResult.learningRun.decision, 'ROLLBACK_TO_PREVIOUS_POLICY');
    assert.equal(orchestrator.getState().activePolicyId, BASELINE_POLICY_ID);

    // Xác minh vị thế đang mở (POS-PINNED-V2) vẫn giữ nguyên quy tắc quản lý của POLICY_ADAPTIVE_V2
    const pinnedStillOpen = orchestrator
      .getState()
      .openPositions.find((p) => p.positionId === 'POS-PINNED-V2')!;
    assert.deepEqual(pinnedStillOpen.managementRulesSnapshot, originalSnapshot);
    assert.equal(pinnedStillOpen.openedUnderPolicyId, 'POLICY_ADAPTIVE_V2');

    // Khi cả chính sách cơ sở cũng suy giảm quá ngưỡng và không còn phiên bản hợp lệ -> Ngừng mở vị thế mới
    state.closedPositions.push({
      ...openPosUnderV2,
      positionId: 'POS-BASELINE-DEGRADED-LOSS',
      openedUnderPolicyId: BASELINE_POLICY_ID,
      status: 'CLOSED',
      reconciled: true,
      closeMarketTime: candle48.closeTime,
      netPnlUsd: -3000,
      grossPnlUsd: -2990,
      totalCostUsd: 10,
    });
    const haltResult = orchestrator.runResearchAndValidationCycle(
      'CYCLE-0048-HALT',
      candle48.closeTime,
      'Kiểm tra ngừng mở vị thế khi không còn phiên bản hợp lệ'
    );
    assert.equal(haltResult.learningRun.decision, 'HALT_NEW_POSITIONS_DEGRADED');
    assert.equal(orchestrator.getState().riskLimits.haltNewPositionsByLearner, true);
  });

  it('9. Chốt chặn Broker: Phiên bản mô phỏng chỉ cho phép gửi lệnh đến Broker mô phỏng (SIMULATION_ONLY)', () => {
    assert.doesNotThrow(() => assertSimulationOnlyBroker('SIMULATION_ONLY'));
    assert.throws(
      () => assertSimulationOnlyBroker('MT5_LIVE' as unknown as ExecutionMode),
      /FATAL_BROKER_GUARD/
    );
  });

  it('Khôi phục mẫu song song khi restart tại nến 69, kể cả từ trạng thái cũ', () => {
    const run = (restart: 'none' | 'current' | 'legacy') => {
      const directory = createTempDir('shadow-restart');
      const options = { dataDir: directory,
        replayFilePath: path.join(directory, 'replay.json'), autoStart: false };
      let orchestrator = new QuantLabOrchestrator(options);
      const step = () => orchestrator.processClosedCandle(
        buildDeterministicReplayDataset().candles[orchestrator.getState().replayCursorIndex],
        '2026-03-04T00:00:00.000Z'
      );
      while (orchestrator.getState().replayCursorIndex < 69) step();
      assert.ok(Object.keys(orchestrator.getState().openShadowPositions!).length > 0);
      if (restart === 'legacy') {
        const stateFile = orchestrator.getStoragePaths().stateFilePath;
        const oldState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        delete oldState.openShadowPositions;
        fs.writeFileSync(stateFile, JSON.stringify(oldState));
      }
      if (restart !== 'none') orchestrator = new QuantLabOrchestrator(options);
      while (orchestrator.getState().replayCursorIndex < 72) step();
      const state = orchestrator.getState();
      return { samples: state.shadowOutcomes, balance: state.balanceUsd,
        runs: state.learningRuns.map((item) => ({
          decision: item.decision, train: item.trainingSampleIds, validation: item.validationSampleIds,
        })) };
    };
    const continuous = run('none');
    assert.deepEqual(run('current'), continuous);
    assert.deepEqual(run('legacy'), continuous);
  });

  it('Chỉ dùng nến H1 và H4 hoàn chỉnh tại thời điểm ra quyết định', () => {
    const candles = buildDeterministicReplayDataset().candles;
    const beforeH4Close = candles[14].closeTime;
    assert.equal(latestClosedContext(candles, beforeH4Close, 'H4'), undefined);
    const atH4Close = candles[15].closeTime;
    const h4 = latestClosedContext(candles, atH4Close, 'H4');
    assert.ok(h4);
    assert.equal(h4.closeTime, atH4Close);
    assert.deepEqual(h4, latestClosedContext(candles.slice(0, 16), atH4Close, 'H4'));
    assert.equal(latestClosedContext(candles.filter((_, i) => i !== 2), atH4Close, 'H4'), undefined);
    assert.ok(latestClosedContext(candles, beforeH4Close, 'H1'));
  });

  it('Giữ lựa chọn từ train khi đổi validation và thực thi tổ hợp đa khung đã đạt', () => {
    const directory = createTempDir('oos-timeframes');
    const orchestrator = new QuantLabOrchestrator({ dataDir: directory,
      replayFilePath: path.join(directory, 'replay.json'), autoStart: false });
    const candles = buildDeterministicReplayDataset().candles;
    while (orchestrator.getState().replayCursorIndex < 30) orchestrator.stepNextReplayCandle();
    const state = orchestrator.getState();
    const seed = state.shadowOutcomes[0];
    assert.ok(seed);
    const baseline = state.policies[0];
    const synthetic = (id: string, entry: number, version: string, pnl: number) => ({
      ...seed, shadowId: id, cycleId: `CYCLE-${entry}`, regime: 'TRENDING' as const,
      strategyId: 'STRAT_TREND_FOLLOW' as const, strategyVersion: version,
      status: 'CLOSED_RECONCILED' as const, entryMarketTime: candles[entry].closeTime,
      closeMarketTime: candles[entry + 1].closeTime, netPnlUsd: pnl,
      grossPnlUsd: pnl + 2, totalCostUsd: 2, netPnlAt2xCostUsd: pnl - 2,
    });
    const run = (validationPnl: number, winningContext: 'H1' | 'H4') => {
      const samples = [1, 3, 25, 27].flatMap((entry) => {
        const pnl = entry < 20 ? 40 : validationPnl;
        return [
          synthetic(`base-${entry}`, entry, 'v1.2.0', 8),
          synthetic(`h1-${entry}`, entry, 'v1.2.0-H1-M15', winningContext === 'H1' ? pnl : 5),
          synthetic(`h4-${entry}`, entry, 'v1.2.0-H4-M15', winningContext === 'H4' ? pnl : 5),
        ];
      });
      return executeWalkForwardLearningRun({ runId: 'OOS', triggerCycleId: 'TEST',
        decisionMarketTime: candles[29].closeTime, triggerReasonVi: 'Kiểm tra ngoài mẫu',
        allShadowOutcomes: samples, reconciledPositions: [], activePolicy: baseline,
        baselinePolicy: baseline, allPolicies: [baseline] });
    };
    const passed = run(45, 'H1');
    const failed = run(-45, 'H1');
    assert.equal(passed.learningRun.decision, 'PROMOTE_NEW_POLICY');
    assert.equal(failed.newPolicyToActivate, undefined);
    assert.deepEqual(passed.learningRun.rankingsByRegime, failed.learningRun.rankingsByRegime);
    assert.equal(passed.learningRun.hypothesesTested[0].proposedVersion, 'v1.2.0-H1-M15');
    assert.equal(failed.learningRun.hypothesesTested[0].proposedVersion, 'v1.2.0-H1-M15');
    const history = candles.slice(0, 16);
    const current = history.at(-1)!;
    const regime = classifyMarketRegime('CTX', history);
    assert.equal(regime.regime, 'TRENDING');
    const candidates = evaluateMultiTimeframeCandidates(history, regime);
    for (const context of ['H1', 'H4'] as const) {
      const policy = run(45, context).newPolicyToActivate!;
      assert.ok(policy);
      const decision = selectStrategyForCycle('CTX', current, regime, policy, baseline, candidates);
      assert.equal(decision.action, 'SELECT_STRATEGY');
      assert.equal(decision.selectedCandidate?.contextTimeframe, context);
    }
  });

});

it('Chạy kiểm định giữa phiên dài và mở vị thế đa khung sau khi kích hoạt', () => {
  const directory = createTempDir('long-multiframe');
  try {
    const original = buildDeterministicReplayDataset();
    const start = Date.parse(original.candles[0].openTime);
    const interval = 15 * 60_000;
    let open = original.candles[0].open;
    // Repeat the synthetic pattern with continuous prices and timestamps.
    const candles = Array.from({ length: 216 }, (_, index) => {
      const source = original.candles[index % original.candles.length];
      const shift = open - source.open;
      const price = (value: number) => Number((value + shift).toFixed(2));
      const candle = {
        ...source,
        candleId: `LONG-${index + 1}`,
        openTime: new Date(start + index * interval).toISOString(),
        closeTime: new Date(start + (index + 1) * interval).toISOString(),
        open: price(source.open),
        high: price(source.high),
        low: price(source.low),
        close: price(source.close),
      };
      open = candle.close;
      return candle;
    });
    const replayFilePath = path.join(directory, 'replay.json');
    fs.writeFileSync(replayFilePath, JSON.stringify({
      metadata: { ...original.metadata, totalCandles: candles.length },
      candles,
    }));
    const orchestrator = new QuantLabOrchestrator({
      dataDir: path.join(directory, 'runtime'), replayFilePath, autoStart: false,
    });
    for (const _candle of candles) orchestrator.stepNextReplayCandle();

    const state = orchestrator.getState();
    assert.equal(state.replayCursorIndex, candles.length);
    const promotion = state.learningRuns.find((run) => run.decision === 'PROMOTE_NEW_POLICY');
    assert.ok(promotion);
    assert.ok(promotion.executedAtMarketTime < candles.at(-1)!.closeTime);
    assert.ok(state.closedPositions.some((position) =>
      position.strategyVersion.endsWith('-H1-M15') &&
      position.openedUnderPolicyId === promotion.resultingPolicyId &&
      position.entryMarketTime > promotion.executedAtMarketTime
    ));
    assert.ok(state.learningRuns.some((run) => run.decisionReasonVi.includes('giao dịch ngoài mẫu')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
