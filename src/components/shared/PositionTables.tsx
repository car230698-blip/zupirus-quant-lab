import React, { useState } from 'react';
import {
  ReconciliationRecord,
  REGIME_LABELS_VI,
  SimulatedPosition,
} from '../../quant/types.ts';
import {
  EXIT_REASON_LABELS_VI,
  formatPrice,
  formatSignedUsd,
  formatUsd,
  formatUtcShort,
} from '../../utils/formatters.ts';
import { EmptyDataNotice, StatusLabel } from './UiPrimitives.tsx';

export const PositionDetailInspectorCard: React.FC<{
  position: SimulatedPosition;
  reconciliation?: ReconciliationRecord;
  onClose?: () => void;
}> = ({ position, reconciliation, onClose }) => (
  <div className="bg-slate-900 border border-cyan-500/40 rounded-lg p-4 sm:p-5 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="font-mono font-semibold text-cyan-300">
            {position.positionId}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{position.strategyId}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">Chính sách {position.openedUnderPolicyId}</span>
          <span aria-hidden="true">·</span>
          <span>{REGIME_LABELS_VI[position.regimeAtEntry]}</span>
        </div>
        <h3 className="text-sm sm:text-base font-display font-semibold text-slate-100 mt-1">
          Chi tiết Vị thế &amp; Đối soát Khớp lệnh ({position.direction} {position.symbol}{' '}
          {position.filledVolumeLots.toFixed(2)} lot)
        </h3>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs font-medium rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0"
        >
          Đóng chi tiết
        </button>
      )}
    </div>

    {/* Price, SL/TP & Cost Breakdown Grid */}
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
      <div className="bg-slate-950/80 border border-slate-800/80 rounded p-2.5">
        <div className="text-slate-400">Giá kỳ vọng / Khớp</div>
        <div className="font-mono tabular-nums text-slate-100 mt-1">
          {formatPrice(position.expectedEntryPrice)} / {formatPrice(position.fillEntryPrice)}
        </div>
        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
          Trượt vào: {position.entrySlippagePts.toFixed(1)} pts
        </div>
      </div>

      <div className="bg-slate-950/80 border border-slate-800/80 rounded p-2.5">
        <div className="text-slate-400">Mức Dừng lỗ (SL)</div>
        <div className="font-mono tabular-nums text-rose-300 mt-1">
          {formatPrice(position.stopLoss)}
        </div>
        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
          Quy tắc SL-trước bảo thủ
        </div>
      </div>

      <div className="bg-slate-950/80 border border-slate-800/80 rounded p-2.5">
        <div className="text-slate-400">Chốt lời TP1 / TP2</div>
        <div className="font-mono tabular-nums text-emerald-300 mt-1">
          {formatPrice(position.takeProfit1)} / {formatPrice(position.takeProfit2)}
        </div>
        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
          TP1 (50%): {position.partialTp1Hit ? 'Đã chạm' : 'Chưa chạm'}
        </div>
      </div>

      <div className="bg-slate-950/80 border border-slate-800/80 rounded p-2.5">
        <div className="text-slate-400">Giá đóng TB</div>
        <div className="font-mono tabular-nums text-slate-100 mt-1">
          {position.avgExitFillPrice ? formatPrice(position.avgExitFillPrice) : 'Đang mở'}
        </div>
        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
          Nắm giữ: {position.barsHeld}/{position.maxBarsAllowed} nến
        </div>
      </div>

      <div className="bg-slate-950/80 border border-slate-800/80 rounded p-2.5">
        <div className="text-slate-400">Spread / Trượt / Hoa hồng</div>
        <div className="font-mono tabular-nums text-amber-300 mt-1">
          {formatUsd(position.totalCostUsd)}
        </div>
        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
          Spd ${position.totalSpreadCostUsd.toFixed(2)} · Slp $
          {position.totalSlippageCostUsd.toFixed(2)} · Com $
          {position.totalCommissionUsd.toFixed(2)}
        </div>
      </div>

      <div className="bg-slate-950/80 border border-slate-800/80 rounded p-2.5">
        <div className="text-slate-400">P&amp;L Ròng (1x / 2x)</div>
        <div
          className={`font-mono tabular-nums font-semibold mt-1 ${
            position.netPnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'
          }`}
        >
          {formatSignedUsd(position.netPnlUsd)}
        </div>
        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
          Tại 2x chi phí: {formatSignedUsd(position.netPnlAt2xCostUsd)}
        </div>
      </div>
    </div>

    {/* Exit Reason & Reconciliation Status */}
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded bg-slate-950/90 border border-slate-800 text-xs">
      <div>
        <span className="text-slate-400">Lý do thoát / Trạng thái: </span>
        <span className="font-medium text-slate-200">
          {EXIT_REASON_LABELS_VI[position.exitReason]} — {position.exitReasonVi}
        </span>
      </div>
      {reconciliation && (
        <div className="font-mono text-emerald-300">
          Đối soát {reconciliation.reconciliationId}:{' '}
          {reconciliation.status === 'RECONCILED_OK'
            ? 'Khớp 100% khối lượng & P&L'
            : 'Có sai lệch'}
        </div>
      )}
    </div>

    {/* Partial & Final Deals Ledger */}
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-left border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-slate-400">
            <th className="py-2 pr-3 font-medium">Mã Deal</th>
            <th className="py-2 px-3 font-medium">Loại sự kiện</th>
            <th className="py-2 px-3 font-medium">Thời gian (UTC)</th>
            <th className="py-2 px-3 font-medium text-right">Khối lượng</th>
            <th className="py-2 px-3 font-medium text-right">Giá kỳ vọng / Khớp</th>
            <th className="py-2 px-3 font-medium text-right">Spread / Trượt</th>
            <th className="py-2 px-3 font-medium text-right">Hoa hồng</th>
            <th className="py-2 pl-3 font-medium text-right">P&amp;L Ròng</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
          {position.deals.map((deal) => (
            <tr key={deal.dealId} className="hover:bg-slate-800/30">
              <td className="py-2 pr-3 text-cyan-300">{deal.dealId}</td>
              <td className="py-2 px-3 text-slate-200">{deal.eventType}</td>
              <td className="py-2 px-3 text-slate-400">{formatUtcShort(deal.marketTime)}</td>
              <td className="py-2 px-3 text-right text-slate-200">
                {deal.volumeLots.toFixed(2)} lot
              </td>
              <td className="py-2 px-3 text-right text-slate-300">
                {formatPrice(deal.expectedPrice)} / {formatPrice(deal.fillPrice)}
              </td>
              <td className="py-2 px-3 text-right text-slate-400">
                {deal.spreadPts.toFixed(0)} / {deal.slippagePts.toFixed(1)} pts
              </td>
              <td className="py-2 px-3 text-right text-amber-300">
                ${deal.commissionUsd.toFixed(2)}
              </td>
              <td
                className={`py-2 pl-3 text-right font-semibold ${
                  deal.netPnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {formatSignedUsd(deal.netPnlUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export const OpenPositionsTable: React.FC<{
  positions: SimulatedPosition[];
  lastUpdatedSystemTime?: string | null;
  onSelectPosition?: (pos: SimulatedPosition) => void;
  selectedPositionId?: string | null;
}> = ({
  positions,
  lastUpdatedSystemTime,
  onSelectPosition,
  selectedPositionId,
}) => {
  if (positions.length === 0) {
    return (
      <EmptyDataNotice
        title="Hiện không có vị thế đang mở"
        reasonVi="Hệ thống chỉ mở vị thế mô phỏng khi nến M15 đóng cửa, trạng thái thị trường cho phép giao dịch và tín hiệu vượt qua Chốt rủi ro (Risk Gate)."
        lastUpdatedIso={lastUpdatedSystemTime}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-left border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-slate-400">
            <th className="py-2.5 pr-3 font-medium">Mã Vị thế</th>
            <th className="py-2.5 px-3 font-medium">Chiến lược &amp; Chính sách</th>
            <th className="py-2.5 px-3 font-medium">Chiều</th>
            <th className="py-2.5 px-3 font-medium text-right">Còn lại / Ban đầu</th>
            <th className="py-2.5 px-3 font-medium text-right">Giá kỳ vọng / Khớp</th>
            <th className="py-2.5 px-3 font-medium text-right">SL / TP1 / TP2</th>
            <th className="py-2.5 px-3 font-medium text-right">Chi phí luỹ kế</th>
            <th className="py-2.5 px-3 font-medium text-right">P&amp;L Thả nổi</th>
            <th className="py-2.5 pl-3 font-medium text-right">Chi tiết</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
          {positions.map((pos) => {
            const isSelected = selectedPositionId === pos.positionId;
            return (
              <tr
                key={pos.positionId}
                onClick={() => onSelectPosition?.(pos)}
                className={`transition-colors cursor-pointer ${
                  isSelected ? 'bg-cyan-950/30' : 'hover:bg-slate-800/40'
                }`}
              >
                <td className="py-2.5 pr-3 font-semibold text-cyan-300">
                  {pos.positionId}
                </td>
                <td className="py-2.5 px-3 font-sans">
                  <div className="text-slate-200 font-medium">{pos.strategyNameVi}</div>
                  <div className="text-[11px] font-mono text-slate-400">
                    {pos.openedUnderPolicyId} · {REGIME_LABELS_VI[pos.regimeAtEntry]}
                  </div>
                </td>
                <td className="py-2.5 px-3">
                  <StatusLabel
                    label={pos.direction}
                    tone={pos.direction === 'BUY' ? 'emerald' : 'rose'}
                    mono
                  />
                </td>
                <td className="py-2.5 px-3 text-right text-slate-200">
                  {pos.remainingVolumeLots.toFixed(2)} / {pos.filledVolumeLots.toFixed(2)} lot
                </td>
                <td className="py-2.5 px-3 text-right text-slate-300">
                  {formatPrice(pos.expectedEntryPrice)} / {formatPrice(pos.fillEntryPrice)}
                </td>
                <td className="py-2.5 px-3 text-right text-slate-300">
                  <span className="text-rose-300">{formatPrice(pos.stopLoss)}</span> /{' '}
                  <span className="text-emerald-300">{formatPrice(pos.takeProfit1)}</span> /{' '}
                  <span className="text-emerald-300">{formatPrice(pos.takeProfit2)}</span>
                </td>
                <td className="py-2.5 px-3 text-right text-amber-300">
                  {formatUsd(pos.totalCostUsd)}
                </td>
                <td
                  className={`py-2.5 px-3 text-right font-semibold ${
                    pos.unrealizedPnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {formatSignedUsd(pos.unrealizedPnlUsd)}
                </td>
                <td className="py-2.5 pl-3 text-right">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPosition?.(pos);
                    }}
                    className="px-2.5 py-1 text-xs font-sans font-medium rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0"
                  >
                    {isSelected ? 'Đang xem' : 'Xem lệnh'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const ReconciledHistoryTable: React.FC<{
  closedPositions: SimulatedPosition[];
  reconciliations: ReconciliationRecord[];
  lastUpdatedSystemTime?: string | null;
}> = ({ closedPositions, reconciliations, lastUpdatedSystemTime }) => {
  const [selectedPosId, setSelectedPosId] = useState<string | null>(null);

  if (closedPositions.length === 0) {
    return (
      <EmptyDataNotice
        title="Chưa có vị thế đã đóng và đối soát"
        reasonVi="Lịch sử giao dịch chỉ hiển thị các vị thế mô phỏng đã đóng hoàn tất và vượt qua bước đối soát độc lập (khớp khối lượng vào/ra, chi phí và P&L ròng)."
        lastUpdatedIso={lastUpdatedSystemTime}
      />
    );
  }

  const recByPosId = new Map<string, ReconciliationRecord>();
  for (const r of reconciliations) {
    recByPosId.set(r.positionId, r);
  }

  const ordered = closedPositions.slice().reverse();
  const selectedPosition =
    ordered.find((p) => p.positionId === selectedPosId) ?? null;

  return (
    <div className="space-y-4">
      {selectedPosition && (
        <PositionDetailInspectorCard
          position={selectedPosition}
          reconciliation={recByPosId.get(selectedPosition.positionId)}
          onClose={() => setSelectedPosId(null)}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="py-2.5 pr-3 font-medium">Mã Vị thế</th>
              <th className="py-2.5 px-3 font-medium">Chiến lược &amp; Trạng thái</th>
              <th className="py-2.5 px-3 font-medium">Chiều / Lot</th>
              <th className="py-2.5 px-3 font-medium text-right">Giá vào (KV / Khớp)</th>
              <th className="py-2.5 px-3 font-medium text-right">SL / TP1 / TP2</th>
              <th className="py-2.5 px-3 font-medium text-right">Giá đóng TB</th>
              <th className="py-2.5 px-3 font-medium">Lý do đóng</th>
              <th className="py-2.5 px-3 font-medium text-right">Tổng chi phí</th>
              <th className="py-2.5 px-3 font-medium text-right">P&amp;L Ròng</th>
              <th className="py-2.5 pl-3 font-medium text-right">Đối soát</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
            {ordered.map((pos) => {
              const rec = recByPosId.get(pos.positionId);
              const isSelected = selectedPosId === pos.positionId;
              return (
                <tr
                  key={pos.positionId}
                  onClick={() =>
                    setSelectedPosId(isSelected ? null : pos.positionId)
                  }
                  className={`transition-colors cursor-pointer ${
                    isSelected ? 'bg-cyan-950/30' : 'hover:bg-slate-800/40'
                  }`}
                >
                  <td className="py-2.5 pr-3 font-semibold text-cyan-300">
                    <div>{pos.positionId}</div>
                    <div className="text-[11px] text-slate-400">
                      {formatUtcShort(pos.closeMarketTime)}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 font-sans">
                    <div className="text-slate-200 font-medium">{pos.strategyNameVi}</div>
                    <div className="text-[11px] font-mono text-slate-400">
                      {pos.openedUnderPolicyId} · {REGIME_LABELS_VI[pos.regimeAtEntry]}
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={
                        pos.direction === 'BUY' ? 'text-emerald-300' : 'text-rose-300'
                      }
                    >
                      {pos.direction}
                    </span>{' '}
                    · {pos.filledVolumeLots.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-300">
                    {formatPrice(pos.expectedEntryPrice)} / {formatPrice(pos.fillEntryPrice)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-400">
                    {formatPrice(pos.stopLoss)} / {formatPrice(pos.takeProfit1)} /{' '}
                    {formatPrice(pos.takeProfit2)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-200">
                    {formatPrice(pos.avgExitFillPrice)}
                  </td>
                  <td className="py-2.5 px-3 font-sans text-slate-300 max-w-[200px]">
                    <div className="truncate" title={EXIT_REASON_LABELS_VI[pos.exitReason]}>
                      {EXIT_REASON_LABELS_VI[pos.exitReason]}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right text-amber-300">
                    {formatUsd(pos.totalCostUsd)}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-semibold ${
                      pos.netPnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'
                    }`}
                  >
                    {formatSignedUsd(pos.netPnlUsd)}
                  </td>
                  <td className="py-2.5 pl-3 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPosId(isSelected ? null : pos.positionId);
                      }}
                      className="px-2.5 py-1 text-xs font-sans font-medium rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0"
                    >
                      {rec?.status === 'RECONCILED_OK' ? 'Khớp · Chi tiết' : 'Chi tiết'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
