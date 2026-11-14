import React from 'react';
import type { LearningBranchFixtureSuiteReport } from '../../quant/fixtures.ts';
import { SectionHeader, StatusLabel } from '../shared/UiPrimitives.tsx';

const BRANCH_TITLE_VI: Record<string, string> = {
  KEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES: '1. Giữ nguyên khi chưa đủ mẫu (< 5 mẫu/trạng thái)',
  KEEP_CURRENT_POLICY_NO_OUTPERFORMANCE: '2. Giữ nguyên khi ứng viên không vượt trội ngoài mẫu',
  PROMOTE_NEW_POLICY: '3. Kích hoạt chính sách mới khi vượt trội ngoài mẫu (1× & 2× phí)',
  ROLLBACK_TO_PREVIOUS_POLICY: '4. Tự động quay lui về chính sách an toàn khi suy giảm',
  HALT_NEW_POSITIONS_DEGRADED: '5. Tạm dừng mở vị thế mới khi mọi chính sách đều suy giảm',
};

export const FixtureBranchesPanel: React.FC<{
  fixtureReport: LearningBranchFixtureSuiteReport | null;
  actionPending: boolean;
  onRunFixtures: () => void;
}> = ({ fixtureReport, actionPending, onRunFixtures }) => {
  return (
    <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
      <SectionHeader
        title="Kiểm chứng 5 kịch bản quyết định của bộ học Walk-Forward"
        subtitle="Bộ dữ liệu kiểm thử chuẩn (Fixture) xác nhận bộ học xử lý đúng cả 5 nhánh quyết định"
        rightSlot={
          <button
            type="button"
            disabled={actionPending}
            onClick={onRunFixtures}
            className="px-3 py-1.5 text-xs font-medium rounded bg-cyan-950/70 hover:bg-cyan-900/70 text-cyan-200 border border-cyan-500/40 transition-colors cursor-pointer disabled:opacity-50"
          >
            {actionPending ? 'Đang làm mới...' : 'Làm mới kết quả 5 kịch bản'}
          </button>
        }
      />

      {!fixtureReport ? (
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-4 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2">
          <span>Đang đồng bộ kết quả kiểm chứng 5 kịch bản quyết định từ máy chủ...</span>
          <StatusLabel label="Đang tải" tone="slate" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/80 border border-slate-800 rounded p-3 text-xs">
            <span className="text-slate-200 font-medium">
              Kết quả tổng hợp 5 kịch bản kiểm định:
            </span>
            <StatusLabel
              label={
                fixtureReport.allBranchesPassed
                  ? 'Đạt 5/5 kịch bản quyết định'
                  : 'Có kịch bản chưa khớp'
              }
              tone={fixtureReport.allBranchesPassed ? 'emerald' : 'rose'}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {fixtureReport.branches.map((b) => (
              <div
                key={b.branchCode}
                className="bg-slate-950/70 border border-slate-800 rounded-lg p-3 space-y-2 flex flex-col justify-between"
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-100">
                      {BRANCH_TITLE_VI[b.branchCode] ?? b.branchNameVi}
                    </span>
                    <StatusLabel
                      label={b.passed ? 'Đạt' : 'Lỗi'}
                      tone={b.passed ? 'emerald' : 'rose'}
                    />
                  </div>
                  <p className="text-xs text-slate-400 leading-snug">{b.decisionReasonVi}</p>
                </div>

                <details className="pt-2 border-t border-slate-800/80 text-[11px] font-mono text-slate-400">
                  <summary className="cursor-pointer text-cyan-300 hover:text-cyan-200 font-sans">
                    Thông số mẫu &amp; mã kịch bản
                  </summary>
                  <div className="mt-1.5 space-y-1">
                    <div>Mã nhánh: {b.branchCode}</div>
                    <div>
                      Chính sách: {b.previousPolicyId} → {b.resultingPolicyId}
                    </div>
                    <div>
                      Mẫu Train: {b.trainSamplesCount} | OOS: {b.validationSamplesCount} | Loại trừ:{' '}
                      {b.excludedSamplesCount}
                    </div>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
