import React from 'react';
import { IconClose } from './Icons';

export const LandingComparisonSection: React.FC = () => {
  return (
    <>
      {/* SECTION 2: ARCHITECTURAL HARD PILLARS */}
      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            tag: '01 // CLOUD G2 LOW-LATENCY',
            metric: '24ms LD4 Direct',
            title: 'Hạ Tầng Cloud MT5',
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
              <div className="inline-flex items-center gap-1.5 font-mono font-bold text-rose-300 uppercase">
                <IconClose className="w-4 h-4" />
                Tự Trade / Bot VPS Thường
              </div>
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
                <li>• SL cứng bắt buộc mọi lệnh, trần rủi ro 1,0% mỗi ý tưởng cho Prop Firm Live.</li>
                <li>• Tự động quy đổi contract size tài khoản Cent/USC, tự dời BE (+1R) &amp; chốt TP1.</li>
                <li>• News Shield phong tỏa tin đỏ USD ±15 phút &amp; tự ngắt khi chuỗi 4 tín hiệu AI thua liên tiếp.</li>
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
    </>
  );
};
