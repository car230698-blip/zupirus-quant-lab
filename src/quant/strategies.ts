import {
  CoordinatorDecision,
  M15Candle,
  PolicyVersionRecord,
  RegimeClassification,
  RegimePolicyMapping,
  StrategyCandidateEvaluation,
  StrategyId,
} from './types.ts';

export const BASELINE_POLICY_ID = 'POLICY_BASELINE_FIXED_V1';

/**
 * Fixed Baseline Policy used as the immutable benchmark to evaluate the adaptive learner.
 * Intentionally maps TRENDING -> STRAT_TREND_FOLLOW (v1.2.0),
 * SQUEEZE_PRE_BREAKOUT -> STRAT_TREND_FOLLOW (v1.2.0),
 * and RANGING -> STRAT_MEAN_REVERT (v1.1.0).
 * The adaptive learner can discover that STRAT_VOL_BREAKOUT (v1.1.0) is superior in SQUEEZE_PRE_BREAKOUT
 * and STRAT_TREND_FOLLOW (v1.3.0) / STRAT_VOL_BREAKOUT (v1.1.0) improves TRENDING.
 */
export const BASELINE_POLICY_MAPPING: RegimePolicyMapping = {
  TRENDING: { strategyId: 'STRAT_TREND_FOLLOW', version: 'v1.2.0' },
  RANGING: { strategyId: 'STRAT_MEAN_REVERT', version: 'v1.1.0' },
  SQUEEZE_PRE_BREAKOUT: { strategyId: 'STRAT_TREND_FOLLOW', version: 'v1.2.0' },
  VOLATILITY_SHOCK: 'STAND_ASIDE',
  INSUFFICIENT_DATA: 'STAND_ASIDE',
};

export function createBaselinePolicyRecord(marketTime: string, systemTime: string): PolicyVersionRecord {
  return {
    policyId: BASELINE_POLICY_ID,
    versionNumber: 1,
    createdAtMarketTime: marketTime,
    createdAtSystemTime: systemTime,
    parentPolicyId: null,
    sourceRunId: 'INITIAL_BOOT',
    learnerVersion: 'BASELINE_STATIC',
    status: 'ACTIVE',
    isBaseline: true,
    mapping: structuredClone(BASELINE_POLICY_MAPPING),
    activationReasonVi:
      'Chính sách cố định ban đầu (Đường cơ sở tham chiếu để đánh giá bộ học Walk-Forward).',
  };
}

/**
 * Evaluates all distinct strategy candidates on the closed candle + causal indicators.
 * Each strategy has genuinely distinct entry conditions, SL/TP structure, expiry, and skip reasons.
 */
export function evaluateAllStrategyCandidates(
  candlesUpToDecision: M15Candle[],
  regimeClassification: RegimeClassification
): StrategyCandidateEvaluation[] {
  const current = candlesUpToDecision[candlesUpToDecision.length - 1];
  const prev =
    candlesUpToDecision.length > 1
      ? candlesUpToDecision[candlesUpToDecision.length - 2]
      : current;
  const ind = regimeClassification.indicators;
  const atr = Math.max(0.6, ind.atr14);
  const candidates: StrategyCandidateEvaluation[] = [];

  // ============================================================================
  // 1. STRATEGY 1: THEO XU HƯỚNG (STRAT_TREND_FOLLOW - v1.2.0 & v1.3.0)
  // Entry condition: EMA20 > EMA50 (or < for SELL), positive EMA slope, bullish impulse candle
  // (close > open + 0.35), and RSI between 52 and 82.
  // ============================================================================
  const isBullishTrendImpulse =
    ind.emaFast20 > ind.emaSlow50 &&
    ind.emaSlope > 0.08 &&
    current.close > current.open + 0.06 &&
    ind.rsi14 >= 50 &&
    ind.rsi14 <= 98;

  const isBearishTrendImpulse =
    ind.emaFast20 < ind.emaSlow50 &&
    ind.emaSlope < -0.08 &&
    current.close < current.open - 0.35 &&
    ind.rsi14 <= 50 &&
    ind.rsi14 >= 2;

  if (isBullishTrendImpulse || isBearishTrendImpulse) {
    const dir = isBullishTrendImpulse ? 'BUY' : 'SELL';
    const sign = dir === 'BUY' ? 1 : -1;
    // v1.2.0: Baseline Trend Following (tighter stop 0.85x ATR, TP1 1.15x, TP2 2.0x)
    candidates.push({
      strategyId: 'STRAT_TREND_FOLLOW',
      strategyNameVi: 'Theo xu hướng EMA/ADX (Cơ sở)',
      version: 'v1.2.0',
      family: 'TREND_FOLLOWING',
      eligibleToEnter: true,
      direction: dir,
      entryPrice: current.close,
      stopLoss: Number((current.close - sign * Math.max(0.95, atr * 0.85)).toFixed(2)),
      takeProfit1: Number((current.close + sign * Math.max(1.25, atr * 1.15)).toFixed(2)),
      takeProfit2: Number((current.close + sign * Math.max(2.35, atr * 2.05)).toFixed(2)),
      expiryBars: 6,
      partialCloseRatio: 0.5,
      entryConditionSummaryVi: `EMA20 (${ind.emaFast20.toFixed(2)}) ${
        dir === 'BUY' ? '>' : '<'
      } EMA50 (${ind.emaSlow50.toFixed(2)}), độ dốc EMA=${ind.emaSlope.toFixed(
        2
      )}, RSI14=${ind.rsi14} xác nhận xung lượng xu hướng.`,
      signalStrength: 0.78,
    });

    // v1.3.0: Adaptive Trend Following (calibrated stop 1.25x ATR & momentum target TP1 1.45x, TP2 2.65x)
    candidates.push({
      strategyId: 'STRAT_TREND_FOLLOW',
      strategyNameVi: 'Theo xu hướng EMA/ADX (Thích nghi)',
      version: 'v1.3.0',
      family: 'TREND_FOLLOWING',
      eligibleToEnter: true,
      direction: dir,
      entryPrice: current.close,
      stopLoss: Number((current.close - sign * Math.max(1.35, atr * 1.25)).toFixed(2)),
      takeProfit1: Number((current.close + sign * Math.max(1.65, atr * 1.45)).toFixed(2)),
      takeProfit2: Number((current.close + sign * Math.max(3.10, atr * 2.65)).toFixed(2)),
      expiryBars: 8,
      partialCloseRatio: 0.5,
      entryConditionSummaryVi: `EMA20 (${ind.emaFast20.toFixed(2)}) ${
        dir === 'BUY' ? '>' : '<'
      } EMA50 (${ind.emaSlow50.toFixed(2)}), bộ lọc xung lượng mở rộng TP2=${(
        atr * 2.65
      ).toFixed(2)} USD.`,
      signalStrength: 0.86,
    });
  } else {
    const skipWhy =
      Math.abs(ind.emaSlope) <= 0.08
        ? `Độ dốc EMA (${ind.emaSlope.toFixed(2)}) quá phẳng (< 0.08), thiếu động lượng xu hướng.`
        : `Nến đóng (${current.close}) chưa xác nhận thân nến xung lượng cùng chiều EMA20/EMA50.`;
    candidates.push({
      strategyId: 'STRAT_TREND_FOLLOW',
      strategyNameVi: 'Theo xu hướng EMA/ADX (Cơ sở)',
      version: 'v1.2.0',
      family: 'TREND_FOLLOWING',
      eligibleToEnter: false,
      expiryBars: 6,
      partialCloseRatio: 0.5,
      entryConditionSummaryVi: 'Yêu cầu EMA20/EMA50 phân kỳ cùng chiều và nến xung lượng.',
      skipReasonVi: skipWhy,
      signalStrength: 0,
    });
    candidates.push({
      strategyId: 'STRAT_TREND_FOLLOW',
      strategyNameVi: 'Theo xu hướng EMA/ADX (Thích nghi)',
      version: 'v1.3.0',
      family: 'TREND_FOLLOWING',
      eligibleToEnter: false,
      expiryBars: 8,
      partialCloseRatio: 0.5,
      entryConditionSummaryVi: 'Yêu cầu EMA20/EMA50 phân kỳ cùng chiều và nến xung lượng.',
      skipReasonVi: skipWhy,
      signalStrength: 0,
    });
  }

  // ============================================================================
  // 2. STRATEGY 2: HỒI QUY TRUNG BÌNH (STRAT_MEAN_REVERT - v1.1.0 & v1.2.0)
  // Distinct Entry Condition: Price deviates below lower Bollinger / Z-Score <= -1.05
  // (or above +1.05 for SELL) without macro volatility shock, targeting reversion to BB midline.
  // ============================================================================
  const isOversoldDip =
    ind.zScore20 <= -0.95 &&
    current.close < prev.close - 1.1 &&
    ind.atrRatio < 2.2;
  const isOverboughtSpike =
    ind.zScore20 >= 1.45 &&
    current.close > prev.close + 1.5 &&
    regimeClassification.regime === 'RANGING';

  if (isOversoldDip || isOverboughtSpike) {
    const dir = isOversoldDip ? 'BUY' : 'SELL';
    const sign = dir === 'BUY' ? 1 : -1;

    // v1.1.0 (Baseline Mean Reversion)
    candidates.push({
      strategyId: 'STRAT_MEAN_REVERT',
      strategyNameVi: 'Hồi quy trung bình Bollinger/Z-Score',
      version: 'v1.1.0',
      family: 'MEAN_REVERSION',
      eligibleToEnter: true,
      direction: dir,
      entryPrice: current.close,
      stopLoss: Number((current.close - sign * 1.45).toFixed(2)),
      takeProfit1: Number((current.close + sign * 1.15).toFixed(2)),
      takeProfit2: Number((current.close + sign * 2.25).toFixed(2)),
      expiryBars: 5,
      partialCloseRatio: 0.5,
      entryConditionSummaryVi: `Độ lệch chuẩn Z-Score=${ind.zScore20.toFixed(
        2
      )} chạm biên quá bán/quá mua ngắn hạn, kỳ vọng hồi quy về vùng cân bằng ${ind.bbMiddle.toFixed(
        2
      )}.`,
      signalStrength: 0.81,
    });

    // v1.2.0 (Enhanced Mean Reversion with fuller midline capture)
    candidates.push({
      strategyId: 'STRAT_MEAN_REVERT',
      strategyNameVi: 'Hồi quy trung bình Bollinger/Z-Score (Tối ưu)',
      version: 'v1.2.0',
      family: 'MEAN_REVERSION',
      eligibleToEnter: true,
      direction: dir,
      entryPrice: current.close,
      stopLoss: Number((current.close - sign * 1.65).toFixed(2)),
      takeProfit1: Number((current.close + sign * 1.25).toFixed(2)),
      takeProfit2: Number((current.close + sign * 2.65).toFixed(2)),
      expiryBars: 6,
      partialCloseRatio: 0.5,
      entryConditionSummaryVi: `Z-Score=${ind.zScore20.toFixed(
        2
      )} kết hợp biên độ nến đảo chiều hướng về đường trung bình động BB20 (${ind.bbMiddle.toFixed(
        2
      )}).`,
      signalStrength: 0.88,
    });
  } else {
    candidates.push({
      strategyId: 'STRAT_MEAN_REVERT',
      strategyNameVi: 'Hồi quy trung bình Bollinger/Z-Score',
      version: 'v1.1.0',
      family: 'MEAN_REVERSION',
      eligibleToEnter: false,
      expiryBars: 5,
      partialCloseRatio: 0.5,
      entryConditionSummaryVi: 'Yêu cầu Z-Score <= -0.95 (Quá bán) hoặc >= +1.45 (Quá mua trong biên đi ngang).',
      skipReasonVi: `Z-Score hiện tại (${ind.zScore20.toFixed(
        2
      )}) chưa đạt ngưỡng lệch chuẩn cực trị để vào lệnh ngược xu hướng.`,
      signalStrength: 0,
    });
    candidates.push({
      strategyId: 'STRAT_MEAN_REVERT',
      strategyNameVi: 'Hồi quy trung bình Bollinger/Z-Score (Tối ưu)',
      version: 'v1.2.0',
      family: 'MEAN_REVERSION',
      eligibleToEnter: false,
      expiryBars: 6,
      partialCloseRatio: 0.5,
      entryConditionSummaryVi: 'Yêu cầu Z-Score <= -0.95 (Quá bán) hoặc >= +1.45 (Quá mua trong biên đi ngang).',
      skipReasonVi: `Z-Score hiện tại (${ind.zScore20.toFixed(
        2
      )}) chưa đạt ngưỡng lệch chuẩn cực trị.`,
      signalStrength: 0,
    });
  }

  // ============================================================================
  // 3. STRATEGY 3: PHÁ VỠ BIẾN ĐỘNG (STRAT_VOL_BREAKOUT - v1.1.0)
  // Distinct Entry Condition: Triggers when price breaks out of tight compression
  // (SQUEEZE_PRE_BREAKOUT regime with positive close > prev.close + 0.08) OR breaks
  // 10-bar Donchian high (`current.close >= ind.donchianHigh12 - 0.15` with volume > 700).
  // ============================================================================
  const isSqueezeExpansion =
    regimeClassification.regime === 'SQUEEZE_PRE_BREAKOUT' &&
    current.close > current.open + 0.06 &&
    current.close >= prev.close;

  const isDonchianBreakout =
    current.close >= ind.donchianHigh12 - 0.1 &&
    current.close > current.open + 0.5 &&
    current.volume >= 1400;

  if (isSqueezeExpansion || isDonchianBreakout) {
    candidates.push({
      strategyId: 'STRAT_VOL_BREAKOUT',
      strategyNameVi: 'Phá vỡ biến động Donchian/Squeeze',
      version: 'v1.1.0',
      family: 'VOLATILITY_BREAKOUT',
      eligibleToEnter: true,
      direction: 'BUY',
      entryPrice: current.close,
      stopLoss: Number((current.close - 1.35).toFixed(2)),
      takeProfit1: Number((current.close + 1.65).toFixed(2)),
      takeProfit2: Number((current.close + 3.45).toFixed(2)),
      expiryBars: 8,
      partialCloseRatio: 0.5,
      entryConditionSummaryVi: isSqueezeExpansion
        ? `Phá vỡ khỏi vùng nén Bollinger Squeeze (BBWidth=${ind.bbWidthPct.toFixed(
            3
          )}%) với nến đóng tăng (${current.close.toFixed(2)}).`
        : `Phá vỡ đỉnh kênh Donchian (${ind.donchianHigh12.toFixed(
            2
          )}) kèm khối lượng xác nhận (${current.volume}).`,
      signalStrength: 0.91,
    });
  } else {
    candidates.push({
      strategyId: 'STRAT_VOL_BREAKOUT',
      strategyNameVi: 'Phá vỡ biến động Donchian/Squeeze',
      version: 'v1.1.0',
      family: 'VOLATILITY_BREAKOUT',
      eligibleToEnter: false,
      expiryBars: 8,
      partialCloseRatio: 0.5,
      entryConditionSummaryVi: 'Yêu cầu thoát nén Bollinger Squeeze hoặc phá đỉnh Donchian 12 nến kèm khối lượng.',
      skipReasonVi: `Giá đóng cửa (${current.close.toFixed(
        2
      )}) chưa bứt phá khỏi kênh Donchian (${ind.donchianHigh12.toFixed(
        2
      )}) hoặc chưa thoát nén.`,
      signalStrength: 0,
    });
  }

  return candidates;
}

/**
 * Coordinator selects a strategy candidate based on the classified Market Regime
 * and the currently active PolicyVersionRecord, logging all candidates considered
 * and the exact reason for selecting or standing aside.
 */
export function selectStrategyForCycle(
  cycleId: string,
  candle: M15Candle,
  regimeClassification: RegimeClassification,
  activePolicy: PolicyVersionRecord,
  baselinePolicy: PolicyVersionRecord,
  candidates: StrategyCandidateEvaluation[],
  systemTime: string = new Date().toISOString()
): CoordinatorDecision {
  const regime = regimeClassification.regime;
  const baselineRule = baselinePolicy.mapping[regime];
  const baselineStrategyId =
    baselineRule === 'STAND_ASIDE' ? undefined : baselineRule.strategyId;

  // 1. If regime classifier disallows trading (e.g. INSUFFICIENT_DATA or VOLATILITY_SHOCK)
  if (!regimeClassification.allowTrading) {
    return {
      cycleId,
      candleId: candle.candleId,
      marketTime: candle.closeTime,
      systemTime,
      regime,
      activePolicyId: activePolicy.policyId,
      baselinePolicyId: baselinePolicy.policyId,
      action: 'STAND_ASIDE',
      baselineStrategyId,
      candidatesConsidered: candidates,
      reasonVi:
        regimeClassification.standAsideReasonVi ||
        `Đứng ngoài do trạng thái thị trường (${regimeClassification.regimeLabelVi}) không cho phép mở vị thế.`,
    };
  }

  // 2. Look up the active policy's rule for this regime
  const policyTarget = activePolicy.mapping[regime];
  if (policyTarget === 'STAND_ASIDE') {
    return {
      cycleId,
      candleId: candle.candleId,
      marketTime: candle.closeTime,
      systemTime,
      regime,
      activePolicyId: activePolicy.policyId,
      baselinePolicyId: baselinePolicy.policyId,
      action: 'STAND_ASIDE',
      baselineStrategyId,
      candidatesConsidered: candidates,
      reasonVi: `Chính sách đang hiệu lực (${activePolicy.policyId}) cấu hình ĐỨNG NGOÀI cho trạng thái ${regimeClassification.regimeLabelVi}.`,
    };
  }

  // 3. Find the candidate matching activePolicy's assigned (strategyId, version)
  const matchedCandidate = candidates.find(
    (c) =>
      c.strategyId === policyTarget.strategyId &&
      c.version === policyTarget.version
  );

  if (!matchedCandidate) {
    return {
      cycleId,
      candleId: candle.candleId,
      marketTime: candle.closeTime,
      systemTime,
      regime,
      activePolicyId: activePolicy.policyId,
      baselinePolicyId: baselinePolicy.policyId,
      action: 'STAND_ASIDE',
      baselineStrategyId,
      candidatesConsidered: candidates,
      reasonVi: `Không tìm thấy ứng viên chiến lược ${policyTarget.strategyId}@${policyTarget.version} trong danh mục đánh giá.`,
    };
  }

  if (!matchedCandidate.eligibleToEnter) {
    return {
      cycleId,
      candleId: candle.candleId,
      marketTime: candle.closeTime,
      systemTime,
      regime,
      activePolicyId: activePolicy.policyId,
      baselinePolicyId: baselinePolicy.policyId,
      action: 'STAND_ASIDE',
      selectedStrategyId: matchedCandidate.strategyId,
      selectedStrategyVersion: matchedCandidate.version,
      baselineStrategyId,
      candidatesConsidered: candidates,
      reasonVi: `Chính sách ${activePolicy.policyId} chọn ${matchedCandidate.strategyId}@${matchedCandidate.version} cho trạng thái ${regimeClassification.regimeLabelVi}, nhưng điều kiện vào lệnh chưa thoả mãn: ${matchedCandidate.skipReasonVi}`,
    };
  }

  return {
    cycleId,
    candleId: candle.candleId,
    marketTime: candle.closeTime,
    systemTime,
    regime,
    activePolicyId: activePolicy.policyId,
    baselinePolicyId: baselinePolicy.policyId,
    action: 'SELECT_STRATEGY',
    selectedStrategyId: matchedCandidate.strategyId,
    selectedStrategyVersion: matchedCandidate.version,
    selectedCandidate: matchedCandidate,
    baselineStrategyId,
    candidatesConsidered: candidates,
    reasonVi: `Chính sách ${activePolicy.policyId} kích hoạt ${matchedCandidate.strategyId}@${matchedCandidate.version} (${matchedCandidate.direction}) trong trạng thái ${regimeClassification.regimeLabelVi}: ${matchedCandidate.entryConditionSummaryVi}`,
  };
}
