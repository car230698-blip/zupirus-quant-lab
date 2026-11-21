import React, { useState, useEffect } from 'react';
import { calculateQuantLotSizing, type AccountKind, type BillingCycle } from '../utils/quantMath';
import { useLiveTopbarTelemetry } from '../hooks/useQuantData.ts';
import { LandingQrPreviewModal } from './LandingQrPreviewModal';
import { LandingPricingAndFaqSection } from './LandingPricingAndFaqSection';
import { LandingFooter } from './LandingFooter';
import { PublicTrackRecordSection } from './PublicTrackRecordSection';
import { LandingLotCalculator } from './LandingLotCalculator';
import { PRICING_TIERS } from '../data/landingData';
import { LandingHeader } from './LandingHeader';
import { LandingComparisonSection } from './LandingComparisonSection';
import { LandingGuardSimulatorSection } from './LandingGuardSimulatorSection';
import { FintechAmbientBackdrop } from './FintechAmbientBackdrop';
import { ScrollProgressBar } from './ui/ScrollProgressBar';
import { LandingHeroTerminal } from './LandingHeroTerminal';
import { LandingTrustMarquee } from './LandingTrustMarquee';
import { ArrowRight, Sparkles } from 'lucide-react';

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

  const lotCalc = calculateQuantLotSizing({
    balanceUsd: calcBalance,
    riskPercent: calcRiskPct,
    stopLossPips: calcSlPips,
    accountKind: calcAccountKind,
    dailyDrawdownLimitPct: calcAccountKind === 'PROP' ? 4.0 : 10,
  });

  const askPrice = spotPrice > 0 ? Math.round((spotPrice + (spreadPips || 1.8) * 0.1) * 100) / 100 : 0;

  return (
    <div className="relative min-h-screen bg-[#060A13] text-slate-100 selection:bg-[#12B5A6]/30 selection:text-[#12B5A6]">
      {/* 2px Gradient Scroll Progress Bar at Top */}
      <ScrollProgressBar />

      {/* Atmospheric High-Tech Ambient Backdrop */}
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
      <main id="top" className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 pb-24 pt-4 sm:pt-8 space-y-20 lg:space-y-28">
        {/* SECTION 1: CENTERED HERO (LINEAR × STRIPE BENTO 2026) */}
        <section className="text-center pt-8 sm:pt-14 pb-4 space-y-6 max-w-4xl mx-auto">
          {/* Badge: Cloud MT5 · Zero EA · Zero VPS with pulse ring */}
          <div className="inline-flex items-center gap-2.5 rounded-full border border-[#12B5A6]/30 bg-[#12B5A6]/10 px-4 py-1.5 text-xs font-mono font-medium text-emerald-300 backdrop-blur-md">
            <span className="pulse-wrap"><span className="pulse-core" /></span>
            <span>Cloud MT5 · Zero EA · Zero VPS</span>
          </div>

          {/* Large H1 with subtle silver/white gradient matching prototype */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.12]">
            Giao dịch định lượng Vàng &amp; Forex{' '}
            <span className="bg-gradient-to-r from-amber-200 via-white to-[#12B5A6] bg-clip-text text-transparent">
              chuẩn kỷ luật quỹ.
            </span>
          </h1>

          {/* 2-line concise description */}
          <p className="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Kết nối trực tiếp tài khoản MT5 của bạn lên hạ tầng đám mây ZUPIRUS. Mọi lệnh đều đi qua 4 lớp bảo vệ Fail-Closed, tự quy đổi tài khoản Cent và khóa chặt trần rủi ro 1% cho quỹ Prop Live.
          </p>

          {/* 2 Clean CTA Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3.5 pt-2">
            <button
              type="button"
              onClick={onEnterPortal}
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#12B5A6] to-[#0D9488] px-7 py-3.5 text-sm font-extrabold text-[#032220] hover:shadow-[0_10px_30px_-8px_rgba(18,181,166,0.7)] hover:scale-[1.02] transition-all cursor-pointer whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4" strokeWidth={2} />
              <span>Bắt đầu ngay</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" strokeWidth={2.2} />
            </button>

            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('guards') || document.getElementById('pipeline');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3.5 font-mono text-xs font-bold text-slate-200 hover:border-amber-400/50 hover:bg-amber-500/10 transition-colors cursor-pointer whitespace-nowrap backdrop-blur-md"
            >
              <span>⚡ Thử mô phỏng 4 lớp giáp</span>
            </button>
          </div>

          {/* Hero Product Terminal Showcase (3D tilt that flattens on scroll) */}
          <LandingHeroTerminal
            spotPrice={spotPrice}
            askPrice={askPrice}
            spreadPips={spreadPips}
            onEnterPortal={onEnterPortal}
          />
        </section>

        {/* SECTION 2: INFINITE LOGO MARQUEE */}
        <LandingTrustMarquee />

        {/* SECTION 3: 4 CORE VALUES & DETAILED COMPARISON */}
        <LandingComparisonSection />

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

        {/* SECTION 7: PUBLIC TRACK RECORD */}
        <PublicTrackRecordSection onEnterPortal={onEnterPortal} />

        {/* SECTION 8: PRICING & FAQ */}
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

      <LandingFooter onEnterPortal={onEnterPortal} />

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
