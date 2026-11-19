import React from 'react';
import { IconClose } from './Icons';

export interface AccountModalsProps {
  disclaimerModalOpen: boolean;
  setDisclaimerModalOpen: (open: boolean) => void;
  disclaimerAccepted: boolean;
  setDisclaimerAccepted: (accepted: boolean) => void;
  mt5Login: string;
  maxDailyDdPct: number | string;
  estimatedVnd: number;
  executeConnectCloudAccount: () => void;
  checkoutModalOpen: boolean;
  setCheckoutModalOpen: (open: boolean) => void;
  checkoutOrder: any;
  pollingPaid: boolean;
}

export const AccountModals: React.FC<AccountModalsProps> = ({
  disclaimerModalOpen,
  setDisclaimerModalOpen,
  disclaimerAccepted,
  setDisclaimerAccepted,
  mt5Login,
  maxDailyDdPct,
  estimatedVnd,
  executeConnectCloudAccount,
  checkoutModalOpen,
  setCheckoutModalOpen,
  checkoutOrder,
  pollingPaid,
}) => (
  <>
      {/* Disclaimer Modal */}
      {disclaimerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="quant-panel max-w-lg w-full p-6 space-y-4 border-cyan-500/40">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400">
                  Xác Nhận Pháp Lý & Quản Trị Rủi Ro
                </span>
                <h4 className="text-base font-bold text-white">Đồng Ý Điều Khoản Thực Thi Định Lượng</h4>
              </div>
              <button
                type="button"
                aria-label="Đóng hộp thoại điều khoản"
                onClick={() => setDisclaimerModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 rounded-xl border border-white/[0.07] bg-[#040710] p-4 text-xs leading-relaxed text-slate-300">
              <p>
                1. <strong>Quyền kiểm soát tài khoản:</strong> ZUPIRUS Quant Lab chỉ sử dụng thông tin đăng nhập MT5 của bạn để đồng bộ vị thế XAU/USD và kiểm soát ngưỡng cắt lỗ ngày (Daily Drawdown Guard).
              </p>
              <p>
                2. <strong>Cảnh báo rủi ro thị trường:</strong> Giao dịch CFD/Kim loại quý có đòn bẩy cao. Lá chắn 4 lớp giúp giới hạn rủi ro trong ngưỡng cài đặt ({maxDailyDdPct}%/ngày) nhưng không loại trừ hoàn toàn trượt giá thị trường (slippage) trong tin tức cực đoan.
              </p>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-200">
              <input
                type="checkbox"
                checked={disclaimerAccepted}
                onChange={(e) => setDisclaimerAccepted(e.target.checked)}
                className="mt-0.5 rounded border-slate-600"
              />
              <span>
                Tôi đã đọc, hiểu rõ cơ chế Lá Chắn Rủi Ro 4 Lớp và xác nhận uỷ quyền kết nối tài khoản MT5{' '}
                <strong className="font-mono text-cyan-300">#{mt5Login}</strong>.
              </span>
            </label>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDisclaimerModalOpen(false)}
                className="quant-btn-secondary px-4 py-2 text-xs"
              >
                Huỷ Bỏ
              </button>
              <button
                type="button"
                disabled={!disclaimerAccepted}
                onClick={executeConnectCloudAccount}
                className="quant-btn-primary px-5 py-2 text-xs disabled:opacity-40"
              >
                Ký Xác Nhận & Kết Nối Cloud
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VietQR Modal */}
      {checkoutModalOpen && checkoutOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="quant-panel max-w-md w-full p-6 space-y-4 border-cyan-500/40 text-center">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3 text-left">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400">
                  Cổng Thanh Toán Tự Động SePay
                </span>
                <h4 className="text-base font-bold text-white">Quét Mã VietQR Kích Hoạt Gói Cloud</h4>
              </div>
              <button
                type="button"
                aria-label="Đóng hộp thoại thanh toán"
                onClick={() => setCheckoutModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>

            {(() => {
              const displayOrderId = checkoutOrder.order_code || checkoutOrder.order_id || checkoutOrder.id || '';
              const displayBank = checkoutOrder.bank_name || 'Chưa cấu hình';
              const displayAccNum = checkoutOrder.account_number || 'Chưa cấu hình';
              const displayHolder = checkoutOrder.account_holder || 'ZUPIRUS QUANT LAB';
              const displayMemo = checkoutOrder.payment_content || `ZP ${displayOrderId.slice(-6).toUpperCase()}`;
              const displayAmountVnd = Number(checkoutOrder.amount_vnd || estimatedVnd || 0);
              const qrCodeUrl =
                checkoutOrder.qr_code_url ||
                checkoutOrder.qr_url ||
                `https://qr.sepay.vn/img?acc=${encodeURIComponent(displayAccNum)}&bank=${encodeURIComponent(displayBank)}&amount=${encodeURIComponent(displayAmountVnd)}&des=${encodeURIComponent(displayMemo)}`;

              return (
                <>
                  <div className="mx-auto w-64 overflow-hidden rounded-2xl border border-cyan-500/40 bg-white p-3 shadow-[0_0_35px_rgba(6,182,212,0.25)]">
                    <img
                      src={qrCodeUrl}
                      alt="VietQR SePay"
                      className="h-full w-full object-contain"
                    />
                  </div>

                  <div className="space-y-2 rounded-xl border border-white/[0.07] bg-[#040710] p-3.5 text-left font-mono text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Mã đơn hàng:</span>
                      <strong className="text-cyan-300 select-all">{displayOrderId}</strong>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Số tiền thanh toán:</span>
                      <strong className="text-emerald-400 tabular-nums font-bold">
                        {displayAmountVnd.toLocaleString('vi-VN')} VND
                      </strong>
                    </div>
                    <div className="flex justify-between items-center border-t border-white/[0.05] pt-1.5">
                      <span className="text-slate-400">Ngân hàng:</span>
                      <span className="text-white font-bold">{displayBank}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Số tài khoản:</span>
                      <span className="text-amber-300 font-bold select-all flex items-center gap-1.5">
                        {displayAccNum}
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(displayAccNum)}
                          className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-slate-300 hover:text-white"
                          title="Sao chép số tài khoản"
                        >
                          Copy
                        </button>
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Chủ tài khoản:</span>
                      <span className="text-slate-200">{displayHolder}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-white/[0.05] pt-1.5">
                      <span className="text-slate-400">Nội dung CK:</span>
                      <span className="text-cyan-300 font-bold select-all flex items-center gap-1.5">
                        {displayMemo}
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(displayMemo)}
                          className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-slate-300 hover:text-white"
                          title="Sao chép nội dung"
                        >
                          Copy
                        </button>
                      </span>
                    </div>
                    <div className="flex justify-between items-center border-t border-white/[0.05] pt-1.5">
                      <span className="text-slate-400">Trạng thái:</span>
                      <strong
                        className={
                          checkoutOrder.status === 'PAID'
                            ? 'text-emerald-400'
                            : checkoutOrder.status === 'UNDERPAID' || checkoutOrder.status === 'EXPIRED'
                            ? 'text-rose-400'
                            : 'text-amber-300'
                        }
                      >
                        {checkoutOrder.status === 'PAID'
                          ? '✓ ĐÃ THANH TOÁN (KÍCH HOẠT CLOUD)'
                          : checkoutOrder.status === 'UNDERPAID'
                          ? '⚠ CHUYỂN THIẾU TIỀN (CHỜ BÙ)'
                          : checkoutOrder.status === 'EXPIRED'
                          ? '✕ ĐƠN HÀNG ĐÃ HẾT HẠN'
                          : '⏳ ĐANG CHỜ WEBHOOK SEPAY...'}
                      </strong>
                    </div>
                    {checkoutOrder.status === 'UNDERPAID' && (
                      <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-[11px] text-rose-200">
                        Đã nhận:{' '}
                        <strong>{Number(checkoutOrder.paid_amount_vnd || 0).toLocaleString('vi-VN')} VND</strong>. Vui lòng chuyển khoản bù thêm{' '}
                        <strong className="text-amber-300">
                          {Math.max(0, displayAmountVnd - Number(checkoutOrder.paid_amount_vnd || 0)).toLocaleString('vi-VN')} VND
                        </strong>{' '}
                        với cùng nội dung <strong className="text-cyan-300">{displayMemo}</strong> để hệ thống tự động kích hoạt.
                      </div>
                    )}
                    {checkoutOrder.status === 'EXPIRED' && (
                      <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-[11px] text-rose-200">
                        Đơn thanh toán đã quá thời hạn giữ tỷ giá (15 phút). Vui lòng đóng cửa sổ này và bấm Tạo Mã QR SePay mới.
                      </div>
                    )}
                  </div>

                  {pollingPaid && checkoutOrder.status !== 'PAID' && checkoutOrder.status !== 'EXPIRED' && (
                    <div className="pt-1 text-[11px] font-mono text-slate-400">
                      Hệ thống tự động kiểm tra giao dịch SePay mỗi 3 giây...
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
  </>
);
