import React, { useCallback, useEffect, useState } from 'react';
import { AdminBillingSettingsTab } from './AdminBillingSettingsTab.tsx';
import { ToastNotification } from './ToastNotification.tsx';

export interface AdminBusinessCustomersTabProps {
  accounts: any[];
  refetchAll: () => void;
}

export const AdminBusinessCustomersTab: React.FC<AdminBusinessCustomersTabProps> = ({
  accounts = [],
  refetchAll,
}) => {
  const [summary, setSummary] = useState<any>({ orders: { paid_revenue_vnd: 0 } });
  const [orders, setOrders] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'EXCEPTIONS' | 'PAID'>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const loadBilling = useCallback(async () => {
    try {
      const [sRes, oRes, uRes] = await Promise.all([
        fetch('/api/admin/billing/summary', { credentials: 'include' }),
        fetch('/api/admin/billing/orders', { credentials: 'include' }),
        fetch('/api/admin/users', { credentials: 'include' }),
      ]);
      if (sRes.ok) setSummary(await sRes.json());
      if (oRes.ok) {
        const d = await oRes.json();
        setOrders(d.orders || d || []);
      }
      if (uRes.ok) {
        const ud = await uRes.json();
        setUsers(ud.users || ud || []);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  const handleManualApproveOrder = async (orderId: string) => {
    setBusyId(orderId);
    try {
      const res = await fetch(`/api/admin/billing/orders/${encodeURIComponent(orderId)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        credentials: 'include',
      });
      if (res.ok) {
        setMsg(`Đã duyệt bù đơn hàng ${orderId} và kích hoạt gói cước.`);
        await loadBilling();
      } else {
        setMsg('Không thể duyệt bù đơn hàng.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleAccountAction = async (accId: string, action: 'toggle' | 'delete', currentlyActive?: boolean) => {
    if (action === 'delete' && !window.confirm('Xác nhận xóa tài khoản MT5 vi phạm này khỏi hệ thống?')) {
      return;
    }
    setBusyId(accId);
    try {
      const url =
        action === 'delete'
          ? `/api/v1/accounts/${encodeURIComponent(accId)}`
          : `/api/v1/accounts/${encodeURIComponent(accId)}/toggle`;
      const res = await fetch(url, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        credentials: 'include',
        body: action === 'toggle' ? JSON.stringify({ is_active: !currentlyActive }) : undefined,
      });
      if (res.ok) {
        setMsg(action === 'delete' ? 'Đã xóa tài khoản vi phạm.' : 'Đã cập nhật trạng thái nhận lệnh của tài khoản.');
        refetchAll();
      } else {
        setMsg(action === 'delete' ? 'Lỗi: Không thể xóa tài khoản.' : 'Lỗi: Không thể cập nhật trạng thái tài khoản.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const filteredOrders = orders.filter((o: any) => {
    const st = String(o.status || '').toUpperCase();
    if (statusFilter === 'PAID') return st === 'PAID';
    if (statusFilter === 'EXCEPTIONS') return st !== 'PAID';
    return true;
  });

  return (
    <div className="space-y-6">
      <ToastNotification message={msg || null} type="info" onClose={() => setMsg('')} />

      {/* 1. SePay & FX Configuration */}
      <AdminBillingSettingsTab />

      {/* 2. Revenue & Orders (Manual intervention ONLY for exceptions/underpaid) */}
      <div className="quant-panel p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-emerald-400">
              Đối Soát Tự Động SePay
            </div>
            <h3 className="mt-1 text-base font-bold text-white">
              Doanh Thu &amp; Đơn Hàng (Chỉ Duyệt Bù Khi Có Ngoại Lệ)
            </h3>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2">
              <span className="text-slate-400">Tổng doanh thu: </span>
              <span className="font-mono font-extrabold text-emerald-300">
                {Number(summary.orders?.paid_revenue_vnd ?? summary.total_revenue_vnd ?? 0).toLocaleString('vi-VN')} đ
              </span>
            </div>
            <div className="flex gap-1.5">
              {(['ALL', 'EXCEPTIONS', 'PAID'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer ${
                    statusFilter === f
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40'
                      : 'bg-slate-800/70 text-slate-400 hover:text-white'
                  }`}
                >
                  {f === 'ALL' ? 'Tất cả' : f === 'EXCEPTIONS' ? 'Đơn lỗi / Chờ' : 'Đã thanh toán'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase text-slate-400">
                <th className="py-2.5 pr-4">Mã Đơn</th>
                <th className="py-2.5 pr-4">Khách Hàng</th>
                <th className="py-2.5 pr-4">Gói</th>
                <th className="py-2.5 pr-4">Số Tiền</th>
                <th className="py-2.5 pr-4">Trạng Thái</th>
                <th className="py-2.5 text-right">Ngoại Lệ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    Không có đơn hàng nào trong bộ lọc này.
                  </td>
                </tr>
              ) : (
                filteredOrders.slice(0, 30).map((o: any) => {
                  const st = String(o.status || '').toUpperCase();
                  const isException = st === 'UNDERPAID' || st === 'PENDING' || st === 'FAILED';
                  return (
                    <tr key={o.id} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 pr-4 font-mono text-cyan-300">{o.id}</td>
                      <td className="py-2.5 pr-4 text-slate-300">{o.user_email || o.user_id}</td>
                      <td className="py-2.5 pr-4 font-bold uppercase text-white">{o.plan_tier}</td>
                      <td className="py-2.5 pr-4 font-mono text-emerald-300">
                        {Number(o.amount_vnd || 0).toLocaleString('vi-VN')} đ
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            st === 'PAID'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {st}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        {isException ? (
                          <button
                            type="button"
                            disabled={busyId === o.id}
                            onClick={() => handleManualApproveOrder(o.id)}
                            className="rounded-lg bg-amber-500/20 border border-amber-400/40 px-3 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/30 cursor-pointer"
                          >
                            {busyId === o.id ? 'Đang duyệt...' : 'Duyệt bù thủ công'}
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-500">Tự động xong</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Active Customer MT5 Accounts (Suspend / Delete only for violations) */}
      <div className="quant-panel p-6 space-y-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400">
            Danh Sách Khách Hàng Đang Chạy ({accounts.length})
          </div>
          <h3 className="mt-1 text-base font-bold text-white">
            Giám Sát Tài Khoản Khách Hàng (Tự Động Deploy &amp; Bảo Vệ)
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase text-slate-400">
                <th className="py-2.5 pr-4">MT5 Login / Server</th>
                <th className="py-2.5 pr-4">Loại</th>
                <th className="py-2.5 pr-4">Balance / Equity</th>
                <th className="py-2.5 pr-4">Trạng Thái Cloud</th>
                <th className="py-2.5 text-right">Xử Lý Vi Phạm</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    Chưa có tài khoản MT5 khách hàng nào kết nối.
                  </td>
                </tr>
              ) : (
                accounts.map((a: any) => {
                  const autoTrade = Number(a.auto_trade ?? 0) === 1;
                  return (
                    <tr key={a.id} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 pr-4">
                        <div className="font-mono font-bold text-white">{a.mt5_login || a.login}</div>
                        <div className="text-[11px] text-slate-400">{a.broker_server || a.server}</div>
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-cyan-300">{a.account_type || 'STANDARD'}</td>
                      <td className="py-2.5 pr-4 font-mono text-slate-200">
                        ${Number(a.balance || 0).toLocaleString()} / ${Number(a.equity || 0).toLocaleString()}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            a.deployment_state === 'DEPLOYED' && autoTrade
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {a.deployment_state || 'UNKNOWN'} {autoTrade ? '• AUTO' : '• PAUSED'}
                        </span>
                      </td>
                      <td className="py-2.5 text-right space-x-2">
                        <button
                          type="button"
                          disabled={busyId === a.id}
                          onClick={() => handleAccountAction(a.id, 'toggle', autoTrade)}
                          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                        >
                          {autoTrade ? 'Tạm khóa' : 'Mở lại'}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === a.id}
                          onClick={() => handleAccountAction(a.id, 'delete')}
                          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-500/20 cursor-pointer"
                        >
                          Xóa
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. User Compliance & Role Management */}
      <div className="quant-panel p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400">
              Quản Trị Người Dùng ({users.length})
            </div>
            <h3 className="mt-1 text-base font-bold text-white">
              Danh Sách Tài Khoản Hệ Thống (Phân Quyền &amp; Xử Lý Vi Phạm)
            </h3>
          </div>
          <button
            type="button"
            onClick={async () => {
              const email = window.prompt('Nhập Email người dùng mới:');
              if (!email) return;
              const password = window.prompt('Nhập mật khẩu (>= 12 ký tự):');
              if (!password || password.length < 12) {
                setMsg('Mật khẩu phải tối thiểu 12 ký tự.');
                return;
              }
              const role = window.confirm('Cấp quyền ADMIN cho tài khoản này? (Cancel = customer)') ? 'admin' : 'customer';
              const r = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
                body: JSON.stringify({ email: email.trim(), password, role }),
              });
              const d = await r.json().catch(() => ({}));
              if (r.ok) {
                setMsg(`Đã tạo tài khoản ${email.trim()} (${role}).`);
                await loadBilling();
              } else {
                setMsg(`Lỗi tạo user: ${d.detail || r.status}`);
              }
            }}
            className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 cursor-pointer"
          >
            + Tạo Người Dùng
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase text-slate-400">
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Quyền</th>
                <th className="py-2 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.map((usr: any) => (
                <tr key={usr.id} className="hover:bg-white/[0.02]">
                  <td className="py-2 pr-4 text-slate-200">{usr.email}</td>
                  <td className="py-2 pr-4 font-mono text-cyan-300 uppercase">{usr.role}</td>
                  <td className="py-2 text-right space-x-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const np = window.prompt(`Nhập mật khẩu mới (>= 12 ký tự) cho ${usr.email}:`);
                        if (!np || np.length < 12) {
                          if (np !== null) setMsg('Mật khẩu mới phải tối thiểu 12 ký tự.');
                          return;
                        }
                        const r = await fetch(`/api/admin/users/${encodeURIComponent(usr.id)}/password`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
                          body: JSON.stringify({ password: np }),
                        });
                        setMsg(r.ok ? `Đã đặt lại mật khẩu cho ${usr.email}.` : 'Không thể đặt lại mật khẩu.');
                      }}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                    >
                      Đặt lại MK
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const nextRole = usr.role === 'admin' ? 'customer' : 'admin';
                        const r = await fetch(`/api/admin/users/${encodeURIComponent(usr.id)}/role`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
                          body: JSON.stringify({ role: nextRole }),
                        });
                        if (r.ok) {
                          setMsg(`Đã đổi quyền ${usr.email} -> ${nextRole}.`);
                          await loadBilling();
                        }
                      }}
                      className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/20 cursor-pointer"
                    >
                      Đổi quyền
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`Xóa người dùng ${usr.email}?`)) return;
                        const r = await fetch(`/api/admin/users/${encodeURIComponent(usr.id)}`, {
                          method: 'DELETE',
                          headers: { 'X-Zupirus': '1' },
                        });
                        if (r.ok) {
                          setMsg(`Đã xóa người dùng ${usr.email}.`);
                          await loadBilling();
                        }
                      }}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-500/20 cursor-pointer"
                    >
                      Xóa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
