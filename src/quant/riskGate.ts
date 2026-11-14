import type { ReplayQuote } from './tickReplay.ts';
import {
  BrokerSessionScheduleConfig,
  evaluateMarketSchedule,
  MarketScheduleEvaluation,
} from './marketSchedule.ts';
import {
  COMMISSION_PER_LOT_SIDE_USD,
  CONTRACT_SIZE_OZ,
  computeDeterministicSlippagePts,
} from './simBroker.ts';
import {
  M15Candle,
  RiskDecision,
  RiskLimitsConfig,
  SimulatedPosition,
  SlOvershootP95Summary,
  StrategyCandidateEvaluation,
} from './types.ts';

export const RISK_MODEL_VERSION = 'RISK_BUDGET_1PCT_P95_SL_V1.2';
export const SL_OVERSHOOT_MODEL_VERSION = 'SL_BUFFER_P95_V1.0';
export const SL_OVERSHOOT_FALLBACK_USD_PER_OZ = 0.10;
export const SL_OVERSHOOT_MIN_SAMPLES = 10;
export const SL_OVERSHOOT_MAX_WINDOW = 50;

/**
 * Immutable hard risk limits enforced by the Risk Gate.
 * The Research & Learning Team is strictly forbidden from mutating these limits.
 */
export const DEFAULT_IMMUTABLE_RISK_LIMITS: Readonly<RiskLimitsConfig> = Object.freeze({
  maxOpenPositions: 2,
  maxVolumeLotsPerTrade: 1.0,
  maxTotalExposureLots: 2.0,
  maxDailyDrawdownPct: 4.0,
  maxTotalDrawdownPct: 8.0,
  maxSpreadPtsAllowed: 40,
  defaultRiskPerTradePct: 1.0,
  killSwitchActive: false,
  haltNewPositionsByLearner: false,
});

export function cloneRiskLimits(
  overrides?: Partial<Pick<RiskLimitsConfig, 'killSwitchActive' | 'haltNewPositionsByLearner'>>
): RiskLimitsConfig {
  return {
    ...DEFAULT_IMMUTABLE_RISK_LIMITS,
    killSwitchActive: overrides?.killSwitchActive ?? DEFAULT_IMMUTABLE_RISK_LIMITS.killSwitchActive,
    haltNewPositionsByLearner:
      overrides?.haltNewPositionsByLearner ??
      DEFAULT_IMMUTABLE_RISK_LIMITS.haltNewPositionsByLearner,
  };
}

/**
 * Guard ensuring the Learner cannot alter core risk thresholds (positions, volume, drawdown, spread).
 */
export function guardLearnerCannotModifyRiskLimits(
  before: RiskLimitsConfig,
  after: RiskLimitsConfig
): void {
  if (
    before.maxOpenPositions !== after.maxOpenPositions ||
    before.maxVolumeLotsPerTrade !== after.maxVolumeLotsPerTrade ||
    before.maxTotalExposureLots !== after.maxTotalExposureLots ||
    before.maxDailyDrawdownPct !== after.maxDailyDrawdownPct ||
    before.maxTotalDrawdownPct !== after.maxTotalDrawdownPct ||
    before.maxSpreadPtsAllowed !== after.maxSpreadPtsAllowed ||
    before.defaultRiskPerTradePct !== after.defaultRiskPerTradePct
  ) {
    throw new Error(
      'VIOLATION_RISK_GOVERNANCE: Bộ học không có quyền sửa đổi các giới hạn rủi ro cốt lõi.'
    );
  }
}

/**
 * Computes the SL Overshoot Buffer (USD/oz) using the 95th percentile (P95)
 * of up to the 50 most recent SL exits. Uses 0.10 USD/oz fallback when < 10 SL samples exist.
 */
export function computeSlOvershootP95Buffer(
  closedPositions: readonly SimulatedPosition[] = []
): SlOvershootP95Summary {
  const slExitReasons = new Set([
    'STOP_LOSS_HIT',
    'SL_AFTER_PARTIAL_TP1',
    'INTRA_BAR_SL_TP_CONFLICT_SL_FIRST',
  ]);

  const slTrades = closedPositions
    .filter((pos) => slExitReasons.has(pos.exitReason))
    .slice(-SL_OVERSHOOT_MAX_WINDOW);

  const overshoots: number[] = slTrades.map((pos) => {
    if (
      typeof pos.slOvershootUsdPerOz === 'number' &&
      Number.isFinite(pos.slOvershootUsdPerOz) &&
      pos.slOvershootUsdPerOz >= 0
    ) {
      return pos.slOvershootUsdPerOz;
    }
    const sign = pos.direction === 'BUY' ? 1 : -1;
    const activeSlAtExit = pos.partialTp1Hit
      ? pos.fillEntryPrice
      : pos.managementRulesSnapshot?.stopLoss ?? pos.stopLoss;
    const exitFill = pos.avgExitFillPrice ?? pos.expectedExitPrice ?? activeSlAtExit;
    return Number(Math.max(0, (activeSlAtExit - exitFill) * sign).toFixed(4));
  });

  const sampleCount = overshoots.length;
  const samplePositionIds = slTrades.map((p) => p.positionId);

  if (sampleCount < SL_OVERSHOOT_MIN_SAMPLES) {
    return {
      modelVersion: SL_OVERSHOOT_MODEL_VERSION,
      sampleCount,
      maxWindowSize: SL_OVERSHOOT_MAX_WINDOW,
      minSamplesRequired: SL_OVERSHOOT_MIN_SAMPLES,
      usedFallbackDefault: true,
      fallbackDefaultUsdPerOz: SL_OVERSHOOT_FALLBACK_USD_PER_OZ,
      computedP95UsdPerOz: null,
      effectiveBufferUsdPerOz: SL_OVERSHOOT_FALLBACK_USD_PER_OZ,
      samplePositionIds,
    };
  }

  const sorted = [...overshoots].sort((a, b) => a - b);
  const p95Index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(0.95 * sorted.length) - 1)
  );
  const p95Val = Number(sorted[p95Index].toFixed(4));
  const effectiveBufferUsdPerOz = Number(Math.max(0.01, p95Val).toFixed(4));

  return {
    modelVersion: SL_OVERSHOOT_MODEL_VERSION,
    sampleCount,
    maxWindowSize: SL_OVERSHOOT_MAX_WINDOW,
    minSamplesRequired: SL_OVERSHOOT_MIN_SAMPLES,
    usedFallbackDefault: false,
    fallbackDefaultUsdPerOz: SL_OVERSHOOT_FALLBACK_USD_PER_OZ,
    computedP95UsdPerOz: p95Val,
    effectiveBufferUsdPerOz,
    samplePositionIds,
  };
}

/**
 * Evaluates a proposed entry candidate against hard risk limits, 15/15 broker session rules,
 * remaining drawdown budget, and P95 SL overshoot buffer.
 * Has unconditional veto power before any order reaches the Simulated Broker.
 */
export function evaluateRiskGate(params: {
  cycleId: string;
  candle: M15Candle;
  signalId: string;
  candidate: StrategyCandidateEvaluation;
  openPositions: SimulatedPosition[];
  closedPositions?: readonly SimulatedPosition[];
  currentDrawdownPct: number;
  dailyDrawdownPct: number;
  riskLimits: RiskLimitsConfig;
  requestedLots?: number;
  accountEquityUsd?: number;
  quote?: ReplayQuote;
  schedule?: BrokerSessionScheduleConfig;
  scheduleEvaluation?: MarketScheduleEvaluation;
  costMultiplier?: number;
  systemTime?: string;
}): RiskDecision {
  const {
    cycleId,
    candle,
    signalId,
    candidate,
    openPositions,
    closedPositions = [],
    currentDrawdownPct,
    dailyDrawdownPct,
    riskLimits,
    requestedLots = 0.5,
    accountEquityUsd,
    quote,
    schedule,
    scheduleEvaluation: passedScheduleEval,
    costMultiplier = 1,
    systemTime = new Date().toISOString(),
  } = params;

  const currentOpenCount = openPositions.length;
  const currentOpenLots = openPositions.reduce(
    (sum, p) => sum + p.remainingVolumeLots,
    0
  );

  const slOvershootBuffer = computeSlOvershootP95Buffer(closedPositions);
  const scheduleEvaluation =
    passedScheduleEval ??
    (schedule ? evaluateMarketSchedule(candle.closeTime, schedule) : undefined);

  const remainingDailyBudgetPct = Number(
    Math.max(0, riskLimits.maxDailyDrawdownPct - dailyDrawdownPct).toFixed(4)
  );
  const remainingTotalBudgetPct = Number(
    Math.max(0, riskLimits.maxTotalDrawdownPct - currentDrawdownPct).toFixed(4)
  );
  const effectiveRiskBudgetPct = Number(
    Math.min(
      riskLimits.defaultRiskPerTradePct,
      remainingDailyBudgetPct,
      remainingTotalBudgetPct
    ).toFixed(4)
  );
  const effectiveRiskBudgetUsd =
    accountEquityUsd !== undefined
      ? Number(((accountEquityUsd * effectiveRiskBudgetPct) / 100).toFixed(2))
      : undefined;

  const baseDecisionFields = {
    riskModelVersion: RISK_MODEL_VERSION,
    baseRiskBudgetPct: riskLimits.defaultRiskPerTradePct,
    remainingDailyDrawdownBudgetPct: remainingDailyBudgetPct,
    remainingTotalDrawdownBudgetPct: remainingTotalBudgetPct,
    effectiveRiskBudgetPct,
    effectiveRiskBudgetUsd,
    slOvershootBuffer,
    scheduleEvaluation,
  };

  // 1. Check Kill Switch (Trạng thái dừng khẩn cấp)
  if (riskLimits.killSwitchActive) {
    return {
      cycleId,
      candleId: candle.candleId,
      signalId,
      marketTime: candle.closeTime,
      systemTime,
      approved: false,
      vetoed: true,
      requestedLots,
      approvedLots: 0,
      currentOpenPositions: currentOpenCount,
      currentDrawdownPct,
      dailyDrawdownPct,
      spreadPts: candle.spreadPts,
      limitsChecked: { ...riskLimits },
      ...baseDecisionFields,
      vetoCode: 'KILL_SWITCH_ACTIVE',
      reasonVi:
        'PHỦ QUYẾT RỦI RO: Công tắc dừng khẩn cấp (Kill Switch) đang kích hoạt. Từ chối mở vị thế mới.',
    };
  }

  // 2. Check Learner Degradation Halt (Ngừng mở vị thế khi không còn phiên bản phù hợp)
  if (riskLimits.haltNewPositionsByLearner) {
    return {
      cycleId,
      candleId: candle.candleId,
      signalId,
      marketTime: candle.closeTime,
      systemTime,
      approved: false,
      vetoed: true,
      requestedLots,
      approvedLots: 0,
      currentOpenPositions: currentOpenCount,
      currentDrawdownPct,
      dailyDrawdownPct,
      spreadPts: candle.spreadPts,
      limitsChecked: { ...riskLimits },
      ...baseDecisionFields,
      vetoCode: 'LEARNER_HALT_ACTIVE',
      reasonVi:
        'PHỦ QUYẾT RỦI RO: Chế độ tạm ngừng mở vị thế mới do hiệu suất suy giảm và không còn phiên bản chính sách dự phòng hợp lệ.',
    };
  }

  // 2b. Check Broker Session Schedule & 15/15 Cutoff Rules
  if (scheduleEvaluation && !scheduleEvaluation.allowNewEntries) {
    const vetoCode =
      scheduleEvaluation.sessionState === 'CLOSE_ONLY_15_15'
        ? 'FRIDAY_15_15_CUTOFF'
        : scheduleEvaluation.sessionState === 'MARKET_CLOSED'
        ? 'MARKET_CLOSED_SCHEDULE'
        : 'CLOSE_ONLY_SESSION';
    return {
      cycleId,
      candleId: candle.candleId,
      signalId,
      marketTime: candle.closeTime,
      systemTime,
      approved: false,
      vetoed: true,
      requestedLots,
      approvedLots: 0,
      currentOpenPositions: currentOpenCount,
      currentDrawdownPct,
      dailyDrawdownPct,
      spreadPts: candle.spreadPts,
      limitsChecked: { ...riskLimits },
      ...baseDecisionFields,
      vetoCode,
      reasonVi: `PHỦ QUYẾT RỦI RO (${vetoCode}): ${scheduleEvaluation.reasonVi}`,
    };
  }

  // 3. Check Total & Daily Drawdown Limits
  if (currentDrawdownPct >= riskLimits.maxTotalDrawdownPct) {
    return {
      cycleId,
      candleId: candle.candleId,
      signalId,
      marketTime: candle.closeTime,
      systemTime,
      approved: false,
      vetoed: true,
      requestedLots,
      approvedLots: 0,
      currentOpenPositions: currentOpenCount,
      currentDrawdownPct,
      dailyDrawdownPct,
      spreadPts: candle.spreadPts,
      limitsChecked: { ...riskLimits },
      ...baseDecisionFields,
      vetoCode: 'MAX_TOTAL_DRAWDOWN_EXCEEDED',
      reasonVi: `PHỦ QUYẾT RỦI RO: Sụt giảm tổng (${currentDrawdownPct.toFixed(
        2
      )}%) chạm hoặc vượt ngưỡng tối đa (${riskLimits.maxTotalDrawdownPct}%).`,
    };
  }

  if (dailyDrawdownPct >= riskLimits.maxDailyDrawdownPct) {
    return {
      cycleId,
      candleId: candle.candleId,
      signalId,
      marketTime: candle.closeTime,
      systemTime,
      approved: false,
      vetoed: true,
      requestedLots,
      approvedLots: 0,
      currentOpenPositions: currentOpenCount,
      currentDrawdownPct,
      dailyDrawdownPct,
      spreadPts: candle.spreadPts,
      limitsChecked: { ...riskLimits },
      ...baseDecisionFields,
      vetoCode: 'MAX_DAILY_DRAWDOWN_EXCEEDED',
      reasonVi: `PHỦ QUYẾT RỦI RO: Sụt giảm trong ngày (${dailyDrawdownPct.toFixed(
        2
      )}%) chạm hoặc vượt ngưỡng tối đa (${riskLimits.maxDailyDrawdownPct}%).`,
    };
  }

  // 4. Check Max Open Positions Limit
  if (currentOpenCount >= riskLimits.maxOpenPositions) {
    return {
      cycleId,
      candleId: candle.candleId,
      signalId,
      marketTime: candle.closeTime,
      systemTime,
      approved: false,
      vetoed: true,
      requestedLots,
      approvedLots: 0,
      currentOpenPositions: currentOpenCount,
      currentDrawdownPct,
      dailyDrawdownPct,
      spreadPts: candle.spreadPts,
      limitsChecked: { ...riskLimits },
      ...baseDecisionFields,
      vetoCode: 'MAX_OPEN_POSITIONS_EXCEEDED',
      reasonVi: `PHỦ QUYẾT RỦI RO: Số vị thế đang mở (${currentOpenCount}) đã đạt trần tối đa (${riskLimits.maxOpenPositions} vị thế).`,
    };
  }

  // 5. Check Volume per Trade & Total Exposure Lots
  if (
    requestedLots <= 0 ||
    requestedLots > riskLimits.maxVolumeLotsPerTrade ||
    currentOpenLots + requestedLots > riskLimits.maxTotalExposureLots
  ) {
    return {
      cycleId,
      candleId: candle.candleId,
      signalId,
      marketTime: candle.closeTime,
      systemTime,
      approved: false,
      vetoed: true,
      requestedLots,
      approvedLots: 0,
      currentOpenPositions: currentOpenCount,
      currentDrawdownPct,
      dailyDrawdownPct,
      spreadPts: candle.spreadPts,
      limitsChecked: { ...riskLimits },
      ...baseDecisionFields,
      vetoCode: 'MAX_VOLUME_EXCEEDED',
      reasonVi: `PHỦ QUYẾT RỦI RO: Khối lượng yêu cầu (${requestedLots} lot, tổng phơi nhiễm ${(
        currentOpenLots + requestedLots
      ).toFixed(2)} lot) vượt giới hạn (${riskLimits.maxVolumeLotsPerTrade} lot/lệnh, tối đa ${
        riskLimits.maxTotalExposureLots
      } lot).`,
    };
  }

  // 6. Check Spread Limit
  const effectiveSpreadPts = candle.spreadPts * costMultiplier;
  if (effectiveSpreadPts > riskLimits.maxSpreadPtsAllowed) {
    return {
      cycleId,
      candleId: candle.candleId,
      signalId,
      marketTime: candle.closeTime,
      systemTime,
      approved: false,
      vetoed: true,
      requestedLots,
      approvedLots: 0,
      currentOpenPositions: currentOpenCount,
      currentDrawdownPct,
      dailyDrawdownPct,
      spreadPts: effectiveSpreadPts,
      limitsChecked: { ...riskLimits },
      ...baseDecisionFields,
      vetoCode: 'EXCESSIVE_SPREAD',
      reasonVi: `PHỦ QUYẾT RỦI RO: Spread thị trường hiện tại (${effectiveSpreadPts} pts) vượt trần cho phép (${riskLimits.maxSpreadPtsAllowed} pts).`,
    };
  }

  // 7. Check valid SL/TP distance
  if (
    !candidate.entryPrice ||
    !candidate.stopLoss ||
    !candidate.takeProfit1 ||
    !candidate.takeProfit2 ||
    Math.abs(candidate.entryPrice - candidate.stopLoss) < 0.25
  ) {
    return {
      cycleId,
      candleId: candle.candleId,
      signalId,
      marketTime: candle.closeTime,
      systemTime,
      approved: false,
      vetoed: true,
      requestedLots,
      approvedLots: 0,
      currentOpenPositions: currentOpenCount,
      currentDrawdownPct,
      dailyDrawdownPct,
      spreadPts: candle.spreadPts,
      limitsChecked: { ...riskLimits },
      ...baseDecisionFields,
      vetoCode: 'INVALID_STOP_DISTANCE',
      reasonVi: 'PHỦ QUYẾT RỦI RO: Khoảng cách dừng lỗ (SL) hoặc chốt lời (TP) không hợp lệ.',
    };
  }

  // 8. Position Sizing with 1% Equity Risk Budget, Remaining Drawdown Cap, and P95 SL Overshoot Buffer
  const stopDistance = Math.abs(candidate.entryPrice - candidate.stopLoss);
  const bufferOz = slOvershootBuffer.effectiveBufferUsdPerOz;
  const costPerLot =
    CONTRACT_SIZE_OZ *
      (stopDistance +
        candle.spreadPts * 0.01 * costMultiplier +
        2 * computeDeterministicSlippagePts(candle) * 0.01 * costMultiplier +
        bufferOz) +
    2 * COMMISSION_PER_LOT_SIDE_USD * costMultiplier;

  const tickStopDistance =
    quote &&
    (candidate.direction === 'BUY'
      ? quote.ask - candidate.stopLoss
      : candidate.stopLoss - quote.bid);
  const quoteWithinLevels =
    !quote ||
    (tickStopDistance !== undefined &&
      tickStopDistance > 0 &&
      (candidate.direction === 'BUY'
        ? quote.ask < candidate.takeProfit1
        : quote.bid > candidate.takeProfit1));

  const sizedCost =
    tickStopDistance === undefined
      ? costPerLot
      : CONTRACT_SIZE_OZ * (tickStopDistance + bufferOz) +
        2 * COMMISSION_PER_LOT_SIDE_USD * costMultiplier;

  const maxAllowedByPortfolio = Math.max(
    0,
    Number((riskLimits.maxTotalExposureLots - currentOpenLots).toFixed(2))
  );
  const rawSizedLots =
    accountEquityUsd === undefined
      ? requestedLots
      : Math.floor(
          ((accountEquityUsd * (effectiveRiskBudgetPct / 100)) / sizedCost) * 100
        ) / 100;

  const approvedLots = Math.min(requestedLots, maxAllowedByPortfolio, rawSizedLots);

  if (!quoteWithinLevels || !Number.isFinite(approvedLots) || approvedLots < 0.01) {
    return {
      cycleId,
      candleId: candle.candleId,
      signalId,
      marketTime: candle.closeTime,
      systemTime,
      approved: false,
      vetoed: true,
      requestedLots,
      approvedLots: 0,
      currentOpenPositions: currentOpenCount,
      currentDrawdownPct,
      dailyDrawdownPct,
      spreadPts: candle.spreadPts,
      limitsChecked: { ...riskLimits },
      ...baseDecisionFields,
      vetoCode: quoteWithinLevels ? 'MAX_VOLUME_EXCEEDED' : 'INVALID_STOP_DISTANCE',
      reasonVi: !quoteWithinLevels
        ? 'Giá khớp đã vượt SL hoặc TP1.'
        : `Ngân sách rủi ro hiệu lực (${effectiveRiskBudgetPct.toFixed(
            2
          )}% equity, dự phòng xuyên SL P95=${bufferOz.toFixed(
            2
          )} USD/oz) không đủ cho 0,01 lot ở khoảng cách dừng lỗ hiện tại.`,
    };
  }

  return {
    cycleId,
    candleId: candle.candleId,
    signalId,
    marketTime: candle.closeTime,
    systemTime,
    approved: true,
    vetoed: false,
    requestedLots,
    approvedLots,
    currentOpenPositions: currentOpenCount,
    currentDrawdownPct,
    dailyDrawdownPct,
    spreadPts: candle.spreadPts,
    limitsChecked: { ...riskLimits },
    ...baseDecisionFields,
    reasonVi: `ĐẠT KIỂM TRA RỦI RO: Vị thế mở ${currentOpenCount}/${
      riskLimits.maxOpenPositions
    }, khối lượng ${approvedLots} lot (Ngân sách ${effectiveRiskBudgetPct.toFixed(
      2
    )}%, dự phòng SL P95=${bufferOz.toFixed(2)} USD/oz [${
      slOvershootBuffer.usedFallbackDefault
        ? `<10 mẫu -> mặc định`
        : `${slOvershootBuffer.sampleCount} mẫu`
    }]), sụt giảm ${currentDrawdownPct.toFixed(2)}%, spread ${candle.spreadPts} pts hợp lệ.`,
  };
}
