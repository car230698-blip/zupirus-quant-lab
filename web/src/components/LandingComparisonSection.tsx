import React from 'react';
import { motion } from 'motion/react';
import { SpotlightBento } from './ui/SpotlightBento';
import { Server, ShieldCheck, Scale, Zap, Check, X } from 'lucide-react';

export const LandingComparisonSection: React.FC = () => {
  const pillars = [
    {
      icon: <Server className="w-5 h-5 text-[#12B5A6]" strokeWidth={1.75} />,
      metric: '0 VPS',
      isTeal: true,
      title: 'Kết nối Cloud trực tiếp',
      desc: 'Đồng bộ thẳng tài khoản MT5 qua đám mây với mật khẩu mã hóa AES-256. Tiền nằm 100% tại sàn của bạn.',
    },
    {
      icon: <ShieldCheck className="w-5 h-5 text-[#12B5A6]" strokeWidth={1.75} />,
      metric: '100% SL',
      isTeal: false,
      title: 'Từ chối lệnh thiếu dừng lỗ',
      desc: 'Mọi tín hiệu không có Stop-Loss cứng hoặc vượt biên độ ATR đều bị hủy ngay tại cổng kiểm soát.',
    },
    {
      icon: <Scale className="w-5 h-5 text-[#12B5A6]" strokeWidth={1.75} />,
      metric: '1.0%',
      isTeal: false,
      title: 'Chuẩn kỷ luật Prop Live',
      desc: 'Cộng dồn rủi ro mọi lệnh mở cùng ý tưởng ở mức tối đa 1% và tổng danh mục không vượt quá 2%.',
    },
    {
      icon: <Zap className="w-5 h-5 text-[#12B5A6]" strokeWidth={1.75} />,
      metric: '3 Giây',
      isTeal: false,
      title: 'Kích hoạt SePay VietQR',
      desc: 'Tự động đối khớp giao dịch 24/7, nâng cấp gói và mở khóa khe cắm tài khoản MT5 tức thì.',
    },
  ];

  return (
    <div className="space-y-16">
      {/* SECTION 2A: 4 OPEN PILLARS (Unboxed, Elegant Linear Style) */}
      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {pillars.map((card, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.45, delay: idx * 0.1 }}
            className="group relative border-t border-white/15 hover:border-[#12B5A6] pt-5 pb-2 transition-all duration-300"
          >
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                {card.icon}
              </div>
              <span className={`font-mono text-2xl font-bold tabular-nums ${card.isTeal ? 'text-[#12B5A6]' : 'text-white'}`}>
                {card.metric}
              </span>
            </div>
            <h3 className="mt-4 text-base font-bold text-white group-hover:text-[#12B5A6] transition-colors">
              {card.title}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-[#94A3B8]">{card.desc}</p>
          </motion.div>
        ))}
      </section>

      {/* SECTION 2B: SO SÁNH 2 CỘT & QUY TRÌNH 3 BƯỚC */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left (7 Cols): 2-Column Comparison */}
        <div className="lg:col-span-7">
          <SpotlightBento className="p-6 sm:p-8 space-y-6 h-full">
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
                SO SÁNH THỰC TẾ
              </span>
              <h2 className="mt-1 text-2xl font-bold text-white tracking-tight">
                Vì Sao Trader Chọn ZUPIRUS Thay Vì Copy Bot Thường?
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
              <div className="rounded-xl border border-rose-500/25 bg-rose-950/15 p-5 space-y-3">
                <div className="inline-flex items-center gap-1.5 font-mono font-bold text-rose-400 uppercase">
                  <X className="w-4 h-4" />
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

              <div className="rounded-xl border border-[#12B5A6]/40 bg-[#12B5A6]/10 p-5 space-y-3">
                <div className="inline-flex items-center gap-1.5 font-mono font-bold text-[#12B5A6] uppercase">
                  <Check className="w-4 h-4" />
                  ZUPIRUS Cloud Quant
                </div>
                <ul className="space-y-2.5 text-slate-200">
                  <li className="flex items-start gap-2">
                    <span className="text-[#12B5A6] font-bold shrink-0">✓</span>
                    <span>Vận hành Cloud London G2 24/7 — zero cài đặt, zero VPS.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#12B5A6] font-bold shrink-0">✓</span>
                    <span>Bắt buộc SL cứng trên sàn, khóa trần rủi ro 1.0% với Prop Live.</span>
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
          </SpotlightBento>
        </div>

        {/* Right (5 Cols): 3-Step Process */}
        <div className="lg:col-span-5">
          <SpotlightBento className="p-6 sm:p-8 space-y-6 h-full">
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#F5B700]">
                BẮT ĐẦU TRONG 2 PHÚT
              </span>
              <h2 className="mt-1 text-2xl font-bold text-white tracking-tight">Quy Trình 3 Bước Đơn Giản</h2>
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
                  className="flex items-start gap-3.5 rounded-xl border border-white/[0.08] bg-[#070D1C]/80 p-4"
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
          </SpotlightBento>
        </div>
      </section>
    </div>
  );
};
