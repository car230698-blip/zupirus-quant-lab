import React, { useState } from 'react';
import {
  QuantSystemState,
  REGIME_LABELS_VI,
  ReplayDatasetMetadata,
  SimulatedPosition,
} from '../quant/types.ts';

interface UserPortfolioViewProps {
  state: QuantSystemState;
  datasetMetadata: ReplayDatasetMetadata;
  isStaleData: boolean;
  onInspectPositionInAdmin: (positionId: string) => void;
}

export const UserPortfolioView: React.FC<UserPortfolioViewProps> = ({
  state,
  datasetMetadata,
  isStaleData,
  onInspectPositionInAdmin,
}) => {
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'CLOSED' | 'PARTIAL'>('ALL');
  const [selectedPosition, setSelectedPosition] = useState<SimulatedPosition | null>(null);

  const netPnlTotal = Number(
    (state.equityUsd - state.initialBalanceUsd).toFixed(2)
  );
  const netReturnPct = Number(
    ((netPnlTotal / state.initialBalanceUsd) * 100).toFixed(2)
  );

  const totalTrades = state.closedPositions.length;
  const winningTrades = state.closedPositions.filter((p) => p.netPnlUsd > 0).length;
  const winRatePct =
    totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(1) : '0.0';

  const latestTrace =
    state.cycleTraces.length > 0
      ? state.cycleTraces[state.cycleTraces.length - 1]
      : null;

  const filteredHistory = [...state.closedPositions]
    .reverse()
    .filter((pos) => {
      if (statusFilter === 'PARTIAL') return pos.partialTp1Hit;
      if (statusFilter === 'CLOSED') return pos.reconciled;
      return true;
    });

  // Build SVG path for Equity & Balance Curve
  const points = state.equityCurve;
  const chartWidth = 860;
  const chartHeight = 220;
  const minVal =
    points.length > 0
      ? Math.min(
          state.initialBalanceUsd * 0.995,
          ...points.map((p) => Math.min(p.equityUsd, p.balanceUsd))
        )
      : 9950;
  const maxVal =
    points.length > 0
      ? Math.max(
          state.initialBalanceUsd * 1.01,
          ...points.map((p) => Math.max(p.equityUsd, p.balanceUsd))
        )
      : 10100;
  const range = Math.max(10, maxVal - minVal);

  const toX = (idx: number) =>
    points.length <= 1
      ? 24
      : 24 + (idx / (points.length - 1)) * (chartWidth - 48);
  const toY = (val: number) =>
    chartHeight - 24 - ((val - minVal) / range) * (chartHeight - 48);

  const equityPolyline = points
    .map((p, i) => `${toX(i).toFixed(1)},${toY(p.equityUsd).toFixed(1)}`)
    .join(' ');
  const balancePolyline = points
    .map((p, i) => `${toX(i).toFixed(1)},${toY(p.balanceUsd).toFixed(1)}`)
    .join(' ');

  return (
    <div className="space-y-8">
      {/* Simulation Mode & Data Provenance Disclosure Bar */}
      <section
        aria-label="Thông tin chế độ mô phỏng"
        className="border border-slate-800 bg-slate-900/70 p-5 rounded-lg flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
      >
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-300 font-medium">
            <span>Chế độ vận hành: Mô phỏng (SIMULATION_ONLY)</span>
            <span aria-hidden="true">·</span>
            <span>Tài sản: {state.symbol} ({state.timeframe})</span>
            <span aria-hidden="true">·</span>
            <span>Broker mô phỏng nội bộ (Chưa kết nối MT5/Live Broker)</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-100 tracking-tight">
            Tổng quan Tài khoản Mô phỏng Định lượng
          </h1>
          <p className="text-xs text-slate-400 max-w-3xl">
            Nguồn dữ liệu: {datasetMetadata.datasetId} — {datasetMetadata.sourceDescription}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-xs text-slate-300 font-mono tabular-nums shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-800">
          <div>
            <span className="block text-slate-400 font-sans">Giờ thị trường (Nến đóng)</span>
            <span className="text-slate-100 font-medium">
              {state.lastProcessedMarketTime
                ? state.lastProcessedMarketTime.replace('T', ' ').slice(0, 19) + ' UTC'
                : 'Đang chờ nến đầu tiên'}
            </span>
          </div>
          <div>
            <span className="block text-slate-400 font-sans">Giờ hệ thống cập nhật</span>
            <span className="text-slate-100 font-medium">
              {state.lastUpdatedSystemTime.replace('T', ' ').slice(0, 19)} UTC
            </span>
          </div>
          <div>
            <span className="block text-slate-400 font-sans">Tiến độ phát lại</span>
            <span className="text-amber-300 font-medium">
              {state.replayCursorIndex}/{state.totalReplayCandles} nến M15
            </span>
          </div>
        </div>
      </section>

      {/* Stale Data Warning if applicable */}
      {(state.isReplayComplete || !state.isLoopRunning || isStaleData) && (
        <div
          role="status"
          className={`border px-4 py-3 rounded-lg text-xs flex flex-wrap gap-2 items-center justify-between ${
            state.isReplayComplete
              ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-200'
              : 'border-amber-700/60 bg-amber-950/30 text-amber-200'
          }`}
        >
          <span>
            {state.isReplayComplete ? 'Đã hoàn tất phát lại'
              : isStaleData ? 'Vòng phát lại chưa cập nhật trong hơn 15 giây'
              : 'Đang tạm dừng phát lại'}
            {' · '}{state.replayCursorIndex}/{state.totalReplayCandles} nến
            {state.isReplayComplete && ` · ${state.openPositions.length} vị thế còn mở tại nến cuối`}
          </span>
          <span className="font-mono tabular-nums">
            Cập nhật cuối {state.lastUpdatedSystemTime.slice(11, 19)} UTC
          </span>
        </div>
      )}

      {/* Primary Financial KPI Strip */}
      <section
        aria-label="Chỉ số tài chính cốt lõi"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <div className="border border-slate-800 bg-slate-900/60 p-5 rounded-lg">
          <div className="text-xs text-slate-400">Số dư đã đối soát (Balance)</div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-slate-100">
            ${state.balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-2 text-xs text-slate-400 font-mono tabular-nums">
            Vốn khởi tạo: ${state.initialBalanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="border border-slate-800 bg-slate-900/60 p-5 rounded-lg">
          <div className="text-xs text-slate-400">Tài sản ròng thực tế (Equity)</div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-slate-100">
            ${state.equityUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div
            className={`mt-2 text-xs font-mono tabular-nums ${
              netPnlTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            Lãi/Lỗ ròng: {netPnlTotal >= 0 ? '+' : ''}
            {netPnlTotal.toFixed(2)} USD ({netReturnPct >= 0 ? '+' : ''}
            {netReturnPct}%)
          </div>
        </div>

        <div className="border border-slate-800 bg-slate-900/60 p-5 rounded-lg">
          <div className="text-xs text-slate-400">Sụt giảm tài khoản (Drawdown)</div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-slate-100">
            {state.currentDrawdownPct.toFixed(2)}%
          </div>
          <div className="mt-2 text-xs text-slate-400 font-mono tabular-nums">
            Sụt giảm tối đa: {state.maxDrawdownPct.toFixed(2)}% · Trần rủi ro: {state.riskLimits.maxTotalDrawdownPct.toFixed(1)}%
          </div>
        </div>

        <div className="border border-slate-800 bg-slate-900/60 p-5 rounded-lg">
          <div className="text-xs text-slate-400">Hiệu suất & Chính sách đang chạy</div>
          <div className="mt-2 text-lg font-semibold font-mono tabular-nums text-amber-300 truncate">
            {state.activePolicyId}
          </div>
          <div className="mt-2 text-xs text-slate-400 font-mono tabular-nums">
            Đã đối soát: {totalTrades} lệnh · Tỷ lệ thắng: {winRatePct}%
          </div>
        </div>
      </section>

      {/* Equity & Balance Curve Over Time */}
      <section
        aria-label="Biểu đồ kết quả theo thời gian"
        className="border border-slate-800 bg-slate-900/60 p-6 rounded-lg space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Biến động Số dư (Balance) & Tài sản ròng (Equity) theo thời gian thị trường
            </h2>
            <p className="text-xs text-slate-400">
              Trạng thái thị trường hiện tại:{' '}
              <span className="text-slate-200 font-medium">
                {latestTrace?.regimeClassification
                  ? latestTrace.regimeClassification.regimeLabelVi
                  : 'Chưa xác định'}
              </span>{' '}
              · Giá đóng cửa XAUUSD gần nhất:{' '}
              <span className="text-amber-300 font-mono tabular-nums">
                {latestTrace ? `${latestTrace.candle.close.toFixed(2)} USD/oz` : '—'}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-300">
            <span>Đường vàng: Equity (Tài sản ròng)</span>
            <span>·</span>
            <span>Đường xanh: Balance (Số dư đã chốt)</span>
          </div>
        </div>

        {points.length === 0 ? (
          <div className="h-48 flex items-center justify-center border border-dashed border-slate-800 rounded text-xs text-slate-400">
            Đang chờ nến XAUUSD M15 đầu tiên từ bộ phát lại để vẽ đường cong tài sản...
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full h-52 bg-slate-950/60 rounded border border-slate-800/80"
              role="img"
              aria-label="Biểu đồ Equity và Balance theo chu kỳ M15"
            >
              {/* Reference grid lines */}
              {[0.2, 0.5, 0.8].map((ratio, idx) => {
                const y = 24 + ratio * (chartHeight - 48);
                const val = maxVal - ratio * range;
                return (
                  <g key={idx}>
                    <line
                      x1={24}
                      y1={y}
                      x2={chartWidth - 24}
                      y2={y}
                      stroke="#1e293b"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={30}
                      y={y - 5}
                      fill="#64748b"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      ${val.toFixed(0)}
                    </text>
                  </g>
                );
              })}

              {/* Balance line */}
              <polyline
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.75"
                strokeDasharray="3 3"
                points={balancePolyline}
              />

              {/* Equity line */}
              <polyline
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2.5"
                points={equityPolyline}
              />
            </svg>
          </div>
        )}
      </section>

      {/* Open Simulated Positions */}
      <section
        aria-label="Vị thế mô phỏng đang mở"
        className="border border-slate-800 bg-slate-900/60 p-6 rounded-lg space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Vị thế Mô phỏng Đang mở ({state.openPositions.length}/{state.riskLimits.maxOpenPositions})
            </h2>
            <p className="text-xs text-slate-400">
              Mỗi vị thế đang mở giữ nguyên quy tắc quản lý (SL/TP1/TP2/Thời hạn) của phiên bản chính sách đã mở vị thế đó.
            </p>
          </div>
        </div>

        {state.openPositions.length === 0 ? (
          <div className="py-8 text-center border border-dashed border-slate-800 rounded text-xs text-slate-400">
            Hiện không có vị thế XAUUSD nào đang mở. Hệ thống đang theo dõi cơ hội trên nến M15 kế tiếp.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 pr-4 font-medium">Mã vị thế / Chu kỳ</th>
                  <th className="py-2.5 px-3 font-medium">Chiến lược & Chính sách mở</th>
                  <th className="py-2.5 px-3 font-medium">Hướng / Khối lượng</th>
                  <th className="py-2.5 px-3 font-medium text-right">Giá dự kiến / Khớp</th>
                  <th className="py-2.5 px-3 font-medium text-right">SL / TP1 / TP2</th>
                  <th className="py-2.5 px-3 font-medium">Trạng thái đóng</th>
                  <th className="py-2.5 pl-3 font-medium text-right">Lãi/Lỗ tạm tính</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                {state.openPositions.map((pos) => (
                  <tr key={pos.positionId} className="hover:bg-slate-800/40">
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-slate-100">{pos.positionId}</div>
                      <div className="text-slate-400">{pos.entryCycleId}</div>
                    </td>
                    <td className="py-3 px-3 font-sans">
                      <div className="text-slate-200 font-medium">
                        {pos.strategyId}@{pos.strategyVersion}
                      </div>
                      <div className="text-slate-400">
                        Chính sách mở: {pos.openedUnderPolicyId}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={
                          pos.direction === 'BUY' ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'
                        }
                      >
                        {pos.direction}
                      </span>{' '}
                      · Còn {pos.remainingVolumeLots}/{pos.filledVolumeLots} lot
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div>Dự kiến: {pos.expectedEntryPrice.toFixed(2)}</div>
                      <div className="text-slate-300">Khớp: {pos.fillEntryPrice.toFixed(2)}</div>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="text-rose-400">SL: {pos.stopLoss.toFixed(2)}</div>
                      <div className="text-emerald-400">
                        TP1: {pos.takeProfit1.toFixed(2)} / TP2: {pos.takeProfit2.toFixed(2)}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-sans">
                      {pos.status === 'PARTIAL_CLOSED' ? (
                        <span className="text-amber-300 font-medium">
                          Đã đóng một phần (50% tại TP1) · Giữ {pos.remainingVolumeLots} lot
                        </span>
                      ) : (
                        <span className="text-slate-300">
                          Đang mở ({pos.barsHeld}/{pos.maxBarsAllowed} nến M15)
                        </span>
                      )}
                    </td>
                    <td
                      className={`py-3 pl-3 text-right font-semibold ${
                        pos.unrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {pos.unrealizedPnlUsd >= 0 ? '+' : ''}
                      {pos.unrealizedPnlUsd.toFixed(2)} USD
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Closed & Reconciled Trade History */}
      <section
        aria-label="Lịch sử giao dịch đã đối soát"
        className="border border-slate-800 bg-slate-900/60 p-6 rounded-lg space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Lịch sử Giao dịch Mô phỏng & Trạng thái Đối soát ({filteredHistory.length})
            </h2>
            <p className="text-xs text-slate-400">
              Chỉ xác nhận trạng thái &ldquo;Đã đóng hết & Đối soát&rdquo; khi tổng khối lượng đóng bằng đúng khối lượng khớp ban đầu.
            </p>
          </div>

          {/* Interactive Filter Controls */}
          <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'ALL'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Tất cả ({state.closedPositions.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('PARTIAL')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'PARTIAL'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Có đóng một phần TP1 ({state.closedPositions.filter((p) => p.partialTp1Hit).length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('CLOSED')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'CLOSED'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Đã đối soát hoàn tất ({state.closedPositions.filter((p) => p.reconciled).length})
            </button>
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <div className="py-10 text-center border border-dashed border-slate-800 rounded text-xs text-slate-400">
            Chưa có giao dịch hoàn tất nào trong bộ lọc này. Hệ thống sẽ tự động cập nhật ngay khi vị thế đóng và đối soát xong.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 pr-3 font-medium">Mã lệnh / Chu kỳ</th>
                  <th className="py-2.5 px-3 font-medium">Trạng thái thị trường & Chiến lược</th>
                  <th className="py-2.5 px-3 font-medium text-right">Khối lượng (Khớp/Đóng)</th>
                  <th className="py-2.5 px-3 font-medium text-right">Giá vào (Dự kiến / Khớp)</th>
                  <th className="py-2.5 px-3 font-medium text-right">Giá thoát / Chi phí</th>
                  <th className="py-2.5 px-3 font-medium">Trạng thái & Lý do thoát</th>
                  <th className="py-2.5 px-3 font-medium text-right">Lãi/Lỗ ròng</th>
                  <th className="py-2.5 pl-3 font-medium text-right">Truy vết</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                {filteredHistory.map((pos) => (
                  <tr key={pos.positionId} className="hover:bg-slate-800/40">
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-slate-100">{pos.positionId}</div>
                      <div className="text-slate-400">
                        {pos.entryCycleId} → {pos.closeCycleId}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-sans">
                      <div className="text-slate-200 font-medium">
                        {pos.strategyId}@{pos.strategyVersion} ({pos.direction})
                      </div>
                      <div className="text-slate-400">
                        {REGIME_LABELS_VI[pos.regimeAtEntry]} · {pos.openedUnderPolicyId}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div>
                        {pos.closedVolumeLots.toFixed(2)}/{pos.filledVolumeLots.toFixed(2)} lot
                      </div>
                      <div className="text-slate-400 font-sans">
                        {pos.partialTp1Hit ? 'Qua 2 đợt (TP1 + TP2)' : 'Đóng 1 lần'}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div>DK: {pos.expectedEntryPrice.toFixed(2)}</div>
                      <div className="text-slate-300">
                        Khớp: {pos.fillEntryPrice.toFixed(2)} (Trượt {pos.entrySlippagePts}p)
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div>
                        Thoát: {pos.avgExitFillPrice ? pos.avgExitFillPrice.toFixed(2) : '—'}
                      </div>
                      <div className="text-slate-400">
                        Chi phí: -${pos.totalCostUsd.toFixed(2)}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-sans">
                      <div className="text-emerald-400 font-medium">
                        {pos.reconciled ? 'Đã đóng hết & Đối soát khớp' : 'Chưa đối soát đủ'}
                      </div>
                      <div className="text-slate-400 max-w-xs truncate" title={pos.exitReasonVi}>
                        {pos.exitReasonVi}
                      </div>
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-semibold ${
                        pos.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      <div>
                        {pos.netPnlUsd >= 0 ? '+' : ''}
                        {pos.netPnlUsd.toFixed(2)} USD
                      </div>
                      <div className="text-slate-400 font-normal">
                        Gộp: {pos.grossPnlUsd >= 0 ? '+' : ''}
                        {pos.grossPnlUsd.toFixed(2)}
                      </div>
                    </td>
                    <td className="py-3 pl-3 text-right font-sans">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedPosition(
                              selectedPosition?.positionId === pos.positionId ? null : pos
                            )
                          }
                          className="px-2.5 py-1 text-xs border border-slate-700 hover:border-slate-500 text-slate-200 rounded transition-colors whitespace-nowrap shrink-0"
                        >
                          Chi tiết Deal
                        </button>
                        <button
                          type="button"
                          onClick={() => onInspectPositionInAdmin(pos.positionId)}
                          className="px-2.5 py-1 text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded transition-colors whitespace-nowrap shrink-0"
                        >
                          Truy vết Chu kỳ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Selected Position Deal Breakdown Drawer */}
        {selectedPosition && (
          <div className="mt-4 border border-slate-800 bg-slate-950/90 p-4 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">
                Sổ cái Khớp lệnh Từng phần & Đối soát của {selectedPosition.positionId} ({selectedPosition.entryCycleId})
              </h3>
              <button
                type="button"
                onClick={() => setSelectedPosition(null)}
                className="text-xs text-slate-400 hover:text-slate-200 whitespace-nowrap shrink-0"
              >
                Đóng bảng chi tiết
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-300 font-mono tabular-nums">
              <div>
                Khối lượng khớp mở: {selectedPosition.filledVolumeLots} lot · Đã đóng:{' '}
                {selectedPosition.closedVolumeLots} lot
              </div>
              <div>
                Chi phí Spread: ${selectedPosition.totalSpreadCostUsd.toFixed(2)} · Trượt giá: $
                {selectedPosition.totalSlippageCostUsd.toFixed(2)} · Phí GD: $
                {selectedPosition.totalCommissionUsd.toFixed(2)}
              </div>
              <div>
                Lãi ròng 1x chi phí: ${selectedPosition.netPnlUsd.toFixed(2)} · Lãi ròng 2x chi phí: $
                {selectedPosition.netPnlAt2xCostUsd.toFixed(2)}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-1.5 pr-3">Mã Deal</th>
                    <th className="py-1.5 px-3">Chu kỳ / Nến</th>
                    <th className="py-1.5 px-3">Loại khớp</th>
                    <th className="py-1.5 px-3 text-right">Khối lượng</th>
                    <th className="py-1.5 px-3 text-right">Giá dự kiến / Giá khớp</th>
                    <th className="py-1.5 pl-3">Diễn giải</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {selectedPosition.deals.map((d) => (
                    <tr key={d.dealId}>
                      <td className="py-2 pr-3 text-slate-200">{d.dealId}</td>
                      <td className="py-2 px-3 text-slate-400">
                        {d.cycleId} ({d.candleId})
                      </td>
                      <td className="py-2 px-3 text-amber-300">{d.eventType}</td>
                      <td className="py-2 px-3 text-right">{d.volumeLots} lot</td>
                      <td className="py-2 px-3 text-right">
                        {d.expectedPrice.toFixed(2)} → {d.fillPrice.toFixed(2)}
                      </td>
                      <td className="py-2 pl-3 font-sans text-slate-300">{d.noteVi}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
