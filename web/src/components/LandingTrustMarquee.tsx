import React from 'react';

const TRUST_LOGOS = [
  'METATRADER 5',
  'FTMO',
  'THE5ERS',
  'FUNDEDNEXT',
  'EXNESS',
  'IC MARKETS',
  'SEPAY VIETQR',
  'TRADINGVIEW',
];

export const LandingTrustMarquee: React.FC = () => {
  return (
    <div className="relative w-full overflow-hidden py-6 border-y border-white/[0.06] bg-[#060A13]/60 backdrop-blur-md">
      {/* Edge gradient masks */}
      <div className="pointer-events-none absolute left-0 inset-y-0 w-24 bg-gradient-to-r from-[#060A13] to-transparent z-10" />
      <div className="pointer-events-none absolute right-0 inset-y-0 w-24 bg-gradient-to-l from-[#060A13] to-transparent z-10" />

      <div className="flex w-max items-center gap-12 group">
        <div className="flex shrink-0 items-center gap-12 animate-marquee group-hover:[animation-play-state:paused]">
          {TRUST_LOGOS.concat(TRUST_LOGOS).map((logo, idx) => (
            <span
              key={`${logo}-${idx}`}
              className="font-mono text-xs sm:text-sm font-bold tracking-widest text-slate-500 hover:text-slate-200 transition-colors cursor-default whitespace-nowrap"
            >
              {logo}
            </span>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-12 animate-marquee group-hover:[animation-play-state:paused]" aria-hidden="true">
          {TRUST_LOGOS.concat(TRUST_LOGOS).map((logo, idx) => (
            <span
              key={`${logo}-dup-${idx}`}
              className="font-mono text-xs sm:text-sm font-bold tracking-widest text-slate-500 hover:text-slate-200 transition-colors cursor-default whitespace-nowrap"
            >
              {logo}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
