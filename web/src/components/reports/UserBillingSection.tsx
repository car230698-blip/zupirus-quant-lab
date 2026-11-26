import React, { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { Panel, StatusBadge, EmptyState } from '../ui/Primitives';
import { Download, Eye, ReceiptText, Share2, X } from 'lucide-react';

interface ReferralInfo {
  referral_code: string;
  invite_url: string;
  referred_count: number;
  bonus_days_earned: number;
  referred_by: string | null;
  reward_rule: string;
}

interface BillingOrderItem {
  id: string;
  order_code?: string;
  payment_code?: string;
  report_id?: string;
  report_version?: string;
  title?: string;
  plan_tier?: string;
  amount_vnd?: number;
  expected_amount_vnd?: number;
  paid_amount_vnd?: number;
  amount_usd?: number;
  amount?: number;
  currency?: string;
  network?: string;
  status: string;
  created_at: number;
  paid_at?: number;
}

export const UserBillingSection: React.FC = () => {
  const { lang } = useLanguage();
  const [refInfo, setRefInfo] = useState<ReferralInfo | null>(null);
  const [orders, setOrders] = useState<BillingOrderItem[]>([]);
  const [applyCode, setApplyCode] = useState('');
  const [refMsg, setRefMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [previewOrder, setPreviewOrder] = useState<BillingOrderItem | null>(null);

  useEffect(() => {
    const loadBillingData = () => {
      apiGet<ReferralInfo>('/api/v1/referral/me')
        .then((d) => d && setRefInfo(d))
        .catch(() => {});

      apiGet<{ orders: BillingOrderItem[] }>('/api/v1/billing/my-orders')
        .then((d) => d?.orders && setOrders(d.orders))
        .catch(() => {});
    };

    loadBillingData();
    const handleRefresh = () => loadBillingData();
    window.addEventListener('zupirus:user-refresh', handleRefresh);
    return () => {
      window.removeEventListener('zupirus:user-refresh', handleRefresh);
    };
  }, []);

  const handleApplyReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyCode.trim()) return;
    setRefMsg(null);
    try {
      const d = await apiPost<{ message?: string }>('/api/v1/referral/apply', { code: applyCode.trim() });
      setRefMsg(d?.message || (lang === 'en' ? 'Referral code applied!' : 'Áp dụng mã giới thiệu thành công!'));
      setApplyCode('');
      const refreshed = await apiGet<ReferralInfo>('/api/v1/referral/me').catch(() => null);
      if (refreshed) setRefInfo(refreshed);
    } catch (err: any) {
      setRefMsg(`${lang === 'en' ? 'Error' : 'Lỗi'}: ${err?.message || String(err)}`);
    }
  };

  const escapeHtml = (raw: unknown) =>
    String(raw ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const formatAmount = (ord: BillingOrderItem) => {
    const vnd = Number(ord.paid_amount_vnd ?? ord.amount_vnd ?? ord.expected_amount_vnd ?? 0);
    const usd = Number(ord.amount_usd ?? ord.amount ?? 0);
    if (vnd > 0) return `${vnd.toLocaleString('vi-VN')} đ`;
    if (usd > 0) return `$${usd.toFixed(2)} USDT`;
    return '—';
  };

  const handleDownloadReceipt = (ord: BillingOrderItem) => {
    const paidDate = new Date((ord.paid_at || ord.created_at || Date.now() / 1000) * 1000).toLocaleString('vi-VN');
    const code = ord.order_code || ord.payment_code || ord.id;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Biên lai ZUPIRUS - ${escapeHtml(code)}</title>
    <style>body{font-family:system-ui,sans-serif;padding:40px;color:#0f172a;max-width:680px;margin:auto;background:#fff}
    h1{margin:0;font-size:20px;color:#0f172a}table{width:100%;border-collapse:collapse;margin-top:24px}
    th,td{border:1px solid #cbd5e1;padding:10px;text-align:left;font-size:13px}th{background:#f8fafc}</style></head>
    <body>
      <h1>ZUPIRUS QUANT LAB — BIÊN LAI ẤN PHẨM ĐỊNH LƯỢNG</h1>
      <p><strong>Mã đơn hàng:</strong> ${escapeHtml(code)}<br/>
      <strong>Trạng thái:</strong> ${escapeHtml(ord.status)}<br/>
      <strong>Thời gian:</strong> ${escapeHtml(paidDate)}</p>
      <table>
        <tr><th>Ấn phẩm / Mục</th><th>Phiên bản</th><th>Số tiền</th></tr>
        <tr><td>${escapeHtml(ord.title || ord.report_id || ord.plan_tier || 'PDF Research Report')}</td>
        <td>${escapeHtml(ord.report_version || 'v1.0')}</td>
        <td><strong>${escapeHtml(formatAmount(ord))}</strong></td></tr>
      </table>
      <p style="margin-top:24px;font-size:12px;color:#64748b">ZUPIRUS Quant Lab — https://zupirus.com</p>
    </body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zupirus-receipt-${String(code).replace(/[^a-zA-Z0-9_-]/g, '')}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left 5 cols: Referral / Affiliate Card */}
      <Panel
        className="lg:col-span-5"
        icon={<Share2 className="h-4 w-4 text-[#12B5A6]" />}
        title={lang === 'en' ? 'Share the Library' : 'Chương trình giới thiệu'}
        subtitle={lang === 'en' ? 'Invite colleagues to ZUPIRUS Quant Lab' : 'Chia sẻ đường dẫn thư viện ấn phẩm'}
        action={
          <StatusBadge tone="success">
            +{refInfo?.bonus_days_earned ?? 0} {lang === 'en' ? 'credits' : 'lượt thưởng'}
          </StatusBadge>
        }
        bodyClassName="p-5 space-y-4"
      >
        <p className="text-xs text-slate-300 leading-relaxed">
          {refInfo?.reward_rule ||
            (lang === 'en'
              ? 'Referral incentives, if configured, apply strictly to research catalog access and are not trading returns.'
              : 'Ưu đãi giới thiệu (nếu có) áp dụng cho quyền truy cập tài liệu nghiên cứu và không phải lợi nhuận giao dịch.')}
        </p>

        {refInfo && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              readOnly
              value={refInfo.invite_url}
              className="quant-input flex-1 font-mono text-xs text-cyan-300"
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(refInfo.invite_url).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="quant-btn-primary text-xs"
            >
              {copied ? (lang === 'en' ? 'Copied' : 'Đã sao chép') : `Copy (${refInfo.referral_code})`}
            </button>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-800 pt-3 font-mono text-xs text-slate-400">
          <span>
            {lang === 'en' ? 'Referred readers: ' : 'Đã giới thiệu: '}
            <strong className="text-white tabular-nums">{refInfo?.referred_count ?? 0}</strong>
          </span>
          {refInfo?.referred_by && (
            <span className="text-emerald-300">
              {lang === 'en' ? 'Referred by: ' : 'Mã đã áp dụng: '}
              {refInfo.referred_by}
            </span>
          )}
        </div>

        {!refInfo?.referred_by && (
          <form onSubmit={handleApplyReferral} className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={applyCode}
              onChange={(e) => setApplyCode(e.target.value)}
              placeholder={lang === 'en' ? 'Enter referral code (ZUP-XXXXXX)' : 'Nhập mã giới thiệu (VD: ZUP-XXXXXX)'}
              className="quant-input flex-1 font-mono text-xs uppercase"
            />
            <button type="submit" className="quant-btn-secondary text-xs">
              {lang === 'en' ? 'Apply' : 'Áp dụng'}
            </button>
          </form>
        )}
        {refMsg && <div className="font-mono text-xs text-amber-300">{refMsg}</div>}
      </Panel>

      {/* Right 7 cols: Orders & Receipts Table */}
      <Panel
        className="lg:col-span-7"
        icon={<ReceiptText className="h-4 w-4 text-cyan-300" />}
        title={lang === 'en' ? 'Orders & Digital Receipts' : 'Lịch sử đơn hàng & Biên lai điện tử'}
        subtitle={lang === 'en' ? 'USDT on-chain checkout records' : 'Biên lai đối soát thanh toán USDT'}
        action={
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {orders.length} {lang === 'en' ? 'orders' : 'đơn'}
          </span>
        }
        bodyClassName="p-5"
      >
        {orders.length === 0 ? (
          <EmptyState
            icon={<ReceiptText className="h-5 w-5" />}
            title={lang === 'en' ? 'No orders yet' : 'Chưa có đơn hàng nào'}
            description={
              lang === 'en'
                ? 'Digital receipts will appear here after you purchase a research report.'
                : 'Biên lai điện tử sẽ xuất hiện tại đây sau khi bạn mua báo cáo PDF.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="quant-table font-mono text-xs tabular-nums">
              <thead>
                <tr>
                  <th>{lang === 'en' ? 'Order' : 'Mã đơn'}</th>
                  <th>{lang === 'en' ? 'Publication' : 'Ấn phẩm'}</th>
                  <th>{lang === 'en' ? 'Amount' : 'Số tiền'}</th>
                  <th>{lang === 'en' ? 'Status' : 'Trạng thái'}</th>
                  <th className="text-right">{lang === 'en' ? 'Receipt' : 'Biên lai'}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((ord) => {
                  const st = String(ord.status || '').toUpperCase();
                  return (
                    <tr key={ord.id}>
                      <td className="font-bold text-white">{ord.order_code || ord.payment_code || ord.id}</td>
                      <td className="font-sans text-slate-200 max-w-[220px] truncate">
                        {ord.title || ord.report_id || ord.plan_tier || 'PDF Report'}
                      </td>
                      <td className="font-semibold text-emerald-400">{formatAmount(ord)}</td>
                      <td>
                        <StatusBadge tone={st === 'PAID' ? 'success' : 'warning'}>{st}</StatusBadge>
                      </td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewOrder(ord)}
                            className="quant-quiet min-h-[30px] px-2.5 py-1 text-[11px]"
                            title={lang === 'en' ? 'Preview receipt' : 'Xem trước biên lai'}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>{lang === 'en' ? 'View' : 'Xem'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadReceipt(ord)}
                            className="quant-quiet min-h-[30px] px-2.5 py-1 text-[11px]"
                            title={lang === 'en' ? 'Download receipt' : 'Tải biên lai'}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Inline Receipt Preview Modal (replaces window.open) */}
      {previewOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#0B1220] p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="font-mono text-xs uppercase text-[#12B5A6]">ZUPIRUS DIGITAL RECEIPT</div>
                <h4 className="mt-0.5 text-base font-bold text-white">
                  {previewOrder.order_code || previewOrder.payment_code || previewOrder.id}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOrder(null)}
                className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#060A13] p-4 space-y-2.5 text-xs">
              <div className="flex justify-between gap-4">
                <span className="text-slate-400">{lang === 'en' ? 'Publication:' : 'Ấn phẩm:'}</span>
                <span className="font-semibold text-white text-right">
                  {previewOrder.title || previewOrder.report_id || 'PDF Research Report'}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-400">{lang === 'en' ? 'Version:' : 'Phiên bản:'}</span>
                <span className="font-mono text-slate-200">{previewOrder.report_version || 'v1.0'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-400">{lang === 'en' ? 'Amount:' : 'Số tiền:'}</span>
                <span className="font-mono font-bold text-emerald-400">{formatAmount(previewOrder)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-400">{lang === 'en' ? 'Status:' : 'Trạng thái:'}</span>
                <StatusBadge tone={previewOrder.status === 'PAID' ? 'success' : 'warning'}>
                  {previewOrder.status}
                </StatusBadge>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-400">{lang === 'en' ? 'Timestamp:' : 'Thời gian:'}</span>
                <span className="font-mono text-slate-300">
                  {new Date((previewOrder.paid_at || previewOrder.created_at || 0) * 1000).toLocaleString('vi-VN')}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button type="button" onClick={() => setPreviewOrder(null)} className="quant-btn-secondary text-xs">
                {lang === 'en' ? 'Close' : 'Đóng'}
              </button>
              <button
                type="button"
                onClick={() => handleDownloadReceipt(previewOrder)}
                className="quant-btn-primary text-xs"
              >
                <Download className="h-4 w-4" />
                <span>{lang === 'en' ? 'Download Receipt' : 'Tải Biên Lai'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
