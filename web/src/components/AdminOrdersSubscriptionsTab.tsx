import React, { useState, useEffect } from 'react';

interface OrderItem {
  id: string;
  user_id: string;
  user_email?: string;
  amount_usd: number;
  amount_vnd: number;
  locked_exchange_rate: number;
  plan_tier: string;
  cloud_slots_count: number;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  payment_gateway: string;
  created_at: number;
  expires_at?: number;
}

interface RevenueStats {
  total_orders: number;
  total_revenue_usd: number;
  total_revenue_vnd: number;
  pending_orders: number;
  paid_orders: number;
  current_fx_rate: number;
  fx_source: string;
}

export const AdminOrdersSubscriptionsTab: React.FC = () => {
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [stats, setStats] = useState<RevenueStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Manual Approve Form state
  const [manualEmail, setManualEmail] = useState('');
  const [manualAmountVnd, setManualAmountVnd] = useState('');
  const [manualGateway, setManualGateway] = useState('VietinBank');
  const [manualRefCode, setManualRefCode] = useState('');
  const [manualNote, setManualNote] = useState('Duyệt thanh toán SePay cho khách');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualMsg, setManualMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  async function loadData() {
    setLoading(true);
    try {
      const [revRes, ordRes] = await Promise.all([
        fetch('/api/v1/billing/admin/revenue'),
        fetch(`/api/v1/billing/admin/orders?status=${statusFilter}`),
      ]);
      if (revRes.ok) {
        const revData = await revRes.json();
        setStats(revData);
      }
      if (ordRes.ok) {
        const ordData = await ordRes.json();
        setOrders(ordData.orders || []);
      }
    } catch (e) {
      console.error('Error fetching admin orders:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  async function handleManualApprove(e: React.FormEvent) {
    e.preventDefault();
    setManualSubmitting(true);
    setManualMsg(null);
    try {
      const res = await fetch('/api/admin/payments/manual-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({
          user_email: manualEmail.trim(),
          amount_vnd: Number(manualAmountVnd),
          gateway: manualGateway,
          reference_code: manualRefCode.trim(),
          note: manualNote.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setManualMsg({
          text: data.message || `Đã kích hoạt thành công đơn cho ${manualEmail}!`,
          type: 'success',
        });
        setManualEmail('');
        setManualAmountVnd('');
        setManualRefCode('');
        await loadData();
      } else {
        setManualMsg({
          text: data.detail || 'Lỗi khi duyệt thủ công.',
          type: 'error',
        });
      }
    } catch (err: any) {
      setManualMsg({ text: err.message || String(err), type: 'error' });
    } finally {
      setManualSubmitting(false);
    }
  }

  const filteredOrders = orders.filter((o) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.id.toLowerCase().includes(q) ||
      (o.user_email && o.user_email.toLowerCase().includes(q)) ||
      o.plan_tier.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-8 font-sans">
      {/* 1. Header Revenue & Subscription Stats (Bento Grid) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5 shadow-lg relative overflow-hidden">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Doanh Thu Thực Tế (USD)</div>
          <div className="mt-2 text-2xl font-black text-emerald-400 font-mono tabular-nums">
            ${stats ? stats.total_revenue_usd.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00'}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 font-mono">
            {stats ? stats.paid_orders : 0} đơn hàng đã hoàn tất
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5 shadow-lg relative overflow-hidden">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Doanh Thu VNĐ (VietQR)</div>
          <div className="mt-2 text-2xl font-black text-cyan-400 font-mono tabular-nums">
            {stats ? stats.total_revenue_vnd.toLocaleString('vi-VN') : '0'}₫
          </div>
          <div className="mt-1 text-[11px] text-slate-400 font-mono">
            Tỷ giá chốt: {stats ? Number(stats.current_fx_rate).toLocaleString('vi-VN') : '25.700'} đ
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5 shadow-lg relative overflow-hidden">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Đơn Chờ Thanh Toán</div>
          <div className="mt-2 text-2xl font-black text-amber-400 font-mono tabular-nums">
            {stats ? stats.pending_orders : 0}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 font-mono">
            Đang giữ tỷ giá trong 20 phút
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5 shadow-lg relative overflow-hidden">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Tổng Đơn Đã Tạo</div>
          <div className="mt-2 text-2xl font-black text-slate-100 font-mono tabular-nums">
            {stats ? stats.total_orders : 0}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 font-mono">
            100% Tự động qua SePay Webhook
          </div>
        </div>
      </div>

      {/* 2. Main Two-Column Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Col (2/3): SePay Orders Transaction Table */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-[#0B1120] p-6 shadow-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h3 className="font-bold text-sm text-slate-100 font-mono flex items-center gap-2">
                <span>📋 DANH SÁCH ĐƠN HÀNG SEPAY THỜI GIAN THỰC</span>
              </h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Quản lý các giao dịch VietQR, gói cước và trạng thái kích hoạt tự động.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadData}
                disabled={loading}
                className="text-xs font-mono text-cyan-400 hover:text-cyan-300 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800"
              >
                {loading ? 'Đang tải…' : '↻ Làm Mới'}
              </button>
            </div>
          </div>

          {/* Filters & Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
            <div className="flex items-center gap-1.5">
              {(['ALL', 'PAID', 'PENDING', 'EXPIRED'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                    statusFilter === st
                      ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/60 shadow'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {st === 'ALL' ? 'Tất Cả' : st === 'PAID' ? 'Đã Thanh Toán' : st === 'PENDING' ? 'Chờ Quét' : 'Hết Hạn'}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo Mã Đơn hoặc Email…"
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-1.5 text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400 w-full sm:w-60"
            />
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800/80">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-[#111827] text-slate-400 border-b border-slate-800 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-3.5">Mã Đơn / Memo</th>
                  <th className="py-3 px-3.5">Khách Hàng</th>
                  <th className="py-3 px-3.5">Gói Cước</th>
                  <th className="py-3 px-3.5 text-right">Số Tiền (VNĐ)</th>
                  <th className="py-3 px-3.5 text-center">Trạng Thái</th>
                  <th className="py-3 px-3.5 text-right">Thời Gian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-slate-500 text-xs">
                      Không có đơn hàng nào khớp với điều kiện lọc.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-200">{o.id}</div>
                        <div className="text-[10px] text-amber-400">ZP {o.id.slice(-6).toUpperCase()}</div>
                      </td>
                      <td className="py-3 px-3.5 text-slate-300">
                        {o.user_email || <span className="text-slate-500">Chưa xác định</span>}
                      </td>
                      <td className="py-3 px-3.5">
                        <span className="capitalize font-bold text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/50">
                          {o.plan_tier} ({o.cloud_slots_count} MT5)
                        </span>
                      </td>
                      <td className="py-3 px-3.5 text-right font-black text-emerald-400 tabular-nums">
                        {o.amount_vnd.toLocaleString('vi-VN')}₫
                        <div className="text-[10px] font-normal text-slate-500">${o.amount_usd} USD</div>
                      </td>
                      <td className="py-3 px-3.5 text-center">
                        {o.status === 'PAID' ? (
                          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-600/60">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Đã Trả
                          </span>
                        ) : o.status === 'PENDING' ? (
                          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-600/60 animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Chờ Quét
                          </span>
                        ) : (
                          <span className="rounded px-2 py-0.5 text-[10px] font-bold bg-slate-900 text-slate-500 border border-slate-800">
                            {o.status}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-right text-slate-400 text-[11px] tabular-nums">
                        {new Date(o.created_at * 1000).toLocaleString('vi-VN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Col (1/3): Manual Approve Tool & Tier Cards */}
        <div className="space-y-6">
          {/* Manual Approval Form */}
          <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-6 shadow-xl space-y-4">
            <div>
              <h3 className="font-bold text-sm text-slate-100 font-mono flex items-center gap-2">
                <span>⚡ DUYỆT THANH TOÁN THỦ CÔNG (MANUAL APPROVE)</span>
              </h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Kích hoạt tài khoản ngay khi khách chuyển khoản sai nội dung memo.
              </p>
            </div>

            {manualMsg && (
              <div
                className={`p-3 rounded-xl border text-xs font-mono ${
                  manualMsg.type === 'success'
                    ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                    : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
                }`}
              >
                {manualMsg.text}
              </div>
            )}

            <form onSubmit={handleManualApprove} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-slate-400 mb-1">EMAIL KHÁCH HÀNG *</label>
                <input
                  type="email"
                  required
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder="khachhang@gmail.com"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">SỐ TIỀN VNĐ *</label>
                  <input
                    type="number"
                    required
                    min={10000}
                    step={1000}
                    value={manualAmountVnd}
                    onChange={(e) => setManualAmountVnd(e.target.value)}
                    placeholder="772000"
                    className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-bold text-emerald-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">NGÂN HÀNG *</label>
                  <select
                    value={manualGateway}
                    onChange={(e) => setManualGateway(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  >
                    <option value="VietinBank">VietinBank</option>
                    <option value="MBBank">MBBank</option>
                    <option value="Vietcombank">Vietcombank</option>
                    <option value="Techcombank">Techcombank</option>
                    <option value="Chuyển Khoản Trực Tiếp">Khác / Trực Tiếp</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">MÃ GIAO DỊCH NGÂN HÀNG (BILL) *</label>
                <input
                  type="text"
                  required
                  value={manualRefCode}
                  onChange={(e) => setManualRefCode(e.target.value)}
                  placeholder="VD: FT261116892301"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">GHI CHÚ DUYỆT</label>
                <input
                  type="text"
                  value={manualNote}
                  onChange={(e) => setManualNote(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                />
              </div>

              <button
                type="submit"
                disabled={manualSubmitting}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs transition-all shadow-lg disabled:opacity-50 mt-2"
              >
                {manualSubmitting ? 'Đang kích hoạt…' : '✓ Duyệt & Kích Hoạt Gói Cho Khách ↗'}
              </button>
            </form>
          </div>

          {/* Pricing & Tier Breakdown */}
          <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-6 shadow-xl space-y-3 font-mono text-xs">
            <h4 className="font-bold text-slate-200">QUY CÁCH PHÂN CẤP GÓI CƯỚC</h4>
            <div className="space-y-2 text-slate-300 text-[11px]">
              <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 flex justify-between items-center">
                <div>
                  <span className="font-bold text-slate-100">STARTER</span>
                  <span className="text-slate-400 block text-[10px]">1 Cloud MT5 Slot · Standard USD</span>
                </div>
                <span className="font-bold text-cyan-300">$30 / tháng</span>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 flex justify-between items-center">
                <div>
                  <span className="font-bold text-slate-100">GROWTH</span>
                  <span className="text-slate-400 block text-[10px]">3 Cloud MT5 Slots · Cent USC (1:100) & ECN</span>
                </div>
                <span className="font-bold text-emerald-400">$45 / tháng</span>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 flex justify-between items-center">
                <div>
                  <span className="font-bold text-slate-100">ALPHA (VIP)</span>
                  <span className="text-slate-400 block text-[10px]">5 Cloud MT5 Slots · Mở Khóa Prop Firm Mode</span>
                </div>
                <span className="font-bold text-purple-300">$99 / tháng</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
