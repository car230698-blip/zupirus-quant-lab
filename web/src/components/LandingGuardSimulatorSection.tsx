import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { GUARD_LAYERS } from '../data/landingData';
import { TiltCard } from './TiltCard';

const ThreeHolographicMatrix = lazy(() =>
  import('./ThreeHolographicMatrix').then((m) => ({ default: m.ThreeHolographicMatrix }))
);

export interface LandingGuardSimulatorSectionProps {
  selectedGuardIdx: number;
  setSelectedGuardIdx: (idx: number) => void;
}

export const LandingGuardSimulatorSection: React.FC<LandingGuardSimulatorSectionProps> = ({
  selectedGuardIdx,
  setSelectedGuardIdx,
}) => {
  const sectionRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    return () => observer.disconnect();
  }, []);

  const activeGuard = GUARD_LAYERS[selectedGuardIdx] || GUARD_LAYERS[0];

  return (
    <section
      ref={sectionRef}
      id="safety-shield"
      className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-center"
    >
      <div className="space-y-4 lg:col-span-6">
        <div className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
          4-LAYER FAIL-CLOSED CAPITAL PROTECTION
        </div>
        <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-white">
          Kiến Trúc 4 Lớp Giáp Bảo Vệ Vốn Bắt Buộc
        </h2>
        <p className="text-sm text-slate-300 leading-relaxed">
          Nhấn vào từng lớp giáp bên dưới để xem quy tắc kiểm toán nguyên tử được thực thi trước khi bất kỳ lệnh nào chạm tới tài khoản MT5.
        </p>

        <div className="space-y-2.5 pt-2">
          {GUARD_LAYERS.map((g, idx) => {
            const active = idx === selectedGuardIdx;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelectedGuardIdx(idx)}
                className={`w-full rounded-2xl border p-4 text-left transition cursor-pointer ${
                  active
                    ? 'border-amber-400/60 bg-amber-500/15 shadow-[0_0_28px_rgba(245,158,11,0.16)]'
                    : 'border-white/10 bg-[#060b18]/85 hover:border-amber-500/30'
                }`}
              >
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="font-bold text-amber-300">
                    LỚP {g.id} // {g.code}
                  </span>
                  <span className="text-emerald-400 font-bold tabular-nums">{g.metric}</span>
                </div>
                <div className="mt-1 text-sm font-bold text-white">{g.title}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="lg:col-span-6">
        <TiltCard className="rounded-2xl">
          <div className="quant-panel p-6 sm:p-8 space-y-5 border-amber-500/35">
            <div className="relative h-72 sm:h-80 lg:h-96 w-full overflow-hidden rounded-xl border border-amber-500/25 bg-[#030611]">
              {inView ? (
                <Suspense
                  fallback={
                    <div className="h-full w-full flex items-center justify-center font-mono text-xs text-amber-300 bg-[#0B1220]">
                      <span className="animate-pulse">Đang nạp ma trận 3D bảo vệ...</span>
                    </div>
                  }
                >
                  <ThreeHolographicMatrix
                    selectedLayerIdx={selectedGuardIdx}
                    onSelectLayer={setSelectedGuardIdx}
                  />
                </Suspense>
              ) : (
                <div className="h-full w-full bg-[#0B1220]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#050914] via-transparent to-transparent pointer-events-none" />
              <div className="absolute top-3 left-4 right-4 flex items-center justify-between font-mono text-xs pointer-events-none">
                <span className="font-bold text-amber-300">LỚP ĐANG CHỌN: #{activeGuard.id}</span>
                <span className="rounded bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-emerald-300 font-bold">
                  FAIL-CLOSED ENFORCED
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="font-mono text-xs text-cyan-300 uppercase tracking-wider">
                {activeGuard.code}
              </div>
              <h3 className="text-xl font-bold text-white">{activeGuard.title}</h3>
              <p className="text-sm leading-relaxed text-slate-300">{activeGuard.desc}</p>
              <div className="rounded-xl border border-amber-500/30 bg-[#03060e] p-3.5 font-mono text-xs text-amber-200">
                <span className="text-slate-500 block text-[10px] mb-1">QUY TẮC THỰC THI NGUYÊN TỬ:</span>
                <code>{activeGuard.rule}</code>
              </div>
            </div>
          </div>
        </TiltCard>
      </div>
    </section>
  );
};
