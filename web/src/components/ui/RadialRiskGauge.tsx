import React from 'react';

export interface RadialRiskGaugeProps {
  value: number; // e.g., 0.42 (%)
  max: number; // e.g., 4.0 (%)
  title: string;
  badgeLabel?: string;
  badgeTone?: 'teal' | 'gold' | 'rose' | 'sky';
  subtitle?: React.ReactNode;
  tone?: 'teal' | 'gold' | 'rose';
  size?: number; // default 88
  strokeWidth?: number; // default 7
  prefix?: string;
  suffix?: string;
  className?: string;
}

export const RadialRiskGauge: React.FC<RadialRiskGaugeProps> = ({
  value,
  max,
  title,
  badgeLabel,
  badgeTone = 'teal',
  subtitle,
  tone = 'teal',
  size = 88,
  strokeWidth = 7,
  prefix = '',
  suffix = '%',
  className = '',
}) => {
  const radius = 40;
  const circumference = 2 * Math.PI * radius; // ~251.3
  const safeMax = Math.max(max, 0.001);
  const ratio = Math.min(Math.max(value / safeMax, 0), 1);
  const strokeDashoffset = circumference * (1 - ratio);

  const strokeColor =
    tone === 'rose'
      ? '#F43F5E'
      : tone === 'gold'
      ? '#F5B700'
      : '#12B5A6';

  const badgeStyles: Record<string, string> = {
    teal: 'bg-[#12B5A6]/14 text-[#12B5A6] border-[#12B5A6]/30',
    gold: 'bg-[#F5B700]/14 text-[#F5B700] border-[#F5B700]/30',
    rose: 'bg-[#F43F5E]/14 text-[#F43F5E] border-[#F43F5E]/30',
    sky: 'bg-[#38BDF8]/14 text-[#38BDF8] border-[#38BDF8]/30',
  };

  return (
    <div className={`flex flex-col justify-between ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs sm:text-[13px] font-bold text-white tracking-tight">{title}</span>
        {badgeLabel && (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] sm:text-[11px] font-mono font-bold ${badgeStyles[badgeTone]}`}>
            {badgeLabel}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3.5 sm:gap-4">
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          className="shrink-0"
        >
          {/* Background track */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="rgba(148, 163, 184, 0.14)"
            strokeWidth={strokeWidth}
          />
          {/* Animated Progress Arc */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{
              transform: 'rotate(-90deg)',
              transformOrigin: '50% 50%',
              transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />
          {/* Center value */}
          <text
            x="50"
            y="54"
            textAnchor="middle"
            fill="#F8FAFC"
            fontFamily="JetBrains Mono, monospace"
            fontSize="14.5"
            fontWeight="700"
          >
            {prefix}{value.toFixed(1)}{suffix}
          </text>
        </svg>

        <div className="min-w-0 flex-1">
          {subtitle}
        </div>
      </div>
    </div>
  );
};
