import React, { useState } from 'react';
import { useExchangeRate } from '../hooks/useQuantData.ts';

interface LandingPageProps {
  onEnterApp: () => void;
  onEnterAdmin: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onEnterApp, onEnterAdmin }) => {
  const [currency, setCurrency] = useState<'VND' | 'USD'>('VND');
  const { data: fxData } = useExchangeRate();
  const fxRate = fxData?.rate || 25730.0;

  // Interactive Calculator State
  const [calcEquity, setCalcEquity] = useState<number>(10000);
  const [calcRiskPct, setCalcRiskPct] = useState<number>(1.0);
  const [calcAccountType, setCalcAccountType] = useState<'standard' | 'cent' | 'prop'>('standard');
  const [calcSlPoints, setCalcSlPoints] = useState<number>(300);

  // Compute calculated values
  const riskDollars = calcEquity * (calcRiskPct / 100);
  const rawLot = (riskDollars / Math.max(calcSlPoints, 150)) * (calcAccountType === 'cent' ? 100 : 1);
  const recommendedLot = Math.min(Math.max(roundLot(rawLot, calcAccountType === 'cent' ? 0.1 : 0.01), 0.01), 50.0);
  const oneRProfitDollars = riskDollars;
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
    <div className="min-h-screen bg-[#050810] text-slate-100 font-sans selection:bg-cyan-500 selection:text-slate-950 overflow-x-hidden relative">
      {/* Background Cyber Mesh & Radial Glows */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[1000px] h-[550px] bg-gradient-to-b from-cyan-500/12 via-blue-600/6 to-transparent rounded-full blur-[140px]" />
        <div className="absolute top-[35%] right-[-10%] w-[600px] h-[450px] bg-purple-600/8 rounded-full blur-[150px]" />
        <div className="absolute top-[65%] left-[-10%] w-[700px] h-[500px] bg-emerald-600/6 rounded-full blur-[160px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
          }}
        />
      </div>

      {/* Top Header / Modern Quant Nav */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#050810]/85 border-b border-cyan-500/15 px-6 py-3.5 transition-all">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={onEnterApp}>
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 via-teal-500 to-blue-600 p-[1px] shadow-[0_0_20px_rgba(6,182,212,0.4)]">
              <div className="w-full h-full bg-[#070c18] rounded-[11px] flex items-center justify-center font-black text-cyan-400 text-lg font-mono">
                Z
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-base tracking-wider text-slate-100 font-mono">ZUPIRUS</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-cyan-950 text-cyan-400 border border-cyan-800/60">
                  v2.2 QUANT
                </span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono tracking-widest uppercase block -mt-0.5">
                AUTONOMOUS QUANT LAB
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-xs font-mono text-slate-300">
            <a href="#guards" className="hover:text-cyan-400 transition-colors flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              4 Lớp Giáp Bảo Vệ
            </a>
            <a href="#calculator" className="hover:text-cyan-400 transition-colors">
              Máy Tính Lô & Rủi Ro
            </a>
            <a href="#pricing" className="hover:text-cyan-400 transition-colors">
              Gói Bản Quyền & SePay
            </a>
          </nav>

          <div className="flex items-center gap-3 font-mono text-xs">
            <button
              onClick={onEnterAdmin}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-900/60 hover:bg-slate-800 text-slate-300 transition-all hover:border-slate-600"
            >
              <span>Quản Trị adm</span>
              <span className="text-slate-500 text-[10px]">↗</span>
            </button>
            <button
              onClick={onEnterApp}
              className="relative group px-4 py-2 rounded-lg font-bold text-slate-950 transition-all shadow-[0_0_20px_rgba(6,182,212,0.35)] hover:shadow-[0_0_30px_rgba(6,182,212,0.6)] bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400"
            >
              <span className="flex items-center gap-1.5 text-xs">
                <span>Vào Ứng Dụng (app)</span>
                <span className="transition-transform group-hover:translate-x-0.5">↗</span>
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-20 pb-16 px-6 z-10">
        <div className="max-w-5xl mx-auto text-center space-y-6">
          {/* Live Telemetry Pill */}
          <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full border border-cyan-500/30 bg-cyan-950/40 text-cyan-300 text-xs font-mono shadow-[0_0_20px_rgba(6,182,212,0.15)] backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="font-semibold text-slate-200">DIRECT CLOUD EXECUTION</span>
            <span className="text-cyan-500">·</span>
            <span className="text-emerald-400">ZERO EA CÀI ĐẶT</span>
            <span className="text-cyan-500">·</span>
            <span className="text-slate-400">ĐỘ TRỄ 28MS LONDON</span>
          </div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-slate-100 tracking-tight leading-[1.08]">
            Hệ Thống Giao Dịch Định Lượng <br />
            <span className="bg-gradient-to-r from-cyan-300 via-teal-200 to-emerald-400 bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(6,182,212,0.3)]">
              Tự Hành 100% Trên Điện Toán Đám Mây
            </span>
          </h1>

          <p className="max-w-3xl mx-auto text-sm sm:text-base text-slate-400 font-normal leading-relaxed">
            Vĩnh biệt máy tính bật 24/7 và nỗi lo EA bị ngắt kết nối. ZUPIRUS Quant Lab kết nối trực tiếp đám mây với
            tài khoản MT5 của bạn, ứng dụng mô hình học quy nạp Tabula Rasa và bảo vệ nguồn vốn bằng 4 lớp giáp an toàn
            chuẩn mực phố Wall.
          </p>

          {/* Action CTAs */}
          <div className="pt-4 flex flex-wrap items-center justify-center gap-4 font-mono text-xs">
            <button
              onClick={onEnterApp}
              className="px-7 py-3.5 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 font-black text-sm transition-all shadow-[0_0_30px_rgba(6,182,212,0.4)] flex items-center gap-2 group"
            >
              <span>⚡ KẾT NỐI TÀI KHOẢN MT5 NGAY</span>
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </button>
            <a
              href="#calculator"
              className="px-5 py-3.5 rounded-xl border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-200 font-semibold transition-colors flex items-center gap-2"
            >
              <span>📊 Tính Toán Phân Bổ Vốn & Lô Lệnh</span>
            </a>
          </div>

          {/* Real-time Status Badges Grid */}
          <div className="pt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-4xl mx-auto text-left font-mono">
            <div className="p-3.5 rounded-xl border border-slate-800/80 bg-[#0b1120]/70 backdrop-blur-sm">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">HẠ TẦNG KẾT NỐI</div>
              <div className="text-sm font-bold text-cyan-300 mt-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                MetaApi Cloud
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Không cần cài EA/VPS</div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-800/80 bg-[#0b1120]/70 backdrop-blur-sm">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">LÁ CHẮN AN TOÀN</div>
              <div className="text-sm font-bold text-emerald-300 mt-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                4 Màng Lọc Chặt
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">SL cứng & News Shield</div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-800/80 bg-[#0b1120]/70 backdrop-blur-sm">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">ĐA DẠNG TÀI KHOẢN</div>
              <div className="text-sm font-bold text-purple-300 mt-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-400" />
                Cent / Standard / Prop
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Tự chuẩn hóa Lot size</div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-800/80 bg-[#0b1120]/70 backdrop-blur-sm">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">THANH TOÁN VIỆT NAM</div>
              <div className="text-sm font-bold text-amber-300 mt-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                SePay VietQR 24/7
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Kích hoạt tự động 3 giây</div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Lot Size & Risk Calculator */}
      <section id="calculator" className="py-16 px-6 relative z-10 border-t border-slate-800/60 bg-[#070b16]/50">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="text-center space-y-2">
            <div className="inline-block px-3 py-1 rounded-full text-[10px] font-mono font-bold bg-cyan-950/70 border border-cyan-700/50 text-cyan-300">
              CÔNG CỤ TÍNH TOÁN ĐỊNH LƯỢNG THỜI GIAN THỰC
            </div>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-100">
              Mô Phỏng Phân Bổ Vốn & Khối Lượng Lệnh (Lot Size)
            </h2>
            <p className="text-sm text-slate-400 max-w-2xl mx-auto">
              Trực quan hóa cách ZUPIRUS Quant Lab tính toán khối lượng lệnh chuẩn xác theo tỷ lệ rủi ro, khoảng cách SL
              và đặc tính riêng của từng loại tài khoản (Cent, Chuẩn hoặc Thi Quỹ).
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start font-mono">
            {/* Input Controls */}
            <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#0d1424] p-6 space-y-6 shadow-xl">
              <div>
                <div className="flex justify-between items-center text-xs mb-2">
                  <span className="text-slate-400 font-bold">1. SỐ DƯ TÀI KHOẢN (EQUITY):</span>
                  <span className="text-cyan-300 font-bold text-sm">${calcEquity.toLocaleString()} USD</span>
                </div>
                <input
                  type="range"
                  min="500"
                  max="100000"
                  step="500"
                  value={calcEquity}
                  onChange={(e) => setCalcEquity(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400"
                />
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>$500 (Tối thiểu)</span>
                  <span>$10,000</span>
                  <span>$50,000</span>
                  <span>$100,000 (Quỹ)</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center text-xs mb-2">
                  <span className="text-slate-400 font-bold">2. TỶ LỆ RỦI RO MỖI LỆNH (% RISK):</span>
                  <span className="text-emerald-400 font-bold text-sm">{calcRiskPct.toFixed(1)}% ({riskDollars.toFixed(1)} USD)</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="3.0"
                  step="0.1"
                  value={calcRiskPct}
                  onChange={(e) => setCalcRiskPct(parseFloat(e.target.value))}
                  className="w-full accent-emerald-400"
                />
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>0.2% (Thận trọng)</span>
                  <span>1.0% (Khuyến nghị)</span>
                  <span>2.0%</span>
                  <span>3.0% (Tối đa)</span>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 font-bold mb-2">3. LOẠI TÀI KHOẢN GIAO DỊCH:</label>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <button
                    type="button"
                    onClick={() => setCalcAccountType('standard')}
                    className={`p-3 rounded-xl border transition-all ${
                      calcAccountType === 'standard'
                        ? 'border-cyan-400 bg-cyan-950/60 text-cyan-300 font-bold'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div>STANDARD</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Tài khoản chuẩn USD</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCalcAccountType('cent')}
                    className={`p-3 rounded-xl border transition-all ${
                      calcAccountType === 'cent'
                        ? 'border-purple-400 bg-purple-950/60 text-purple-300 font-bold'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div>CENT (USC)</div>
                    <div className="text-[10px] text-purple-300 mt-0.5">Nhân 100x số dư</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCalcAccountType('prop')}
                    className={`p-3 rounded-xl border transition-all ${
                      calcAccountType === 'prop'
                        ? 'border-amber-400 bg-amber-950/60 text-amber-300 font-bold'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div>PROP FIRM</div>
                    <div className="text-[10px] text-amber-300 mt-0.5">Giới hạn DD 4.5%</div>
                  </button>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center text-xs mb-2">
                  <span className="text-slate-400 font-bold">4. KHOẢNG CÁCH DỪNG LỖ (SL DISTANCE):</span>
                  <span className="text-slate-200 font-bold text-sm">{calcSlPoints} Points (${(calcSlPoints / 100).toFixed(2)} Giá Vàng)</span>
                </div>
                <input
                  type="range"
                  min="150"
                  max="800"
                  step="50"
                  value={calcSlPoints}
                  onChange={(e) => setCalcSlPoints(parseInt(e.target.value))}
                  className="w-full accent-slate-400"
                />
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>150 pts ($1.5)</span>
                  <span>300 pts ($3.0 chuẩn)</span>
                  <span>500 pts ($5.0)</span>
                  <span>800 pts ($8.0)</span>
                </div>
              </div>
            </div>

            {/* Live Calculation Output Card */}
            <div className="lg:col-span-5 rounded-2xl border border-cyan-500/40 bg-gradient-to-b from-[#0b1428] to-[#070d1a] p-6 space-y-5 shadow-2xl relative">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <span className="text-xs font-bold text-cyan-300 uppercase">KẾT QUẢ ĐỊNH LƯỢNG LỆNH</span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800">
                  TỰ HÀNH 100%
                </span>
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div className="text-xs text-slate-400">Khối Lượng Lệnh Khuyến Nghị (Lot):</div>
                  <div className="text-3xl sm:text-4xl font-black text-cyan-300 mt-1 flex items-baseline gap-2">
                    <span>{recommendedLot.toFixed(2)}</span>
                    <span className="text-xs font-normal text-slate-500 font-sans">
                      {calcAccountType === 'cent' ? 'Cent Lots' : 'Standard Lots'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Công thức: Rủi ro ({riskDollars.toFixed(1)}$) ÷ SL ({calcSlPoints} pts)
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                    <div className="text-slate-400 text-[10px]">RỦI RO TỐI ĐA (1R):</div>
                    <div className="text-base font-bold text-rose-400 mt-0.5">-${riskDollars.toFixed(1)}</div>
                    <div className="text-[10px] text-slate-500">Khi chạm Stop Loss</div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                    <div className="text-slate-400 text-[10px]">CHỐT 50% TP1 & BE:</div>
                    <div className="text-base font-bold text-emerald-400 mt-0.5">+${oneRProfitDollars.toFixed(1)}</div>
                    <div className="text-[10px] text-slate-500">Tại mốc 1R (+{calcSlPoints} pts)</div>
                  </div>
                </div>

                {calcAccountType === 'prop' && (
                  <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-600/40 text-amber-300 text-xs space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <span>🛡️ CHẾ ĐỘ THI QUỸ (PROP PASS GUARD)</span>
                    </div>
                    <div className="text-[11px] text-amber-200">
                      Ngưỡng sụt giảm ngày tối đa (4.5%): <span className="font-bold">-${propDdLimitDollars.toFixed(1)} USD</span>.
                      Hệ thống tự động cắt toàn bộ lệnh và khóa giao dịch nếu chạm ngưỡng để bảo toàn tài khoản quỹ.
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={onEnterApp}
                  className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] mt-2"
                >
                  ÁP DỤNG THÔNG SỐ VÀO TÀI KHOẢN MT5 CỦA BẠN ↗
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4 Safety Guards Bento Grid */}
      <section id="guards" className="py-20 px-6 relative z-10 max-w-7xl mx-auto space-y-10">
        <div className="text-center space-y-3">
          <div className="inline-block px-3 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-950/70 border border-emerald-700/50 text-emerald-400">
            CƠ CHẾ BẢO VỆ VỐN BẮT BUỘC (FAIL-CLOSED)
          </div>
          <h2 className="text-3xl sm:text-5xl font-black text-slate-100">
            4 Lớp Giáp Bảo Vệ Tài Khoản Khách Hàng
          </h2>
          <p className="text-sm text-slate-400 max-w-2xl mx-auto font-normal">
            Bất kỳ tín hiệu nào, dù từ chuyên gia hay thuật toán định lượng, đều phải vượt qua 4 màng lọc an toàn 
            không thể thương lượng trước khi được phép khớp lệnh xuống tài khoản MT5.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 font-mono text-xs">
          {/* Guard 1 */}
          <div className="p-6 rounded-2xl border border-cyan-500/30 bg-[#0b1222] hover:border-cyan-400 transition-all space-y-3 relative overflow-hidden group">
            <div className="w-10 h-10 rounded-xl bg-cyan-950 border border-cyan-500/40 flex items-center justify-center text-cyan-300 font-bold text-lg">
              01
            </div>
            <h3 className="font-bold text-sm text-slate-100 group-hover:text-cyan-300 transition-colors">
              Redis Idempotency Lock
            </h3>
            <p className="text-slate-400 text-[11px] font-sans leading-relaxed">
              Khóa phân tán nguyên tử Redis với TTL 120s. Ngăn chặn tuyệt đối tình trạng một tín hiệu bị gửi trùng 
              hoặc khớp lệnh nhiều lần khi nguồn phát bị chập chờn.
            </p>
            <div className="pt-2 text-[10px] text-cyan-400 flex items-center gap-1 font-mono">
              <span>✓ Trễ xác thực: &lt;1ms</span>
            </div>
          </div>

          {/* Guard 2 */}
          <div className="p-6 rounded-2xl border border-rose-500/30 bg-[#0b1222] hover:border-rose-400 transition-all space-y-3 relative overflow-hidden group">
            <div className="w-10 h-10 rounded-xl bg-rose-950 border border-rose-500/40 flex items-center justify-center text-rose-300 font-bold text-lg">
              02
            </div>
            <h3 className="font-bold text-sm text-slate-100 group-hover:text-rose-300 transition-colors">
              Mandatory Stop Loss Guard
            </h3>
            <p className="text-slate-400 text-[11px] font-sans leading-relaxed">
              Từ chối 100% các tín hiệu không cài đặt giá cắt lỗ (SL). Nghiêm cấm mọi hành vi gồng lỗ vô cực, thả trôi 
              lệnh hay bình quân giá (Martingale) nguy hiểm.
            </p>
            <div className="pt-2 text-[10px] text-rose-400 flex items-center gap-1 font-mono">
              <span>✓ Bắt buộc có SL cứng</span>
            </div>
          </div>

          {/* Guard 3 */}
          <div className="p-6 rounded-2xl border border-amber-500/30 bg-[#0b1222] hover:border-amber-400 transition-all space-y-3 relative overflow-hidden group">
            <div className="w-10 h-10 rounded-xl bg-amber-950 border border-amber-500/40 flex items-center justify-center text-amber-300 font-bold text-lg">
              03
            </div>
            <h3 className="font-bold text-sm text-slate-100 group-hover:text-amber-300 transition-colors">
              Live News Shield (Non-Farm, CPI)
            </h3>
            <p className="text-slate-400 text-[11px] font-sans leading-relaxed">
              Tự động đóng băng nhận lệnh trước 30 phút và sau 15 phút quanh các thời điểm công bố tin tức đỏ 
              (Lãi suất Fed, CPI, Bảng lương phi nông nghiệp NFP).
            </p>
            <div className="pt-2 text-[10px] text-amber-400 flex items-center gap-1 font-mono">
              <span>✓ Miễn nhiễm trượt giá tin tức</span>
            </div>
          </div>

          {/* Guard 4 */}
          <div className="p-6 rounded-2xl border border-emerald-500/30 bg-[#0b1222] hover:border-emerald-400 transition-all space-y-3 relative overflow-hidden group">
            <div className="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-300 font-bold text-lg">
              04
            </div>
            <h3 className="font-bold text-sm text-slate-100 group-hover:text-emerald-300 transition-colors">
              Live Spread & Slippage Guard
            </h3>
            <p className="text-slate-400 text-[11px] font-sans leading-relaxed">
              Kiểm tra trực tiếp độ giãn Spread của sàn trước khi đặt lệnh. Nếu Spread XAUUSD vượt quá 4.5 pips 
              hoặc trượt giá quá 3 pips, lệnh lập tức bị hủy bỏ để bảo toàn lợi nhuận.
            </p>
            <div className="pt-2 text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
              <span>✓ Giới hạn Spread &lt;4.5 pips</span>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section with SePay VietQR Highlights */}
      <section id="pricing" className="py-20 px-6 relative z-10 border-t border-slate-800/80 bg-[#060a16]">
        <div className="max-w-6xl mx-auto space-y-10">
          <div className="text-center space-y-3">
            <div className="inline-block px-3 py-1 rounded-full text-[10px] font-mono font-bold bg-cyan-950/70 border border-cyan-700/50 text-cyan-300">
              MINH BẠCH & KÍCH HOẠT TỨC THÌ
            </div>
            <h2 className="text-3xl sm:text-5xl font-black text-slate-100">
              Bảng Giá Dịch Vụ Định Lượng
            </h2>
            <p className="text-sm text-slate-400 max-w-xl mx-auto font-normal">
              Thanh toán tiện lợi qua cổng ngân hàng SePay VietQR (VietinBank). Tỷ giá USD/VND được chốt theo thời gian thực 
              và tự động kích hoạt tài khoản trong vòng 3 giây.
            </p>

            {/* Currency Selector */}
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs mt-3">
              <button
                type="button"
                onClick={() => setCurrency('VND')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  currency === 'VND' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                VNĐ (VietQR)
              </button>
              <button
                type="button"
                onClick={() => setCurrency('USD')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  currency === 'USD' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                USD ($)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs">
            {/* Starter Plan */}
            <div className="p-6 rounded-2xl border border-slate-800 bg-[#0d1424] space-y-6 flex flex-col justify-between hover:border-slate-700 transition-all">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-200 text-sm">STARTER</span>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">1 TÀI KHOẢN MT5</span>
                </div>
                <div>
                  <div className="text-3xl font-black text-slate-100">{formatPrice(20)}</div>
                  <div className="text-[11px] text-slate-500 mt-1">/ tháng (Bao gồm $10 Cloud Bridge)</div>
                </div>
                <div className="space-y-2 text-slate-300 text-[11px] border-t border-slate-800 pt-4">
                  <div className="flex items-center gap-2"><span>✓</span> 1 Tài khoản MT5 Cloud Bridge</div>
                  <div className="flex items-center gap-2"><span>✓</span> Tín hiệu XAUUSD chuẩn mực</div>
                  <div className="flex items-center gap-2"><span>✓</span> Đầy đủ 4 Lớp Giáp An Toàn</div>
                  <div className="flex items-center gap-2 text-slate-500"><span>✕</span> Auto Break-Even & Partial TP</div>
                  <div className="flex items-center gap-2 text-slate-500"><span>✕</span> Chế độ thi quỹ (Prop Guard)</div>
                </div>
              </div>
              <button
                type="button"
                onClick={onEnterApp}
                className="w-full py-3 rounded-xl border border-slate-700 hover:border-cyan-400 text-slate-200 hover:text-cyan-300 font-bold text-xs transition-colors"
              >
                Bắt Đầu Với Starter ↗
              </button>
            </div>

            {/* Growth Plan (Popular) */}
            <div className="p-6 rounded-2xl border-2 border-cyan-400 bg-[#0d172e] space-y-6 flex flex-col justify-between shadow-[0_0_30px_rgba(6,182,212,0.2)] relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-cyan-400 text-slate-950 font-bold text-[10px]">
                PHỔ BIẾN NHẤT
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-cyan-300 text-sm">GROWTH</span>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800">
                    TỐI ĐA 3 MT5
                  </span>
                </div>
                <div>
                  <div className="text-3xl font-black text-cyan-300">{formatPrice(35)}</div>
                  <div className="text-[11px] text-slate-400 mt-1">/ tháng (Bao gồm Cloud Bridge)</div>
                </div>
                <div className="space-y-2 text-slate-200 text-[11px] border-t border-cyan-900/50 pt-4">
                  <div className="flex items-center gap-2 text-cyan-300"><span>✓</span> Tối đa 3 Tài khoản MT5 đồng thời</div>
                  <div className="flex items-center gap-2 text-cyan-300"><span>✓</span> <strong>Auto Break-Even (1R) & Chốt 50% TP1</strong></div>
                  <div className="flex items-center gap-2 text-cyan-300"><span>✓</span> Đầy đủ 4 Lớp Giáp An Toàn</div>
                  <div className="flex items-center gap-2 text-cyan-300"><span>✓</span> Hỗ trợ tài khoản Cent (USC)</div>
                  <div className="flex items-center gap-2 text-slate-500"><span>✕</span> Chế độ thi quỹ (Prop Guard)</div>
                </div>
              </div>
              <button
                type="button"
                onClick={onEnterApp}
                className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)]"
              >
                Kích Hoạt Gói Growth ↗
              </button>
            </div>

            {/* Alpha Prop Plan */}
            <div className="p-6 rounded-2xl border border-purple-500/40 bg-[#120f26] space-y-6 flex flex-col justify-between hover:border-purple-400 transition-all">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-purple-300 text-sm">PROP ALPHA</span>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-purple-950 text-purple-300 border border-purple-800">
                    TỐI ĐA 5 MT5
                  </span>
                </div>
                <div>
                  <div className="text-3xl font-black text-purple-300">{formatPrice(49)}</div>
                  <div className="text-[11px] text-slate-400 mt-1">/ tháng (Full tính năng)</div>
                </div>
                <div className="space-y-2 text-slate-300 text-[11px] border-t border-purple-900/50 pt-4">
                  <div className="flex items-center gap-2 text-purple-300"><span>✓</span> Tối đa 5 Tài khoản MT5 đồng thời</div>
                  <div className="flex items-center gap-2 text-purple-300"><span>✓</span> <strong>Chế độ thi quỹ: Drawdown 4.5% Breaker</strong></div>
                  <div className="flex items-center gap-2 text-purple-300"><span>✓</span> <strong>Đóng toàn bộ vị thế thứ Sáu 21:00 UTC</strong></div>
                  <div className="flex items-center gap-2 text-purple-300"><span>✓</span> Auto Break-Even & Chốt 50% TP1</div>
                  <div className="flex items-center gap-2 text-purple-300"><span>✓</span> Ưu tiên băng thông khớp lệnh cao nhất</div>
                </div>
              </div>
              <button
                type="button"
                onClick={onEnterApp}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-slate-100 font-bold text-xs transition-all shadow-[0_0_20px_rgba(168,85,247,0.3)]"
              >
                Kích Hoạt Prop Alpha ↗
              </button>
            </div>
          </div>

          {/* VietQR Bank Notice Banner */}
          <div className="p-4 rounded-2xl border border-slate-800 bg-[#090f1e] flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-xs">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-950 border border-blue-600/40 flex items-center justify-center text-xl">
                🏦
              </div>
              <div>
                <div className="font-bold text-slate-200">Thanh toán tự động qua SePay VietQR (VietinBank)</div>
                <div className="text-slate-400 text-[11px]">
                  Số tài khoản: <strong className="text-cyan-300">105887054819</strong> · Chủ tài khoản: <strong className="text-slate-200">LE NGUYEN NHU THUY</strong>
                </div>
              </div>
            </div>
            <button
              onClick={onEnterApp}
              className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold transition-all text-xs"
            >
              Nâng Cấp Ngay Trên App ↗
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-[#04060d] py-12 px-6 font-mono text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center font-bold text-cyan-400">
              Z
            </div>
            <span className="text-slate-300 font-bold">ZUPIRUS QUANT LAB</span>
            <span>· All Rights Reserved © 2026</span>
          </div>

          <div className="flex items-center gap-6">
            <a href="https://zupirus.com" className="hover:text-cyan-400 transition-colors">zupirus.com</a>
            <a href="https://app.zupirus.com" className="hover:text-cyan-400 transition-colors">app.zupirus.com</a>
            <a href="https://adm.zupirus.com" className="hover:text-cyan-400 transition-colors">adm.zupirus.com</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
