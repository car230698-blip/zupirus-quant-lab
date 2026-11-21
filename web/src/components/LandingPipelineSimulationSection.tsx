import React from 'react';
import { IconBan, IconBolt } from './Icons';

export interface LandingPipelineSimulationSectionProps {
  spotPrice: number;
  simSide: 'BUY' | 'SELL' | 'NO_SL';
  simStep: number;
  simRunning: boolean;
  triggerSimulation: (mode: 'BUY' | 'SELL' | 'NO_SL') => void;
}

export const LandingPipelineSimulationSection: React.FC<LandingPipelineSimulationSectionProps> = ({
  spotPrice,
  simSide,
  simStep,
  simRunning,
  triggerSimulation,
}) => {
  return (
    <section id="pipeline" className="quant-panel p-6 sm:p-10 space-y-8">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
            QUANTUM EXECUTION PIPELINE SIMULATOR
          </div>
          <h2 className="mt-1.5 font-display text-2xl sm:text-3xl font-extrabold text-white">
            Mô Phỏng Luồng Quạt Lệnh Đa Sàn (Multi-Broker Fan-Out)
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-300">
            Kiểm nghiệm trực tiếp cách ZUPIRUS xử lý một tín hiệu XAU/USD từ lúc tiếp nhận đến khi khớp lệnh đồng thời trên nhiều tài khoản.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => triggerSimulation('BUY')}
            disabled={simRunning}
            className={`px-4 py-2.5 text-xs font-mono font-bold rounded-xl transition whitespace-nowrap shrink-0 cursor-pointer ${
              simSide === 'BUY'
                ? 'quant-btn-primary'
                : 'quant-btn-secondary'
            }`}
          >
            <IconBolt className="w-3.5 h-3.5" />
            Bắn Thử BUY XAU/USD
          </button>
          <button
            type="button"
            onClick={() => triggerSimulation('SELL')}
            disabled={simRunning}
            className={`px-4 py-2.5 text-xs font-mono font-bold rounded-xl transition whitespace-nowrap shrink-0 cursor-pointer ${
              simSide === 'SELL'
                ? 'quant-btn-primary'
                : 'quant-btn-secondary'
            }`}
          >
            <IconBolt className="w-3.5 h-3.5" />
            Bắn Thử SELL XAU/USD
          </button>
          <button
            type="button"
            onClick={() => triggerSimulation('NO_SL')}
            disabled={simRunning}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-bold rounded-xl border transition whitespace-nowrap shrink-0 cursor-pointer ${
              simSide === 'NO_SL'
                ? 'border-rose-400 bg-rose-500/25 text-rose-200'
                : 'border-rose-500/30 bg-rose-950/20 text-rose-300 hover:bg-rose-500/20'
            }`}
          >
            <IconBan className="w-3.5 h-3.5" />
            Thử Kịch Bản Thiếu SL (Fail-Closed)
          </button>
        </div>
      </div>

      {/* 4 Pipeline Stages */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          {
            step: 1,
            code: 'STAGE 01 // INGEST',
            title: 'Thu Thập & Chuẩn Hóa',
            detail:
              simSide === 'NO_SL'
                ? 'Nhận tín hiệu: BUY GOLD NOW (Không có SL)'
                : `Chuẩn hóa: ${simSide} XAUUSD @ $${spotPrice.toFixed(2)}`,
            latency: '1.2 ms',
          },
          {
            step: 2,
            code: 'STAGE 02 // TABULA RASA AI',
            title: 'Chấm Điểm Bối Cảnh M15',
            detail: 'Kiểm tra ATR(14)=4.50, Phiên London-NY Overlap, Trust Score 91.4/100',
            latency: '4.6 ms',
          },
          {
            step: 3,
            code: 'STAGE 03 // 4-LAYER SHIELD',
            title: 'Kiểm Toán 4 Lớp Giáp Vốn',
            detail:
              simSide === 'NO_SL'
                ? 'CHẶN TẠI LỚP #02: Tín hiệu thiếu Hard Stop-Loss!'
                : 'PASS: Redis Lock OK · Hard SL OK · News Shield CLEAR · Spread 1.8p',
            latency: '0.8 ms',
          },
          {
            step: 4,
            code: 'STAGE 04 // CLOUD FAN-OUT',
            title: 'Quạt Lệnh Đa Tài Khoản MT5',
            detail:
              simSide === 'NO_SL'
                ? '0 lệnh được gửi đi — Bảo toàn 100% vốn tài khoản.'
                : 'Khớp lệnh đồng thời trên Exness, FTMO Prop và ICMarkets.',
            latency: simSide === 'NO_SL' ? 'HALTED' : '24.0 ms',
          },
        ].map((st) => {
          const isReached = simStep >= st.step;
          const isBlockedStage = simSide === 'NO_SL' && st.step >= 3;
          return (
            <div
              key={st.step}
              className={`rounded-2xl border p-5 transition-all ${
                isBlockedStage
                  ? 'border-rose-500/45 bg-rose-950/20'
                  : isReached
                  ? 'border-amber-400/45 bg-[#091224] shadow-[0_0_25px_rgba(245,158,11,0.12)]'
                  : 'border-white/10 bg-[#050914]/60 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className={isBlockedStage ? 'text-rose-300 font-bold' : 'text-amber-300 font-bold'}>
                  {st.code}
                </span>
                <span className="text-emerald-400 tabular-nums">{st.latency}</span>
              </div>
              <div className="mt-2 text-sm font-bold text-white">{st.title}</div>
              <p className="mt-1.5 font-mono text-xs leading-relaxed text-slate-300">{st.detail}</p>
            </div>
          );
        })}
      </div>

      {/* Multi-Broker Fan-Out Receipts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 font-mono text-xs">
        {[
          {
            broker: 'Exness-MT5Real (#880192)',
            type: 'STANDARD',
            symbol: 'XAUUSDm',
            lots: '0.25 Lot',
            latency: '22 ms',
          },
          {
            broker: 'FTMO-Server (#509182)',
            type: 'PROP FIRM $100K',
            symbol: 'XAUUSD',
            lots: '0.50 Lot',
            latency: '25 ms',
          },
          {
            broker: 'ICMarketsSC-MT5 (#309411)',
            type: 'CENT ACCOUNT',
            symbol: 'XAUUSD.a',
            lots: '2.50 Cent Lot',
            latency: '24 ms',
          },
        ].map((node) => (
          <div
            key={node.broker}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-[#040710]/90 p-4 tabular-nums"
          >
            <div>
              <div className="text-[10px] text-amber-300 font-bold">{node.type}</div>
              <div className="mt-0.5 font-bold text-white">{node.broker}</div>
              <div className="mt-1 text-slate-400">
                Symbol: <strong className="text-cyan-300">{node.symbol}</strong> · Khối lượng:{' '}
                <strong className="text-white">{node.lots}</strong>
              </div>
            </div>
            <div className="text-right">
              <span
                className={`inline-block rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                  simSide === 'NO_SL'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                }`}
              >
                {simSide === 'NO_SL' ? 'PROTECTED' : `FILLED · ${node.latency}`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
