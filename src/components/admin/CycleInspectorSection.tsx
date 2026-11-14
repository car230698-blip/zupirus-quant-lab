import React, { useState } from 'react';
import {
  QuantSystemState,
  REGIME_LABELS_VI,
} from '../../quant/types.ts';
import {
  formatPct,
  formatPrice,
  formatUsd,
  formatUtcShort,
  REGIME_BADGE_TONES,
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
          reasonVi="Khi nến M15 đóng cửa, bảng kiểm tra chu kỳ sẽ hiển thị đầy đủ kiểm tra tính hợp lệ OHLC, chỉ báo phân loại trạng thái thị trường, các ứng viên đa khung thời gian (M15/H1/H4) và quyết định của Chốt rủi ro."
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
        title="Kiểm tra Chu kỳ Nến M15, Trạng thái Thị trường, Ứng viên & Chốt Rủi ro"
        subtitle="Tra cứu toàn bộ dữ liệu quyết định tại từng nến M15 đã đóng"
        rightSlot={
          <select
            aria-label="Chọn chu kỳ nến M15"
            value={activeCycle.cycleId}
            onChange={(e) => setSelectedCycleId(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            {orderedCycles.map((c) => (
              <option key={c.cycleId} value={c.cycleId}>
                {c.cycleId} — {c.candle.candleId} ({formatUtcShort(c.candle.closeTime)})
              </option>
            ))}
          </select>
        }
      />

      {/* 1. Closed Candle Validation & Regime Classification */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-cyan-300">
              1. Kiểm định Nến Đóng ({activeCycle.candle.candleId})
            </span>
            <StatusLabel
              label={activeCycle.validation.valid ? 'NẾN HỢP LỆ' : 'NẾN LỖI'}
              tone={activeCycle.validation.valid ? 'emerald' : 'rose'}
              mono
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums text-slate-300">
            <div>Open: {formatPrice(activeCycle.candle.open)}</div>
            <div>High: {formatPrice(activeCycle.candle.high)}</div>
            <div>Low: {formatPrice(activeCycle.candle.low)}</div>
            <div>Close: {formatPrice(activeCycle.candle.close)}</div>
          </div>
          <div className="font-mono tabular-nums text-slate-400">
            Giờ đóng (Market): {formatUtcShort(activeCycle.candle.closeTime)} · Spread:{' '}
            {activeCycle.candle.spreadPts} pts · Vol: {activeCycle.candle.volume}
          </div>
          <div className="text-slate-300">{activeCycle.validation.reasonVi}</div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-cyan-300">
              2. Nhận diện Trạng thái Thị trường (Regime)
            </span>
            {regClass && (
              <StatusLabel
                label={REGIME_LABELS_VI[regClass.regime]}
                tone={REGIME_BADGE_TONES[regClass.regime]}
              />
            )}
          </div>
          {regClass ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono tabular-nums text-slate-300">
                <div>EMA20/50: {regClass.indicators.emaFast20.toFixed(1)}/{regClass.indicators.emaSlow50.toFixed(1)}</div>
                <div>ADX Proxy: {regClass.indicators.adxProxy.toFixed(1)}</div>
                <div>RSI(14): {regClass.indicators.rsi14.toFixed(1)}</div>
                <div>ATR(14): ${regClass.indicators.atr14.toFixed(2)}</div>
                <div>ATR Ratio: {regClass.indicators.atrRatio.toFixed(2)}x</div>
                <div>BB Width: {regClass.indicators.bbWidthPct.toFixed(2)}%</div>
              </div>
              <div className="text-slate-300">{regClass.reasonVi}</div>
            </>
          ) : (
            <div className="text-slate-400">Không có phân loại trạng thái.</div>
          )}
        </div>
      </div>

      {/* 2. Multi-Timeframe Strategy Candidates Considered */}
      {coord && (
        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-cyan-300">
              3. Đánh giá Ứng viên Chiến lược Đa khung (Chính sách: {coord.activePolicyId})
            </span>
            <StatusLabel
              label={
                coord.action === 'SELECT_STRATEGY'
                  ? `CHỌN: ${coord.selectedStrategyId}`
                  : 'STAND_ASIDE (ĐỨNG NGOÀI)'
              }
              tone={coord.action === 'SELECT_STRATEGY' ? 'emerald' : 'amber'}
              mono
            />
          </div>
          <p className="text-slate-300">{coord.reasonVi}</p>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-3 font-medium">Chiến lược</th>
                  <th className="py-2 px-3 font-medium">Khung bối cảnh</th>
                  <th className="py-2 px-3 font-medium">Đủ điều kiện</th>
                  <th className="py-2 px-3 font-medium">Chiều / Giá vào</th>
                  <th className="py-2 px-3 font-medium">SL / TP1 / TP2</th>
                  <th className="py-2 pl-3 font-medium">Lý do / Điều kiện</th>
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
                    <td className="py-2 pr-3 text-cyan-300">
                      {cand.strategyId} ({cand.version})
                    </td>
                    <td className="py-2 px-3 text-slate-300">
                      {cand.contextTimeframe ?? 'M15'} (Đóng:{' '}
                      {formatUtcShort(cand.contextClosedAt)})
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={
                          cand.eligibleToEnter ? 'text-emerald-300' : 'text-amber-300'
                        }
                      >
                        {cand.eligibleToEnter ? 'Đủ điều kiện' : 'Bỏ qua'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-200">
                      {cand.direction
                        ? `${cand.direction} @ ${formatPrice(cand.entryPrice)}`
                        : '—'}
                    </td>
                    <td className="py-2 px-3 text-slate-400">
                      {cand.stopLoss
                        ? `${formatPrice(cand.stopLoss)} / ${formatPrice(
                            cand.takeProfit1
                          )} / ${formatPrice(cand.takeProfit2)}`
                        : '—'}
                    </td>
                    <td className="py-2 pl-3 font-sans text-slate-300">
                      {cand.skipReasonVi || cand.entryConditionSummaryVi}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Risk Gate Decision & P95 SL Overshoot Buffer */}
      {risk && (
        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-cyan-300">
              4. Quyết định Chốt Rủi ro Độc lập (Risk Gate — {risk.signalId})
            </span>
            <StatusLabel
              label={
                risk.approved
                  ? `DUYỆT ${risk.approvedLots.toFixed(2)} LOT`
                  : `PHỦ QUYẾT (${risk.vetoCode})`
              }
              tone={risk.approved ? 'emerald' : 'rose'}
              mono
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums text-slate-300">
            <div>
              Khối lượng yêu cầu / duyệt: {risk.requestedLots.toFixed(2)} →{' '}
              <strong className="text-slate-100">{risk.approvedLots.toFixed(2)} lot</strong>
            </div>
            <div>
              Ngân sách rủi ro hiệu dụng:{' '}
              {formatPct(risk.effectiveRiskBudgetPct ?? 1)} (
              {formatUsd(risk.effectiveRiskBudgetUsd)})
            </div>
            <div>
              Đệm trượt SL P95:{' '}
              {risk.slOvershootBuffer
                ? `$${risk.slOvershootBuffer.effectiveBufferUsdPerOz.toFixed(2)}/oz (${
                    risk.slOvershootBuffer.sampleCount
                  } mẫu)`
                : '$0.10/oz'}
            </div>
            <div>
              Sụt giảm ngày / tổng: {formatPct(risk.dailyDrawdownPct)} /{' '}
              {formatPct(risk.currentDrawdownPct)}
            </div>
          </div>
          <div className="text-slate-200">{risk.reasonVi}</div>
        </div>
      )}
    </section>
  );
};
