import React, { useState, useEffect } from 'react';
import { useExchangeRate } from '../hooks/useQuantData.ts';

interface LandingPageProps {
  onEnterApp: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onEnterApp }) => {
  const [currency, setCurrency] = useState<'VND' | 'USD'>('VND');
  const { data: fxData } = useExchangeRate();
  const fxRate = fxData?.rate || 25730.0;

  // Interactive Calculator State
  const [calcEquity, setCalcEquity] = useState<number>(10000);
  const [calcRiskPct, setCalcRiskPct] = useState<number>(1.0);
  const [calcAccountType, setCalcAccountType] = useState<'standard' | 'cent' | 'prop'>('standard');
  const [calcSlPoints, setCalcSlPoints] = useState<number>(300);

  // Live Holographic Signal Fan-Out Simulator State
  const [simRunning, setSimRunning] = useState(false);
  const [simStep, setSimStep] = useState<number>(4);
  const [simSide, setSimSide] = useState<'BUY' | 'SELL'>('BUY');
  const [livePrice, setLivePrice] = useState<number>(2908.45);

  // Image Fallback States
  const [heroImgError, setHeroImgError] = useState(false);
  const [guardImgError, setGuardImgError] = useState(false);

  // Subtle live price micro-tick for visual realism
  useEffect(() => {
    const interval = setInterval(() => {
      setLivePrice((prev) => {
        const delta = (Math.random() - 0.48) * 0.35;
        return Math.round((prev + delta) * 100) / 100;
      });
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  const triggerLiveSimulation = (side: 'BUY' | 'SELL') => {
    if (simRunning) return;
    setSimSide(side);
    setSimRunning(true);
    setSimStep(1);
    setTimeout(() => setSimStep(2), 450);
    setTimeout(() => setSimStep(3), 900);
    setTimeout(() => {
      setSimStep(4);
      setSimRunning(false);
    }, 1450);
  };

  // Compute calculated values
  const riskDollars = calcEquity * (calcRiskPct / 100);
  const rawLot = (riskDollars / Math.max(calcSlPoints, 150)) * (calcAccountType === 'cent' ? 100 : 1);
  const recommendedLot = Math.min(Math.max(roundLot(rawLot, calcAccountType === 'cent' ? 0.1 : 0.01), 0.01), 50.0);
  const oneRProfitDollars = riskDollars;
  const twoRProfitDollars = riskDollars * 2;
  const propDdLimitDollars = calcEquity * 0.045;

  function roundLot(val: number, step: number): number {
    return Math.round(val / step) * step;
  }

  const formatPrice = (usd: number) => {
    if (currency === 'USD') {
      return `$${usd}`;
    }
    const vnd = Math.ceil((usd * fxRate) / 1000) * 1000;
    return `${vnd.toLocaleString('vi-VN')}₫`;
  };

  return (
    <div className="min-h-screen bg-[#02040a] text-slate-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-200 overflow-x-hidden relative quant-cyber-grid">
      {/* Multi-Layered Quantum Aurora & Laser Lighting */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-44 left-1/4 w-[980px] h-[520px] bg-gradient-to-b from-cyan-500/16 via-teal-500/8 to-transparent rounded-full blur-[135px] animate-aurora" />
        <div className="absolute top-[34%] -right-36 w-[680px] h-[460px] bg-emerald-500/10 rounded-full blur-[145px]" />
        <div className="absolute bottom-10 -left-32 w-[620px] h-[420px] bg-sky-500/8 rounded-full blur-[140px]" />
      </div>

      {/* Top Navigation Bar — Strict 3-Zone Contract */}
      <header className="sticky top-0 z-50 backdrop-blur-2xl bg-[#02040a]/85 border-b border-cyan-500/15 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
          {/* Zone 1: Single text element Brand wordmark */}
          <a
            href="#top"
            className="text-xl font-extrabold tracking-tight text-slate-100 font-display whitespace-nowrap shrink-0"
          >
            ZUPIRUS
          </a>

          {/* Zone 2: 4 concise single-line navigation links */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
            <a
              href="#fanout-sim"
              className="hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0"
            >
              Mô Phỏng Bắn Lệnh
            </a>
            <a
              href="#guards"
              className="hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0"
            >
              4 Lớp Giáp Vốn
            </a>
            <a
              href="#calculator"
              className="hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0"
            >
              Máy Tính Khối Lượng
            </a>
            <a
              href="#pricing"
              className="hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0"
            >
              Bảng Giá VietQR
            </a>
          </nav>

          {/* Zone 3: 1 Primary CTA button */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onEnterApp}
              className="quant-btn-primary px-5 py-2.5 text-xs whitespace-nowrap shrink-0"
            >
              Truy Cập Cổng Giao Dịch →
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section — 2-Column Split with items-stretch & Holographic Monitor */}
      <section id="top" className="relative pt-10 pb-20 px-6 z-10">
        <div className="max-w-7xl mx-auto space-y-12">
          {/* Interactive Portal Switcher Bar in Hero Workspace */}
          <div className="quant-glass rounded-2xl px-5 py-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-xs font-mono text-slate-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="font-bold text-white">ZUPIRUS QUANT LAB v2.5</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-cyan-300">XAU/USD Live: ${livePrice.toFixed(2)}</span>
              <span aria-hidden="true" className="hidden sm:inline text-slate-600">·</span>
              <span className="hidden sm:inline text-emerald-400">MetaApi London G2 (~28ms)</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs">
              <button
                type="button"
                onClick={onEnterApp}
                className="quant-btn-secondary px-3.5 py-1.5 text-xs whitespace-nowrap shrink-0"
              >
                Cổng Khách Hàng (User) ↗
              </button>
            </div>
          </div>

          {/* 2-Column Hero Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            {/* Left Column: Value Proposition & Primary Action */}
            <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
              <div className="text-xs font-mono text-cyan-300 flex flex-wrap items-center gap-2">
                <span>DIRECT CLOUD EXECUTION</span>
                <span aria-hidden="true">·</span>
                <span>ZERO EA / ZERO VPS</span>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-400">TABULA RASA QUANT ENGINE</span>
              </div>

              <h1
                className="font-display font-extrabold tracking-tight leading-[1.06] text-balance bg-gradient-to-br from-white via-slate-100 to-cyan-300 bg-clip-text text-transparent"
                style={{ fontSize: 'clamp(2.35rem, 4.2vw, 3.85rem)' }}
              >
                Hệ Thống Giao Dịch Định Lượng XAU/USD Tự Hành Trên Đám Mây
              </h1>

              <p className="text-base text-slate-300 font-normal leading-relaxed max-w-2xl">
                Loại bỏ hoàn toàn máy chủ VPS treo 24/7 và rủi ro đứt kết nối phần mềm EA. ZUPIRUS kết nối trực tiếp
                cụm máy chủ London G2 tới tài khoản MT5 của bạn, vận hành thuật toán học quy nạp Tabula Rasa và kiểm
                toán 4 lớp giáp bảo vệ vốn trước mọi quyết định vào lệnh.
              </p>

              <div className="pt-2 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={onEnterApp}
                  className="quant-btn-primary px-7 py-3.5 text-xs whitespace-nowrap shrink-0"
                >
                  <span>Kết Nối Tài Khoản MT5 Ngay</span>
                  <span aria-hidden="true">→</span>
                </button>
              </div>

              <div className="pt-2 text-xs text-slate-400 font-mono flex flex-wrap items-center gap-3">
                <span>Tương thích Exness · FTMO · IC Markets · Pepperstone</span>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-400">Tự động dời SL hòa vốn tại 1R</span>
              </div>
            </div>

            {/* Right Column: Holographic Laser-Scanning Showcase Card */}
            <div className="lg:col-span-5 flex">
              <div className="relative w-full rounded-2xl overflow-hidden border border-cyan-400/35 bg-[#050b18] flex flex-col justify-between min-h-[380px] shadow-[0_0_55px_rgba(6,182,212,0.18)]">
                {!heroImgError ? (
                  <img
                    src="/src/assets/images/hero_quant_datacenter_1794792840793.jpg"
                    alt="Trung tâm điều hành định lượng ZUPIRUS"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgError(true)}
                    className="absolute inset-0 w-full h-full object-cover opacity-80"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-950/60 via-slate-950 to-emerald-950/50" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#02040a] via-[#02040a]/65 to-[#02040a]/25" />

                {/* Animated Vertical Laser Scan Beam */}
                <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-cyan-400/20 via-cyan-400/5 to-transparent border-t border-cyan-400/50 animate-laser-scan" />

                {/* Top HUD Bar */}
                <div className="relative z-10 p-5 flex items-center justify-between text-xs font-mono">
                  <span className="inline-flex items-center gap-2 text-cyan-300 font-bold">
                    <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                    LONDON G2 OPTICAL BRIDGE
                  </span>
                  <span className="tabular-nums text-emerald-400 font-bold">~28 ms</span>
                </div>

                {/* Live Holographic Order-Flow & Telemetry HUD */}
                <div className="relative z-10 p-5 space-y-3">
                  {/* Live SVG Pulse Wave */}
                  <div className="rounded-xl bg-[#030712]/85 backdrop-blur-md border border-cyan-500/25 p-3.5">
                    <div className="flex items-center justify-between text-xs font-mono mb-2">
                      <span className="text-slate-300 font-bold">XAU/USD M15 ALPHA WAVE</span>
                      <span className="text-cyan-300 font-extrabold tabular-nums">${livePrice.toFixed(2)}</span>
                    </div>
                    <svg viewBox="0 0 320 58" className="w-full h-14 overflow-visible">
                      <defs>
                        <linearGradient id="heroWaveGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <polygon
                        points="0,56 0,42 35,38 70,44 105,28 140,31 175,18 210,22 245,12 280,15 315,6 315,56"
                        fill="url(#heroWaveGrad)"
                      />
                      <polyline
                        fill="none"
                        stroke="#22d3ee"
                        strokeWidth="2.2"
                        points="0,42 35,38 70,44 105,28 140,31 175,18 210,22 245,12 280,15 315,6"
                      />
                      <circle cx="315" cy="6" r="4" fill="#10b981" />
                    </svg>
                  </div>

                  <div className="p-4 rounded-xl bg-[#030712]/90 backdrop-blur-md border border-white/10 space-y-2 font-mono text-xs">
                    <div className="flex items-center justify-between text-slate-300">
                      <span>Cơ chế bảo toàn vị thế</span>
                      <strong className="text-emerald-400">Chốt 50% TP1 & Dời SL Hòa Vốn</strong>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Lá chắn tài khoản quỹ FTMO</span>
                      <span className="text-cyan-300">Tự ngắt khi chạm 4.5% Daily DD</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Full-Width 4-Column Quantitative Proof Strip Below Hero Split */}
          <div id="architecture" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
            <div className="quant-card-interactive p-5">
              <div className="text-xs font-mono text-cyan-400">01. HẠ TẦNG ĐÁM MÂY</div>
              <div className="text-2xl font-extrabold text-slate-100 mt-2 font-mono tabular-nums">
                28 ms Latency
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Đấu nối trực tiếp qua MetaApi Cloud tại trung tâm dữ liệu London G2, không cần cài EA hay thuê VPS.
              </p>
            </div>

            <div className="quant-card-interactive p-5">
              <div className="text-xs font-mono text-emerald-400">02. KIỂM TOÁN RỦI RO</div>
              <div className="text-2xl font-extrabold text-emerald-400 mt-2 font-mono tabular-nums">
                100% Có SL Cứng
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Từ chối mọi tín hiệu thiếu mức dừng lỗ. Tuyệt đối không bình quân giá âm (Martingale) hay gồng lỗ.
              </p>
            </div>

            <div className="quant-card-interactive p-5">
              <div className="text-xs font-mono text-cyan-300">03. CHUẨN HÓA ĐA SÀN</div>
              <div className="text-2xl font-extrabold text-cyan-300 mt-2 font-mono tabular-nums">
                Standard · Cent · Prop
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Tự động nhận diện hậu tố mã vàng (XAUUSDm, GOLD) và quy đổi khối lượng Lot theo từng loại tài khoản.
              </p>
            </div>

            <div className="quant-card-interactive p-5">
              <div className="text-xs font-mono text-amber-300">04. KÍCH HOẠT TỨC THÌ</div>
              <div className="text-2xl font-extrabold text-amber-300 mt-2 font-mono tabular-nums">
                3 Giây Qua VietQR
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Chốt tỷ giá USD/VND thời gian thực và kích hoạt gói tự động 24/7 ngay khi quét mã SePay VietQR.
              </p>
            </div>
          </div>

          {/* Interactive Live Signal Fan-Out Pipeline Simulator */}
          <div id="fanout-sim" className="quant-panel p-6 sm:p-8 space-y-6 border-cyan-500/30">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/[0.07] pb-5">
              <div>
                <div className="text-xs font-mono text-cyan-300 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                  <span>INTERACTIVE QUANTUM PIPELINE SIMULATOR</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-white mt-1">
                  Mô Phỏng Trực Tiếp Quy Trình Kiểm Toán 4 Lớp & Quạt Lệnh Đám Mây
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Bấm nút bên phải để kích hoạt thử một tín hiệu XAU/USD và quan sát tốc độ xử lý mili-giây qua 4 trạm bảo vệ.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  disabled={simRunning}
                  onClick={() => triggerLiveSimulation('BUY')}
                  className="quant-btn-primary px-4 py-2.5 text-xs whitespace-nowrap shrink-0"
                >
                  ⚡ Bắn Thử BUY XAU/USD
                </button>
                <button
                  type="button"
                  disabled={simRunning}
                  onClick={() => triggerLiveSimulation('SELL')}
                  className="quant-btn-secondary px-4 py-2.5 text-xs whitespace-nowrap shrink-0"
                >
                  ⚡ Bắn Thử SELL XAU/USD
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono text-xs">
              {[
                {
                  step: 1,
                  code: 'STAGE 01 · 0.6 ms',
                  title: 'Redis Idempotency Lock',
                  detail: `Khóa nguyên tử tín hiệu ${simSide} XAU/USD @ $${livePrice.toFixed(2)}`,
                },
                {
                  step: 2,
                  code: 'STAGE 02 · 1.1 ms',
                  title: 'ATR(14) Hard Stop-Loss',
                  detail:
                    simSide === 'BUY'
                      ? `Gắn SL cứng $${(livePrice - 4.5).toFixed(2)} · TP $${(livePrice + 9.0).toFixed(2)}`
                      : `Gắn SL cứng $${(livePrice + 4.5).toFixed(2)} · TP $${(livePrice - 9.0).toFixed(2)}`,
                },
                {
                  step: 3,
                  code: 'STAGE 03 · 1.4 ms',
                  title: 'USD News & Spread Audit',
                  detail: 'Lịch USD an toàn · Spread 2.4 pips (Đạt chuẩn ≤ 4.5 pips)',
                },
                {
                  step: 4,
                  code: 'STAGE 04 · 28.0 ms',
                  title: 'MetaApi Cloud Fan-Out',
                  detail: 'Khớp đồng loạt: Exness Standard · ICMarkets ECN · Quỹ FTMO',
                },
              ].map((s) => {
                const active = simStep >= s.step;
                const current = simRunning && simStep === s.step;
                return (
                  <div
                    key={s.step}
                    className={`rounded-xl border p-4 transition-all duration-300 ${
                      current
                        ? 'border-cyan-400 bg-cyan-500/20 shadow-[0_0_28px_rgba(6,182,212,0.3)] scale-[1.02]'
                        : active
                        ? 'border-emerald-500/40 bg-emerald-950/20'
                        : 'border-white/[0.06] bg-[#040710]/60 opacity-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className={active ? 'text-cyan-300 font-bold' : 'text-slate-500'}>{s.code}</span>
                      <span className={active ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                        {current ? 'ĐANG XỬ LÝ...' : active ? '✓ PASSED' : 'CHỜ'}
                      </span>
                    </div>
                    <div className="mt-2 font-sans text-sm font-bold text-white">{s.title}</div>
                    <div className="mt-1.5 text-[11px] text-slate-300 leading-relaxed tabular-nums">{s.detail}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Asymmetric Bento Grid — 4 Mandatory Safety Guards */}
      <section id="guards" className="py-20 px-6 relative z-10 border-t border-white/[0.06] bg-[#040812]/80">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="max-w-3xl space-y-3">
            <div className="text-xs font-mono text-emerald-400">
              CƠ CHẾ BẢO VỆ VỐN BẮT BUỘC · FAIL-CLOSED ARCHITECTURE
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-100 text-balance">
              4 Lớp Giáp Kiểm Toán Trước Khi Khớp Lệnh Xuống MT5
            </h2>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
              Mỗi tín hiệu giao dịch đều phải đi qua quy trình kiểm định tuần tự 4 bước trong thời gian dưới 5 mili-giây.
              Nếu bất kỳ điều kiện an toàn nào bị vi phạm, lệnh sẽ bị hủy bỏ ngay từ tầng lõi.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 quant-panel overflow-hidden flex flex-col justify-between p-6">
              <div className="space-y-2">
                <div className="text-xs font-mono text-cyan-300">S-4 OPTICAL SECURITY PIPELINE</div>
                <h3 className="text-xl font-bold text-slate-100">
                  Kiến Trúc Thực Thi Cách Ly Hai Lớp
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Tách biệt hoàn toàn luồng phân tích AI khỏi động cơ khớp lệnh. Khóa phân tán Redis và bộ kiểm tra
                  Spread bảo đảm mỗi tài khoản chỉ nhận lệnh khi thanh khoản đạt chuẩn.
                </p>
              </div>

              <div className="my-5 rounded-xl overflow-hidden border border-white/10 bg-[#050914] aspect-video relative">
                {!guardImgError ? (
                  <img
                    src="/src/assets/images/guard_matrix_architecture_1794792845754.jpg"
                    alt="Kiến trúc 4 màng lọc bảo vệ vốn ZUPIRUS"
                    referrerPolicy="no-referrer"
                    onError={() => setGuardImgError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center font-mono text-xs text-cyan-400">
                    4-STAGE FAIL-CLOSED GUARD MATRIX
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-xs font-mono text-slate-400 pt-2 border-t border-white/[0.06]">
                <span>Thời gian kiểm toán trung bình</span>
                <strong className="text-emerald-400 tabular-nums">&lt; 1.2 ms / tín hiệu</strong>
              </div>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="quant-card-interactive p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <div className="text-xs font-mono text-cyan-300 font-bold">01. Khóa Phân Tán Nguyên Tử</div>
                  <h3 className="text-base font-bold text-slate-100">Redis Idempotency Lock</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Khóa phân tán nguyên tử trên Redis với TTL 120 giây cho từng cặp (Tài khoản + Tín hiệu). Ngăn chặn
                    tuyệt đối việc bắn lặp lệnh khi mạng biến động.
                  </p>
                </div>
                <div className="text-xs font-mono text-cyan-300 pt-3 border-t border-white/[0.06] tabular-nums">
                  Độ trễ xác thực khóa: &lt; 0.8 ms
                </div>
              </div>

              <div className="quant-card-interactive p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <div className="text-xs font-mono text-rose-300 font-bold">02. Kiểm Soát Cắt Lỗ Bắt Buộc</div>
                  <h3 className="text-base font-bold text-slate-100">Mandatory Hard Stop-Loss</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Loại bỏ 100% các tín hiệu không có mức dừng lỗ (SL) hoặc tự động đính kèm SL chuẩn hóa theo biên độ
                    biến động ATR(14) thực tế của khung M15.
                  </p>
                </div>
                <div className="text-xs font-mono text-rose-300 pt-3 border-t border-white/[0.06]">
                  Chặn tuyệt đối lệnh thả nổi không SL
                </div>
              </div>

              <div className="quant-card-interactive p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <div className="text-xs font-mono text-amber-300 font-bold">03. Lá Chắn Lịch Kinh Tế Vĩ Mô</div>
                  <h3 className="text-base font-bold text-slate-100">High-Impact USD News Shield</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Tự động đóng băng phát lệnh mới trước và sau các bản tin USD tác động mạnh (CPI, Non-Farm Payrolls,
                    lãi suất FOMC) để tránh quét thanh khoản hai đầu.
                  </p>
                </div>
                <div className="text-xs font-mono text-amber-300 pt-3 border-t border-white/[0.06] tabular-nums">
                  Vùng cách ly an toàn: ±15 đến 30 phút
                </div>
              </div>

              <div className="quant-card-interactive p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <div className="text-xs font-mono text-emerald-300 font-bold">04. Bộ Lọc Giãn Spread & Trượt Giá</div>
                  <h3 className="text-base font-bold text-slate-100">Live Spread & Slippage Auditor</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Đo trực tiếp chênh lệch Bid/Ask trên tài khoản MT5 của khách hàng trước mili-giây đặt lệnh. Hủy lệnh
                    ngay nếu Spread giãn vượt ngưỡng an toàn.
                  </p>
                </div>
                <div className="text-xs font-mono text-emerald-300 pt-3 border-t border-white/[0.06] tabular-nums">
                  Ngưỡng bảo vệ XAU/USD: ≤ 4.5 pips
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Interactive Lot Size & Risk Simulator */}
      <section id="calculator" className="py-20 px-6 relative z-10 border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto space-y-10">
          <div className="max-w-3xl space-y-3">
            <div className="text-xs font-mono text-cyan-300">
              CÔNG CỤ TÍNH TOÁN KHỐI LƯỢNG THỜI GIAN THỰC
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-100 text-balance">
              Mô Phỏng Phân Bổ Rủi Ro & Khối Lượng Lệnh (Lot Sizing)
            </h2>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
              Kiểm chứng cách động cơ định lượng ZUPIRUS tự động tính toán số Lot chuẩn xác dựa trên vốn thực (Equity),
              phần trăm rủi ro mỗi lệnh và khoảng cách dừng lỗ SL.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch font-mono">
            <div className="lg:col-span-7 quant-panel p-6 sm:p-8 space-y-7 flex flex-col justify-between">
              <div className="space-y-2.5">
                <div className="flex justify-between items-baseline text-xs">
                  <label htmlFor="calc-equity" className="text-slate-300 font-bold">
                    01. Vốn Tài Khoản Hiện Tại (Equity)
                  </label>
                  <span className="text-cyan-300 font-extrabold text-base tabular-nums">
                    ${calcEquity.toLocaleString('en-US')} USD
                  </span>
                </div>
                <input
                  id="calc-equity"
                  type="range"
                  min="500"
                  max="100000"
                  step="500"
                  value={calcEquity}
                  onChange={(e) => setCalcEquity(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
                <div className="flex justify-between text-[11px] text-slate-500 tabular-nums">
                  <span>$500</span>
                  <span>$10,000</span>
                  <span>$50,000</span>
                  <span>$100,000 (Quỹ FTMO)</span>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex justify-between items-baseline text-xs">
                  <label htmlFor="calc-risk" className="text-slate-300 font-bold">
                    02. Tỷ Lệ Rủi Ro Mỗi Lệnh (% Risk per Trade)
                  </label>
                  <span className="text-emerald-400 font-extrabold text-base tabular-nums">
                    {calcRiskPct.toFixed(1)}% (${riskDollars.toFixed(1)} USD)
                  </span>
                </div>
                <input
                  id="calc-risk"
                  type="range"
                  min="0.2"
                  max="3.0"
                  step="0.1"
                  value={calcRiskPct}
                  onChange={(e) => setCalcRiskPct(parseFloat(e.target.value))}
                  className="w-full accent-emerald-400 cursor-pointer"
                />
                <div className="flex justify-between text-[11px] text-slate-500 tabular-nums">
                  <span>0.2% (Bảo thủ)</span>
                  <span>1.0% (Chuẩn tổ chức)</span>
                  <span>2.0%</span>
                  <span>3.0% (Tối đa)</span>
                </div>
              </div>

              <div className="space-y-2.5">
                <span className="block text-xs text-slate-300 font-bold">
                  03. Phân Loại Tài Khoản MT5
                </span>
                <div className="grid grid-cols-3 gap-3 text-center text-xs">
                  <button
                    type="button"
                    onClick={() => setCalcAccountType('standard')}
                    className={`p-3.5 rounded-xl border transition-colors cursor-pointer ${
                      calcAccountType === 'standard'
                        ? 'border-cyan-400 bg-cyan-950/50 text-cyan-200 font-bold'
                        : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="whitespace-nowrap">Standard / ECN</div>
                    <div className="text-[10px] text-slate-400 mt-1">Hợp đồng chuẩn USD</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCalcAccountType('cent')}
                    className={`p-3.5 rounded-xl border transition-colors cursor-pointer ${
                      calcAccountType === 'cent'
                        ? 'border-cyan-400 bg-cyan-950/50 text-cyan-200 font-bold'
                        : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="whitespace-nowrap">Cent (USC)</div>
                    <div className="text-[10px] text-slate-400 mt-1">Quy đổi 100x số dư</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCalcAccountType('prop')}
                    className={`p-3.5 rounded-xl border transition-colors cursor-pointer ${
                      calcAccountType === 'prop'
                        ? 'border-cyan-400 bg-cyan-950/50 text-cyan-200 font-bold'
                        : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="whitespace-nowrap">Prop Firm</div>
                    <div className="text-[10px] text-slate-400 mt-1">Khóa lỗ ngày 4.5%</div>
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex justify-between items-baseline text-xs">
                  <label htmlFor="calc-sl" className="text-slate-300 font-bold">
                    04. Khoảng Cách Dừng Lỗ (Stop-Loss Distance)
                  </label>
                  <span className="text-slate-100 font-extrabold text-base tabular-nums">
                    {calcSlPoints} Points (${(calcSlPoints / 100).toFixed(2)} giá vàng)
                  </span>
                </div>
                <input
                  id="calc-sl"
                  type="range"
                  min="150"
                  max="800"
                  step="50"
                  value={calcSlPoints}
                  onChange={(e) => setCalcSlPoints(parseInt(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
                <div className="flex justify-between text-[11px] text-slate-500 tabular-nums">
                  <span>150 pts ($1.5)</span>
                  <span>300 pts ($3.0 chuẩn)</span>
                  <span>500 pts ($5.0)</span>
                  <span>800 pts ($8.0)</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 quant-panel p-6 sm:p-8 flex flex-col justify-between border-cyan-500/30">
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-white/[0.07] pb-4">
                  <span className="text-xs font-bold text-cyan-300">THÔNG SỐ LỆNH ĐẦU RA</span>
                  <span className="text-xs text-emerald-400">Chuẩn hóa tự động</span>
                </div>

                <div>
                  <div className="text-xs text-slate-400">Khối lượng khớp lệnh khuyến nghị</div>
                  <div className="text-4xl sm:text-5xl font-extrabold text-slate-100 mt-2 flex items-baseline gap-2.5 tabular-nums">
                    <span className="text-cyan-300">{recommendedLot.toFixed(2)}</span>
                    <span className="text-sm font-normal text-slate-400">
                      {calcAccountType === 'cent' ? 'Cent Lots' : 'Standard Lots'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1.5 tabular-nums">
                    Công thức: ${riskDollars.toFixed(1)} USD rủi ro ÷ {calcSlPoints} points SL
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs tabular-nums">
                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-white/[0.06]">
                    <div className="text-slate-400 text-[11px]">Rủi ro tối đa (-1R)</div>
                    <div className="text-lg font-bold text-rose-400 mt-1">-${riskDollars.toFixed(1)}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Khi chạm Stop-Loss cứng</div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-white/[0.06]">
                    <div className="text-slate-400 text-[11px]">Mục tiêu TP1 (+1R) & TP2 (+2R)</div>
                    <div className="text-lg font-bold text-emerald-400 mt-1">
                      +${oneRProfitDollars.toFixed(0)} / +${twoRProfitDollars.toFixed(0)}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Chốt 50% & dời SL về Entry</div>
                  </div>
                </div>

                {calcAccountType === 'prop' && (
                  <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/35 text-xs space-y-1">
                    <div className="font-bold text-amber-300">Chế Độ Bảo Vệ Quỹ (Prop Pass Guard)</div>
                    <p className="text-slate-300 text-[11px] font-sans leading-relaxed">
                      Ngưỡng sụt giảm ngày tối đa (4.5%):{' '}
                      <strong className="text-amber-300 font-mono tabular-nums">-${propDdLimitDollars.toFixed(1)} USD</strong>.
                      Tự động đóng vị thế và khóa nhận lệnh mới trong ngày nếu chạm ngưỡng bảo toàn quỹ.
                    </p>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={onEnterApp}
                className="quant-btn-primary w-full py-3.5 text-xs mt-6 whitespace-nowrap"
              >
                Áp Dụng Cấu Hình Này Vào Tài Khoản MT5 →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Pricing Matrix & SePay VietQR Instant Activation */}
      <section id="pricing" className="py-20 px-6 relative z-10 border-t border-white/[0.06] bg-[#040812]/90">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div className="text-xs font-mono text-cyan-300">
                BIỂU PHÍ MINH BẠCH · TỰ ĐỘNG KÍCH HOẠT 24/7
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-100 text-balance">
                Phân Cấp Gói Bản Quyền Định Lượng
              </h2>
              <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
                Thanh toán trực tiếp qua mã SePay VietQR (VietinBank) theo tỷ giá thực tế{' '}
                <span className="text-cyan-300 font-mono tabular-nums">{fxRate.toLocaleString('vi-VN')}₫/USD</span>.
                Hệ thống tự động mở khóa tài khoản trong 3 giây qua Webhook.
              </p>
            </div>

            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs self-start">
              <button
                type="button"
                onClick={() => setCurrency('VND')}
                className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  currency === 'VND' ? 'bg-cyan-400 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Hiển thị VNĐ (VietQR)
              </button>
              <button
                type="button"
                onClick={() => setCurrency('USD')}
                className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  currency === 'USD' ? 'bg-cyan-400 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Hiển thị USD ($)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs">
            <div className="quant-panel p-7 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-slate-400">Dành cho nhà đầu tư cá nhân khởi đầu</div>
                  <h3 className="text-xl font-extrabold text-slate-100 mt-1 font-display">STARTER</h3>
                </div>

                <div className="pt-2 border-t border-white/[0.06]">
                  <div className="text-3xl sm:text-4xl font-extrabold text-slate-100 tabular-nums">
                    {formatPrice(20)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    mỗi 30 ngày · cộng $10/slot Cloud MT5 Bridge
                  </div>
                </div>

                <div className="space-y-3 text-slate-300 text-xs pt-3 border-t border-white/[0.06] font-sans">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Số lượng tài khoản MT5</span>
                    <strong className="font-mono text-slate-100">1 Tài khoản</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Loại tài khoản hỗ trợ</span>
                    <strong className="font-mono text-slate-100">Standard USD</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">4 Lớp giáp an toàn lệnh</span>
                    <strong className="font-mono text-emerald-400">Bật mặc định</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Hệ số nhân rủi ro (Multiplier)</span>
                    <strong className="font-mono text-slate-400">Cố định 1.0x</strong>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onEnterApp}
                className="quant-btn-secondary w-full py-3 text-xs whitespace-nowrap"
              >
                Chọn Gói Starter →
              </button>
            </div>

            <div className="quant-panel p-7 flex flex-col justify-between space-y-6 border-cyan-400/50 bg-gradient-to-b from-[#0e1b38] to-[#081022]">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-cyan-300">Dành cho danh mục đa tài khoản & Cent</div>
                    <h3 className="text-xl font-extrabold text-slate-100 mt-1 font-display">GROWTH</h3>
                  </div>
                  <span className="text-[11px] text-cyan-300 font-bold">Khuyến nghị</span>
                </div>

                <div className="pt-2 border-t border-white/[0.08]">
                  <div className="text-3xl sm:text-4xl font-extrabold text-cyan-300 tabular-nums">
                    {formatPrice(35)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    mỗi 30 ngày · hỗ trợ tối đa 3 tài khoản MT5
                  </div>
                </div>

                <div className="space-y-3 text-slate-200 text-xs pt-3 border-t border-white/[0.08] font-sans">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Số lượng tài khoản MT5</span>
                    <strong className="font-mono text-cyan-300">Tối đa 3 MT5</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Loại tài khoản hỗ trợ</span>
                    <strong className="font-mono text-cyan-300">Standard · Cent (USC) · ECN</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Auto Break-Even & Chốt 50% TP1</span>
                    <strong className="font-mono text-emerald-400">Kích hoạt tự động</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Tùy biến Risk Multiplier & Lãi kép</span>
                    <strong className="font-mono text-emerald-400">0.5x – 3.0x</strong>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onEnterApp}
                className="quant-btn-primary w-full py-3 text-xs whitespace-nowrap"
              >
                Kích Hoạt Gói Growth →
              </button>
            </div>

            <div className="quant-panel p-7 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-emerald-400">Dành cho Trader thi quỹ FTMO / Prop Firm</div>
                  <h3 className="text-xl font-extrabold text-slate-100 mt-1 font-display">PROP ALPHA</h3>
                </div>

                <div className="pt-2 border-t border-white/[0.06]">
                  <div className="text-3xl sm:text-4xl font-extrabold text-emerald-400 tabular-nums">
                    {formatPrice(49)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    mỗi 30 ngày · mở khóa toàn bộ tính năng bảo vệ quỹ
                  </div>
                </div>

                <div className="space-y-3 text-slate-200 text-xs pt-3 border-t border-white/[0.06] font-sans">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Số lượng tài khoản MT5</span>
                    <strong className="font-mono text-emerald-400">Tối đa 5 MT5</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Ngắt lỗ ngày (Daily DD Breaker)</span>
                    <strong className="font-mono text-amber-300">Tự ngắt tại 4.5% DD</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Đóng lệnh cuối tuần (Weekend Close)</span>
                    <strong className="font-mono text-emerald-400">Thứ Sáu 21:00 UTC</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Ưu tiên luồng Fan-Out</span>
                    <strong className="font-mono text-cyan-300">Băng thông ưu tiên #1</strong>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onEnterApp}
                className="quant-btn-secondary w-full py-3 text-xs whitespace-nowrap"
              >
                Kích Hoạt Prop Alpha →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="border-t border-white/[0.06] bg-[#010308] py-12 px-6 font-mono text-xs text-slate-500 relative z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <span className="text-slate-200 font-bold font-display text-sm">ZUPIRUS</span>
            <span aria-hidden="true">·</span>
            <span>Autonomous Quantitative Execution Lab © 2026</span>
          </div>

          <div className="flex items-center gap-6">
            <button type="button" onClick={onEnterApp} className="hover:text-cyan-300 transition-colors cursor-pointer">
              Cổng Khách Hàng (User) ↗
            </button>
          </div>
        </div>
      </footer>

      {/* Floating Action Button */}
      <div className="fixed bottom-5 right-5 z-50 flex items-center gap-1.5 rounded-2xl border border-cyan-400/40 bg-[#030714]/90 p-1.5 backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.8),0_0_25px_rgba(6,182,212,0.25)] font-mono text-xs">
        <button
          type="button"
          onClick={onEnterApp}
          className="px-3.5 py-2 rounded-xl bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 hover:bg-cyan-500/30 transition whitespace-nowrap font-bold cursor-pointer"
        >
          📊 Vào Không Gian Giao Dịch ↗
        </button>
      </div>
    </div>
  );
};
