import React, { useState, useEffect } from 'react';
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
import { FintechAmbientBackdrop } from './FintechAmbientBackdrop';

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

  // Interactive Pipeline Simulator State
  const [simSide, setSimSide] = useState<'BUY' | 'SELL' | 'NO_SL'>('BUY');
  const [simStep, setSimStep] = useState<number>(4);
  const [simRunning, setSimRunning] = useState(false);
  const [heroFlash, setHeroFlash] = useState<string | null>(null);

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
    setHeroFlash(
      mode === 'NO_SL'
        ? '⛔ CHẶN BỞI LỚP GIÁP #02: Tín hiệu thiếu Stop-Loss cứng!'
        : spotPrice > 0
        ? `⚡ ĐÃ QUẠT LỆNH ${mode} XAU/USD @ $${spotPrice.toFixed(2)} TỚI CÁC TRẠM CLOUD MT5`
        : `⚡ ĐANG CHỜ DỮ LIỆU GIÁ LIVE XAU/USD ĐỂ MÔ PHỎNG LỆNH ${mode}...`
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
    { price: '2,912.35', size: '4.80 Lots', depth: 88 },
    { price: '2,912.25', size: '7.25 Lots', depth: 96 },
    { price: '2,912.10', size: '3.40 Lots', depth: 62 },
  ];

  const orderBookAsks = askPrice > 0 ? [
    { price: (askPrice + 0.25).toFixed(2), size: '5.10 Lots', depth: 74 },
    { price: (askPrice + 0.12).toFixed(2), size: '6.40 Lots', depth: 90 },
    { price: askPrice.toFixed(2), size: '3.90 Lots', depth: 68 },
  ] : [
    { price: '2,912.80', size: '5.10 Lots', depth: 74 },
    { price: '2,912.65', size: '6.40 Lots', depth: 90 },
    { price: '2,912.55', size: '3.90 Lots', depth: 68 },
  ];

  return (
    <div className="relative min-h-screen bg-[#03060d] text-slate-100 selection:bg-[#12B5A6]/30 selection:text-[#12B5A6]">
      {/* High-Tech Ambient Backdrop (Aurora Glows, Cyber-Grid, 0% GPU) */}
      <FintechAmbientBackdrop />

      {/* Header with live ticker & Discord link */}
      <LandingHeader
        onEnterPortal={onEnterPortal}
        spotPrice={spotPrice}
        askPrice={askPrice}
        usdVndRate={usdVndRate}
        quantTheme={quantTheme}
        setQuantTheme={setQuantTheme}
      />

      {/* Main Content Container */}
      <main id="top" className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-8 space-y-24 lg:space-y-32">
        {/* SECTION 1: HERO (2-COLUMN 6/6 BALANCED COCKPIT) */}
        <section className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 py-6 lg:py-12">
          {/* Left Column (6 Cols): Value Proposition & Direct Launch */}
          <div className="space-y-6 lg:col-span-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1 text-xs font-mono font-medium text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>SOVEREIGN XAU/USD QUANT OS v4.0 · ZERO VPS</span>
            </div>

            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight text-white leading-[1.12]">
              Trạm Thực Thi Định Lượng{' '}
              <span className="bg-gradient-to-r from-amber-200 via-amber-400 to-[#12B5A6] bg-clip-text text-transparent">
                Vàng (XAU/USD)
              </span>{' '}
              Trên Đám Mây
            </h1>

            <p className="text-[17px] leading-relaxed text-[#94A3B8] max-w-[55ch]">
              Loại bỏ hoàn toàn sự cố treo máy VPS và rủi ro đứt kết nối EA. ZUPIRUS đấu nối trực tiếp cụm máy chủ London G2 tới tài khoản MT5, kiểm toán 4 lớp giáp bảo vệ vốn trước mọi quyết định vào lệnh.
            </p>

            {/* Global Gold Session Status Strip */}
            <div className="grid grid-cols-3 gap-2.5 max-w-xl rounded-xl border border-slate-800 bg-[#070D1C]/90 p-2.5 font-mono text-xs">
              <div className="rounded-lg border border-slate-800/80 bg-[#040814] px-2.5 py-2">
                <div className="text-[10px] text-slate-500">PHIÊN Á (TOKYO)</div>
                <div className="mt-0.5 font-bold text-slate-400 text-[11px]">ĐÃ ĐÓNG · QUÉT BIÊN</div>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
                <div className="flex items-center justify-between text-[10px] text-amber-300">
                  <span>PHIÊN ÂU (LONDON)</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <div className="mt-0.5 font-bold text-white text-[11px]">THANH KHOẢN CAO</div>
              </div>
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-2">
                <div className="flex items-center justify-between text-[10px] text-cyan-300">
                  <span>PHIÊN MỸ (NEW YORK)</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <div className="mt-0.5 font-bold text-white text-[11px]">OVERLAP ACTIVE</div>
              </div>
            </div>

            {/* Action Buttons & Discord Community */}
            <div className="flex flex-wrap items-center gap-3.5 pt-1">
              <button
                type="button"
                onClick={onEnterPortal}
                className="rounded-xl bg-[#12B5A6] px-6 py-3.5 text-sm font-bold text-[#042F2E] hover:bg-[#14C9B8] transition-colors shadow-sm cursor-pointer whitespace-nowrap"
              >
                ◈ Mở Cổng Giao Dịch →
              </button>
              <button
                type="button"
                onClick={() => triggerSimulation('BUY')}
                className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-3.5 font-mono text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 transition whitespace-nowrap cursor-pointer"
              >
                ▶ Bắn Thử Lệnh BUY XAU/USD
              </button>
              <a
                href="https://discord.gg/yxCx3dVe34"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-[#5865F2]/40 bg-[#5865F2]/15 px-4 py-3.5 font-mono text-xs font-bold text-[#8EA1FF] hover:bg-[#5865F2]/25 transition whitespace-nowrap"
              >
                <span>Cộng Đồng Discord</span>
                <span>↗</span>
              </a>
            </div>

            {heroFlash && (
              <div className="rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-2.5 font-mono text-xs font-bold text-amber-200">
                {heroFlash}
              </div>
            )}

            {/* Unboxed Institutional Proof Bar */}
            <div className="grid grid-cols-2 gap-4 border-t border-slate-800/80 pt-5 sm:grid-cols-4 font-mono text-xs">
              <div>
                <div className="text-[10px] uppercase text-slate-400">Cầu nối thực thi</div>
                <div className="mt-0.5 font-bold text-amber-300">MetaApi London G2</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-slate-400">Bảo toàn vị thế</div>
                <div className="mt-0.5 font-bold text-emerald-400">Auto 1R Break-Even</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-slate-400">Tương thích đa sàn</div>
                <div className="mt-0.5 font-bold text-cyan-300">Exness · FTMO · ICM</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-slate-400">Kích hoạt tự động</div>
                <div className="mt-0.5 font-bold text-white">3 Giây SePay VietQR</div>
              </div>
            </div>
          </div>

          {/* Right Column (6 Cols): Interactive Sovereign XAU/USD Orderflow Cockpit */}
          <div className="lg:col-span-6">
            <div className="rounded-2xl border border-amber-500/35 bg-[#0A1122]/95 p-5 sm:p-6 shadow-[0_20px_60px_rgba(0,0,0,0.7)] space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="font-bold text-amber-300">ORDERFLOW COCKPIT · XAU/USD</span>
                </div>
                <span className="rounded-md border border-slate-700 bg-[#040814] px-2 py-0.5 font-mono text-[11px] text-emerald-400 tabular-nums">
                  24.0 ms G2
                </span>
              </div>

              {/* 1-Click Interactive Execution Triggers */}
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
                  <div className="mt-1 text-base font-extrabold text-white">
                    {spotPrice > 0 ? `$${spotPrice.toFixed(2)}` : '$2,912.40'}
                  </div>
                </button>

                <div className="rounded-xl border border-amber-500/30 bg-[#040814] p-3 text-center flex flex-col justify-center">
                  <div className="text-[10px] text-slate-400 uppercase">SPREAD G2</div>
                  <div className="mt-0.5 text-base font-extrabold text-amber-300">
                    {spreadPips > 0 ? `${spreadPips.toFixed(1)} pips` : '1.8 pips'}
                  </div>
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
                  <div className="mt-1 text-base font-extrabold text-white">
                    {askPrice > 0 ? `$${askPrice.toFixed(2)}` : '$2,912.58'}
                  </div>
                </button>
              </div>

              {/* Orderbook Depth of Market (DOM) Liquidity Ladder */}
              <div className="rounded-xl border border-slate-800 bg-[#040814] p-3 space-y-2 font-mono text-xs tabular-nums">
                <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase">
                  <span>Sổ Lệnh Thanh Khoản (DOM Level 2)</span>
                  <span className="text-amber-300">London Pool</span>
                </div>
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <div className="space-y-1">
                    {orderBookBids.map((b, i) => (
                      <div key={i} className="relative overflow-hidden rounded bg-emerald-500/[0.06] px-2 py-0.5 flex items-center justify-between text-[11px]">
                        <div className="absolute inset-y-0 left-0 bg-emerald-500/15 pointer-events-none" style={{ width: `${b.depth}%` }} />
                        <span className="relative z-10 font-bold text-emerald-400">${b.price}</span>
                        <span className="relative z-10 text-slate-300">{b.size}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {orderBookAsks.map((a, i) => (
                      <div key={i} className="relative overflow-hidden rounded bg-rose-500/[0.06] px-2 py-0.5 flex items-center justify-between text-[11px]">
                        <div className="absolute inset-y-0 right-0 bg-rose-500/15 pointer-events-none" style={{ width: `${a.depth}%` }} />
                        <span className="relative z-10 font-bold text-rose-400">${a.price}</span>
                        <span className="relative z-10 text-slate-300">{a.size}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* M15 Quantum Momentum SVG Wave */}
              <div className="rounded-xl border border-slate-800 bg-[#040814] p-3">
                <div className="mb-1.5 flex items-center justify-between font-mono text-[11px]">
                  <span className="text-amber-300 font-bold">M15 MOMENTUM REGIME · EXPANSION</span>
                  <span className="text-cyan-300 tabular-nums">WinRate OOS: 71.4%</span>
                </div>
                <svg viewBox="0 0 360 76" className="h-16 w-full overflow-visible">
                  <defs>
                    <linearGradient id="heroGoldWave" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  <path d="M0,62 L40,56 L80,59 L120,44 L160,47 L200,32 L240,36 L280,20 L320,24 L360,10 L360,74 L0,74 Z" fill="url(#heroGoldWave)" />
                  <path d="M0,58 L40,53 L80,54 L120,48 L160,45 L200,39 L240,37 L280,29 L320,26 L360,18" fill="none" stroke="#06b6d4" strokeWidth="1.5" strokeDasharray="4 3" />
                  <path d="M0,62 L40,56 L80,59 L120,44 L160,47 L200,32 L240,36 L280,20 L320,24 L360,10" fill="none" stroke="#fbbf24" strokeWidth="2.5" />
                  <circle cx="360" cy="10" r="4.5" className="fill-amber-400" />
                </svg>
              </div>

              {/* Live Connected Cloud MT5 Nodes Fan-Out Status */}
              <div className="space-y-1.5 rounded-xl border border-amber-500/25 bg-[#040814] p-3 font-mono text-xs">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>TRẠM CLOUD MT5 ĐỒNG BỘ (3/3)</span>
                  <span className="text-emerald-400 font-bold">FAIL-CLOSED ARMED</span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] tabular-nums">
                  <div className="rounded-lg border border-slate-800 bg-[#070D1C] p-2">
                    <div className="text-amber-300 font-bold truncate">Exness Real</div>
                    <div className="text-slate-400 text-[10px]">0.25 Lot · 22ms</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#070D1C] p-2">
                    <div className="text-cyan-300 font-bold truncate">FTMO $100k</div>
                    <div className="text-slate-400 text-[10px]">0.50 Lot · 25ms</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#070D1C] p-2">
                    <div className="text-emerald-300 font-bold truncate">ICM Cent</div>
                    <div className="text-slate-400 text-[10px]">2.50 Lot · 24ms</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: 4 CORE VALUES & DETAILED COMPARISON */}
        <LandingComparisonSection />

        {/* SECTION 3: 4-STAGE PIPELINE SIMULATOR */}
        <LandingPipelineSimulationSection
          spotPrice={spotPrice}
          simSide={simSide}
          simStep={simStep}
          simRunning={simRunning}
          triggerSimulation={triggerSimulation}
        />

        {/* SECTION 4: 4-LAYER FAIL-CLOSED SAFETY SHIELD */}
        <LandingGuardSimulatorSection
          selectedGuardIdx={selectedGuardIdx}
          setSelectedGuardIdx={setSelectedGuardIdx}
        />

        {/* SECTION 5: LOT SIZING CALCULATOR */}
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

        {/* SECTION 6: PUBLIC TRACK RECORD */}
        <PublicTrackRecordSection onEnterPortal={onEnterPortal} />

        {/* SECTION 7: PRICING & FAQ */}
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

      {/* Institutional Fintech Footer with Discord Community Links */}
      <footer className="border-t border-slate-800/80 bg-[#050914] py-12 pb-24 sm:pb-12 text-xs text-slate-400 font-mono">
        <div className="mx-auto max-w-6xl px-6 space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#12B5A6]/15 border border-[#12B5A6]/40 text-[#12B5A6] font-bold">
                Z
              </span>
              <span className="text-sm font-bold text-white tracking-wider">ZUPIRUS QUANT LAB</span>
            </div>
            <div className="flex items-center gap-6 text-slate-400">
              <a
                href="https://discord.gg/yxCx3dVe34"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#8EA1FF] hover:underline flex items-center gap-1 font-bold"
              >
                <span>Cộng Đồng Discord</span>
                <span>↗</span>
              </a>
              <a href="#pipeline" className="hover:text-white transition">4 Lớp Giáp</a>
              <a href="#track-record" className="hover:text-white transition">Hiệu Suất</a>
              <a href="#lot-calculator" className="hover:text-white transition">Tính Lot</a>
              <a href="#pricing" className="hover:text-white transition">Bảng Giá</a>
              <button type="button" onClick={onEnterPortal} className="text-[#12B5A6] hover:underline cursor-pointer">
                Cổng Giao Dịch →
              </button>
            </div>
          </div>
          <div className="border-t border-slate-800/60 pt-6 text-[11px] leading-relaxed text-slate-500">
            <strong className="text-slate-400">Tuyên bố miễn trừ rủi ro:</strong> Giao dịch ngoại hối (Forex) và Vàng (XAU/USD) sử dụng đòn bẩy tài chính có rủi ro cao đối với vốn đầu tư. ZUPIRUS cung cấp công nghệ hạ tầng tự động hóa đám mây và các lớp giáp quản trị rủi ro kỹ thuật, không phải là đơn vị huy động vốn hay quản lý ủy thác đầu tư. Tiền và vị thế giao dịch nằm 100% tại sàn giao dịch MT5 của người dùng.
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-600 pt-2">
            <span>© 2026 ZUPIRUS. Mọi quyền được bảo lưu.</span>
            <span>Hạ tầng MetaApi London G2 · SePay VietQR Automated · Discord Community</span>
          </div>
        </div>
      </footer>

      {/* Mobile WebApp Bottom Dock on Landing Page (Fixed on phones for app-like conversion) */}
      <div className="fixed bottom-0 inset-x-0 z-40 flex sm:hidden items-center justify-between gap-2 border-t border-slate-800/90 bg-[#070c18]/95 px-3 py-2.5 backdrop-blur-xl shadow-2xl pb-[max(0.6rem,env(safe-area-inset-bottom))]">
        <a
          href="https://discord.gg/yxCx3dVe34"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-xl border border-[#3b4b7a] bg-[#0c1326] px-3 py-2 text-xs font-mono font-bold text-[#8EA1FF] whitespace-nowrap"
        >
          <span>Discord</span>
          <span className="text-[10px]">↗</span>
        </a>

        <button
          type="button"
          onClick={() => {
            const el = document.getElementById('pipeline');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }}
          className="flex items-center gap-1 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-mono font-bold text-emerald-300 whitespace-nowrap cursor-pointer"
        >
          <span>⚡ Bắn Thử</span>
        </button>

        <button
          type="button"
          onClick={onEnterPortal}
          className="flex-1 flex items-center justify-center rounded-xl bg-[#12B5A6] px-3 py-2 text-xs font-bold text-[#042F2E] whitespace-nowrap shadow-sm cursor-pointer"
        >
          <span>Vào Cổng App →</span>
        </button>
      </div>

      {/* VietQR Preview Modal */}
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
