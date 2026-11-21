import React, { useRef, useState, type ReactNode } from 'react';

export interface SpotlightBentoProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  borderBeam?: boolean;
  className?: string;
}

export const SpotlightBento: React.FC<SpotlightBentoProps> = ({
  children,
  borderBeam = false,
  className = '',
  ...props
}) => {
  const divRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!divRef.current) return;
    const rect = divRef.current.getBoundingClientRect();
    setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={divRef}
      onPointerMove={handlePointerMove}
      onPointerEnter={() => setOpacity(1)}
      onPointerLeave={() => setOpacity(0)}
      className={`relative rounded-2xl bg-[#0D1526]/70 backdrop-blur-xl border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_20px_48px_-24px_rgba(0,0,0,0.75)] overflow-hidden transition-all duration-200 hover:border-[#12B5A6]/40 ${className}`}
      {...props}
    >
      {/* Radial Spotlight Cursor Effect */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity,
          background: `radial-gradient(360px circle at ${coords.x}px ${coords.y}px, rgba(18, 181, 166, 0.16), transparent 70%)`,
        }}
      />

      {/* Top Edge Beam Animation */}
      {borderBeam && <div className="border-beam" />}

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
};
