import React, { useState } from 'react';
import {
  QuantSystemState,
  REGIME_LABELS_VI,
  ReplayDatasetMetadata,
  SimulatedPosition,
} from '../quant/types.ts';
import {
  formatPct,
  formatPrice,
  formatSignedUsd,
  formatUsd,
  formatUtcShort,
} from '../utils/formatters.ts';
import { EquityCurveChart } from './shared/EquityCurveChart.tsx';
import {
  OpenPositionsTable,
  PositionDetailInspectorCard,
  ReconciledHistoryTable,
} from './shared/PositionTables.tsx';
import {
  MetricCard,
  SectionHeader,
  StatusLabel,
} from './shared/UiPrimitives.tsx';

export interface UserPortfolioViewProps {
  state: QuantSystemState;
  datasetMetadata: ReplayDatasetMetadata;
}

export const UserPortfolioView: React.FC<UserPortfolioViewProps> = ({
  state,
  datasetMetadata,
}) => {
  const [selectedOpenPosId, setSelectedOpenPosId] = useState<string | null>(null);

  const realizedNetPnl = state.balanceUsd - state.initialBalanceUsd;
  const floatingPnl = state.equityUsd - state.balanceUsd;
  const totalNetPnl = state.equityUsd - state.initialBalanceUsd;
  const totalReturnPct =
    state.initialBalanceUsd > 0
      ? (totalNetPnl / state.initialBalanceUsd) * 100
      : 0;

  const activePolicy =
    state.policies.find((p) => p.policyId === state.activePolicyId) ||
    state.policies[0];
  const latestCycle = state.cycleTraces[state.cycleTraces.length - 1] ?? null;
  const currentRegime =
    latestCycle?.regimeClassification?.regime ?? 'INSUFFICIENT_DATA';
  const telemetry = state.dataSourceTelemetry;
  const dailyDdPct = state.dailyDrawdown?.currentPct ?? 0;

  const selectedOpenPosition: SimulatedPosition | null =
    state.openPositions.find((p) => p.positionId === selectedOpenPosId) ?? null;

  return (
    <div className="space-y-6">
      {/* 1. Simulation Mode, Data Source Provenance & Market Session Strip */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Danh mục mô phỏng</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
              <StatusLabel label={`${state.symbol} · ${state.timeframe}`} />
              <span>{telemetry?.sourceMode === 'MT5_DEMO_LIVE' ? 'Báo giá MT5 demo' : 'Dữ liệu phát lại'}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm tabular-nums border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-800">
            <div>
              <div className="text-slate-400">Giờ thị trường gần nhất</div>
              <div className="text-slate-200 font-semibold mt-0.5">
                {formatUtcShort(state.lastProcessedMarketTime)}
              </div>
            </div>
            <div>
              <div className="text-slate-400">Cập nhật máy chủ</div>
              <div className="text-slate-300 mt-0.5">
                {formatUtcShort(state.lastUpdatedSystemTime)}
              </div>
            </div>
            {telemetry?.lastQuoteBid && telemetry?.lastQuoteAsk && (
              <div>
                <div className="text-slate-400">Bid / Ask gần nhất</div>
                <div className="text-cyan-300 font-semibold mt-0.5">
                  {formatPrice(telemetry.lastQuoteBid)} /{' '}
                  {formatPrice(telemetry.lastQuoteAsk)} ({telemetry.lastQuoteSpreadPts} pts)
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 2. Core Financial KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Số dư"
          value={formatUsd(state.balanceUsd)}
          tone="cyan"
          rightMeta={`Vốn gốc: ${formatUsd(state.initialBalanceUsd)}`}
          subtitle={`P&L đã chốt & đối soát: ${formatSignedUsd(realizedNetPnl)} (${
            state.closedPositions.length
          } vị thế đóng)`}
        />

        <MetricCard
          title="Vốn hiện tại"
          value={formatUsd(state.equityUsd)}
          tone={totalNetPnl >= 0 ? 'emerald' : 'rose'}
          rightMeta={`${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}%`}
          subtitle={`P&L thả nổi: ${formatSignedUsd(floatingPnl)} (${
            state.openPositions.length
          } vị thế đang mở)`}
        />

        <MetricCard
          title="Sụt giảm hiện tại / tối đa"
          value={`${formatPct(state.currentDrawdownPct)} / ${formatPct(
            state.maxDrawdownPct
          )}`}
          tone={
            state.currentDrawdownPct >= state.riskLimits.maxTotalDrawdownPct * 0.75
              ? 'rose'
              : state.currentDrawdownPct > 0
              ? 'amber'
              : 'emerald'
          }
          rightMeta={`Trần tổng: ${formatPct(state.riskLimits.maxTotalDrawdownPct, 1)}`}
          subtitle={`Sụt giảm ngày UTC (${
            state.dailyDrawdown?.marketDateUtc ?? 'Hôm nay'
          }): ${formatPct(dailyDdPct)} / Trần ngày ${formatPct(
            state.riskLimits.maxDailyDrawdownPct,
            1
          )}`}
        />

        <MetricCard
          title="Trạng thái thị trường"
          value={REGIME_LABELS_VI[currentRegime]}
          tone="slate"
          rightMeta={`v${activePolicy.versionNumber}`}
          subtitle={activePolicy.isBaseline ? 'Chính sách cơ sở' : 'Chính sách thích nghi'}
        />
      </section>

      {/* 3. Interactive Equity & Balance Curve */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
        <SectionHeader
          title="Biến động vốn"
          rightSlot={
            <span className="text-xs font-mono tabular-nums text-slate-400">
              Đỉnh Equity (HWM): {formatUsd(state.highWaterMarkEquityUsd)}
            </span>
          }
        />
        <EquityCurveChart
          points={state.equityCurve}
          initialBalance={state.initialBalanceUsd}
          lastUpdatedSystemTime={state.lastUpdatedSystemTime}
        />
      </section>

      {/* 4. Open Simulated Positions */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
        <SectionHeader
          title={`Vị thế đang mở (${state.openPositions.length}/${state.riskLimits.maxOpenPositions})`}
          rightSlot={
            <span className="text-xs font-mono tabular-nums text-slate-400">
              Trần khối lượng: {state.riskLimits.maxVolumeLotsPerTrade.toFixed(2)} lot/lệnh
            </span>
          }
        />
        {selectedOpenPosition && (
          <PositionDetailInspectorCard
            position={selectedOpenPosition}
            onClose={() => setSelectedOpenPosId(null)}
          />
        )}
        <OpenPositionsTable
          positions={state.openPositions}
          lastUpdatedSystemTime={state.lastUpdatedSystemTime}
          selectedPositionId={selectedOpenPosId}
          onSelectPosition={(pos) =>
            setSelectedOpenPosId(
              selectedOpenPosId === pos.positionId ? null : pos.positionId
            )
          }
        />
      </section>

      {/* 5. Reconciled Closed Trade History */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
        <SectionHeader
          title={`Giao dịch đã đóng (${state.closedPositions.length} vị thế)`}
          rightSlot={
            <span className="text-xs font-mono tabular-nums text-emerald-300">
              Đối soát hợp lệ: {state.reconciliations.filter((r) => r.status === 'RECONCILED_OK').length}/
              {state.reconciliations.length}
            </span>
          }
        />
        <ReconciledHistoryTable
          closedPositions={state.closedPositions}
          reconciliations={state.reconciliations}
          lastUpdatedSystemTime={state.lastUpdatedSystemTime}
        />
      </section>
    </div>
  );
};
