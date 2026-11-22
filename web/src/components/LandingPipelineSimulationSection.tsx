import React from 'react';
import { IconBan, IconBolt } from './Icons';
import { useLanguage } from '../i18n/LanguageContext';

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
  const { lang } = useLanguage();
  const displayPrice = spotPrice > 0 ? spotPrice.toFixed(2) : '3538.86';

  return (
    <section id="pipeline" className="rounded-3xl border border-slate-800/80 bg-[#080d19]/95 p-6 sm:p-10 space-y-7 shadow-2xl backdrop-blur-md">
      {/* Header & Interactive Action Buttons */}
      <div className="space-y-4">
        <div>
          <div className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-400">
            QUANTUM EXECUTION PIPELINE SIMULATOR
          </div>
          <h2 className="mt-1 font-display text-2xl sm:text-3xl font-extrabold text-white leading-tight">
            {lang === 'en'
              ? 'Multi-Broker Fan-Out Execution Simulator'
              : 'Mô Phỏng Luồng Quạt Lệnh Đa Sàn (Multi-Broker Fan-Out)'}
          </h2>
          <p className="mt-1.5 max-w-2xl text-xs sm:text-sm text-slate-300">
            {lang === 'en'
              ? 'Experience how ZUPIRUS ingests, filters, and executes XAU/USD signals simultaneously across multiple broker accounts.'
              : 'Kiểm nghiệm trực tiếp cách ZUPIRUS xử lý một tín hiệu XAU/USD từ lúc tiếp nhận đến khi khớp lệnh đồng thời trên nhiều tài khoản.'}
          </p>
        </div>

        {/* 3 Simulation Trigger Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => triggerSimulation('BUY')}
            disabled={simRunning}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-mono font-bold rounded-xl transition whitespace-nowrap cursor-pointer ${
              simSide === 'BUY'
                ? 'bg-[#22c55e] text-slate-950 shadow-[0_0_20px_rgba(34,197,94,0.4)]'
                : 'border border-slate-700 bg-[#0f172a] text-slate-200 hover:border-slate-500'
            }`}
          >
            <IconBolt className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? '⚡ Test BUY XAU/USD' : '⚡ Bắn Thử BUY XAU/USD'}</span>
          </button>
          <button
            type="button"
            onClick={() => triggerSimulation('SELL')}
            disabled={simRunning}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-mono font-bold rounded-xl transition whitespace-nowrap cursor-pointer ${
              simSide === 'SELL'
                ? 'bg-[#22c55e] text-slate-950 shadow-[0_0_20px_rgba(34,197,94,0.4)]'
                : 'border border-slate-700/80 bg-[#141d2e] text-slate-200 hover:border-slate-500'
            }`}
          >
            <IconBolt className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? '⚡ Test SELL XAU/USD' : '⚡ Bắn Thử SELL XAU/USD'}</span>
          </button>
          <button
            type="button"
            onClick={() => triggerSimulation('NO_SL')}
            disabled={simRunning}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-mono font-bold rounded-xl border transition whitespace-nowrap cursor-pointer ${
              simSide === 'NO_SL'
                ? 'border-rose-400 bg-rose-500/25 text-rose-200 shadow-[0_0_20px_rgba(244,63,94,0.35)]'
                : 'border-rose-900/60 bg-[#1e111a] text-rose-300 hover:bg-rose-900/40'
            }`}
          >
            <IconBan className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? '⊘ Test Missing SL (Fail-Closed)' : '⊘ Thử Kịch Bản Thiếu SL (Fail-Closed)'}</span>
          </button>
        </div>
      </div>

      {/* 4 Pipeline Stages */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            step: 1,
            code: 'STAGE 01 // INGEST',
            title: lang === 'en' ? 'Ingest & Normalize' : 'Thu Thập & Chuẩn Hóa',
            detail:
              simSide === 'NO_SL'
                ? lang === 'en'
                  ? 'Signal received: BUY GOLD NOW (No Stop Loss)'
                  : 'Nhận tín hiệu: BUY GOLD NOW (Không có SL)'
                : lang === 'en'
                  ? `Normalized: ${simSide} XAUUSD @ $${displayPrice}`
                  : `Chuẩn hóa: ${simSide} XAUUSD @ $${displayPrice}`,
            latency: '1.2 ms',
          },
          {
            step: 2,
            code: 'STAGE 02 // TABULA RASA AI',
            title: lang === 'en' ? 'M15 Context Scoring' : 'Chấm Điểm Bối Cảnh M15',
            detail: lang === 'en'
              ? 'Checks ATR(14)=4.50, London-NY Overlap, Trust Score 91.4/100'
              : 'Kiểm tra ATR(14)=4.50, Phiên London-NY Overlap, Trust Score 91.4/100',
            latency: '4.6 ms',
          },
          {
            step: 3,
            code: 'STAGE 03 // 4-LAYER SHIELD',
            title: lang === 'en' ? '4-Layer Shield Audit' : 'Kiểm Toán 4 Lớp Giáp Vốn',
            detail:
              simSide === 'NO_SL'
                ? lang === 'en'
                  ? 'HALTED AT LAYER #02: Signal missing Hard Stop-Loss!'
                  : 'CHẶN TẠI LỚP #02: Tín hiệu thiếu Hard Stop-Loss!'
                : 'PASS: Redis Lock OK · Hard SL OK · News Shield CLEAR · Spread 1.8p',
            latency: '0.8 ms',
          },
          {
            step: 4,
            code: 'STAGE 04 // CLOUD FAN-OUT',
            title: lang === 'en' ? 'Multi-Account Cloud Fan-Out' : 'Quạt Lệnh Đa Tài Khoản MT5',
            detail:
              simSide === 'NO_SL'
                ? lang === 'en'
                  ? '0 orders dispatched — 100% capital protected.'
                  : '0 lệnh được gửi đi — Bảo toàn 100% vốn tài khoản.'
                : lang === 'en'
                  ? 'Simultaneous fill on Exness, FTMO Prop, and ICMarkets.'
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
                  ? 'border-rose-500/50 bg-rose-950/20 shadow-[0_0_20px_rgba(244,63,94,0.15)]'
                  : isReached
                  ? 'border-amber-500/40 bg-[#080e1c] shadow-[0_0_20px_rgba(245,158,11,0.08)]'
                  : 'border-amber-500/25 bg-[#060a14] opacity-85'
              }`}
            >
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className={isBlockedStage ? 'text-rose-400 font-bold' : 'text-amber-400 font-bold'}>
                  {st.code}
                </span>
                <span className="text-emerald-400 font-bold tabular-nums">{st.latency}</span>
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
            className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-[#060a14] p-4.5 tabular-nums"
          >
            <div>
              <div className="text-[10px] text-amber-400 font-bold tracking-wider">{node.type}</div>
              <div className="mt-0.5 font-bold text-white text-sm">{node.broker}</div>
              <div className="mt-1 text-slate-400 text-xs">
                Symbol: <strong className="text-slate-200 font-semibold">{node.symbol}</strong> · {lang === 'en' ? 'Volume' : 'Khối lượng'}:{' '}
                <strong className="text-slate-200 font-semibold">{node.lots}</strong>
              </div>
            </div>
            <div className="text-right shrink-0 ml-3">
              <span
                className={`inline-block rounded-lg px-3 py-1.5 text-xs font-bold ${
                  simSide === 'NO_SL'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/50'
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
