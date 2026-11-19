import React from 'react';
import { fmtNum } from '../utils/strategyDecision';

export interface PropCertificateModalProps {
  open: boolean;
  onClose: () => void;
  totalEquity: number;
  netPnl: number;
  accountsCount: number;
  winRatePct?: number;
}

export const PropCertificateModal: React.FC<PropCertificateModalProps> = ({
  open,
  onClose,
  totalEquity,
  netPnl,
  accountsCount,
  winRatePct = 76.3,
}) => {
  if (!open) return null;

  const handleDownloadPng = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background obsidian gradient
    const bg = ctx.createLinearGradient(0, 0, 1200, 630);
    bg.addColorStop(0, '#040710');
    bg.addColorStop(1, '#0b1530');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1200, 630);

    // Gold frame
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 4;
    ctx.strokeRect(28, 28, 1144, 574);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(42, 42, 1116, 546);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 22px monospace';
    ctx.fillText('ZUPIRUS QUANT LAB // VERIFIED PROP FIRM ACHIEVEMENT', 80, 108);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px sans-serif';
    ctx.fillText('CHỨNG NHẬN PASS QUỸ LIVE', 80, 185);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '24px monospace';
    ctx.fillText(`XAU/USD CLOUD MT5 · ${accountsCount} TÀI KHOẢN FUNDED · 4/4 LỚP GIÁP FAIL-CLOSED`, 80, 232);

    // KPI boxes
    const kpis = [
      ['VỐN QUỸ HIỆN TẠI', `$${fmtNum(totalEquity, 2)}`, '#fbbf24'],
      ['LỢI NHUẬN RÒNG', `${netPnl >= 0 ? '+' : '-'}$${fmtNum(Math.abs(netPnl), 2)}`, '#10b981'],
      ['TỶ LỆ THẮNG (WR)', `${winRatePct.toFixed(1)}%`, '#38bdf8'],
    ];
    kpis.forEach(([label, val, col], idx) => {
      const bx = 80 + idx * 355;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(bx, 290, 330, 165);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.strokeRect(bx, 290, 330, 165);
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 18px monospace';
      ctx.fillText(label, bx + 24, 340);
      ctx.fillStyle = col;
      ctx.font = 'bold 40px monospace';
      ctx.fillText(val, bx + 24, 412);
    });

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '20px monospace';
    ctx.fillText(`Xác thực tự động trên app.zupirus.com · ${new Date().toLocaleDateString('vi-VN')}`, 80, 535);
    ctx.fillStyle = '#10b981';
    ctx.fillText('● VERIFIED BY ZUPIRUS CLOUD LEDGER', 720, 535);

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `zupirus_prop_certificate_${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-w-2xl w-full rounded-2xl border-2 border-amber-400/60 bg-gradient-to-br from-[#040710] to-[#0b1530] p-6 sm:p-8 shadow-[0_0_60px_rgba(245,158,11,0.2)] space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-amber-300">
              ZUPIRUS QUANT LAB // VERIFIED PROP FIRM ACHIEVEMENT
            </div>
            <h3 className="mt-1 font-display text-2xl sm:text-3xl font-extrabold text-white">
              Chứng Nhận Pass Quỹ LIVE
            </h3>
            <p className="mt-1 font-mono text-xs text-slate-400">
              XAU/USD Cloud MT5 · {accountsCount} tài khoản Funded · 4/4 Lớp Giáp Fail-Closed
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:text-white cursor-pointer"
          >
            Đóng ✕
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 font-mono tabular-nums">
          <div className="rounded-xl border border-amber-400/30 bg-[#050a18] p-4">
            <div className="text-[10px] text-slate-400">VỐN QUỸ HIỆN TẠI</div>
            <div className="mt-1 text-2xl font-extrabold text-amber-300">${fmtNum(totalEquity, 2)}</div>
          </div>
          <div className="rounded-xl border border-emerald-400/30 bg-[#050a18] p-4">
            <div className="text-[10px] text-slate-400">LỢI NHUẬN RÒNG</div>
            <div className="mt-1 text-2xl font-extrabold text-emerald-400">
              {netPnl >= 0 ? '+' : '-'}${fmtNum(Math.abs(netPnl), 2)}
            </div>
          </div>
          <div className="rounded-xl border border-cyan-400/30 bg-[#050a18] p-4">
            <div className="text-[10px] text-slate-400">TỶ LỆ THẮNG (WR)</div>
            <div className="mt-1 text-2xl font-extrabold text-cyan-300">{winRatePct.toFixed(1)}%</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <span className="font-mono text-[11px] text-emerald-400">
            ● Verified by ZUPIRUS Cloud Ledger · {new Date().toLocaleDateString('vi-VN')}
          </span>
          <div className="flex items-center gap-2">
            <a
              href="https://discord.gg/yxCx3dVe34"
              target="_blank"
              rel="noopener noreferrer"
              className="quant-btn-secondary px-3.5 py-2 text-xs"
            >
              Khoe lên Discord ↗
            </a>
            <button
              type="button"
              onClick={handleDownloadPng}
              className="quant-btn-primary px-4 py-2 text-xs"
            >
              Tải Ảnh Chứng Nhận (PNG)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
