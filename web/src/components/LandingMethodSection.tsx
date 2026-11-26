import React from 'react';
import { Database, BarChart3, FileText, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

const STEPS_VI = [
  { icon: Database, title: '1. Dữ liệu giá công khai', desc: 'Lấy nến lịch sử (ví dụ Yahoo Finance) cho từng cặp và khung thời gian. Ghi rõ nguồn, số nến và khoảng thời gian.' },
  { icon: BarChart3, title: '2. Thống kê định lượng', desc: 'Đo hành vi theo phiên, biến động, mùa vụ, phá biên và kiểm tra lại từng quy tắc, có tính chi phí giả định. Cùng dữ liệu luôn ra cùng kết quả.' },
  { icon: FileText, title: '3. Đúc kết thành phương pháp PDF', desc: 'Kết quả được viết thành một phương pháp đọc thị trường, có bảng, biểu đồ, mức sụt giảm trên mẫu và cảnh báo rủi ro. Có bản đọc thử miễn phí.' },
  { icon: ShieldCheck, title: '4. Bạn tự quyết định', desc: 'ZUPIRUS không vào lệnh thay bạn, không kết nối tài khoản, không giữ tiền và không cam kết lợi nhuận. Bạn đọc, kiểm chứng và tự chịu rủi ro.' },
];
const STEPS_EN = [
  { icon: Database, title: '1. Public price data', desc: 'Historical candles (e.g. Yahoo Finance) for each market and timeframe, with the source, candle count and date range stated.' },
  { icon: BarChart3, title: '2. Quantitative statistics', desc: 'Session behaviour, volatility regimes, seasonality, range breakouts and rule backtests with an assumed cost model. The same data always gives the same numbers.' },
  { icon: FileText, title: '3. Distilled into a PDF method', desc: 'Results are written up as a market-reading method with tables, charts, in-sample drawdown and a risk disclaimer. Every guide has a free preview.' },
  { icon: ShieldCheck, title: '4. You decide', desc: 'ZUPIRUS does not trade for you, does not connect to your account, does not hold funds and does not promise profit. You read, verify and carry your own risk.' },
];

export const LandingMethodSection: React.FC = () => {
  const { lang } = useLanguage();
  const steps = lang === 'en' ? STEPS_EN : STEPS_VI;
  return (
    <section id="pipeline" className="space-y-8">
      <div className="text-center space-y-3">
        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#12B5A6]">
          {lang === 'en' ? 'HOW A GUIDE IS MADE' : 'QUY TRÌNH LÀM MỘT ẤN PHẨM'}
        </span>
        <h2 className="text-3xl lg:text-4xl font-bold text-white tracking-tight">
          {lang === 'en' ? 'From data to a method you can check' : 'Từ dữ liệu đến phương pháp bạn tự kiểm chứng được'}
        </h2>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="rounded-2xl border border-slate-800/80 bg-[#0B1322]/80 p-5 space-y-3 text-left">
            <Icon className="h-6 w-6 text-[#12B5A6]" strokeWidth={1.8} />
            <h3 className="text-sm font-bold text-white">{title}</h3>
            <p className="text-xs leading-relaxed text-slate-400">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
};
