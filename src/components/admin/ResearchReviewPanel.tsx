import { useState } from 'react';
import { buildAuthHeaders } from '../../api/quantApi.ts';
import type { WalkForwardReview } from '../../research/walkForwardReview.ts';
import { formatStrategyNameVi, formatSignedUsd, formatUtcShort } from '../../utils/formatters.ts';
import { REGIME_LABELS_VI, type MarketRegime } from '../../quant/types.ts';

type ReviewState = { status: 'idle' | 'loading' | 'error' } |
  { status: 'ready'; review: WalkForwardReview };

const forwardLabels = {
  MISSING_POLICY: 'Thiếu chính sách đối chiếu',
  WINDOW_IN_PROGRESS: 'Cửa sổ kiểm định còn mở',
  SAME_STRATEGY: 'Trùng chiến lược đang đối chiếu',
  INSUFFICIENT_SAMPLES: 'Chưa đủ mẫu',
  OUTPERFORMED: 'Vượt đối chiếu trong cửa sổ này',
  DID_NOT_OUTPERFORM: 'Chưa vượt tiêu chí đối chiếu',
} as const;

export function ResearchReviewPanel({ runId, token, host }: {
  runId: string;
  token: string;
  host?: string | null;
}) {
  const [state, setState] = useState<ReviewState>({ status: 'idle' });

  async function loadReview() {
    setState({ status: 'loading' });
    try {
      const response = await fetch('/api/research/walk-forward/' + encodeURIComponent(runId), {
        headers: buildAuthHeaders(token, host),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      setState({ status: 'ready', review: await response.json() });
    } catch {
      setState({ status: 'error' });
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-100">Rà soát ứng viên bằng LangGraph</h3>
        <button type="button" onClick={loadReview} disabled={state.status === 'loading'}
          className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-60">
          {state.status === 'loading' ? 'Đang rà soát…' : 'Rà soát tập huấn luyện'}
        </button>
      </div>
      <div aria-live="polite" className="space-y-2 text-sm text-slate-300">
        {state.status === 'error' && <p>Không tải được kết quả rà soát. Hãy thử lại.</p>}
        {state.status === 'ready' && (
          <>
            <p>{state.review.eligibleCount}/{state.review.screenedCount} ứng viên đạt ngưỡng mẫu và lãi ròng dương ở cả 1× và 2× chi phí.</p>
            {state.review.candidates.length > 0 ? (
              <ul className="space-y-2">
                {state.review.candidates.map(row => (
                  <li key={row.regime} className="rounded-md border border-slate-800 p-3">
                    <div className="font-medium">{REGIME_LABELS_VI[row.regime as MarketRegime]} · {formatStrategyNameVi(row.strategyId)} · {row.strategyVersion}</div>
                    <div className="mt-1 text-slate-400">
                      {row.samples} mẫu · Lãi 1× {formatSignedUsd(row.netPnlUsd)} · Lãi 2× {formatSignedUsd(row.netPnlAt2xCostUsd)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p>Chưa có ứng viên đạt điều kiện sàng lọc.</p>}
            <div className="space-y-2 border-t border-slate-800 pt-3">
              <h4 className="font-medium">Kiểm định trên 24 giờ tiếp theo</h4>
              <p className="text-slate-400">
                Đến {formatUtcShort(state.review.forwardComparison.endMarketTime)} ·
                Chính sách đối chiếu {state.review.forwardComparison.referencePolicyId}
              </p>
              {!state.review.forwardComparison.complete && (
                <p className="text-amber-200">Dữ liệu chưa phủ hết cửa sổ. Kết quả hiện tại là tạm thời.</p>
              )}
              {state.review.forwardComparison.comparisons.map(row => (
                <div key={row.regime} className="space-y-1 rounded-md border border-slate-800 p-3">
                  <p>{REGIME_LABELS_VI[row.regime as MarketRegime]} · {forwardLabels[row.status]}</p>
                  <p>Ứng viên · {row.metrics.tradesCount} lệnh · Lãi 1× {formatSignedUsd(row.metrics.netPnlAfterCostUsd)} · Lãi 2× {formatSignedUsd(row.metrics.netPnlAt2xCostUsd)} · Sụt giảm {formatSignedUsd(row.metrics.maxDrawdownUsd)}</p>
                  {row.policyMetrics && <p>Đối chiếu · {row.policyMetrics.tradesCount} lệnh · Lãi 1× {formatSignedUsd(row.policyMetrics.netPnlAfterCostUsd)} · Lãi 2× {formatSignedUsd(row.policyMetrics.netPnlAt2xCostUsd)} · Sụt giảm {formatSignedUsd(row.policyMetrics.maxDrawdownUsd)}</p>}
                </div>
              ))}
              <p className="text-slate-400">Kết quả mô phỏng theo từng trạng thái thị trường.</p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
