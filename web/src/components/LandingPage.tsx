import React, { useState, useEffect } from 'react';
import { type BillingCycle } from '../utils/quantMath';
import { useLiveTopbarTelemetry } from '../hooks/useQuantData.ts';
import { LandingQrPreviewModal } from './LandingQrPreviewModal';
import { LandingPricingAndFaqSection } from './LandingPricingAndFaqSection';
import { LandingFooter } from './LandingFooter';
import { PRICING_TIERS, getPricingTiers } from '../data/landingData';
import { LandingHeader } from './LandingHeader';
import { FintechAmbientBackdrop } from './FintechAmbientBackdrop';
import { ScrollProgressBar } from './ui/ScrollProgressBar';
import { LandingMethodSection } from './LandingMethodSection';
import { QuantReportCatalogAndLibrary } from './QuantReportCatalogAndLibrary';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

export interface LandingPageProps {
  onEnterPortal?: () => void;
  onEnterApp?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onEnterPortal: externalOnEnterPortal,
  onEnterApp,
}) => {
  const onEnterPortal = externalOnEnterPortal || onEnterApp || (() => {});
  const { lang, t } = useLanguage();
  const { data: telemetryData } = useLiveTopbarTelemetry();

  const spotPrice = Number(telemetryData?.xauusd?.bid || 0);
  const spreadPips = Number(telemetryData?.xauusd?.spread_pips || 0);
  const usdVndRate = Number(telemetryData?.usd_vnd?.rate || 25720);
  const [quantTheme, setQuantTheme] = useState<'gold' | 'cyber'>('gold');

  // Example guide prices. The owner sets the real price of each published PDF.
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('QUARTERLY');
  const [currencyMode, setCurrencyMode] = useState<'VND' | 'USD'>(lang === 'en' ? 'USD' : 'VND');
  const [qrPreviewTier, setQrPreviewTier] = useState<typeof PRICING_TIERS[number] | null>(null);

  useEffect(() => {
    setCurrencyMode(lang === 'en' ? 'USD' : 'VND');
  }, [lang]);

  useEffect(() => {
    document.documentElement.setAttribute('data-quant-theme', quantTheme);
  }, [quantTheme]);

  const askPrice = spotPrice > 0 ? Math.round((spotPrice + (spreadPips || 1.8) * 0.1) * 100) / 100 : 0;

  return (
    <div className="relative min-h-screen bg-[#060A13] text-slate-100 selection:bg-[#12B5A6]/30 selection:text-[#12B5A6]">
      {/* 2px Gradient Scroll Progress Bar at Top */}
      <ScrollProgressBar />

      {/* Atmospheric High-Tech Ambient Backdrop */}
      <FintechAmbientBackdrop />

      {/* Header with live ticker */}
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
          {/* Badge: XAU/USD Quantitative Research Lab */}
          <div className="inline-flex items-center gap-2.5 rounded-full border border-[#12B5A6]/30 bg-[#12B5A6]/10 px-4 py-1.5 text-xs font-mono font-medium text-emerald-300 backdrop-blur-md">
            <span className="pulse-wrap"><span className="pulse-core" /></span>
            <span className="hidden sm:inline">{t.hero.badge}</span>
            <span className="sm:hidden font-bold text-amber-300">📄 Báo cáo định lượng XAU/USD · Tải PDF trực tiếp</span>
          </div>

          {/* Large H1 */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.12]">
            {lang === 'en' ? (
              <>
                XAU/USD Quantitative Research{' '}
                <span className="bg-gradient-to-r from-amber-200 via-white to-[#12B5A6] bg-clip-text text-transparent">
                  &amp; Walk-Forward PDF Reports.
                </span>
              </>
            ) : (
              <>
                Phòng Nghiên Cứu Định Lượng XAU/USD{' '}
                <span className="bg-gradient-to-r from-amber-200 via-white to-[#12B5A6] bg-clip-text text-transparent">
                  &amp; Ấn Phẩm Báo Cáo PDF.
                </span>
              </>
            )}
          </h1>

          {/* 2-line concise description */}
          <p className="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed">
            {t.hero.subtitle}
          </p>

          {/* 2 Clean CTA Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3.5 pt-2">
            <button
              type="button"
              onClick={onEnterPortal}
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#12B5A6] to-[#0D9488] px-7 py-3.5 text-sm font-extrabold text-[#032220] hover:shadow-[0_10px_30px_-8px_rgba(18,181,166,0.7)] hover:scale-[1.02] transition-all cursor-pointer whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4" strokeWidth={2} />
              <span className="hidden sm:inline">{t.hero.ctaPrimary}</span>
              <span className="sm:hidden">{lang === 'en' ? 'Browse PDF Reports' : 'Xem Báo Cáo & Thư Viện PDF'}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" strokeWidth={2.2} />
            </button>

            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('reports-catalog');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3.5 font-mono text-xs font-bold text-slate-200 hover:border-amber-400/50 hover:bg-amber-500/10 transition-colors cursor-pointer whitespace-nowrap backdrop-blur-md"
            >
              <span>{lang === 'en' ? '📄 Preview Published Reports' : '📄 Xem Danh Mục & Bản Đọc Thử PDF'}</span>
            </button>
          </div>

          {/* Public Quantitative Research Report Catalog & Sample PDF Preview */}
          <div className="pt-8 text-left">
            <QuantReportCatalogAndLibrary mode="public" onRequireAuth={onEnterPortal} />
          </div>

        </section>

        <LandingMethodSection />

        {/* PDF library pricing and questions */}
        <LandingPricingAndFaqSection
          tiers={getPricingTiers(lang)}
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
