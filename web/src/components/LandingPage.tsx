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

  return (
    <div className="relative min-h-screen bg-[#0B1220] text-slate-100 selection:bg-[#12B5A6]/30 selection:text-[#12B5A6]">
      {/* Pure CSS Fintech Ambient Backdrop (0% GPU, Zero WebGL) */}
      <FintechAmbientBackdrop />

      {/* Sticky Header */}
      <LandingHeader
        onEnterPortal={onEnterPortal}
        spotPrice={spotPrice}
        askPrice={askPrice}
        usdVndRate={usdVndRate}
        quantTheme={quantTheme}
        setQuantTheme={setQuantTheme}
      />

      {/* Main Content Container */}
      <main id="top" className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-10 space-y-24 lg:space-y-32">
        {/* SECTION 1: HERO (2-COLUMN 6/6 BALANCED) */}
        <section className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 py-8 lg:py-16">
          {/* Left Column (6 Cols): Value Proposition */}
          <div className="space-y-6 lg:col-span-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#12B5A6]/30 bg-[#12B5A6]/10 px-3.5 py-1 text-xs font-mono font-medium text-[#12B5A6]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#12B5A6] animate-pulse" />
              <span>Cloud MT5 · Zero EA · Zero VPS</span>
            </div>

            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight text-white leading-[1.12]">
              Giao dịch định lượng Vàng &amp; Forex trên Cloud MT5 chuẩn kỷ luật quỹ.
            </h1>

            <p className="text-[17px] leading-relaxed text-[#94A3B8] max-w-[55ch]">
              Tự động hóa hoàn toàn trên đám mây. Đấu nối trực tiếp máy chủ London G2, kiểm toán 4 lớp giáp rủi ro trước mọi lệnh vào và bảo toàn vốn kỷ luật.
            </p>

            {/* 2 Action Buttons */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                type="button"
                onClick={onEnterPortal}
                className="rounded-xl bg-[#12B5A6] px-6 py-3.5 text-sm font-bold text-[#042F2E] hover:bg-[#14C9B8] transition-colors shadow-sm cursor-pointer whitespace-nowrap"
              >
                Bắt Đầu Ngay →
              </button>
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById('pipeline');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="rounded-xl border border-slate-700 hover:border-slate-500 bg-[#10192B]/70 px-5 py-3.5 text-sm font-medium text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                Thử Mô Phỏng Rủi Ro
              </button>
            </div>

            {heroFlash && (
              <div className="rounded-xl border border-slate-700 bg-[#10192B] px-4 py-2.5 font-mono text-xs text-[#F5B700]">
                {heroFlash}
              </div>
            )}

            {/* 3 Trust Metrics (Unboxed, Thin Hairline Divider) */}
            <div className="flex items-center gap-6 border-t border-slate-800/80 pt-6 font-mono text-xs text-slate-400">
              <div className="flex flex-col">
                <span className="text-sm font-bold text-white tabular-nums">100%</span>
                <span className="text-[11px] text-slate-400">Có SL Cứng</span>
              </div>
              <div className="h-7 w-[1px] bg-slate-800" />
              <div className="flex flex-col">
                <span className="text-sm font-bold text-[#12B5A6] tabular-nums">Trần 1%</span>
                <span className="text-[11px] text-slate-400">Prop Live Cap</span>
              </div>
              <div className="h-7 w-[1px] bg-slate-800" />
              <div className="flex flex-col">
                <span className="text-sm font-bold text-[#F5B700] tabular-nums">3 Giây</span>
                <span className="text-[11px] text-slate-400">VietQR 24/7</span>
              </div>
            </div>
          </div>

          {/* Right Column (6 Cols): Clean Institutional Terminal Showcase */}
          <div className="lg:col-span-6">
            <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-6 shadow-xl space-y-5">
              {/* Terminal Header */}
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#12B5A6] animate-pulse" />
                  <span className="font-mono text-xs font-semibold text-slate-200">
                    TERMINAL SHOWCASE · XAU/USD M15
                  </span>
                </div>
                <span className="rounded-md border border-slate-700 bg-[#080E1A] px-2.5 py-0.5 font-mono text-[11px] text-[#12B5A6] tabular-nums">
                  24.0 ms London G2
                </span>
              </div>

              {/* Price Quote Strip */}
              <div className="grid grid-cols-3 gap-3 font-mono tabular-nums">
                <div className="rounded-xl border border-slate-800 bg-[#080E1A] p-3 text-left">
                  <div className="text-[10px] text-slate-500 uppercase">BID (SELL)</div>
                  <div className="mt-1 text-base font-bold text-slate-200">
                    {spotPrice > 0 ? `$${spotPrice.toFixed(2)}` : '$2,912.40'}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#080E1A] p-3 text-center">
                  <div className="text-[10px] text-slate-500 uppercase">SPREAD</div>
                  <div className="mt-1 text-base font-bold text-[#F5B700]">
                    {spreadPips > 0 ? `${spreadPips.toFixed(1)} pips` : '1.8 pips'}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#080E1A] p-3 text-right">
                  <div className="text-[10px] text-slate-500 uppercase">ASK (BUY)</div>
                  <div className="mt-1 text-base font-bold text-[#12B5A6]">
                    {askPrice > 0 ? `$${askPrice.toFixed(2)}` : '$2,912.58'}
                  </div>
                </div>
              </div>

              {/* Clean Growth Curve (SVG) */}
              <div className="rounded-xl border border-slate-800/70 bg-[#080E1A] p-4">
                <div className="mb-2 flex items-center justify-between font-mono text-xs">
                  <span className="text-slate-400">Đường cong tăng trưởng tích luỹ</span>
                  <span className="text-[#12B5A6] font-bold tabular-nums">+18.4% WinRate 71.4%</span>
                </div>
                <svg viewBox="0 0 360 80" className="h-20 w-full overflow-visible">
                  <defs>
                    <linearGradient id="fintechGrowthGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#12B5A6" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#12B5A6" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0,66 L30,62 L60,64 L90,52 L120,54 L150,42 L180,45 L210,32 L240,36 L270,22 L300,26 L330,12 L360,8 L360,80 L0,80 Z"
                    fill="url(#fintechGrowthGrad)"
                  />
                  <path
                    d="M0,66 L30,62 L60,64 L90,52 L120,54 L150,42 L180,45 L210,32 L240,36 L270,22 L300,26 L330,12 L360,8"
                    fill="none"
                    stroke="#12B5A6"
                    strokeWidth="2"
                  />
                  <circle cx="360" cy="8" r="4" fill="#12B5A6" />
                </svg>
              </div>

              {/* 3 Account Sync Rows */}
              <div className="space-y-2 border-t border-slate-800/80 pt-4 font-mono text-xs">
                <div className="text-[11px] text-slate-400">3 Tài Khoản Đồng Bộ Live:</div>
                <div className="grid grid-cols-3 gap-2 tabular-nums">
                  <div className="rounded-lg border border-slate-800 bg-[#080E1A] p-2.5">
                    <div className="text-slate-300 font-semibold truncate">Standard</div>
                    <div className="text-[11px] text-[#12B5A6] mt-0.5">0.25 Lot · Active</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#080E1A] p-2.5">
                    <div className="text-slate-300 font-semibold truncate">Prop Live $100K</div>
                    <div className="text-[11px] text-[#F5B700] mt-0.5">0.50 Lot · 1% Cap</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#080E1A] p-2.5">
                    <div className="text-slate-300 font-semibold truncate">Cent USC</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">2.50 Lot · Scaled</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: 4 HORIZONTAL CORE VALUE COLUMNS & COMPARISON */}
        <LandingComparisonSection />

        {/* SECTION 3: INTERACTIVE 4-STAGE PIPELINE SIMULATOR */}
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

      {/* Institutional Fintech Footer */}
      <footer className="border-t border-slate-800/80 bg-[#080E1A] py-12 text-xs text-slate-400 font-mono">
        <div className="mx-auto max-w-6xl px-6 space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#12B5A6]/15 border border-[#12B5A6]/40 text-[#12B5A6] font-bold">
                Z
              </span>
              <span className="text-sm font-bold text-white tracking-wider">ZUPIRUS QUANT LAB</span>
            </div>
            <div className="flex items-center gap-6 text-slate-400">
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
            <span>Hạ tầng MetaApi London G2 · SePay VietQR Automated</span>
          </div>
        </div>
      </footer>

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
