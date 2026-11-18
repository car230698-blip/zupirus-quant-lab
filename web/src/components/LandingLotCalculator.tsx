import React from 'react';
import { type AccountKind, type LotCalculationResult } from '../utils/quantMath';

export interface LandingLotCalculatorProps {
  calcAccountKind: AccountKind;
  setCalcAccountKind: (kind: AccountKind) => void;
  calcBalance: number;
  setCalcBalance: (val: number) => void;
  calcRiskPct: number;
  setCalcRiskPct: (val: number) => void;
  calcSlPips: number;
  setCalcSlPips: (val: number) => void;
  lotCalc: LotCalculationResult;
}

export const LandingLotCalculator: React.FC<LandingLotCalculatorProps> = ({
  calcAccountKind,
  setCalcAccountKind,
  calcBalance,
  setCalcBalance,
  calcRiskPct,
  setCalcRiskPct,
  calcSlPips,
  setCalcSlPips,
  lotCalc,
}) => (
        <section id="lot-calculator" className="quant-panel p-6 sm:p-10">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-center">
            <div className="space-y-5 lg:col-span-7">
              <div>
                <div className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
                  DYNAMIC LOT SIZING & PROP FIRM GUARD
                </div>
                <h2 className="mt-1 font-display text-2xl sm:text-3xl font-extrabold text-white">
                  Máy Tính Khối Lượng Vào Lệnh & Trần Lỗ Quỹ Prop
                </h2>
              </div>

              <div className="flex flex-wrap gap-2">
                {(['STANDARD', 'PROP', 'CENT'] as AccountKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setCalcAccountKind(kind)}
                    className={`rounded-xl border px-4 py-2 font-mono text-xs font-bold transition whitespace-nowrap shrink-0 cursor-pointer ${
                      calcAccountKind === kind
                        ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                        : 'border-white/10 bg-[#040710] text-slate-400 hover:text-white'
                    }`}
                  >
                    {kind === 'STANDARD'
                      ? 'Tài Khoản Standard'
                      : kind === 'PROP'
                      ? 'Quỹ Prop (FTMO / The5ers)'
                      : 'Tài Khoản Cent'}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 font-mono">
                <div className="rounded-xl border border-white/10 bg-[#040710] p-4">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Vốn Tài Khoản</span>
                    <strong className="text-amber-300 tabular-nums">${calcBalance.toLocaleString('en-US')}</strong>
                  </div>
                  <input
                    type="range"
                    min={1000}
                    max={200000}
                    step={1000}
                    value={calcBalance}
                    onChange={(e) => setCalcBalance(Number(e.target.value))}
                    className="mt-3 w-full accent-amber-400"
                  />
                </div>

                <div className="rounded-xl border border-white/10 bg-[#040710] p-4">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Rủi Ro / Lệnh</span>
                    <strong className="text-cyan-300 tabular-nums">{calcRiskPct.toFixed(1)}%</strong>
                  </div>
                  <input
                    type="range"
                    min={0.25}
                    max={3.0}
                    step={0.25}
                    value={calcRiskPct}
                    onChange={(e) => setCalcRiskPct(Number(e.target.value))}
                    className="mt-3 w-full accent-cyan-400"
                  />
                </div>

                <div className="rounded-xl border border-white/10 bg-[#040710] p-4">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Khoảng Dừng Lỗ (SL)</span>
                    <strong className="text-emerald-400 tabular-nums">{calcSlPips} pips</strong>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={80}
                    step={5}
                    value={calcSlPips}
                    onChange={(e) => setCalcSlPips(Number(e.target.value))}
                    className="mt-3 w-full accent-emerald-400"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-500/35 bg-[#040710]/95 p-6 space-y-4 font-mono tabular-nums lg:col-span-5">
              <div className="flex items-center justify-between border-b border-white/10 pb-3 text-xs">
                <span className="text-amber-300 font-bold">KẾT QUẢ PHÂN BỔ KHỐI LƯỢNG</span>
                <span className="text-emerald-400 font-bold">{lotCalc.propFirmSafe ? 'PROP SAFE ✓' : 'CẢNH BÁO RỦI RO'}</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase">Khối Lượng Khuyến Nghị</div>
                  <div className="mt-1 text-3xl font-extrabold text-amber-300">
                    {lotCalc.displayLots.toFixed(2)} <span className="text-xs font-normal text-slate-400">{lotCalc.unitLabel}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase">Rủi Ro Tuyệt Đối (1R)</div>
                  <div className="mt-1 text-2xl font-extrabold text-white">${lotCalc.riskUsd.toFixed(2)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-3 text-xs">
                <div>
                  <span className="text-slate-400 block">Mục tiêu chốt lời (2R):</span>
                  <strong className="text-emerald-400">+${lotCalc.rewardAt2RUsd.toFixed(2)}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Số lệnh tối đa trước trần DD:</span>
                  <strong className="text-cyan-300">{lotCalc.maxConsecutiveLossesBeforeDailyCap} lệnh liên tiếp</strong>
                </div>
              </div>
            </div>
          </div>
        </section>
);
