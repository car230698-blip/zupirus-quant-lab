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

  // Password Reset Modal State
  const [resetTarget, setResetTarget] = useState<{ id: string; email: string } | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [showResetPw, setShowResetPw] = useState(true);
  const [resetError, setResetError] = useState('');
  const [resetSaving, setResetSaving] = useState(false);

  // Create User Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<'customer' | 'admin'>('customer');
  const [createError, setCreateError] = useState('');
  const [createSaving, setCreateSaving] = useState(false);

  // Delete User Confirm Modal State
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; email: string } | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
    let out = 'Zup!';
    for (let i = 0; i < 8; i += 1) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  };

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
    const onBillingRefresh = () => loadBilling();
    window.addEventListener('zupirus:admin-billing-refresh', onBillingRefresh);
    const timer = setInterval(loadBilling, 15000);
    return () => {
      window.removeEventListener('zupirus:admin-billing-refresh', onBillingRefresh);
      clearInterval(timer);
    };
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
            onClick={() => {
              setCreateEmail('');
              setCreatePassword(generateRandomPassword());
              setCreateRole('customer');
              setCreateError('');
              setShowCreateModal(true);
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
                      onClick={() => {
                        setResetTarget({ id: usr.id, email: usr.email });
                        setNewPasswordInput('');
                        setShowResetPw(true);
                        setResetError('');
                      }}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                    >
                      Đặt lại MK
                    </button>
                    <button
                      type="button"
                      disabled={busyId === usr.id}
                      onClick={async () => {
                        const nextRole = usr.role === 'admin' ? 'customer' : 'admin';
                        setBusyId(usr.id);
                        try {
                          const r = await fetch(`/api/admin/users/${encodeURIComponent(usr.id)}/role`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
                            credentials: 'include',
                            body: JSON.stringify({ role: nextRole }),
                          });
                          const d = await r.json().catch(() => ({}));
                          if (r.ok) {
                            setMsg(`Đã đổi quyền ${usr.email} -> ${nextRole}.`);
                            await loadBilling();
                          } else {
                            setMsg(`Không thể đổi quyền: ${typeof d.detail === 'string' ? d.detail : r.status}`);
                          }
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/20 cursor-pointer"
                    >
                      Đổi quyền
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget({ id: usr.id, email: usr.email })}
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

      {/* Modal Đặt Lại Mật Khẩu Người Dùng */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#070d1c] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-amber-400">
                  Bảo Mật Tài Khoản
                </div>
                <h4 className="text-base font-bold text-white">Đặt Lại Mật Khẩu Người Dùng</h4>
              </div>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="text-slate-400 hover:text-white text-sm font-bold px-2 py-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-xs">
              <span className="text-slate-400">Tài khoản: </span>
              <span className="font-mono font-bold text-amber-300">{resetTarget.email}</span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">
                  Mật khẩu mới (tối thiểu 8 ký tự)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setNewPasswordInput(generateRandomPassword());
                    setShowResetPw(true);
                    setResetError('');
                  }}
                  className="text-[11px] font-bold text-cyan-300 hover:text-cyan-200 cursor-pointer"
                >
                  🎲 Tạo mật khẩu ngẫu nhiên
                </button>
              </div>
              <div className="relative">
                <input
                  type={showResetPw ? 'text' : 'password'}
                  value={newPasswordInput}
                  onChange={(e) => {
                    setNewPasswordInput(e.target.value);
                    setResetError('');
                  }}
                  placeholder="Nhập mật khẩu mới (>= 8 ký tự)..."
                  autoFocus
                  className="w-full rounded-xl border border-white/15 bg-[#030711] px-3.5 py-2.5 pr-16 font-mono text-sm text-white focus:border-amber-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400 hover:text-white cursor-pointer"
                >
                  {showResetPw ? 'Ẩn' : 'Hiện'}
                </button>
              </div>
              {resetError && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
                  {resetError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:text-white cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={resetSaving}
                onClick={async () => {
                  const clean = newPasswordInput.trim();
                  if (clean.length < 8) {
                    setResetError('Mật khẩu mới phải có ít nhất 8 ký tự.');
                    return;
                  }
                  setResetSaving(true);
                  setResetError('');
                  try {
                    const r = await fetch(`/api/admin/users/${encodeURIComponent(resetTarget.id)}/password`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
                      credentials: 'include',
                      body: JSON.stringify({ password: clean }),
                    });
                    const d = await r.json().catch(() => ({}));
                    if (r.ok) {
                      setMsg(`Đã đặt lại mật khẩu cho ${resetTarget.email} thành công.`);
                      setResetTarget(null);
                      await loadBilling();
                    } else {
                      const errText =
                        typeof d.detail === 'string'
                          ? d.detail
                          : Array.isArray(d.detail) && d.detail[0]?.msg
                            ? d.detail[0].msg
                            : `Lỗi máy chủ (${r.status})`;
                      setResetError(errText);
                    }
                  } catch {
                    setResetError('Lỗi kết nối máy chủ. Vui lòng thử lại.');
                  } finally {
                    setResetSaving(false);
                  }
                }}
                className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-extrabold text-slate-950 hover:bg-amber-300 cursor-pointer disabled:opacity-50"
              >
                {resetSaving ? 'Đang lưu...' : 'Lưu Mật Khẩu Mới'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Tạo Người Dùng Mới */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-emerald-500/40 bg-[#070d1c] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h4 className="text-base font-bold text-white">Tạo Người Dùng Mới</h4>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white text-sm font-bold px-2 py-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Email</label>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="user@zupirus.com"
                  autoFocus
                  className="w-full rounded-xl border border-white/15 bg-[#030711] px-3.5 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-300">Mật khẩu (&gt;= 8 ký tự)</label>
                  <button
                    type="button"
                    onClick={() => setCreatePassword(generateRandomPassword())}
                    className="text-[11px] font-bold text-cyan-300 hover:text-cyan-200 cursor-pointer"
                  >
                    🎲 Ngẫu nhiên
                  </button>
                </div>
                <input
                  type="text"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-[#030711] px-3.5 py-2 font-mono text-sm text-white focus:border-emerald-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Phân quyền</label>
                <select
                  value={createRole}
                  onChange={(e) => setCreateRole(e.target.value as 'customer' | 'admin')}
                  className="w-full rounded-xl border border-white/15 bg-[#030711] px-3.5 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                >
                  <option value="customer">Khách hàng (customer)</option>
                  <option value="admin">Quản trị viên (admin)</option>
                </select>
              </div>
              {createError && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
                  {createError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:text-white cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={createSaving}
                onClick={async () => {
                  if (!createEmail.trim()) {
                    setCreateError('Vui lòng nhập Email.');
                    return;
                  }
                  if (createPassword.trim().length < 8) {
                    setCreateError('Mật khẩu phải có ít nhất 8 ký tự.');
                    return;
                  }
                  setCreateSaving(true);
                  setCreateError('');
                  try {
                    const r = await fetch('/api/admin/users', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
                      credentials: 'include',
                      body: JSON.stringify({
                        email: createEmail.trim(),
                        password: createPassword.trim(),
                        role: createRole,
                      }),
                    });
                    const d = await r.json().catch(() => ({}));
                    if (r.ok) {
                      setMsg(`Đã tạo tài khoản ${createEmail.trim()} (${createRole}).`);
                      setShowCreateModal(false);
                      await loadBilling();
                    } else {
                      setCreateError(typeof d.detail === 'string' ? d.detail : `Lỗi (${r.status})`);
                    }
                  } finally {
                    setCreateSaving(false);
                  }
                }}
                className="rounded-xl bg-emerald-400 px-4 py-2 text-xs font-extrabold text-slate-950 hover:bg-emerald-300 cursor-pointer disabled:opacity-50"
              >
                {createSaving ? 'Đang tạo...' : 'Tạo Tài Khoản'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Xác Nhận Xóa Người Dùng */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-[#070d1c] p-6 shadow-2xl space-y-4">
            <h4 className="text-base font-bold text-white">Xác nhận xóa người dùng</h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              Bạn có chắc chắn muốn xóa vĩnh viễn tài khoản{' '}
              <strong className="text-rose-300 font-mono">{deleteTarget.email}</strong> cùng toàn bộ dữ liệu liên quan?
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:text-white cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={deleteSaving}
                onClick={async () => {
                  setDeleteSaving(true);
                  try {
                    const r = await fetch(`/api/admin/users/${encodeURIComponent(deleteTarget.id)}`, {
                      method: 'DELETE',
                      headers: { 'X-Zupirus': '1' },
                      credentials: 'include',
                    });
                    const d = await r.json().catch(() => ({}));
                    if (r.ok) {
                      setMsg(`Đã xóa người dùng ${deleteTarget.email}.`);
                      setDeleteTarget(null);
                      await loadBilling();
                    } else {
                      setMsg(`Không thể xóa: ${typeof d.detail === 'string' ? d.detail : r.status}`);
                      setDeleteTarget(null);
                    }
                  } finally {
                    setDeleteSaving(false);
                  }
                }}
                className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-extrabold text-white hover:bg-rose-400 cursor-pointer disabled:opacity-50"
              >
                {deleteSaving ? 'Đang xóa...' : 'Xác Nhận Xóa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
