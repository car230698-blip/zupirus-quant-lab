import React from 'react';
import type {
  EnrichedTimelineEvent,
  TimelineEventInspectionDetail,
} from '../../quant/agentActivityTracker.ts';
import {
  formatCleanJournalMessageVi,
  formatExitReasonVi,
  formatLots,
  formatPct,
  formatPrice,
  formatSignedUsd,
  formatStrategyNameVi,
  formatUsd,
  formatUtcShort,
} from '../../utils/formatters.ts';
import { StatusLabel } from '../shared/UiPrimitives.tsx';

export const TimelineEventDetail: React.FC<{
  event: EnrichedTimelineEvent;
  detail: TimelineEventInspectionDetail | null;
  loading: boolean;
}> = ({ event, detail, loading }) => {
  if (loading) {
    return (
      <div className="mt-3 pt-3 border-t border-slate-800/80 text-xs font-mono text-cyan-300 animate-pulse">
        Đang tải chi tiết sự kiện và bản ghi đối soát từ máy chủ...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mt-3 pt-3 border-t border-slate-800/80 text-xs text-slate-400">
        Không tìm thấy dữ liệu mở rộng cho sự kiện này.
      </div>
    );
  }

  const trace = detail.cycleTrace;
  const pos = detail.linkedPosition;
  const recon = detail.linkedReconciliation;
  const lr = detail.linkedLearningRun;

  return (
    <div
      className="mt-3 pt-3 border-t border-slate-800/90 space-y-3 text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top human-readable summary grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {trace ? (
          <div className="bg-slate-900/90 border border-slate-800 rounded p-3 space-y-1.5">
            <div className="font-semibold text-slate-200">Bối cảnh thị trường &amp; Trạng thái</div>
            <div className="text-slate-300">
              Giá đóng nến M15:{' '}
              <span className="font-mono tabular-nums text-slate-100">
                {formatPrice(trace.candle.close)}
              </span>{' '}
              (Spread: <span className="font-mono">{trace.candle.spreadPts} pts</span>)
            </div>
            {trace.regimeClassification && (
              <div className="text-slate-300">
                Trạng thái:{' '}
                <span className="text-cyan-300 font-medium">
                  {trace.regimeClassification.regimeLabelVi}
                </span>{' '}
                (Độ tin cậy {formatPct(trace.regimeClassification.confidence * 100, 0)})
              </div>
            )}
          </div>
        ) : (
          <div className="bg-slate-900/90 border border-slate-800 rounded p-3 space-y-1.5">
            <div className="font-semibold text-slate-200">Thời điểm ghi nhận</div>
            <div className="text-slate-300">
              Giờ thị trường: <span className="font-mono">{formatUtcShort(event.timestampMarket)}</span>
            </div>
            <div className="text-slate-400">
              Giờ hệ thống: <span className="font-mono">{formatUtcShort(event.timestampSystem)}</span>
            </div>
          </div>
        )}

        <div className="bg-slate-900/90 border border-slate-800 rounded p-3 space-y-1.5">
          <div className="font-semibold text-slate-200">Quyết định chiến lược &amp; Rủi ro</div>
          {trace?.coordinatorDecision ? (
            <>
              <div className="text-slate-300">
                Chiến lược:{' '}
                <span className="font-medium text-slate-100">
                  {formatStrategyNameVi(trace.coordinatorDecision.selectedStrategyId)}
                </span>
              </div>
              <div className="text-slate-400 leading-snug">
                {formatCleanJournalMessageVi(trace.coordinatorDecision.reasonVi)}
              </div>
            </>
          ) : (
            <div className="text-slate-400">Sự kiện kiểm định / vận hành hệ thống.</div>
          )}
          {trace?.riskDecision && (
            <div
              className={`pt-1 font-medium ${
                trace.riskDecision.vetoed ? 'text-rose-300' : 'text-emerald-300'
              }`}
            >
              Chốt rủi ro:{' '}
              {trace.riskDecision.approved
                ? `Đã duyệt ${formatLots(trace.riskDecision.approvedLots)}`
                : `Chặn lệnh — ${trace.riskDecision.reasonVi}`}
            </div>
          )}
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded p-3 space-y-1.5">
          <div className="font-semibold text-slate-200">Kết quả giao dịch / Kiểm định</div>
          {pos ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">
                  {pos.direction === 'BUY' ? 'MUA' : 'BÁN'} {formatLots(pos.filledVolumeLots)}
                </span>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    pos.netPnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {formatSignedUsd(pos.netPnlUsd)}
                </span>
              </div>
              <div className="text-slate-400">
                Giá khớp: <span className="font-mono text-slate-200">{formatPrice(pos.fillEntryPrice)}</span>{' '}
                | Phí: <span className="font-mono">{formatUsd(pos.totalCostUsd)}</span>
              </div>
              <div className="text-slate-400">
                Trạng thái: <span className="text-slate-200">{formatExitReasonVi(pos.exitReason)}</span>
              </div>
            </>
          ) : lr ? (
            <>
              <div className="text-slate-200 font-medium">
                {formatCleanJournalMessageVi(lr.decisionReasonVi)}
              </div>
              <div className="text-slate-400 font-mono">
                Mẫu dùng: {lr.totalCompletedSamplesUsed} | Loại trừ: {lr.totalExcludedSamples}
              </div>
            </>
          ) : (
            <div className="text-slate-400">
              Không phát sinh mở/đóng vị thế mới trong sự kiện này.
            </div>
          )}
        </div>
      </div>

      {/* Progressive disclosure for raw technical codes, pipeline data, and reconciliation */}
      <details className="group bg-slate-950/90 border border-slate-800 rounded p-2.5">
        <summary className="cursor-pointer list-none flex items-center justify-between text-cyan-300 hover:text-cyan-200 font-medium">
          <span>Mở rộng mã kỹ thuật, dữ liệu đối soát &amp; thông số ứng viên</span>
          <span className="font-mono text-[11px] text-slate-400 group-open:rotate-180 transition-transform">
            ▼
          </span>
        </summary>

        <div className="mt-2.5 pt-2.5 border-t border-slate-800/80 space-y-2.5 font-mono text-[11px] text-slate-300">
          <div className="flex flex-wrap gap-2">
            <StatusLabel label={`Mã sự kiện: ${event.entryId}`} tone="slate" mono />
            <StatusLabel label={`Loại: ${event.eventCode}`} tone="slate" mono />
            <StatusLabel label={`Chu kỳ: ${event.cycleId}`} tone="slate" mono />
            {trace?.coordinatorDecision?.activePolicyId && (
              <StatusLabel
                label={`Chính sách: ${trace.coordinatorDecision.activePolicyId}`}
                tone="cyan"
                mono
              />
            )}
            {pos && <StatusLabel label={`Vị thế: ${pos.positionId}`} tone="emerald" mono />}
            {recon && (
              <StatusLabel
                label={`Đối soát: ${recon.reconciliationId} (${recon.status})`}
                tone={recon.volumeMatched ? 'emerald' : 'rose'}
                mono
              />
            )}
            {lr && <StatusLabel label={`Đợt học: ${lr.runId}`} tone="amber" mono />}
          </div>

          <div className="text-slate-400 break-words">
            Bản ghi gốc: <span className="text-slate-200">{event.messageVi}</span>
          </div>

          {trace && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-900/80 p-2 rounded border border-slate-800">
              <div>Nến: {trace.candle.candleId}</div>
              <div>
                OHLC: {formatPrice(trace.candle.open)} / {formatPrice(trace.candle.high)} /{' '}
                {formatPrice(trace.candle.low)} / {formatPrice(trace.candle.close)}
              </div>
              <div>
                ATR(14):{' '}
                {trace.regimeClassification
                  ? formatPrice(trace.regimeClassification.indicators.atr14)
                  : '—'}
              </div>
              <div>
                ADX:{' '}
                {trace.regimeClassification
                  ? trace.regimeClassification.indicators.adxProxy.toFixed(1)
                  : '—'}
              </div>
            </div>
          )}

          {recon && (
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800 space-y-1">
              <div className="text-emerald-300 font-semibold">
                Dữ liệu đối soát vị thế ({recon.reconciliationId}):
              </div>
              <div>
                Khối lượng mở {formatLots(recon.filledVolumeLots)} / Đóng{' '}
                {formatLots(recon.closedVolumeLots)} — Khớp 100%:{' '}
                {recon.volumeMatched ? 'CÓ' : 'KHÔNG'} | P&amp;L ròng 1x:{' '}
                {formatSignedUsd(recon.netPnlUsd)} | P&amp;L 2x:{' '}
                {formatSignedUsd(recon.netPnlAt2xCostUsd)}
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
};
