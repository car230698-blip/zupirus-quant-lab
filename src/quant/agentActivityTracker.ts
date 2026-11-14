import type {
  CycleTraceRecord,
  LearningRunRecord,
  QuantSystemState,
  ReconciliationRecord,
  SimulatedPosition,
  SystemJournalEntry,
} from './types.ts';

export type AgentOperationalStateCode =
  | 'PROCESSING'
  | 'WAITING_FOR_CANDLE'
  | 'MARKET_CLOSED'
  | 'SOURCE_DISCONNECTED'
  | 'INSUFFICIENT_SAMPLES'
  | 'RISK_VETOED'
  | 'HALTED_BY_LEARNER'
  | 'COMPLETED';

export const AGENT_OPERATIONAL_STATE_LABELS_VI: Record<AgentOperationalStateCode, string> = {
  PROCESSING: 'Đang xử lý',
  WAITING_FOR_CANDLE: 'Chờ nến',
  MARKET_CLOSED: 'Thị trường đóng',
  SOURCE_DISCONNECTED: 'Mất nguồn',
  INSUFFICIENT_SAMPLES: 'Thiếu mẫu',
  RISK_VETOED: 'Bị chặn rủi ro',
  HALTED_BY_LEARNER: 'Dừng mở vị thế',
  COMPLETED: 'Đã hoàn tất',
};

export interface PipelineStepState {
  stepIndex: number;
  stepId: string;
  labelVi: string;
  status: 'COMPLETED' | 'ACTIVE' | 'WAITING' | 'VETOED_OR_HALTED' | 'IDLE';
  detailVi: string;
  timestampMarket: string | null;
}

export interface EnrichedTeamActivityCard {
  teamId: 'TEAM_ANALYSIS_EXECUTION' | 'TEAM_RESEARCH_VALIDATION';
  teamCode: 'TEAM_1_EXECUTION' | 'TEAM_2_RESEARCH';
  teamNameVi: string;
  operationalState: AgentOperationalStateCode;
  operationalStateLabelVi: string;
  isProcessingNow: boolean;
  currentTaskVi: string;
  lastCompletedTaskVi: string;
  lastRunMarketTime: string | null;
  lastRunSystemTime: string | null;
  latestOutcomeVi: string;
  waitOrHaltReasonVi: string | null;
  processedCount: number;
  pipelineSteps: PipelineStepState[];
}

export interface EnrichedTimelineEvent {
  entryId: string;
  timestampSystem: string;
  timestampMarket: string;
  cycleId: string;
  team: 'TEAM_1_EXECUTION' | 'TEAM_2_RESEARCH' | 'ORCHESTRATOR';
  teamLabelVi: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  eventCode: string;
  operationalState: AgentOperationalStateCode;
  operationalStateLabelVi: string;
  taskTitleVi: string;
  messageVi: string;
  strategyVersion: string | null;
  linkedPositionId: string | null;
  linkedReconciliationId: string | null;
  linkedLearningRunId: string | null;
}

export interface TimelineEventInspectionDetail {
  event: EnrichedTimelineEvent;
  cycleTrace: CycleTraceRecord | null;
  linkedPosition: SimulatedPosition | null;
  linkedReconciliation: ReconciliationRecord | null;
  linkedLearningRun: LearningRunRecord | null;
}

export type DataProvenanceBadgeCode =
  | 'REPLAY_DATASET'
  | 'FIXTURE_VERIFICATION'
  | 'MT5_DEMO_LIVE';

export interface DataProvenanceBadge {
  code: DataProvenanceBadgeCode;
  labelVi: string;
  descriptionVi: string;
}

export interface AgentActivitySnapshot {
  generatedAtSystemTime: string;
  executionMode: 'SIMULATION_ONLY';
  dataProvenance: DataProvenanceBadge;
  team1Execution: EnrichedTeamActivityCard;
  team2Research: EnrichedTeamActivityCard;
  timeline: EnrichedTimelineEvent[];
  availableCycleIds: string[];
}

export function resolveDataProvenance(state: QuantSystemState): DataProvenanceBadge {
  const sourceMode = state.dataSourceTelemetry?.sourceMode;
  if (sourceMode === 'MT5_DEMO_LIVE') {
    return {
      code: 'MT5_DEMO_LIVE',
      labelVi: 'Báo giá MT5 Demo Trực tiếp',
      descriptionVi: `Thu báo giá Bid/Ask trực tiếp từ MT5 Demo (${state.dataSourceTelemetry?.collectorId ?? 'Collector'}) — khớp lệnh SIMULATION_ONLY.`,
    };
  }
  return {
    code: 'REPLAY_DATASET',
    labelVi: state.replayMode === 'TICK' ? 'Dữ liệu Replay Tick XAUUSD' : 'Dữ liệu Replay Nến M15 XAUUSD',
    descriptionVi: `Bộ dữ liệu phát lại xác định (${state.replayDatasetId ?? 'XAUUSD_M15'}) phục vụ kiểm định ngoại tuyến — khớp lệnh SIMULATION_ONLY.`,
  };
}

export function deriveTeam1OperationalState(
  state: QuantSystemState,
  isProcessingCycleNow: boolean
): AgentOperationalStateCode {
  if (isProcessingCycleNow) {
    return 'PROCESSING';
  }

  const telemetry = state.dataSourceTelemetry;
  if (telemetry?.sourceMode === 'MT5_DEMO_LIVE') {
    if (telemetry.connectionState === 'MARKET_CLOSED') {
      return 'MARKET_CLOSED';
    }
    if (telemetry.connectionState === 'DISCONNECTED') {
      return 'SOURCE_DISCONNECTED';
    }
  }

  if (state.lastScheduleEvaluation?.sessionState === 'MARKET_CLOSED') {
    return 'MARKET_CLOSED';
  }

  const latestCycle = state.cycleTraces[state.cycleTraces.length - 1];
  if (latestCycle?.riskDecision?.vetoed) {
    return 'RISK_VETOED';
  }

  if (state.isReplayComplete && telemetry?.sourceMode !== 'MT5_DEMO_LIVE') {
    return 'COMPLETED';
  }

  if (state.cycleTraces.length === 0) {
    return 'WAITING_FOR_CANDLE';
  }

  return state.isLoopRunning || telemetry?.sourceMode === 'MT5_DEMO_LIVE'
    ? 'WAITING_FOR_CANDLE'
    : 'COMPLETED';
}

export function deriveTeam2OperationalState(
  state: QuantSystemState,
  isProcessingCycleNow: boolean
): AgentOperationalStateCode {
  if (isProcessingCycleNow) {
    return 'PROCESSING';
  }

  if (state.riskLimits.haltNewPositionsByLearner) {
    return 'HALTED_BY_LEARNER';
  }

  const latestRun = state.learningRuns[state.learningRuns.length - 1];
  if (!latestRun) {
    return 'INSUFFICIENT_SAMPLES';
  }

  if (latestRun.decision === 'KEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES') {
    return 'INSUFFICIENT_SAMPLES';
  }

  if (latestRun.decision === 'HALT_NEW_POSITIONS_DEGRADED') {
    return 'HALTED_BY_LEARNER';
  }

  return 'COMPLETED';
}

export function buildTeam1PipelineSteps(
  state: QuantSystemState,
  opState: AgentOperationalStateCode
): PipelineStepState[] {
  const latestCycle = state.cycleTraces[state.cycleTraces.length - 1] ?? null;
  const telemetry = state.dataSourceTelemetry;
  const marketTime = latestCycle?.candle.closeTime ?? state.lastProcessedMarketTime;

  const hasQuotes = Boolean(
    telemetry && (telemetry.totalValidTicksAccepted > 0 || state.cycleTraces.length > 0)
  );
  const candleClosed = Boolean(latestCycle?.validation.valid);
  const regimeDetected = Boolean(latestCycle?.regimeClassification);
  const strategyEvaluated = Boolean(latestCycle?.coordinatorDecision);
  const riskChecked = Boolean(latestCycle?.riskDecision);
  const riskVetoed = Boolean(latestCycle?.riskDecision?.vetoed);
  const simFilled = Boolean(latestCycle?.openedPositionId);
  const posManaged = Boolean(
    latestCycle && (state.openPositions.length > 0 || latestCycle.closedPositionIds.length > 0)
  );
  const reconciled = Boolean(latestCycle && latestCycle.reconciliationIds.length > 0);

  return [
    {
      stepIndex: 1,
      stepId: 'RECEIVE_QUOTES',
      labelVi: 'Nhận báo giá',
      status:
        opState === 'SOURCE_DISCONNECTED'
          ? 'VETOED_OR_HALTED'
          : opState === 'MARKET_CLOSED'
          ? 'WAITING'
          : hasQuotes
          ? 'COMPLETED'
          : 'WAITING',
      detailVi:
        telemetry?.sourceMode === 'MT5_DEMO_LIVE'
          ? `Đã nhận ${telemetry.totalValidTicksAccepted} tick hợp lệ (${telemetry.connectionLabelVi})`
          : `Nguồn phát lại (${state.replayCursorIndex}/${state.totalReplayCandles} nến)`,
      timestampMarket: telemetry?.lastQuoteMarketTime ?? marketTime,
    },
    {
      stepIndex: 2,
      stepId: 'CLOSE_CANDLE',
      labelVi: 'Đóng nến M15',
      status: candleClosed ? 'COMPLETED' : 'WAITING',
      detailVi: latestCycle
        ? `${latestCycle.candle.candleId} đóng tại ${latestCycle.candle.close.toFixed(2)}`
        : 'Chưa có nến M15 hoàn tất',
      timestampMarket: marketTime,
    },
    {
      stepIndex: 3,
      stepId: 'DETECT_REGIME',
      labelVi: 'Nhận diện trạng thái',
      status: regimeDetected ? 'COMPLETED' : 'WAITING',
      detailVi: latestCycle?.regimeClassification
        ? `${latestCycle.regimeClassification.regimeLabelVi} (${(latestCycle.regimeClassification.confidence * 100).toFixed(0)}%)`
        : 'Chờ nến đóng để phân loại',
      timestampMarket: marketTime,
    },
    {
      stepIndex: 4,
      stepId: 'EVALUATE_STRATEGY',
      labelVi: 'Xét chiến lược',
      status: strategyEvaluated ? 'COMPLETED' : 'WAITING',
      detailVi: latestCycle?.coordinatorDecision
        ? latestCycle.coordinatorDecision.action === 'SELECT_STRATEGY'
          ? `Chọn ${latestCycle.coordinatorDecision.selectedStrategyId} (${latestCycle.coordinatorDecision.selectedStrategyVersion})`
          : `Đứng ngoài: ${latestCycle.coordinatorDecision.reasonVi}`
        : 'Chưa xét ứng viên',
      timestampMarket: marketTime,
    },
    {
      stepIndex: 5,
      stepId: 'RISK_GATE',
      labelVi: 'Chốt rủi ro',
      status: riskVetoed ? 'VETOED_OR_HALTED' : riskChecked ? 'COMPLETED' : 'WAITING',
      detailVi: latestCycle?.riskDecision
        ? latestCycle.riskDecision.approved
          ? `Duyệt ${latestCycle.riskDecision.approvedLots.toFixed(2)} lot`
          : `Phủ quyết (${latestCycle.riskDecision.vetoCode}): ${latestCycle.riskDecision.reasonVi}`
        : latestCycle?.coordinatorDecision?.action === 'STAND_ASIDE'
        ? 'Không phát sinh lệnh cần duyệt'
        : 'Chờ tín hiệu chiến lược',
      timestampMarket: marketTime,
    },
    {
      stepIndex: 6,
      stepId: 'SIM_EXECUTION',
      labelVi: 'Khớp mô phỏng',
      status: simFilled ? 'COMPLETED' : riskVetoed ? 'VETOED_OR_HALTED' : 'IDLE',
      detailVi: latestCycle?.openedPositionId
        ? `Khớp vị thế ${latestCycle.openedPositionId} (SIMULATION_ONLY)`
        : 'Không mở vị thế mới ở chu kỳ này',
      timestampMarket: marketTime,
    },
    {
      stepIndex: 7,
      stepId: 'MANAGE_POSITIONS',
      labelVi: 'Quản lý vị thế',
      status: posManaged ? 'COMPLETED' : 'IDLE',
      detailVi: `Đang mở: ${state.openPositions.length} | Đóng ở chu kỳ cuối: ${latestCycle?.closedPositionIds.length ?? 0}`,
      timestampMarket: marketTime,
    },
    {
      stepIndex: 8,
      stepId: 'RECONCILIATION',
      labelVi: 'Đối soát lệnh',
      status: reconciled || state.reconciliations.length > 0 ? 'COMPLETED' : 'IDLE',
      detailVi: `Tổng bản ghi đối soát khớp 100%: ${state.reconciliations.length}`,
      timestampMarket: marketTime,
    },
  ];
}

export function buildTeam2PipelineSteps(
  state: QuantSystemState,
  opState: AgentOperationalStateCode
): PipelineStepState[] {
  const latestRun = state.learningRuns[state.learningRuns.length - 1] ?? null;
  const closedShadows = state.shadowOutcomes.filter((s) => s.status === 'CLOSED_RECONCILED');
  const openShadowsCount = Object.keys(state.openShadowPositions ?? {}).length;

  return [
    {
      stepIndex: 1,
      stepId: 'SHADOW_SIMULATION',
      labelVi: 'Chạy ứng viên song song',
      status: state.shadowOutcomes.length > 0 || openShadowsCount > 0 ? 'COMPLETED' : 'WAITING',
      detailVi: `Đang theo dõi ${openShadowsCount} vị thế shadow mở | Tổng mẫu: ${state.shadowOutcomes.length}`,
      timestampMarket: state.lastProcessedMarketTime,
    },
    {
      stepIndex: 2,
      stepId: 'COLLECT_CLOSED_OUTCOMES',
      labelVi: 'Thu kết quả đã đóng',
      status: closedShadows.length > 0 ? 'COMPLETED' : 'WAITING',
      detailVi: `${closedShadows.length} mẫu ứng viên đã đóng & đối soát hoàn chỉnh`,
      timestampMarket: latestRun?.executedAtMarketTime ?? state.lastProcessedMarketTime,
    },
    {
      stepIndex: 3,
      stepId: 'WALK_FORWARD_CHECK',
      labelVi: 'Kiểm định Walk-Forward',
      status: latestRun ? 'COMPLETED' : 'WAITING',
      detailVi: latestRun
        ? `${latestRun.runId}: Dùng ${latestRun.totalCompletedSamplesUsed} mẫu, loại ${latestRun.totalExcludedSamples} mẫu chồng lấp`
        : 'Chờ đủ chu kỳ kiểm định Walk-Forward',
      timestampMarket: latestRun?.executedAtMarketTime ?? null,
    },
    {
      stepIndex: 4,
      stepId: 'OOS_AND_COST_EVAL',
      labelVi: 'Đánh giá ngoài mẫu & chi phí',
      status: latestRun
        ? opState === 'INSUFFICIENT_SAMPLES'
          ? 'WAITING'
          : 'COMPLETED'
        : 'WAITING',
      detailVi: latestRun
        ? `P&L ròng 1x: $${latestRun.overallAdaptiveMetrics.netPnlAfterCostUsd.toFixed(2)} | 2x: $${latestRun.overallAdaptiveMetrics.netPnlAt2xCostUsd.toFixed(2)}`
        : 'Chưa có đợt đánh giá ngoài mẫu',
      timestampMarket: latestRun?.executedAtMarketTime ?? null,
    },
    {
      stepIndex: 5,
      stepId: 'POLICY_DECISION',
      labelVi: 'Quyết định chính sách',
      status:
        opState === 'HALTED_BY_LEARNER'
          ? 'VETOED_OR_HALTED'
          : latestRun
          ? 'COMPLETED'
          : 'WAITING',
      detailVi: latestRun
        ? `${latestRun.decision}: Chính sách ${latestRun.resultingPolicyId}`
        : `Đang giữ chính sách gốc ${state.activePolicyId}`,
      timestampMarket: latestRun?.executedAtMarketTime ?? null,
    },
  ];
}

export function classifyJournalEntryState(
  entry: SystemJournalEntry,
  cycleTrace?: CycleTraceRecord
): { stateCode: AgentOperationalStateCode; taskTitleVi: string } {
  const code = entry.eventCode;
  if (code.includes('RESTART') || code.includes('RECOVER')) {
    return { stateCode: 'COMPLETED', taskTitleVi: 'Khôi phục trạng thái hệ thống' };
  }
  if (code.includes('MARKET_CLOSED')) {
    return { stateCode: 'MARKET_CLOSED', taskTitleVi: 'Kiểm tra lịch phiên thị trường' };
  }
  if (code.includes('DISCONNECTED') || code.includes('STALE') || code.includes('GAP')) {
    return { stateCode: 'SOURCE_DISCONNECTED', taskTitleVi: 'Cảnh báo nguồn dữ liệu / mất đoạn' };
  }
  if (
    code.includes('VETO') ||
    code.includes('CUTOFF') ||
    code.includes('KILL_SWITCH') ||
    (entry.team === 'TEAM_1_EXECUTION' && cycleTrace?.riskDecision?.vetoed)
  ) {
    return { stateCode: 'RISK_VETOED', taskTitleVi: 'Bị chặn rủi ro / Đóng bắt buộc trước giờ nghỉ' };
  }
  if (code.includes('INSUFFICIENT_SAMPLES')) {
    return { stateCode: 'INSUFFICIENT_SAMPLES', taskTitleVi: 'Kiểm định Walk-Forward (Thiếu mẫu)' };
  }
  if (code.includes('HALT')) {
    return { stateCode: 'HALTED_BY_LEARNER', taskTitleVi: 'Dừng mở vị thế mới do suy giảm' };
  }
  if (code.includes('WAIT') || code.includes('STAND_ASIDE')) {
    return { stateCode: 'WAITING_FOR_CANDLE', taskTitleVi: 'Đứng ngoài / Chờ nến kế tiếp' };
  }
  if (code.includes('WALK_FORWARD') || code.includes('POLICY') || entry.team === 'TEAM_2_RESEARCH') {
    return { stateCode: 'COMPLETED', taskTitleVi: 'Kiểm định Walk-Forward & Chính sách' };
  }
  if (code.includes('RECONCIL')) {
    return { stateCode: 'COMPLETED', taskTitleVi: 'Đối soát vị thế đã đóng' };
  }
  if (
    code.includes('POSITION') ||
    code.includes('ENTRY') ||
    code.includes('CLOSE') ||
    code.includes('DEAL')
  ) {
    return { stateCode: 'COMPLETED', taskTitleVi: 'Khớp lệnh & Quản lý vị thế mô phỏng' };
  }
  return { stateCode: 'COMPLETED', taskTitleVi: 'Xử lý chu kỳ định lượng' };
}

const DECISION_SUMMARY_VI: Record<string, string> = {
  KEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES: 'Giữ nguyên chính sách hiện hành (chưa đủ mẫu)',
  KEEP_CURRENT_POLICY_NO_OUTPERFORMANCE: 'Giữ nguyên chính sách hiện hành (ứng viên chưa vượt trội ngoài mẫu)',
  PROMOTE_NEW_POLICY: 'Kích hoạt chính sách mới sau kiểm định',
  ROLLBACK_TO_PREVIOUS_POLICY: 'Quay lui về chính sách an toàn trước đó',
  HALT_NEW_POSITIONS_DEGRADED: 'Tạm dừng mở vị thế mới do hiệu suất suy giảm',
};

export function buildAgentActivitySnapshot(
  state: QuantSystemState,
  isProcessingCycleNow = false
): AgentActivitySnapshot {
  const team1OpState = deriveTeam1OperationalState(state, isProcessingCycleNow);
  const team2OpState = deriveTeam2OperationalState(state, isProcessingCycleNow);

  const cycleById = new Map<string, CycleTraceRecord>();
  for (const c of state.cycleTraces) {
    cycleById.set(c.cycleId, c);
  }

  const latestCycle = state.cycleTraces[state.cycleTraces.length - 1] ?? null;
  const latestRun = state.learningRuns[state.learningRuns.length - 1] ?? null;

  const team1WaitReason =
    team1OpState === 'MARKET_CLOSED'
      ? state.dataSourceTelemetry?.connectionLabelVi ??
        'Thị trường đang đóng cửa theo lịch phiên.'
      : team1OpState === 'SOURCE_DISCONNECTED'
      ? state.dataSourceTelemetry?.connectionLabelVi ??
        'Mất kết nối hoặc đang chờ báo giá mới từ nguồn.'
      : team1OpState === 'RISK_VETOED'
      ? latestCycle?.riskDecision?.reasonVi ?? 'Tín hiệu bị chặn bởi giới hạn rủi ro.'
      : team1OpState === 'WAITING_FOR_CANDLE'
      ? state.teamExecutionStatus.waitStateReasonVi ??
        'Đang chờ nến M15 tiếp theo đóng hoàn toàn.'
      : null;

  const team2WaitReason =
    team2OpState === 'HALTED_BY_LEARNER'
      ? latestRun?.decisionReasonVi ?? 'Đã tạm dừng mở vị thế mới do hiệu quả suy giảm.'
      : team2OpState === 'INSUFFICIENT_SAMPLES'
      ? latestRun?.decisionReasonVi ??
        'Chưa đủ mẫu đã đóng & đối soát theo từng trạng thái (yêu cầu tối thiểu ≥ 5 mẫu/trạng thái).'
      : state.teamResearchStatus.waitStateReasonVi;

  const selectedStrategyName =
    latestCycle?.coordinatorDecision?.selectedCandidate?.strategyNameVi ??
    'chiến lược phù hợp';

  const team1Card: EnrichedTeamActivityCard = {
    teamId: 'TEAM_ANALYSIS_EXECUTION',
    teamCode: 'TEAM_1_EXECUTION',
    teamNameVi: 'Đội 1 — Phân tích & Thực thi',
    operationalState: team1OpState,
    operationalStateLabelVi: AGENT_OPERATIONAL_STATE_LABELS_VI[team1OpState],
    isProcessingNow: team1OpState === 'PROCESSING',
    currentTaskVi:
      team1OpState === 'PROCESSING'
        ? state.teamExecutionStatus.currentTaskVi
        : state.cycleTraces.length === 0
        ? 'Chờ nến M15 hoàn tất đầu tiên từ nguồn dữ liệu'
        : state.teamExecutionStatus.currentTaskVi,
    lastCompletedTaskVi:
      state.cycleTraces.length === 0
        ? 'Chưa có chu kỳ hoàn tất'
        : state.teamExecutionStatus.lastCompletedTaskVi,
    lastRunMarketTime: state.teamExecutionStatus.lastCompletedMarketTime,
    lastRunSystemTime: state.teamExecutionStatus.lastCompletedSystemTime,
    latestOutcomeVi: latestCycle
      ? latestCycle.openedPositionId
        ? `Đã mở vị thế mô phỏng mới theo ${selectedStrategyName}`
        : latestCycle.riskDecision?.vetoed
        ? `Tín hiệu bị chặn bởi bộ kiểm soát rủi ro (${latestCycle.riskDecision.reasonVi})`
        : latestCycle.coordinatorDecision?.reasonVi ?? 'Hoàn tất kiểm tra nến và đối soát danh mục'
      : 'Chưa phát sinh giao dịch trong phiên',
    waitOrHaltReasonVi: team1WaitReason,
    processedCount: state.teamExecutionStatus.processedCount,
    pipelineSteps: buildTeam1PipelineSteps(state, team1OpState),
  };

  const team2Card: EnrichedTeamActivityCard = {
    teamId: 'TEAM_RESEARCH_VALIDATION',
    teamCode: 'TEAM_2_RESEARCH',
    teamNameVi: 'Đội 2 — Nghiên cứu & Kiểm định',
    operationalState: team2OpState,
    operationalStateLabelVi: AGENT_OPERATIONAL_STATE_LABELS_VI[team2OpState],
    isProcessingNow: team2OpState === 'PROCESSING',
    currentTaskVi:
      team2OpState === 'PROCESSING'
        ? state.teamResearchStatus.currentTaskVi
        : state.learningRuns.length === 0 && state.shadowOutcomes.length === 0
        ? 'Chờ thu thập kết quả giao dịch song song để kiểm định'
        : state.teamResearchStatus.currentTaskVi,
    lastCompletedTaskVi:
      state.learningRuns.length === 0 && state.shadowOutcomes.length === 0
        ? 'Chưa có đợt kiểm định'
        : state.teamResearchStatus.lastCompletedTaskVi,
    lastRunMarketTime: state.teamResearchStatus.lastCompletedMarketTime,
    lastRunSystemTime: state.teamResearchStatus.lastCompletedSystemTime,
    latestOutcomeVi: latestRun
      ? `${DECISION_SUMMARY_VI[latestRun.decision] ?? latestRun.decisionReasonVi}`
      : state.shadowOutcomes.length > 0
      ? `Đã thu thập ${state.shadowOutcomes.filter((s) => s.status === 'CLOSED_RECONCILED').length} mẫu đã đóng; đang tích lũy cho đợt kiểm định tiếp theo.`
      : 'Chưa có đợt kiểm định hoàn tất',
    waitOrHaltReasonVi: team2WaitReason,
    processedCount: state.teamResearchStatus.processedCount,
    pipelineSteps: buildTeam2PipelineSteps(state, team2OpState),
  };

  const timeline: EnrichedTimelineEvent[] = state.journal
    .slice()
    .reverse()
    .map((entry) => {
      const cycleTrace = cycleById.get(entry.cycleId);
      const { stateCode, taskTitleVi } = classifyJournalEntryState(entry, cycleTrace);
      const strategyVersion = cycleTrace?.coordinatorDecision?.selectedStrategyId
        ? `${cycleTrace.coordinatorDecision.selectedStrategyId}@${
            cycleTrace.coordinatorDecision.selectedStrategyVersion ??
            cycleTrace.coordinatorDecision.activePolicyId
          }`
        : null;

      const linkedPositionId =
        cycleTrace?.openedPositionId ?? cycleTrace?.closedPositionIds[0] ?? null;

      const linkedReconciliationId = cycleTrace?.reconciliationIds[0] ?? null;

      const linkedLearningRunId =
        cycleTrace?.learningRunId ??
        (entry.team === 'TEAM_2_RESEARCH' && latestRun?.triggerCycleId === entry.cycleId
          ? latestRun.runId
          : null);

      return {
        entryId: entry.entryId,
        timestampSystem: entry.timestampSystem,
        timestampMarket: entry.timestampMarket,
        cycleId: entry.cycleId,
        team: entry.team,
        teamLabelVi:
          entry.team === 'TEAM_1_EXECUTION'
            ? 'Đội Phân tích & Thực thi'
            : entry.team === 'TEAM_2_RESEARCH'
            ? 'Đội Nghiên cứu & Kiểm định'
            : 'Bộ điều phối Hệ thống',
        level: entry.level,
        eventCode: entry.eventCode,
        operationalState: stateCode,
        operationalStateLabelVi: AGENT_OPERATIONAL_STATE_LABELS_VI[stateCode],
        taskTitleVi,
        messageVi: entry.messageVi,
        strategyVersion,
        linkedPositionId,
        linkedReconciliationId,
        linkedLearningRunId,
      };
    });

  const availableCycleIds = Array.from(
    new Set(state.cycleTraces.map((c) => c.cycleId).reverse())
  );

  return {
    generatedAtSystemTime: new Date().toISOString(),
    executionMode: 'SIMULATION_ONLY',
    dataProvenance: resolveDataProvenance(state),
    team1Execution: team1Card,
    team2Research: team2Card,
    timeline,
    availableCycleIds,
  };
}

export function inspectTimelineEvent(
  state: QuantSystemState,
  entryId: string
): TimelineEventInspectionDetail | null {
  const snapshot = buildAgentActivitySnapshot(state, false);
  const event = snapshot.timeline.find((e) => e.entryId === entryId);
  if (!event) return null;

  const cycleTrace =
    state.cycleTraces.find((c) => c.cycleId === event.cycleId) ?? null;

  const allPositions = [
    ...state.openPositions,
    ...state.closedPositions,
    ...state.rejectedOrExpiredOrders,
  ];
  const linkedPosition = event.linkedPositionId
    ? allPositions.find((p) => p.positionId === event.linkedPositionId) ?? null
    : null;

  const linkedReconciliation = event.linkedReconciliationId
    ? state.reconciliations.find((r) => r.reconciliationId === event.linkedReconciliationId) ??
      null
    : linkedPosition
    ? state.reconciliations.find((r) => r.positionId === linkedPosition.positionId) ?? null
    : null;

  const linkedLearningRun = event.linkedLearningRunId
    ? state.learningRuns.find((lr) => lr.runId === event.linkedLearningRunId) ?? null
    : state.learningRuns.find((lr) => lr.triggerCycleId === event.cycleId) ?? null;

  return {
    event,
    cycleTrace,
    linkedPosition,
    linkedReconciliation,
    linkedLearningRun,
  };
}
