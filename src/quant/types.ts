export type ExecutionMode = 'SIMULATION_ONLY';

export type MarketRegime =
  | 'TRENDING'
  | 'RANGING'
  | 'SQUEEZE_PRE_BREAKOUT'
  | 'VOLATILITY_SHOCK'
  | 'INSUFFICIENT_DATA';

export const REGIME_LABELS_VI: Record<MarketRegime, string> = {
  TRENDING: 'Có xu hướng (Trending)',
  RANGING: 'Đi ngang (Ranging)',
  SQUEEZE_PRE_BREAKOUT: 'Co hẹp trước phá vỡ (Squeeze)',
  VOLATILITY_SHOCK: 'Biến động sốc (Volatility Shock)',
  INSUFFICIENT_DATA: 'Thiếu dữ liệu / Chưa rõ (Insufficient Data)',
};

export type StrategyId =
  | 'STRAT_TREND_FOLLOW'
  | 'STRAT_MEAN_REVERT'
  | 'STRAT_VOL_BREAKOUT';

export type OrderDirection = 'BUY' | 'SELL';

export interface M15Candle {
  candleId: string;
  symbol: 'XAUUSD';
  timeframe: 'M15';
  openTime: string;  // ISO-8601 Market Time
  closeTime: string; // ISO-8601 Market Time
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  spreadPts: number; // Points (e.g. 18 = $0.18 on XAUUSD)
  isClosed: boolean;
  syntheticNote?: string;
}

export interface ReplayDatasetMetadata {
  datasetId: string;
  symbol: 'XAUUSD';
  timeframe: 'M15';
  sourceDescription: string;
  syntheticDisclosure: string;
  expectedFirstPolicyUpdateCycle: number;
  expectedFirstPolicyUpdateSecondsAtDefaultSpeed: number;
  intraCandleConflictRule: 'CONSERVATIVE_SL_FIRST';
  totalCandles: number;
}

export interface ReplayDataset {
  metadata: ReplayDatasetMetadata;
  candles: M15Candle[];
}

export interface CandleValidationResult {
  valid: boolean;
  candleId: string;
  marketCloseTime: string;
  systemReceivedTime: string;
  isDuplicate: boolean;
  hasTimeGap: boolean;
  gapMinutes: number;
  errorCode?:
    | 'NOT_CLOSED'
    | 'DUPLICATE_CANDLE'
    | 'OUT_OF_ORDER'
    | 'INVALID_OHLC'
    | 'NON_FINITE_VALUES'
    | 'NEGATIVE_VOLUME';
  reasonVi: string;
}

export interface RegimeIndicators {
  validLookbackBars: number;
  emaFast20: number;
  emaSlow50: number;
  emaSlope: number;
  adxProxy: number;
  rsi14: number;
  atr14: number;
  atrRatio: number; // Current bar range or short ATR vs baseline ATR
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbWidthPct: number;
  zScore20: number;
  donchianHigh12: number;
  donchianLow12: number;
}

export interface RegimeThresholds {
  minLookbackBars: number;
  shockAtrRatioMin: number;
  squeezeBbWidthMaxPct: number;
  trendingAdxMin: number;
  trendingEmaSpreadMin: number;
}

export interface RegimeClassification {
  cycleId: string;
  candleId: string;
  marketTime: string;
  systemTime: string;
  regime: MarketRegime;
  regimeLabelVi: string;
  confidence: number;
  allowTrading: boolean;
  standAsideReasonVi?: string;
  indicators: RegimeIndicators;
  thresholds: RegimeThresholds;
  reasonVi: string;
}

export interface StrategyCandidateEvaluation {
  strategyId: StrategyId;
  strategyNameVi: string;
  version: string;
  contextTimeframe?: 'H1' | 'H4';
  contextClosedAt?: string;
  family: 'TREND_FOLLOWING' | 'MEAN_REVERSION' | 'VOLATILITY_BREAKOUT';
  eligibleToEnter: boolean;
  direction?: OrderDirection;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit1?: number; // Partial close target (50%)
  takeProfit2?: number; // Full close target (100%)
  expiryBars: number;
  partialCloseRatio: number; // e.g., 0.5
  entryConditionSummaryVi: string;
  skipReasonVi?: string;
  signalStrength: number;
}

export interface CoordinatorDecision {
  cycleId: string;
  candleId: string;
  marketTime: string;
  systemTime: string;
  regime: MarketRegime;
  activePolicyId: string;
  baselinePolicyId: string;
  action: 'SELECT_STRATEGY' | 'STAND_ASIDE';
  selectedStrategyId?: StrategyId;
  selectedStrategyVersion?: string;
  selectedCandidate?: StrategyCandidateEvaluation;
  baselineStrategyId?: StrategyId;
  candidatesConsidered: StrategyCandidateEvaluation[];
  reasonVi: string;
}

export interface RiskLimitsConfig {
  maxOpenPositions: number;
  maxVolumeLotsPerTrade: number;
  maxTotalExposureLots: number;
  maxDailyDrawdownPct: number;
  maxTotalDrawdownPct: number;
  maxSpreadPtsAllowed: number;
  defaultRiskPerTradePct: number;
  killSwitchActive: boolean;
  haltNewPositionsByLearner: boolean;
}

export interface RiskDecision {
  cycleId: string;
  candleId: string;
  signalId: string;
  marketTime: string;
  systemTime: string;
  approved: boolean;
  vetoed: boolean;
  requestedLots: number;
  approvedLots: number;
  currentOpenPositions: number;
  currentDrawdownPct: number;
  dailyDrawdownPct: number;
  spreadPts: number;
  limitsChecked: RiskLimitsConfig;
  vetoCode?:
    | 'KILL_SWITCH_ACTIVE'
    | 'LEARNER_HALT_ACTIVE'
    | 'MAX_OPEN_POSITIONS_EXCEEDED'
    | 'MAX_VOLUME_EXCEEDED'
    | 'MAX_DAILY_DRAWDOWN_EXCEEDED'
    | 'MAX_TOTAL_DRAWDOWN_EXCEEDED'
    | 'EXCESSIVE_SPREAD'
    | 'INVALID_STOP_DISTANCE';
  reasonVi: string;
}

export type OrderExecutionStatus =
  | 'FILLED'
  | 'PARTIAL_CLOSED'
  | 'CLOSED'
  | 'REJECTED'
  | 'EXPIRED';

export type PositionExitReason =
  | 'TP2_FULL_TARGET'
  | 'SL_AFTER_PARTIAL_TP1'
  | 'STOP_LOSS_HIT'
  | 'INTRA_BAR_SL_TP_CONFLICT_SL_FIRST'
  | 'TIME_EXPIRED'
  | 'REJECTED_AT_ENTRY'
  | 'ORDER_EXPIRED_UNFILLED'
  | 'OPEN';

export interface PartialDealEvent {
  dealId: string;
  cycleId: string;
  candleId: string;
  marketTime: string;
  systemTime: string;
  eventType: 'ENTRY_FILL' | 'PARTIAL_CLOSE_TP1' | 'FINAL_CLOSE';
  volumeLots: number;
  expectedPrice: number;
  fillPrice: number;
  slippagePts: number;
  spreadPts: number;
  commissionUsd: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  noteVi: string;
}

export interface PositionManagementRulesSnapshot {
  policyId: string;
  strategyId: StrategyId;
  strategyVersion: string;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  partialCloseRatio: number;
  expiryBars: number;
  intraCandleRule: 'CONSERVATIVE_SL_FIRST';
}

export interface SimulatedPosition {
  positionId: string;
  signalId: string;
  entryCycleId: string;
  entryCandleId: string;
  closeCycleId?: string;
  closeCandleId?: string;
  symbol: 'XAUUSD';
  timeframe: 'M15';
  regimeAtEntry: MarketRegime;
  openedUnderPolicyId: string;
  strategyId: StrategyId;
  strategyNameVi: string;
  strategyVersion: string;
  direction: OrderDirection;
  status: OrderExecutionStatus;
  entryMarketTime: string;
  entrySystemTime: string;
  closeMarketTime?: string;
  closeSystemTime?: string;
  expectedEntryPrice: number;
  fillEntryPrice: number;
  entrySlippagePts: number;
  entrySpreadPts: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  requestedVolumeLots: number;
  filledVolumeLots: number;
  closedVolumeLots: number;
  remainingVolumeLots: number;
  partialTp1Hit: boolean;
  barsHeld: number;
  maxBarsAllowed: number;
  expectedExitPrice?: number;
  avgExitFillPrice?: number;
  exitSlippagePts: number;
  totalSpreadCostUsd: number;
  totalSlippageCostUsd: number;
  totalCommissionUsd: number;
  totalCostUsd: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  netPnlAt2xCostUsd: number;
  unrealizedPnlUsd: number;
  exitReason: PositionExitReason;
  exitReasonVi: string;
  managementRulesSnapshot: PositionManagementRulesSnapshot;
  deals: PartialDealEvent[];
  reconciled: boolean;
  reconciliationId?: string;
}

export interface ReconciliationRecord {
  reconciliationId: string;
  positionId: string;
  entryCycleId: string;
  closeCycleId: string;
  reconciledAtMarketTime: string;
  reconciledAtSystemTime: string;
  filledVolumeLots: number;
  closedVolumeLots: number;
  volumeMatched: boolean;
  entryDeviationPts: number; // fillEntryPrice - expectedEntryPrice (signed by direction)
  exitDeviationPts: number;
  grossPnlUsd: number;
  totalCostUsd: number;
  netPnlUsd: number;
  netPnlAt2xCostUsd: number;
  dealCount: number;
  status: 'RECONCILED_OK' | 'DISCREPANCY_DETECTED';
  summaryVi: string;
}

export interface ShadowCandidateOutcome {
  shadowId: string;
  cycleId: string;
  candleId: string;
  regime: MarketRegime;
  strategyId: StrategyId;
  strategyVersion: string;
  direction: OrderDirection;
  entryMarketTime: string;
  closeMarketTime?: string;
  entryCandleIndex: number;
  closeCandleIndex?: number;
  status: 'OPEN' | 'CLOSED_RECONCILED';
  source: 'LIVE_SIM_RECONCILED' | 'PARALLEL_SHADOW_SIM';
  wasSelectedByActivePolicy: boolean;
  wasSelectedByBaselinePolicy: boolean;
  expectedEntryPrice: number;
  fillEntryPrice: number;
  entrySlippagePts?: number;
  avgExitPrice?: number;
  grossPnlUsd: number;
  totalCostUsd: number;
  netPnlUsd: number;
  netPnlAt2xCostUsd: number;
  exitReason?: PositionExitReason;
  intraBarConflictTriggered: boolean;
}

export interface RegimePolicyMapping {
  TRENDING: { strategyId: StrategyId; version: string } | 'STAND_ASIDE';
  RANGING: { strategyId: StrategyId; version: string } | 'STAND_ASIDE';
  SQUEEZE_PRE_BREAKOUT: { strategyId: StrategyId; version: string } | 'STAND_ASIDE';
  VOLATILITY_SHOCK: 'STAND_ASIDE';
  INSUFFICIENT_DATA: 'STAND_ASIDE';
}

export interface PolicyVersionRecord {
  policyId: string;
  versionNumber: number;
  createdAtMarketTime: string;
  createdAtSystemTime: string;
  parentPolicyId: string | null;
  sourceRunId: string;
  learnerVersion: string;
  status: 'ACTIVE' | 'SUPERSEDED' | 'ROLLED_BACK' | 'BASELINE_REFERENCE' | 'HALTED';
  isBaseline: boolean;
  mapping: RegimePolicyMapping;
  activationReasonVi: string;
  rollbackReasonVi?: string;
}

export interface StrategyRegimeRanking {
  regime: MarketRegime;
  strategyId: StrategyId;
  strategyVersion: string;
  sampleCount: number;
  excludedSampleCount: number;
  liveReconciledCount: number;
  shadowSimulatedCount: number;
  winRatePct: number;
  grossPnlUsd: number;
  totalCostUsd: number;
  netPnlUsd: number;
  netPnlAt2xCostUsd: number;
  maxDrawdownUsd: number;
  avgSlippagePts: number;
  rankingScore: number;
  meetsMinSamples: boolean;
  sampleCycleIds: string[];
}

export interface PolicyComparisonMetrics {
  opportunitiesCount: number;
  tradesCount: number;
  winRatePct: number;
  grossPnlUsd: number;
  totalCostUsd: number;
  netPnlAfterCostUsd: number;
  netPnlAt2xCostUsd: number;
  maxDrawdownUsd: number;
}

export interface RegimeComparisonRow {
  regime: MarketRegime;
  regimeLabelVi: string;
  adaptiveStrategyLabel: string;
  baselineStrategyLabel: string;
  adaptive: PolicyComparisonMetrics;
  baseline: PolicyComparisonMetrics;
}

export interface HypothesisRecord {
  hypothesisId: string;
  createdAtMarketTime: string;
  generatorSource: 'DETERMINISTIC_QUANT_ENGINE' | 'LLM_ASSISTED';
  targetRegime: MarketRegime;
  proposedStrategyId: StrategyId;
  proposedVersion: string;
  rationaleVi: string;
  validationStatus: 'TRAINING_SELECTED' | 'PROMOTED' | 'REJECTED_INSUFFICIENT_SAMPLES' | 'REJECTED_UNDERPERFORMED' | 'RETAINED_CURRENT';
  validationNoteVi: string;
}

export interface WalkForwardExclusionLog {
  shadowId: string;
  cycleId: string;
  strategyId: StrategyId;
  entryMarketTime: string;
  closeMarketTime: string;
  exclusionCode: 'OVERLAPS_WF_BOUNDARY' | 'UNCLOSED_AT_CUTOFF' | 'INSUFFICIENT_REGIME_DATA';
  reasonVi: string;
}

export interface LearningRunRecord {
  runId: string;
  triggerCycleId: string;
  learnerVersion: string;
  executedAtMarketTime: string;
  executedAtSystemTime: string;
  triggerReasonVi: string;
  trainWindowStartMarketTime: string;
  trainWindowEndMarketTime: string;
  validationWindowStartMarketTime: string;
  validationWindowEndMarketTime: string;
  rankingFormula: string;
  minSamplesPerRegime: number;
  intraCandleConflictRule: 'CONSERVATIVE_SL_FIRST';
  totalCompletedSamplesUsed: number;
  totalExcludedSamples: number;
  exclusions: WalkForwardExclusionLog[];
  rankingsByRegime: StrategyRegimeRanking[];
  regimeComparisons: RegimeComparisonRow[];
  overallAdaptiveMetrics: PolicyComparisonMetrics;
  overallBaselineMetrics: PolicyComparisonMetrics;
  hypothesesTested: HypothesisRecord[];
  decision:
    | 'PROMOTE_NEW_POLICY'
    | 'KEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES'
    | 'KEEP_CURRENT_POLICY_NO_OUTPERFORMANCE'
    | 'ROLLBACK_TO_PREVIOUS_POLICY'
    | 'HALT_NEW_POSITIONS_DEGRADED';
  previousPolicyId: string;
  resultingPolicyId: string;
  decisionReasonVi: string;
  reconciledPositionIdsUsed: string[];
  sampleCycleIdsUsed: string[];
  trainingSampleIds?: string[];
  validationSampleIds?: string[];
}

export interface CycleTraceRecord {
  cycleId: string;
  candleIndex: number;
  candle: M15Candle;
  validation: CandleValidationResult;
  regimeClassification?: RegimeClassification;
  coordinatorDecision?: CoordinatorDecision;
  riskDecision?: RiskDecision;
  signalId?: string;
  openedPositionId?: string;
  closedPositionIds: string[];
  reconciliationIds: string[];
  shadowOutcomeIds: string[];
  learningRunId?: string;
  policyChangedTo?: string;
  equityAfterCycleUsd: number;
  balanceAfterCycleUsd: number;
}

export interface TeamAgentStatus {
  teamId: 'TEAM_ANALYSIS_EXECUTION' | 'TEAM_RESEARCH_VALIDATION';
  teamNameVi: string;
  isActive: boolean; // True only when recent real work/heartbeat occurred
  currentTaskVi: string;
  lastCompletedTaskVi: string;
  lastCompletedMarketTime: string | null;
  lastCompletedSystemTime: string | null;
  waitStateReasonVi: string | null;
  lastErrorVi: string | null;
  recoveryStatusVi: string | null;
  processedCount: number;
}

export interface EquityCurvePoint {
  cycleId: string;
  candleId: string;
  marketTime: string;
  systemTime: string;
  balanceUsd: number;
  equityUsd: number;
  drawdownPct: number;
  regime: MarketRegime;
  activePolicyId: string;
}

export interface SystemJournalEntry {
  entryId: string;
  timestampSystem: string;
  timestampMarket: string;
  cycleId: string;
  team: 'TEAM_1_EXECUTION' | 'TEAM_2_RESEARCH' | 'ORCHESTRATOR';
  level: 'INFO' | 'WARN' | 'ERROR';
  eventCode: string;
  messageVi: string;
}

export interface QuantSystemState {
  schemaVersion: number;
  executionMode: ExecutionMode;
  symbol: 'XAUUSD';
  timeframe: 'M15';
  startedAtSystemTime: string;
  lastUpdatedSystemTime: string;
  lastProcessedMarketTime: string | null;
  replayCursorIndex: number;
  totalReplayCandles: number;
  isReplayComplete: boolean;
  isLoopRunning: boolean;
  replayIntervalMs: number;
  restartCount: number;
  lastRestartRecoveredAtSystemTime: string | null;

  // Account metrics
  initialBalanceUsd: number;
  balanceUsd: number;
  equityUsd: number;
  highWaterMarkEquityUsd: number;
  currentDrawdownPct: number;
  maxDrawdownPct: number;

  // Idempotency registries
  processedCandleIds: string[];
  processedSignalIds: string[];
  processedExecutionIds: string[];

  // Immutable risk limits
  riskLimits: RiskLimitsConfig;

  // Policies
  activePolicyId: string;
  baselinePolicyId: string;
  policies: PolicyVersionRecord[];

  // Positions, reconciliations, shadow sims, learning runs, traces
  openPositions: SimulatedPosition[];
  closedPositions: SimulatedPosition[];
  rejectedOrExpiredOrders: SimulatedPosition[];
  reconciliations: ReconciliationRecord[];
  shadowOutcomes: ShadowCandidateOutcome[];
  openShadowPositions?: Record<string, SimulatedPosition>;
  learningRuns: LearningRunRecord[];
  cycleTraces: CycleTraceRecord[];
  equityCurve: EquityCurvePoint[];
  journal: SystemJournalEntry[];

  // Two-team coordination status
  teamExecutionStatus: TeamAgentStatus;
  teamResearchStatus: TeamAgentStatus;
}
