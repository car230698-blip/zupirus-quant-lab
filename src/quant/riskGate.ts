import type { ReplayQuote } from './tickReplay.ts';
import { COMMISSION_PER_LOT_SIDE_USD, CONTRACT_SIZE_OZ, computeDeterministicSlippagePts } from './simBroker.ts';
import {
  M15Candle,
  RiskDecision,
  RiskLimitsConfig,
  SimulatedPosition,
  StrategyCandidateEvaluation,
} from './types.ts';

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
 * Evaluates a proposed entry candidate against hard risk limits.
 * Has unconditional veto power before any order reaches the Simulated Broker.
 */
export function evaluateRiskGate(params: {
  cycleId: string;
  candle: M15Candle;
  signalId: string;
  candidate: StrategyCandidateEvaluation;
  openPositions: SimulatedPosition[];
  currentDrawdownPct: number;
  dailyDrawdownPct: number;
  riskLimits: RiskLimitsConfig;
  requestedLots?: number;
  accountEquityUsd?: number;
  quote?: ReplayQuote;
  systemTime?: string;
}): RiskDecision {
  const {
    cycleId,
    candle,
    signalId,
    candidate,
    openPositions,
    currentDrawdownPct,
    dailyDrawdownPct,
    riskLimits,
    requestedLots = 0.5,
    accountEquityUsd,
    quote,
    systemTime = new Date().toISOString(),
  } = params;

  const currentOpenCount = openPositions.length;
  const currentOpenLots = openPositions.reduce(
    (sum, p) => sum + p.remainingVolumeLots,
    0
  );

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
      vetoCode: 'LEARNER_HALT_ACTIVE',
      reasonVi:
        'PHỦ QUYẾT RỦI RO: Chế độ tạm ngừng mở vị thế mới do hiệu suất suy giảm và không còn phiên bản chính sách dự phòng hợp lệ.',
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
      vetoCode: 'MAX_VOLUME_EXCEEDED',
      reasonVi: `PHỦ QUYẾT RỦI RO: Khối lượng yêu cầu (${requestedLots} lot, tổng phơi nhiễm ${(
        currentOpenLots + requestedLots
      ).toFixed(2)} lot) vượt giới hạn (${riskLimits.maxVolumeLotsPerTrade} lot/lệnh, tối đa ${
        riskLimits.maxTotalExposureLots
      } lot).`,
    };
  }

  // 6. Check Spread Limit
  if (candle.spreadPts > riskLimits.maxSpreadPtsAllowed) {
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
      vetoCode: 'EXCESSIVE_SPREAD',
      reasonVi: `PHỦ QUYẾT RỦI RO: Spread thị trường hiện tại (${candle.spreadPts} pts) vượt trần cho phép (${riskLimits.maxSpreadPtsAllowed} pts).`,
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
      vetoCode: 'INVALID_STOP_DISTANCE',
      reasonVi: 'PHỦ QUYẾT RỦI RO: Khoảng cách dừng lỗ (SL) hoặc chốt lời (TP) không hợp lệ.',
    };
  }

  // Round down to the simulated broker's 0.01-lot increment.
  const stopDistance = Math.abs(candidate.entryPrice - candidate.stopLoss);
  const costPerLot = CONTRACT_SIZE_OZ * (stopDistance + candle.spreadPts * 0.01 +
    2 * computeDeterministicSlippagePts(candle) * 0.01 + 0.02) +
    2 * COMMISSION_PER_LOT_SIDE_USD;
  const tickStopDistance = quote && (candidate.direction === 'BUY'
    ? quote.ask - candidate.stopLoss : candidate.stopLoss - quote.bid);
  const quoteWithinLevels = !quote || (tickStopDistance !== undefined && tickStopDistance > 0 &&
    (candidate.direction === 'BUY' ? quote.ask < candidate.takeProfit1 : quote.bid > candidate.takeProfit1));
  const sizedCost = tickStopDistance === undefined ? costPerLot :
    CONTRACT_SIZE_OZ * (tickStopDistance + 0.02) + 2 * COMMISSION_PER_LOT_SIDE_USD;
  const approvedLots = accountEquityUsd === undefined ? requestedLots :
    Math.min(requestedLots, Math.floor(
      (accountEquityUsd * riskLimits.defaultRiskPerTradePct / 100 / sizedCost) * 100
    ) / 100);
  if (!quoteWithinLevels || !Number.isFinite(approvedLots) || approvedLots < 0.01) {
    return {
      cycleId, candleId: candle.candleId, signalId, marketTime: candle.closeTime, systemTime,
      approved: false, vetoed: true, requestedLots, approvedLots: 0,
      currentOpenPositions: currentOpenCount, currentDrawdownPct, dailyDrawdownPct,
      spreadPts: candle.spreadPts, limitsChecked: { ...riskLimits },
      vetoCode: quoteWithinLevels ? 'MAX_VOLUME_EXCEEDED' : 'INVALID_STOP_DISTANCE',
      reasonVi: !quoteWithinLevels ? 'Giá khớp đã vượt SL hoặc TP1.' : 'Ngân sách rủi ro không đủ cho 0,01 lot ở khoảng cách dừng lỗ hiện tại.',
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
    reasonVi: `ĐẠT KIỂM TRA RỦI RO: Vị thế mở ${currentOpenCount}/${riskLimits.maxOpenPositions}, khối lượng ${approvedLots} lot, sụt giảm ${currentDrawdownPct.toFixed(
      2
    )}%, spread ${candle.spreadPts} pts hợp lệ.`,
  };
}
