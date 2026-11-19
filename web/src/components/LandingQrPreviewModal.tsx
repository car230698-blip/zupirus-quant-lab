import React from 'react';
import { calculateSubscriptionPricing, type BillingCycle } from '../utils/quantMath';
import { IconClose } from './Icons';

export interface LandingQrPreviewModalProps {
  qrPreviewTier: { name: string; baseUsd: number; slots: number } | null;
  setQrPreviewTier: (tier: any) => void;
  billingCycle: BillingCycle;
  usdVndRate: number;
  onEnterPortal: () => void;
}

export const LandingQrPreviewModal: React.FC<LandingQrPreviewModalProps> = ({
  qrPreviewTier,
  setQrPreviewTier,
  billingCycle,
  usdVndRate,
  onEnterPortal,
}) => (
  <>
      {/* Instant VietQR Preview Modal */}
      {qrPreviewTier && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          onClick={() => setQrPreviewTier(null)}
        >
          <div
            className="quant-panel max-w-md w-full p-6 space-y-4 border-amber-400/50 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3 text-left">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-amber-300">
                  BÁO GIÁ GÓI DỊCH VỤ ZUPIRUS
                </span>
                <h4 className="text-base font-bold text-white">Gói {qrPreviewTier.name}</h4>
              </div>
              <button
                type="button"
                aria-label="Đóng báo giá"
                onClick={() => setQrPreviewTier(null)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white font-mono text-xs transition cursor-pointer"
              >
                ESC <IconClose className="w-3.5 h-3.5" />
              </button>
            </div>

            {(() => {
              const p = calculateSubscriptionPricing(qrPreviewTier.baseUsd, qrPreviewTier.slots, billingCycle, usdVndRate);
              return (
                <>
                  <div className="mx-auto rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-center text-xs text-amber-200">
                    <div className="font-mono font-bold text-amber-300 mb-1">XEM TRƯỚC BÁO GIÁ VIETQR</div>
                    <p className="text-slate-300">
                      Đăng nhập vào cổng khách hàng để hệ thống khởi tạo đơn hàng và mã QR chuyển khoản chính thức theo tài khoản của bạn.
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#040710] p-3.5 text-left font-mono text-xs space-y-1.5 tabular-nums">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Gói thuê bao:</span>
                      <strong className="text-amber-300">{qrPreviewTier.name} ({p.months} tháng)</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Số tiền quy đổi:</span>
                      <strong className="text-emerald-400">{p.totalVnd.toLocaleString('vi-VN')} VND</strong>
                    </div>
                  </div>
                </>
              );
            })()}

            <button
              type="button"
              onClick={() => {
                setQrPreviewTier(null);
                onEnterPortal();
              }}
              className="quant-btn-primary w-full py-2.5 text-xs"
            >
              Mở Cổng Khách Hàng Để Khởi Tạo Đơn Chính Thức →
            </button>
          </div>
        </div>
      )}
  </>
);
