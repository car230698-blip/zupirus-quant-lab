import React, { useState } from 'react';
import { GUARD_LAYERS } from '../data/landingData';
import { GuardTopologyDiagram } from './GuardTopologyDiagram';

export interface LandingGuardSimulatorSectionProps {
  selectedGuardIdx: number;
  setSelectedGuardIdx: (idx: number) => void;
}

export const LandingGuardSimulatorSection: React.FC<LandingGuardSimulatorSectionProps> = ({
  selectedGuardIdx,
  setSelectedGuardIdx,
}) => {
  const [scenario, setScenario] = useState<'BUY' | 'SELL' | 'NO_SL'>('BUY');
  const activeGuard = GUARD_LAYERS[selectedGuardIdx] || GUARD_LAYERS[0];

  return (
    <section
      id="safety-shield"
      className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-center"
    >
      {/* Left Column: 4-Layer Guard Explanation & 3 Scenario Testing Buttons */}
      <div className="space-y-5 lg:col-span-6">
        <div>
          <div className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-[#12B5A6]">
            4-LAYER FAIL-CLOSED CAPITAL PROTECTION
          </div>
          <h2 className="mt-1 font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Kiến Trúc 4 Lớp Giáp Bảo Vệ Vốn Bắt Buộc
          </h2>
          <p className="mt-2 text-sm text-slate-300 leading-relaxed">
            Quy tắc kiểm toán nguyên tử được thực thi tự động trên Cloud trước khi bất kỳ lệnh nào chạm tới tài khoản MT5.
          </p>
        </div>

        {/* 3 Scenario Testing Buttons */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Kịch Bản Thử Nghiệm Phản Ứng Giáp:
          </span>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                setScenario('BUY');
                setSelectedGuardIdx(0);
              }}
              className={`rounded-xl border py-2 px-2.5 text-xs font-bold transition font-mono ${
                scenario === 'BUY'
                  ? 'border-[#12B5A6] bg-[#12B5A6]/15 text-[#12B5A6]'
                  : 'border-slate-800 bg-[#080E1A] text-slate-400 hover:text-white'
              }`}
            >
              ✓ Tín hiệu chuẩn
            </button>
            <button
              type="button"
              onClick={() => {
                setScenario('NO_SL');
                setSelectedGuardIdx(1);
              }}
              className={`rounded-xl border py-2 px-2.5 text-xs font-bold transition font-mono ${
                scenario === 'NO_SL'
                  ? 'border-rose-500 bg-rose-500/15 text-rose-300'
                  : 'border-slate-800 bg-[#080E1A] text-slate-400 hover:text-white'
              }`}
            >
              ⛔ Thiếu Stop-Loss
            </button>
            <button
              type="button"
              onClick={() => {
                setScenario('SELL');
                setSelectedGuardIdx(3);
              }}
              className={`rounded-xl border py-2 px-2.5 text-xs font-bold transition font-mono ${
                scenario === 'SELL' && selectedGuardIdx === 3
                  ? 'border-amber-400 bg-amber-500/15 text-amber-300'
                  : 'border-slate-800 bg-[#080E1A] text-slate-400 hover:text-white'
              }`}
            >
              ⚠ Vượt trần Prop 1%
            </button>
          </div>
        </div>

        {/* 4 Guard Layers Selector */}
        <div className="space-y-2 pt-1">
          {GUARD_LAYERS.map((g, idx) => {
            const active = idx === selectedGuardIdx;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelectedGuardIdx(idx)}
                className={`w-full rounded-xl border p-3.5 text-left transition cursor-pointer ${
                  active
                    ? 'border-[#12B5A6]/60 bg-[#12B5A6]/10 text-white'
                    : 'border-slate-800/80 bg-[#10192B]/80 hover:border-slate-700 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className={`font-bold ${active ? 'text-[#12B5A6]' : 'text-slate-400'}`}>
                    LỚP {g.id} // {g.code}
                  </span>
                  <span className="text-[#12B5A6] font-bold tabular-nums">{g.metric}</span>
                </div>
                <div className="mt-1 text-sm font-semibold text-white">{g.title}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Column: Flat SVG Topology Diagram */}
      <div className="lg:col-span-6">
        <div className="rounded-2xl border border-slate-800/80 bg-[#10192B]/90 p-6 space-y-4 shadow-xl">
          <div className="h-72 sm:h-80 w-full">
            <GuardTopologyDiagram
              selectedLayerIdx={selectedGuardIdx}
              onSelectLayer={setSelectedGuardIdx}
              scenario={scenario}
            />
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-800/70">
            <div className="flex items-center justify-between font-mono text-xs">
              <span className="text-[#12B5A6] font-bold uppercase">{activeGuard.code}</span>
              <span className="text-slate-400">CHỐT CHẶN: LỚP #{activeGuard.id}</span>
            </div>
            <h3 className="text-base font-bold text-white">{activeGuard.title}</h3>
            <p className="text-xs leading-relaxed text-slate-300">{activeGuard.desc}</p>
          </div>
        </div>
      </div>
    </section>
  );
};
