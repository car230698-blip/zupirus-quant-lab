import React, { useState } from 'react';
import { IconClose, IconSpark, IconShield, IconSearch } from './Icons';

export interface VipBook {
  id: string;
  title: string;
  category: 'SMC' | 'PRICE_ACTION' | 'RISK_MGMT' | 'GOLD_MACRO' | 'PATTERNS';
  categoryLabel: string;
  categoryColor: string;
  badge: string;
  filename: string;
  description: string;
  pages: string;
}

export const VIP_BOOKS: VipBook[] = [
  {
    id: 'book-1',
    title: 'Đa Khung Thời Gian H1 → M15 / M5',
    category: 'PRICE_ACTION',
    categoryLabel: 'Price Action',
    categoryColor: 'from-amber-500/20 to-amber-600/10 text-amber-300 border-amber-500/30',
    badge: 'TOP-DOWN BIAS',
    filename: 'Da_khung_thoi_gian_H1_M15_M5.pdf',
    description: 'Quy trình phân tích đa khung thời gian: Xác định xu hướng H1, khoanh vùng POI trên M15 và bóp Entry tại M5.',
    pages: 'Cẩm nang thực chiến',
  },
  {
    id: 'book-2',
    title: 'Nhật Ký & Checklist Giao Dịch',
    category: 'RISK_MGMT',
    categoryLabel: 'Quản Trị Vốn',
    categoryColor: 'from-emerald-500/20 to-emerald-600/10 text-emerald-300 border-emerald-500/30',
    badge: 'KỶ LUẬT THÉP',
    filename: 'Nhat_ky_checklist_giao_dich.pdf',
    description: 'Bộ biểu mẫu kế hoạch trước phiên, bảng kiểm tra 7 bước trước khi bấm lệnh và sổ theo dõi backtest chuẩn Quỹ.',
    pages: 'Biểu mẫu & Checklist',
  },
  {
    id: 'book-3',
    title: 'Phá Vỡ Thật vs Fakeout (Bẫy Quét)',
    category: 'PRICE_ACTION',
    categoryLabel: 'Price Action',
    categoryColor: 'from-amber-500/20 to-amber-600/10 text-amber-300 border-amber-500/30',
    badge: 'BREAKOUT FILTER',
    filename: 'Pha_vo_that_vs_fakeout.pdf',
    description: 'Cách phân biệt phá vỡ thực tế và bẫy phá vỡ giả (Trap). Tín hiệu xác nhận khối lượng và hành vi nến Retest.',
    pages: 'Chuyên đề bẫy giá',
  },
  {
    id: 'book-4',
    title: 'Phiên London / New York & Giờ Vàng',
    category: 'GOLD_MACRO',
    categoryLabel: 'Phiên & Thời Gian',
    categoryColor: 'from-cyan-500/20 to-cyan-600/10 text-cyan-300 border-cyan-500/30',
    badge: 'KILLZONE TIMING',
    filename: 'Phien_London_New_York_gio_vang.pdf',
    description: 'Bản đồ múi giờ GMT+7 các phiên giao dịch, các vùng Killzone phiên Âu - Mỹ và thời khắc vàng của Vàng XAU/USD.',
    pages: 'Giờ vàng giao dịch',
  },
  {
    id: 'book-5',
    title: 'Sổ Tay 100 Thuật Ngữ Forex Bỏ Túi',
    category: 'PRICE_ACTION',
    categoryLabel: 'Thuật Ngữ',
    categoryColor: 'from-purple-500/20 to-purple-600/10 text-purple-300 border-purple-500/30',
    badge: 'TRA CỨU NHANH',
    filename: 'So_tay_100_thuat_ngu_Forex.pdf',
    description: '100 thuật ngữ tài chính - ngoại hối Anh - Việt giải thích xúc tích: Pip, Spread, Margin, Slippage, Drawdown, FVG...',
    pages: '100 Thuật ngữ',
  },
  {
    id: 'book-6',
    title: 'Giao Dịch Vàng XAU/USD Chuyên Sâu',
    category: 'GOLD_MACRO',
    categoryLabel: 'Vàng XAU/USD',
    categoryColor: 'from-amber-500/20 to-yellow-600/10 text-yellow-300 border-yellow-500/30',
    badge: 'GOLD SPECIALIST',
    filename: 'Giao_dich_vang_XAUUSD.pdf',
    description: 'Đặc tính hành vi của vàng, tương quan lợi suất trái phiếu Mỹ & DXY, cách tính đòn bẩy và 5 setup xác suất cao.',
    pages: 'Cẩm nang vàng',
  },
  {
    id: 'book-7',
    title: 'Tâm Lý Giao Dịch & Bẫy FOMO',
    category: 'RISK_MGMT',
    categoryLabel: 'Tâm Lý Học',
    categoryColor: 'from-rose-500/20 to-rose-600/10 text-rose-300 border-rose-500/30',
    badge: 'TÂM LÝ VỮNG VÀNG',
    filename: 'Tam_ly_giao_dich_bay_FOMO.pdf',
    description: 'Giải mã vòng lặp cảm xúc sợ hãi - tham lam - trả thù thị trường. Bộ quy tắc Nếu... Thì... giúp giữ vững kỷ luật.',
    pages: 'Kiểm soát cảm xúc',
  },
  {
    id: 'book-8',
    title: 'Liquidity & Bẫy Quét Stop Loss',
    category: 'SMC',
    categoryLabel: 'SMC & Thanh Khoản',
    categoryColor: 'from-blue-500/20 to-blue-600/10 text-blue-300 border-blue-500/30',
    badge: 'SMART MONEY',
    filename: 'Liquidity_bay_quet_stop_loss.pdf',
    description: 'Hiểu về cách Big Boys tạo lập thị trường săn tìm thanh khoản: Buy-side / Sell-side Liquidity, Sweep, Inducement.',
    pages: 'Thanh khoản thị trường',
  },
  {
    id: 'book-9',
    title: 'Zupirus Kiến Thức Forex Cốt Lõi',
    category: 'PRICE_ACTION',
    categoryLabel: 'Căn Bản & Nâng Cao',
    categoryColor: 'from-indigo-500/20 to-indigo-600/10 text-indigo-300 border-indigo-500/30',
    badge: 'ACADEMY CORE',
    filename: 'Zupirus_Kien_thuc_Forex.pdf',
    description: 'Giáo trình toàn diện 11 bước từ nhập môn đến làm chủ phân tích định lượng XAU/USD của Zupirus Trading Academy.',
    pages: 'Giáo trình cốt lõi',
  },
  {
    id: 'book-10',
    title: '30 Setup Mẫu Có Chú Thích Chart',
    category: 'PATTERNS',
    categoryLabel: 'Bộ Setup Mẫu',
    categoryColor: 'from-emerald-500/20 to-teal-600/10 text-emerald-300 border-emerald-500/30',
    badge: '30 THẾ ĐÁNH QUỸ',
    filename: '30_setup_mau_chu_thich_chart.pdf',
    description: 'Bộ sưu tập 30 thế đánh thực chiến có sơ đồ trực quan, hướng dẫn điểm vào lệnh Entry, Stop-Loss Fail-Closed và chốt lời TP.',
    pages: '30 Setup đồ thị',
  },
  {
    id: 'book-11',
    title: 'Smart Money Cho Người Mới Bắt Đầu',
    category: 'SMC',
    categoryLabel: 'SMC Nhập Môn',
    categoryColor: 'from-blue-500/20 to-blue-600/10 text-blue-300 border-blue-500/30',
    badge: 'BOS · CHOCH · OB',
    filename: 'Smart_Money_cho_nguoi_moi.pdf',
    description: 'Nắm vững cấu trúc dòng tiền thông minh: Break of Structure (BOS), Change of Character (CHoCH), Order Block và Fair Value Gap (FVG).',
    pages: 'SMC toàn tập',
  },
  {
    id: 'book-12',
    title: 'Cẩm Nang 43 Mô Hình Nến Đảo Chiều',
    category: 'PATTERNS',
    categoryLabel: 'Mô Hình Nến',
    categoryColor: 'from-amber-500/20 to-orange-600/10 text-amber-300 border-amber-500/30',
    badge: '43 MÔ HÌNH NẾN',
    filename: 'Cam_nang_mo_hinh_nen.pdf',
    description: 'Sổ tay 43 mẫu hình nến Price Action đảo chiều và tiếp diễn kinh điển kèm hình minh họa trực quan và điều kiện kích hoạt.',
    pages: '43 Mô hình nến',
  },
];

export interface VipLibraryModalProps {
  open: boolean;
  onClose: () => void;
}

export const VipLibraryModal: React.FC<VipLibraryModalProps> = ({ open, onClose }) => {
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState<string>('ALL');

  if (!open) return null;

  const filteredBooks = VIP_BOOKS.filter((b) => {
    const matchCat = selectedCat === 'ALL' || b.category === selectedCat;
    const matchSearch =
      b.title.toLowerCase().includes(search.toLowerCase()) ||
      b.description.toLowerCase().includes(search.toLowerCase()) ||
      b.badge.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-amber-500/30 shadow-2xl shadow-amber-500/10 overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-white/[0.08] flex items-center justify-between bg-gradient-to-r from-amber-500/10 via-transparent to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-lg shadow-amber-500/20">
              <IconSpark className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide">
                  Tủ Sách Tri Thức Định Lượng VIP
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  12 EBOOKS CHUẨN QUỸ
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Dành riêng cho hội viên <span className="text-amber-300 font-semibold">Alpha VIP</span> & <span className="text-emerald-300 font-semibold">Prop Funded</span> · Tải trực tiếp định dạng PDF bản gốc
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <IconClose className="w-5 h-5" />
          </button>
        </div>

        {/* Filter bar */}
        <div className="p-3 sm:px-6 py-3 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3 bg-slate-900/60">
          <div className="flex items-center gap-1.5 overflow-x-auto text-xs py-1">
            {[
              { id: 'ALL', label: 'Tất cả (12)' },
              { id: 'SMC', label: 'SMC & Liquidity' },
              { id: 'PRICE_ACTION', label: 'Price Action' },
              { id: 'PATTERNS', label: 'Mô hình nến & Setup' },
              { id: 'GOLD_MACRO', label: 'Vàng & Thời gian' },
              { id: 'RISK_MGMT', label: 'Quản trị vốn & Tâm lý' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedCat(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all text-xs whitespace-nowrap ${
                  selectedCat === tab.id
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20'
                    : 'bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tên sách, chủ đề..."
              className="w-full bg-slate-950/80 border border-white/[0.1] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
          </div>
        </div>

        {/* Book Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredBooks.map((book) => (
            <div
              key={book.id}
              className="group relative flex flex-col justify-between p-4 rounded-xl bg-slate-900/40 border border-white/[0.08] hover:border-amber-500/40 hover:bg-slate-900/80 transition-all duration-200"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border bg-gradient-to-r ${book.categoryColor}`}
                  >
                    {book.badge}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">{book.pages}</span>
                </div>

                <h3 className="text-sm font-bold text-white group-hover:text-amber-300 transition-colors line-clamp-2">
                  {book.title}
                </h3>

                <p className="mt-2 text-xs text-slate-400 line-clamp-3 leading-relaxed">
                  {book.description}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between">
                <span className="text-[10px] font-mono text-slate-500 truncate max-w-[140px]">
                  {book.filename}
                </span>
                <a
                  href={`/vip-ebooks/${book.filename}`}
                  download={book.filename}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500 hover:text-slate-950 transition-all shadow-sm shadow-amber-500/10"
                >
                  <span>Tải PDF</span>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-3 sm:px-6 border-t border-white/[0.08] flex items-center justify-between text-xs font-mono text-slate-400 bg-slate-950">
          <div className="flex items-center gap-2">
            <IconShield className="w-4 h-4 text-emerald-400" />
            <span>Bản quyền nội bộ ZUPIRUS Quant Academy</span>
          </div>
          <div className="text-slate-500">
            Tổng cộng: <strong className="text-white">{filteredBooks.length}</strong> / 12 tài liệu
          </div>
        </div>
      </div>
    </div>
  );
};
