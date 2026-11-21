import React from 'react';

export interface LandingFooterProps {
  onEnterPortal?: () => void;
}

export const LandingFooter: React.FC<LandingFooterProps> = ({ onEnterPortal }) => {
  return (
    <>
      {/* Institutional Fintech Footer with Discord Community Links */}
      <footer className="border-t border-slate-800/80 bg-[#050914] py-12 pb-24 sm:pb-12 text-xs text-slate-400 font-mono">
        <div className="mx-auto max-w-6xl px-6 space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#12B5A6]/15 border border-[#12B5A6]/40 text-[#12B5A6] font-bold">
                Z
              </span>
              <span className="text-sm font-bold text-white tracking-wider">ZUPIRUS QUANT LAB</span>
            </div>
            <div className="flex items-center gap-6 text-slate-400">
              <a
                href="https://discord.gg/yxCx3dVe34"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#8EA1FF] hover:underline flex items-center gap-1 font-bold"
              >
                <span>Cộng Đồng Discord</span>
                <span>↗</span>
              </a>
              <a href="#pipeline" className="hover:text-white transition">4 Lớp Giáp</a>
              <a href="#track-record" className="hover:text-white transition">Hiệu Suất</a>
              <a href="#lot-calculator" className="hover:text-white transition">Tính Lot</a>
              <a href="#pricing" className="hover:text-white transition">Bảng Giá</a>
              {onEnterPortal && (
                <button type="button" onClick={onEnterPortal} className="text-[#12B5A6] hover:underline cursor-pointer">
                  Cổng Giao Dịch →
                </button>
              )}
            </div>
          </div>
          <div className="border-t border-slate-800/60 pt-6 text-[11px] leading-relaxed text-slate-500">
            <strong className="text-slate-400">Tuyên bố miễn trừ rủi ro:</strong> Giao dịch ngoại hối (Forex) và Vàng (XAU/USD) sử dụng đòn bẩy tài chính có rủi ro cao đối với vốn đầu tư. ZUPIRUS cung cấp công nghệ hạ tầng tự động hóa đám mây và các lớp giáp quản trị rủi ro kỹ thuật, không phải là đơn vị huy động vốn hay quản lý ủy thác đầu tư. Tiền và vị thế giao dịch nằm 100% tại sàn giao dịch MT5 của người dùng.
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-600 pt-2">
            <span>© 2026 ZUPIRUS. Mọi quyền được bảo lưu.</span>
            <span>Hạ tầng MetaApi London G2 · SePay VietQR Automated · Discord Community</span>
          </div>
        </div>
      </footer>

      {/* Mobile WebApp Bottom Dock on Landing Page (Fixed on phones for app-like conversion) */}
      <div className="fixed bottom-0 inset-x-0 z-40 flex sm:hidden items-center justify-between gap-2 border-t border-slate-800/90 bg-[#070c18]/95 px-3 py-2.5 backdrop-blur-xl shadow-2xl pb-[max(0.6rem,env(safe-area-inset-bottom))]">
        <a
          href="https://discord.gg/yxCx3dVe34"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-xl border border-[#3b4b7a] bg-[#0c1326] px-3 py-2 text-xs font-mono font-bold text-[#8EA1FF] whitespace-nowrap"
        >
          <span>Discord</span>
          <span className="text-[10px]">↗</span>
        </a>

        <button
          type="button"
          onClick={() => {
            const el = document.getElementById('pipeline');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }}
          className="flex items-center gap-1 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-mono font-bold text-emerald-300 whitespace-nowrap cursor-pointer"
        >
          <span>⚡ Bắn Thử</span>
        </button>

        {onEnterPortal && (
          <button
            type="button"
            onClick={onEnterPortal}
            className="flex-1 flex items-center justify-center rounded-xl bg-[#12B5A6] px-3 py-2 text-xs font-bold text-[#042F2E] whitespace-nowrap shadow-sm cursor-pointer"
          >
            <span>Vào Cổng App →</span>
          </button>
        )}
      </div>
    </>
  );
};
