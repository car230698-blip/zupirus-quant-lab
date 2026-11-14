import { classifyMarketRegime } from './regimeDetector.ts';
import { computeMaxDrawdownFromPnls } from './researchTeam.ts';
import { reconcileClosedPosition } from './reconciliation.ts';
import { cloneRiskLimits, evaluateRiskGate } from './riskGate.ts';
import {
  ExecutionCostLatencyOptions,
  openSimulatedPosition,
  stepOpenPositionOnCandle,
} from './simBroker.ts';
import {
  BASELINE_POLICY_ID,
  createBaselinePolicyRecord,
  evaluateMultiTimeframeCandidates,
  selectStrategyForCycle,
} from './strategies.ts';
import type { TickReplay, ReplayQuote } from './tickReplay.ts';
import {
  M15Candle,
  PolicyVersionRecord,
  SimulatedPosition,
} from './types.ts';

export interface PostHocCostAnalysisReport {
  reportType: 'POST_HOC_2X_ON_EXECUTED_TRADES';
  titleVi: string;
  descriptionVi: string;
  costMultiplier: number;
  tradesEvaluated: number;
  grossPnlUsd: number;
  cost1xUsd: number;
  netPnl1xUsd: number;
  costElevatedUsd: number;
  netPnlElevatedUsd: number;
  winRate1xPct: number;
  winRateElevatedPct: number;
  maxDrawdown1xUsd: number;
  maxDrawdownElevatedUsd: number;
}

export interface FullCostLatencyReplayReport {
  reportType: 'FULL_PATH_RESIMULATION_UNDER_NEW_COST_MODEL';
  titleVi: string;
  descriptionVi: string;
  costMultiplier: number;
  entryLatencyMs: number;
  exitLatencyMs: number;
  extraSlippagePts: number;
  candlesProcessed: number;
  tradesExecuted: number;
  signalsVetoedByCostOrSpread: number;
  grossPnlUsd: number;
  totalCostUsd: number;
  netPnlUsd: number;
  winRatePct: number;
  maxDrawdownUsd: number;
  finalBalanceUsd: number;
  reconciledPositions: SimulatedPosition[];
}

export interface DualCostStressComparison {
  generatedAtSystemTime: string;
  postHoc2xAnalysis: PostHocCostAnalysisReport;
  fullReSimulation2x: FullCostLatencyReplayReport;
  comparisonSummaryVi: string;
}

/**
 * 1. Post-Hoc 2× Cost Analysis on Already-Executed Trades:
 * Keeps the exact executed trades, volumes, and entry/exit timestamps fixed,
 * and recalculates Net PnL when spread + slippage + commission are multiplied by `costMultiplier` (default 2x).
 */
export function buildPostHocCostAnalysisReport(
  closedPositions: readonly SimulatedPosition[],
  costMultiplier: number = 2.0
): PostHocCostAnalysisReport {
  const reconciled = closedPositions.filter((p) => p.reconciled);
  const n = reconciled.length;

  const grossPnlUsd = Number(
    reconciled.reduce((sum, p) => sum + p.grossPnlUsd, 0).toFixed(2)
  );
  const cost1xUsd = Number(
    reconciled.reduce((sum, p) => sum + p.totalCostUsd, 0).toFixed(2)
  );
  const netPnl1xUsd = Number(
    reconciled.reduce((sum, p) => sum + p.netPnlUsd, 0).toFixed(2)
  );
  const costElevatedUsd = Number((cost1xUsd * costMultiplier).toFixed(2));
  const netPnlElevatedUsd = Number((grossPnlUsd - costElevatedUsd).toFixed(2));

  const wins1x = reconciled.filter((p) => p.netPnlUsd > 0).length;
  const winsElevated = reconciled.filter(
    (p) => p.grossPnlUsd - p.totalCostUsd * costMultiplier > 0
  ).length;

  const pnls1x = reconciled.map((p) => p.netPnlUsd);
  const pnlsElevated = reconciled.map((p) =>
    Number((p.grossPnlUsd - p.totalCostUsd * costMultiplier).toFixed(2))
  );

  return {
    reportType: 'POST_HOC_2X_ON_EXECUTED_TRADES',
    titleVi: `Phân tích hậu kiểm ${costMultiplier}× chi phí trên các lệnh đã khớp (Post-Hoc Analysis)`,
    descriptionVi:
      'Giữ nguyên danh sách lệnh đã khớp, khối lượng và thời điểm vào/ra thực tế; chỉ nhân hệ số chi phí (Spread + Trượt giá + Phí hoa hồng) để kiểm tra sức chịu đựng biên lợi nhuận tĩnh.',
    costMultiplier,
    tradesEvaluated: n,
    grossPnlUsd,
    cost1xUsd,
    netPnl1xUsd,
    costElevatedUsd,
    netPnlElevatedUsd,
    winRate1xPct: n > 0 ? Number(((wins1x / n) * 100).toFixed(1)) : 0,
    winRateElevatedPct: n > 0 ? Number(((winsElevated / n) * 100).toFixed(1)) : 0,
    maxDrawdown1xUsd: computeMaxDrawdownFromPnls(pnls1x),
    maxDrawdownElevatedUsd: computeMaxDrawdownFromPnls(pnlsElevated),
  };
}

/**
 * 2. Full Re-Simulation under New Cost & Latency Model:
 * Re-runs the entire closed-candle & tick sequence from initial balance under elevated cost
 * and entry/exit latency. Here, spread vetoes, risk-sized lot volumes, fill prices,
 * and breakeven stop levels dynamically adapt to the new cost/latency parameters.
 */
export function runFullCostLatencyReplay(params: {
  candles: readonly M15Candle[];
  policy?: PolicyVersionRecord;
  ticks?: TickReplay;
  quotesByCandleId?: Record<string, ReplayQuote[]>;
  firstAfterCloseByCandleId?: Record<string, ReplayQuote>;
  options?: ExecutionCostLatencyOptions;
  initialBalanceUsd?: number;
}): FullCostLatencyReplayReport {
  const {
    candles,
    ticks,
    quotesByCandleId,
    firstAfterCloseByCandleId,
    options = {
      costMultiplier: 2.0,
      entryLatencyMs: 250,
      exitLatencyMs: 250,
      extraSlippagePts: 2,
    },
    initialBalanceUsd = 10000,
  } = params;

  const costMultiplier = options.costMultiplier ?? 2.0;
  const entryLatencyMs = options.entryLatencyMs ?? 0;
  const exitLatencyMs = options.exitLatencyMs ?? 0;
  const extraSlippagePts = options.extraSlippagePts ?? 0;

  const startMarketTime =
    candles[0]?.openTime || '2026-03-02T08:00:00.000Z';
  const systemTime = new Date().toISOString();
  const activePolicy =
    params.policy || createBaselinePolicyRecord(startMarketTime, systemTime);
  const baselinePolicy = createBaselinePolicyRecord(startMarketTime, systemTime);
  const riskLimits = cloneRiskLimits();

  let balanceUsd = initialBalanceUsd;
  let equityUsd = initialBalanceUsd;
  let highWaterMark = initialBalanceUsd;
  let currentDrawdownPct = 0;
  let dailyDateUtc = '';
  let dailyPeakEquity = initialBalanceUsd;
  let dailyDrawdownPct = 0;

  let openPositions: SimulatedPosition[] = [];
  const closedPositions: SimulatedPosition[] = [];
  let signalsVetoedByCostOrSpread = 0;

  const updateMetrics = () => {
    const closedNet = closedPositions.reduce((s, p) => s + p.netPnlUsd, 0);
    const openRealized = openPositions.reduce(
      (s, p) => s + p.deals.reduce((ds, d) => ds + d.netPnlUsd, 0),
      0
    );
    const openUnrealized = openPositions.reduce(
      (s, p) => s + p.unrealizedPnlUsd,
      0
    );
    balanceUsd = Number((initialBalanceUsd + closedNet + openRealized).toFixed(2));
    equityUsd = Number((balanceUsd + openUnrealized).toFixed(2));
    if (equityUsd > highWaterMark) highWaterMark = equityUsd;
    currentDrawdownPct =
      highWaterMark > 0
        ? Number((((highWaterMark - equityUsd) / highWaterMark) * 100).toFixed(2))
        : 0;
    if (equityUsd > dailyPeakEquity) dailyPeakEquity = equityUsd;
    dailyDrawdownPct =
      dailyPeakEquity > 0
        ? Number((((dailyPeakEquity - equityUsd) / dailyPeakEquity) * 100).toFixed(2))
        : 0;
  };

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (!candle.isClosed) continue;
    const cycleId = `REPLAY-COST-CYCLE-${String(i + 1).padStart(4, '0')}`;
    const dateUtc = new Date(candle.closeTime).toISOString().slice(0, 10);
    if (dateUtc !== dailyDateUtc) {
      dailyDateUtc = dateUtc;
      dailyPeakEquity = equityUsd;
      dailyDrawdownPct = 0;
    }

    const barQuotes =
      quotesByCandleId?.[candle.candleId] ??
      (ticks ? Array.from(ticks.within(candle)) : undefined);

    // Step open positions under new cost & latency model
    const nextOpen: SimulatedPosition[] = [];
    for (const openPos of openPositions) {
      const stepped = stepOpenPositionOnCandle(
        openPos,
        cycleId,
        candle,
        systemTime,
        barQuotes,
        undefined,
        {
          costMultiplier,
          entryLatencyMs,
          exitLatencyMs,
          extraSlippagePts,
        }
      );
      if (stepped.status === 'CLOSED') {
        const { reconciledPosition } = reconcileClosedPosition(stepped, systemTime);
        closedPositions.push(reconciledPosition);
      } else {
        nextOpen.push(stepped);
      }
    }
    openPositions = nextOpen;
    updateMetrics();

    const history = candles.slice(0, i + 1);
    const regime = classifyMarketRegime(cycleId, history, false, undefined, systemTime);
    const candidates = evaluateMultiTimeframeCandidates(history, regime);
    const decision = selectStrategyForCycle(
      cycleId,
      candle,
      regime,
      activePolicy,
      baselinePolicy,
      candidates,
      systemTime
    );

    // Resolve entry quote with entryLatencyMs if tick data exists
    let quoteAfterClose =
      firstAfterCloseByCandleId?.[candle.candleId] ??
      ticks?.firstAfterClose(candle);
    if (quoteAfterClose && entryLatencyMs > 0 && i + 1 < candles.length) {
      const nextCandle = candles[i + 1];
      const nextQuotes =
        quotesByCandleId?.[nextCandle.candleId] ??
        (ticks ? Array.from(ticks.within(nextCandle)) : []);
      const targetMs = quoteAfterClose.time + entryLatencyMs;
      const delayed = nextQuotes.find((q) => q.time >= targetMs);
      if (delayed && delayed.time - Date.parse(candle.closeTime) <= 5000 + entryLatencyMs) {
        quoteAfterClose = delayed;
      }
    }

    const executionCandle = quoteAfterClose
      ? {
          ...candle,
          spreadPts: Math.ceil((quoteAfterClose.ask - quoteAfterClose.bid) * 100 - 1e-8),
        }
      : candle;
    const canQuote = !ticks || quoteAfterClose !== undefined;

    if (
      canQuote &&
      decision.action === 'SELECT_STRATEGY' &&
      decision.selectedCandidate
    ) {
      const selected = decision.selectedCandidate;
      const riskDecision = evaluateRiskGate({
        cycleId,
        candle: executionCandle,
        quote: quoteAfterClose,
        signalId: `SIG-COST-${cycleId}`,
        candidate: selected,
        openPositions,
        closedPositions,
        currentDrawdownPct,
        dailyDrawdownPct,
        riskLimits,
        requestedLots: 0.5,
        accountEquityUsd: equityUsd,
        costMultiplier,
        systemTime,
      });

      if (riskDecision.approved && !riskDecision.vetoed) {
        const posId = `POS-COST-${String(closedPositions.length + openPositions.length + 1).padStart(4, '0')}`;
        const newPos = openSimulatedPosition({
          executionMode: 'SIMULATION_ONLY',
          positionId: posId,
          signalId: `SIG-COST-${cycleId}`,
          cycleId,
          candle: executionCandle,
          quote: quoteAfterClose,
          regime: regime.regime,
          openedUnderPolicyId: activePolicy.policyId,
          candidate: selected,
          volumeLots: riskDecision.approvedLots,
          systemTime,
          costOptions: {
            costMultiplier,
            entryLatencyMs,
            exitLatencyMs,
            extraSlippagePts,
          },
        });
        openPositions.push(newPos);
        updateMetrics();
      } else if (
        riskDecision.vetoCode === 'EXCESSIVE_SPREAD' ||
        riskDecision.vetoCode === 'MAX_VOLUME_EXCEEDED'
      ) {
        signalsVetoedByCostOrSpread += 1;
      }
    }
  }

  const tradesExecuted = closedPositions.length;
  const grossPnlUsd = Number(
    closedPositions.reduce((s, p) => s + p.grossPnlUsd, 0).toFixed(2)
  );
  const totalCostUsd = Number(
    closedPositions.reduce((s, p) => s + p.totalCostUsd, 0).toFixed(2)
  );
  const netPnlUsd = Number(
    closedPositions.reduce((s, p) => s + p.netPnlUsd, 0).toFixed(2)
  );
  const wins = closedPositions.filter((p) => p.netPnlUsd > 0).length;
  const maxDrawdownUsd = computeMaxDrawdownFromPnls(
    closedPositions.map((p) => p.netPnlUsd)
  );

  return {
    reportType: 'FULL_PATH_RESIMULATION_UNDER_NEW_COST_MODEL',
    titleVi: `Chạy lại toàn bộ mô phỏng theo mô hình chi phí ${costMultiplier}× & độ trễ ${entryLatencyMs}ms (Full Re-Simulation)`,
    descriptionVi:
      'Chạy lại từ đầu toàn bộ chuỗi nến/tick với mô hình chi phí mới và độ trễ vào/thoát lệnh. Khối lượng đặt lệnh (Risk Sizing), quyết định phủ quyết Spread, giá vào lệnh và điểm dời SL hòa vốn sau TP1 đều thay đổi động theo chi phí mới.',
    costMultiplier,
    entryLatencyMs,
    exitLatencyMs,
    extraSlippagePts,
    candlesProcessed: candles.length,
    tradesExecuted,
    signalsVetoedByCostOrSpread,
    grossPnlUsd,
    totalCostUsd,
    netPnlUsd,
    winRatePct:
      tradesExecuted > 0 ? Number(((wins / tradesExecuted) * 100).toFixed(1)) : 0,
    maxDrawdownUsd,
    finalBalanceUsd: balanceUsd,
    reconciledPositions: closedPositions,
  };
}

/**
 * Generates a side-by-side comparison distinguishing Post-Hoc 2x Cost Analysis
 * from Full Re-Simulation under a 2x Cost + Latency model.
 */
export function buildDualCostStressComparison(params: {
  executedClosedPositions: readonly SimulatedPosition[];
  candles: readonly M15Candle[];
  activePolicy?: PolicyVersionRecord;
  ticks?: TickReplay;
  quotesByCandleId?: Record<string, ReplayQuote[]>;
  firstAfterCloseByCandleId?: Record<string, ReplayQuote>;
  options?: ExecutionCostLatencyOptions;
}): DualCostStressComparison {
  const costMultiplier = params.options?.costMultiplier ?? 2.0;
  const postHoc2xAnalysis = buildPostHocCostAnalysisReport(
    params.executedClosedPositions,
    costMultiplier
  );
  const fullReSimulation2x = runFullCostLatencyReplay({
    candles: params.candles,
    policy: params.activePolicy,
    ticks: params.ticks,
    quotesByCandleId: params.quotesByCandleId,
    firstAfterCloseByCandleId: params.firstAfterCloseByCandleId,
    options: {
      costMultiplier,
      entryLatencyMs: params.options?.entryLatencyMs ?? 250,
      exitLatencyMs: params.options?.exitLatencyMs ?? 250,
      extraSlippagePts: params.options?.extraSlippagePts ?? 2,
    },
  });

  const comparisonSummaryVi = `Phân biệt rõ 2 phương pháp kiểm định chi phí: (1) Hậu kiểm ${costMultiplier}× trên ${
    postHoc2xAnalysis.tradesEvaluated
  } lệnh đã khớp cho Lãi ròng ${
    postHoc2xAnalysis.netPnlElevatedUsd >= 0 ? '+' : ''
  }${postHoc2xAnalysis.netPnlElevatedUsd.toFixed(
    2
  )} USD (Chi phí $${postHoc2xAnalysis.costElevatedUsd.toFixed(
    2
  )}); (2) Chạy lại toàn bộ theo mô hình chi phí ${costMultiplier}× & độ trễ ${
    fullReSimulation2x.entryLatencyMs
  }ms khớp ${fullReSimulation2x.tradesExecuted} lệnh (từ chối ${
    fullReSimulation2x.signalsVetoedByCostOrSpread
  } tín hiệu do giãn spread/vượt ngân sách rủi ro), Lãi ròng ${
    fullReSimulation2x.netPnlUsd >= 0 ? '+' : ''
  }${fullReSimulation2x.netPnlUsd.toFixed(2)} USD.`;

  return {
    generatedAtSystemTime: new Date().toISOString(),
    postHoc2xAnalysis,
    fullReSimulation2x,
    comparisonSummaryVi,
  };
}
