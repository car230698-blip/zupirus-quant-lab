import React, { useEffect } from 'react';
import { formatUtcShort } from '../../utils/formatters.ts';

export type SemanticTone = 'cyan' | 'emerald' | 'amber' | 'rose' | 'slate';

const TONE_TEXT_STYLES: Record<SemanticTone, string> = {
  cyan: 'text-cyan-400',
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  rose: 'text-rose-400',
  slate: 'text-slate-300',
};

const TONE_INDICATOR_STYLES: Record<SemanticTone, string> = {
  cyan: 'border-cyan-500/40 bg-cyan-950/40 text-cyan-200',
  emerald: 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200',
  amber: 'border-amber-500/40 bg-amber-950/40 text-amber-200',
  rose: 'border-rose-500/40 bg-rose-950/40 text-rose-200',
  slate: 'border-slate-700/80 bg-slate-900/80 text-slate-300',
};

const TONE_DOT_STYLES: Record<SemanticTone, string> = {
  cyan: 'bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]',
  emerald: 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]',
  amber: 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]',
  rose: 'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.8)]',
  slate: 'bg-slate-400',
};

export const StatusLabel: React.FC<{
  label: string;
  tone?: SemanticTone;
  mono?: boolean;
  pulse?: boolean;
}> = ({ label, tone = 'slate', mono = false, pulse = false }) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full border transition-colors max-w-full ${
      TONE_INDICATOR_STYLES[tone]
    } ${mono ? 'font-mono tabular-nums' : ''}`}
  >
    {pulse && (
      <span className="relative flex h-2 w-2">
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${TONE_DOT_STYLES[tone]}`}
        />
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${TONE_DOT_STYLES[tone]}`}
        />
      </span>
    )}
    <span className="truncate">{label}</span>
  </span>
);

export const ProvenanceBadge: React.FC<{
  mode: 'REPLAY' | 'MT5_DEMO' | 'MT5_REAL';
}> = ({ mode }) => {
  if (mode === 'MT5_DEMO') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border border-cyan-500/40 bg-cyan-950/40 text-cyan-200">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
        MT5 DEMO
      </span>
    );
  }
  if (mode === 'MT5_REAL') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border border-slate-700 bg-slate-900/60 text-slate-400">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
        MT5 THẬT (Chưa hỗ trợ)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border border-amber-500/40 bg-amber-950/30 text-amber-200">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_#fbbf24]" />
      DỮ LIỆU PHÁT LẠI (Replay Dataset)
    </span>
  );
};

export const MetricCard: React.FC<{
  title: string;
  value: string;
  subtitle?: string;
  tone?: SemanticTone;
  rightMeta?: string;
}> = ({ title, value, subtitle, tone = 'slate', rightMeta }) => (
  <div className="bg-[#0c1322] border border-[#1e293b] hover:border-slate-700/80 rounded-xl p-4 sm:p-5 flex flex-col justify-between transition-all duration-150 shadow-sm">
    <div className="flex items-baseline justify-between flex-wrap gap-x-2 gap-y-1 mb-2">
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{title}</span>
      {rightMeta && (
        <span className="text-xs font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
          {rightMeta}
        </span>
      )}
    </div>
    <div
      className={`text-2xl sm:text-3xl font-display font-bold tabular-nums tracking-tight break-words ${TONE_TEXT_STYLES[tone]}`}
    >
      {value}
    </div>
    {subtitle && (
      <div className="mt-2 text-xs text-slate-400 leading-relaxed font-normal">{subtitle}</div>
    )}
  </div>
);

export const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
}> = ({ title, subtitle, rightSlot }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#1e293b]">
    <div>
      <h2 className="text-base sm:text-lg font-display font-bold text-slate-100 tracking-tight">
        {title}
      </h2>
      {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
    {rightSlot && <div className="flex items-center gap-2 min-w-0">{rightSlot}</div>}
  </div>
);

export const SlideOverDrawer: React.FC<{
  isOpen: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ isOpen, title, subtitle, onClose, children }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer surface */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-2xl bg-[#0c1322] border-l border-[#1e2e4a] text-slate-100 h-full overflow-y-auto shadow-2xl flex flex-col z-10"
      >
        <div className="sticky top-0 bg-[#0c1322]/95 backdrop-blur border-b border-[#1e293b] px-5 py-4 flex items-center justify-between gap-3 z-10">
          <div>
            <h3 className="text-base font-display font-bold text-slate-100 tracking-tight">{title}</h3>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label="Đóng bảng chi tiết"
          >
            <span className="text-base font-semibold px-1">✕</span>
          </button>
        </div>
        <div className="p-5 flex-1 space-y-4">{children}</div>
      </div>
    </div>
  );
};

export const DashboardSkeleton: React.FC<{ messageVi?: string }> = ({
  messageVi = 'Đang đồng bộ trạng thái định lượng và đối soát từ máy chủ...',
}) => (
  <div
    className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-6"
    role="status"
    aria-live="polite"
  >
    <div className="flex flex-wrap gap-3 items-center justify-between border-b border-[#1e293b] pb-4">
      <div className="space-y-2">
        <div className="h-6 w-48 max-w-full bg-slate-800/80 rounded-md animate-pulse" />
        <div className="h-3.5 w-64 max-w-full bg-slate-900 rounded animate-pulse" />
      </div>
      <div className="text-xs font-mono text-cyan-300 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
        {messageVi}
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((idx) => (
        <div
          key={idx}
          className="bg-[#0c1322] border border-[#1e293b] rounded-xl p-5 space-y-3"
        >
          <div className="h-3.5 w-28 bg-slate-800 rounded animate-pulse" />
          <div className="h-8 w-36 bg-slate-800/90 rounded animate-pulse" />
          <div className="h-3 w-44 bg-slate-800/60 rounded animate-pulse" />
        </div>
      ))}
    </div>
    <div className="bg-[#0c1322] border border-[#1e293b] rounded-xl p-5 space-y-4">
      <div className="h-5 w-56 bg-slate-800 rounded animate-pulse" />
      <div className="h-60 w-full bg-[#080d1a] border border-slate-800/60 rounded-lg animate-pulse" />
    </div>
  </div>
);

export const EmptyDataNotice: React.FC<{
  title: string;
  reasonVi: string;
  lastUpdatedIso?: string | null;
  actionSlot?: React.ReactNode;
}> = ({ title, reasonVi, lastUpdatedIso, actionSlot }) => (
  <div className="bg-[#0c1322]/80 border border-[#1e293b] rounded-xl p-6 text-center space-y-2">
    <div className="text-sm font-semibold text-slate-200">{title}</div>
    <p className="text-xs text-slate-400 max-w-xl mx-auto leading-relaxed">{reasonVi}</p>
    {lastUpdatedIso && (
      <div className="text-[11px] font-mono tabular-nums text-slate-500 pt-1">
        Cập nhật máy chủ gần nhất: {formatUtcShort(lastUpdatedIso)}
      </div>
    )}
    {actionSlot && <div className="pt-2 flex justify-center">{actionSlot}</div>}
  </div>
);
