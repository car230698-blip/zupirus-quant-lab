import {
  ensureReplayDatasetFile,
  validateIncomingCandle,
} from './dataReplay.ts';
import { classifyMarketRegime } from './regimeDetector.ts';
import {
  evaluateMultiTimeframeCandidates,
  selectStrategyForCycle,
} from './strategies.ts';
import {
  evaluateRiskGate,
  guardLearnerCannotModifyRiskLimits,
} from './riskGate.ts';
import {
  openSimulatedPosition,
  stepOpenPositionOnCandle,
} from './simBroker.ts';
import { reconcileClosedPosition } from './reconciliation.ts';
import {
  createShadowOutcomeFromCandidate,
  executeWalkForwardLearningRun,
  LEARNER_VERSION,
} from './researchTeam.ts';
import { DurableQuantStorage } from './storage.ts';
import {
  CycleTraceRecord,
  LearningRunRecord,
  M15Candle,
  PolicyVersionRecord,
  QuantSystemState,
  ReconciliationRecord,
  ReplayDataset,
  ShadowCandidateOutcome,
  SimulatedPosition,
  SystemJournalEntry,
} from './types.ts';

export interface OrchestratorOptions {
  dataDir: string;
  replayFilePath: string;
  replayIntervalMs?: number;
  autoStart?: boolean;
}

export class QuantLabOrchestrator {
  private readonly storage: DurableQuantStorage;
  private readonly dataset: ReplayDataset;
  private state: QuantSystemState;
  private timer: NodeJS.Timeout | null = null;
  private lastHeartbeatSystemMs: number = Date.now();

  constructor(options: OrchestratorOptions) {
    this.dataset = ensureReplayDatasetFile(options.replayFilePath);
    const intervalMs = options.replayIntervalMs ?? 800;
    this.storage = new DurableQuantStorage({ dataDir: options.dataDir });

    const { state } = this.storage.loadOrInitializeState(
      this.dataset.candles.length,
      intervalMs
    );
    this.state = state;
    this.restoreOpenShadows();
    this.state.replayIntervalMs = intervalMs;
    const activePolicy = this.state.policies.find((policy) => policy.policyId === this.state.activePolicyId);
    if (activePolicy && !activePolicy.isBaseline && activePolicy.learnerVersion !== LEARNER_VERSION) {
      const baseline = this.state.policies.find((policy) => policy.policyId === this.state.baselinePolicyId)!;
      activePolicy.status = 'ROLLED_BACK';
      activePolicy.rollbackReasonVi = 'Phiên bản cũ cần kiểm định lại trên tập ngoài mẫu.';
      baseline.status = 'ACTIVE';
      this.state.activePolicyId = baseline.policyId;
      this.storage.saveState(this.state);
    }

    if (options.autoStart !== false && !this.state.isReplayComplete) {
      this.startAutoLoop();
    }
  }

  private closeShadow(outcome: ShadowCandidateOutcome, position: SimulatedPosition, candleIndex: number) {
    Object.assign(outcome, {
      status: 'CLOSED_RECONCILED',
      closeMarketTime: position.closeMarketTime,
      closeCandleIndex: candleIndex,
      avgExitPrice: position.avgExitFillPrice,
      grossPnlUsd: position.grossPnlUsd,
      totalCostUsd: position.totalCostUsd,
      netPnlUsd: position.netPnlUsd,
      netPnlAt2xCostUsd: position.netPnlAt2xCostUsd,
      exitReason: position.exitReason,
      intraBarConflictTriggered: position.exitReason === 'INTRA_BAR_SL_TP_CONFLICT_SL_FIRST',
    });
  }

  private restoreOpenShadows() {
    if (this.state.openShadowPositions) return;
    const positions: Record<string, SimulatedPosition> = {};
    const traces = this.state.cycleTraces;
    for (const outcome of this.state.shadowOutcomes) {
      if (outcome.status !== 'OPEN') continue;
      const trace = traces.find((item) => item.cycleId === outcome.cycleId);
      const candidate = trace?.coordinatorDecision?.candidatesConsidered.find(
        (item) => item.strategyId === outcome.strategyId && item.version === outcome.strategyVersion
      );
      if (!trace || !candidate) {
        throw new Error(`Thiếu dữ liệu để khôi phục mẫu mô phỏng ${outcome.shadowId}`);
      }
      let { shadowPosition } = createShadowOutcomeFromCandidate({
        cycleId: trace.cycleId,
        candle: trace.candle,
        candleIndex: trace.candleIndex,
        regime: outcome.regime,
        candidate,
        wasSelectedByActivePolicy: outcome.wasSelectedByActivePolicy,
        wasSelectedByBaselinePolicy: outcome.wasSelectedByBaselinePolicy,
        livePositionId: outcome.wasSelectedByActivePolicy ? trace.openedPositionId : undefined,
      });
      for (const later of traces) {
        if (later.candleIndex <= trace.candleIndex || !later.validation.valid) continue;
        shadowPosition = stepOpenPositionOnCandle(shadowPosition, later.cycleId, later.candle,
          later.coordinatorDecision?.systemTime);
        if (shadowPosition.status === 'CLOSED') {
          this.closeShadow(outcome, shadowPosition, later.candleIndex);
          break;
        }
      }
      if (shadowPosition.status !== 'CLOSED') positions[outcome.shadowId] = shadowPosition;
    }
    this.state.openShadowPositions = positions;
    this.storage.saveState(this.state);
  }

  public getDatasetMetadata() {
    return this.dataset.metadata;
  }

  public getStoragePaths() {
    return this.storage.getPaths();
  }

  public getState(): QuantSystemState {
    // Update real-time active flags based on actual recent work or active loop
    const nowMs = Date.now();
    const isRecentlyActive =
      this.state.isLoopRunning &&
      !this.state.isReplayComplete &&
      nowMs - this.lastHeartbeatSystemMs < Math.max(5000, this.state.replayIntervalMs * 3);

    this.state.teamExecutionStatus.isActive = isRecentlyActive;
    this.state.teamResearchStatus.isActive =
      isRecentlyActive && this.state.replayCursorIndex >= 15;

    return this.state;
  }

  public startAutoLoop(): void {
    if (this.timer) return;
    if (this.state.isReplayComplete) return;

    this.state.isLoopRunning = true;
    this.lastHeartbeatSystemMs = Date.now();
    this.state.teamExecutionStatus.isActive = true;
    this.state.teamExecutionStatus.waitStateReasonVi = null;

    this.timer = setInterval(() => {
      try {
        if (this.state.replayCursorIndex >= this.dataset.candles.length) {
          this.state.isReplayComplete = true;
          this.state.isLoopRunning = false;
          this.state.teamExecutionStatus.isActive = false;
          this.state.teamExecutionStatus.currentTaskVi =
            'Đã hoàn tất toàn bộ chuỗi nến phát lại nghiệm thu';
          this.state.teamExecutionStatus.waitStateReasonVi =
            `Bộ phát lại đã xử lý hết ${this.dataset.candles.length} nến M15 trong phiên nghiệm thu.`;
          this.state.teamResearchStatus.isActive = false;
          this.state.teamResearchStatus.currentTaskVi =
            'Đã hoàn tất kiểm định Walk-Forward cuối kỳ';
          this.state.teamResearchStatus.waitStateReasonVi =
            'Đang chờ dữ liệu phát lại mới hoặc lệnh đặt lại phiên mô phỏng.';
          this.storage.saveState(this.state);
          this.stopAutoLoop();
          return;
        }
        this.stepNextReplayCandle();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.recordTaskError('TEAM_1_EXECUTION', msg);
      }
    }, this.state.replayIntervalMs);
  }

  public stopAutoLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state.isLoopRunning = false;
    this.state.teamExecutionStatus.isActive = false;
    if (!this.state.isReplayComplete) {
      this.state.teamExecutionStatus.waitStateReasonVi =
        'Vòng lặp phát lại đang tạm dừng.';
    }
    this.storage.saveState(this.state);
  }

  public resetSimulation(autoStart: boolean = true): QuantSystemState {
    this.stopAutoLoop();
    this.state = this.storage.resetStorage(
      this.dataset.candles.length,
      this.state.replayIntervalMs
    );
    if (autoStart) {
      this.startAutoLoop();
    }
    return this.getState();
  }

  public recordTaskError(
    team: 'TEAM_1_EXECUTION' | 'TEAM_2_RESEARCH',
    errorMsg: string
  ): void {
    const now = new Date().toISOString();
    const marketTime =
      this.state.lastProcessedMarketTime || '2026-03-02T08:00:00.000Z';
    const entry: SystemJournalEntry = {
      entryId: `JRN-ERR-${Date.now()}`,
      timestampSystem: now,
      timestampMarket: marketTime,
      cycleId: `CYCLE-ERR-${this.state.replayCursorIndex}`,
      team,
      level: 'ERROR',
      eventCode: 'TASK_ERROR_RECOVERED',
      messageVi: `Lỗi tác vụ (${team}): ${errorMsg}. Đã cô lập lỗi và khôi phục trạng thái an toàn.`,
    };
    this.state.journal.push(entry);
    this.storage.appendJournalToDisk(entry);

    if (team === 'TEAM_1_EXECUTION') {
      this.state.teamExecutionStatus.lastErrorVi = errorMsg;
      this.state.teamExecutionStatus.recoveryStatusVi = `Đã tự khôi phục an toàn lúc ${now}`;
    } else {
      this.state.teamResearchStatus.lastErrorVi = errorMsg;
      this.state.teamResearchStatus.recoveryStatusVi = `Đã tự khôi phục an toàn lúc ${now}`;
    }
    this.storage.saveState(this.state);
  }

  /**
   * Processes the next closed M15 candle from the deterministic replay dataset.
   */
  public stepNextReplayCandle(): CycleTraceRecord | null {
    if (this.state.replayCursorIndex >= this.dataset.candles.length) {
      this.state.isReplayComplete = true;
      this.stopAutoLoop();
      return null;
    }
    const candle = this.dataset.candles[this.state.replayCursorIndex];
    return this.processClosedCandle(candle);
  }

  /**
   * Core idempotent closed-candle pipeline:
   * Closed Candle -> Validation -> Step Open Positions & Reconcile -> Regime Classification
   * -> Strategy Evaluation & Coordinator Selection -> Risk Gate -> Sim Broker Execution
   * -> Parallel Shadow Sim -> Walk-Forward Learning & Policy Auto-Update.
   */
  public processClosedCandle(
    candle: M15Candle,
    systemTime: string = new Date().toISOString()
  ): CycleTraceRecord {
    this.lastHeartbeatSystemMs = Date.now();

    // 0. Idempotency check: if this candleId was already processed, return its existing trace!
    const existingTrace = this.state.cycleTraces.find(
      (t) => t.candle.candleId === candle.candleId
    );
    if (existingTrace) {
      return existingTrace;
    }

    const processedSet = new Set(this.state.processedCandleIds);
    const validation = validateIncomingCandle(
      candle,
      this.state.lastProcessedMarketTime,
      processedSet,
      systemTime
    );

    const nextIndex = this.state.replayCursorIndex + 1;
    const cycleId = `CYCLE-${String(nextIndex).padStart(4, '0')}`;

    // If invalid or unclosed or out-of-order, record validation failure without mutating positions or PnL
    if (!validation.valid) {
      const invalidTrace: CycleTraceRecord = {
        cycleId,
        candleIndex: nextIndex,
        candle,
        validation,
        closedPositionIds: [],
        reconciliationIds: [],
        shadowOutcomeIds: [],
        equityAfterCycleUsd: this.state.equityUsd,
        balanceAfterCycleUsd: this.state.balanceUsd,
      };
      this.appendJournal({
        timestampSystem: systemTime,
        timestampMarket: candle.closeTime,
        cycleId,
        team: 'TEAM_1_EXECUTION',
        level: 'WARN',
        eventCode: validation.errorCode || 'INVALID_CANDLE',
        messageVi: validation.reasonVi,
      });
      this.state.teamExecutionStatus.lastErrorVi = validation.reasonVi;
      this.state.teamExecutionStatus.recoveryStatusVi =
        'Đã từ chối nến không hợp lệ và giữ nguyên trạng thái sổ cái.';
      this.storage.saveState(this.state);
      return invalidTrace;
    }

    // Advance cursor & register processed candleId
    this.state.replayCursorIndex = nextIndex;
    this.state.processedCandleIds.push(candle.candleId);
    this.state.lastProcessedMarketTime = candle.closeTime;
    this.state.lastUpdatedSystemTime = systemTime;

    // Collect causal history up to and including this closed candle (strictly zero look-ahead)
    const candlesUpToDecision = this.dataset.candles
      .slice(0, this.state.replayCursorIndex)
      .filter((c) => this.state.processedCandleIds.includes(c.candleId));
    if (
      candlesUpToDecision.length === 0 ||
      candlesUpToDecision[candlesUpToDecision.length - 1].candleId !==
        candle.candleId
    ) {
      candlesUpToDecision.push(candle);
    }

    const closedPositionIds: string[] = [];
    const reconciliationIds: string[] = [];

    // ========================================================================
    // STEP 1: Step existing open simulated positions on this newly closed candle
    // ========================================================================
    const remainingOpenPositions: SimulatedPosition[] = [];
    for (const openPos of this.state.openPositions) {
      const prevClosedLots = openPos.closedVolumeLots;
      const stepped = stepOpenPositionOnCandle(
        openPos,
        cycleId,
        candle,
        systemTime
      );

      // If partial close TP1 just occurred on this bar, realize partial PnL into balance
      if (stepped.closedVolumeLots > prevClosedLots && stepped.status === 'PARTIAL_CLOSED') {
        const latestDeal = stepped.deals[stepped.deals.length - 1];
        const execKey = `${stepped.positionId}-${latestDeal.dealId}`;
        if (!this.state.processedExecutionIds.includes(execKey)) {
          this.state.processedExecutionIds.push(execKey);
          this.state.balanceUsd = Number(
            (this.state.balanceUsd + latestDeal.netPnlUsd).toFixed(2)
          );
          this.appendJournal({
            timestampSystem: systemTime,
            timestampMarket: candle.closeTime,
            cycleId,
            team: 'TEAM_1_EXECUTION',
            level: 'INFO',
            eventCode: 'POSITION_PARTIAL_CLOSE',
            messageVi: `Vị thế ${stepped.positionId} đóng một phần (50% = ${latestDeal.volumeLots} lot) tại TP1 (${latestDeal.fillPrice.toFixed(
              2
            )}). Lãi ròng phần đóng: +${latestDeal.netPnlUsd.toFixed(2)} USD.`,
          });
        }
      }

      if (stepped.status === 'CLOSED') {
        const { reconciledPosition, record } = reconcileClosedPosition(
          stepped,
          systemTime
        );
        const finalDeal =
          reconciledPosition.deals[reconciledPosition.deals.length - 1];
        const execKey = `${reconciledPosition.positionId}-RECONCILED`;

        if (
          record.status === 'RECONCILED_OK' &&
          !this.state.processedExecutionIds.includes(execKey)
        ) {
          this.state.processedExecutionIds.push(execKey);
          // Add the final close deal's net PnL (and entry cost if not yet settled)
          // Note: balanceUsd is cleanly tracked as initialBalanceUsd + sum of netPnlUsd of reconciled closed positions + realized partial deals
          this.state.closedPositions.push(reconciledPosition);
          this.state.reconciliations.push(record);
          closedPositionIds.push(reconciledPosition.positionId);
          reconciliationIds.push(record.reconciliationId);

          this.appendJournal({
            timestampSystem: systemTime,
            timestampMarket: candle.closeTime,
            cycleId,
            team: 'TEAM_1_EXECUTION',
            level: 'INFO',
            eventCode: 'POSITION_CLOSED_RECONCILED',
            messageVi: `${record.summaryVi} (Lý do thoát: ${reconciledPosition.exitReasonVi})`,
          });
        } else if (record.status !== 'RECONCILED_OK') {
          remainingOpenPositions.push(reconciledPosition);
        }
      } else {
        remainingOpenPositions.push(stepped);
      }
    }
    this.state.openPositions = remainingOpenPositions;

    // Step active parallel shadow positions on this closed candle
    const openShadows = this.state.openShadowPositions!;
    for (const outcome of this.state.shadowOutcomes) {
      const position = openShadows[outcome.shadowId];
      if (!position) continue;
      const stepped = stepOpenPositionOnCandle(position, cycleId, candle, systemTime);
      if (stepped.status === 'CLOSED') {
        this.closeShadow(outcome, stepped, nextIndex);
        delete openShadows[outcome.shadowId];
      } else {
        openShadows[outcome.shadowId] = stepped;
      }
    }

    // Recompute exact account Balance, Equity, and Drawdown
    this.recalculateAccountMetrics();

    // ========================================================================
    // STEP 2: Classify Market Regime using strictly causal closed candles
    // ========================================================================
    const regimeClassification = classifyMarketRegime(
      cycleId,
      candlesUpToDecision,
      validation.hasTimeGap && validation.gapMinutes > 60,
      undefined,
      systemTime
    );

    // ========================================================================
    // STEP 3: Evaluate all 3 distinct strategies & Coordinator Selection
    // ========================================================================
    const candidates = evaluateMultiTimeframeCandidates(
      candlesUpToDecision,
      regimeClassification
    );

    const activePolicy =
      this.state.policies.find((p) => p.policyId === this.state.activePolicyId) ||
      this.state.policies[0];
    const baselinePolicy =
      this.state.policies.find((p) => p.policyId === this.state.baselinePolicyId) ||
      this.state.policies[0];

    const coordinatorDecision = selectStrategyForCycle(
      cycleId,
      candle,
      regimeClassification,
      activePolicy,
      baselinePolicy,
      candidates,
      systemTime
    );

    // ========================================================================
    // STEP 4: Risk Gate Check & Simulated Broker Execution
    // ========================================================================
    let riskDecision = undefined;
    let signalId: string | undefined = undefined;
    let openedPositionId: string | undefined = undefined;

    if (
      coordinatorDecision.action === 'SELECT_STRATEGY' &&
      coordinatorDecision.selectedCandidate
    ) {
      const selected = coordinatorDecision.selectedCandidate;
      signalId = `SIG-${cycleId}-${selected.strategyId}-${selected.version}`;

      if (!this.state.processedSignalIds.includes(signalId)) {
        riskDecision = evaluateRiskGate({
          cycleId,
          candle,
          signalId,
          candidate: selected,
          openPositions: this.state.openPositions,
          currentDrawdownPct: this.state.currentDrawdownPct,
          dailyDrawdownPct: this.state.currentDrawdownPct,
          riskLimits: this.state.riskLimits,
          requestedLots: 0.5,
          accountEquityUsd: this.state.equityUsd,
          systemTime,
        });

        this.state.processedSignalIds.push(signalId);

        if (riskDecision.approved && !riskDecision.vetoed) {
          const posNumber =
            this.state.closedPositions.length +
            this.state.openPositions.length +
            1;
          const positionId = `POS-${String(posNumber).padStart(4, '0')}`;
          const newPosition = openSimulatedPosition({
            executionMode: this.state.executionMode,
            positionId,
            signalId,
            cycleId,
            candle,
            regime: regimeClassification.regime,
            openedUnderPolicyId: activePolicy.policyId,
            candidate: selected,
            volumeLots: riskDecision.approvedLots,
            systemTime,
          });

          this.state.openPositions.push(newPosition);
          openedPositionId = positionId;
          this.recalculateAccountMetrics();

          this.appendJournal({
            timestampSystem: systemTime,
            timestampMarket: candle.closeTime,
            cycleId,
            team: 'TEAM_1_EXECUTION',
            level: 'INFO',
            eventCode: 'ORDER_FILLED_SIM',
            messageVi: `Mở vị thế ${positionId} (${selected.strategyId}@${selected.version}, ${newPosition.direction} ${newPosition.filledVolumeLots} lot) tại ${newPosition.fillEntryPrice.toFixed(
              2
            )} USD dưới chính sách ${activePolicy.policyId}.`,
          });
        } else {
          this.appendJournal({
            timestampSystem: systemTime,
            timestampMarket: candle.closeTime,
            cycleId,
            team: 'TEAM_1_EXECUTION',
            level: 'WARN',
            eventCode: riskDecision.vetoCode || 'RISK_VETO',
            messageVi: riskDecision.reasonVi,
          });
        }
      }
    }

    // ========================================================================
    // STEP 5: Spawn Parallel Shadow Candidate Simulations for Research Team
    // Even if Coordinator stood aside or picked another candidate, all eligible
    // candidates on this opportunity are tracked in parallel for comparison!
    // ========================================================================
    const shadowOutcomeIds: string[] = [];
    if (regimeClassification.allowTrading && candle.spreadPts <= this.state.riskLimits.maxSpreadPtsAllowed) {
      const baselineTarget = baselinePolicy.mapping[regimeClassification.regime];
      for (const cand of candidates) {
        if (cand.eligibleToEnter) {
          const wasActive =
            coordinatorDecision.action === 'SELECT_STRATEGY' &&
            coordinatorDecision.selectedCandidate?.strategyId === cand.strategyId &&
            coordinatorDecision.selectedCandidate?.version === cand.version &&
            Boolean(openedPositionId);

          const wasBaseline =
            baselineTarget !== 'STAND_ASIDE' &&
            baselineTarget.strategyId === cand.strategyId &&
            baselineTarget.version === cand.version;

          const { outcome, shadowPosition } = createShadowOutcomeFromCandidate({
            cycleId,
            candle,
            candleIndex: nextIndex,
            regime: regimeClassification.regime,
            candidate: cand,
            wasSelectedByActivePolicy: wasActive,
            wasSelectedByBaselinePolicy: wasBaseline,
            livePositionId: wasActive ? openedPositionId : undefined,
          });

          shadowOutcomeIds.push(outcome.shadowId);
          this.state.shadowOutcomes.push(outcome);
          openShadows[outcome.shadowId] = shadowPosition;
        }
      }
    }

    // Update Team 1 status
    this.state.teamExecutionStatus.isActive = true;
    this.state.teamExecutionStatus.processedCount = this.state.replayCursorIndex;
    this.state.teamExecutionStatus.lastCompletedMarketTime = candle.closeTime;
    this.state.teamExecutionStatus.lastCompletedSystemTime = systemTime;
    this.state.teamExecutionStatus.currentTaskVi = `Xử lý nến ${candle.candleId} (${regimeClassification.regimeLabelVi})`;
    this.state.teamExecutionStatus.lastCompletedTaskVi = openedPositionId
      ? `Mở vị thế ${openedPositionId} (${coordinatorDecision.selectedStrategyId}@${coordinatorDecision.selectedStrategyVersion})`
      : riskDecision?.vetoed
      ? `Chốt rủi ro phủ quyết tín hiệu (${riskDecision.vetoCode})`
      : `Đứng ngoài (${regimeClassification.regimeLabelVi})`;
    this.state.teamExecutionStatus.waitStateReasonVi = null;

    // ========================================================================
    // STEP 6: Team 2 (Research & Validation) Automatic Trigger Check
    // Runs on schedule / sufficient new completed outcomes:
    // - Cycle 18: Early check demonstrating insufficient sample handling
    // ========================================================================
    let learningRunId: string | undefined = undefined;
    let policyChangedTo: string | undefined = undefined;

    const scheduledLearningCycles = [18, 34, 48, 64];
    const recurringLearningCycle = nextIndex > 64 && (nextIndex - 64) % 16 === 0;
    if (scheduledLearningCycles.includes(nextIndex) || recurringLearningCycle ||
        nextIndex === this.dataset.candles.length) {
      const lrResult = this.runResearchAndValidationCycle(
        cycleId,
        candle.closeTime,
        `Đạt mốc lịch trình kiểm định Walk-Forward tự động tại chu kỳ ${cycleId} (Nến ${nextIndex}/${this.dataset.candles.length})`,
        systemTime, undefined, undefined, false
      );
      learningRunId = lrResult.learningRun.runId;
      if (lrResult.learningRun.resultingPolicyId !== lrResult.learningRun.previousPolicyId) {
        policyChangedTo = lrResult.learningRun.resultingPolicyId;
      }
    }

    // Record equity curve point
    this.state.equityCurve.push({
      cycleId,
      candleId: candle.candleId,
      marketTime: candle.closeTime,
      systemTime,
      balanceUsd: this.state.balanceUsd,
      equityUsd: this.state.equityUsd,
      drawdownPct: this.state.currentDrawdownPct,
      regime: regimeClassification.regime,
      activePolicyId: this.state.activePolicyId,
    });

    const trace: CycleTraceRecord = {
      cycleId,
      candleIndex: nextIndex,
      candle,
      validation,
      regimeClassification,
      coordinatorDecision,
      riskDecision,
      signalId,
      openedPositionId,
      closedPositionIds,
      reconciliationIds,
      shadowOutcomeIds,
      learningRunId,
      policyChangedTo,
      equityAfterCycleUsd: this.state.equityUsd,
      balanceAfterCycleUsd: this.state.balanceUsd,
    };

    this.state.cycleTraces.push(trace);
    this.storage.saveState(this.state);
    return trace;
  }

  /**
   * Executes a Research & Validation Walk-Forward cycle and updates policy state if criteria are met.
   * Ensures risk limits remain untouched by the learner.
   */
  public runResearchAndValidationCycle(
    triggerCycleId: string,
    decisionMarketTime: string,
    triggerReasonVi: string,
    systemTime: string = new Date().toISOString(),
    customMinSamples?: number,
    customDegradationThresholdUsd?: number,
    persistState = true
  ) {
    const riskLimitsBefore = structuredClone(this.state.riskLimits);
    const runNum = this.state.learningRuns.length + 1;
    const runId = `LR-${String(runNum).padStart(4, '0')}`;

    const activePolicy =
      this.state.policies.find((p) => p.policyId === this.state.activePolicyId) ||
      this.state.policies[0];
    const baselinePolicy =
      this.state.policies.find((p) => p.policyId === this.state.baselinePolicyId) ||
      this.state.policies[0];

    const result = executeWalkForwardLearningRun({
      runId,
      triggerCycleId,
      decisionMarketTime,
      systemTime,
      triggerReasonVi,
      allShadowOutcomes: this.state.shadowOutcomes,
      reconciledPositions: this.state.closedPositions,
      activePolicy,
      baselinePolicy,
      allPolicies: this.state.policies,
      minSamplesPerRegime: customMinSamples,
      degradationLossThresholdUsd: customDegradationThresholdUsd,
    });

    // Enforce hard invariant: Learner cannot modify core risk limits
    guardLearnerCannotModifyRiskLimits(riskLimitsBefore, this.state.riskLimits);

    if (result.newPolicyToActivate) {
      for (const p of this.state.policies) {
        if (p.status === 'ACTIVE') {
          p.status = 'SUPERSEDED';
        }
      }
      this.state.policies.push(result.newPolicyToActivate);
      this.state.activePolicyId = result.newPolicyToActivate.policyId;

      this.appendJournal({
        timestampSystem: systemTime,
        timestampMarket: decisionMarketTime,
        cycleId: triggerCycleId,
        team: 'TEAM_2_RESEARCH',
        level: 'INFO',
        eventCode: 'POLICY_PROMOTED_SIM',
        messageVi: result.learningRun.decisionReasonVi,
      });
    } else if (result.rolledBackToPolicy) {
      for (const p of this.state.policies) {
        if (p.policyId === activePolicy.policyId) {
          p.status = 'ROLLED_BACK';
          p.rollbackReasonVi = result.learningRun.decisionReasonVi;
        } else if (p.policyId === result.rolledBackToPolicy.policyId) {
          p.status = 'ACTIVE';
        }
      }
      this.state.activePolicyId = result.rolledBackToPolicy.policyId;

      this.appendJournal({
        timestampSystem: systemTime,
        timestampMarket: decisionMarketTime,
        cycleId: triggerCycleId,
        team: 'TEAM_2_RESEARCH',
        level: 'WARN',
        eventCode: 'POLICY_ROLLBACK_EXECUTED',
        messageVi: result.learningRun.decisionReasonVi,
      });
    } else if (result.haltNewPositions) {
      for (const p of this.state.policies) {
        if (p.policyId === activePolicy.policyId) {
          p.status = 'HALTED';
          p.rollbackReasonVi = result.learningRun.decisionReasonVi;
        }
      }
      this.state.riskLimits.haltNewPositionsByLearner = true;

      this.appendJournal({
        timestampSystem: systemTime,
        timestampMarket: decisionMarketTime,
        cycleId: triggerCycleId,
        team: 'TEAM_2_RESEARCH',
        level: 'ERROR',
        eventCode: 'POLICY_HALTED_DEGRADED',
        messageVi: result.learningRun.decisionReasonVi,
      });
    } else {
      this.appendJournal({
        timestampSystem: systemTime,
        timestampMarket: decisionMarketTime,
        cycleId: triggerCycleId,
        team: 'TEAM_2_RESEARCH',
        level: 'INFO',
        eventCode: result.learningRun.decision,
        messageVi: result.learningRun.decisionReasonVi,
      });
    }

    this.state.learningRuns.push(result.learningRun);

    // Update Team 2 status
    this.state.teamResearchStatus.isActive = true;
    this.state.teamResearchStatus.processedCount = this.state.learningRuns.length;
    this.state.teamResearchStatus.lastCompletedMarketTime = decisionMarketTime;
    this.state.teamResearchStatus.lastCompletedSystemTime = systemTime;
    this.state.teamResearchStatus.currentTaskVi = `Hoàn tất kỳ kiểm định ${runId} (${result.learningRun.totalCompletedSamplesUsed} mẫu hợp lệ, loại ${result.learningRun.totalExcludedSamples} mẫu chồng lấn/chưa đóng)`;
    this.state.teamResearchStatus.lastCompletedTaskVi =
      result.learningRun.decisionReasonVi;
    this.state.teamResearchStatus.waitStateReasonVi =
      result.learningRun.decision === 'KEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES'
        ? 'Đang tích lũy thêm giao dịch hoàn tất và đối soát để đủ ngưỡng mẫu tối thiểu'
        : null;

    if (persistState) this.storage.saveState(this.state);
    return result;
  }

  private recalculateAccountMetrics(): void {
    // Realized net PnL from closed reconciled positions + realized partial deals on currently open positions
    const closedNetPnl = this.state.closedPositions.reduce(
      (sum, p) => sum + p.netPnlUsd,
      0
    );
    const openRealizedNetPnl = this.state.openPositions.reduce((sum, p) => {
      const dealsPnl = p.deals.reduce((dSum, d) => dSum + d.netPnlUsd, 0);
      return sum + dealsPnl;
    }, 0);
    const openUnrealizedPnl = this.state.openPositions.reduce(
      (sum, p) => sum + p.unrealizedPnlUsd,
      0
    );

    this.state.balanceUsd = Number(
      (this.state.initialBalanceUsd + closedNetPnl + openRealizedNetPnl).toFixed(2)
    );
    this.state.equityUsd = Number(
      (this.state.balanceUsd + openUnrealizedPnl).toFixed(2)
    );

    if (this.state.equityUsd > this.state.highWaterMarkEquityUsd) {
      this.state.highWaterMarkEquityUsd = this.state.equityUsd;
    }

    const ddPct =
      this.state.highWaterMarkEquityUsd > 0
        ? ((this.state.highWaterMarkEquityUsd - this.state.equityUsd) /
            this.state.highWaterMarkEquityUsd) *
          100
        : 0;
    this.state.currentDrawdownPct = Number(Math.max(0, ddPct).toFixed(2));
    if (this.state.currentDrawdownPct > this.state.maxDrawdownPct) {
      this.state.maxDrawdownPct = this.state.currentDrawdownPct;
    }
  }

  private appendJournal(
    entry: Omit<SystemJournalEntry, 'entryId'>
  ): SystemJournalEntry {
    const fullEntry: SystemJournalEntry = {
      entryId: `JRN-${String(this.state.journal.length + 1).padStart(4, '0')}`,
      ...entry,
    };
    this.state.journal.push(fullEntry);
    this.storage.appendJournalToDisk(fullEntry);
    return fullEntry;
  }

  /**
   * Traceability Query 1: Trace from a Trade/Position back to its Entry Candle,
   * Regime Classification, Coordinator Candidates, Risk Decision, Deals, and Reconciliation.
   */
  public getPositionFullTrace(positionId: string): {
    position: SimulatedPosition;
    entryCycleTrace?: CycleTraceRecord;
    closeCycleTrace?: CycleTraceRecord;
    reconciliation?: ReconciliationRecord;
    policyAtEntry?: PolicyVersionRecord;
  } | null {
    const position =
      this.state.closedPositions.find((p) => p.positionId === positionId) ||
      this.state.openPositions.find((p) => p.positionId === positionId) ||
      this.state.rejectedOrExpiredOrders.find((p) => p.positionId === positionId);

    if (!position) return null;

    const entryCycleTrace = this.state.cycleTraces.find(
      (t) => t.cycleId === position.entryCycleId
    );
    const closeCycleTrace = position.closeCycleId
      ? this.state.cycleTraces.find((t) => t.cycleId === position.closeCycleId)
      : undefined;
    const reconciliation = this.state.reconciliations.find(
      (r) => r.positionId === position.positionId
    );
    const policyAtEntry = this.state.policies.find(
      (p) => p.policyId === position.openedUnderPolicyId
    );

    return {
      position,
      entryCycleTrace,
      closeCycleTrace,
      reconciliation,
      policyAtEntry,
    };
  }

  /**
   * Traceability Query 2: Trace from a Learning Run back to all Reconciled Positions,
   * Shadow Candidate Outcomes, Excluded Samples, and Resulting Policy Version.
   */
  public getLearningRunFullTrace(runId: string): {
    learningRun: LearningRunRecord;
    reconciledPositionsUsed: SimulatedPosition[];
    reconciliationsUsed: ReconciliationRecord[];
    shadowOutcomesUsed: ShadowCandidateOutcome[];
    resultingPolicy?: PolicyVersionRecord;
    previousPolicy?: PolicyVersionRecord;
  } | null {
    const learningRun = this.state.learningRuns.find((r) => r.runId === runId);
    if (!learningRun) return null;

    const reconciledPositionsUsed = this.state.closedPositions.filter((p) =>
      learningRun.reconciledPositionIdsUsed.includes(p.positionId)
    );
    const reconciliationsUsed = this.state.reconciliations.filter((r) =>
      learningRun.reconciledPositionIdsUsed.includes(r.positionId)
    );
    const exactSampleIds = learningRun.trainingSampleIds && learningRun.validationSampleIds
      ? new Set([...learningRun.trainingSampleIds, ...learningRun.validationSampleIds]) : undefined;
    const cutoffMs = Date.parse(learningRun.executedAtMarketTime);
    const shadowOutcomesUsed = this.state.shadowOutcomes.filter(
      (s) =>
        exactSampleIds ? exactSampleIds.has(s.shadowId) :
          learningRun.sampleCycleIdsUsed.includes(s.cycleId) && Boolean(s.closeMarketTime) &&
          Date.parse(s.closeMarketTime!) <= cutoffMs
    );
    const resultingPolicy = this.state.policies.find(
      (p) => p.policyId === learningRun.resultingPolicyId
    );
    const previousPolicy = this.state.policies.find(
      (p) => p.policyId === learningRun.previousPolicyId
    );

    return {
      learningRun,
      reconciledPositionsUsed,
      reconciliationsUsed,
      shadowOutcomesUsed,
      resultingPolicy,
      previousPolicy,
    };
  }
}
