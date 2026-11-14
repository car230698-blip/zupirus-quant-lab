import React, { useState } from 'react';
import {
  QuantSystemState,
  ReplayDatasetMetadata,
  SimulatedPosition,
} from '../quant/types.ts';
import { formatUsd } from '../utils/formatters.ts';
import { EquityCurveChart } from './shared/EquityCurveChart.tsx';
import {
  OpenPositionsTable,
  PositionDetailInspectorCard,
  ReconciledHistoryTable,
} from './shared/PositionTables.tsx';
import { SectionHeader } from './shared/UiPrimitives.tsx';
import { PositionDetailDrawer } from './user/PositionDetailDrawer.tsx';
import { UserDemoPairingCard } from './user/UserDemoPairingCard.tsx';
import { UserHeader } from './user/UserHeader.tsx';
import { UserKpiStrip } from './user/UserKpiStrip.tsx';

export interface UserPortfolioViewProps {
  state: QuantSystemState;
  datasetMetadata: ReplayDatasetMetadata;
}

export const UserPortfolioView: React.FC<UserPortfolioViewProps> = ({
  state,
  datasetMetadata,
}) => {
  const [selectedOpenPosId, setSelectedOpenPosId] = useState<string | null>(null);
  const [inspectingPosition, setInspectingPosition] = useState<SimulatedPosition | null>(null);

  const selectedOpenPosition: SimulatedPosition | null =
    state.openPositions.find((p) => p.positionId === selectedOpenPosId) ?? null;

  const activeRecon = inspectingPosition
    ? state.reconciliations.find((r) => r.positionId === inspectingPosition.positionId)
    : undefined;

  return (
    <div className="space-y-6">
      {/* 1. Header & Source Mode Provenance */}
      <UserHeader state={state} datasetMetadata={datasetMetadata} />

      {/* 2. Customer Journey: EA MT5 Demo Pairing & Copy Status */}
      <UserDemoPairingCard />

      {/* 3. Core Financial KPI Strip */}
      <UserKpiStrip state={state} />

      {/* 4. Interactive Equity & Balance Curve */}
      <section className="bg-[#0c1322] border border-[#1e293b] rounded-xl p-5 sm:p-6 space-y-4 shadow-sm">
        <SectionHeader
          title="Biến động vốn"
          subtitle="Biểu đồ tương tác đường cong vốn (Equity) và số dư đã chốt (Balance) theo từng chu kỳ M15"
          rightSlot={
            <span className="text-xs font-mono tabular-nums text-slate-400 bg-[#080d1a] border border-slate-800/80 px-2.5 py-1 rounded-md">
              Đỉnh Equity (HWM): <strong className="text-cyan-400">{formatUsd(state.highWaterMarkEquityUsd)}</strong>
            </span>
          }
        />
        <EquityCurveChart
          points={state.equityCurve}
          initialBalance={state.initialBalanceUsd}
          lastUpdatedSystemTime={state.lastUpdatedSystemTime}
        />
      </section>

      {/* 5. Open Simulated Positions */}
      <section className="bg-[#0c1322] border border-[#1e293b] rounded-xl p-5 sm:p-6 space-y-4 shadow-sm">
        <SectionHeader
          title={`Vị thế đang mở (${state.openPositions.length}/${state.riskLimits.maxOpenPositions})`}
          subtitle="Các vị thế đang hoạt động trên thị trường mô phỏng. Bấm vào bất kỳ dòng nào để mở bảng chi tiết."
          rightSlot={
            <span className="text-xs font-mono tabular-nums text-slate-400 bg-[#080d1a] border border-slate-800/80 px-2.5 py-1 rounded-md">
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
          onSelectPosition={(pos) => {
            setSelectedOpenPosId(selectedOpenPosId === pos.positionId ? null : pos.positionId);
            setInspectingPosition(pos);
          }}
        />
      </section>

      {/* 6. Reconciled Closed Trade History */}
      <section className="bg-[#0c1322] border border-[#1e293b] rounded-xl p-5 sm:p-6 space-y-4 shadow-sm">
        <SectionHeader
          title={`Giao dịch đã đóng (${state.closedPositions.length} vị thế)`}
          subtitle="Toàn bộ lịch sử lệnh đã đóng và kết quả đối soát tự động sau khi kết thúc chu kỳ."
          rightSlot={
            <span className="text-xs font-mono tabular-nums text-emerald-400 bg-emerald-950/30 border border-emerald-900/60 px-2.5 py-1 rounded-md">
              Đối soát hợp lệ: {state.reconciliations.filter((r) => r.status === 'RECONCILED_OK').length}/
              {state.reconciliations.length}
            </span>
          }
        />
        <ReconciledHistoryTable
          closedPositions={state.closedPositions}
          reconciliations={state.reconciliations}
          lastUpdatedSystemTime={state.lastUpdatedSystemTime}
          onSelectPosition={(pos) => setInspectingPosition(pos)}
        />
      </section>

      {/* Slide-over Inspector Drawer for deep inspection */}
      <PositionDetailDrawer
        position={inspectingPosition}
        reconciliation={activeRecon}
        onClose={() => setInspectingPosition(null)}
      />
    </div>
  );
};
