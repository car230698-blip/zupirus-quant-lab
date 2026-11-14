import React from 'react';
import {
  QuantSystemState,
  REGIME_LABELS_VI,
} from '../../quant/types.ts';
import {
  formatPct,
  formatSignedUsd,
  formatUsd,
} from '../../utils/formatters.ts';
import { MetricCard } from '../shared/UiPrimitives.tsx';

export interface UserKpiStripProps {
  state: QuantSystemState;
}

export const UserKpiStrip: React.FC<UserKpiStripProps> = ({ state }) => {
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
  const dailyDdPct = state.dailyDrawdown?.currentPct ?? 0;

  return (
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
  );
};
