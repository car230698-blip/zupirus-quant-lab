import React from 'react';

export interface BrandMarkProps {
  onClick?: () => void;
  collapsed?: boolean;
  compact?: boolean;
  subtitle?: string;
  accent?: 'teal' | 'cyan';
}

export const BrandMark: React.FC<BrandMarkProps> = ({
  onClick,
  collapsed = false,
  compact = false,
  subtitle,
  accent = 'teal',
}) => {
  const isCollapsed = collapsed || compact;
  const badgeColor =
    accent === 'cyan'
      ? 'bg-cyan-400 text-[#04131a]'
      : 'bg-[#12B5A6] text-[#032220]';

  return (
    <div
      className={`quant-brand ${onClick ? 'cursor-pointer group' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-base font-extrabold transition-transform duration-150 group-hover:scale-105 ${badgeColor}`}
      >
        Z
      </div>
      {!isCollapsed && (
        <div className="min-w-0">
          <span className="font-display text-base font-bold tracking-tight text-white leading-none block truncate">
            ZUPIRUS
          </span>
          {subtitle && (
            <span className="text-[11px] text-slate-400 font-mono block mt-0.5 truncate">
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
