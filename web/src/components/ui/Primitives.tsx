import React, { type ReactNode } from 'react';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const badgeStyles: Record<BadgeTone, string> = {
  success: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/30',
  warning: 'bg-amber-500/12 text-amber-300 border-amber-500/30',
  danger: 'bg-rose-500/12 text-rose-300 border-rose-500/30',
  info: 'bg-cyan-500/12 text-cyan-300 border-cyan-500/30',
  neutral: 'bg-slate-800/80 text-slate-300 border-slate-700/80',
};

const dotStyles: Record<BadgeTone, string> = {
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-rose-400',
  info: 'bg-cyan-400',
  neutral: 'bg-slate-400',
};

export const StatusBadge: React.FC<{
  tone?: BadgeTone;
  dot?: boolean;
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}> = ({ tone = 'neutral', dot = false, pulse = false, children, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide whitespace-nowrap ${badgeStyles[tone]} ${className}`}
  >
    {dot && (
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-70 ${dotStyles[tone]}`} />}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotStyles[tone]}`} />
      </span>
    )}
    {children}
  </span>
);

export const MetricCard: React.FC<{
  label: string;
  value: ReactNode;
  subtext?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'emerald' | 'amber' | 'cyan' | 'rose';
  className?: string;
}> = ({ label, value, subtext, icon, tone = 'default', className = '' }) => {
  const iconTone: Record<string, string> = {
    default: 'bg-white/[0.04] text-slate-200 border-white/10',
    emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  };

  return (
    <div className={`quant-card-interactive p-5 sm:p-6 flex flex-col justify-between gap-3 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 leading-snug">
          {label}
        </span>
        {icon && (
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${iconTone[tone]}`}>
            {icon}
          </span>
        )}
      </div>
      <div className="font-mono text-2xl sm:text-[26px] font-extrabold tracking-tight text-white tabular-nums">
        {value}
      </div>
      {subtext && <div className="text-xs text-slate-400 leading-relaxed">{subtext}</div>}
    </div>
  );
};

export const Panel: React.FC<{
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}> = ({ title, subtitle, icon, action, children, className = '', bodyClassName = 'p-5 sm:p-6' }) => (
  <section className={`quant-panel ${className}`}>
    {(title || action) && (
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-200">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-white tracking-tight truncate">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-400 leading-relaxed">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
      </header>
    )}
    <div className={bodyClassName}>{children}</div>
  </section>
);

export const EmptyState: React.FC<{
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700/80 bg-slate-950/40 px-6 py-10 text-center">
    {icon && (
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-900 text-slate-400">
        {icon}
      </div>
    )}
    <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
    <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-400">{description}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const SkeletonBlock: React.FC<{ className?: string }> = ({ className = 'h-24 w-full' }) => (
  <div className={`quant-skeleton rounded-xl ${className}`} aria-hidden="true" />
);
