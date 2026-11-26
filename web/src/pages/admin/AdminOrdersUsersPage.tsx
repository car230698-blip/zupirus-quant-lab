import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { AdminBillingSettings } from '../../components/admin/AdminBillingSettings';
import { ToastNotification } from '../../components/ToastNotification';
import { AdminErrorBanner, AdminErrorInfo } from '../../components/AdminErrorBanner';
import { MetricCard, Panel, StatusBadge } from '../../components/ui/Primitives';
import { CheckCircle2, Clock, DollarSign, Users, X } from 'lucide-react';

export const AdminOrdersUsersPage: React.FC = () => {
  const { lang } = useLanguage();
  const [summary, setSummary] = useState<any>({ orders: { paid_revenue_vnd: 0 } });
  const [orders, setOrders] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'orders' | 'users' | 'settings'>('orders');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'PAID'>('ALL');
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [errorBanner, setErrorBanner] = useState<AdminErrorInfo | null>(null);

  // Password Reset Modal State
  const [resetTarget, setResetTarget] = useState<{ id: string; email: string } | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetSaving, setResetSaving] = useState(false);

  // Create User Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<'customer' | 'admin'>('customer');
  const [createError, setCreateError] = useState('');
  const [createSaving, setCreateSaving] = useState(false);

  // Delete User Modal State
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
      const [sData, oData, uData] = await Promise.all([
        api.get('/api/admin/billing/summary'),
        api.get('/api/admin/billing/orders'),
        api.get('/api/admin/users'),
      ]);
      if (sData) setSummary(sData);
      if (oData) setOrders(oData.orders || oData || []);
      if (uData) setUsers(uData.users || uData || []);
      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner({
        status: err?.status,
        message: err?.message || 'Không thể đồng bộ dữ liệu đơn hàng & người dùng.',
      });
    }
  }, []);

  useEffect(() => {
    loadBilling();
    const timer = setInterval(loadBilling, 20000);
    return () => clearInterval(timer);
  }, [loadBilling]);

  const handleManualApproveOrder = async (orderId: string) => {
    setBusyId(orderId);
    try {
      const res: any = await api.post(`/api/admin/billing/orders/${encodeURIComponent(orderId)}/approve`);
      setMsg(res?.message || `Đã duyệt đơn hàng ${orderId} và mở khóa ấn phẩm PDF.`);
      await loadBilling();
    } catch (err: any) {
      setMsg(`Không thể duyệt đơn hàng: ${err.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const filteredOrders = orders.filter((o: any) => {
    const st = String(o.status || '').toUpperCase();
    if (statusFilter === 'PAID') return st === 'PAID';
    if (statusFilter === 'PENDING') return st !== 'PAID';
    return true;
  });

  const paidOrdersCount = orders.filter((o: any) => String(o.status || '').toUpperCase() === 'PAID').length;
  const pendingOrdersCount = orders.filter((o: any) => String(o.status || '').toUpperCase() !== 'PAID').length;
  const totalRevenueVnd = Number(summary.orders?.paid_revenue_vnd ?? summary.total_revenue_vnd ?? 0);

  const searchedUsers = users.filter((u: any) => {
    if (!searchUserQuery.trim()) return true;
    const q = searchUserQuery.toLowerCase();
    return String(u.email || '').toLowerCase().includes(q) || String(u.role || '').toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="quant-heading">
        <div className="space-y-1">
          <div className="font-mono text-xs uppercase tracking-wider text-cyan-400">
            {lang === 'en' ? 'ADMIN CONSOLE · COMMERCE & USERS' : 'TRẠM QUẢN TRỊ · ĐƠN HÀNG & NGƯỜI DÙNG'}
          </div>
          <h1>{lang === 'en' ? 'USDT Orders, Users & Gateway' : 'Đơn Hàng USDT, Người Dùng & Ví Nhận'}</h1>
          <p className="text-sm text-slate-400 m-0">
            {lang === 'en'
              ? 'Approve pending crypto orders, manage customer accounts, and configure TRC20/BEP20 wallets.'
              : 'Đối soát đơn mua báo cáo USDT, quản trị tài khoản người dùng và cấu hình ví nhận.'}
          </p>
        </div>
      </div>

      <ToastNotification message={msg || null} type="info" onClose={() => setMsg('')} />
      <AdminErrorBanner error={errorBanner} onRetry={loadBilling} onDismiss={() => setErrorBanner(null)} />

      {/* TOP 4 KPI STRIP */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label={lang === 'en' ? 'Paid Revenue' : 'Doanh Thu Đã Thu'}
          value={`${totalRevenueVnd.toLocaleString('vi-VN')} đ`}
          subtext={lang === 'en' ? 'Direct USDT On-Chain' : 'Đối soát USDT On-Chain'}
          icon={<DollarSign className="h-4 w-4" />}
          tone="emerald"
        />
        <MetricCard
          label={lang === 'en' ? 'Paid Orders' : 'Đơn Đã Mở Khóa'}
          value={paidOrdersCount}
          subtext={lang === 'en' ? 'PDF entitlements granted' : 'Đã cấp quyền tải PDF'}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="cyan"
        />
        <MetricCard
          label={lang === 'en' ? 'Pending / Exceptions' : 'Đơn Chờ / Ngoại Lệ'}
          value={pendingOrdersCount}
          subtext={lang === 'en' ? 'Awaiting confirmation' : 'Chờ xác nhận giao dịch'}
          icon={<Clock className="h-4 w-4" />}
          tone="amber"
        />
        <MetricCard
          label={lang === 'en' ? 'Registered Users' : 'Tài Khoản Hệ Thống'}
          value={users.length}
          subtext={lang === 'en' ? 'Customer & admin accounts' : 'Khách hàng & quản trị viên'}
          icon={<Users className="h-4 w-4" />}
          tone="default"
        />
      </div>

      {/* UNDERLINE SUB-TABS */}
      <div className="border-b border-slate-800 flex flex-wrap items-center gap-8">
        <button
          type="button"
          onClick={() => setActiveSubTab('orders')}
          className={`pb-3 text-sm font-semibold transition cursor-pointer relative ${
            activeSubTab === 'orders' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>{lang === 'en' ? 'Report Orders (USDT)' : 'Đơn Mua Báo Cáo'}</span>
          {pendingOrdersCount > 0 && (
            <span className="ml-2 rounded-md bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
              {pendingOrdersCount}
            </span>
          )}
          {activeSubTab === 'orders' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400" />}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('users')}
          className={`pb-3 text-sm font-semibold transition cursor-pointer relative ${
            activeSubTab === 'users' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>
            {lang === 'en' ? 'User Accounts' : 'Tài Khoản Người Dùng'} ({users.length})
          </span>
          {activeSubTab === 'users' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400" />}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('settings')}
          className={`pb-3 text-sm font-semibold transition cursor-pointer relative ${
            activeSubTab === 'settings' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>{lang === 'en' ? 'USDT Wallets & FX' : 'Ví USDT & Tỷ Giá'}</span>
          {activeSubTab === 'settings' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400" />}
        </button>
      </div>

      {/* TAB 1: ORDERS */}
      {activeSubTab === 'orders' && (
        <Panel
          title={lang === 'en' ? 'Report Orders & Entitlements' : 'Danh Sách Đơn Mua Báo Cáo PDF'}
          subtitle={lang === 'en' ? 'Verify or manually approve USDT settlements' : 'Kiểm tra và duyệt bù đơn hàng ngoại lệ'}
          action={
            <div className="flex gap-1.5">
              {(['ALL', 'PENDING', 'PAID'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  className={statusFilter === f ? 'quant-btn-primary min-h-[32px] px-3 py-1 text-xs' : 'quant-quiet min-h-[32px] px-3 py-1 text-xs'}
                >
                  {f === 'ALL' ? 'Tất cả' : f === 'PENDING' ? 'Chờ duyệt' : 'Đã thanh toán'}
                </button>
              ))}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="quant-table font-mono text-xs tabular-nums">
              <thead>
                <tr>
                  <th>Mã Đơn</th>
                  <th>Khách Hàng</th>
                  <th>Ấn Phẩm / Mục</th>
                  <th className="text-right">Số Tiền</th>
                  <th>Trạng Thái</th>
                  <th className="text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400 font-sans">
                      Không có đơn hàng nào trong bộ lọc này.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.slice(0, 50).map((o: any) => {
                    const st = String(o.status || '').toUpperCase();
                    const isPaid = st === 'PAID';
                    return (
                      <tr key={o.id}>
                        <td className="font-bold text-cyan-300">{o.order_code || o.id}</td>
                        <td className="font-sans text-slate-200">{o.user_email || o.user_id || '—'}</td>
                        <td className="font-sans text-white max-w-xs truncate">
                          {o.title || o.report_id || o.plan_tier || 'PDF Report'}
                        </td>
                        <td className="text-right font-bold text-emerald-400">
                          {Number(o.amount_vnd || 0) > 0
                            ? `${Number(o.amount_vnd).toLocaleString('vi-VN')} đ`
                            : `$${Number(o.amount_usd || o.amount || 0).toFixed(2)} USDT`}
                        </td>
                        <td>
                          <StatusBadge tone={isPaid ? 'success' : 'warning'}>{st}</StatusBadge>
                        </td>
                        <td className="text-right font-sans">
                          {isPaid ? (
                            <span className="text-xs text-emerald-400 font-medium">Đã mở khóa PDF</span>
                          ) : (
                            <button
                              type="button"
                              disabled={busyId === o.id}
                              onClick={() => handleManualApproveOrder(o.id)}
                              className="quant-btn-primary min-h-[30px] px-3 py-1 text-xs"
                            >
                              {busyId === o.id ? 'Đang duyệt...' : 'Duyệt thủ công'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* TAB 2: USERS */}
      {activeSubTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <input
              type="text"
              value={searchUserQuery}
              onChange={(e) => setSearchUserQuery(e.target.value)}
              placeholder="Tìm kiếm theo email hoặc phân quyền..."
              className="quant-input max-w-md text-xs"
            />
            <button
              type="button"
              onClick={() => {
                setCreateEmail('');
                setCreatePassword(generateRandomPassword());
                setCreateRole('customer');
                setCreateError('');
                setShowCreateModal(true);
              }}
              className="quant-btn-primary text-xs"
            >
              + Tạo Người Dùng Mới
            </button>
          </div>

          <Panel title={`Danh Sách Người Dùng (${searchedUsers.length})`}>
            <div className="overflow-x-auto">
              <table className="quant-table text-xs">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Phân Quyền</th>
                    <th className="text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody>
                  {searchedUsers.map((usr: any) => (
                    <tr key={usr.id}>
                      <td className="font-medium text-white">{usr.email}</td>
                      <td>
                        <StatusBadge tone={usr.role === 'admin' ? 'info' : 'neutral'}>
                          {String(usr.role || 'customer').toUpperCase()}
                        </StatusBadge>
                      </td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setResetTarget({ id: usr.id, email: usr.email });
                              setNewPasswordInput('');
                              setResetError('');
                            }}
                            className="quant-quiet min-h-[30px] px-2.5 py-1 text-[11px]"
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
                                await api.put(`/api/admin/users/${encodeURIComponent(usr.id)}/role`, {
                                  role: nextRole,
                                });
                                setMsg(`Đã đổi quyền ${usr.email} thành ${nextRole}.`);
                                await loadBilling();
                              } catch (err: any) {
                                setMsg(`Không thể đổi quyền: ${err.message || ''}`);
                              } finally {
                                setBusyId(null);
                              }
                            }}
                            className="quant-quiet min-h-[30px] px-2.5 py-1 text-[11px] text-cyan-300"
                          >
                            Đổi quyền
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget({ id: usr.id, email: usr.email })}
                            className="quant-btn-danger min-h-[30px] px-2.5 py-1 text-[11px]"
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* TAB 3: USDT WALLETS & FX */}
      {activeSubTab === 'settings' && <AdminBillingSettings />}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0B1220] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-base font-bold text-white">Đặt Lại Mật Khẩu Người Dùng</h4>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs text-slate-300 font-mono">Tài khoản: {resetTarget.email}</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-300">Mật khẩu mới (tối thiểu 8 ký tự)</span>
                <button
                  type="button"
                  onClick={() => setNewPasswordInput(generateRandomPassword())}
                  className="text-cyan-300 hover:underline cursor-pointer"
                >
                  Tạo ngẫu nhiên
                </button>
              </div>
              <input
                type="text"
                value={newPasswordInput}
                onChange={(e) => {
                  setNewPasswordInput(e.target.value);
                  setResetError('');
                }}
                className="quant-input font-mono text-sm"
                autoFocus
              />
              {resetError && <div className="text-xs text-rose-300">{resetError}</div>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResetTarget(null)} className="quant-btn-secondary text-xs">
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
                  try {
                    await api.put(`/api/admin/users/${encodeURIComponent(resetTarget.id)}/password`, {
                      password: clean,
                    });
                    setMsg(`Đã đặt lại mật khẩu cho ${resetTarget.email}.`);
                    setResetTarget(null);
                  } catch (err: any) {
                    setResetError(err.message || 'Lỗi đặt lại mật khẩu');
                  } finally {
                    setResetSaving(false);
                  }
                }}
                className="quant-btn-primary text-xs"
              >
                {resetSaving ? 'Đang lưu...' : 'Lưu Mật Khẩu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0B1220] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-base font-bold text-white">Tạo Người Dùng Mới</h4>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Email</label>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  className="quant-input"
                  autoFocus
                />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300">Mật khẩu</span>
                  <button
                    type="button"
                    onClick={() => setCreatePassword(generateRandomPassword())}
                    className="text-cyan-300 hover:underline cursor-pointer"
                  >
                    Ngẫu nhiên
                  </button>
                </div>
                <input
                  type="text"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  className="quant-input font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Phân quyền</label>
                <select
                  value={createRole}
                  onChange={(e) => setCreateRole(e.target.value as 'customer' | 'admin')}
                  className="quant-input"
                >
                  <option value="customer">Khách hàng (customer)</option>
                  <option value="admin">Quản trị viên (admin)</option>
                </select>
              </div>
              {createError && <div className="text-xs text-rose-300">{createError}</div>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreateModal(false)} className="quant-btn-secondary text-xs">
                Hủy
              </button>
              <button
                type="button"
                disabled={createSaving}
                onClick={async () => {
                  if (!createEmail.trim() || createPassword.trim().length < 8) {
                    setCreateError('Nhập email hợp lệ và mật khẩu tối thiểu 8 ký tự.');
                    return;
                  }
                  setCreateSaving(true);
                  try {
                    await api.post('/api/admin/users', {
                      email: createEmail.trim(),
                      password: createPassword.trim(),
                      role: createRole,
                    });
                    setMsg(`Đã tạo tài khoản ${createEmail.trim()}.`);
                    setShowCreateModal(false);
                    await loadBilling();
                  } catch (err: any) {
                    setCreateError(err.message || 'Lỗi tạo tài khoản');
                  } finally {
                    setCreateSaving(false);
                  }
                }}
                className="quant-btn-primary text-xs"
              >
                {createSaving ? 'Đang tạo...' : 'Tạo Tài Khoản'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/35 bg-[#0B1220] p-6 shadow-2xl space-y-4">
            <h4 className="text-base font-bold text-white">Xác Nhận Xóa Người Dùng</h4>
            <p className="text-xs text-slate-300">
              Bạn chắc chắn muốn xóa tài khoản <strong className="text-white">{deleteTarget.email}</strong>?
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="quant-btn-secondary text-xs">
                Hủy
              </button>
              <button
                type="button"
                disabled={deleteSaving}
                onClick={async () => {
                  setDeleteSaving(true);
                  try {
                    await api.delete(`/api/admin/users/${encodeURIComponent(deleteTarget.id)}`);
                    setMsg(`Đã xóa tài khoản ${deleteTarget.email}.`);
                    setDeleteTarget(null);
                    await loadBilling();
                  } catch (err: any) {
                    setMsg(`Lỗi xóa tài khoản: ${err.message || ''}`);
                  } finally {
                    setDeleteSaving(false);
                  }
                }}
                className="quant-btn-danger text-xs"
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
