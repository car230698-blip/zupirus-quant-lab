import React from 'react';

/**
 * ZUPIRUS Quant Lab — Institutional Fintech Ambient Backdrop
 * Pure CSS backdrop (0% GPU, zero WebGL) modeled after Stripe / Linear / Bloomberg.
 * Combines Midnight Navy (#0B1220), a 48px hairline technical grid with elliptical radial falloff,
 * and two soft, subtle ambient glows (Teal #12B5A6 & Candle Gold #F5B700).
 */
export const FintechAmbientBackdrop: React.FC = () => {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 pointer-events-none overflow-hidden bg-[#0B1220]"
    >
      {/* 1. Fine-line Technical Grid (48px x 48px hairline) with Elliptical Radial Mask */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(148, 163, 184, 0.045) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(148, 163, 184, 0.045) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 15%, #000 30%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 15%, #000 30%, transparent 100%)',
        }}
      />

      {/* 2. Soft Ambient Glow Teal (#12B5A6 at 0.08 opacity) behind Hero Right Chart */}
      <div
        className="absolute top-[-10%] right-[5%] w-[600px] h-[600px] rounded-full blur-[140px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(18, 181, 166, 0.08) 0%, rgba(18, 181, 166, 0) 70%)',
        }}
      />

      {/* 3. Soft Candle Gold Glow (#F5B700 at 0.04 opacity) on Top Left */}
      <div
        className="absolute top-[-5%] left-[-5%] w-[500px] h-[500px] rounded-full blur-[130px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(245, 183, 0, 0.04) 0%, rgba(245, 183, 0, 0) 70%)',
        }}
      />
    </div>
  );
};
