import {
  buildDualCostStressComparison,
  DualCostStressComparison,
} from './costStress.ts';
import {
  ensureReplayDatasetFile,
  validateIncomingCandle,
} from './dataReplay.ts';
import {
  LearningBranchFixtureSuiteReport,
  runAllLearningBranchFixtures,
} from './fixtures.ts';
import {
  BrokerSessionScheduleConfig,
  checkMandatoryCutoffClose,
  cloneBrokerSchedule,
  evaluateMarketSchedule,
} from './marketSchedule.ts';
import { reconcileClosedPosition } from './reconciliation.ts';
import { classifyMarketRegime } from './regimeDetector.ts';
import {
  createShadowOutcomeFromCandidate,
  executeWalkForwardLearningRun,
  LEARNER_VERSION,
  TICK_MIN_SAMPLES_PER_REGIME,
} from './researchTeam.ts';
import {
  computeSlOvershootP95Buffer,
  evaluateRiskGate,
  guardLearnerCannotModifyRiskLimits,
} from './riskGate.ts';
import {
  ExecutionCostLatencyOptions,
  openSimulatedPosition,
  stepOpenPositionOnCandle,
} from './simBroker.ts';
import { DurableQuantStorage } from './storage.ts';
import {
  evaluateMultiTimeframeCandidates,
  selectStrategyForCycle,
} from './strategies.ts';
import {
  createInitialTickIngestionState,
  DurableTickIngestor,
  evaluateDataSourceStatus,
  TickBatchIngestResult,
  TickBatchPayload,
} from './tickIngestor.ts';
import { ReplayQuote, TickReplay } from './tickReplay.ts';
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
  ticksFilePath?: string;
  replayIntervalMs?: number;
  autoStart?: boolean;
  brokerSchedule?: Partial<BrokerSessionScheduleConfig>;
}

export class QuantLabOrchestrator {
  private readonly storage: DurableQuantStorage;
  private readonly ingestor: DurableTickIngestor;
  private readonly dataset: ReplayDataset;
  private readonly ticks?: TickReplay;
  private state: QuantSystemState;
  private timer: NodeJS.Timeout | null = null;
  private lastHeartbeatSystemMs: number = Date.now();

  constructor(options: OrchestratorOptions) {
    this.dataset = ensureReplayDatasetFile(options.replayFilePath);
    this.ticks = options.ticksFilePath ? new TickReplay(options.ticksFilePath) : undefined;
    const ticks = this.ticks;
    if (ticks && this.dataset.candles.some((candle) => ticks.within(candle).next().done)) {
      throw new Error('Dữ liệu tick thiếu báo giá trong ít nhất một nến phát lại.');
    }
    const intervalMs = options.replayIntervalMs ?? 800;
    this.storage = new DurableQuantStorage({ dataDir: options.dataDir });
    this.ingestor = new DurableTickIngestor(options.dataDir);

    const { state } = this.storage.loadOrInitializeState(
      this.dataset.candles.length,
      intervalMs
    );
    this.state = state;
    const replayMode = this.ticks ? 'TICK' : 'BAR';
    if (
      state.replayCursorIndex > 0 &&
      ((state.replayMode ?? 'BAR') !== replayMode ||
        (state.replayDatasetId && state.replayDatasetId !== this.dataset.metadata.datasetId))
    ) {
      throw new Error('Dùng thư mục trạng thái riêng khi đổi chế độ hoặc bộ dữ liệu phát lại.');
    }
    state.replayMode = replayMode;
    state.replayDatasetId = this.dataset.metadata.datasetId;
    if (options.brokerSchedule) {
      this.state.brokerSchedule = cloneBrokerSchedule(options.brokerSchedule);
    } else if (!this.state.brokerSchedule) {
      this.state.brokerSchedule = cloneBrokerSchedule();
    }
    if (!this.state.tickIngestionState) {
      this.state.tickIngestionState = createInitialTickIngestionState('REPLAY_DATASET');
    }
    this.state.dataSourceTelemetry = this.state.tickIngestionState.telemetry;
    this.state.slOvershootP95 = computeSlOvershootP95Buffer(this.state.closedPositions);

    this.restoreIngestedCandlesIntoDataset();
    this.restoreOpenShadows();
    this.restoreDailyDrawdown();
    this.state.replayIntervalMs = intervalMs;

    const activePolicy = this.state.policies.find(
      (policy) => policy.policyId === this.state.activePolicyId
    );
    if (
      activePolicy &&
      !activePolicy.isBaseline &&
      activePolicy.learnerVersion !== LEARNER_VERSION
    ) {
      const baseline = this.state.policies.find(
        (policy) => policy.policyId === this.state.baselinePolicyId
      )!;
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

  private restoreIngestedCandlesIntoDataset(): void {
    const existingIds = new Set(this.dataset.candles.map((c) => c.candleId));
    for (const trace of this.state.cycleTraces) {
      if (trace.validation.valid && !existingIds.has(trace.candle.candleId)) {
        this.dataset.candles.push(trace.candle);
        existingIds.add(trace.candle.candleId);
      }
    }
    this.dataset.metadata.totalCandles = this.dataset.candles.length;
    this.state.totalReplayCandles = Math.max(
      this.state.totalReplayCandles,
      this.dataset.candles.length
    );
  }

  private restoreDailyDrawdown(): void {
    if (this.state.dailyDrawdown || !this.state.lastProcessedMarketTime) return;
    let previousEquity = this.state.initialBalanceUsd;
    let marketDateUtc = '';
    let peakEquityUsd = previousEquity;
    for (const point of this.state.equityCurve) {
      const date = new Date(point.marketTime).toISOString().slice(0, 10);
      peakEquityUsd = Math.max(
        date === marketDateUtc ? peakEquityUsd : previousEquity,
        point.equityUsd
      );
      marketDateUtc = date;
      previousEquity = point.equityUsd;
    }
    const lastDate = new Date(this.state.lastProcessedMarketTime).toISOString().slice(0, 10);
    this.state.dailyDrawdown = {
      marketDateUtc: lastDate,
      peakEquityUsd: marketDateUtc === lastDate ? peakEquityUsd : previousEquity,
      currentPct: 0,
    };
    this.updateDailyDrawdown();
  }

  private updateDailyDrawdown(): void {
    const daily = this.state.dailyDrawdown;
    if (!daily) return;
    daily.peakEquityUsd = Math.max(daily.peakEquityUsd, this.state.equityUsd);
    daily.currentPct =
      daily.peakEquityUsd > 0
        ? Number(
            (((daily.peakEquityUsd - this.state.equityUsd) / daily.peakEquityUsd) * 100).toFixed(2)
          )
        : 0;
  }

  private closeShadow(
    outcome: ShadowCandidateOutcome,
    position: SimulatedPosition,
    candleIndex: number
  ) {
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
      intraBarConflictTriggered:
        position.exitReason === 'INTRA_BAR_SL_TP_CONFLICT_SL_FIRST',
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
        (item) =>
          item.strategyId === outcome.strategyId && item.version === outcome.strategyVersion
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
        volumeLots: outcome.riskSizedVolumeLots ?? 0.5,
      });
      for (const later of traces) {
        if (later.candleIndex <= trace.candleIndex || !later.validation.valid) continue;
        shadowPosition = stepOpenPositionOnCandle(
          shadowPosition,
          later.cycleId,
          later.candle,
          later.coordinatorDecision?.systemTime,
          undefined,
          this.state.brokerSchedule
        );
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
    return {
      ...this.storage.getPaths(),
      tickBatchLogPath: this.ingestor.getBatchLogPath(),
    };
  }

  public getState(): QuantSystemState {
    const nowMs = Date.now();
    const isRecentlyActive =
      (this.state.isLoopRunning &&
        !this.state.isReplayComplete &&
        nowMs - this.lastHeartbeatSystemMs < Math.max(5000, this.state.replayIntervalMs * 3)) ||
      (this.state.dataSourceTelemetry?.sourceMode === 'MT5_DEMO_LIVE' &&
        nowMs - this.lastHeartbeatSystemMs < 15000);

    this.state.teamExecutionStatus.isActive = isRecentlyActive;
    this.state.teamResearchStatus.isActive =
      isRecentlyActive && this.state.replayCursorIndex >= 15;

    if (this.state.dataSourceTelemetry && this.state.brokerSchedule) {
      const dsStatus = evaluateDataSourceStatus({
        telemetry: this.state.dataSourceTelemetry,
        schedule: this.state.brokerSchedule,
        referenceMarketTimeIso: this.state.lastProcessedMarketTime,
        nowSystemMs: nowMs,
      });
      this.state.dataSourceTelemetry.connectionState = dsStatus.connectionState;
      this.state.dataSourceTelemetry.connectionLabelVi = dsStatus.connectionLabelVi;
    }

    return this.state;
  }

  public updateBrokerSchedule(
    patch: Partial<BrokerSessionScheduleConfig>,
    systemTime: string = new Date().toISOString()
  ): BrokerSessionScheduleConfig {
    const current = this.state.brokerSchedule || cloneBrokerSchedule();
    const updated: BrokerSessionScheduleConfig = {
      ...current,
      ...patch,
      updatedAtSystemTime: systemTime,
      earlyCloseOverrides: patch.earlyCloseOverrides
        ? structuredClone(patch.earlyCloseOverrides)
        : current.earlyCloseOverrides,
      closeOnlyDates: patch.closeOnlyDates
        ? structuredClone(patch.closeOnlyDates)
        : current.closeOnlyDates,
    };
    this.state.brokerSchedule = updated;
    const evalTime =
      this.state.lastProcessedMarketTime ||
      this.state.dataSourceTelemetry?.lastQuoteMarketTime ||
      '2026-03-02T08:00:00.000Z';
    this.state.lastScheduleEvaluation = evaluateMarketSchedule(evalTime, updated);
    this.appendJournal({
      timestampSystem: systemTime,
      timestampMarket: evalTime,
      cycleId: `CYCLE-SCHED-${this.state.replayCursorIndex}`,
      team: 'ORCHESTRATOR',
      level: 'INFO',
      eventCode: 'BROKER_SCHEDULE_UPDATED',
      messageVi: `Cập nhật lịch phiên broker (${updated.scheduleId}@${updated.version}, múi giờ ${updated.timezone}, đóng Thứ Sáu ${updated.fridayCloseLocalTime}, quy tắc ${updated.cutoffStopNewEntriesMinutesBeforeClose}/${updated.cutoffFlattenPositionsMinutesBeforeClose} phút).`,
    });
    this.storage.saveState(this.state);
    return updated;
  }

  public getCostStressComparison(
    options?: ExecutionCostLatencyOptions
  ): DualCostStressComparison {
    const activePolicy =
      this.state.policies.find((p) => p.policyId === this.state.activePolicyId) ||
      this.state.policies[0];
    const processedCandles = this.dataset.candles.slice(0, this.state.replayCursorIndex);
    return buildDualCostStressComparison({
      executedClosedPositions: this.state.closedPositions,
      candles: processedCandles.length > 0 ? processedCandles : this.dataset.candles,
      activePolicy,
      ticks: this.ticks,
      quotesByCandleId: this.state.tickIngestionState?.completedBarQuotesByCandleId,
      firstAfterCloseByCandleId:
        this.state.tickIngestionState?.firstAfterCloseQuoteByCandleId,
      options,
    });
  }

  public getLearningBranchFixturesReport(): LearningBranchFixtureSuiteReport {
    return runAllLearningBranchFixtures();
  }

  /**
   * Ingests a batch of live/demo Bid/Ask ticks durably and idempotently.
   * Serializes concurrent batch calls, deduplicates retries, handles multiple quotes
   * in the same millisecond, enforces 15/15 cutoff & missed-cutoff closure on live quotes,
   * and emits closed M15 candles into `processClosedCandle`.
   */
  public async ingestTickBatch(
    payload: TickBatchPayload,
    systemTime: string = new Date().toISOString()
  ): Promise<TickBatchIngestResult> {
    return this.ingestor.enqueueIngest(() => {
      this.lastHeartbeatSystemMs = Date.now();
      if (!this.state.tickIngestionState) {
        this.state.tickIngestionState = createInitialTickIngestionState('MT5_DEMO_LIVE');
      }
      if (!this.state.brokerSchedule) {
        this.state.brokerSchedule = cloneBrokerSchedule();
      }

      const result = this.ingestor.processBatch({
        payload,
        ingestionState: this.state.tickIngestionState,
        schedule: this.state.brokerSchedule,
        systemTime,
        onLiveQuoteAccepted: (quote, _rawSymbol, sysTime) => {
          this.handleLiveQuoteOnOpenPositions(quote, sysTime);
        },
        onClosedCandleBuilt: (
          closedCandle,
          barQuotes,
          firstQuoteAfterClose,
          sysTime
        ) => {
          if (!this.dataset.candles.some((c) => c.candleId === closedCandle.candleId)) {
            this.dataset.candles.push(closedCandle);
            this.dataset.metadata.totalCandles = this.dataset.candles.length;
            this.state.totalReplayCandles = Math.max(
              this.state.totalReplayCandles,
              this.dataset.candles.length
            );
          }
          this.processClosedCandle(
            closedCandle,
            sysTime,
            barQuotes,
            firstQuoteAfterClose
          );
        },
      });

      this.state.dataSourceTelemetry = this.state.tickIngestionState.telemetry;
      if (this.state.dataSourceTelemetry.lastQuoteMarketTime) {
        this.state.lastScheduleEvaluation = evaluateMarketSchedule(
          this.state.dataSourceTelemetry.lastQuoteMarketTime,
          this.state.brokerSchedule
        );
      }
      this.state.lastUpdatedSystemTime = systemTime;
      this.storage.saveState(this.state);
      return result;
    });
  }

  /**
   * Checks open positions against live incoming Bid/Ask quotes for immediate
   * 15/15 Friday / Early-Close cutoff or missed-cutoff first-valid-quote liquidation.
   */
  private handleLiveQuoteOnOpenPositions(
    quote: ReplayQuote,
    systemTime: string
  ): void {
    if (this.state.openPositions.length === 0 || !this.state.brokerSchedule?.enabled) {
      return;
    }

    const quoteIso = new Date(quote.time).toISOString();
    const remaining: SimulatedPosition[] = [];
    let anyChanged = false;

    for (const openPos of this.state.openPositions) {
      const cutoffCheck = checkMandatoryCutoffClose({
        entryMarketTimeUtc: openPos.entryMarketTime,
        currentQuoteTimeUtc: quoteIso,
        schedule: this.state.brokerSchedule,
      });

      if (!cutoffCheck.mustClose) {
        remaining.push(openPos);
        continue;
      }

      const cycleId = `CYCLE-CUTOFF-${this.state.replayCursorIndex}`;
      const synthCandle: M15Candle = {
        candleId: `CUTOFF-QUOTE-${quote.time}`,
        symbol: 'XAUUSD',
        timeframe: 'M15',
        openTime: quoteIso,
        closeTime: quoteIso,
        open: quote.bid,
        high: quote.ask,
        low: quote.bid,
        close: quote.bid,
        volume: 1,
        spreadPts: Math.max(1, Math.round((quote.ask - quote.bid) * 100)),
        isClosed: true,
      };

      const stepped = stepOpenPositionOnCandle(
        openPos,
        cycleId,
        synthCandle,
        systemTime,
        [quote],
        this.state.brokerSchedule
      );
      // Adjust barsHeld back by 1 if closed intra-bar on a live quote
      stepped.barsHeld = Math.max(0, stepped.barsHeld - 1);

      if (stepped.status === 'CLOSED') {
        const { reconciledPosition, record } = reconcileClosedPosition(
          stepped,
          systemTime
        );
        const execKey = `${reconciledPosition.positionId}-RECONCILED`;
        if (
          record.status === 'RECONCILED_OK' &&
          !this.state.processedExecutionIds.includes(execKey)
        ) {
          this.state.processedExecutionIds.push(execKey);
          this.state.closedPositions.push(reconciledPosition);
          this.state.reconciliations.push(record);
          anyChanged = true;

          this.appendJournal({
            timestampSystem: systemTime,
            timestampMarket: quoteIso,
            cycleId,
            team: 'TEAM_1_EXECUTION',
            level: 'WARN',
            eventCode:
              reconciledPosition.exitReason === 'MISSED_CUTOFF_FIRST_VALID_QUOTE'
                ? 'MISSED_CUTOFF_CLOSED_FIRST_VALID_QUOTE'
                : 'FRIDAY_15_15_POSITION_FLATTENED',
            messageVi: `${reconciledPosition.exitReasonVi} — ${record.summaryVi}`,
          });
        } else {
          remaining.push(reconciledPosition);
        }
      } else {
        remaining.push(stepped);
      }
    }

    if (anyChanged) {
      this.state.openPositions = remaining;
      this.state.slOvershootP95 = computeSlOvershootP95Buffer(this.state.closedPositions);
      this.recalculateAccountMetrics();
    }
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
            'Đang chờ dữ liệu phát lại mới, lô báo giá MT5 hoặc lệnh đặt lại phiên mô phỏng.';
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
    this.state.replayMode = this.ticks ? 'TICK' : 'BAR';
    this.state.replayDatasetId = this.dataset.metadata.datasetId;
    this.storage.saveState(this.state);
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
    systemTime: string = new Date().toISOString(),
    customBarQuotes?: ReplayQuote[],
    customFirstQuoteAfterClose?: ReplayQuote
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

    const marketDateUtc = new Date(candle.closeTime).toISOString().slice(0, 10);
    if (this.state.dailyDrawdown?.marketDateUtc !== marketDateUtc) {
      this.state.dailyDrawdown = {
        marketDateUtc,
        peakEquityUsd: this.state.equityUsd,
        currentPct: 0,
      };
    }

    // Advance cursor & register processed candleId
    this.state.replayCursorIndex = nextIndex;
    this.state.processedCandleIds.push(candle.candleId);
    this.state.lastProcessedMarketTime = candle.closeTime;
    this.state.lastUpdatedSystemTime = systemTime;

    const scheduleEvaluation = this.state.brokerSchedule
      ? evaluateMarketSchedule(candle.closeTime, this.state.brokerSchedule)
      : undefined;
    if (scheduleEvaluation) {
      this.state.lastScheduleEvaluation = scheduleEvaluation;
    }

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

    const resolveBarQuotes = (): Iterable<ReplayQuote> | undefined => {
      if (customBarQuotes && customBarQuotes.length > 0) return customBarQuotes;
      return this.ticks?.within(candle);
    };

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
        systemTime,
        resolveBarQuotes(),
        this.state.brokerSchedule
      );

      // If partial close TP1 just occurred on this bar, realize partial PnL into balance
      if (
        stepped.closedVolumeLots > prevClosedLots &&
        stepped.status === 'PARTIAL_CLOSED'
      ) {
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
        const execKey = `${reconciledPosition.positionId}-RECONCILED`;

        if (
          record.status === 'RECONCILED_OK' &&
          !this.state.processedExecutionIds.includes(execKey)
        ) {
          this.state.processedExecutionIds.push(execKey);
          this.state.closedPositions.push(reconciledPosition);
          this.state.reconciliations.push(record);
          closedPositionIds.push(reconciledPosition.positionId);
          reconciliationIds.push(record.reconciliationId);

          this.appendJournal({
            timestampSystem: systemTime,
            timestampMarket: candle.closeTime,
            cycleId,
            team: 'TEAM_1_EXECUTION',
            level:
              reconciledPosition.exitReason === 'FRIDAY_15_15_CUTOFF' ||
              reconciledPosition.exitReason === 'MISSED_CUTOFF_FIRST_VALID_QUOTE'
                ? 'WARN'
                : 'INFO',
            eventCode:
              reconciledPosition.exitReason === 'MISSED_CUTOFF_FIRST_VALID_QUOTE'
                ? 'MISSED_CUTOFF_CLOSED_FIRST_VALID_QUOTE'
                : reconciledPosition.exitReason === 'FRIDAY_15_15_CUTOFF'
                ? 'FRIDAY_15_15_POSITION_FLATTENED'
                : 'POSITION_CLOSED_RECONCILED',
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
    this.state.slOvershootP95 = computeSlOvershootP95Buffer(this.state.closedPositions);

    // Step active parallel shadow positions on this closed candle
    const openShadows = this.state.openShadowPositions!;
    for (const outcome of this.state.shadowOutcomes) {
      const position = openShadows[outcome.shadowId];
      if (!position) continue;
      const stepped = stepOpenPositionOnCandle(
        position,
        cycleId,
        candle,
        systemTime,
        resolveBarQuotes(),
        this.state.brokerSchedule
      );
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

    const decisionEquityUsd = this.state.equityUsd;
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
    const quote = customFirstQuoteAfterClose ?? this.ticks?.firstAfterClose(candle);
    const executionCandle = quote
      ? { ...candle, spreadPts: Math.ceil((quote.ask - quote.bid) * 100 - 1e-8) }
      : candle;
    const canQuote = !this.ticks || quote !== undefined;

    if (
      canQuote &&
      coordinatorDecision.action === 'SELECT_STRATEGY' &&
      coordinatorDecision.selectedCandidate
    ) {
      const selected = coordinatorDecision.selectedCandidate;
      signalId = `SIG-${cycleId}-${selected.strategyId}-${selected.version}`;

      if (!this.state.processedSignalIds.includes(signalId)) {
        riskDecision = evaluateRiskGate({
          cycleId,
          candle: executionCandle,
          quote,
          signalId,
          candidate: selected,
          openPositions: this.state.openPositions,
          closedPositions: this.state.closedPositions,
          currentDrawdownPct: this.state.currentDrawdownPct,
          dailyDrawdownPct: this.state.dailyDrawdown.currentPct,
          riskLimits: this.state.riskLimits,
          requestedLots: 0.5,
          accountEquityUsd: decisionEquityUsd,
          schedule: this.state.brokerSchedule,
          scheduleEvaluation,
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
            candle: executionCandle,
            quote,
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
    const scheduleAllowsNew = !scheduleEvaluation || scheduleEvaluation.allowNewEntries;
    if (
      canQuote &&
      scheduleAllowsNew &&
      regimeClassification.allowTrading &&
      executionCandle.spreadPts <= this.state.riskLimits.maxSpreadPtsAllowed
    ) {
      const baselineTarget = baselinePolicy.mapping[regimeClassification.regime];
      const researchLimits = {
        ...this.state.riskLimits,
        killSwitchActive: false,
        haltNewPositionsByLearner: false,
      };
      for (const cand of candidates) {
        if (cand.eligibleToEnter) {
          // Counterfactual entries share decision-time equity and order limits.
          // Portfolio occupancy and the active account halt apply to execution only.
          const order = evaluateRiskGate({
            cycleId,
            candle: executionCandle,
            quote,
            signalId: `SHDW-${cycleId}-${cand.strategyId}-${cand.version}`,
            candidate: cand,
            openPositions: [],
            closedPositions: this.state.closedPositions,
            currentDrawdownPct: 0,
            dailyDrawdownPct: 0,
            riskLimits: researchLimits,
            requestedLots: 0.5,
            accountEquityUsd: decisionEquityUsd,
            schedule: this.state.brokerSchedule,
            scheduleEvaluation,
            systemTime,
          });
          if (!order.approved) continue;
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
            candle: executionCandle,
            quote,
            candleIndex: nextIndex,
            regime: regimeClassification.regime,
            candidate: cand,
            wasSelectedByActivePolicy: wasActive,
            wasSelectedByBaselinePolicy: wasBaseline,
            livePositionId: wasActive ? openedPositionId : undefined,
            volumeLots: order.approvedLots,
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
    // ========================================================================
    let learningRunId: string | undefined = undefined;
    let policyChangedTo: string | undefined = undefined;

    const scheduledLearningCycles = [18, 34, 48, 64];
    const recurringLearningCycle = nextIndex > 64 && (nextIndex - 64) % 16 === 0;
    if (
      scheduledLearningCycles.includes(nextIndex) ||
      recurringLearningCycle ||
      nextIndex === this.dataset.candles.length
    ) {
      const lrResult = this.runResearchAndValidationCycle(
        cycleId,
        candle.closeTime,
        `Đạt mốc lịch trình kiểm định Walk-Forward tự động tại chu kỳ ${cycleId} (Nến ${nextIndex}/${this.dataset.candles.length})`,
        systemTime,
        undefined,
        undefined,
        false
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
      scheduleEvaluation,
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
      allShadowOutcomes: this.state.shadowOutcomes.filter(
        (sample) => sample.riskSizedVolumeLots !== undefined
      ),
      reconciledPositions: this.state.closedPositions,
      activePolicy,
      baselinePolicy,
      allPolicies: this.state.policies,
      minSamplesPerRegime: this.ticks
        ? Math.max(TICK_MIN_SAMPLES_PER_REGIME, customMinSamples ?? 0)
        : customMinSamples,
      degradationLossThresholdUsd: customDegradationThresholdUsd,
      portfolioCapacity: riskLimitsBefore,
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

    this.updateDailyDrawdown();

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
    const exactSampleIds =
      learningRun.trainingSampleIds && learningRun.validationSampleIds
        ? new Set([
            ...learningRun.trainingSampleIds,
            ...learningRun.validationSampleIds,
          ])
        : undefined;
    const cutoffMs = Date.parse(learningRun.executedAtMarketTime);
    const shadowOutcomesUsed = this.state.shadowOutcomes.filter((s) =>
      exactSampleIds
        ? exactSampleIds.has(s.shadowId)
        : learningRun.sampleCycleIdsUsed.includes(s.cycleId) &&
          Boolean(s.closeMarketTime) &&
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
