import React, { useState } from 'react';
import { getGuardLayers } from '../data/landingData';
import { GuardTopologyDiagram } from './GuardTopologyDiagram';
import { SpotlightBento } from './ui/SpotlightBento';
import { ShieldCheck, AlertTriangle, XCircle, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

export interface LandingGuardSimulatorSectionProps {
  selectedGuardIdx: number;
  setSelectedGuardIdx: (idx: number) => void;
}

export const LandingGuardSimulatorSection: React.FC<LandingGuardSimulatorSectionProps> = ({
  selectedGuardIdx,
  setSelectedGuardIdx,
}) => {
  const { lang, t } = useLanguage();
  const [scenario, setScenario] = useState<'BUY' | 'NO_SL' | 'PROP_OVER'>('BUY');
  const guardLayers = getGuardLayers(lang);
  const activeGuard = guardLayers[selectedGuardIdx] || guardLayers[0];

  return (
    <section
      id="guards"
      className="relative grid grid-cols-1 gap-8 lg:grid-cols-12 items-center"
    >
      <div id="pipeline" className="absolute -top-24 left-0 pointer-events-none" />
      {/* Left Column: 4-Layer Guard Explanation & 3 Scenario Testing Buttons */}
      <div className="space-y-5 lg:col-span-6">
        <div>
          <div className="inline-flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-[0.2em] text-[#12B5A6]">
            <ShieldCheck className="w-4 h-4 text-[#12B5A6]" strokeWidth={2} />
            <span>{t.simulator.badge}</span>
          </div>
          <h2 className="mt-1 font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
            {t.simulator.title}
          </h2>
          <p className="mt-2 text-sm text-slate-300 leading-relaxed">
            {t.simulator.subtitle}
          </p>
        </div>

        {/* 3 Scenario Testing Buttons */}
        <div className="space-y-2">
          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            {t.simulator.scenarioLabel}
          </span>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                setScenario('BUY');
                setSelectedGuardIdx(0);
              }}
              className={`rounded-xl border py-2.5 px-3 text-xs font-bold transition font-mono flex items-center justify-center gap-1.5 cursor-pointer ${
                scenario === 'BUY'
                  ? 'border-[#12B5A6] bg-[#12B5A6]/20 text-[#12B5A6] shadow-[0_0_15px_rgba(18,181,166,0.25)]'
                  : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{t.simulator.scenarioStandard}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setScenario('NO_SL');
                setSelectedGuardIdx(1);
              }}
              className={`rounded-xl border py-2.5 px-3 text-xs font-bold transition font-mono flex items-center justify-center gap-1.5 cursor-pointer ${
                scenario === 'NO_SL'
                  ? 'border-rose-500 bg-rose-500/20 text-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.25)]'
                  : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
              }`}
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>{t.simulator.scenarioMissingSl}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setScenario('PROP_OVER');
                setSelectedGuardIdx(3);
              }}
              className={`rounded-xl border py-2.5 px-3 text-xs font-bold transition font-mono flex items-center justify-center gap-1.5 cursor-pointer ${
                scenario === 'PROP_OVER'
                  ? 'border-amber-400 bg-amber-500/20 text-amber-300 shadow-[0_0_15px_rgba(245,183,0,0.25)]'
                  : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{t.simulator.scenarioCapBreach}</span>
            </button>
          </div>
        </div>

        {/* 4 Guard Layers Selector */}
        <div className="space-y-2 pt-1">
          {guardLayers.map((g, idx) => {
            const active = idx === selectedGuardIdx;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelectedGuardIdx(idx)}
                className={`w-full rounded-xl border p-3.5 text-left transition cursor-pointer ${
                  active
                    ? 'border-[#12B5A6]/60 bg-[#12B5A6]/15 text-white shadow-[0_0_20px_rgba(18,181,166,0.15)]'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/20 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className={`font-bold ${active ? 'text-[#12B5A6]' : 'text-slate-400'}`}>
                    {lang === 'en' ? `LAYER ${g.id}` : `LỚP ${g.id}`} // {g.code}
                  </span>
                  <span className="text-[#12B5A6] font-bold tabular-nums">{g.metric}</span>
                </div>
                <div className="mt-1 text-sm font-semibold text-white">{g.title}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Column: Flat SVG Topology Diagram in Spotlight Bento */}
      <div className="lg:col-span-6">
        <SpotlightBento borderBeam className="p-6 space-y-4">
          <div className="h-72 sm:h-80 w-full">
            <GuardTopologyDiagram
              selectedLayerIdx={selectedGuardIdx}
              onSelectLayer={setSelectedGuardIdx}
              scenario={scenario}
            />
          </div>

          <div className="space-y-2 pt-2 border-t border-white/[0.08]">
            <div className="flex items-center justify-between font-mono text-xs">
              <span className="text-[#12B5A6] font-bold uppercase">{activeGuard.code}</span>
              <span className="text-slate-400">CHỐT CHẶN: LỚP #{activeGuard.id}</span>
            </div>
            <h3 className="text-base font-bold text-white">{activeGuard.title}</h3>
            <p className="text-xs leading-relaxed text-slate-300">{activeGuard.desc}</p>
          </div>
        </SpotlightBento>
      </div>
    </section>
  );
};
