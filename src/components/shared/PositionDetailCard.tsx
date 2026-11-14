import React from 'react';
import type { ReconciliationRecord, SimulatedPosition } from '../../quant/types.ts';
import {
  formatExitReasonVi,
  formatLots,
  formatPrice,
  formatSignedUsd,
  formatStrategyNameVi,
  formatUsd,
  formatUtcShort,
} from '../../utils/formatters.ts';
import { StatusLabel } from './UiPrimitives.tsx';

export const PositionDetailCard: React.FC<{
  position: SimulatedPosition;
  reconciliation?: ReconciliationRecord;
  currentReferencePrice?: number;
  onClose?: () => void;
}> = ({ position: pos, reconciliation: recon, currentReferencePrice, onClose }) => {
  const isOpen = pos.status === 'FILLED' || pos.status === 'PARTIAL_CLOSED';
  const markOrClosePrice = isOpen
    ? currentReferencePrice ?? pos.fillEntryPrice
    : pos.avgExitFillPrice ?? pos.expectedExitPrice ?? pos.fillEntryPrice;
  const displayPnl = isOpen ? pos.unrealizedPnlUsd : pos.netPnlUsd;

  return (
    <div className="bg-slate-950/95 border border-cyan-500/40 rounded-lg p-3.5 sm:p-4 space-y-3.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <StatusLabel
            label={pos.direction === 'BUY' ? 'MUA (LONG)' : 'BÁN (SHORT)'}
            tone={pos.direction === 'BUY' ? 'emerald' : 'rose'}
          />
          <span className="text-sm font-semibold text-slate-100">
            {formatStrategyNameVi(pos.strategyId)}
          </span>
          <span className="text-slate-400 font-mono tabular-nums">
            ({formatLots(pos.filledVolumeLots)})
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors cursor-pointer"
          >
            Đóng chi tiết ✕
          </button>
        )}
      </div>

      {/* 4 focused detail panels: Fill Price, SL/TP, Fees, and Exit Reason */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-slate-900/90 border border-slate-800/90 rounded p-3 space-y-1.5">
          <div className="text-slate-400 font-medium">1. Giá khớp &amp; Tham chiếu</div>
          <div className="flex justify-between">
            <span className="text-slate-400">Giá khớp mở:</span>
            <span className="font-mono tabular-nums font-semibold text-slate-100">
              {formatPrice(pos.fillEntryPrice)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Giá kỳ vọng:</span>
            <span className="font-mono tabular-nums text-slate-300">
              {formatPrice(pos.expectedEntryPrice)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">{isOpen ? 'Giá hiện tại:' : 'Giá đóng bình quân:'}</span>
            <span className="font-mono tabular-nums text-cyan-300">
              {formatPrice(markOrClosePrice)}
            </span>
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800/90 rounded p-3 space-y-1.5">
          <div className="text-slate-400 font-medium">2. Ngưỡng Dừng lỗ &amp; Chốt lời</div>
          <div className="flex justify-between">
            <span className="text-slate-400">Dừng lỗ (SL):</span>
            <span className="font-mono tabular-nums text-rose-300">
              {formatPrice(pos.stopLoss)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Chốt lời 50% (TP1):</span>
            <span className="font-mono tabular-nums text-emerald-300">
              {formatPrice(pos.takeProfit1)} {pos.partialTp1Hit ? '✓' : ''}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Chốt lời toàn bộ (TP2):</span>
            <span className="font-mono tabular-nums text-emerald-300">
              {formatPrice(pos.takeProfit2)}
            </span>
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800/90 rounded p-3 space-y-1.5">
          <div className="text-slate-400 font-medium">3. Chi phí thực thi &amp; Lãi/Lỗ</div>
          <div className="flex justify-between">
            <span className="text-slate-400">Tổng phí (Spread + Trượt + HH):</span>
            <span className="font-mono tabular-nums text-amber-300">
              {formatUsd(pos.totalCostUsd)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">{isOpen ? 'Lãi/Lỗ thả nổi:' : 'Lãi/Lỗ ròng (1×):'}</span>
            <span
              className={`font-mono tabular-nums font-semibold ${
                displayPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {formatSignedUsd(displayPnl)}
            </span>
          </div>
          {!isOpen && (
            <div className="flex justify-between">
              <span className="text-slate-400">Lãi/Lỗ chịu tải phí 2×:</span>
              <span
                className={`font-mono tabular-nums ${
                  pos.netPnlAt2xCostUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {formatSignedUsd(pos.netPnlAt2xCostUsd)}
              </span>
            </div>
          )}
        </div>

        <div className="bg-slate-900/90 border border-slate-800/90 rounded p-3 space-y-1.5">
          <div className="text-slate-400 font-medium">4. Lý do đóng &amp; Đối soát</div>
          <div className="text-slate-200 font-medium leading-snug">
            {formatExitReasonVi(pos.exitReason)}
          </div>
          <div className="text-slate-400">
            Khối lượng đã đóng:{' '}
            <span className="font-mono text-slate-200">
              {formatLots(pos.closedVolumeLots)} / {formatLots(pos.filledVolumeLots)}
            </span>
          </div>
          {recon && (
            <div className="pt-0.5">
              <StatusLabel
                label={
                  recon.volumeMatched
                    ? 'Đối soát khớp 100% khối lượng'
                    : 'Đang chờ đóng hết vị thế'
                }
                tone={recon.volumeMatched ? 'emerald' : 'amber'}
              />
            </div>
          )}
        </div>
      </div>

      {/* Expandable technical metadata & deal ledger */}
      <details className="group bg-slate-900/70 border border-slate-800 rounded p-2.5">
        <summary className="cursor-pointer list-none flex items-center justify-between text-cyan-300 hover:text-cyan-200 font-medium">
          <span>
            Sổ lệnh chi tiết ({pos.deals.length} giao dịch) &amp; mã định danh kỹ thuật
          </span>
          <span className="font-mono text-[11px] text-slate-400 group-open:rotate-180 transition-transform">
            ▼
          </span>
        </summary>

        <div className="mt-2.5 pt-2.5 border-t border-slate-800 space-y-2.5 font-mono text-[11px]">
          <div className="flex flex-wrap gap-2 text-slate-300">
            <StatusLabel label={`Mã vị thế: ${pos.positionId}`} tone="slate" mono />
            <StatusLabel label={`Chu kỳ mở: ${pos.entryCycleId}`} tone="slate" mono />
            <StatusLabel label={`Chính sách: ${pos.openedUnderPolicyId}`} tone="cyan" mono />
            <StatusLabel label={`Mã chiến lược: ${pos.strategyId} (${pos.strategyVersion})`} tone="slate" mono />
            {recon && (
              <StatusLabel label={`Mã đối soát: ${recon.reconciliationId}`} tone="emerald" mono />
            )}
          </div>

          <div className="text-slate-400">
            Phân rã phí: Spread {formatUsd(pos.totalSpreadCostUsd)} | Trượt giá{' '}
            {formatUsd(pos.totalSlippageCostUsd)} | Hoa hồng {formatUsd(pos.totalCommissionUsd)}
          </div>

          {pos.deals.length > 0 && (
            <div className="w-full max-w-full overflow-x-auto rounded border border-slate-800">
              <table className="w-full text-left border-collapse min-w-[520px]">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <th className="py-1.5 px-2.5">Mã Deal</th>
                    <th className="py-1.5 px-2.5">Loại</th>
                    <th className="py-1.5 px-2.5">Thời gian (UTC)</th>
                    <th className="py-1.5 px-2.5 text-right">Khối lượng</th>
                    <th className="py-1.5 px-2.5 text-right">Giá khớp</th>
                    <th className="py-1.5 px-2.5 text-right">P&amp;L ròng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {pos.deals.map((d) => (
                    <tr key={d.dealId} className="text-slate-300">
                      <td className="py-1.5 px-2.5">{d.dealId}</td>
                      <td className="py-1.5 px-2.5">{d.eventType}</td>
                      <td className="py-1.5 px-2.5">{formatUtcShort(d.marketTime)}</td>
                      <td className="py-1.5 px-2.5 text-right tabular-nums">
                        {formatLots(d.volumeLots)}
                      </td>
                      <td className="py-1.5 px-2.5 text-right tabular-nums">
                        {formatPrice(d.fillPrice)}
                      </td>
                      <td
                        className={`py-1.5 px-2.5 text-right tabular-nums ${
                          d.netPnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {d.eventType === 'ENTRY_FILL' ? '—' : formatSignedUsd(d.netPnlUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </div>
  );
};
