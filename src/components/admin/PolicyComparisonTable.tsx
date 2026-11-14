import React from 'react';
import type { PolicyVersionRecord } from '../../quant/types.ts';
import { formatStrategyNameVi, formatUtcShort } from '../../utils/formatters.ts';
import { SectionHeader, StatusLabel } from '../shared/UiPrimitives.tsx';

export const PolicyComparisonTable: React.FC<{
  policies: PolicyVersionRecord[];
  activePolicyId: string;
}> = ({ policies, activePolicyId }) => {
  const activePolicy = policies.find((p) => p.policyId === activePolicyId) ?? policies[0];
  const baselinePolicy = policies.find((p) => p.isBaseline) ?? policies[0];

  const regimes = [
    { key: 'TRENDING' as const, labelVi: 'Có xu hướng (Trending)' },
    { key: 'RANGING' as const, labelVi: 'Đi ngang (Ranging)' },
    { key: 'SQUEEZE_PRE_BREAKOUT' as const, labelVi: 'Nén chờ bứt phá (Squeeze)' },
  ];

  return (
    <section className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 sm:p-5 space-y-4">
      <SectionHeader
        title="Chính sách chiến lược đang áp dụng so với Cơ sở"
        subtitle="Ánh xạ chiến lược cho từng trạng thái thị trường (Cập nhật tự động khi vượt qua kiểm định ngoài mẫu)"
        rightSlot={
          <StatusLabel
            label={
              activePolicy?.isBaseline
                ? `Đang dùng Cơ sở (v${activePolicy.versionNumber})`
                : `Đang dùng Thích ứng (v${activePolicy?.versionNumber ?? 1})`
            }
            tone={activePolicy?.isBaseline ? 'slate' : 'emerald'}
          />
        }
      />

      <div className="w-full max-w-full overflow-x-auto overscroll-x-contain rounded-lg border border-slate-800/90 bg-slate-950/60">
        <table className="w-full text-left border-collapse min-w-[560px] text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] uppercase tracking-wider text-slate-400">
              <th className="py-2.5 px-3">Trạng thái thị trường</th>
              <th className="py-2.5 px-3">Chính sách đang chạy</th>
              <th className="py-2.5 px-3">Chính sách cơ sở (Baseline)</th>
              <th className="py-2.5 px-3">So sánh</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {regimes.map((reg) => {
              const activeEntry = activePolicy?.mapping[reg.key];
              const baseEntry = baselinePolicy?.mapping[reg.key];

              const activeStrat =
                activeEntry && activeEntry !== 'STAND_ASIDE' ? activeEntry.strategyId : null;
              const activeVer =
                activeEntry && activeEntry !== 'STAND_ASIDE' ? activeEntry.version : '—';

              const baseStrat =
                baseEntry && baseEntry !== 'STAND_ASIDE' ? baseEntry.strategyId : null;
              const baseVer =
                baseEntry && baseEntry !== 'STAND_ASIDE' ? baseEntry.version : '—';

              const isChanged = activeStrat !== baseStrat || activeVer !== baseVer;

              return (
                <tr key={reg.key} className="hover:bg-slate-900/50">
                  <td className="py-3 px-3 font-medium text-slate-200">{reg.labelVi}</td>
                  <td className="py-3 px-3 text-slate-100">
                    {formatStrategyNameVi(activeStrat)}{' '}
                    <span className="font-mono text-xs text-cyan-300">({activeVer})</span>
                  </td>
                  <td className="py-3 px-3 text-slate-400">
                    {formatStrategyNameVi(baseStrat)}{' '}
                    <span className="font-mono text-xs">({baseVer})</span>
                  </td>
                  <td className="py-3 px-3">
                    <StatusLabel
                      label={isChanged ? 'Đã nâng cấp ngoài mẫu' : 'Giữ nguyên cơ sở'}
                      tone={isChanged ? 'emerald' : 'slate'}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="group border-t border-slate-800/80 pt-3">
        <summary className="cursor-pointer list-none flex items-center justify-between text-xs font-medium text-cyan-300 hover:text-cyan-200">
          <span>Lịch sử các phiên bản chính sách ({policies.length} phiên bản) &amp; mã kỹ thuật</span>
          <span className="font-mono text-[11px] text-slate-400 group-open:rotate-180 transition-transform">
            ▼
          </span>
        </summary>
        <div className="mt-3 w-full max-w-full overflow-x-auto rounded border border-slate-800">
          <table className="w-full text-left border-collapse min-w-[540px] text-xs font-mono">
            <thead>
              <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <th className="py-2 px-2.5">Mã chính sách</th>
                <th className="py-2 px-2.5">Phiên bản</th>
                <th className="py-2 px-2.5">Trạng thái</th>
                <th className="py-2 px-2.5">Thời điểm tạo</th>
                <th className="py-2 px-2.5">Lý do kích hoạt / quay lui</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {policies.map((p) => (
                <tr key={p.policyId} className="text-slate-300">
                  <td className="py-2 px-2.5 text-cyan-300">{p.policyId}</td>
                  <td className="py-2 px-2.5">v{p.versionNumber}</td>
                  <td className="py-2 px-2.5">
                    <StatusLabel
                      label={p.status}
                      tone={p.status === 'ACTIVE' ? 'emerald' : p.status === 'ROLLED_BACK' ? 'rose' : 'slate'}
                      mono
                    />
                  </td>
                  <td className="py-2 px-2.5">{formatUtcShort(p.createdAtMarketTime)}</td>
                  <td className="py-2 px-2.5 font-sans text-slate-400">
                    {p.rollbackReasonVi ?? p.activationReasonVi}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
};
