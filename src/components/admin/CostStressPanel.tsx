import React from 'react';
import type { DualCostStressComparison } from '../../quant/costStress.ts';
import { formatPct, formatSignedUsd, formatUsd } from '../../utils/formatters.ts';
import { SectionHeader, StatusLabel } from '../shared/UiPrimitives.tsx';

export const CostStressPanel: React.FC<{
  stressReport: DualCostStressComparison | null;
  actionPending: boolean;
  onRunCostStress: () => void;
}> = ({ stressReport, actionPending, onRunCostStress }) => {
  return (
    <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
      <SectionHeader
        title="Kiểm định sức chịu tải chi phí 2× & Độ trễ khớp lệnh"
        subtitle="Phân biệt rõ giữa tính lại hậu kiểm trên các lệnh đã khớp và chạy lại mô phỏng toàn phần với chi phí 2× + độ trễ"
        rightSlot={
          <button
            type="button"
            disabled={actionPending}
            onClick={onRunCostStress}
            className="px-3 py-1.5 text-xs font-medium rounded bg-cyan-950/70 hover:bg-cyan-900/70 text-cyan-200 border border-cyan-500/40 transition-colors cursor-pointer disabled:opacity-50"
          >
            {actionPending ? 'Đang cập nhật...' : 'Làm mới kiểm định chi phí 2×'}
          </button>
        }
      />

      {!stressReport ? (
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-4 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2">
          <span>Đang đồng bộ báo cáo chịu tải chi phí 2× và độ trễ từ máy chủ...</span>
          <StatusLabel label="Đang tải" tone="slate" />
        </div>
      ) : (
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-100">
                  1. Hậu kiểm chi phí 2× trên lệnh đã khớp
                </h3>
                <StatusLabel label="Giữ nguyên điểm vào/ra" tone="cyan" />
              </div>
              <p className="text-slate-400 leading-relaxed">
                {stressReport.postHoc2xAnalysis.descriptionVi}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1 font-mono">
                <div className="bg-slate-900 p-2.5 rounded border border-slate-800">
                  <div className="text-[11px] font-sans text-slate-400">Lãi/Lỗ ròng ở phí 1×</div>
                  <div className="text-sm font-semibold text-slate-100 tabular-nums">
                    {formatSignedUsd(stressReport.postHoc2xAnalysis.netPnl1xUsd)}
                  </div>
                </div>
                <div className="bg-slate-900 p-2.5 rounded border border-slate-800">
                  <div className="text-[11px] font-sans text-slate-400">Lãi/Lỗ ròng ở phí 2×</div>
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      stressReport.postHoc2xAnalysis.netPnlElevatedUsd >= 0
                        ? 'text-emerald-300'
                        : 'text-rose-300'
                    }`}
                  >
                    {formatSignedUsd(stressReport.postHoc2xAnalysis.netPnlElevatedUsd)}
                  </div>
                </div>
              </div>
              <div className="text-slate-400 flex flex-wrap justify-between gap-2 pt-1">
                <span>Số lệnh đánh giá: {stressReport.postHoc2xAnalysis.tradesEvaluated}</span>
                <span>
                  Tổng phí 1× → 2×: {formatUsd(stressReport.postHoc2xAnalysis.cost1xUsd)} →{' '}
                  {formatUsd(stressReport.postHoc2xAnalysis.costElevatedUsd)}
                </span>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-100">
                  2. Chạy lại mô phỏng toàn phần (Phí 2× + Độ trễ)
                </h3>
                <StatusLabel label="Mô phỏng lại đường đi vốn" tone="emerald" />
              </div>
              <p className="text-slate-400 leading-relaxed">
                {stressReport.fullReSimulation2x.descriptionVi}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1 font-mono">
                <div className="bg-slate-900 p-2.5 rounded border border-slate-800">
                  <div className="text-[11px] font-sans text-slate-400">Số dư cuối kỳ mô phỏng lại</div>
                  <div className="text-sm font-semibold text-cyan-300 tabular-nums">
                    {formatUsd(stressReport.fullReSimulation2x.finalBalanceUsd)}
                  </div>
                </div>
                <div className="bg-slate-900 p-2.5 rounded border border-slate-800">
                  <div className="text-[11px] font-sans text-slate-400">Lãi/Lỗ ròng toàn trình</div>
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      stressReport.fullReSimulation2x.netPnlUsd >= 0
                        ? 'text-emerald-300'
                        : 'text-rose-300'
                    }`}
                  >
                    {formatSignedUsd(stressReport.fullReSimulation2x.netPnlUsd)}
                  </div>
                </div>
              </div>
              <div className="text-slate-400 flex flex-wrap justify-between gap-2 pt-1">
                <span>
                  Lệnh khớp: {stressReport.fullReSimulation2x.tradesExecuted} (Thắng:{' '}
                  {formatPct(stressReport.fullReSimulation2x.winRatePct, 1)})
                </span>
                <span>
                  Sụt giảm tối đa: {formatUsd(stressReport.fullReSimulation2x.maxDrawdownUsd)}
                </span>
              </div>
            </div>
          </div>

          <details className="bg-slate-950/70 border border-slate-800 rounded p-2.5 font-mono text-[11px] text-slate-400">
            <summary className="cursor-pointer font-sans text-cyan-300 hover:text-cyan-200 font-medium">
              Mở rộng tham số kỹ thuật &amp; chênh lệch đường đi mô phỏng
            </summary>
            <div className="mt-2 pt-2 border-t border-slate-800 space-y-1">
              <div className="font-sans text-slate-300">{stressReport.comparisonSummaryVi}</div>
              <div>
                Mã báo cáo 1: {stressReport.postHoc2xAnalysis.reportType} | Mã báo cáo 2:{' '}
                {stressReport.fullReSimulation2x.reportType}
              </div>
              <div>
                Độ trễ vào/ra: {stressReport.fullReSimulation2x.entryLatencyMs}ms /{' '}
                {stressReport.fullReSimulation2x.exitLatencyMs}ms | Trượt giá cộng thêm:{' '}
                {stressReport.fullReSimulation2x.extraSlippagePts} pts
              </div>
            </div>
          </details>
        </div>
      )}
    </section>
  );
};
