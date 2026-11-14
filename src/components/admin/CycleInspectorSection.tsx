import React, { useState } from 'react';
import {
  REGIME_LABELS_VI,
  type QuantSystemState,
} from '../../quant/types.ts';
import {
  REGIME_BADGE_TONES,
  formatLots,
  formatPct,
  formatPrice,
  formatStrategyNameVi,
  formatUsd,
  formatUtcShort,
} from '../../utils/formatters.ts';
import {
  EmptyDataNotice,
  SectionHeader,
  StatusLabel,
} from '../shared/UiPrimitives.tsx';

export interface CycleInspectorSectionProps {
  state: QuantSystemState;
}

export const CycleInspectorSection: React.FC<CycleInspectorSectionProps> = ({
  state,
}) => {
  const [selectedCycleId, setSelectedCycleId] = useState<string>('');

  const orderedCycles = state.cycleTraces.slice().reverse();
  const activeCycle =
    orderedCycles.find((c) => c.cycleId === selectedCycleId) ??
    orderedCycles[0] ??
    null;

  if (!activeCycle) {
    return (
      <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5">
        <EmptyDataNotice
          title="Chưa có chu kỳ nến M15 nào được xử lý"
          reasonVi="Khi nến M15 đóng cửa, bảng kiểm tra chu kỳ sẽ hiển thị trạng thái thị trường, quyết định chiến lược và kết quả kiểm duyệt rủi ro."
          lastUpdatedIso={state.lastUpdatedSystemTime}
        />
      </section>
    );
  }

  const regClass = activeCycle.regimeClassification;
  const coord = activeCycle.coordinatorDecision;
  const risk = activeCycle.riskDecision;

  return (
    <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-5">
      <SectionHeader
        title="Kiểm tra chu kỳ quyết định nến M15"
        subtitle="Tóm tắt nến đã đóng, trạng thái thị trường, lựa chọn chiến lược và kết quả kiểm soát rủi ro"
        rightSlot={
          <select
            aria-label="Chọn chu kỳ nến M15"
            value={activeCycle.cycleId}
            onChange={(e) => setSelectedCycleId(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            {orderedCycles.map((c) => (
              <option key={c.cycleId} value={c.cycleId}>
                {c.cycleId} ({formatUtcShort(c.candle.closeTime)})
              </option>
            ))}
          </select>
        }
      />

      {/* Top Human-Readable Summary Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200">1. Nến M15 &amp; Trạng thái</span>
            {regClass && (
              <StatusLabel
                label={REGIME_LABELS_VI[regClass.regime]}
                tone={REGIME_BADGE_TONES[regClass.regime]}
              />
            )}
          </div>
          <div className="text-slate-300">
            Giá đóng cửa:{' '}
            <strong className="font-mono tabular-nums text-slate-100">
              {formatPrice(activeCycle.candle.close)}
            </strong>{' '}
            (Spread: <span className="font-mono">{activeCycle.candle.spreadPts} pts</span>)
          </div>
          <p className="text-slate-400 leading-relaxed">
            {regClass ? regClass.reasonVi : activeCycle.validation.reasonVi}
          </p>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200">2. Lựa chọn chiến lược</span>
            <StatusLabel
              label={
                coord?.action === 'SELECT_STRATEGY'
                  ? formatStrategyNameVi(coord.selectedStrategyId)
                  : 'Đứng ngoài'
              }
              tone={coord?.action === 'SELECT_STRATEGY' ? 'cyan' : 'amber'}
            />
          </div>
          <p className="text-slate-300 leading-relaxed">
            {coord ? coord.reasonVi : 'Không phát sinh đánh giá chiến lược.'}
          </p>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200">3. Chốt kiểm soát rủi ro</span>
            {risk ? (
              <StatusLabel
                label={
                  risk.approved
                    ? `Duyệt ${formatLots(risk.approvedLots)}`
                    : 'Bị chặn rủi ro'
                }
                tone={risk.approved ? 'emerald' : 'rose'}
              />
            ) : (
              <StatusLabel label="Không phát sinh lệnh" tone="slate" />
            )}
          </div>
          <p className="text-slate-300 leading-relaxed">
            {risk
              ? risk.reasonVi
              : 'Chu kỳ đứng ngoài nên không gửi yêu cầu mở lệnh qua chốt rủi ro.'}
          </p>
        </div>
      </div>

      {/* Progressive Disclosure: Multi-timeframe candidates, indicators, and technical codes */}
      <details className="group bg-slate-950/80 border border-slate-800 rounded-lg p-3.5 text-xs">
        <summary className="cursor-pointer list-none flex items-center justify-between font-medium text-cyan-300 hover:text-cyan-200">
          <span>
            Mở rộng bảng ứng viên đa khung (M15/H1/H4), chỉ báo kỹ thuật &amp; mã định danh chu kỳ
          </span>
          <span className="font-mono text-[11px] text-slate-400 group-open:rotate-180 transition-transform">
            ▼
          </span>
        </summary>

        <div className="mt-3 pt-3 border-t border-slate-800 space-y-4">
          <div className="flex flex-wrap gap-2 font-mono text-[11px]">
            <StatusLabel label={`Mã chu kỳ: ${activeCycle.cycleId}`} tone="slate" mono />
            <StatusLabel label={`Mã nến: ${activeCycle.candle.candleId}`} tone="slate" mono />
            {coord && (
              <StatusLabel label={`Chính sách: ${coord.activePolicyId}`} tone="cyan" mono />
            )}
            {risk && (
              <StatusLabel label={`Mã tín hiệu: ${risk.signalId}`} tone="slate" mono />
            )}
          </div>

          {regClass && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 font-mono text-[11px] text-slate-300 bg-slate-900/80 p-2.5 rounded border border-slate-800">
              <div>
                EMA20/50: {regClass.indicators.emaFast20.toFixed(1)}/
                {regClass.indicators.emaSlow50.toFixed(1)}
              </div>
              <div>ADX: {regClass.indicators.adxProxy.toFixed(1)}</div>
              <div>RSI(14): {regClass.indicators.rsi14.toFixed(1)}</div>
              <div>ATR(14): ${regClass.indicators.atr14.toFixed(2)}</div>
              <div>ATR Ratio: {regClass.indicators.atrRatio.toFixed(2)}x</div>
              <div>BB Width: {regClass.indicators.bbWidthPct.toFixed(2)}%</div>
            </div>
          )}

          {risk && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] text-slate-300 bg-slate-900/80 p-2.5 rounded border border-slate-800">
              <div>
                Khối lượng: {risk.requestedLots.toFixed(2)} → {risk.approvedLots.toFixed(2)} lot
              </div>
              <div>
                Ngân sách rủi ro: {formatPct(risk.effectiveRiskBudgetPct ?? 1)} (
                {formatUsd(risk.effectiveRiskBudgetUsd)})
              </div>
              <div>
                Đệm P95 SL:{' '}
                {risk.slOvershootBuffer
                  ? `$${risk.slOvershootBuffer.effectiveBufferUsdPerOz.toFixed(2)}/oz`
                  : '$0.10/oz'}
              </div>
              <div>
                Sụt giảm ngày/tổng: {formatPct(risk.dailyDrawdownPct)} /{' '}
                {formatPct(risk.currentDrawdownPct)}
              </div>
            </div>
          )}

          {coord && coord.candidatesConsidered.length > 0 && (
            <div className="w-full max-w-full overflow-x-auto overscroll-x-contain rounded border border-slate-800">
              <table className="w-full text-left border-collapse min-w-[600px] text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900 text-slate-400 text-[11px]">
                    <th className="py-2 px-2.5">Chiến lược &amp; Mã</th>
                    <th className="py-2 px-2.5">Khung</th>
                    <th className="py-2 px-2.5">Điều kiện</th>
                    <th className="py-2 px-2.5">Chiều / Giá vào</th>
                    <th className="py-2 px-2.5">SL / TP1 / TP2</th>
                    <th className="py-2 px-2.5">Chi tiết</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {coord.candidatesConsidered.map((cand) => (
                    <tr
                      key={`${cand.strategyId}-${cand.version}`}
                      className={
                        coord.selectedStrategyId === cand.strategyId
                          ? 'bg-cyan-950/25'
                          : 'hover:bg-slate-900/40'
                      }
                    >
                      <td className="py-2 px-2.5 text-cyan-300">
                        <span className="font-sans text-slate-200 font-medium">
                          {formatStrategyNameVi(cand.strategyId)}
                        </span>{' '}
                        <span className="text-[11px] text-slate-400">
                          ({cand.strategyId}@{cand.version})
                        </span>
                      </td>
                      <td className="py-2 px-2.5 text-slate-300">
                        {cand.contextTimeframe ?? 'M15'}
                      </td>
                      <td className="py-2 px-2.5">
                        <span
                          className={
                            cand.eligibleToEnter ? 'text-emerald-300' : 'text-amber-300'
                          }
                        >
                          {cand.eligibleToEnter ? 'Đủ điều kiện' : 'Bỏ qua'}
                        </span>
                      </td>
                      <td className="py-2 px-2.5 text-slate-200">
                        {cand.direction
                          ? `${cand.direction} @ ${formatPrice(cand.entryPrice)}`
                          : '—'}
                      </td>
                      <td className="py-2 px-2.5 text-slate-400">
                        {cand.stopLoss
                          ? `${formatPrice(cand.stopLoss)} / ${formatPrice(
                              cand.takeProfit1
                            )} / ${formatPrice(cand.takeProfit2)}`
                          : '—'}
                      </td>
                      <td className="py-2 px-2.5 font-sans text-slate-300">
                        {cand.skipReasonVi || cand.entryConditionSummaryVi}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </section>
  );
};
