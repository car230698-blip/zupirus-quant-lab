import React, { useState } from 'react';
import { useExchangeRate } from '../hooks/useQuantData.ts';

interface LandingPageProps {
  onEnterApp: () => void;
  onEnterAdmin: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onEnterApp, onEnterAdmin }) => {
  const [currency, setCurrency] = useState<'USD' | 'VND'>('VND');
  const { data: fxData } = useExchangeRate();
  const fxRate = fxData?.rate || 25730.0;
  const fxSource = fxData?.source || 'API';

  const formatPrice = (usd: number) => {
    if (currency === 'USD') {
      return `$${usd}`;
    }
    const vnd = Math.ceil((usd * fxRate) / 1000) * 1000;
    return `${vnd.toLocaleString('vi-VN')}₫`;
  };

  return (
    <div className="min-h-screen bg-[#060a14] text-slate-100 font-sans selection:bg-cyan-500 selection:text-slate-950">
      {/* Top Header / Navigation */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-[#060a14]/80 border-b border-slate-800/80 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center font-black text-slate-950 text-xl font-mono shadow-[0_0_15px_rgba(6,182,212,0.4)]">
              Z
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-wider text-slate-100 font-mono">ZUPIRUS</span>
              <span className="text-[10px] text-cyan-400 font-mono block tracking-widest uppercase">QUANT LAB</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-xs font-mono text-slate-300">
            <a href="#guards" className="hover:text-cyan-400 transition-colors">4 Lớp Giáp Bảo Vệ</a>
            <a href="#architecture" className="hover:text-cyan-400 transition-colors">100% Cloud MT5</a>
            <a href="#universe" className="hover:text-cyan-400 transition-colors">Vũ Trụ Giao Dịch</a>
            <a href="#pricing" className="hover:text-cyan-400 transition-colors">Gói Dịch Vụ</a>
          </nav>

          <div className="flex items-center gap-3 font-mono text-xs">
            <button
              onClick={onEnterAdmin}
              className="hidden sm:inline-block px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900/60 hover:bg-slate-800 text-slate-300 transition-colors"
            >
              Cổng Quản Trị ↗
            </button>
            <button
              onClick={onEnterApp}
              className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_25px_rgba(6,182,212,0.5)]"
            >
              Vào Ứng Dụng (app.zupirus.com) ↗
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-24 pb-20 px-6 overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-1/3 right-1/4 w-[400px] h-[300px] bg-purple-500/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center space-y-6 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-950/30 text-cyan-300 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            DIRECT CLOUD MT5 EXECUTION · ZERO EA · ZERO VPS
          </div>

          <h1 className="text-4xl sm:text-6xl font-black text-slate-100 tracking-tight leading-tight sm:leading-none">
            Giao Dịch Định Lượng <br />
            <span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
              100% Điện Toán Đám Mây & 4 Màng Lọc An Toàn
            </span>
          </h1>

          <p className="max-w-2xl mx-auto text-sm sm:text-base text-slate-400 font-normal leading-relaxed">
            Không cần thuê VPS, không cần cài đặt file EA phức tạp. Tín hiệu được phát thẳng từ Quant Engine 
            xuống tài khoản MT5 của bạn qua MetaApi Cloud Bridge với độ trễ microsecond và 4 lớp khiên phòng hộ tối thượng.
          </p>

          <div className="pt-4 flex flex-wrap items-center justify-center gap-4 font-mono text-xs">
            <button
              onClick={onEnterApp}
              className="px-6 py-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm transition-all shadow-[0_0_25px_rgba(6,182,212,0.4)] flex items-center gap-2"
            >
              <span>Kết Nối MT5 Ngay (app.zupirus.com)</span>
              <span>→</span>
            </button>
            <button
              onClick={onEnterAdmin}
              className="px-5 py-3.5 rounded-xl border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-200 transition-colors"
            >
              Trung Tâm Điều Hành (adm.zupirus.com)
            </button>
          </div>

          {/* Quick Stats Bar */}
          <div className="pt-12 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-4xl mx-auto font-mono text-left">
            <div className="p-4 rounded-xl border border-slate-800 bg-[#0d1424]/60 backdrop-blur">
              <div className="text-[11px] text-slate-400">HẠ TẦNG CLOUD</div>
              <div className="text-lg font-bold text-cyan-300 mt-1">Zero VPS / Zero EA</div>
              <div className="text-[10px] text-slate-500 mt-0.5">MetaApi Cloud London G2</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-[#0d1424]/60 backdrop-blur">
              <div className="text-[11px] text-slate-400">ĐỘ TRỄ PHÂN BỔ</div>
              <div className="text-lg font-bold text-emerald-400 mt-1">&lt; 35ms Fan-Out</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Song song đa tài khoản</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-[#0d1424]/60 backdrop-blur">
              <div className="text-[11px] text-slate-400">MÀNG PHÒNG THỦ</div>
              <div className="text-lg font-bold text-amber-400 mt-1">4 Lớp Giáp An Toàn</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Tặng mặc định 100% các gói</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-[#0d1424]/60 backdrop-blur">
              <div className="text-[11px] text-slate-400">TỶ GIÁ THỜI GIAN THỰC</div>
              <div className="text-lg font-bold text-purple-400 mt-1">{fxRate.toLocaleString('vi-VN')}₫</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Tự động chốt VietQR ({fxSource})</div>
            </div>
          </div>
        </div>
      </section>

      {/* 4 Mandatory Safety Guards Section */}
      <section id="guards" className="py-20 px-6 border-t border-slate-800/80 bg-[#080d1a]">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-500/30 bg-amber-950/20 text-amber-300 text-xs font-mono">
              🛡️ TIÊU CHUẨN AN TOÀN TUYỆT ĐỐI
            </div>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-100">4 Màng Lọc Bảo Vệ Vốn Bắt Buộc</h2>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl mx-auto font-mono">
              Mọi tín hiệu (từ TradingView hay Demo Feed) trước khi khớp lệnh xuống MT5 của bạn đều phải vượt qua 4 chốt chặn nghiêm ngặt.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 font-mono text-xs">
            <div className="p-6 rounded-2xl border border-cyan-500/30 bg-[#0d172a] space-y-4 hover:border-cyan-500 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-cyan-950 border border-cyan-500/40 flex items-center justify-center text-lg text-cyan-400 font-bold">
                1
              </div>
              <div className="font-bold text-sm text-cyan-300">Mandatory SL & Anti-Martingale</div>
              <p className="text-slate-400 text-[11px] font-sans leading-relaxed">
                Bắt buộc có Stop Loss. Nếu tín hiệu nguồn thiếu SL, hệ thống tự động gán SL theo ATR(14) (mặc định 35 pips trên Vàng). Tối đa 2 lệnh đồng thời, tuyệt đối cấm Martingale.
              </p>
              <div className="text-[10px] text-emerald-400 font-bold">● FAIL-CLOSED SL ACTIVE</div>
            </div>

            <div className="p-6 rounded-2xl border border-amber-500/30 bg-[#0d172a] space-y-4 hover:border-amber-500 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-amber-950 border border-amber-500/40 flex items-center justify-center text-lg text-amber-400 font-bold">
                2
              </div>
              <div className="font-bold text-sm text-amber-300">News Shield (Cửa Sổ Tin Tức)</div>
              <p className="text-slate-400 text-[11px] font-sans leading-relaxed">
                Tự động quét lịch kinh tế. Chặn toàn bộ lệnh mới trong cửa sổ ±15 phút trước và sau khi công bố tin tức USD High-Impact (CPI, NFP, Lãi suất FED) để tránh bẫy giá giật.
              </p>
              <div className="text-[10px] text-amber-400 font-bold">● ±15 MIN USD LOCKOUT</div>
            </div>

            <div className="p-6 rounded-2xl border border-purple-500/30 bg-[#0d172a] space-y-4 hover:border-purple-500 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-purple-950 border border-purple-500/40 flex items-center justify-center text-lg text-purple-400 font-bold">
                3
              </div>
              <div className="font-bold text-sm text-purple-300">Entry Slippage Guard</div>
              <p className="text-slate-400 text-[11px] font-sans leading-relaxed">
                Kiểm soát độ lệch giá vào lệnh. Nếu giá thị trường thực tế lệch quá 20 pips ($2.00 trên XAUUSD) so với giá phát lệnh, lệnh sẽ bị từ chối ngay lập tức để bảo vệ tỷ lệ R:R.
              </p>
              <div className="text-[10px] text-purple-400 font-bold">● MAX DRIFT: 20 PIPS</div>
            </div>

            <div className="p-6 rounded-2xl border border-emerald-500/30 bg-[#0d172a] space-y-4 hover:border-emerald-500 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-lg text-emerald-400 font-bold">
                4
              </div>
              <div className="font-bold text-sm text-emerald-300">Redis Idempotency Deduplication</div>
              <p className="text-slate-400 text-[11px] font-sans leading-relaxed">
                Khóa phân tán Redis triệt tiêu hoàn toàn rủi ro trùng lặp lệnh do mạng chập chờn hoặc tín hiệu webhook bắn lặp trong cửa sổ 60 giây. An toàn tuyệt đối 100%.
              </p>
              <div className="text-[10px] text-emerald-400 font-bold">● REDIS ATOMIC LOCK 60S</div>
            </div>
          </div>
        </div>
      </section>

      {/* Cloud Architecture Section */}
      <section id="architecture" className="py-20 px-6 border-t border-slate-800/80 bg-[#060a14]">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <h2 className="text-xs font-mono text-cyan-400 tracking-widest uppercase">KIẾN TRÚC THỰC THI TRỰC TIẾP</h2>
            <p className="text-2xl sm:text-4xl font-extrabold text-slate-100">Zero EA · Zero VPS · Direct-to-User</p>
          </div>

          <div className="p-8 rounded-2xl border border-slate-800 bg-[#0d1424] space-y-8 font-mono text-xs">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
              <div className="p-5 rounded-xl border border-slate-800/80 bg-slate-900/50 space-y-3">
                <div className="text-cyan-400 text-sm font-bold">BƯỚC 1: NHẬN DIỆN TÍN HIỆU</div>
                <div className="text-slate-300 font-sans">TradingView Webhook hoặc MetaApi Feed đẩy nến/giá thời gian thực vào Pipeline xử lý.</div>
              </div>
              <div className="p-5 rounded-xl border border-slate-800/80 bg-slate-900/50 space-y-3">
                <div className="text-amber-400 text-sm font-bold">BƯỚC 2: 4 MÀNG LỌC AN TOÀN</div>
                <div className="text-slate-300 font-sans">Kiểm tra SL bắt buộc, lọc tin tức USD ±15m, kiểm soát trượt giá và khóa chống trùng lệnh.</div>
              </div>
              <div className="p-5 rounded-xl border border-slate-800/80 bg-slate-900/50 space-y-3">
                <div className="text-emerald-400 text-sm font-bold">BƯỚC 3: BẮN LỆNH SONG SONG</div>
                <div className="text-slate-300 font-sans">Fan-out đồng loạt xuống toàn bộ tài khoản MT5 khách hàng qua MetaApi Cloud microsecond.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing / Tiers */}
      <section id="pricing" className="py-20 px-6 border-t border-slate-800/80 bg-[#060a14]">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-950/20 text-cyan-300 text-xs font-mono">
              BẢNG GIÁ MINH BẠCH · TỶ GIÁ THỰC TẾ
            </div>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-100">Gói Dịch Vụ & Hạ Tầng Cloud MT5</h2>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl mx-auto font-mono">
              Phí hạ tầng Cloud MT5 Bridge chỉ <strong className="text-cyan-300">$10/tháng/tài khoản</strong> (thay thế VPS). 
              Tất cả các gói đều được <strong className="text-emerald-400">tặng kèm 100% 4 Giáp Bảo Vệ An Toàn</strong>!
            </p>

            {/* Currency Toggle */}
            <div className="inline-flex items-center p-1 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs">
              <button
                onClick={() => setCurrency('VND')}
                className={`px-4 py-1.5 rounded-lg font-bold transition-all ${
                  currency === 'VND' ? 'bg-cyan-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                VNĐ (VietQR)
              </button>
              <button
                onClick={() => setCurrency('USD')}
                className={`px-4 py-1.5 rounded-lg font-bold transition-all ${
                  currency === 'USD' ? 'bg-cyan-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                USD ($)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono">
            {/* Starter Tier */}
            <div className="p-6 rounded-2xl border border-slate-800 bg-[#0d1424] space-y-5 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="text-xs font-bold text-slate-400 uppercase">Starter Trader</div>
                  <span className="text-[10px] text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40">Combo Cơ Bản</span>
                </div>
                <div className="space-y-1">
                  <div className="text-3xl font-black text-slate-100">
                    {formatPrice(30)}
                    <span className="text-xs text-slate-500 font-normal"> / tháng</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Gồm $10 Cloud Slot + $20 Tín Hiệu
                  </div>
                </div>
                <p className="text-xs text-slate-400 font-sans">
                  Phù hợp cho cá nhân mới bắt đầu, cần hệ thống giao dịch tự động hoàn toàn không cần cắm máy VPS.
                </p>
                <ul className="text-xs space-y-2 text-slate-300 border-t border-slate-800 pt-4">
                  <li className="text-emerald-400 font-bold">✓ TẶNG TRỌN BỘ 4 MÀNG BẢO VỆ AN TOÀN</li>
                  <li>✓ 1 Tài khoản MT5 Cloud chuyên dụng</li>
                  <li>✓ Khóa phân tán Redis chống trùng lệnh</li>
                  <li>✓ Né tin tức USD High-Impact (±15m)</li>
                  <li>✓ Chống trượt giá quá 20 pips</li>
                  <li>✓ Hệ số Lot tiêu chuẩn 1.0x</li>
                </ul>
              </div>
              <button
                onClick={onEnterApp}
                className="w-full py-3 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs text-slate-200 font-bold transition-colors"
              >
                Bắt Đầu Với Starter →
              </button>
            </div>

            {/* Growth Tier */}
            <div className="p-6 rounded-2xl border-2 border-cyan-500 bg-[#0d1829] space-y-5 shadow-[0_0_30px_rgba(6,182,212,0.15)] relative flex flex-col justify-between">
              <div className="absolute -top-3 right-5 px-2.5 py-0.5 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-bold">
                PHỔ BIẾN NHẤT
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="text-xs font-bold text-cyan-300 uppercase">Growth Multiplier</div>
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">Tối Ưu Vốn</span>
                </div>
                <div className="space-y-1">
                  <div className="text-3xl font-black text-slate-100">
                    {formatPrice(45)}
                    <span className="text-xs text-slate-500 font-normal"> / tháng</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Gồm $10 Cloud Slot + $35 Tín Hiệu
                  </div>
                </div>
                <p className="text-xs text-slate-400 font-sans">
                  Dành cho nhà giao dịch kinh nghiệm muốn nhân bản lợi nhuận với tính năng Tự Động Lãi Kép & Tùy biến đòn bẩy.
                </p>
                <ul className="text-xs space-y-2 text-slate-300 border-t border-slate-800 pt-4">
                  <li className="text-cyan-400 font-bold">✓ Đầy đủ đặc quyền gói Starter</li>
                  <li className="text-emerald-400 font-bold">✓ Tự Động Lãi Kép (Auto-Compounding)</li>
                  <li className="text-emerald-400 font-bold">✓ Tùy chỉnh Risk Multiplier (0.5x - 3.0x)</li>
                  <li>✓ Tối đa 3 Tài khoản MT5 kết nối song song</li>
                  <li>✓ Tự động dời Stop Loss về Hòa Vốn (Break-Even)</li>
                  <li>✓ Chốt lời từng phần (Partial Take Profit)</li>
                </ul>
              </div>
              <button
                onClick={onEnterApp}
                className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-xs text-slate-950 font-bold transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)]"
              >
                Đăng Ký Gói Growth →
              </button>
            </div>

            {/* Prop Firm Alpha Tier */}
            <div className="p-6 rounded-2xl border border-purple-500/50 bg-[#0d1424] space-y-5 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="text-xs font-bold text-purple-400 uppercase">Prop Firm Alpha</div>
                  <span className="text-[10px] text-purple-400 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800/40">Chuyên Nghiệp</span>
                </div>
                <div className="space-y-1">
                  <div className="text-3xl font-black text-slate-100">
                    {formatPrice(59)}
                    <span className="text-xs text-slate-500 font-normal"> / tháng</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Gồm $10 Cloud Slot + $49 Tín Hiệu
                  </div>
                </div>
                <p className="text-xs text-slate-400 font-sans">
                  Giải pháp tối thượng cho Trader thi quỹ (MFF, FTMO) với tính năng bảo vệ sụt giảm tài khoản nghiêm ngặt.
                </p>
                <ul className="text-xs space-y-2 text-slate-300 border-t border-slate-800 pt-4">
                  <li className="text-purple-400 font-bold">✓ Đầy đủ đặc quyền gói Growth</li>
                  <li className="text-purple-400 font-bold">✓ Chế Độ Thi Quỹ Pass Guard (Daily DD 4.5%)</li>
                  <li className="text-purple-400 font-bold">✓ Mục tiêu lợi nhuận tự động 8.0% chốt target</li>
                  <li>✓ Tối đa 5 Tài khoản MT5 kết nối đồng thời</li>
                  <li>✓ Truy cập chiến lược Alpha Quant cao cấp</li>
                  <li>✓ Hỗ trợ kỹ thuật 1-1 chuyên sâu từ Quant Team</li>
                </ul>
              </div>
              <button
                onClick={onEnterApp}
                className="w-full py-3 rounded-xl border border-purple-700 bg-purple-950/40 hover:bg-purple-900/60 text-xs text-purple-200 font-bold transition-colors"
              >
                Kích Hoạt Prop Firm Alpha →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-10 px-6 font-mono text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-bold text-slate-300 text-sm">ZUPIRUS QUANT LAB</div>
            <div className="text-[11px] text-slate-500 mt-1">100% Direct Cloud MT5 Execution · SePay VietQR Automatic Fulfillment.</div>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-emerald-400 font-bold">● FAIL-CLOSED SECURITY ACTIVE</span>
            <span className="text-cyan-400 font-bold">● 4 SAFETY GUARDS VERIFIED</span>
            <span>© 2026 ZUPIRUS</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
