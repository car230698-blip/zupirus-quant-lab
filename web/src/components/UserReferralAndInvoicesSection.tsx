import React, { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.ts';

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
  payment_code?: string;
  plan_tier: string;
  cloud_slots_count: number;
  expected_amount_vnd: number;
  paid_amount_vnd?: number;
  status: string;
  created_at: number;
  paid_at?: number;
}

export const UserReferralAndInvoicesSection: React.FC = () => {
  const [refInfo, setRefInfo] = useState<ReferralInfo | null>(null);
  const [orders, setOrders] = useState<BillingOrderItem[]>([]);
  const [applyCode, setApplyCode] = useState('');
  const [refMsg, setRefMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      setRefMsg(d?.message || 'Áp dụng mã giới thiệu thành công!');
      setApplyCode('');
      const refreshed = await apiGet<ReferralInfo>('/api/v1/referral/me').catch(() => null);
      if (refreshed) setRefInfo(refreshed);
    } catch (err: any) {
      setRefMsg(`Lỗi: ${err.message || String(err)}`);
    }
  };

  const escapeHtml = (raw: unknown) =>
    String(raw ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const handlePrintInvoice = (ord: BillingOrderItem) => {
    if (String(ord.status || '').toUpperCase() !== 'PAID') {
      return;
    }
    const w = window.open('', '_blank', 'width=760,height=840');
    if (!w) return;
    const paidDate = ord.paid_at
      ? new Date(ord.paid_at * 1000).toLocaleString('vi-VN')
      : new Date(ord.created_at * 1000).toLocaleString('vi-VN');
    const amount = Number(ord.paid_amount_vnd || ord.expected_amount_vnd || 0).toLocaleString('vi-VN');
    const safeCode = escapeHtml(ord.payment_code || ord.id);
    const safeStatus = escapeHtml(ord.status);
    const safeTier = escapeHtml(String(ord.plan_tier).toUpperCase());
    const safeSlots = escapeHtml(ord.cloud_slots_count);
    w.document.write(`
      <!doctype html><html><head><meta charset="utf-8"><title>Hóa Đơn ZUPIRUS - ${safeCode}</title>
      <style>body{font-family:Arial,sans-serif;padding:40px;color:#0f172a;max-width:680px;margin:auto}
      h1{margin:0;color:#b45309}table{width:100%;border-collapse:collapse;margin-top:24px}
      th,td{border:1px solid #cbd5e1;padding:10px;text-align:left}th{background:#f8fafc}</style></head>
      <body>
        <h1>ZUPIRUS QUANT LAB — BIÊN LAI THANH TOÁN</h1>
        <p><strong>Mã đơn hàng:</strong> ${safeCode}<br/>
        <strong>Trạng thái:</strong> ${safeStatus}<br/>
        <strong>Thời gian:</strong> ${escapeHtml(paidDate)}</p>
        <table>
          <tr><th>Dịch vụ</th><th>Số Slot MT5</th><th>Thành tiền (VND)</th></tr>
          <tr><td>Gói Cloud MT5 ${safeTier}</td><td>${safeSlots}</td><td><strong>${escapeHtml(amount)} ₫</strong></td></tr>
        </table>
        <p style="margin-top:28px;font-size:12px;color:#64748b">Xác nhận tự động bởi hệ thống đối soát SePay VietQR — https://app.zupirus.com</p>
      </body></html>
    `);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left 6 cols: Referral / Affiliate Card */}
      <div className="lg:col-span-6 quant-panel p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
              CHƯƠNG TRÌNH GIỚI THIỆU (AFFILIATE)
            </span>
            <h3 className="mt-0.5 text-base font-bold text-white">Mời Bạn Bè — Nhận +7 Ngày Cloud MT5</h3>
          </div>
          <span className="rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-2.5 py-1 font-mono text-xs font-bold text-emerald-300">
            +{refInfo?.bonus_days_earned ?? 0} ngày
          </span>
        </div>

        <p className="text-xs text-slate-300">
          {refInfo?.reward_rule || 'Tặng +7 ngày Cloud MT5 cho người giới thiệu và +3 ngày chào mừng cho người được mời.'}
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
              className="quant-btn-primary px-3.5 py-2 text-xs whitespace-nowrap"
            >
              {copied ? 'Đã Copy ✓' : `Copy (${refInfo.referral_code})`}
            </button>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-white/10 pt-3 font-mono text-xs text-slate-400">
          <span>Đã giới thiệu thành công: <strong className="text-white">{refInfo?.referred_count ?? 0}</strong> bạn</span>
          {refInfo?.referred_by && <span className="text-emerald-300">Đã nhập mã: {refInfo.referred_by}</span>}
        </div>

        {!refInfo?.referred_by && (
          <form onSubmit={handleApplyReferral} className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={applyCode}
              onChange={(e) => setApplyCode(e.target.value)}
              placeholder="Nhập mã giới thiệu (VD: ZUP-XXXXXX)"
              className="quant-input flex-1 font-mono text-xs uppercase"
            />
            <button type="submit" className="quant-btn-secondary px-3.5 py-2 text-xs whitespace-nowrap">
              Áp Dụng (+3 ngày)
            </button>
          </form>
        )}
        {refMsg && <div className="font-mono text-xs text-amber-300">{refMsg}</div>}
      </div>

      {/* Right 6 cols: SePay Invoice History & Printable PDF */}
      <div className="lg:col-span-6 quant-panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300">
              LỊCH SỬ THANH TOÁN SEPAY
            </span>
            <h3 className="mt-0.5 text-base font-bold text-white">Đơn Hàng & Hóa Đơn Điện Tử (PDF)</h3>
          </div>
          <span className="font-mono text-xs text-slate-400">{orders.length} đơn</span>
        </div>

        {orders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-[#040710]/50 p-6 text-center text-xs text-slate-400">
            Chưa có giao dịch SePay nào. Sau khi tạo đơn hoặc gia hạn gói, biên lai điện tử sẽ xuất hiện tại đây.
          </div>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1 font-mono text-xs tabular-nums">
            {orders.map((ord) => (
              <div
                key={ord.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#040814] px-3.5 py-2.5"
              >
                <div>
                  <div className="font-bold text-white">
                    {ord.payment_code || ord.id}{' '}
                    <span className="text-amber-300">· {String(ord.plan_tier).toUpperCase()}</span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {Number(ord.paid_amount_vnd || ord.expected_amount_vnd || 0).toLocaleString('vi-VN')} ₫ ·{' '}
                    <span className={ord.status === 'PAID' ? 'text-emerald-400' : 'text-amber-300'}>
                      {ord.status}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handlePrintInvoice(ord)}
                  className="quant-btn-secondary px-2.5 py-1 text-[11px] whitespace-nowrap"
                >
                  In / Tải PDF
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
