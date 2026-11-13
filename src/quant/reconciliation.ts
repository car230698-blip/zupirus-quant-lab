import {
  ReconciliationRecord,
  SimulatedPosition,
} from './types.ts';

/**
 * Reconciles a closed simulated position.
 * Only confirms full closure (`RECONCILED_OK`) when closed deal volume matches filled volume (`closedVolumeLots === filledVolumeLots`).
 */
export function reconcileClosedPosition(
  position: SimulatedPosition,
  systemTime: string = new Date().toISOString()
): { reconciledPosition: SimulatedPosition; record: ReconciliationRecord } {
  const pos = structuredClone(position);

  const exitDeals = pos.deals.filter(
    (d) => d.eventType === 'PARTIAL_CLOSE_TP1' || d.eventType === 'FINAL_CLOSE'
  );
  const summedExitLots = Number(
    exitDeals.reduce((acc, d) => acc + d.volumeLots, 0).toFixed(4)
  );
  const volumeMatched =
    pos.filledVolumeLots > 0 &&
    Math.abs(pos.closedVolumeLots - pos.filledVolumeLots) < 1e-6 &&
    Math.abs(summedExitLots - pos.filledVolumeLots) < 1e-6 &&
    pos.remainingVolumeLots === 0;

  const entryDeviationPts = Number(
    (Math.abs(pos.fillEntryPrice - pos.expectedEntryPrice) * 100).toFixed(1)
  );
  const exitDeviationPts =
    pos.expectedExitPrice !== undefined && pos.avgExitFillPrice !== undefined
      ? Number(
          (Math.abs(pos.avgExitFillPrice - pos.expectedExitPrice) * 100).toFixed(1)
        )
      : 0;

  const reconciliationId = `RECON-${pos.positionId}`;
  const status = volumeMatched ? 'RECONCILED_OK' : 'DISCREPANCY_DETECTED';

  const summaryVi = volumeMatched
    ? `Đối soát khớp đủ khối lượng (${pos.closedVolumeLots}/${pos.filledVolumeLots} lot qua ${
        exitDeals.length
      } lần đóng). Độ lệch giá vào ${entryDeviationPts} pts, độ lệch giá thoát ${exitDeviationPts} pts, Lãi/Lỗ ròng sau chi phí: ${
        pos.netPnlUsd >= 0 ? '+' : ''
      }${pos.netPnlUsd.toFixed(2)} USD.`
    : `Chưa đủ khối lượng đối soát: Đã đóng ${pos.closedVolumeLots}/${pos.filledVolumeLots} lot (còn lại ${pos.remainingVolumeLots} lot). Chưa xác nhận hoàn tất.`;

  const record: ReconciliationRecord = {
    reconciliationId,
    positionId: pos.positionId,
    entryCycleId: pos.entryCycleId,
    closeCycleId: pos.closeCycleId || pos.entryCycleId,
    reconciledAtMarketTime: pos.closeMarketTime || pos.entryMarketTime,
    reconciledAtSystemTime: systemTime,
    filledVolumeLots: pos.filledVolumeLots,
    closedVolumeLots: pos.closedVolumeLots,
    volumeMatched,
    entryDeviationPts,
    exitDeviationPts,
    grossPnlUsd: pos.grossPnlUsd,
    totalCostUsd: pos.totalCostUsd,
    netPnlUsd: pos.netPnlUsd,
    netPnlAt2xCostUsd: pos.netPnlAt2xCostUsd,
    dealCount: pos.deals.length,
    status,
    summaryVi,
  };

  pos.reconciled = volumeMatched;
  pos.reconciliationId = reconciliationId;
  if (!volumeMatched && pos.status === 'CLOSED') {
    pos.status = 'PARTIAL_CLOSED';
  }

  return { reconciledPosition: pos, record };
}
