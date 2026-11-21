import React from 'react';

/**
 * ZUPIRUS Quant Lab — Institutional Fintech Ambient Backdrop (2026 Edition)
 * High-tech atmospheric lighting with Bento Glass depth:
 * - Deep quantum dark background (#060A13 to #0B1220)
 * - Dot-Matrix micro-grid (24px, 1px dot with radial vignette falloff)
 * - Teal (#12B5A6) & Sovereign Gold (#F5B700) diffuse aurora illumination
 * - 0% WebGL / CPU friendly, respecting prefers-reduced-motion
 */
export const FintechAmbientBackdrop: React.FC = () => {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 pointer-events-none overflow-hidden select-none bg-[#060A13]"
    >
      {/* 1. Atmospheric Ambient Mesh Glows */}
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background: `
            radial-gradient(ellipse 55% 40% at 20% 0%, rgba(18, 181, 166, 0.15), transparent 65%),
            radial-gradient(ellipse 45% 35% at 85% 12%, rgba(56, 189, 248, 0.08), transparent 65%),
            radial-gradient(ellipse 40% 30% at 50% 95%, rgba(245, 183, 0, 0.06), transparent 65%)
          `,
        }}
      />

      {/* 2. Dot-Matrix Micro-Grid (24px, 1px dot with radial mask) */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(rgba(148, 163, 184, 0.16) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse 85% 70% at 50% 20%, #000 30%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 85% 70% at 50% 20%, #000 30%, transparent 100%)',
        }}
      />

      {/* 3. Sovereign Gold Dynamic Aurora - Top Center-Left */}
      <div
        className="absolute -top-32 left-[12%] w-[680px] h-[520px] rounded-full blur-[140px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(245, 183, 0, 0.12) 0%, rgba(245, 158, 11, 0.05) 50%, transparent 75%)',
        }}
      />

      {/* 4. Teal / Cyan Direct Execution Aurora - Right Cockpit */}
      <div
        className="absolute top-[5%] right-[6%] w-[640px] h-[580px] rounded-full blur-[140px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(18, 181, 166, 0.13) 0%, rgba(6, 182, 212, 0.06) 50%, transparent 75%)',
        }}
      />

      {/* 5. Subtle Top Edge Laser Illumination */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#12B5A6]/40 via-[#F5B700]/30 to-transparent" />
    </div>
  );
};
