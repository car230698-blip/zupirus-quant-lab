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
  <section id="lot-calculator" className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-6 sm:p-10 space-y-8">
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-center">
      {/* Left (7 Cols): Controls */}
      <div className="space-y-6 lg:col-span-7">
        <div>
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
            DYNAMIC LOT SIZING &amp; PROP FIRM GUARD
          </span>
          <h2 className="mt-1 text-2xl sm:text-3xl font-bold text-white">
            Máy Tính Khối Lượng Vào Lệnh &amp; Quản Trị Rủi Ro
          </h2>
          <p className="mt-1.5 text-xs text-[#94A3B8]">
            Tự động chia Lot chính xác theo số dư và khoảng Stop Loss thực tế, bảo vệ quy tắc sụt giảm vốn nghiêm ngặt.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['STANDARD', 'PROP', 'CENT'] as AccountKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setCalcAccountKind(kind)}
              className={`rounded-xl border px-4 py-2 font-mono text-xs font-medium transition cursor-pointer ${
                calcAccountKind === kind
                  ? 'border-[#12B5A6] bg-[#12B5A6]/15 text-[#12B5A6]'
                  : 'border-slate-800 bg-[#080E1A] text-slate-400 hover:text-white'
              }`}
            >
              {kind === 'STANDARD'
                ? 'Tài Khoản Standard'
                : kind === 'PROP'
                ? 'Quỹ Prop (FTMO / The5ers 1% Cap)'
                : 'Tài Khoản Cent (USC)'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 font-mono">
          <div className="rounded-xl border border-slate-800/80 bg-[#080E1A] p-4">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Vốn Tài Khoản</span>
              <strong className="text-white tabular-nums">${calcBalance.toLocaleString('en-US')}</strong>
            </div>
            <input
              type="range"
              min={1000}
              max={200000}
              step={1000}
              value={calcBalance}
              onChange={(e) => setCalcBalance(Number(e.target.value))}
              className="mt-3 w-full accent-[#12B5A6]"
            />
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-[#080E1A] p-4">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Rủi Ro / Lệnh</span>
              <strong className="text-[#12B5A6] tabular-nums">{calcRiskPct.toFixed(1)}%</strong>
            </div>
            <input
              type="range"
              min={0.25}
              max={3.0}
              step={0.25}
              value={calcRiskPct}
              onChange={(e) => setCalcRiskPct(Number(e.target.value))}
              className="mt-3 w-full accent-[#12B5A6]"
            />
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-[#080E1A] p-4">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Khoảng SL</span>
              <strong className="text-[#F5B700] tabular-nums">{calcSlPips} pips</strong>
            </div>
            <input
              type="range"
              min={15}
              max={80}
              step={5}
              value={calcSlPips}
              onChange={(e) => setCalcSlPips(Number(e.target.value))}
              className="mt-3 w-full accent-[#F5B700]"
            />
          </div>
        </div>
      </div>

      {/* Right (5 Cols): Result Card */}
      <div className="lg:col-span-5">
        <div className="rounded-2xl border border-slate-800 bg-[#080E1A] p-6 space-y-5 font-mono tabular-nums">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-xs">
            <span className="text-slate-400 font-medium">PHÂN BỔ KHỐI LƯỢNG AN TOÀN</span>
            {lotCalc.propFirmSafe ? (
              <span className="rounded-md border border-[#12B5A6]/40 bg-[#12B5A6]/10 px-2 py-0.5 text-[11px] font-bold text-[#12B5A6]">
                An Toàn Quỹ Prop ✓
              </span>
            ) : (
              <span className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-400">
                0.00 Lot · Vượt Trần
              </span>
            )}
          </div>

          <div>
            <div className="text-[11px] text-slate-400 uppercase">Khối Lượng Khuyến Nghị</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-5xl font-extrabold text-white font-mono tracking-tight leading-none">
                {lotCalc.displayLots.toFixed(2)}
              </span>
              <span className="text-sm font-normal text-slate-400">{lotCalc.unitLabel}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-800/80 pt-4">
            <div>
              <div className="text-[10px] text-slate-500 uppercase">RỦI RO TUYỆT ĐỐI (1R)</div>
              <div className="mt-1 text-lg font-bold text-[#F5B700]">${lotCalc.riskUsd.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase">MỤC TIÊU 2R (TP)</div>
              <div className="mt-1 text-lg font-bold text-[#12B5A6]">+${lotCalc.rewardAt2RUsd.toFixed(2)}</div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800/70 bg-[#10192B]/80 p-3 text-xs text-slate-400 flex items-center justify-between">
            <span>Giới hạn chuỗi lệnh tối đa:</span>
            <strong className="text-slate-200">{lotCalc.maxConsecutiveLossesBeforeDailyCap} lệnh trước chạm ngưỡng DD</strong>
          </div>
        </div>
      </div>
    </div>
  </section>
);
