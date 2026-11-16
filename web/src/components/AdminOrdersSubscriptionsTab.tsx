import React, { useState, useEffect } from 'react';
import { fmtNum, fmtTime } from '../utils/strategyDecision';

export const AdminOrdersSubscriptionsTab: React.FC = () => {
  const [summary, setSummary] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  const [manualUserId, setManualUserId] = useState('');
  const [manualTier, setManualTier] = useState('PRO');
  const [manualSlots, setManualSlots] = useState(2);
  const [manualDays, setManualDays] = useState(30);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sumRes, ordRes] = await Promise.all([
        fetch('/api/admin/billing/summary', { credentials: 'include' }),
        fetch(
          `/api/admin/billing/orders${statusFilter !== 'ALL' ? `?status=${statusFilter}` : ''}`,
          { credentials: 'include' }
        ),
      ]);
      if (sumRes.ok) setSummary(await sumRes.json());
      if (ordRes.ok) {
        const data = await ordRes.json();
        setOrders(data.orders || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [statusFilter]);

  const handleManualApproveOrder = async (orderCode: string, amountVnd: number) => {
    setActionMsg(`Đang kích hoạt thanh toán thủ công cho mã đơn ${orderCode}...`);
    try {
      const res = await fetch('/api/v1/webhooks/sepay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          content: `MANUAL APPROVE ${orderCode}`,
          transferAmount: amountVnd,
          referenceCode: `ADMIN-${Date.now()}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setActionMsg(`Đã duyệt đơn ${orderCode} và cấp phát khe cắm Cloud MT5 thành công.`);
        fetchData();
      } else {
        setActionMsg(`Lỗi duyệt đơn: ${data.reason || data.detail || res.status}`);
      }
    } catch (e: any) {
      setActionMsg(`Lỗi kết nối: ${e.message}`);
    }
  };

  const handleGrantSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualUserId.trim()) return;
    setActionMsg('Đang cấp quyền thuê bao Cloud...');
    try {
      const res = await fetch('/api/admin/billing/grant-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          user_id: manualUserId.trim(),
          plan_tier: manualTier,
          max_cloud_accounts: Number(manualSlots) || 1,
          duration_days: Number(manualDays) || 30,
        }),
      });
      if (res.ok) {
        setActionMsg(`Đã nâng cấp gói ${manualTier} (${manualSlots} khe cắm) cho ${manualUserId}.`);
        setManualUserId('');
        fetchData();
      } else {
        const d = await res.json().catch(() => ({}));
        setActionMsg(`Lỗi: ${d.detail || res.status}`);
      }
    } catch (e: any) {
      setActionMsg(`Lỗi: ${e.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Row 1: 4 Revenue & Subscription Bento KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-slate-400">
            Tổng Doanh Thu (VND)
          </div>
          <div className="mt-2.5 font-mono text-2xl font-extrabold text-emerald-400 tabular-nums">
            {(summary?.orders?.paid_revenue_vnd || 0).toLocaleString('vi-VN')} ₫
          </div>
          <div className="mt-3 border-t border-white/[0.06] pt-2.5 font-mono text-xs text-slate-400 tabular-nums">
            Quy đổi: <strong className="text-white">${fmtNum(summary?.orders?.paid_revenue_usd || 0, 2)}</strong>
          </div>
        </div>

        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-slate-400">
            Đơn Hàng Đã Thanh Toán
          </div>
          <div className="mt-2.5 font-mono text-2xl font-extrabold text-cyan-300 tabular-nums">
            {summary?.orders?.paid_orders || 0} / {summary?.orders?.total_orders || 0}
          </div>
          <div className="mt-3 border-t border-white/[0.06] pt-2.5 font-mono text-xs text-slate-400 tabular-nums">
            Đang chờ quét QR: <strong className="text-amber-300">{summary?.orders?.pending_orders || 0}</strong>
          </div>
        </div>

        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-slate-400">
            Thuê Bao Cloud Đang Chạy
          </div>
          <div className="mt-2.5 font-mono text-2xl font-extrabold text-white tabular-nums">
            {summary?.subscriptions?.active_subs || 0}
          </div>
          <div className="mt-3 border-t border-white/[0.06] pt-2.5 font-mono text-xs text-slate-400 tabular-nums">
            Tổng khe cắm đã cấp:{' '}
            <strong className="text-emerald-300">{summary?.subscriptions?.allocated_slots || 0}</strong>
          </div>
        </div>

        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-slate-400">
            Trạm MT5 Đã Triển Khai
          </div>
          <div className="mt-2.5 font-mono text-2xl font-extrabold text-amber-300 tabular-nums">
            {summary?.cloud_accounts?.deployed_count || 0} / {summary?.cloud_accounts?.total_cloud || 0}
          </div>
          <div className="mt-3 border-t border-white/[0.06] pt-2.5 font-mono text-xs text-slate-400">
            Đồng bộ thời gian thực MetaAPI
          </div>
        </div>
      </div>

      {actionMsg && (
        <div className="rounded-xl border border-cyan-500/35 bg-cyan-950/30 px-4 py-3 font-mono text-xs text-cyan-200">
          {actionMsg}
        </div>
      )}

      {/* Row 2: Orders Ledger & Manual Grant Form */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 8 Cols: SePay Orders Ledger */}
        <div className="quant-panel p-6 space-y-4 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
                Đối Soát Giao Dịch SePay
              </span>
              <h3 className="mt-0.5 text-base font-bold text-white">Sổ Cái Đơn Hàng & Webhook VietQR</h3>
            </div>

            <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#040710] p-1">
              {['ALL', 'PENDING', 'PAID'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-lg px-3 py-1 font-mono text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                    statusFilter === st
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {st === 'ALL' ? 'Tất Cả' : st}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-[#040710]/85">
            <table className="quant-table">
              <thead>
                <tr>
                  <th>Mã Đơn / Thời Gian</th>
                  <th>Khách Hàng</th>
                  <th>Gói / Khe Cắm</th>
                  <th className="text-right">Số Tiền</th>
                  <th>Trạng Thái</th>
                  <th className="text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                      Đang tải danh sách đơn hàng...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                      Không có đơn hàng nào trong bộ lọc này.
                    </td>
                  </tr>
                ) : (
                  orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <div className="font-mono text-xs font-bold text-cyan-300">{o.order_code}</div>
                        <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {fmtTime(o.created_at)}
                        </div>
                      </td>
                      <td>
                        <div className="text-xs font-semibold text-white">{o.user_email || o.user_id}</div>
                        <div className="font-mono text-[11px] text-slate-500">{o.user_id}</div>
                      </td>
                      <td className="font-mono text-xs text-slate-200">
                        {o.plan_tier} · {o.cloud_accounts_count} MT5 ({o.billing_cycle})
                      </td>
                      <td className="text-right font-mono text-xs tabular-nums">
                        <div className="font-bold text-emerald-400">
                          {Number(o.amount_vnd || 0).toLocaleString('vi-VN')} ₫
                        </div>
                        <div className="text-[11px] text-slate-500">${fmtNum(o.amount_usd, 2)}</div>
                      </td>
                      <td className="font-mono text-xs">
                        <span
                          className={
                            o.status === 'PAID'
                              ? 'font-bold text-emerald-400'
                              : 'font-semibold text-amber-300'
                          }
                        >
                          {o.status}
                        </span>
                      </td>
                      <td className="text-right">
                        {o.status !== 'PAID' ? (
                          <button
                            type="button"
                            onClick={() => handleManualApproveOrder(o.order_code, Number(o.amount_vnd || 0))}
                            className="rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-3 py-1 font-mono text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/25 whitespace-nowrap shrink-0"
                          >
                            Duyệt Thủ Công
                          </button>
                        ) : (
                          <span className="font-mono text-[11px] text-slate-500">Đã kích hoạt</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right 4 Cols: Manual Grant Subscription */}
        <div className="quant-panel p-6 space-y-4 lg:col-span-4">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-400">
              Cấp Phát Đặc Quyền
            </span>
            <h3 className="mt-0.5 text-base font-bold text-white">Cấp Gói Cloud MT5 Thủ Công</h3>
          </div>

          <form onSubmit={handleGrantSubscription} className="space-y-3.5">
            <div>
              <label className="mb-1 block text-xs text-slate-300">User ID hoặc Email khách hàng</label>
              <input
                type="text"
                required
                placeholder="VD: trader@zupirus.local"
                value={manualUserId}
                onChange={(e) => setManualUserId(e.target.value)}
                className="quant-input font-mono text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-300">Hạng gói thuê bao</label>
              <select
                value={manualTier}
                onChange={(e) => setManualTier(e.target.value)}
                className="quant-input font-mono text-xs"
              >
                <option value="STARTER">STARTER ($39)</option>
                <option value="PRO">QUANT PRO ($59)</option>
                <option value="INSTITUTIONAL">INSTITUTIONAL ($149)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-300">Số khe cắm MT5</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={manualSlots}
                  onChange={(e) => setManualSlots(Number(e.target.value))}
                  className="quant-input font-mono text-xs tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">Số ngày hiệu lực</label>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={manualDays}
                  onChange={(e) => setManualDays(Number(e.target.value))}
                  className="quant-input font-mono text-xs tabular-nums"
                />
              </div>
            </div>

            <button type="submit" className="quant-btn-primary w-full py-2.5 text-xs">
              Kích Hoạt Thuê Bao Ngay
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
