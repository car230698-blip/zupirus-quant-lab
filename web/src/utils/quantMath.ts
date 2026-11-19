export type AccountCategory = 'standard' | 'cent' | 'prop';
export type AccountKind = 'STANDARD' | 'CENT' | 'PROP' | AccountCategory;
export type BillingCycleType = 'MONTHLY' | 'QUARTERLY' | 'BIANNUAL' | 'ANNUAL';
export type BillingCycle = BillingCycleType;

export interface LotCalculationInput {
  equity?: number;
  balanceUsd?: number;
  riskPct?: number;
  riskPercent?: number;
  slPoints?: number;
  stopLossPips?: number;
  accountType?: AccountCategory;
  accountKind?: AccountKind;
  dailyDrawdownLimitPct?: number;
}

export interface LotCalculationResult {
  riskDollars: number;
  recommendedLot: number;
  lotUnitLabel: string;
  oneRProfitDollars: number;
  twoRProfitDollars: number;
  threeRProfitDollars: number;
  propDailyLimitDollars: number;
  propMaxDrawdownDollars: number;
  pointsPerDollar: number;
  // Aliases for UI convenience
  displayLots: number;
  unitLabel: string;
  riskUsd: number;
  rewardAt2RUsd: number;
  maxConsecutiveLossesBeforeDailyCap: number;
  propFirmSafe: boolean;
}

export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return 0;
  return Math.floor((value + 1e-9) / step) * step;
}

export function calculateQuantLotSizing(input: LotCalculationInput): LotCalculationResult {
  const rawEquity = input.equity ?? input.balanceUsd ?? 10000;
  const safeEquity = Math.max(100, Number(rawEquity) || 10000);
  const rawRiskPct = input.riskPct ?? input.riskPercent ?? 1.0;
  const safeRiskPct = Math.min(Math.max(Number(rawRiskPct) || 1.0, 0.1), 10.0);
  const rawSlPoints = input.slPoints ?? (input.stopLossPips ? input.stopLossPips * 10 : 300);
  const safeSlPoints = Math.max(50, Number(rawSlPoints) || 300);
  const acctKind = String(input.accountType ?? input.accountKind ?? 'standard').toLowerCase();

  const riskDollars = (safeEquity * safeRiskPct) / 100;
  const multiplier = acctKind === 'cent' ? 100 : 1;
  const step = acctKind === 'cent' ? 0.1 : 0.01;
  const minLot = acctKind === 'cent' ? 0.1 : 0.01;
  const rawLot = (riskDollars / safeSlPoints) * multiplier;
  const steppedLot = roundToStep(rawLot, step);
  const minLotRiskDollars = (minLot / multiplier) * safeSlPoints;
  // Fail-closed: if minLot requires more dollar risk than riskDollars budget, return 0 lots
  const clampedLot =
    steppedLot < minLot
      ? minLotRiskDollars <= riskDollars + 1e-6
        ? minLot
        : 0
      : Math.min(steppedLot, 100.0);
  const effectiveRiskDollars = clampedLot > 0 ? (clampedLot / multiplier) * safeSlPoints : 0;
  const unitLabel = acctKind === 'cent' ? 'Cent Lots (USC)' : 'Standard Lots';
  const rawDdInput = Number(input.dailyDrawdownLimitPct);
  const validPropDd = Number.isFinite(rawDdInput) && rawDdInput > 0 ? rawDdInput : 4.5;
  const ddCapPct = Number.isFinite(rawDdInput) && rawDdInput > 0 ? rawDdInput : (acctKind === 'prop' ? 4.5 : 10);
  const maxConsecutiveLossesBeforeDailyCap = Math.max(1, Math.floor(ddCapPct / safeRiskPct));

  return {
    riskDollars: Number(effectiveRiskDollars.toFixed(2)),
    recommendedLot: Number(clampedLot.toFixed(2)),
    lotUnitLabel: unitLabel,
    oneRProfitDollars: Number(effectiveRiskDollars.toFixed(2)),
    twoRProfitDollars: Number((effectiveRiskDollars * 2).toFixed(2)),
    threeRProfitDollars: Number((effectiveRiskDollars * 3).toFixed(2)),
    propDailyLimitDollars: Number((safeEquity * (validPropDd / 100)).toFixed(2)),
    propMaxDrawdownDollars: Number((safeEquity * ((validPropDd * 2) / 100)).toFixed(2)),
    pointsPerDollar: Number((safeSlPoints / 100).toFixed(2)),
    displayLots: Number(clampedLot.toFixed(2)),
    unitLabel,
    riskUsd: Number(effectiveRiskDollars.toFixed(2)),
    rewardAt2RUsd: Number((effectiveRiskDollars * 2).toFixed(2)),
    maxConsecutiveLossesBeforeDailyCap,
    propFirmSafe: clampedLot > 0 && safeRiskPct <= 1.5,
  };
}

export function calculateSubscriptionPricing(
  tierBaseUsd: number,
  slotsCount: number,
  cycle: BillingCycleType,
  fxRate: number
): {
  usdTotal: number;
  vndTotal: number;
  discountPct: number;
  effectiveMonthlyUsd: number;
  totalUsd: number;
  totalVnd: number;
  months: number;
} {
  const base = Math.max(0, Number(tierBaseUsd) || 25);
  const extraSlots = Math.max(0, (Number(slotsCount) || 1) - 1);
  const monthlyRaw = base + extraSlots * 10;

  const cycleConfig: Record<BillingCycleType, { months: number; discount: number }> = {
    MONTHLY: { months: 1, discount: 0 },
    QUARTERLY: { months: 3, discount: 0.1 },
    BIANNUAL: { months: 6, discount: 0.15 },
    ANNUAL: { months: 12, discount: 0.2 },
  };

  const cfg = cycleConfig[cycle] || cycleConfig.MONTHLY;
  const usdTotal = Math.round(monthlyRaw * cfg.months * (1 - cfg.discount) * 100) / 100;
  const effectiveMonthlyUsd = Math.round((usdTotal / cfg.months) * 100) / 100;
  const safeFx = Math.max(1000, Number(fxRate) || 25500);
  const vndTotal = Math.ceil((usdTotal * safeFx) / 1000) * 1000;

  return {
    usdTotal,
    vndTotal,
    discountPct: Math.round(cfg.discount * 100),
    effectiveMonthlyUsd,
    totalUsd: usdTotal,
    totalVnd: vndTotal,
    months: cfg.months,
  };
}

export function computeOrderLedgerMetrics(orders: Array<Record<string, any>>) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return {
      totalCount: 0,
      filledCount: 0,
      winCount: 0,
      lossCount: 0,
      winRatePct: 0,
      netPnl: 0,
      profitFactor: 0,
    };
  }

  let filledCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  for (const o of orders) {
    const st = String(o.status || o.state || 'filled').toLowerCase();
    if (st === 'filled' || st === 'executed' || st === 'completed') {
      filledCount += 1;
    }
    const pnl = Number(o.pnl ?? o.profit ?? o.realized_pnl ?? 0);
    if (pnl > 0) {
      winCount += 1;
      grossProfit += pnl;
    } else if (pnl < 0) {
      lossCount += 1;
      grossLoss += Math.abs(pnl);
    }
  }

  const closedWithPnl = winCount + lossCount;
  const winRatePct = closedWithPnl > 0 ? Number(((winCount / closedWithPnl) * 100).toFixed(1)) : 0;
  const netPnl = Number((grossProfit - grossLoss).toFixed(2));
  const profitFactor =
    grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 9.99 : 0;

  return {
    totalCount: orders.length,
    filledCount,
    winCount,
    lossCount,
    winRatePct,
    netPnl,
    profitFactor,
  };
}
