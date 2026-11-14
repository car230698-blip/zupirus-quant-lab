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
import { TickReplay } from '../src/quant/tickReplay.ts';
import { applyValidationCapacity, executeWalkForwardLearningRun } from '../src/quant/researchTeam.ts';
import { QuantLabOrchestrator } from '../src/quant/orchestrator.ts';
import { createQuantServer } from '../server.ts';
import { ExecutionMode, M15Candle, ShadowCandidateOutcome, SimulatedPosition } from '../src/quant/types.ts';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { computeSlOvershootP95Buffer } from '../src/quant/riskGate.ts';

const execFileAsync = promisify(execFile);
import {
  DEFAULT_BROKER_SCHEDULE,
  evaluateMarketSchedule,
  checkMandatoryCutoffClose,
} from '../src/quant/marketSchedule.ts';
import { runAllLearningBranchFixtures } from '../src/quant/fixtures.ts';
import { buildDualCostStressComparison } from '../src/quant/costStress.ts';

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
    const run = (validationPnl: number, winningContext: 'H1' | 'H4', minSamplesPerRegime?: number) => {
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
        baselinePolicy: baseline, allPolicies: [baseline], minSamplesPerRegime });
    };
    const passed = run(45, 'H1');
    const failed = run(-45, 'H1');
    assert.equal(passed.learningRun.decision, 'PROMOTE_NEW_POLICY');
    assert.equal(run(45, 'H1', 10).newPolicyToActivate, undefined);
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

it('Chạy kiểm định giữa phiên dài và giữ chính sách khi mẫu vượt giới hạn danh mục', () => {
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
    assert.ok(state.learningRuns.length > 5);
    assert.ok(state.learningRuns.some((run) => run.decisionReasonVi.includes('giao dịch ngoài mẫu')));
    assert.ok(state.learningRuns.every((run) => run.decision !== 'PROMOTE_NEW_POLICY'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it('Tick replay fills at Ask and preserves TP1 before a later Bid stop in the same bar', () => {
  const [signalBar, executionBar] = buildDeterministicReplayDataset().candles;
  const start = Date.parse(signalBar.closeTime);
  const directory = createTempDir('tick-order');
  try {
    const file = path.join(directory, 'ticks.bin');
    const records = [[start - 1, 99, 100], [start + 50, 100, 100.05],
      [start + 75, 102.1, 102.15], [start + 100, 98.5, 98.55]];
    const bytes = Buffer.alloc(records.length * 24);
    for (const [i, row] of records.entries()) {
      for (const [j, value] of row.entries()) bytes.writeDoubleLE(value, i * 24 + j * 8);
    }
    fs.writeFileSync(file, bytes);
    const replay = new TickReplay(file);
    const quote = replay.firstAfterClose(signalBar);
    assert.equal(quote?.time, start + 50);
    const position = openSimulatedPosition({
      executionMode: 'SIMULATION_ONLY', positionId: 'TICK', signalId: 'SIGNAL',
      cycleId: '1', candle: signalBar, regime: 'TRENDING',
      openedUnderPolicyId: BASELINE_POLICY_ID, volumeLots: 0.10, quote,
      candidate: {
        strategyId: 'STRAT_TREND_FOLLOW', strategyNameVi: 'Trend', version: 'test',
        family: 'TREND_FOLLOWING', eligibleToEnter: true, direction: 'BUY',
        entryPrice: 100, stopLoss: 99, takeProfit1: 102, takeProfit2: 104,
        expiryBars: 6, partialCloseRatio: 0.5, entryConditionSummaryVi: '', signalStrength: 1,
      },
    });
    assert.equal(position.fillEntryPrice, 100.05);
    const closed = stepOpenPositionOnCandle(position, '2', executionBar, undefined, replay.within(executionBar));
    assert.equal(closed.exitReason, 'SL_AFTER_PARTIAL_TP1');
    assert.deepEqual(closed.deals.map((deal) => deal.fillPrice), [100.05, 102, 98.5]);
    assert.equal(closed.netPnlUsd, 1.29); // Per-deal commissions and spreads round to cents.
    assert.equal(closed.remainingVolumeLots, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it('Daily drawdown resets at the UTC boundary and restores from a legacy equity curve', () => {
  const directory = createTempDir('daily-drawdown');
  try {
    const dataset = buildDeterministicReplayDataset();
    const options = { dataDir: directory, replayFilePath: path.join(directory, 'replay.json'), autoStart: false };
    const app = new QuantLabOrchestrator(options);
    const state = app.getState();
    const signalBar = dataset.candles[0];
    const midnight = Date.parse('2026-03-03T00:00:00Z');
    const bar = (time: number) => ({ ...signalBar, candleId: String(time),
      openTime: new Date(time - 900_000).toISOString(), closeTime: new Date(time).toISOString() });

    state.highWaterMarkEquityUsd = 10_000;
    const closedPosition = { netPnlUsd: -500 } as (typeof state.closedPositions)[number];
    state.closedPositions.push(closedPosition);
    app.processClosedCandle(bar(midnight - 900_000));
    assert.equal(state.dailyDrawdown?.currentPct, 5);
    assert.equal(state.currentDrawdownPct, 5);

    closedPosition.netPnlUsd = -595;
    app.processClosedCandle(bar(midnight));
    assert.deepEqual(state.dailyDrawdown, { marketDateUtc: '2026-03-03', peakEquityUsd: 9500, currentPct: 1 });
    assert.equal(state.currentDrawdownPct, 5.95);

    const saved = JSON.parse(fs.readFileSync(app.getStoragePaths().stateFilePath, 'utf8'));
    delete saved.dailyDrawdown;
    fs.writeFileSync(app.getStoragePaths().stateFilePath, JSON.stringify(saved));
    const recovered = new QuantLabOrchestrator(options).getState();
    assert.deepEqual(recovered.dailyDrawdown, state.dailyDrawdown);
    assert.equal(recovered.maxDrawdownPct, 5.95);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it('Kiểm định mô phỏng giới hạn vị thế và khối lượng trên toàn danh mục', () => {
  const outcome = (shadowId: string, entry: number, exit: number, riskSizedVolumeLots: number) =>
    ({ shadowId, entryMarketTime: new Date(entry).toISOString(),
      closeMarketTime: new Date(exit).toISOString(), riskSizedVolumeLots } as ShadowCandidateOutcome);

  const a = outcome('a', 1000, 4000, 0.3);
  const b = outcome('b', 1500, 2500, 0.3);
  const c = outcome('c', 2000, 3500, 0.05);
  const d = outcome('d', 2500, 4500, 0.2);
  assert.deepEqual(applyValidationCapacity([d, c, b, a],
    { maxOpenPositions: 2, maxTotalExposureLots: 0.5 }), [a, c]);
  assert.deepEqual(applyValidationCapacity([d, c, b, a],
    { maxOpenPositions: 2, maxTotalExposureLots: 1 }), [a, b, d]);
});

describe('Nghiệm thu mở rộng: Thu thập Tick MT5 bền vững, Quy tắc 15/15, P95 SL, Chi phí 2x + Độ trễ, 5 Nhánh Học & RBAC', () => {
  it('17. API nhận Tick bền vững (fsync), xử lý retry/đồng thời idempotent, phân biệt cùng ms với trùng lặp, tạo nến M15 và khôi phục sau restart', async () => {
    const tmpDir = createTempDir('live-ingest');
    try {
      const { app, orchestrator } = await createQuantServer({
        dataDir: path.join(tmpDir, 'runtime'),
        replayFilePath: path.join(tmpDir, 'replay.json'),
        autoStart: false,
        attachFrontend: false,
      });

      const server = app.listen(0);
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const baseUrl = `http://127.0.0.1:${port}`;
      const collectorHeaders = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer zupirus-collector-demo-token',
      };

      try {
        // Batch 1 inside M15 window 2026-03-02T14:00:00Z -> 14:15:00Z
        const t0 = Date.parse('2026-03-02T14:00:05.100Z');
        const batch1 = {
          batchId: 'BATCH-CONCURRENT-001',
          collectorId: 'WIN-MT5-TEST',
          rawSymbol: 'XAUUSDm',
          ticks: [
            // Two distinct valid quotes within the exact same millisecond (seqWithinMs 0 and 1)
            { rawSymbol: 'XAUUSDm', timeMs: t0, seqWithinMs: 0, bid: 3960.1, ask: 3960.3 },
            { rawSymbol: 'XAUUSDm', timeMs: t0, seqWithinMs: 1, bid: 3960.2, ask: 3960.4 },
            // Exact duplicate of the second quote in the same batch (must be skipped)
            { rawSymbol: 'XAUUSDm', timeMs: t0, seqWithinMs: 1, bid: 3960.2, ask: 3960.4 },
            // Out-of-order quote (earlier than t0)
            { rawSymbol: 'XAUUSD.a', timeMs: t0 - 500, seqWithinMs: 0, bid: 3959.9, ask: 3960.1 },
            // Quote after a >60s gap within the same M15 bar
            { rawSymbol: 'XAUUSDm', timeMs: t0 + 180_000, seqWithinMs: 0, bid: 3962.0, ask: 3962.25 },
          ],
        };

        // Send 4 concurrent identical requests to verify mutex serialization + idempotency
        const concurrentResponses = await Promise.all([
          fetch(`${baseUrl}/api/ingest/ticks`, {
            method: 'POST',
            headers: collectorHeaders,
            body: JSON.stringify(batch1),
          }),
          fetch(`${baseUrl}/api/ingest/ticks`, {
            method: 'POST',
            headers: collectorHeaders,
            body: JSON.stringify(batch1),
          }),
          fetch(`${baseUrl}/api/ingest/ticks`, {
            method: 'POST',
            headers: collectorHeaders,
            body: JSON.stringify(batch1),
          }),
          fetch(`${baseUrl}/api/ingest/ticks`, {
            method: 'POST',
            headers: collectorHeaders,
            body: JSON.stringify(batch1),
          }),
        ]);

        for (const res of concurrentResponses) {
          assert.equal(res.status, 200);
        }
        const acks = await Promise.all(concurrentResponses.map((r) => r.json()));
        const firstAck = acks.find((a) => !a.idempotentReplay);
        const dupAcks = acks.filter((a) => a.idempotentReplay);
        assert.ok(firstAck, 'Đúng 1 request đầu tiên xử lý lô mới');
        assert.equal(dupAcks.length, 3, '3 request đồng thời còn lại nhận kết quả idempotent');
        assert.equal(firstAck.acceptedTicks, 3);
        assert.equal(firstAck.sameMillisecondAccepted, 1);
        assert.equal(firstAck.duplicateTicksSkipped, 1);
        assert.equal(firstAck.outOfOrderRejected, 1);

        // Now send a tick in the next M15 bar (2026-03-02T14:15:01Z) to close the 14:00->14:15 candle
        const tNextBar = Date.parse('2026-03-02T14:15:01.000Z');
        const batch2Res = await fetch(`${baseUrl}/api/ingest/ticks`, {
          method: 'POST',
          headers: collectorHeaders,
          body: JSON.stringify({
            batchId: 'BATCH-CLOSE-BAR-002',
            collectorId: 'WIN-MT5-TEST',
            rawSymbol: 'XAUUSDm',
            ticks: [
              { rawSymbol: 'XAUUSDm', timeMs: tNextBar, seqWithinMs: 0, bid: 3961.5, ask: 3961.7 },
            ],
          }),
        });
        assert.equal(batch2Res.status, 200);
        const ack2 = await batch2Res.json();
        assert.equal(ack2.closedCandlesEmitted.length, 1);

        const stateBeforeRestart = orchestrator.getState();
        assert.equal(stateBeforeRestart.dataSourceTelemetry?.sourceMode, 'MT5_DEMO_LIVE');
        assert.equal(stateBeforeRestart.dataSourceTelemetry?.canonicalSymbol, 'XAUUSD');
        assert.equal(stateBeforeRestart.dataSourceTelemetry?.closedBarsBuiltFromTicks, 1);
        assert.equal(stateBeforeRestart.dataSourceTelemetry?.gapCount, 2);

        // Restart orchestrator on the same runtime directory and verify no duplicate candles or deals
        const restarted = new QuantLabOrchestrator({
          dataDir: path.join(tmpDir, 'runtime'),
          replayFilePath: path.join(tmpDir, 'replay.json'),
          autoStart: false,
        });
        const retryAfterRestart = await restarted.ingestTickBatch({
          batchId: 'BATCH-CLOSE-BAR-002',
          collectorId: 'WIN-MT5-TEST',
          rawSymbol: 'XAUUSDm',
          ticks: [
            { rawSymbol: 'XAUUSDm', timeMs: tNextBar, seqWithinMs: 0, bid: 3961.5, ask: 3961.7 },
          ],
        });
        assert.equal(retryAfterRestart.idempotentReplay, true);
        assert.equal(
          restarted.getState().cycleTraces.length,
          stateBeforeRestart.cycleTraces.length
        );
      } finally {
        server.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('18. Bộ thu Python SQLite (scripts/record-mt5-demo.py --self-test) lưu đệm WAL và đồng bộ thành công sang máy chủ Linux', async () => {
    const tmpDir = createTempDir('py-collector');
    try {
      const { app, orchestrator } = await createQuantServer({
        dataDir: path.join(tmpDir, 'runtime'),
        replayFilePath: path.join(tmpDir, 'replay.json'),
        autoStart: false,
        attachFrontend: false,
      });

      const server = app.listen(0);
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const baseUrl = `http://127.0.0.1:${port}`;
      const dbPath = path.join(tmpDir, 'mt5-spool.sqlite');

      try {
        const { stdout } = await execFileAsync(
          'python3',
          [
            path.resolve('scripts/record-mt5-demo.py'),
            '--self-test',
            '--db-path',
            dbPath,
            '--vps-url',
            baseUrl,
            '--token',
            'zupirus-collector-demo-token',
          ],
          { encoding: 'utf8' }
        );
        const report = JSON.parse(stdout.trim());
        assert.equal(report.status, 'ok');
        assert.equal(report.canonicalSymbol, 'XAUUSD');
        assert.equal(report.pendingAfterSync, 0);
        assert.equal(report.syncedToVps, 4);
        assert.equal(
          orchestrator.getState().dataSourceTelemetry?.totalValidTicksAccepted,
          4
        );
      } finally {
        server.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('19. Quy tắc 15/15 theo lịch broker (DST mùa hè/mùa đông, đóng sớm, chỉ đóng lệnh) và tự đóng ở báo giá hợp lệ đầu tiên khi lỡ giờ cắt', () => {
    // 1. Winter EST (UTC-5): Friday 2026-01-09 16:45 EST = 21:45 UTC
    const winterBeforeCutoff = evaluateMarketSchedule(
      '2026-01-09T21:40:00.000Z',
      DEFAULT_BROKER_SCHEDULE
    );
    assert.equal(winterBeforeCutoff.sessionState, 'OPEN');
    assert.equal(winterBeforeCutoff.isDstActive, false);

    const winterInCutoff = evaluateMarketSchedule(
      '2026-01-09T21:46:00.000Z',
      DEFAULT_BROKER_SCHEDULE
    );
    assert.equal(winterInCutoff.sessionState, 'CLOSE_ONLY_15_15');
    assert.equal(winterInCutoff.allowNewEntries, false);
    assert.equal(winterInCutoff.mustFlattenOpenPositions, true);

    // 2. Summer EDT (UTC-4): Friday 2026-07-10 16:45 EDT = 20:45 UTC
    const summerInCutoff = evaluateMarketSchedule(
      '2026-07-10T20:46:00.000Z',
      DEFAULT_BROKER_SCHEDULE
    );
    assert.equal(summerInCutoff.sessionState, 'CLOSE_ONLY_15_15');
    assert.equal(summerInCutoff.isDstActive, true);

    // 3. Early close override (e.g., 2026-11-27 closes at 13:00 EST -> cutoff at 12:45 EST = 17:45 UTC)
    const scheduleWithEarlyClose = {
      ...DEFAULT_BROKER_SCHEDULE,
      earlyCloseOverrides: [
        {
          localDate: '2026-11-27',
          closeLocalTime: '13:00',
          reasonVi: 'Đóng sớm ngày lễ Tạ ơn',
        },
      ],
    };
    const earlyCloseCutoff = evaluateMarketSchedule(
      '2026-11-27T17:50:00.000Z',
      scheduleWithEarlyClose
    );
    assert.equal(earlyCloseCutoff.sessionState, 'CLOSE_ONLY_15_15');

    // 4. Missed cutoff mandatory close on first valid quote after reopen
    // Position opened Friday 2026-01-09T20:00:00Z (before cutoff 21:45Z), no quotes arrived during 21:45-22:00Z,
    // first valid quote arrives Sunday/Monday reopen 2026-01-12T00:05:00Z
    const missedCutoffCheck = checkMandatoryCutoffClose({
      entryMarketTimeUtc: '2026-01-09T20:00:00.000Z',
      currentQuoteTimeUtc: '2026-01-12T00:05:00.000Z',
      schedule: DEFAULT_BROKER_SCHEDULE,
    });
    assert.equal(missedCutoffCheck.mustClose, true);
    assert.equal(missedCutoffCheck.missedScheduledCutoff, true);

    // Verify SimBroker closes position with MISSED_CUTOFF_FIRST_VALID_QUOTE on that first quote
    const candles = buildDeterministicReplayDataset().candles;
    const pos = openSimulatedPosition({
      executionMode: 'SIMULATION_ONLY',
      positionId: 'POS-MISSED-1515',
      signalId: 'SIG-1515',
      cycleId: 'CYC-1',
      candle: {
        ...candles[0],
        openTime: '2026-01-09T19:45:00.000Z',
        closeTime: '2026-01-09T20:00:00.000Z',
      },
      regime: 'TRENDING',
      openedUnderPolicyId: BASELINE_POLICY_ID,
      volumeLots: 0.1,
      candidate: {
        strategyId: 'STRAT_TREND_FOLLOW',
        strategyNameVi: 'Trend',
        version: 'v1.2.0',
        family: 'TREND_FOLLOWING',
        eligibleToEnter: true,
        direction: 'BUY',
        entryPrice: 3960,
        stopLoss: 3945,
        takeProfit1: 3985,
        takeProfit2: 4000,
        expiryBars: 20,
        partialCloseRatio: 0.5,
        entryConditionSummaryVi: '',
        signalStrength: 80,
      },
    });
    const reopenBar: M15Candle = {
      ...candles[1],
      openTime: '2026-01-12T00:00:00.000Z',
      closeTime: '2026-01-12T00:15:00.000Z',
      open: 3965,
      high: 3968,
      low: 3962,
      close: 3966,
    };
    const closedAfterMissedCutoff = stepOpenPositionOnCandle(
      pos,
      'CYC-REOPEN',
      reopenBar,
      undefined,
      [
        {
          time: Date.parse('2026-01-12T00:01:00.000Z'),
          bid: 3964.8,
          ask: 3965.0,
        },
      ],
      DEFAULT_BROKER_SCHEDULE
    );
    assert.equal(closedAfterMissedCutoff.status, 'CLOSED');
    assert.equal(
      closedAfterMissedCutoff.exitReason,
      'MISSED_CUTOFF_FIRST_VALID_QUOTE'
    );
    assert.equal(closedAfterMissedCutoff.remainingVolumeLots, 0);
  });

  it('20. Risk Gate áp dụng đệm xuyên SL theo P95 của tối đa 50 lệnh SL trước đó (0.10 USD/oz khi <10 mẫu) và giới hạn theo ngân sách sụt giảm còn lại', () => {
    // 1. Fewer than 10 SL samples -> fallback 0.10 USD/oz
    const fiveSlTrades: SimulatedPosition[] = Array.from({ length: 5 }, (_, i) => ({
      positionId: `SL-${i}`,
      exitReason: 'STOP_LOSS_HIT',
      slOvershootUsdPerOz: 0.45,
    } as SimulatedPosition));
    const fallbackSummary = computeSlOvershootP95Buffer(fiveSlTrades);
    assert.equal(fallbackSummary.usedFallbackDefault, true);
    assert.equal(fallbackSummary.effectiveBufferUsdPerOz, 0.1);

    // 2. 20 SL trades with overshoot values -> empirical P95
    const twentySlTrades: SimulatedPosition[] = Array.from({ length: 20 }, (_, i) => ({
      positionId: `SL20-${i}`,
      exitReason: 'STOP_LOSS_HIT',
      slOvershootUsdPerOz: Number(((i + 1) * 0.05).toFixed(2)), // 0.05 .. 1.00 USD/oz
    } as SimulatedPosition));
    const empiricalSummary = computeSlOvershootP95Buffer(twentySlTrades);
    assert.equal(empiricalSummary.usedFallbackDefault, false);
    assert.equal(empiricalSummary.sampleCount, 20);
    assert.ok(empiricalSummary.effectiveBufferUsdPerOz >= 0.95);

    // 3. Remaining drawdown budget cap reduces approved lot size when close to daily drawdown limit
    const candles = buildDeterministicReplayDataset().candles;
    const candidate = {
      strategyId: 'STRAT_TREND_FOLLOW' as const,
      strategyNameVi: 'Trend',
      version: 'v1.2.0',
      family: 'TREND_FOLLOWING' as const,
      eligibleToEnter: true,
      direction: 'BUY' as const,
      entryPrice: 3968.89,
      stopLoss: 3957.97,
      takeProfit1: 3980,
      takeProfit2: 3992,
      expiryBars: 6,
      partialCloseRatio: 0.5,
      entryConditionSummaryVi: '',
      signalStrength: 80,
    };
    const limits = cloneRiskLimits();
    // Normal drawdown (0%) -> 1.0% risk budget -> 0.08 lots
    const normalRisk = evaluateRiskGate({
      cycleId: 'R-NORM',
      candle: candles[0],
      signalId: 'SIG-NORM',
      candidate,
      openPositions: [],
      closedPositions: twentySlTrades,
      accountEquityUsd: 10000,
      currentDrawdownPct: 0,
      dailyDrawdownPct: 0,
      riskLimits: limits,
    });
    assert.equal(normalRisk.vetoed, false);
    assert.equal(normalRisk.effectiveRiskBudgetPct, 1);

    // Near daily drawdown limit (3.6% of 4.0% max daily DD -> only 0.4% budget left)
    const cappedRisk = evaluateRiskGate({
      cycleId: 'R-CAP',
      candle: candles[0],
      signalId: 'SIG-CAP',
      candidate,
      openPositions: [],
      closedPositions: twentySlTrades,
      accountEquityUsd: 10000,
      currentDrawdownPct: 3.6,
      dailyDrawdownPct: 3.6,
      riskLimits: limits,
    });
    assert.equal(cappedRisk.vetoed, false);
    assert.equal(cappedRisk.effectiveRiskBudgetPct, 0.4);
    assert.ok(cappedRisk.approvedLots < normalRisk.approvedLots);
  });

  it('21. Tách biệt rõ Báo cáo Hậu kiểm Chi phí 2× trên lệnh đã khớp và Chạy lại Mô phỏng Toàn phần với Chi phí 2× + Độ trễ', () => {
    const tmpDir = createTempDir('cost-stress');
    try {
      const orchestrator = new QuantLabOrchestrator({
        dataDir: path.join(tmpDir, 'runtime'),
        replayFilePath: path.join(tmpDir, 'replay.json'),
        autoStart: false,
      });
      while (!orchestrator.getState().isReplayComplete) {
        orchestrator.stepNextReplayCandle();
      }
      const comparison = orchestrator.getCostStressComparison({
        costMultiplier: 2,
        entryLatencyMs: 300,
        exitLatencyMs: 300,
        extraSlippagePts: 5,
      });

      assert.equal(
        comparison.postHoc2xAnalysis.reportType,
        'POST_HOC_2X_ON_EXECUTED_TRADES'
      );
      assert.equal(
        comparison.fullReSimulation2x.reportType,
        'FULL_PATH_RESIMULATION_UNDER_NEW_COST_MODEL'
      );
      assert.ok(comparison.postHoc2xAnalysis.tradesEvaluated > 0);
      assert.ok(
        comparison.postHoc2xAnalysis.costElevatedUsd >
          comparison.postHoc2xAnalysis.cost1xUsd
      );
      assert.ok(
        comparison.fullReSimulation2x.candlesProcessed > 0
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('22. Bộ Fixture có chủ đích chứng minh đầy đủ 5 nhánh quyết định của bộ học Walk-Forward', () => {
    const suite = runAllLearningBranchFixtures();
    assert.equal(suite.allBranchesPassed, true);
    assert.equal(suite.branches.length, 5);
    const decisions = suite.branches.map((r) => r.branchCode);
    assert.deepEqual(decisions, [
      'KEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES',
      'KEEP_CURRENT_POLICY_NO_OUTPERFORMANCE',
      'PROMOTE_NEW_POLICY',
      'ROLLBACK_TO_PREVIOUS_POLICY',
      'HALT_NEW_POSITIONS_DEGRADED',
    ]);
  });

  it('23. Phân quyền RBAC giữa ADMIN, VIEWER và COLLECTOR và kiểm tra phản hồi chậm không rò rỉ dữ liệu sai', async () => {
    const tmpDir = createTempDir('rbac-test');
    try {
      const { app } = await createQuantServer({
        dataDir: path.join(tmpDir, 'runtime'),
        replayFilePath: path.join(tmpDir, 'replay.json'),
        autoStart: false,
        attachFrontend: false,
        strictAuth: true,
      });

      const server = app.listen(0);
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // 1. Unauthenticated request when strictAuth=true -> 401
        const unauthRes = await fetch(`${baseUrl}/api/state`);
        assert.equal(unauthRes.status, 401);

        // 2. COLLECTOR role: allowed on /api/ingest/ticks and /api/ingest/status, forbidden (403) on /api/state and /api/control/step
        const collectorIngestRes = await fetch(`${baseUrl}/api/ingest/ticks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer zupirus-collector-demo-token',
          },
          body: JSON.stringify({
            batchId: 'RBAC-BATCH-1',
            collectorId: 'RBAC-COL',
            ticks: [
              {
                rawSymbol: 'XAUUSD',
                timeMs: Date.parse('2026-03-02T15:00:01Z'),
                seqWithinMs: 0,
                bid: 3960,
                ask: 3960.2,
              },
            ],
          }),
        });
        assert.equal(collectorIngestRes.status, 200);

        const collectorStateRes = await fetch(`${baseUrl}/api/state`, {
          headers: { Authorization: 'Bearer zupirus-collector-demo-token' },
        });
        assert.equal(collectorStateRes.status, 403);

        const collectorStepRes = await fetch(`${baseUrl}/api/control/step`, {
          method: 'POST',
          headers: { Authorization: 'Bearer zupirus-collector-demo-token' },
        });
        assert.equal(collectorStepRes.status, 403);

        // 3. VIEWER role: allowed on /api/state (including delayed load), forbidden (403) on /api/control/step and /api/ingest/ticks
        const viewerStateRes = await fetch(`${baseUrl}/api/state?delayMs=50`, {
          headers: { Authorization: 'Bearer zupirus-viewer-demo-token' },
        });
        assert.equal(viewerStateRes.status, 200);
        const viewerData = await viewerStateRes.json();
        assert.equal(viewerData.currentRole, 'VIEWER');
        assert.equal(viewerData.state.initialBalanceUsd, 10000);

        const viewerControlRes = await fetch(`${baseUrl}/api/control/step`, {
          method: 'POST',
          headers: { Authorization: 'Bearer zupirus-viewer-demo-token' },
        });
        assert.equal(viewerControlRes.status, 403);

        const viewerIngestRes = await fetch(`${baseUrl}/api/ingest/ticks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer zupirus-viewer-demo-token',
          },
          body: JSON.stringify({ batchId: 'V', collectorId: 'V', ticks: [] }),
        });
        assert.equal(viewerIngestRes.status, 403);

        // 4. ADMIN role: allowed on both /api/state and /api/control/step
        const adminStepRes = await fetch(`${baseUrl}/api/control/step`, {
          method: 'POST',
          headers: { Authorization: 'Bearer zupirus-admin-demo-token' },
        });
        assert.equal(adminStepRes.status, 200);
      } finally {
        server.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

