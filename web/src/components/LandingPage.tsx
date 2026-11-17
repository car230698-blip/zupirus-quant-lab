import React, { useState, useEffect } from 'react';
import { calculateQuantLotSizing, calculateSubscriptionPricing, type AccountKind, type BillingCycle } from '../utils/quantMath';
import guardMatrixImg from '../assets/images/guard_matrix_architecture_1794792845754.jpg';
import { useLiveTopbarTelemetry } from '../hooks/useQuantData.ts';

export interface LandingPageProps {
  onEnterPortal?: () => void;
  onEnterApp?: () => void;
}

const GUARD_LAYERS = [
  {
    id: '01',
    code: 'REDIS_IDEMPOTENCY_LOCK',
    title: 'Khóa Chống Lặp Lệnh Redis (Idempotency Lock)',
    metric: '< 0.8 ms',
    desc: 'Mỗi tín hiệu được băm SHA-256 và khóa nguyên tử trên Redis trước khi phân phối. Triệt tiêu 100% lỗi bắn trùng lệnh khi webhook hoặc đường truyền rung lắc.',
    rule: 'SETNX signal:{hash}:account:{id} EX 60',
  },
  {
    id: '02',
    code: 'MANDATORY_HARD_STOP_LOSS',
    title: 'Bắt Buộc SL Cứng & Tự Động Dời Hòa Vốn (1R BE)',
    metric: '100% SL Enforced',
    desc: 'Từ chối thực thi mọi tín hiệu thiếu Stop-Loss nếu không bật chế độ Auto ATR(14) SL. Tự động dời SL về điểm vào lệnh (Break-Even) ngay khi lợi nhuận đạt 1R.',
    rule: 'IF stop_loss IS NULL AND NOT auto_atr_sl -> REJECT_FAIL_CLOSED',
  },
  {
    id: '03',
    code: 'MACRO_USD_NEWS_SHIELD',
    title: 'Lá Chắn Tin Tức Vĩ Mô USD Đỏ (CPI / NFP / FOMC)',
    metric: '±15 Phút Phong Tỏa',
    desc: 'Đồng bộ lịch kinh tế thời gian thực và tự động đóng băng mở vị thế mới trong bán kính ±15 phút quanh các bản tin USD High-Impact để tránh giãn spread.',
    rule: 'IF abs(now - usd_high_impact_ts) <= 900s -> HALT_NEW_ENTRIES',
  },
  {
    id: '04',
    code: 'PROP_DRAWDOWN_CIRCUIT_BREAKER',
    title: 'Cầu Dao Bảo Vệ Quỹ Prop & Giới Hạn Trượt Giá',
    metric: 'Max 4.5% Daily DD',
    desc: 'Kiểm toán độ giãn Spread thực tế trên cầu nối London G2 và tự động ngắt kết nối bảo toàn tài khoản nếu mức sụt giảm trong ngày chạm ngưỡng cài đặt.',
    rule: 'IF daily_dd_pct >= max_daily_dd OR spread > 4.5_pips -> CIRCUIT_BREAK',
  },
];

const PRICING_TIERS = [
  {
    id: 'STARTER' as const,
    code: 'GÓI 01 // TRẢI NGHIỆM & CENT',
    name: 'Khởi Đầu / Cent',
    baseUsd: 25,
    slots: 1,
    badge: 'Trọn Gói 1 TK Cloud',
    features: [
      'Đã bao gồm sẵn 01 Tài khoản Cloud MT5 London G2 (tiết kiệm $10 VPS)',
      'Tự động nhận diện Cent / Standard và chia Lot an toàn theo số dư',
      'Kích hoạt 3 Lớp Giáp: Tự gắn SL theo ATR, Chặn tin đỏ ±15 phút',
      'Tự động cắt lỗ bảo vệ ngày (Max Daily DD 5.0%)',
    ],
  },
  {
    id: 'PRO' as const,
    code: 'GÓI 02 // TĂNG TRƯỞNG VỐN',
    name: 'Tăng Trưởng & Lãi Kép',
    baseUsd: 39,
    slots: 1,
    popular: true,
    badge: 'Phổ Biến Nhất',
    features: [
      'Đã bao gồm sẵn 01 Tài khoản Cloud (thêm TK phụ chỉ +$10/TK)',
      'Tự động Dời Hòa Vốn (+1R) & Chốt lời 50% TP1 khóa lợi nhuận',
      'Tự động Lãi Kép (Auto-Compounding) tăng Lot theo tăng trưởng vốn',
      'Tín hiệu chọn lọc qua AI lọc nhiễu + Cắt lỗ ngày tự động 5.0%',
    ],
  },
  {
    id: 'INSTITUTIONAL' as const,
    code: 'GÓI 03 // CHUYÊN THI QUỸ PROP FIRM',
    name: 'Thi Quỹ Prop Firm Alpha',
    baseUsd: 59,
    slots: 1,
    badge: 'Bảo Vệ Quỹ Tối Đa',
    features: [
      'Đã bao gồm sẵn 01 Tài khoản Cloud (thêm TK phụ chỉ +$10/TK)',
      'Ngắt mạch cứng Daily Drawdown 4.0% (an toàn dưới luật 5% FTMO/FundedNext)',
      'Tự động đóng toàn bộ lệnh trước cuối tuần (Thứ 6 lúc 21:00 UTC)',
      'Mở khóa AI Swarm tự chủ & Kiểm toán chuyên sâu MAE / MFE',
    ],
  },
];

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
  const [guardImgError, setGuardImgError] = useState(false);

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
    dailyDrawdownLimitPct: calcAccountKind === 'PROP' ? 4.5 : 10,
  });

  const askPrice = spotPrice > 0 ? Math.round((spotPrice + (spreadPips || 1.8) * 0.1) * 100) / 100 : 0;
  const activeGuard = GUARD_LAYERS[selectedGuardIdx] || GUARD_LAYERS[0];

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
      {/* Ambient Sovereign Gold & Cyan Illumination */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-36 left-1/4 h-[520px] w-[520px] rounded-full bg-amber-500/12 blur-[140px] animate-aurora" />
        <div className="absolute top-1/3 right-1/5 h-[440px] w-[440px] rounded-full bg-cyan-500/10 blur-[140px]" />
      </div>

      {/* Zone 1-3 Strict Top Bar Contract */}
      <header className="sticky top-0 z-40 border-b border-amber-500/20 bg-[#03050a]/90 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-8">
          {/* Zone 1: Brand Identity */}
          <a href="#top" className="flex items-center gap-3 text-decoration-none group">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-cyan-400 p-[1.5px] shadow-[0_0_24px_rgba(245,158,11,0.35)]">
              <div className="flex h-full w-full items-center justify-center rounded-[10.5px] bg-[#040711] font-mono text-lg font-extrabold text-amber-300">
                Z
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-lg font-extrabold tracking-tight text-white">
                  ZUPIRUS
                </span>
                <span className="rounded bg-amber-500/20 border border-amber-400/40 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                  QUANT OS v4.0
                </span>
              </div>
              <span className="block font-mono text-[10px] tracking-widest text-amber-300/80 uppercase">
                Sovereign XAU/USD Cloud Engine
              </span>
            </div>
          </a>

          {/* Zone 2: Primary Section Navigation */}
          <nav aria-label="Điều hướng trang chủ" className="hidden lg:flex items-center gap-7 text-sm font-medium text-slate-300">
            <a href="#pipeline" className="hover:text-amber-300 transition-colors whitespace-nowrap shrink-0">
              Mô Phỏng Quạt Lệnh
            </a>
            <a href="#safety-shield" className="hover:text-amber-300 transition-colors whitespace-nowrap shrink-0">
              4 Lớp Giáp Vốn
            </a>
            <a href="#lot-calculator" className="hover:text-amber-300 transition-colors whitespace-nowrap shrink-0">
              Máy Tính Lot Quỹ Prop
            </a>
            <a href="#pricing" className="hover:text-amber-300 transition-colors whitespace-nowrap shrink-0">
              Bảng Giá SePay VietQR
            </a>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <button
            type="button"
            onClick={onEnterPortal}
            className="quant-btn-primary px-5 py-2.5 text-xs sm:text-sm whitespace-nowrap shrink-0"
          >
            Mở Cổng Giao Dịch →
          </button>
        </div>
      </header>

      {/* Interactive Multi-Portal Launchpad & Live Telemetry Bar */}
      <div className="relative z-10 mx-auto max-w-7xl px-4 pt-5 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-[#091022]/95 via-[#0b152c]/95 to-[#091022]/95 px-4 py-3 font-mono text-xs shadow-[0_12px_36px_rgba(0,0,0,0.6)]">
          <div className="flex flex-wrap items-center gap-3 text-slate-300 tabular-nums">
            <span className="inline-flex items-center gap-2 rounded-lg bg-amber-500/15 border border-amber-400/35 px-2.5 py-1 font-bold text-amber-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              XAU/USD SPOT: {spotPrice > 0 ? `$${spotPrice.toFixed(2)} / $${askPrice.toFixed(2)}` : 'Đang kết nối...'}
            </span>
            <span className="hidden sm:inline text-emerald-400 font-semibold">
              London G2 Bridge: 24ms
            </span>
            <span aria-hidden="true" className="hidden md:inline text-slate-600">·</span>
            <span className="hidden md:inline text-slate-300">
              Tỷ giá SePay: <strong className="text-amber-300">{usdVndRate.toLocaleString('vi-VN')}₫/USD</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#040711] p-1 text-[10px]">
              <button
                type="button"
                onClick={() => setQuantTheme('gold')}
                className={`rounded-lg px-2.5 py-1 font-bold transition cursor-pointer ${
                  quantTheme === 'gold' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                SOVEREIGN GOLD
              </button>
              <button
                type="button"
                onClick={() => setQuantTheme('cyber')}
                className={`rounded-lg px-2.5 py-1 font-bold transition cursor-pointer ${
                  quantTheme === 'cyber' ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                CYBER MATRIX
              </button>
            </div>
          </div>
        </div>
      </div>

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
          </div>
        </section>

        {/* SECTION 2: 4-PILLAR QUANTUM ADVANTAGE BENTO */}
        <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              tag: '01 // ZERO-VPS CLOUD BRIDGE',
              metric: '24 ms Latency',
              title: 'Đấu Nối Trực Tiếp MetaApi G2',
              desc: 'Không cần thuê máy chủ Windows VPS hay cài đặt Expert Advisor (EA). Kết nối trực tiếp qua mã đăng nhập MT5.',
              accent: 'text-amber-300',
            },
            {
              tag: '02 // FAIL-CLOSED RISK ENGINE',
              metric: '100% Có SL Cứng',
              title: '4 Lớp Giáp Bảo Vệ Vốn',
              desc: 'Từ chối mọi tín hiệu thiếu mức dừng lỗ. Tuyệt đối không bình quân giá âm (Martingale) hay gồng lỗ qua tin.',
              accent: 'text-emerald-400',
            },
            {
              tag: '03 // MULTI-BROKER NORMALIZER',
              metric: 'Standard · Cent · Prop',
              title: 'Chuẩn Hóa Hậu Tố & Lot',
              desc: 'Tự động ánh xạ mã vàng (XAUUSDm, XAUUSD.pro, GOLD) và tính toán khối lượng Lot độc lập theo từng tài khoản.',
              accent: 'text-cyan-300',
            },
            {
              tag: '04 // INSTANT SEPAY VIETQR',
              metric: '3 Giây Kích Hoạt',
              title: 'Thanh Toán Tự Động 24/7',
              desc: 'Chốt tỷ giá USD/VND thời gian thực và nâng cấp hạn mức khe cắm Cloud MT5 ngay lập tức khi quét mã VietQR.',
              accent: 'text-amber-300',
            },
          ].map((card) => (
            <div key={card.tag} className="quant-card-interactive quant-hud-corner p-6 flex flex-col justify-between">
              <div>
                <div className="font-mono text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {card.tag}
                </div>
                <div className={`mt-2.5 font-mono text-2xl font-extrabold tabular-nums ${card.accent}`}>
                  {card.metric}
                </div>
                <h2 className="mt-1.5 text-base font-bold text-white">{card.title}</h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-300/90">{card.desc}</p>
              </div>
            </div>
          ))}
        </section>

        {/* SECTION 2B: SO SÁNH & QUY TRÌNH 3 BƯỚC */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="quant-panel p-6 sm:p-8 lg:col-span-7 space-y-5">
            <div>
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">
                SO SÁNH THỰC TẾ
              </span>
              <h2 className="mt-1 text-2xl font-extrabold text-white">Vì Sao Trader Chọn ZUPIRUS Thay Vì Copy Bot Thường?</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
              <div className="rounded-xl border border-rose-500/25 bg-rose-950/20 p-4 space-y-2.5">
                <div className="font-mono font-bold text-rose-300 uppercase">✕ Tự Trade / Bot VPS Thường</div>
                <ul className="space-y-2 text-slate-300">
                  <li>• Phải thuê VPS $8-$15/tháng, hay treo EA mất kết nối.</li>
                  <li>• Gồng lỗ hoặc quên đặt Stop Loss khi thị trường giật mạnh.</li>
                  <li>• Dính quét 2 đầu khi ra tin NFP, CPI, FOMC.</li>
                  <li>• Dễ vi phạm luật Daily Drawdown 5% khi thi quỹ Prop Firm.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-2.5">
                <div className="font-mono font-bold text-emerald-300 uppercase">✓ ZUPIRUS Cloud Quant</div>
                <ul className="space-y-2 text-slate-200">
                  <li>• Chạy Cloud London G2 24/7 — không cần cài đặt hay treo máy.</li>
                  <li>• 100% lệnh có SL cứng, tự dời Hòa Vốn (+1R) &amp; chốt 50% TP1.</li>
                  <li>• Tự động phong tỏa trước/sau tin đỏ USD ±15 phút.</li>
                  <li>• Tự chia Lot theo Cent/Standard/Quỹ &amp; ngắt mạch DD ngày 4–5%.</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="quant-panel p-6 sm:p-8 lg:col-span-5 space-y-4">
            <div>
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">
                BẮT ĐẦU TRONG 2 PHÚT
              </span>
              <h2 className="mt-1 text-2xl font-extrabold text-white">Quy Trình 3 Bước Đơn Giản</h2>
            </div>
            <div className="space-y-3 text-xs">
              {[
                { step: '01', title: 'Đăng Ký & Xác Thực OTP (30s)', desc: 'Tạo tài khoản bảo mật qua email, không giữ tiền nạp của bạn.' },
                { step: '02', title: 'Chọn Gói & Quét VietQR SePay', desc: 'Tài khoản Cloud kích hoạt tự động sau 3 giây chuyển khoản.' },
                { step: '03', title: 'Nhập MT5 — Hệ Thống Tự Chạy', desc: 'Hệ thống tự chia Lot & đặt cắt lỗ ngày an toàn cho tài khoản của bạn.' },
              ].map((s) => (
                <div key={s.step} className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#040710]/70 p-3.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 font-mono text-xs font-extrabold text-amber-300">
                    {s.step}
                  </span>
                  <div>
                    <div className="font-bold text-white">{s.title}</div>
                    <div className="mt-0.5 text-slate-400 leading-relaxed">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 3: INTERACTIVE 4-STAGE QUANTUM FAN-OUT SIMULATOR */}
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
                ⚡ Bắn Thử BUY XAU/USD
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
                ⚡ Bắn Thử SELL XAU/USD
              </button>
              <button
                type="button"
                onClick={() => triggerSimulation('NO_SL')}
                disabled={simRunning}
                className={`px-4 py-2.5 text-xs font-mono font-bold rounded-xl border transition whitespace-nowrap shrink-0 cursor-pointer ${
                  simSide === 'NO_SL'
                    ? 'border-rose-400 bg-rose-500/25 text-rose-200'
                    : 'border-rose-500/30 bg-rose-950/20 text-rose-300 hover:bg-rose-500/20'
                }`}
              >
                ⛔ Thử Kịch Bản Thiếu SL (Fail-Closed)
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

        {/* SECTION 4: INTERACTIVE 4-LAYER FAIL-CLOSED SAFETY SHIELD */}
        <section id="safety-shield" className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-center">
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
            <div className="quant-panel p-6 sm:p-8 space-y-5 border-amber-500/35">
              <div className="relative h-48 w-full overflow-hidden rounded-xl border border-amber-500/25 bg-[#050914]">
                {!guardImgError ? (
                  <img
                    src={guardMatrixImg}
                    alt="Kiến trúc 4 lớp giáp bảo vệ vốn"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (target.dataset.triedPublic !== '1') {
                        target.dataset.triedPublic = '1';
                        target.src = '/assets/images/guard_matrix_architecture_1794792845754.jpg';
                      } else {
                        setGuardImgError(true);
                      }
                    }}
                    className="h-full w-full object-cover opacity-80"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center p-4 bg-[#030611]">
                    <svg viewBox="0 0 360 160" className="w-full h-full max-h-40 overflow-visible">
                      <rect x="20" y="20" width="70" height="90" rx="8" fill="#04091a" stroke="#f59e0b" strokeWidth="1.5" />
                      <text x="55" y="55" textAnchor="middle" fill="#fde68a" fontSize="11" fontWeight="800" fontFamily="JetBrains Mono, monospace">#01</text>
                      <text x="55" y="75" textAnchor="middle" fill="#94a3b8" fontSize="8" fontFamily="JetBrains Mono, monospace">REDIS</text>
                      <text x="55" y="87" textAnchor="middle" fill="#10b981" fontSize="7.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">&lt;0.8ms</text>

                      <rect x="105" y="20" width="70" height="90" rx="8" fill="#04091a" stroke="#06b6d4" strokeWidth="1.5" />
                      <text x="140" y="55" textAnchor="middle" fill="#67e8f9" fontSize="11" fontWeight="800" fontFamily="JetBrains Mono, monospace">#02</text>
                      <text x="140" y="75" textAnchor="middle" fill="#94a3b8" fontSize="8" fontFamily="JetBrains Mono, monospace">HARD SL</text>
                      <text x="140" y="87" textAnchor="middle" fill="#06b6d4" fontSize="7.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">1R BE</text>

                      <rect x="190" y="20" width="70" height="90" rx="8" fill="#04091a" stroke="#eab308" strokeWidth="1.5" />
                      <text x="225" y="55" textAnchor="middle" fill="#fef08a" fontSize="11" fontWeight="800" fontFamily="JetBrains Mono, monospace">#03</text>
                      <text x="225" y="75" textAnchor="middle" fill="#94a3b8" fontSize="8" fontFamily="JetBrains Mono, monospace">NEWS</text>
                      <text x="225" y="87" textAnchor="middle" fill="#eab308" fontSize="7.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">±15m</text>

                      <rect x="275" y="20" width="70" height="90" rx="8" fill="#04091a" stroke="#10b981" strokeWidth="1.5" />
                      <text x="310" y="55" textAnchor="middle" fill="#a7f3d0" fontSize="11" fontWeight="800" fontFamily="JetBrains Mono, monospace">#04</text>
                      <text x="310" y="75" textAnchor="middle" fill="#94a3b8" fontSize="8" fontFamily="JetBrains Mono, monospace">PROP DD</text>
                      <text x="310" y="87" textAnchor="middle" fill="#10b981" fontSize="7.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">4.5% MAX</text>

                      <line x1="20" y1="130" x2="345" y2="130" stroke="rgba(245,158,11,0.4)" strokeWidth="1.5" strokeDasharray="4 3" />
                      <circle cx="55" cy="130" r="3" fill="#f59e0b" />
                      <circle cx="140" cy="130" r="3" fill="#06b6d4" />
                      <circle cx="225" cy="130" r="3" fill="#eab308" />
                      <circle cx="310" cy="130" r="3" fill="#10b981" />
                    </svg>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#050914] via-[#050914]/40 to-transparent pointer-events-none" />
                <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between font-mono text-xs">
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
          </div>
        </section>

        {/* SECTION 5: INTERACTIVE LOT SIZING & PROP GUARD CALCULATOR */}
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

        {/* SECTION 6: SEPAY VIETQR PRICING MATRIX */}
        <section id="pricing" className="space-y-8">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
                SEPAY VIETQR INSTANT ACTIVATION
              </div>
              <h2 className="mt-1 font-display text-2xl sm:text-3xl font-extrabold text-white">
                Biểu Phí Hạ Tầng Đám Mây Cloud MT5
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#050914] p-1 font-mono text-xs">
                {(
                  [
                    ['MONTHLY', '1 Tháng'],
                    ['QUARTERLY', '3 Tháng (-10%)'],
                    ['ANNUAL', '12 Tháng (-20%)'],
                  ] as [BillingCycle, string][]
                ).map(([cycle, label]) => (
                  <button
                    key={cycle}
                    type="button"
                    onClick={() => setBillingCycle(cycle)}
                    className={`rounded-lg px-3 py-1.5 font-bold transition whitespace-nowrap shrink-0 cursor-pointer ${
                      billingCycle === cycle
                        ? 'bg-amber-400 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#050914] p-1 font-mono text-xs">
                {(['VND', 'USD'] as const).map((cur) => (
                  <button
                    key={cur}
                    type="button"
                    onClick={() => setCurrencyMode(cur)}
                    className={`rounded-lg px-2.5 py-1.5 font-bold transition cursor-pointer ${
                      currencyMode === cur ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {cur}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {PRICING_TIERS.map((tier) => {
              const pricing = calculateSubscriptionPricing(tier.baseUsd, tier.slots, billingCycle, usdVndRate);
              return (
                <div
                  key={tier.id}
                  className={`quant-panel p-6 sm:p-7 flex flex-col justify-between ${
                    tier.popular ? 'border-amber-400/55 shadow-[0_0_40px_rgba(245,158,11,0.16)]' : ''
                  }`}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-amber-300 font-bold">{tier.code}</span>
                      <span className="rounded-lg bg-amber-500/15 border border-amber-400/35 px-2.5 py-0.5 text-[10px] font-bold text-amber-200">
                        {tier.badge}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-xl font-extrabold text-white">{tier.name}</h3>
                      <div className="mt-2 font-mono text-3xl font-extrabold text-amber-300 tabular-nums">
                        {currencyMode === 'VND'
                          ? `${pricing.totalVnd.toLocaleString('vi-VN')} ₫`
                          : `$${pricing.totalUsd.toFixed(2)}`}
                        <span className="ml-1.5 text-xs font-normal text-slate-400">
                          / {pricing.months} tháng
                        </span>
                      </div>
                    </div>

                    <ul className="space-y-2.5 border-t border-white/10 pt-4 text-xs text-slate-300">
                      {tier.features.map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <span className="text-amber-400 font-bold">✓</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-2.5 pt-4 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => setQrPreviewTier(tier)}
                      className="quant-btn-secondary py-2.5 text-xs whitespace-nowrap shrink-0"
                    >
                      Xem Mã VietQR
                    </button>
                    <button
                      type="button"
                      onClick={onEnterPortal}
                      className="quant-btn-primary py-2.5 text-xs whitespace-nowrap shrink-0"
                    >
                      Kích Hoạt Ngay →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* SECTION 6: FAQ & CAM KẾT AN TOÀN */}
        <section className="quant-panel p-6 sm:p-10 space-y-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                MINH BẠCH &amp; BẢO MẬT
              </span>
              <h2 className="mt-1 text-2xl font-extrabold text-white">Câu Hỏi Thường Gặp</h2>
            </div>
            <span className="font-mono text-xs text-slate-400">Tiền luôn nằm trên sàn MT5 của riêng bạn</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-xs">
            {[
              {
                q: 'ZUPIRUS có giữ tiền nạp của tôi không?',
                a: 'Không. Tiền giao dịch nằm 100% trong tài khoản MT5 tại sàn của bạn (Exness, ICMarkets, FTMO...). ZUPIRUS chỉ kết nối qua MetaApi Cloud để truyền tín hiệu và bảo vệ lệnh.',
              },
              {
                q: 'Mật khẩu MT5 của tôi có an toàn không?',
                a: 'Mật khẩu giao dịch được mã hóa AES-256 trước khi lưu và không bao giờ hiển thị lại dưới dạng văn bản thuần trên bất kỳ giao diện hay log nào.',
              },
              {
                q: 'Tôi dùng tài khoản Cent ($50-$100) có chạy được không?',
                a: 'Có. Hệ thống tự động nhận diện loại tài khoản Cent hay Standard để quy đổi contract size (1.0 vs 100.0) và chia Lot đúng rủi ro % số dư.',
              },
              {
                q: 'Nếu gặp biến động mạnh hoặc mất kết nối sàn thì sao?',
                a: 'Mọi lệnh vào đều có Stop Loss cứng ngay trên máy chủ sàn. Khi phát hiện sụt giảm chạm ngưỡng ngày (4% Quỹ / 5% TK thường), hệ thống tự động đóng lệnh và khóa giao dịch trong ngày.',
              },
            ].map((item) => (
              <div key={item.q} className="rounded-xl border border-white/10 bg-[#040710]/70 p-4 space-y-1.5">
                <div className="font-bold text-amber-200">{item.q}</div>
                <p className="text-slate-300 leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-white/10 pt-4 text-[11px] text-slate-400 leading-relaxed">
            <strong>Lưu ý rủi ro:</strong> Giao dịch ngoại hối và vàng (XAU/USD) sử dụng đòn bẩy có mức độ rủi ro cao. ZUPIRUS cung cấp hạ tầng tự động hóa và lớp giáp quản trị rủi ro kỹ thuật, không cam kết lợi nhuận cố định.
          </div>
        </section>
      </main>

      {/* Instant VietQR Preview Modal */}
      {qrPreviewTier && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          onClick={() => setQrPreviewTier(null)}
        >
          <div
            className="quant-panel max-w-md w-full p-6 space-y-4 border-amber-400/50 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3 text-left">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-amber-300">
                  SEPAY VIETQR INSTANT CHECKOUT
                </span>
                <h4 className="text-base font-bold text-white">Gói {qrPreviewTier.name}</h4>
              </div>
              <button
                type="button"
                onClick={() => setQrPreviewTier(null)}
                className="text-slate-400 hover:text-white font-mono text-xs cursor-pointer"
              >
                ESC ✕
              </button>
            </div>

            {(() => {
              const p = calculateSubscriptionPricing(qrPreviewTier.baseUsd, qrPreviewTier.slots, billingCycle, usdVndRate);
              const qrUrl = `https://qr.sepay.vn/img?bank=MB&acc=0987654321&template=compact&amount=${p.totalVnd}&des=ZUP_${qrPreviewTier.id}`;
              return (
                <>
                  <div className="mx-auto w-52 overflow-hidden rounded-2xl border border-amber-400/40 bg-white p-3 shadow-[0_0_35px_rgba(245,158,11,0.25)]">
                    <img src={qrUrl} alt="VietQR SePay" className="h-full w-full object-contain" />
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#040710] p-3.5 text-left font-mono text-xs space-y-1.5 tabular-nums">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Gói thuê bao:</span>
                      <strong className="text-amber-300">{qrPreviewTier.name} ({p.months} tháng)</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Số tiền quy đổi:</span>
                      <strong className="text-emerald-400">{p.totalVnd.toLocaleString('vi-VN')} VND</strong>
                    </div>
                  </div>
                </>
              );
            })()}

            <button
              type="button"
              onClick={() => {
                setQrPreviewTier(null);
                onEnterPortal();
              }}
              className="quant-btn-primary w-full py-2.5 text-xs"
            >
              Mở Cổng Khách Hàng Để Khởi Tạo Đơn Chính Thức →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
