import React, { useState } from 'react';
import type { LearningBranchFixtureSuiteReport } from '../../quant/fixtures.ts';
import type { QuantSystemState } from '../../quant/types.ts';
import {
  formatPct,
  formatSignedUsd,
  formatStrategyNameVi,
  formatUsd,
  formatUtcShort,
} from '../../utils/formatters.ts';
import {
  EmptyDataNotice,
  MetricCard,
  SectionHeader,
  StatusLabel,
} from '../shared/UiPrimitives.tsx';
import { FixtureBranchesPanel } from './FixtureBranchesPanel.tsx';
import { PolicyComparisonTable } from './PolicyComparisonTable.tsx';

const DECISION_LABELS_VI: Record<string, string> = {
  KEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES: 'Giữ nguyên chính sách (Chưa đủ mẫu)',
  KEEP_CURRENT_POLICY_NO_OUTPERFORMANCE: 'Giữ nguyên chính sách (Ứng viên chưa vượt trội)',
  PROMOTE_NEW_POLICY: 'Kích hoạt chính sách mới',
  ROLLBACK_TO_PREVIOUS_POLICY: 'Quay lui về chính sách an toàn',
  HALT_NEW_POSITIONS_DEGRADED: 'Dừng mở vị thế mới do suy giảm',
};

export interface WalkForwardSectionProps {
  state: QuantSystemState;
  fixtureReport: LearningBranchFixtureSuiteReport | null;
  actionPending: boolean;
  onRefreshReports: () => void;
}

export const WalkForwardSection: React.FC<WalkForwardSectionProps> = ({
  state,
  fixtureReport,
  actionPending,
  onRefreshReports,
}) => {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runs = state.learningRuns.slice().reverse();
  const activeRun =
    runs.find((r) => r.runId === selectedRunId) ?? runs[0] ?? null;

  const closedShadows = state.shadowOutcomes.filter((s) => s.status === 'CLOSED_RECONCILED');
  const openShadowsCount = Object.keys(state.openShadowPositions ?? {}).length;

  return (
    <div className="space-y-6">
      {/* Top Summary Metrics */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Chính sách đang vận hành"
          value={
            state.activePolicyId.includes('BASELINE')
              ? 'Cơ sở cố định (v1)'
              : 'Thích ứng ngoài mẫu'
          }
          subtitle={
            state.riskLimits.haltNewPositionsByLearner
              ? 'Đã tạm dừng mở lệnh mới do suy giảm'
              : 'Đang cho phép mở vị thế theo quy tắc rủi ro'
          }
          tone={state.riskLimits.haltNewPositionsByLearner ? 'rose' : 'cyan'}
          emphasis="primary"
        />

        <MetricCard
          title="Mẫu ứng viên đã đóng"
          value={`${closedShadows.length} mẫu`}
          subtitle={`Đang theo dõi song song: ${openShadowsCount} vị thế mở`}
          tone={closedShadows.length >= 15 ? 'emerald' : 'amber'}
          rightMeta="Yêu cầu ≥ 5 mẫu/trạng thái"
        />

        <MetricCard
          title="Số đợt kiểm định đã chạy"
          value={`${state.learningRuns.length} đợt`}
          subtitle={
            activeRun
              ? `Gần nhất: ${formatUtcShort(activeRun.executedAtMarketTime)}`
              : 'Tự động kích hoạt định kỳ theo chu kỳ nến M15'
          }
          tone="slate"
        />

        <MetricCard
          title="Quyết định gần nhất"
          value={
            activeRun
              ? DECISION_LABELS_VI[activeRun.decision] ?? activeRun.decision
              : 'Đang tích lũy mẫu'
          }
          subtitle={
            activeRun
              ? `Dùng ${activeRun.totalCompletedSamplesUsed} mẫu • Loại ${activeRun.totalExcludedSamples} mẫu chồng lấp`
              : 'Chưa đủ chu kỳ để chạy đợt Walk-Forward đầu tiên'
          }
          tone={
            !activeRun || activeRun.decision.includes('INSUFFICIENT')
              ? 'amber'
              : activeRun.decision === 'PROMOTE_NEW_POLICY'
              ? 'emerald'
              : activeRun.decision.includes('ROLLBACK') || activeRun.decision.includes('HALT')
              ? 'rose'
              : 'cyan'
          }
        />
      </section>

      {/* Policy Comparison Table */}
      <PolicyComparisonTable
        policies={state.policies}
        activePolicyId={state.activePolicyId}
      />

      {/* Walk-Forward Run Inspector */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
        <SectionHeader
          title="Kết quả kiểm định Walk-Forward (Tách biệt Huấn luyện & Ngoài mẫu)"
          subtitle="Chỉ sử dụng các vị thế ứng viên đã đóng hoàn toàn trước mốc cắt để chống nhìn trước dữ liệu (No Look-Ahead)"
          rightSlot={
            runs.length > 0 ? (
              <select
                aria-label="Chọn đợt kiểm định"
                value={activeRun?.runId ?? ''}
                onChange={(e) => setSelectedRunId(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-slate-200 text-xs font-mono rounded px-2.5 py-1.5"
              >
                {runs.map((r) => (
                  <option key={r.runId} value={r.runId}>
                    {r.runId} ({formatUtcShort(r.executedAtMarketTime)})
                  </option>
                ))}
              </select>
            ) : undefined
          }
        />

        {!activeRun ? (
          <EmptyDataNotice
            title="Chưa có đợt kiểm định Walk-Forward"
            reasonVi="Hệ thống tự động chạy kiểm định Walk-Forward định kỳ sau khi xử lý các chu kỳ nến M15."
            lastUpdatedIso={state.lastUpdatedSystemTime}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="bg-slate-950/70 border border-slate-800 rounded p-3 space-y-1">
                <div className="text-slate-400">Kết luận đợt kiểm định</div>
                <div className="text-sm font-semibold text-slate-100">
                  {DECISION_LABELS_VI[activeRun.decision] ?? activeRun.decision}
                </div>
                <p className="text-slate-400 leading-relaxed">{activeRun.decisionReasonVi}</p>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded p-3 space-y-1">
                <div className="text-slate-400">Hiệu quả ngoài mẫu — Ứng viên đề xuất</div>
                <div className="text-sm font-mono font-semibold text-cyan-300">
                  P&amp;L 1×: {formatSignedUsd(activeRun.overallAdaptiveMetrics.netPnlAfterCostUsd)}{' '}
                  | 2×: {formatSignedUsd(activeRun.overallAdaptiveMetrics.netPnlAt2xCostUsd)}
                </div>
                <div className="text-slate-400">
                  Tỷ lệ thắng: {formatPct(activeRun.overallAdaptiveMetrics.winRatePct, 1)} • Sụt giảm tối đa:{' '}
                  {formatUsd(activeRun.overallAdaptiveMetrics.maxDrawdownUsd)}
                </div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded p-3 space-y-1">
                <div className="text-slate-400">Hiệu quả ngoài mẫu — Chính sách cơ sở</div>
                <div className="text-sm font-mono font-semibold text-slate-200">
                  P&amp;L 1×: {formatSignedUsd(activeRun.overallBaselineMetrics.netPnlAfterCostUsd)}{' '}
                  | 2×: {formatSignedUsd(activeRun.overallBaselineMetrics.netPnlAt2xCostUsd)}
                </div>
                <div className="text-slate-400">
                  Mẫu hợp lệ: {activeRun.totalCompletedSamplesUsed} (Huấn luyện:{' '}
                  {activeRun.trainingSampleIds?.length ?? 0} / Kiểm định:{' '}
                  {activeRun.validationSampleIds?.length ?? 0})
                </div>
              </div>
            </div>

            {/* Expandable technical details: regime rankings & anti-leakage exclusions */}
            <details className="group bg-slate-950/80 border border-slate-800 rounded p-3">
              <summary className="cursor-pointer list-none flex items-center justify-between text-xs font-medium text-cyan-300 hover:text-cyan-200">
                <span>
                  Mở rộng bảng xếp hạng ứng viên theo trạng thái &amp; danh sách loại trừ chống rò rỉ ({activeRun.totalExcludedSamples} mẫu)
                </span>
                <span className="font-mono text-[11px] text-slate-400 group-open:rotate-180 transition-transform">
                  ▼
                </span>
              </summary>

              <div className="mt-3 pt-3 border-t border-slate-800 space-y-3 text-xs">
                <div className="flex flex-wrap gap-2 font-mono text-[11px]">
                  <StatusLabel label={`Mã đợt học: ${activeRun.runId}`} tone="slate" mono />
                  <StatusLabel label={`Chu kỳ kích hoạt: ${activeRun.triggerCycleId}`} tone="slate" mono />
                  <StatusLabel
                    label={`Chính sách trước: ${activeRun.previousPolicyId}`}
                    tone="slate"
                    mono
                  />
                  <StatusLabel
                    label={`Chính sách sau: ${activeRun.resultingPolicyId}`}
                    tone="cyan"
                    mono
                  />
                </div>

                {activeRun.hypothesesTested.length > 0 && (
                  <div className="w-full max-w-full overflow-x-auto rounded border border-slate-800">
                    <table className="w-full text-left border-collapse min-w-[560px]">
                      <thead>
                        <tr className="bg-slate-900 text-slate-400 border-b border-slate-800 text-[11px]">
                          <th className="py-2 px-2.5">Trạng thái</th>
                          <th className="py-2 px-2.5">Ứng viên dẫn đầu tập Huấn luyện</th>
                          <th className="py-2 px-2.5">Trạng thái kiểm định</th>
                          <th className="py-2 px-2.5">Ghi chú ngoài mẫu</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {activeRun.hypothesesTested.map((h) => (
                          <tr key={h.hypothesisId} className="text-slate-300">
                            <td className="py-2 px-2.5 font-mono">{h.targetRegime}</td>
                            <td className="py-2 px-2.5">
                              {formatStrategyNameVi(h.proposedStrategyId)}{' '}
                              <span className="font-mono text-cyan-300">({h.proposedVersion})</span>
                            </td>
                            <td className="py-2 px-2.5">
                              <StatusLabel
                                label={
                                  h.validationStatus === 'PROMOTED'
                                    ? 'Đạt ngoài mẫu'
                                    : h.validationStatus === 'REJECTED_INSUFFICIENT_SAMPLES'
                                    ? 'Thiếu mẫu'
                                    : 'Giữ cơ sở'
                                }
                                tone={h.validationStatus === 'PROMOTED' ? 'emerald' : 'amber'}
                              />
                            </td>
                            <td className="py-2 px-2.5 text-slate-400">{h.validationNoteVi}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {activeRun.exclusions.length > 0 && (
                  <div className="text-[11px] font-mono text-slate-400">
                    Mẫu bị loại để chống nhìn trước / chồng lấp ranh giới:{' '}
                    {activeRun.exclusions
                      .slice(0, 8)
                      .map((ex) => `${ex.shadowId} (${ex.exclusionCode})`)
                      .join(', ')}
                    {activeRun.exclusions.length > 8
                      ? ` ... và ${activeRun.exclusions.length - 8} mẫu khác.`
                      : ''}
                  </div>
                )}
              </div>
            </details>
          </div>
        )}
      </section>

      {/* 5-Branch Verification Fixture Suite */}
      <FixtureBranchesPanel
        fixtureReport={fixtureReport}
        actionPending={actionPending}
        onRunFixtures={onRefreshReports}
      />
    </div>
  );
};
