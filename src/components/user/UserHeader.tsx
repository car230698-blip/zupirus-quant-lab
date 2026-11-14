import React from 'react';
import { QuantSystemState, ReplayDatasetMetadata } from '../../quant/types.ts';
import { formatPrice, formatUtcShort } from '../../utils/formatters.ts';
import { ProvenanceBadge, StatusLabel } from '../shared/UiPrimitives.tsx';

export interface UserHeaderProps {
  state: QuantSystemState;
  datasetMetadata: ReplayDatasetMetadata;
}

export const UserHeader: React.FC<UserHeaderProps> = ({ state, datasetMetadata: _datasetMetadata }) => {
  const telemetry = state.dataSourceTelemetry;
  const isLiveMt5 = telemetry?.sourceMode === 'MT5_DEMO_LIVE';

  return (
    <section className="bg-[#0c1322] border border-[#1e293b] rounded-xl p-5 sm:p-6 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-slate-100">
              Danh mục mô phỏng
            </h1>
            <ProvenanceBadge mode={isLiveMt5 ? 'MT5_DEMO' : 'REPLAY'} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <StatusLabel label={`${state.symbol} · ${state.timeframe}`} tone="cyan" mono />
            <span>{isLiveMt5 ? 'Báo giá MT5 demo' : 'Dữ liệu phát lại'}</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>Chế độ mô phỏng an toàn (SIMULATION_ONLY)</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-5 text-xs font-mono tabular-nums border-t lg:border-t-0 pt-4 lg:pt-0 border-slate-800/80">
          <div className="bg-[#080d1a] border border-slate-800/80 rounded-lg px-3.5 py-2">
            <div className="text-slate-400 text-[11px] uppercase tracking-wider font-sans font-medium">Giờ thị trường gần nhất</div>
            <div className="text-slate-200 font-bold mt-0.5 text-sm">
              {formatUtcShort(state.lastProcessedMarketTime)}
            </div>
          </div>
          <div className="bg-[#080d1a] border border-slate-800/80 rounded-lg px-3.5 py-2">
            <div className="text-slate-400 text-[11px] uppercase tracking-wider font-sans font-medium">Cập nhật máy chủ</div>
            <div className="text-slate-300 mt-0.5 text-sm">
              {formatUtcShort(state.lastUpdatedSystemTime)}
            </div>
          </div>
          {telemetry?.lastQuoteBid && telemetry?.lastQuoteAsk && (
            <div className="bg-[#080d1a] border border-cyan-900/50 rounded-lg px-3.5 py-2">
              <div className="text-slate-400 text-[11px] uppercase tracking-wider font-sans font-medium">Bid / Ask gần nhất</div>
              <div className="text-cyan-400 font-bold mt-0.5 text-sm">
                {formatPrice(telemetry.lastQuoteBid)} / {formatPrice(telemetry.lastQuoteAsk)}
                <span className="text-slate-400 text-xs font-normal ml-1">
                  ({telemetry.lastQuoteSpreadPts} pts)
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
