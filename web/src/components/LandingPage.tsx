import React, { useState, useEffect, Suspense, lazy } from 'react';
import { calculateQuantLotSizing, type AccountKind, type BillingCycle } from '../utils/quantMath';
import { useLiveTopbarTelemetry } from '../hooks/useQuantData.ts';
import { LandingQrPreviewModal } from './LandingQrPreviewModal';
import { LandingPricingAndFaqSection } from './LandingPricingAndFaqSection';
import { PublicTrackRecordSection } from './PublicTrackRecordSection';
import { LandingLotCalculator } from './LandingLotCalculator';
import { PRICING_TIERS } from '../data/landingData';
import { LandingHeader } from './LandingHeader';
import { LandingComparisonSection } from './LandingComparisonSection';
import { LandingPipelineSimulationSection } from './LandingPipelineSimulationSection';
import { LandingGuardSimulatorSection } from './LandingGuardSimulatorSection';
import { TiltCard } from './TiltCard';

const ThreeCanvasBackground = lazy(() =>
  import('./ThreeCanvasBackground').then((m) => ({ default: m.ThreeCanvasBackground }))
);

export interface LandingPageProps {
  onEnterPortal?: () => void;
  onEnterApp?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onEnterPortal: externalOnEnterPortal,
  onEnterApp,
}) => {
  const onEnterPortal = externalOnEnterPortal || onEnterApp || (() => {});
  const { data: telemetryData } = useLiveTopbarTelemetry();

  const spotPrice = Number(telemetryData?.xauusd?.bid || 0);
  const spreadPips = Number(telemetryData?.xauusd?.spread_pips || 0);
  const usdVndRate = Number(telemetryData?.usd_vnd?.rate || 25720);
  const [quantTheme, setQuantTheme] = useState<'gold' | 'cyber'>('gold');

  // Interactive Hero & Pipeline Simulator State
  const [simSide, setSimSide] = useState<'BUY' | 'SELL' | 'NO_SL'>('BUY');
  const [simStep, setSimStep] = useState<number>(4);
  const [simRunning, setSimRunning] = useState(false);
  const [heroFlash, setHeroFlash] = useState<string | null>(null);
  const [pulseTrigger, setPulseTrigger] = useState(0);

  // Interactive Safety Guard Selection
  const [selectedGuardIdx, setSelectedGuardIdx] = useState(0);

  // Interactive Lot Sizing Calculator State
  const [calcBalance, setCalcBalance] = useState(50000);
  const [calcRiskPct, setCalcRiskPct] = useState(1.0);
  const [calcSlPips, setCalcSlPips] = useState(35);
  const [calcAccountKind, setCalcAccountKind] = useState<AccountKind>('PROP');

  // Interactive Pricing & VietQR Preview State
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('QUARTERLY');
  const [currencyMode, setCurrencyMode] = useState<'VND' | 'USD'>('VND');
  const [qrPreviewTier, setQrPreviewTier] = useState<typeof PRICING_TIERS[number] | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-quant-theme', quantTheme);
  }, [quantTheme]);

  const triggerSimulation = (mode: 'BUY' | 'SELL' | 'NO_SL') => {
    setSimSide(mode);
    setSimRunning(true);
    setSimStep(1);
    setPulseTrigger((prev) => prev + 1);
    setHeroFlash(
      mode === 'NO_SL'
        ? '⛔ CHẶN BỞI LỚP GIÁP #02: Tín hiệu thiếu Stop-Loss cứng!'
        : spotPrice > 0
        ? `⚡ ĐÃ QUẠT LỆNH ${mode} XAU/USD @ $${spotPrice.toFixed(2)} TỚI CÁC TRẠM CLOUD MT5`
        : `⚡ ĐANG CHỜ DỮ LIỆU GIÁ LIVE XAU/USD TỪ HỆ THỐNG ĐỂ MÔ PHỎNG LỆNH ${mode}...`
    );
    setTimeout(() => setSimStep(2), 180);
    setTimeout(() => setSimStep(3), 360);
    setTimeout(() => {
      setSimStep(4);
      setSimRunning(false);
    }, 540);
  };

  const lotCalc = calculateQuantLotSizing({
    balanceUsd: calcBalance,
    riskPercent: calcRiskPct,
    stopLossPips: calcSlPips,
    accountKind: calcAccountKind,
    dailyDrawdownLimitPct: calcAccountKind === 'PROP' ? 4.0 : 10,
  });

  const askPrice = spotPrice > 0 ? Math.round((spotPrice + (spreadPips || 1.8) * 0.1) * 100) / 100 : 0;

  const orderBookBids = spotPrice > 0 ? [
    { price: (spotPrice - 0.05).toFixed(2), size: '4.80 Lots', depth: 88 },
    { price: (spotPrice - 0.15).toFixed(2), size: '7.25 Lots', depth: 96 },
    { price: (spotPrice - 0.30).toFixed(2), size: '3.40 Lots', depth: 62 },
  ] : [
    { price: '—', size: '—', depth: 50 },
    { price: '—', size: '—', depth: 50 },
    { price: '—', size: '—', depth: 50 },
  ];
  const orderBookAsks = askPrice > 0 ? [
    { price: (askPrice + 0.25).toFixed(2), size: '5.10 Lots', depth: 74 },
    { price: (askPrice + 0.12).toFixed(2), size: '6.40 Lots', depth: 90 },
    { price: askPrice.toFixed(2), size: '3.90 Lots', depth: 68 },
  ] : [
    { price: '—', size: '—', depth: 50 },
    { price: '—', size: '—', depth: 50 },
    { price: '—', size: '—', depth: 50 },
  ];

  return (
    <div className="min-h-screen bg-[#03050a] text-slate-100 quant-cyber-grid selection:bg-amber-500/30 selection:text-amber-200">
      {/* Interactive 3D WebGL Quantum Space Background */}
      <Suspense fallback={null}>
        <ThreeCanvasBackground theme={quantTheme} pulseTrigger={pulseTrigger} />
      </Suspense>

      {/* Ambient Sovereign Gold & Cyan Illumination */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-36 left-1/4 h-[520px] w-[520px] rounded-full bg-amber-500/12 blur-[140px] animate-aurora" />
        <div className="absolute top-1/3 right-1/5 h-[440px] w-[440px] rounded-full bg-cyan-500/10 blur-[140px]" />
      </div>

      {/* Zone 1-3 Strict Top Bar Contract & Telemetry */}
      <LandingHeader
        onEnterPortal={onEnterPortal}
        spotPrice={spotPrice}
        askPrice={askPrice}
        usdVndRate={usdVndRate}
        quantTheme={quantTheme}
        setQuantTheme={setQuantTheme}
      />

      {/* Main Content Container */}
      <main id="top" className="relative z-10 mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-8 space-y-24">
        {/* SECTION 1: SOVEREIGN XAU/USD HERO SPLIT + INTERACTIVE ORDERFLOW COCKPIT */}
        <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12">
          {/* Left 7 Columns: Value Proposition & Instant Portal Launch */}
          <div className="space-y-6 lg:col-span-7">
            <div className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 font-mono text-xs font-bold tracking-wider text-amber-300 uppercase">
              <span>SOVEREIGN XAU/USD QUANTUM OS v4.0</span>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="text-cyan-300">ZERO VPS / ZERO EA</span>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="text-emerald-300">TABULA RASA AI</span>
            </div>

            <h1
              className="font-display font-extrabold tracking-tight text-white text-balance"
              style={{ fontSize: 'clamp(2.35rem, 4.4vw + 0.6rem, 4.1rem)', lineHeight: 1.06 }}
            >
              Trạm Thực Thi Định Lượng{' '}
              <span className="bg-gradient-to-r from-amber-200 via-amber-400 to-cyan-300 bg-clip-text text-transparent">
                Vàng (XAU/USD)
              </span>{' '}
              Trực Tiếp Trên Đám Mây
            </h1>

            <p className="max-w-2xl text-base sm:text-lg leading-relaxed text-slate-300">
              Loại bỏ hoàn toàn máy chủ VPS treo 24/7 và rủi ro đứt kết nối phần mềm EA. ZUPIRUS đấu nối trực tiếp cụm máy chủ{' '}
              <strong className="text-amber-300">MetaApi London G2</strong> tới tài khoản MT5 của bạn, vận hành mô hình học quy nạp{' '}
              <strong className="text-cyan-300">Tabula Rasa</strong> và kiểm toán 4 lớp giáp bảo vệ vốn trước mọi quyết định vào lệnh.
            </p>

            {/* Global Gold Session Status Strip */}
            <div className="grid grid-cols-3 gap-2.5 max-w-xl rounded-2xl border border-white/10 bg-[#070c18]/90 p-3 font-mono text-xs">
              <div className="rounded-xl border border-white/[0.06] bg-[#040710] px-3 py-2">
                <div className="text-[10px] text-slate-500">PHIÊN Á (TOKYO)</div>
                <div className="mt-0.5 font-bold text-slate-400">ĐÃ ĐÓNG · QUÉT BIÊN</div>
              </div>
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2">
                <div className="flex items-center justify-between text-[10px] text-amber-300">
                  <span>PHIÊN ÂU (LONDON)</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <div className="mt-0.5 font-bold text-white">THANH KHOẢN CAO</div>
              </div>
              <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-3 py-2">
                <div className="flex items-center justify-between text-[10px] text-cyan-300">
                  <span>PHIÊN MỸ (NEW YORK)</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <div className="mt-0.5 font-bold text-white">OVERLAP M15 ACTIVE</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3.5 pt-1">
              <button
                type="button"
                onClick={onEnterPortal}
                className="quant-btn-primary px-6 py-3.5 text-sm whitespace-nowrap shrink-0"
              >
                ◈ Mở Cổng Giao Dịch →
              </button>
              <button
                type="button"
                onClick={() => triggerSimulation('BUY')}
                className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-3.5 font-mono text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 transition whitespace-nowrap shrink-0 cursor-pointer"
              >
                ▶ Bắn Thử Lệnh XAU/USD
              </button>
            </div>

            {heroFlash && (
              <div className="rounded-xl border border-amber-400/45 bg-amber-500/15 px-4 py-2.5 font-mono text-xs font-bold text-amber-200 shadow-[0_0_24px_rgba(245,158,11,0.2)]">
                {heroFlash}
              </div>
            )}

            {/* Unboxed Institutional Proof Bar */}
            <div className="grid grid-cols-2 gap-6 border-t border-white/10 pt-5 sm:grid-cols-4 font-mono">
              <div>
                <div className="text-[11px] uppercase text-slate-400">Cầu nối thực thi</div>
                <div className="mt-1 text-sm font-extrabold text-amber-300">MetaApi London G2</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-slate-400">Bảo toàn vị thế</div>
                <div className="mt-1 text-sm font-extrabold text-emerald-400">Auto 1R Break-Even</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-slate-400">Tương thích đa sàn</div>
                <div className="mt-1 text-sm font-extrabold text-cyan-300">Exness · FTMO · ICM</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-slate-400">Thanh toán tự động</div>
                <div className="mt-1 text-sm font-extrabold text-white">3 Giây SePay VietQR</div>
              </div>
            </div>
          </div>

          {/* Right 5 Columns: Interactive Sovereign XAU/USD Orderflow & Multi-Account Cockpit */}
          <div className="lg:col-span-5">
            <TiltCard className="rounded-2xl">
              <div className="quant-panel quant-hud-corner p-5 sm:p-6 space-y-4 border-amber-500/35 shadow-[0_24px_70px_rgba(0,0,0,0.75)]">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
                    <span className="font-bold text-amber-300">QUANTUM ORDERFLOW COCKPIT · XAU/USD</span>
                  </div>
                  <span className="rounded-md bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300 tabular-nums">
                    24.0 ms G2
                  </span>
                </div>

              {/* Top Quote & 1-Click Execution Trigger Strip */}
              <div className="grid grid-cols-3 gap-2.5 font-mono tabular-nums">
                <button
                  type="button"
                  onClick={() => triggerSimulation('SELL')}
                  className="rounded-xl border border-rose-500/35 bg-rose-950/25 p-3 text-left hover:border-rose-400 transition cursor-pointer"
                >
                  <div className="flex items-center justify-between text-[10px] text-rose-300">
                    <span>SELL (BID)</span>
                    <span>⚡</span>
                  </div>
                  <div className="mt-1 text-lg font-extrabold text-white">{spotPrice > 0 ? `$${spotPrice.toFixed(2)}` : '—'}</div>
                </button>

                <div className="rounded-xl border border-amber-500/30 bg-[#050914] p-3 text-center flex flex-col justify-center">
                  <div className="text-[10px] text-slate-400 uppercase">SPREAD G2</div>
                  <div className="mt-1 text-base font-extrabold text-amber-300">{spreadPips > 0 ? `${spreadPips.toFixed(1)} pips` : 'Real-time'}</div>
                  <div className="text-[9.5px] text-emerald-400">ATR(14): 4.50</div>
                </div>

                <button
                  type="button"
                  onClick={() => triggerSimulation('BUY')}
                  className="rounded-xl border border-emerald-500/35 bg-emerald-950/25 p-3 text-left hover:border-emerald-400 transition cursor-pointer"
                >
                  <div className="flex items-center justify-between text-[10px] text-emerald-300">
                    <span>BUY (ASK)</span>
                    <span>⚡</span>
                  </div>
                  <div className="mt-1 text-lg font-extrabold text-white">{askPrice > 0 ? `$${askPrice.toFixed(2)}` : '—'}</div>
                </button>
              </div>

              {/* Orderbook Depth of Market (DOM) Liquidity Ladder */}
              <div className="rounded-xl border border-white/10 bg-[#040710]/95 p-3.5 space-y-2 font-mono text-xs tabular-nums">
                <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase">
                  <span>Sổ Lệnh Thanh Khoản (DOM Level 2)</span>
                  <span className="text-amber-300">London Institutional Pool</span>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  {/* Bids */}
                  <div className="space-y-1">
                    {orderBookBids.map((b, i) => (
                      <div key={i} className="relative overflow-hidden rounded bg-emerald-500/[0.06] px-2 py-1 flex items-center justify-between text-[11px]">
                        <div
                          className="absolute inset-y-0 left-0 bg-emerald-500/15 pointer-events-none"
                          style={{ width: `${b.depth}%` }}
                        />
                        <span className="relative z-10 font-bold text-emerald-400">${b.price}</span>
                        <span className="relative z-10 text-slate-300">{b.size}</span>
                      </div>
                    ))}
                  </div>
                  {/* Asks */}
                  <div className="space-y-1">
                    {orderBookAsks.map((a, i) => (
                      <div key={i} className="relative overflow-hidden rounded bg-rose-500/[0.06] px-2 py-1 flex items-center justify-between text-[11px]">
                        <div
                          className="absolute inset-y-0 right-0 bg-rose-500/15 pointer-events-none"
                          style={{ width: `${a.depth}%` }}
                        />
                        <span className="relative z-10 font-bold text-rose-400">${a.price}</span>
                        <span className="relative z-10 text-slate-300">{a.size}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* M15 Quantum Momentum SVG Wave */}
              <div className="rounded-xl border border-white/10 bg-[#040710]/95 p-3.5">
                <div className="mb-2 flex items-center justify-between font-mono text-[11px]">
                  <span className="text-amber-300 font-bold">M15 MOMENTUM REGIME · EXPANSION</span>
                  <span className="text-cyan-300 tabular-nums">WinRate OOS: 71.4%</span>
                </div>
                <svg viewBox="0 0 360 76" className="h-16 w-full overflow-visible">
                  <defs>
                    <linearGradient id="goldWaveGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.42" />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0,62 L40,56 L80,59 L120,44 L160,47 L200,32 L240,36 L280,20 L320,24 L360,10 L360,74 L0,74 Z"
                    fill="url(#goldWaveGrad)"
                  />
                  <path
                    d="M0,58 L40,53 L80,54 L120,48 L160,45 L200,39 L240,37 L280,29 L320,26 L360,18"
                    fill="none"
                    stroke="#06b6d4"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                  />
                  <path
                    d="M0,62 L40,56 L80,59 L120,44 L160,47 L200,32 L240,36 L280,20 L320,24 L360,10"
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth="2.5"
                  />
                  <circle cx="360" cy="10" r="4.5" className="fill-amber-400" />
                </svg>
              </div>

              {/* Live Connected Cloud MT5 Nodes Fan-Out Status */}
              <div className="space-y-1.5 rounded-xl border border-amber-500/25 bg-[#050914] p-3 font-mono text-xs">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>TRẠM CLOUD MT5 ĐANG ĐỒNG BỘ (3/3)</span>
                  <span className="text-emerald-400 font-bold">FAIL-CLOSED ARMED</span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] tabular-nums">
                  <div className="rounded-lg border border-white/[0.06] bg-[#03060e] p-2">
                    <div className="text-amber-300 font-bold truncate">Exness Real</div>
                    <div className="text-slate-400 text-[10px]">0.25 Lot · 22ms</div>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-[#03060e] p-2">
                    <div className="text-cyan-300 font-bold truncate">FTMO $100k</div>
                    <div className="text-slate-400 text-[10px]">0.50 Lot · 25ms</div>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-[#03060e] p-2">
                    <div className="text-emerald-300 font-bold truncate">ICM Cent</div>
                    <div className="text-slate-400 text-[10px]">2.50 Lot · 24ms</div>
                  </div>
                </div>
              </div>
            </div>
            </TiltCard>
          </div>
        </section>

        {/* SECTION 2 & 2B: SO SÁNH & QUY TRÌNH 3 BƯỚC */}
        <LandingComparisonSection />

        {/* SECTION 3: INTERACTIVE 4-STAGE QUANTUM FAN-OUT SIMULATOR */}
        <LandingPipelineSimulationSection
          spotPrice={spotPrice}
          simSide={simSide}
          simStep={simStep}
          simRunning={simRunning}
          triggerSimulation={triggerSimulation}
        />

        {/* SECTION 4: INTERACTIVE 4-LAYER FAIL-CLOSED SAFETY SHIELD */}
        <LandingGuardSimulatorSection
          selectedGuardIdx={selectedGuardIdx}
          setSelectedGuardIdx={setSelectedGuardIdx}
        />

        <LandingLotCalculator
          calcAccountKind={calcAccountKind}
          setCalcAccountKind={setCalcAccountKind}
          calcBalance={calcBalance}
          setCalcBalance={setCalcBalance}
          calcRiskPct={calcRiskPct}
          setCalcRiskPct={setCalcRiskPct}
          calcSlPips={calcSlPips}
          setCalcSlPips={setCalcSlPips}
          lotCalc={lotCalc}
        />

        <PublicTrackRecordSection onEnterPortal={onEnterPortal} />

        <LandingPricingAndFaqSection
          tiers={PRICING_TIERS}
          billingCycle={billingCycle}
          setBillingCycle={setBillingCycle}
          currencyMode={currencyMode}
          setCurrencyMode={setCurrencyMode}
          usdVndRate={usdVndRate}
          setQrPreviewTier={setQrPreviewTier}
          onEnterPortal={onEnterPortal}
        />
      </main>

      <LandingQrPreviewModal
        qrPreviewTier={qrPreviewTier}
        setQrPreviewTier={setQrPreviewTier}
        billingCycle={billingCycle}
        usdVndRate={usdVndRate}
        onEnterPortal={onEnterPortal}
      />
    </div>
  );
};
