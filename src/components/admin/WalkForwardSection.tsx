import React, { useState } from 'react';
import type { DataProvenanceBadge } from '../../quant/agentActivityTracker.ts';
import type { LearningBranchFixtureSuiteReport } from '../../quant/fixtures.ts';
import {
  MarketRegime,
  QuantSystemState,
  REGIME_LABELS_VI,
} from '../../quant/types.ts';
import {
  formatPct,
  formatSignedUsd,
  formatUsd,
  formatUtcShort,
} from '../../utils/formatters.ts';
import {
  EmptyDataNotice,
  SectionHeader,
  StatusLabel,
} from '../shared/UiPrimitives.tsx';

export interface WalkForwardSectionProps {
  state: QuantSystemState;
  dataProvenance: DataProvenanceBadge;
  fixturesReport: LearningBranchFixtureSuiteReport | null;
}

const REGIME_KEYS: MarketRegime[] = [
  'TRENDING',
  'RANGING',
  'SQUEEZE_PRE_BREAKOUT',
  'VOLATILITY_SHOCK',
  'INSUFFICIENT_DATA',
];

export const WalkForwardSection: React.FC<WalkForwardSectionProps> = ({
  state,
  dataProvenance,
  fixturesReport,
}) => {
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [selectedFixtureBranch, setSelectedFixtureBranch] = useState<string>(
    'PROMOTE_NEW_POLICY'
  );

  const activePolicy =
    state.policies.find((p) => p.policyId === state.activePolicyId) ||
    state.policies[0];
  const baselinePolicy =
    state.policies.find((p) => p.policyId === state.baselinePolicyId) ||
    state.policies[0];

  const orderedRuns = state.learningRuns.slice().reverse();
  const activeRun =
    orderedRuns.find((r) => r.runId === selectedRunId) ?? orderedRuns[0] ?? null;

  return (
    <div className="space-y-6">
      {/* 1. Active Policy vs Baseline Policy Mapping */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
        <SectionHeader
          title="Chính sách Đang Áp dụng & Lịch sử Phiên bản Chính sách"
          subtitle="Bộ học Walk-Forward chỉ cập nhật ánh xạ Trạng thái -> Chiến lược trong mô phỏng, không bao giờ tự nới giới hạn rủi ro"
          rightSlot={
            <StatusLabel
              label={`Nguồn dữ liệu: ${dataProvenance.code}`}
              tone="cyan"
              mono
            />
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 pr-3 font-medium">Trạng thái Thị trường (Regime)</th>
                <th className="py-2 px-3 font-medium">
                  Chính sách Hiện hành ({activePolicy.policyId} v{activePolicy.versionNumber})
                </th>
                <th className="py-2 pl-3 font-medium">
                  Chính sách Cơ sở ({baselinePolicy.policyId})
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono">
              {REGIME_KEYS.map((reg) => {
                const actTarget = activePolicy.mapping[reg];
                const baseTarget = baselinePolicy.mapping[reg];
                return (
                  <tr key={reg} className="hover:bg-slate-800/30">
                    <td className="py-2.5 pr-3 font-sans text-slate-200 font-medium">
                      {REGIME_LABELS_VI[reg]}
                    </td>
                    <td className="py-2.5 px-3 text-cyan-300">
                      {actTarget === 'STAND_ASIDE'
                        ? 'STAND_ASIDE (Đứng ngoài)'
                        : `${actTarget.strategyId} (${actTarget.version})`}
                    </td>
                    <td className="py-2.5 pl-3 text-slate-400">
                      {baseTarget === 'STAND_ASIDE'
                        ? 'STAND_ASIDE (Đứng ngoài)'
                        : `${baseTarget.strategyId} (${baseTarget.version})`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Policy Version History */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
          {state.policies.map((pol) => (
            <div
              key={pol.policyId}
              className={`rounded-lg border p-3 text-xs space-y-1.5 ${
                pol.policyId === state.activePolicyId
                  ? 'bg-cyan-950/25 border-cyan-500/40'
                  : 'bg-slate-950/70 border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold text-slate-100">
                  {pol.policyId} (v{pol.versionNumber})
                </span>
                <StatusLabel
                  label={pol.status}
                  tone={
                    pol.status === 'ACTIVE'
                      ? 'emerald'
                      : pol.status === 'ROLLED_BACK' || pol.status === 'HALTED'
                      ? 'rose'
                      : 'slate'
                  }
                  mono
                />
              </div>
              <div className="font-mono text-[11px] text-slate-400">
                Nguồn: {pol.sourceRunId} · Tạo lúc {formatUtcShort(pol.createdAtMarketTime)}
              </div>
              <p className="text-slate-300 leading-relaxed">{pol.activationReasonVi}</p>
              {pol.rollbackReasonVi && (
                <p className="text-rose-300 leading-relaxed">
                  Lý do quay lui / dừng: {pol.rollbackReasonVi}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 2. Walk-Forward Learning Runs & Out-of-Sample Post-Cost Evaluation */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
        <SectionHeader
          title={`Kiểm định Walk-Forward Ngoài mẫu & Sau chi phí (${state.learningRuns.length} kỳ)`}
          subtitle="Hiển thị các ứng viên được xét, số mẫu đủ/thiếu theo trạng thái, cửa sổ huấn luyện/kiểm định, kết quả tại 1x và 2x chi phí và lý do chọn hành động"
          rightSlot={
            orderedRuns.length > 0 ? (
              <select
                aria-label="Chọn kỳ kiểm định Walk-Forward"
                value={activeRun?.runId || ''}
                onChange={(e) => setSelectedRunId(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                {orderedRuns.map((r) => (
                  <option key={r.runId} value={r.runId}>
                    {r.runId} — {r.decision} ({r.triggerCycleId})
                  </option>
                ))}
              </select>
            ) : undefined
          }
        />

        {!activeRun ? (
          <EmptyDataNotice
            title="Chưa có kỳ kiểm định Walk-Forward trên luồng hiện tại"
            reasonVi="Kỳ kiểm định Walk-Forward đầu tiên tự động kích hoạt tại chu kỳ nến thứ 36 và mỗi 18 chu kỳ tiếp theo. Bạn có thể xem bảng Kiểm định 5 Nhánh bằng Bộ Fixture ngay bên dưới."
            lastUpdatedIso={state.lastUpdatedSystemTime}
          />
        ) : (
          <div className="space-y-4">
            {/* Run Decision Summary Box */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-4 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 font-mono">
                  <span className="text-cyan-300 font-semibold">{activeRun.runId}</span>
                  <span aria-hidden="true">·</span>
                  <span>Chu kỳ kích hoạt: {activeRun.triggerCycleId}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Chính sách: {activeRun.previousPolicyId} → {activeRun.resultingPolicyId}
                  </span>
                </div>
                <StatusLabel
                  label={activeRun.decision}
                  tone={
                    activeRun.decision === 'PROMOTE_NEW_POLICY'
                      ? 'emerald'
                      : activeRun.decision.includes('KEEP')
                      ? 'amber'
                      : 'rose'
                  }
                  mono
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono tabular-nums text-slate-400 pt-1">
                <div>
                  Cửa sổ Huấn luyện (Train):{' '}
                  <span className="text-slate-200">
                    {formatUtcShort(activeRun.trainWindowStartMarketTime)} →{' '}
                    {formatUtcShort(activeRun.trainWindowEndMarketTime)}
                  </span>
                </div>
                <div>
                  Cửa sổ Kiểm định (Validation OOS):{' '}
                  <span className="text-slate-200">
                    {formatUtcShort(activeRun.validationWindowStartMarketTime)} →{' '}
                    {formatUtcShort(activeRun.validationWindowEndMarketTime)}
                  </span>
                </div>
                <div>
                  Mẫu đã đóng hợp lệ:{' '}
                  <strong className="text-emerald-300">
                    {activeRun.totalCompletedSamplesUsed}
                  </strong>{' '}
                  · Mẫu bị loại (chồng lấp/chưa đóng):{' '}
                  <strong className="text-amber-300">
                    {activeRun.totalExcludedSamples}
                  </strong>
                </div>
              </div>
              <p className="text-slate-200 pt-1 leading-relaxed">
                <strong className="text-cyan-300">Lý do quyết định của bộ học: </strong>
                {activeRun.decisionReasonVi}
              </p>
            </div>

            {/* Candidate Rankings & Sample Sufficiency per Regime */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-3 font-medium">Trạng thái (Regime)</th>
                    <th className="py-2 px-3 font-medium">Ứng viên Chiến lược</th>
                    <th className="py-2 px-3 font-medium text-right">
                      Mẫu hợp lệ / Tối thiểu
                    </th>
                    <th className="py-2 px-3 font-medium text-right">Tỷ lệ thắng</th>
                    <th className="py-2 px-3 font-medium text-right">P&amp;L Ròng (1x)</th>
                    <th className="py-2 px-3 font-medium text-right">P&amp;L Ròng (2x)</th>
                    <th className="py-2 px-3 font-medium text-right">Max DD</th>
                    <th className="py-2 pl-3 font-medium text-right">Điểm Xếp hạng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {activeRun.rankingsByRegime.map((rk) => (
                    <tr
                      key={`${rk.regime}-${rk.strategyId}`}
                      className="hover:bg-slate-800/30"
                    >
                      <td className="py-2 pr-3 font-sans text-slate-300">
                        {REGIME_LABELS_VI[rk.regime]}
                      </td>
                      <td className="py-2 px-3 text-cyan-300">
                        {rk.strategyId} ({rk.strategyVersion})
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span
                          className={
                            rk.meetsMinSamples ? 'text-emerald-300' : 'text-amber-300'
                          }
                        >
                          {rk.sampleCount}/{activeRun.minSamplesPerRegime} (
                          {rk.meetsMinSamples ? 'Đủ mẫu' : 'Thiếu mẫu'})
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right text-slate-200">
                        {formatPct(rk.winRatePct, 1)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right ${
                          rk.netPnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {formatSignedUsd(rk.netPnlUsd)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right ${
                          rk.netPnlAt2xCostUsd >= 0
                            ? 'text-emerald-300'
                            : 'text-rose-300'
                        }`}
                      >
                        {formatSignedUsd(rk.netPnlAt2xCostUsd)}
                      </td>
                      <td className="py-2 px-3 text-right text-rose-300">
                        {formatUsd(rk.maxDrawdownUsd)}
                      </td>
                      <td className="py-2 pl-3 text-right font-semibold text-slate-100">
                        {rk.rankingScore.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* 3. Purposeful 5-Branch Walk-Forward Fixture Verification */}
      {fixturesReport && (
        <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
          <SectionHeader
            title="Kiểm định Đầy đủ 5 Nhánh Quyết định của Bộ học Walk-Forward (Fixture Xác định)"
            subtitle="Chứng minh trực tiếp các nhánh giữ nguyên (thiếu mẫu / không vượt trội), tự áp dụng, quay lui và dừng mở vị thế mới ngay cả khi thị trường đóng"
            rightSlot={
              <StatusLabel
                label="Nguồn: FIXTURE_VERIFICATION"
                tone="amber"
                mono
              />
            }
          />

          <div className="flex flex-wrap gap-2">
            {fixturesReport.branches.map((b) => {
              const active = selectedFixtureBranch === b.branchCode;
              return (
                <button
                  key={b.branchCode}
                  type="button"
                  onClick={() => setSelectedFixtureBranch(b.branchCode)}
                  className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-cyan-950/60 border-cyan-400 text-cyan-200 font-semibold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {b.branchCode}
                </button>
              );
            })}
          </div>

          {fixturesReport.branches
            .filter((b) => b.branchCode === selectedFixtureBranch)
            .map((branch) => (
              <div
                key={branch.branchCode}
                className="bg-slate-950/90 border border-slate-800 rounded-lg p-4 space-y-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-display font-semibold text-slate-100 text-sm">
                    {branch.branchNameVi}
                  </div>
                  <StatusLabel
                    label={
                      branch.passed
                        ? `ĐẠT KIỂM ĐỊNH (${branch.branchCode})`
                        : 'KHÔNG ĐẠT'
                    }
                    tone={branch.passed ? 'emerald' : 'rose'}
                    mono
                  />
                </div>
                <p className="text-slate-400">{fixturesReport.disclosureVi}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 font-mono tabular-nums">
                  <div className="bg-slate-900 border border-slate-800 rounded p-2.5">
                    <div className="text-slate-400">Chính sách Trước → Sau</div>
                    <div className="text-cyan-300 mt-1">
                      {branch.previousPolicyId} → {branch.resultingPolicyId}
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded p-2.5">
                    <div className="text-slate-400">Mẫu Huấn luyện (Train)</div>
                    <div className="text-emerald-300 mt-1">
                      {branch.trainSamplesCount} mẫu đóng
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded p-2.5">
                    <div className="text-slate-400">Mẫu Kiểm định / Bị loại</div>
                    <div className="text-slate-200 mt-1">
                      {branch.validationSamplesCount} hợp lệ · {branch.excludedSamplesCount} loại
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded p-2.5">
                    <div className="text-slate-400">Trạng thái Halt Learner</div>
                    <div
                      className={`mt-1 ${
                        branch.haltNewPositionsTriggered
                          ? 'text-rose-300'
                          : 'text-emerald-300'
                      }`}
                    >
                      {branch.haltNewPositionsTriggered
                        ? 'Đã kích hoạt dừng mở mới'
                        : 'Bình thường'}
                    </div>
                  </div>
                </div>
                <div className="pt-2 text-slate-200 leading-relaxed">
                  <strong className="text-cyan-300">Lý do quyết định: </strong>
                  {branch.decisionReasonVi}
                </div>
              </div>
            ))}
        </section>
      )}
    </div>
  );
};
