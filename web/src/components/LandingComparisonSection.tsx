import React from 'react';
import { motion } from 'motion/react';
import { SpotlightBento } from './ui/SpotlightBento';
import { Server, ShieldCheck, Scale, Zap, Check, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

export const LandingComparisonSection: React.FC = () => {
  const { t } = useLanguage();
  const icons = [
    <Server className="w-5 h-5 text-[#12B5A6]" strokeWidth={1.75} />,
    <ShieldCheck className="w-5 h-5 text-[#12B5A6]" strokeWidth={1.75} />,
    <Scale className="w-5 h-5 text-[#12B5A6]" strokeWidth={1.75} />,
    <Zap className="w-5 h-5 text-[#12B5A6]" strokeWidth={1.75} />,
  ];

  const pillars = t.comparison.pillars.map((p, idx) => ({
    icon: icons[idx],
    metric: p.metric,
    isTeal: idx === 0,
    title: p.title,
    desc: p.desc,
  }));

  return (
    <div className="space-y-16">
      {/* SECTION 2A: 4 OPEN PILLARS (Unboxed, Elegant Linear Style) */}
      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {pillars.map((card, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.45, delay: idx * 0.1 }}
            className="group relative border-t border-white/15 hover:border-[#12B5A6] pt-5 pb-2 transition-all duration-300"
          >
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                {card.icon}
              </div>
              <span className={`font-mono text-2xl font-bold tabular-nums ${card.isTeal ? 'text-[#12B5A6]' : 'text-white'}`}>
                {card.metric}
              </span>
            </div>
            <h3 className="mt-4 text-base font-bold text-white group-hover:text-[#12B5A6] transition-colors">
              {card.title}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-[#94A3B8]">{card.desc}</p>
          </motion.div>
        ))}
      </section>

      {/* SECTION 2B: SO SÁNH 2 CỘT & QUY TRÌNH 3 BƯỚC */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left (7 Cols): 2-Column Comparison */}
        <div className="lg:col-span-7">
          <SpotlightBento className="p-6 sm:p-8 space-y-6 h-full">
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
                {t.comparison.compareBadge}
              </span>
              <h2 className="mt-1 text-2xl font-bold text-white tracking-tight">
                {t.comparison.compareTitle}
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
              <div className="rounded-xl border border-rose-500/25 bg-rose-950/15 p-5 space-y-3">
                <div className="inline-flex items-center gap-1.5 font-mono font-bold text-rose-400 uppercase">
                  <X className="w-4 h-4" />
                  {t.comparison.leftTitle}
                </div>
                <ul className="space-y-2.5 text-slate-400">
                  {t.comparison.leftItems.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-rose-500 font-bold shrink-0">✕</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-[#12B5A6]/40 bg-[#12B5A6]/10 p-5 space-y-3">
                <div className="inline-flex items-center gap-1.5 font-mono font-bold text-[#12B5A6] uppercase">
                  <Check className="w-4 h-4" />
                  {t.comparison.rightTitle}
                </div>
                <ul className="space-y-2.5 text-slate-200">
                  {t.comparison.rightItems.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-[#12B5A6] font-bold shrink-0">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </SpotlightBento>
        </div>

        {/* Right (5 Cols): 3-Step Process */}
        <div className="lg:col-span-5">
          <SpotlightBento className="p-6 sm:p-8 space-y-6 h-full">
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#F5B700]">
                {t.comparison.stepsBadge}
              </span>
              <h2 className="mt-1 text-2xl font-bold text-white tracking-tight">{t.comparison.stepsTitle}</h2>
            </div>

            <div className="space-y-3.5 text-xs">
              {t.comparison.steps.map((s) => (
                <div
                  key={s.step}
                  className="flex items-start gap-3.5 rounded-xl border border-white/[0.08] bg-[#070D1C]/80 p-4"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#12B5A6]/15 font-mono text-xs font-bold text-[#12B5A6]">
                    {s.step}
                  </span>
                  <div>
                    <div className="font-bold text-white">{s.title}</div>
                    <div className="mt-1 text-slate-400 leading-relaxed">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </SpotlightBento>
        </div>
      </section>
    </div>
  );
};
