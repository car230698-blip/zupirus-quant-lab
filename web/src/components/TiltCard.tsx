import React from 'react';

/**
 * ZUPIRUS Quant Lab — Institutional Card Container
 * Clean, subtle border & color transition (0% 3D perspective wobble, zero glare).
 * Retains backwards-compatible props for all child components.
 */
interface TiltCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  maxTilt?: number;
  glare?: boolean;
}

export const TiltCard: React.FC<TiltCardProps> = ({
  children,
  className = '',
  maxTilt: _maxTilt,
  glare: _glare,
  ...props
}) => {
  return (
    <div
      className={`relative rounded-2xl border border-slate-800/80 bg-[#10192B]/80 hover:border-slate-700 transition-colors duration-200 overflow-hidden ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
