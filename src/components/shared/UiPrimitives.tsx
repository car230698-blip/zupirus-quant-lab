import React from 'react';
import { formatUtcShort } from '../../utils/formatters.ts';

export type SemanticTone = 'cyan' | 'emerald' | 'amber' | 'rose' | 'slate';

const TONE_TEXT_STYLES: Record<SemanticTone, string> = {
  cyan: 'text-cyan-300',
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
  slate: 'text-slate-300',
};

const TONE_INDICATOR_STYLES: Record<SemanticTone, string> = {
  cyan: 'border-cyan-500/40 bg-cyan-950/50 text-cyan-200',
  emerald: 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200',
  amber: 'border-amber-500/40 bg-amber-950/50 text-amber-200',
  rose: 'border-rose-500/40 bg-rose-950/50 text-rose-200',
  slate: 'border-slate-700 bg-slate-900 text-slate-300',
};

export const StatusLabel: React.FC<{
  label: string;
  tone?: SemanticTone;
  mono?: boolean;
}> = ({ label, tone = 'slate', mono = false }) => (
  <span
    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border max-w-full ${
      TONE_INDICATOR_STYLES[tone]
    } ${mono ? 'font-mono tabular-nums' : ''}`}
  >
    {label}
  </span>
);

export const MetricCard: React.FC<{
  title: string;
  value: string;
  subtitle?: string;
  tone?: SemanticTone;
  rightMeta?: string;
}> = ({ title, value, subtitle, tone = 'slate', rightMeta }) => (
  <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 flex flex-col justify-between">
    <div className="flex items-baseline justify-between flex-wrap gap-x-2 gap-y-1 mb-1.5">
      <span className="text-sm font-medium text-slate-400">{title}</span>
      {rightMeta && (
        <span className="text-[11px] font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
          {rightMeta}
        </span>
      )}
    </div>
    <div
      className={`text-xl sm:text-2xl break-words font-semibold tabular-nums tracking-tight ${TONE_TEXT_STYLES[tone]}`}
    >
      {value}
    </div>
    {subtitle && (
      <div className="mt-1.5 text-xs text-slate-400 leading-relaxed">{subtitle}</div>
    )}
  </div>
);

export const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
}> = ({ title, subtitle, rightSlot }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
    <div>
      <h2 className="text-base sm:text-lg font-display font-semibold text-slate-100">
        {title}
      </h2>
      {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
    </div>
    {rightSlot && <div className="flex items-center gap-2 min-w-0">{rightSlot}</div>}
  </div>
);

export const DashboardSkeleton: React.FC<{ messageVi?: string }> = ({
  messageVi = 'Đang đồng bộ trạng thái định lượng và đối soát từ máy chủ...',
}) => (
  <div
    className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-6"
    role="status"
    aria-live="polite"
  >
    <div className="flex flex-wrap gap-3 items-center justify-between border-b border-slate-800 pb-4">
      <div className="space-y-2">
        <div className="h-5 w-48 max-w-full bg-slate-800/80 rounded animate-pulse" />
        <div className="h-3.5 w-64 max-w-full bg-slate-900 rounded animate-pulse" />
      </div>
      <div className="text-xs font-mono text-cyan-300">{messageVi}</div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((idx) => (
        <div
          key={idx}
          className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 space-y-3"
        >
          <div className="h-3.5 w-28 bg-slate-800 rounded animate-pulse" />
          <div className="h-7 w-36 bg-slate-800/90 rounded animate-pulse" />
          <div className="h-3 w-44 bg-slate-800/60 rounded animate-pulse" />
        </div>
      ))}
    </div>
    <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-5 space-y-4">
      <div className="h-4 w-56 bg-slate-800 rounded animate-pulse" />
      <div className="h-52 w-full bg-slate-950/80 border border-slate-800/60 rounded animate-pulse" />
    </div>
  </div>
);

export const EmptyDataNotice: React.FC<{
  title: string;
  reasonVi: string;
  lastUpdatedIso?: string | null;
  actionSlot?: React.ReactNode;
}> = ({ title, reasonVi, lastUpdatedIso, actionSlot }) => (
  <div className="bg-slate-950/60 border border-slate-800/90 rounded-lg p-6 text-center space-y-2">
    <div className="text-sm font-medium text-slate-200">{title}</div>
    <p className="text-xs text-slate-400 max-w-xl mx-auto leading-relaxed">{reasonVi}</p>
    {lastUpdatedIso && (
      <div className="text-[11px] font-mono tabular-nums text-slate-400 pt-1">
        Cập nhật máy chủ gần nhất: {formatUtcShort(lastUpdatedIso)}
      </div>
    )}
    {actionSlot && <div className="pt-2 flex justify-center">{actionSlot}</div>}
  </div>
);
