import React from 'react';
import { IconClose, IconBolt, IconShield, IconSpark, IconReceipt } from './Icons';

export const LandingComparisonSection: React.FC = () => {
  return (
    <div className="space-y-16">
      {/* SECTION 2A: 4 CORE VALUE COLUMNS */}
      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: <IconBolt className="w-5 h-5 text-[#12B5A6]" />,
            metric: '24ms LD4',
            title: 'Hạ Tầng Cloud MT5',
            desc: 'Không cần thuê máy chủ Windows VPS hay cài đặt EA. Kết nối trực tiếp qua tài khoản MT5 của bạn.',
          },
          {
            icon: <IconShield className="w-5 h-5 text-[#12B5A6]" />,
            metric: '100% SL Cứng',
            title: '4 Lớp Giáp Bảo Vệ Vốn',
            desc: 'Từ chối mọi tín hiệu thiếu mức dừng lỗ. Tuyệt đối không Martingale hay gồng lỗ qua tin đỏ.',
          },
          {
            icon: <IconSpark className="w-5 h-5 text-[#12B5A6]" />,
            metric: 'Chuẩn Hóa Lot',
            title: 'Hỗ Trợ Mọi Loại Tài Khoản',
            desc: 'Tự động tính quy mô hợp đồng cho Standard, Cent USC và khóa trần rủi ro 1% với Quỹ Prop Live.',
          },
          {
            icon: <IconReceipt className="w-5 h-5 text-[#12B5A6]" />,
            metric: '3 Giây VietQR',
            title: 'Kích Hoạt Tự Động 24/7',
            desc: 'Chốt tỷ giá USD/VND thời gian thực và nâng hạn mức Cloud MT5 ngay lập tức khi quét mã SePay.',
          },
        ].map((card, idx) => (
          <div
            key={idx}
            className="rounded-2xl border border-slate-800/70 bg-[#10192B] p-6 hover:border-slate-700 transition-colors flex flex-col justify-between space-y-4"
          >
            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-800 bg-[#080E1A]">
                  {card.icon}
                </div>
                <span className="font-mono text-xl font-bold text-slate-100 tabular-nums">
                  {card.metric}
                </span>
              </div>
              <h3 className="mt-4 text-base font-bold text-white">{card.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-[#94A3B8]">{card.desc}</p>
            </div>
          </div>
        ))}
      </section>

      {/* SECTION 2B: SO SÁNH 2 CỘT & QUY TRÌNH 3 BƯỚC */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left (7 Cols): 2-Column Comparison */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-6 sm:p-8 lg:col-span-7 space-y-6">
          <div>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
              SO SÁNH THỰC TẾ
            </span>
            <h2 className="mt-1 text-2xl font-bold text-white">
              Vì Sao Trader Chọn ZUPIRUS Thay Vì Copy Bot Thường?
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
            <div className="rounded-xl border border-slate-800/80 bg-[#080E1A] p-5 space-y-3">
              <div className="inline-flex items-center gap-1.5 font-mono font-bold text-rose-400 uppercase">
                <IconClose className="w-4 h-4" />
                Tự Trade / Bot VPS Thường
              </div>
              <ul className="space-y-2.5 text-slate-400">
                <li className="flex items-start gap-2">
                  <span className="text-rose-500 font-bold shrink-0">✕</span>
                  <span>Tốn $8-$15/tháng tiền VPS, phần mềm EA dễ đứt mạng.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-rose-500 font-bold shrink-0">✕</span>
                  <span>Dễ gồng lỗ hoặc quên đặt Stop Loss khi thị trường biến động.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-rose-500 font-bold shrink-0">✕</span>
                  <span>Dính trượt giá quét 2 đầu khi tin tức NFP, CPI công bố.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-rose-500 font-bold shrink-0">✕</span>
                  <span>Vi phạm luật sụt giảm ngày (Daily DD 5%) khi thi quỹ Prop.</span>
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-[#12B5A6]/40 bg-[#080E1A] p-5 space-y-3">
              <div className="inline-flex items-center gap-1.5 font-mono font-bold text-[#12B5A6] uppercase">
                <span>✓</span>
                ZUPIRUS Cloud Quant
              </div>
              <ul className="space-y-2.5 text-slate-300">
                <li className="flex items-start gap-2">
                  <span className="text-[#12B5A6] font-bold shrink-0">✓</span>
                  <span>Vận hành Cloud London G2 24/7 — zero cài đặt, zero VPS.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#12B5A6] font-bold shrink-0">✓</span>
                  <span>Bắt buộc SL cứng trên sàn, khóa trần rủi ro 1,0% với Prop Live.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#12B5A6] font-bold shrink-0">✓</span>
                  <span>Tự động dời hòa vốn (+1R) và bảo toàn vị thế khi có lãi.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#12B5A6] font-bold shrink-0">✓</span>
                  <span>News Shield phong tỏa tin đỏ USD ±15p &amp; tự ngắt khi chuỗi lỗ.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Right (5 Cols): 3-Step Process */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-6 sm:p-8 lg:col-span-5 space-y-6">
          <div>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#F5B700]">
              BẮT ĐẦU TRONG 2 PHÚT
            </span>
            <h2 className="mt-1 text-2xl font-bold text-white">Quy Trình 3 Bước Đơn Giản</h2>
          </div>

          <div className="space-y-3.5 text-xs">
            {[
              {
                step: '01',
                title: 'Đăng Ký & Xác Thực OTP (30s)',
                desc: 'Tạo tài khoản bảo mật qua email, tiền nằm 100% tại sàn MT5 của bạn.',
              },
              {
                step: '02',
                title: 'Chọn Gói & Quét VietQR SePay',
                desc: 'Hệ thống tự động kích hoạt hạn mức Cloud MT5 chỉ sau 3 giây thanh toán.',
              },
              {
                step: '03',
                title: 'Kết Nối MT5 — Hệ Thống Tự Chạy',
                desc: 'Hệ thống tự chia Lot và đặt cắt lỗ ngày an toàn theo kỷ luật quỹ định lượng.',
              },
            ].map((s) => (
              <div
                key={s.step}
                className="flex items-start gap-3.5 rounded-xl border border-slate-800/70 bg-[#080E1A] p-4"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#12B5A6]/15 font-mono text-xs font-bold text-[#12B5A6]">
                  {s.step}
                </span>
                <div>
                  <div className="font-bold text-white">{s.title}</div>
                  <div className="mt-1 text-slate-400 leading-relaxed">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
