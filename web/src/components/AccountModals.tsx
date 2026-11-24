import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { IconClose } from './Icons';
import { useLanguage } from '../i18n/LanguageContext';
import { verifyCryptoOrderTx } from '../api/client';

function CryptoQrCode({ text, alt }: { text: string; alt: string }) {
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [renderMode, setRenderMode] = useState<'loading' | 'svg' | 'canvas'>('loading');
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    if (!text) return;
    setRenderMode('loading');
    setSvgHtml('');

    QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      color: {
        dark: '#000000ff',
        light: '#ffffffff',
      },
    })
      .then((svg) => {
        if (active) {
          setSvgHtml(svg);
          setRenderMode('svg');
        }
      })
      .catch((err) => {
        console.error('SVG QR generation failed, attempting canvas fallback:', err);
        // Paint directly onto the persistent canvas mounted in the DOM
        if (active && canvasRef.current) {
          QRCode.toCanvas(canvasRef.current, text, {
            width: 240,
            margin: 1,
            color: { dark: '#000000ff', light: '#ffffffff' },
          })
            .then(() => {
              if (active) setRenderMode('canvas');
            })
            .catch((cErr) => {
              console.error('Canvas QR fallback also failed:', cErr);
            });
        }
      });

    return () => {
      active = false;
    };
  }, [text]);

  return (
    <div className="w-full h-full flex items-center justify-center relative">
      {renderMode === 'svg' && svgHtml && (
        <div
          className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
          dangerouslySetInnerHTML={{ __html: svgHtml }}
          aria-label={alt}
        />
      )}
      {/* Single persistent canvas node that remains mounted across states so drawn pixels are never wiped */}
      <canvas
        ref={canvasRef}
        className={`w-full h-full object-contain ${renderMode === 'canvas' ? 'block' : 'hidden'}`}
        aria-label={alt}
      />
      {renderMode === 'loading' && (
        <div className="w-36 h-36 flex items-center justify-center text-xs text-slate-400 font-mono animate-pulse">
          QR Code...
        </div>
      )}
    </div>
  );
}

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
}) => {
  const { lang } = useLanguage();
  const [txHashInput, setTxHashInput] = useState('');
  const [txVerifying, setTxVerifying] = useState(false);
  const [txVerifyMsg, setTxVerifyMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (disclaimerModalOpen) setDisclaimerModalOpen(false);
        if (checkoutModalOpen) setCheckoutModalOpen(false);
      }
    };
    if (disclaimerModalOpen || checkoutModalOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [disclaimerModalOpen, checkoutModalOpen, setDisclaimerModalOpen, setCheckoutModalOpen]);

  const copyToClipboard = (text: string, key: string) => {
    if (!text) return;
    try {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {}
  };

  return (
  <>
      {/* Disclaimer Modal */}
      {disclaimerModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="disclaimer-modal-title"
        >
          <div className="max-w-lg w-full p-6 space-y-4 rounded-2xl bg-[#0B1221]/95 backdrop-blur-2xl border border-white/[0.1] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400">
                  {lang === 'en' ? 'Legal & Risk Management Confirmation' : 'Xác Nhận Pháp Lý & Quản Trị Rủi Ro'}
                </span>
                <h4 id="disclaimer-modal-title" className="text-base font-bold text-white">
                  {lang === 'en' ? 'Quantitative Execution Terms Agreement' : 'Đồng Ý Điều Khoản Thực Thi Định Lượng'}
                </h4>
              </div>
              <button
                type="button"
                aria-label={lang === 'en' ? 'Close terms dialog' : 'Đóng hộp thoại điều khoản'}
                onClick={() => setDisclaimerModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 rounded-xl border border-white/[0.07] bg-[#040710] p-4 text-xs leading-relaxed text-slate-300">
              <p>
                1. <strong>{lang === 'en' ? 'Account control: ' : 'Quyền kiểm soát tài khoản: '}</strong>
                {lang === 'en'
                  ? 'ZUPIRUS Quant Lab only uses your MT5 credentials to synchronize positions and enforce Daily Drawdown protection.'
                  : 'ZUPIRUS Quant Lab chỉ sử dụng thông tin đăng nhập MT5 của bạn để đồng bộ vị thế XAU/USD và kiểm soát ngưỡng cắt lỗ ngày (Daily Drawdown Guard).'}
              </p>
              <p>
                2. <strong>{lang === 'en' ? 'Market risk warning: ' : 'Cảnh báo rủi ro thị trường: '}</strong>
                {lang === 'en'
                  ? `Leveraged CFD/Precious Metals trading carries high risk. The 4-layer shield limits risk within configured limits (${maxDailyDdPct}%/day) but cannot eliminate extreme market slippage during black swan news events.`
                  : `Giao dịch CFD/Kim loại quý có đòn bẩy cao. Lá chắn 4 lớp giúp giới hạn rủi ro trong ngưỡng cài đặt (${maxDailyDdPct}%/ngày) nhưng không loại trừ hoàn toàn trượt giá thị trường (slippage) trong tin tức cực đoan.`}
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
                {lang === 'en'
                  ? 'I have read, understood the 4-layer capital shield mechanism, and confirm authorization to connect MT5 account '
                  : 'Tôi đã đọc, hiểu rõ cơ chế Lá Chắn Rủi Ro 4 Lớp và xác nhận uỷ quyền kết nối tài khoản MT5 '}
                <strong className="font-mono text-cyan-300">#{mt5Login}</strong>.
              </span>
            </label>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDisclaimerModalOpen(false)}
                className="quant-btn-secondary px-4 py-2 text-xs"
              >
                {lang === 'en' ? 'Cancel' : 'Huỷ Bỏ'}
              </button>
              <button
                type="button"
                disabled={!disclaimerAccepted}
                onClick={executeConnectCloudAccount}
                className="quant-btn-primary px-5 py-2 text-xs disabled:opacity-40"
              >
                {lang === 'en' ? 'Sign & Connect Cloud' : 'Ký Xác Nhận & Kết Nối Cloud'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Checkout Modal (VietQR / Direct USDT On-Chain) */}
      {checkoutModalOpen && checkoutOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-modal-title"
        >
          <div className="max-w-md w-full p-6 space-y-4 rounded-2xl bg-[#0B1221]/95 backdrop-blur-2xl border border-white/[0.1] shadow-2xl text-center">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3 text-left">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">
                  {checkoutOrder.payment_gateway?.startsWith('USDT') || checkoutOrder.currency === 'USDT'
                    ? (lang === 'en' ? 'DIRECT USDT ON-CHAIN PAYMENT (0% FEE)' : 'THANH TOÁN TRỰC TIẾP USDT ON-CHAIN (0% PHÍ)')
                    : (lang === 'en' ? 'SePay Automated Payment Gateway' : 'Cổng Thanh Toán Tự Động SePay')}
                </span>
                <h4 id="checkout-modal-title" className="text-base font-bold text-white">
                  {checkoutOrder.payment_gateway?.startsWith('USDT') || checkoutOrder.currency === 'USDT'
                    ? (lang === 'en' ? 'Direct USDT Transfer to Admin Wallet' : 'Chuyển Khoản Trực Tiếp USDT Vào Ví Admin')
                    : (lang === 'en' ? 'Scan VietQR to Activate Cloud MT5' : 'Quét Mã VietQR Kích Hoạt Gói Cloud')}
                </h4>
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
              const isCrypto = Boolean(
                checkoutOrder.payment_gateway?.startsWith('USDT') ||
                checkoutOrder.currency === 'USDT'
              );
              const displayOrderId = checkoutOrder.order_code || checkoutOrder.order_id || checkoutOrder.id || '';

              if (isCrypto) {
                const amountUsdt = Number(checkoutOrder.expected_amount_usdt || checkoutOrder.amount_usdt || checkoutOrder.amount_usd || 0);
                const network = checkoutOrder.crypto_network || (checkoutOrder.payment_gateway?.includes('BEP20') ? 'BEP20' : 'TRC20');
                const walletAddress = checkoutOrder.wallet_address || '';

                const handleVerifyTx = async (e: React.FormEvent) => {
                  e.preventDefault();
                  if (!txHashInput.trim()) {
                    setTxVerifyMsg({
                      type: 'error',
                      text: lang === 'en' ? 'Please paste your transaction hash.' : 'Vui lòng dán mã Transaction Hash.',
                    });
                    return;
                  }
                  setTxVerifying(true);
                  setTxVerifyMsg(null);
                  try {
                    const res = await verifyCryptoOrderTx(displayOrderId, txHashInput.trim());
                    if (res?.ok) {
                      setTxVerifyMsg({
                        type: 'success',
                        text: lang === 'en' ? '✓ Transaction verified! Cloud subscription activated.' : '✓ Xác minh thành công! Gói Cloud MT5 đã được kích hoạt.',
                      });
                      checkoutOrder.status = 'PAID';
                    } else {
                      setTxVerifyMsg({
                        type: 'error',
                        text: res?.message || (lang === 'en' ? 'Verification failed' : 'Xác minh thất bại'),
                      });
                    }
                  } catch (err: any) {
                    setTxVerifyMsg({
                      type: 'error',
                      text: err.message || String(err),
                    });
                  } finally {
                    setTxVerifying(false);
                  }
                };

                return (
                  <div className="space-y-4 text-left">
                    {/* Amount & Network Card */}
                    <div className="rounded-xl border border-emerald-500/30 bg-[#040710] p-4 font-mono text-xs space-y-2.5">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">{lang === 'en' ? 'Order ID:' : 'Mã đơn hàng:'}</span>
                        <strong className="text-cyan-300 select-all">{displayOrderId}</strong>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">{lang === 'en' ? 'Network:' : 'Mạng lưới chuyển:'}</span>
                        <span className="rounded-md bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 text-xs font-bold text-emerald-300">
                          USDT ({network})
                        </span>
                      </div>

                      <div className="flex justify-between items-center border-t border-white/[0.05] pt-2">
                        <div>
                          <span className="text-slate-400 block">{lang === 'en' ? 'Exact Amount to Send:' : 'Số tiền chính xác cần chuyển:'}</span>
                          <span className="text-[10px] text-amber-300">
                            {lang === 'en' ? '(Includes unique cent allocation)' : '(Đã cộng số lẻ định danh)'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <strong className="text-emerald-400 text-base font-extrabold tabular-nums">
                            {amountUsdt.toFixed(2)} USDT
                          </strong>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(amountUsdt.toFixed(2), 'amount')}
                            className="rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 px-2 py-1 text-[11px] font-bold cursor-pointer transition"
                          >
                            {copiedKey === 'amount' ? (lang === 'en' ? 'Copied' : 'Đã chép') : (lang === 'en' ? 'Copy' : 'Chép')}
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-between items-center border-t border-white/[0.05] pt-2">
                        <span className="text-slate-400">{lang === 'en' ? 'Status:' : 'Trạng thái:'}</span>
                        <strong className={checkoutOrder.status === 'PAID' ? 'text-emerald-400 font-bold' : 'text-amber-300'}>
                          {checkoutOrder.status === 'PAID'
                            ? (lang === 'en' ? '✓ PAID (CLOUD ACTIVATED)' : '✓ ĐÃ THANH TOÁN (KÍCH HOẠT CLOUD)')
                            : (lang === 'en' ? '⏳ AWAITING ON-CHAIN TRANSFER (30M)' : '⏳ CHỜ CHUYỂN KHOẢN ON-CHAIN (30 PHÚT)')}
                        </strong>
                      </div>
                    </div>

                    {/* QR Code and Wallet Address */}
                    {walletAddress ? (
                      <div className="rounded-xl border border-slate-800 bg-[#070D18] p-4 text-center space-y-3">
                        <div className="mx-auto w-40 h-40 bg-white p-2 rounded-xl shadow-lg inline-block">
                          <CryptoQrCode text={walletAddress} alt="Wallet Address QR" />
                        </div>

                        <div className="space-y-1 text-left">
                          <span className="text-[11px] text-slate-400 font-medium block">
                            {lang === 'en' ? `Admin USDT (${network}) Destination Address:` : `Địa chỉ ví nhận USDT (${network}) của Admin:`}
                          </span>
                          <div className="flex items-center gap-1.5 bg-[#03060E] border border-slate-800 rounded-lg p-2 font-mono text-[11px] text-slate-200 break-all select-all">
                            <span className="flex-1">{walletAddress}</span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(walletAddress, 'wallet')}
                              className="rounded bg-[#12B5A6]/20 text-[#12B5A6] hover:bg-[#12B5A6]/30 px-2.5 py-1 text-xs font-bold cursor-pointer transition shrink-0"
                            >
                              {copiedKey === 'wallet' ? (lang === 'en' ? 'Copied' : 'Đã chép') : (lang === 'en' ? 'Copy Address' : 'Sao chép ví')}
                            </button>
                          </div>
                        </div>

                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-left text-[11px] text-amber-200">
                          ⚠️ {lang === 'en'
                            ? `Important: Send ONLY USDT via ${network} network. Sending any other token or via a different network may result in permanent loss.`
                            : `Lưu ý: Chỉ chuyển USDT qua đúng mạng ${network}. Chuyển sai mạng hoặc sai loại coin sẽ không thể hoàn tác.`}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3.5 text-xs text-amber-200">
                        {lang === 'en'
                          ? 'Admin wallet address is being set up. Please contact Admin.'
                          : 'Địa chỉ ví của Admin đang được cập nhật. Vui lòng liên hệ Admin qua Discord.'}
                      </div>
                    )}

                    {/* TX Hash Instant Verification Input */}
                    {checkoutOrder.status !== 'PAID' && (
                      <form onSubmit={handleVerifyTx} className="space-y-2 border-t border-white/[0.08] pt-3">
                        <label className="block text-xs font-bold text-slate-200">
                          {lang === 'en' ? 'Submit Transaction Hash for Instant Verification:' : 'Dán mã giao dịch (Tx Hash) để kích hoạt tự động:'}
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={txHashInput}
                            onChange={(e) => setTxHashInput(e.target.value)}
                            placeholder={network === 'TRC20' ? 'Nhập Tron txid...' : '0x...'}
                            className="flex-1 rounded-xl border border-slate-800 bg-[#070D18] px-3 py-2 font-mono text-xs text-white placeholder-slate-600 focus:border-emerald-400 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={txVerifying || !txHashInput.trim()}
                            className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-xs font-bold text-[#042F2E] hover:from-emerald-400 hover:to-teal-400 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                          >
                            {txVerifying ? (lang === 'en' ? 'Verifying...' : 'Đang kiểm tra...') : (lang === 'en' ? 'Verify On-Chain' : 'Xác Minh Lệnh')}
                          </button>
                        </div>
                        {txVerifyMsg && (
                          <div
                            className={`rounded-lg p-2.5 text-xs font-medium ${
                              txVerifyMsg.type === 'success'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            }`}
                          >
                            {txVerifyMsg.text}
                          </div>
                        )}
                      </form>
                    )}

                    {pollingPaid && checkoutOrder.status !== 'PAID' && (
                      <div className="pt-1 text-[11px] font-mono text-slate-400 text-center">
                        {lang === 'en' ? 'System is polling blockchain status...' : 'Hệ thống đang tự động kiểm tra giao dịch on-chain...'}
                      </div>
                    )}
                  </div>
                );
              }

              const displayBank = checkoutOrder.bank_name || 'Chưa cấu hình';
              const displayAccNum = checkoutOrder.account_number || 'Chưa cấu hình';
              const displayHolder = checkoutOrder.account_holder || 'ZUPIRUS QUANT LAB';
              const isVietin = String(displayBank || '').toLowerCase().includes('vietin') || String(displayBank || '').toLowerCase() === 'icb';
              const defaultMemo = isVietin ? `SEVQR ZP ${displayOrderId.slice(-6).toUpperCase()}` : `ZP ${displayOrderId.slice(-6).toUpperCase()}`;
              const displayMemo = checkoutOrder.payment_content || defaultMemo;
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
                      <span className="text-slate-400">{lang === 'en' ? 'Order ID:' : 'Mã đơn hàng:'}</span>
                      <strong className="text-cyan-300 select-all">{displayOrderId}</strong>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">{lang === 'en' ? 'Payment Amount:' : 'Số tiền thanh toán:'}</span>
                      <strong className="text-emerald-400 tabular-nums font-bold">
                        {displayAmountVnd.toLocaleString('vi-VN')} VND
                      </strong>
                    </div>
                    <div className="flex justify-between items-center border-t border-white/[0.05] pt-1.5">
                      <span className="text-slate-400">{lang === 'en' ? 'Bank:' : 'Ngân hàng:'}</span>
                      <span className="text-white font-bold">{displayBank}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">{lang === 'en' ? 'Account Number:' : 'Số tài khoản:'}</span>
                      <span className="text-amber-300 font-bold select-all flex items-center gap-1.5">
                        {displayAccNum}
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(displayAccNum)}
                          className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-slate-300 hover:text-white"
                          title="Copy"
                        >
                          Copy
                        </button>
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">{lang === 'en' ? 'Account Holder:' : 'Chủ tài khoản:'}</span>
                      <span className="text-slate-200">{displayHolder}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-white/[0.05] pt-1.5">
                      <span className="text-slate-400">{lang === 'en' ? 'Transfer Memo:' : 'Nội dung CK:'}</span>
                      <span className="text-cyan-300 font-bold select-all flex items-center gap-1.5">
                        {displayMemo}
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(displayMemo)}
                          className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-slate-300 hover:text-white"
                          title="Copy"
                        >
                          Copy
                        </button>
                      </span>
                    </div>
                    <div className="flex justify-between items-center border-t border-white/[0.05] pt-1.5">
                      <span className="text-slate-400">{lang === 'en' ? 'Status:' : 'Trạng thái:'}</span>
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
                          ? (lang === 'en' ? '✓ PAID (CLOUD ACTIVATED)' : '✓ ĐÃ THANH TOÁN (KÍCH HOẠT CLOUD)')
                          : checkoutOrder.status === 'UNDERPAID'
                          ? (lang === 'en' ? '⚠ UNDERPAID (AWAITING BALANCE)' : '⚠ CHUYỂN THIẾU TIỀN (CHỜ BÙ)')
                          : checkoutOrder.status === 'EXPIRED'
                          ? (lang === 'en' ? '✕ ORDER EXPIRED' : '✕ ĐƠN HÀNG ĐÃ HẾT HẠN')
                          : (lang === 'en' ? '⏳ AWAITING PAYMENT...' : '⏳ ĐANG CHỜ WEBHOOK SEPAY...')}
                      </strong>
                    </div>
                    {checkoutOrder.status === 'UNDERPAID' && (
                      <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-[11px] text-rose-200">
                        {lang === 'en'
                          ? `Received: ${Number(checkoutOrder.paid_amount_vnd || 0).toLocaleString('vi-VN')} VND. Please transfer the remaining ${Math.max(0, displayAmountVnd - Number(checkoutOrder.paid_amount_vnd || 0)).toLocaleString('vi-VN')} VND with the same memo ${displayMemo}.`
                          : `Đã nhận: ${Number(checkoutOrder.paid_amount_vnd || 0).toLocaleString('vi-VN')} VND. Vui lòng chuyển khoản bù thêm ${Math.max(0, displayAmountVnd - Number(checkoutOrder.paid_amount_vnd || 0)).toLocaleString('vi-VN')} VND với cùng nội dung ${displayMemo} để hệ thống tự động kích hoạt.`}
                      </div>
                    )}
                    {checkoutOrder.status === 'EXPIRED' && (
                      <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-[11px] text-rose-200">
                        {lang === 'en'
                          ? 'This order has expired. Please close this modal and create a new order.'
                          : 'Đơn thanh toán đã quá thời hạn giữ tỷ giá (15 phút). Vui lòng đóng cửa sổ này và bấm Tạo Mã QR SePay mới.'}
                      </div>
                    )}
                  </div>

                  {pollingPaid && checkoutOrder.status !== 'PAID' && checkoutOrder.status !== 'EXPIRED' && (
                    <div className="pt-1 text-[11px] font-mono text-slate-400">
                      {lang === 'en'
                        ? 'Checking payment status every 3s automatically...'
                        : 'Hệ thống tự động kiểm tra giao dịch SePay mỗi 3 giây...'}
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
};
