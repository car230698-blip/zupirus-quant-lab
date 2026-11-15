import React from 'react';

interface LandingPageProps {
  onEnterApp: () => void;
  onEnterAdmin: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onEnterApp, onEnterAdmin }) => {
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
            <a href="#features" className="hover:text-cyan-400 transition-colors">Công Nghệ Cốt Lõi</a>
            <a href="#swarm" className="hover:text-cyan-400 transition-colors">Biệt Đội AI Swarm</a>
            <a href="#universe" className="hover:text-cyan-400 transition-colors">Không Gian Giao Dịch</a>
            <a href="#pricing" className="hover:text-cyan-400 transition-colors">Gói Nền Tảng</a>
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
              Vào Ứng Dụng (App) ↗
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-24 pb-20 px-6 overflow-hidden">
        {/* Glow Effects */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-1/3 right-1/4 w-[400px] h-[300px] bg-purple-500/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center space-y-6 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-950/30 text-cyan-300 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            ZUPIRUS QUANT LAB 2026 · HỆ THỐNG GIAO DỊCH ĐỊNH LƯỢNG TỰ HÀNH
          </div>

          <h1 className="text-4xl sm:text-6xl font-black text-slate-100 tracking-tight leading-tight sm:leading-none">
            Nền Tảng Định Lượng <br />
            <span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
              Nến Đóng & Biệt Đội AI Swarm
            </span>
          </h1>

          <p className="max-w-2xl mx-auto text-sm sm:text-base text-slate-400 font-normal leading-relaxed">
            Loại bỏ 100% cảm tính. Thực thi tín hiệu chuẩn xác trên nến đã đóng, điều phối rủi ro qua 
            khóa phân tán Redis, bộ nhớ dài hạn Hindsight và cơ chế ngắt lệnh tự động khi tin tức kinh tế biến động mạnh.
          </p>

          <div className="pt-4 flex flex-wrap items-center justify-center gap-4 font-mono text-xs">
            <button
              onClick={onEnterApp}
              className="px-6 py-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm transition-all shadow-[0_0_25px_rgba(6,182,212,0.4)] flex items-center gap-2"
            >
              <span>Trải Nghiệm Nền Tảng (app.zupirus.com)</span>
              <span>→</span>
            </button>
            <button
              onClick={onEnterAdmin}
              className="px-5 py-3.5 rounded-xl border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-200 transition-colors"
            >
              Điều Hành Hệ Thống (adm.zupirus.com)
            </button>
          </div>

          {/* Quick Stats Bar */}
          <div className="pt-12 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-4xl mx-auto font-mono text-left">
            <div className="p-4 rounded-xl border border-slate-800 bg-[#0d1424]/60 backdrop-blur">
              <div className="text-[11px] text-slate-400">ĐỘ TRỄ THỰC THI</div>
              <div className="text-lg font-bold text-cyan-300 mt-1">&lt; 15ms</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Khóa phân tán Redis</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-[#0d1424]/60 backdrop-blur">
              <div className="text-[11px] text-slate-400">CHUẨN TÍN HIỆU</div>
              <div className="text-lg font-bold text-emerald-400 mt-1">100% Nến Đóng</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Triệt tiêu hoàn toàn repaint</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-[#0d1424]/60 backdrop-blur">
              <div className="text-[11px] text-slate-400">BẢO VỆ TIN TỨC</div>
              <div className="text-lg font-bold text-amber-300 mt-1">±15 Phút Chặn</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Tự động đồng bộ ForexFactory</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-[#0d1424]/60 backdrop-blur">
              <div className="text-[11px] text-slate-400">AI AGENT SWARM</div>
              <div className="text-lg font-bold text-purple-300 mt-1">3 Tác Nhân Tự Hành</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Hindsight Memory + Gemini Pool</div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Technology Features */}
      <section id="features" className="py-20 px-6 border-t border-slate-800/80 bg-[#080d1a]">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <h2 className="text-xs font-mono text-cyan-400 tracking-widest uppercase">CÔNG NGHỆ CỐT LÕI</h2>
            <p className="text-2xl sm:text-3xl font-extrabold text-slate-100">
              Kiến Trúc Định Lượng Chuẩn Mực Tổ Chức
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs">
            {/* Feature 1 */}
            <div className="p-6 rounded-2xl border border-slate-800 bg-[#0d1424] space-y-4 hover:border-cyan-500/50 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-800 flex items-center justify-center text-cyan-300 text-lg">
                ◈
              </div>
              <h3 className="font-bold text-sm text-slate-100">Kỷ Luật Nến Đóng (Closed Candles)</h3>
              <p className="text-slate-400 text-[11px] leading-relaxed font-sans">
                Thuật toán chỉ tính toán và kích hoạt tín hiệu khi nến M15/H1 đã kết thúc và đóng hoàn toàn. 
                Nói không với tín hiệu ảo giữa nến hay hiện tượng vẽ lại chỉ báo.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-6 rounded-2xl border border-slate-800 bg-[#0d1424] space-y-4 hover:border-purple-500/50 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-purple-950/80 border border-purple-800 flex items-center justify-center text-purple-300 text-lg">
                🧠
              </div>
              <h3 className="font-bold text-sm text-slate-100">Hindsight Memory Engine</h3>
              <p className="text-slate-400 text-[11px] leading-relaxed font-sans">
                Tích hợp công nghệ bộ nhớ dài hạn 3 tầng (Episodic - Sự kiện, Semantic - Quy tắc, Reflective - Đúc kết kinh nghiệm) 
                giúp AI trợ lý luôn duy trì nhận thức nhất quán qua từng phiên giao dịch.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-6 rounded-2xl border border-slate-800 bg-[#0d1424] space-y-4 hover:border-emerald-500/50 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-emerald-950/80 border border-emerald-800 flex items-center justify-center text-emerald-300 text-lg">
                ⚡
              </div>
              <h3 className="font-bold text-sm text-slate-100">Phân Bổ Vốn ATR & Half-Kelly</h3>
              <p className="text-slate-400 text-[11px] leading-relaxed font-sans">
                Khối lượng giao dịch được tính toán động theo độ biến động thực tế ATR và hệ số Half-Kelly, 
                tự động siết chặt rủi ro và giới hạn tối đa 5% Drawdown toàn danh mục.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Autonomous Swarm Section */}
      <section id="swarm" className="py-20 px-6 border-t border-slate-800/80 bg-[#060a14]">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <h2 className="text-xs font-mono text-purple-400 tracking-widest uppercase">ĐỘI NGŨ AI AGENT TỰ HÀNH</h2>
            <p className="text-2xl sm:text-3xl font-extrabold text-slate-100">
              3 Tác Nhân Chuyên Biệt Điều Phối 24/7
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs">
            <div className="p-5 rounded-xl border border-amber-500/40 bg-[#0d1829] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-300 text-sm">🛡️ Sentinel Agent</span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-amber-950 border border-amber-700 text-amber-300 font-bold">GIÁM SÁT VĨ MÔ</span>
              </div>
              <p className="text-slate-300 text-[11px] font-sans">
                Quét liên tục lịch tin kinh tế toàn cầu, phân tích cảm xúc thị trường bằng Gemini API pool và kích hoạt 
                cửa sổ chặn lệnh ±15 phút trước các tin tức nóng như CPI, Non-Farm, FOMC.
              </p>
            </div>

            <div className="p-5 rounded-xl border border-cyan-500/40 bg-[#0d1829] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-cyan-300 text-sm">📈 Alpha Agent</span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-950 border border-cyan-700 text-cyan-300 font-bold">TỐI ƯU CHIẾN LƯỢC</span>
              </div>
              <p className="text-slate-300 text-[11px] font-sans">
                Kiểm định liên tục không gian tham số trên nến lịch sử bằng Walk-Forward Optimization (WFO), 
                sàng lọc các cặp tham số có Sharpe &gt; 1.2 và chuyển ứng viên vào hàng đợi duyệt của Admin.
              </p>
            </div>

            <div className="p-5 rounded-xl border border-emerald-500/40 bg-[#0d1829] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-300 text-sm">⚖️ Risk Guardian Agent</span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950 border border-emerald-700 text-emerald-300 font-bold">BẢO VỆ VỐN THỰC THỜI</span>
              </div>
              <p className="text-slate-300 text-[11px] font-sans">
                Tính toán Value-at-Risk (VaR 99%) và chạy mô phỏng Monte Carlo 10,000 kịch bản ngẫu nhiên. 
                Tự động ngắt khẩn cấp (Kill Switch) nếu đòn bẩy hoặc mức sụt giảm vốn vượt ngưỡng an toàn.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Multi-Asset Universe */}
      <section id="universe" className="py-20 px-6 border-t border-slate-800/80 bg-[#080d1a]">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-xs font-mono text-cyan-400 tracking-widest uppercase">KHÔNG GIAN GIAO DỊCH (UNIVERSE)</h2>
              <p className="text-2xl font-extrabold text-slate-100 mt-1">Multi-Asset Market Scanner</p>
            </div>
            <div className="text-xs font-mono text-slate-400">
              Cập nhật chu kỳ: <span className="text-emerald-400">M15 Closed Candles</span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0d1424]">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-3">Cặp Tài Sản</th>
                  <th className="p-3">Phân Lớp</th>
                  <th className="p-3">ATR M15</th>
                  <th className="p-3">Chế Độ Thị Trường</th>
                  <th className="p-3">Chiến Lược Tương Thích</th>
                  <th className="p-3 text-right">Khuyến Nghị SL/TP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                <tr>
                  <td className="p-3 font-bold text-cyan-300">XAUUSD</td>
                  <td className="p-3 text-slate-400">Hàng Hóa (Vàng)</td>
                  <td className="p-3">3.80 pts</td>
                  <td className="p-3"><span className="text-emerald-400">● Trend Continuation</span></td>
                  <td className="p-3">Trend Following SMA(5/20)</td>
                  <td className="p-3 text-right text-slate-300">SL: 6.0 / TP: 12.0 pts</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold text-cyan-300">EURUSD</td>
                  <td className="p-3 text-slate-400">Ngoại Hối Chính</td>
                  <td className="p-3">0.0018 pts</td>
                  <td className="p-3"><span className="text-blue-400">● Low Volatility Range</span></td>
                  <td className="p-3">Mean Reversion (Bollinger + RSI)</td>
                  <td className="p-3 text-right text-slate-300">SL: 27 / TP: 54 pips</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold text-cyan-300">GBPUSD</td>
                  <td className="p-3 text-slate-400">Ngoại Hối Chính</td>
                  <td className="p-3">0.0026 pts</td>
                  <td className="p-3"><span className="text-emerald-400">● Trend Continuation</span></td>
                  <td className="p-3">Trend Following</td>
                  <td className="p-3 text-right text-slate-300">SL: 39 / TP: 78 pips</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold text-cyan-300">USDJPY</td>
                  <td className="p-3 text-slate-400">Ngoại Hối Chính</td>
                  <td className="p-3">0.220 pts</td>
                  <td className="p-3"><span className="text-blue-400">● Range Bound</span></td>
                  <td className="p-3">Mean Reversion</td>
                  <td className="p-3 text-right text-slate-300">SL: 33 / TP: 66 pips</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold text-cyan-300">BTCUSD</td>
                  <td className="p-3 text-slate-400">Tiền Kỹ Thuật Số</td>
                  <td className="p-3">420.0 pts</td>
                  <td className="p-3"><span className="text-purple-400">● High Volatility Breakout</span></td>
                  <td className="p-3">Donchian Breakout + ATR</td>
                  <td className="p-3 text-right text-slate-300">SL: 840 / TP: 1680 pts</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Pricing / Tiers */}
      <section id="pricing" className="py-20 px-6 border-t border-slate-800/80 bg-[#060a14]">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <h2 className="text-xs font-mono text-cyan-400 tracking-widest uppercase">GÓI NỀN TẢNG</h2>
            <p className="text-2xl sm:text-3xl font-extrabold text-slate-100">Lựa Chọn Giải Pháp Phù Hợp</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono">
            {/* Tier 1 */}
            <div className="p-6 rounded-2xl border border-slate-800 bg-[#0d1424] space-y-5">
              <div className="text-xs font-bold text-slate-400 uppercase">Standard Trader</div>
              <div className="text-3xl font-black text-slate-100">$0<span className="text-xs text-slate-500 font-normal"> / trọn đời</span></div>
              <p className="text-xs text-slate-400 font-sans">Dành cho nhà giao dịch cá nhân kết nối tài khoản MT5 sàn và trải nghiệm phân tích nến đóng thời gian thực.</p>
              <ul className="text-xs space-y-2 text-slate-300 border-t border-slate-800 pt-4">
                <li>✓ Kết nối 1 tài khoản MT5 sàn thực tế</li>
                <li>✓ Biểu đồ nến TimescaleDB M15 Real-Time</li>
                <li>✓ Trợ lý AI định lượng ZUPIRUS Copilot</li>
              </ul>
              <button onClick={onEnterApp} className="w-full py-2.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs text-slate-200 font-bold transition-colors">
                Bắt Đầu Ngay
              </button>
            </div>

            {/* Tier 2 */}
            <div className="p-6 rounded-2xl border-2 border-cyan-500 bg-[#0d1829] space-y-5 shadow-[0_0_30px_rgba(6,182,212,0.15)] relative">
              <div className="absolute -top-3 right-5 px-2.5 py-0.5 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-bold">PHỔ BIẾN NHẤT</div>
              <div className="text-xs font-bold text-cyan-300 uppercase">Quant Pro Trader</div>
              <div className="text-3xl font-black text-slate-100">4.900.000₫<span className="text-xs text-slate-500 font-normal"> / tháng</span></div>
              <p className="text-xs text-slate-400 font-sans">Dành cho nhà đầu tư kết nối tài khoản MT5 nhận lệnh tự động trực tiếp từ Quant Engine qua Cloud API.</p>
              <ul className="text-xs space-y-2 text-slate-300 border-t border-slate-800 pt-4">
                <li>✓ 100% Cloud MT5 Direct Execution (Zero EA, Zero VPS)</li>
                <li>✓ Phân bổ lệnh song song qua MetaApi microsecond</li>
                <li>✓ Cửa sổ bảo vệ tin tức tự động ±15m (CPI, NFP, FED)</li>
                <li>✓ Bộ nhớ Hindsight & Gemini API cá nhân hóa</li>
              </ul>
              <button onClick={onEnterApp} className="w-full py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-xs text-slate-950 font-bold transition-colors">
                Đăng Ký Quant Pro
              </button>
            </div>

            {/* Tier 3 */}
            <div className="p-6 rounded-2xl border border-slate-800 bg-[#0d1424] space-y-5">
              <div className="text-xs font-bold text-purple-400 uppercase">Prop & Institutional</div>
              <div className="text-3xl font-black text-slate-100">22.500.000₫<span className="text-xs text-slate-500 font-normal"> / tháng</span></div>
              <p className="text-xs text-slate-400 font-sans">Dành cho quỹ định lượng và nhà quản lý vốn tư nhân cần cụm Multi-Agent Swarm tự hành độc quyền.</p>
              <ul className="text-xs space-y-2 text-slate-300 border-t border-slate-800 pt-4">
                <li>✓ Đầy đủ cụm 3 Agent Swarm (Sentinel, Alpha, Risk)</li>
                <li>✓ Cổng quản trị phân quyền Admin riêng biệt</li>
                <li>✓ Giám sát rủi ro VaR 99% & Monte Carlo 10K</li>
                <li>✓ Hỗ trợ kỹ thuật chuyên sâu & Webhook riêng</li>
              </ul>
              <button onClick={onEnterAdmin} className="w-full py-2.5 rounded-lg border border-purple-800 bg-purple-950/40 hover:bg-purple-900/60 text-xs text-purple-200 font-bold transition-colors">
                Liên Hệ Quản Trị
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
            <div className="text-[11px] text-slate-500 mt-1">Hệ Thống Giao Dịch Định Lượng Tự Hành & Quản Trị Rủi Ro Chuyên Nghiệp.</div>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-emerald-400 font-bold">● FAIL-CLOSED SECURITY ACTIVE</span>
            <span className="text-cyan-400 font-bold">● MT5 PRODUCTION READY</span>
            <span>© 2026 ZUPIRUS</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

