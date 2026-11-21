import React from 'react';

/**
 * ZUPIRUS Quant Lab — Institutional Fintech Ambient Backdrop
 * High-tech atmospheric lighting with rich depth:
 * - Multi-stage radial gradient background (Deep Quantum Dark #03050a to #0a1324)
 * - Animated Sovereign Gold & Cyan aurora illumination
 * - 40px hairline precision technical cyber-grid with radial vignette
 * - Intersection glow spots & ambient atmospheric depth
 */
export const FintechAmbientBackdrop: React.FC = () => {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 pointer-events-none overflow-hidden select-none"
      style={{
        background: 'radial-gradient(ellipse 140% 90% at 50% -10%, #0c1830 0%, #071020 40%, #03060d 75%, #020408 100%)',
      }}
    >
      {/* 1. Precision Cyber Grid with Subtle Vignette Falloff */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(148, 163, 184, 0.065) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(148, 163, 184, 0.065) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(ellipse 90% 70% at 50% 25%, #000 40%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 70% at 50% 25%, #000 40%, transparent 100%)',
        }}
      />

      {/* 2. Sovereign Gold (XAU/USD) Dynamic Aurora Orb - Top Left */}
      <div
        className="absolute -top-24 left-[15%] w-[680px] h-[520px] rounded-full blur-[140px] pointer-events-none animate-aurora"
        style={{
          background: 'radial-gradient(circle, rgba(245, 183, 0, 0.16) 0%, rgba(245, 158, 11, 0.08) 50%, transparent 75%)',
        }}
      />

      {/* 3. Cyan / Teal Direct Execution Orb - Right Cockpit */}
      <div
        className="absolute top-[8%] right-[8%] w-[620px] h-[580px] rounded-full blur-[140px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(18, 181, 166, 0.15) 0%, rgba(6, 182, 212, 0.08) 50%, transparent 75%)',
        }}
      />

      {/* 4. Deep Indigo / Quantum Space Center Illumination */}
      <div
        className="absolute top-[45%] left-[30%] w-[700px] h-[480px] rounded-full blur-[160px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.07) 0%, transparent 70%)',
        }}
      />

      {/* 5. Subtle Top Edge Laser Illumination */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#12B5A6]/40 to-transparent" />
    </div>
  );
};
