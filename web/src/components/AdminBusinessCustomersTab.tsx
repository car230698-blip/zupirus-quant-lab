import React, { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api/client';
import { AdminBillingSettingsTab } from './AdminBillingSettingsTab.tsx';
import { AdminReportsPublisherSection } from './AdminReportsPublisherSection.tsx';
import { ToastNotification } from './ToastNotification.tsx';
import { AdminErrorBanner, AdminErrorInfo } from './AdminErrorBanner';

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
  const { lang } = useLanguage();
  const [activeSubTab, setActiveSubTab] = useState<'reports' | 'orders' | 'customers' | 'settings'>('reports');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'EXCEPTIONS' | 'PAID'>('ALL');
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [errorBanner, setErrorBanner] = useState<AdminErrorInfo | null>(null);

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
      const [sData, oData, uData] = await Promise.all([
        api.get('/api/admin/billing/summary'),
        api.get('/api/admin/billing/orders'),
        api.get('/api/admin/users'),
      ]);
      if (sData) setSummary(sData);
      if (oData) {
        setOrders(oData.orders || oData || []);
      }
      if (uData) {
        setUsers(uData.users || uData || []);
      }
      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner({
        status: err?.status,
        message: err?.message || 'Không thể đồng bộ dữ liệu doanh thu & khách hàng.',
      });
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
      const res: any = await api.post(`/api/admin/billing/orders/${encodeURIComponent(orderId)}/approve`);
      setMsg(res?.message || `Đã duyệt bù đơn hàng ${orderId} và kích hoạt gói cước.`);
      await loadBilling();
    } catch (err: any) {
      setMsg(`Không thể duyệt bù đơn hàng: ${err.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleAccountAction = async (accId: string, action: 'toggle' | 'delete', currentlyActive?: boolean) => {
    setBusyId(accId);
    try {
      const url =
        action === 'delete'
          ? `/api/v1/accounts/${encodeURIComponent(accId)}`
          : `/api/v1/accounts/${encodeURIComponent(accId)}/toggle`;
      if (action === 'delete') {
        await api.delete(url);
      } else {
        await api.post(url, { is_active: !currentlyActive });
      }
      setMsg(action === 'delete' ? 'Đã xóa tài khoản vi phạm.' : 'Đã cập nhật trạng thái nhận lệnh của tài khoản.');
      refetchAll();
    } catch (err: any) {
      setMsg(action === 'delete' ? `Lỗi: ${err.message || 'Không thể xóa tài khoản.'}` : `Lỗi: ${err.message || 'Không thể cập nhật trạng thái tài khoản.'}`);
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

  const paidOrdersCount = orders.filter((o: any) => String(o.status || '').toUpperCase() === 'PAID').length;
  const pendingOrdersCount = orders.filter((o: any) => String(o.status || '').toUpperCase() !== 'PAID').length;
  const totalRevenueVnd = Number(summary.orders?.paid_revenue_vnd ?? summary.total_revenue_vnd ?? 0);

  const searchedAccounts = accounts.filter((a: any) => {
    if (!searchUserQuery.trim()) return true;
    const q = searchUserQuery.toLowerCase();
    const login = String(a.mt5_login || a.login || '').toLowerCase();
    const srv = String(a.broker_server || a.server || '').toLowerCase();
    return login.includes(q) || srv.includes(q);
  });

  const searchedUsers = users.filter((u: any) => {
    if (!searchUserQuery.trim()) return true;
    const q = searchUserQuery.toLowerCase();
    return String(u.email || '').toLowerCase().includes(q) || String(u.role || '').toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <ToastNotification message={msg || null} type="info" onClose={() => setMsg('')} />

      {/* ERROR BANNER */}
      <AdminErrorBanner
        error={errorBanner}
        onRetry={loadBilling}
        onDismiss={() => setErrorBanner(null)}
      />

      {/* TOP 4-KPI REVENUE STRIP */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 font-mono">
        <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-5">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider">
            {lang === 'en' ? 'Total Revenue (VND)' : 'Doanh Thu Đã Thu'}
          </div>
          <div className="mt-1 text-2xl font-bold text-[#12B5A6] tabular-nums">
            {totalRevenueVnd.toLocaleString('vi-VN')} đ
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {lang === 'en' ? 'Automated SePay Recon' : 'Đối soát tự động SePay'}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-5">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider">
            {lang === 'en' ? 'Active Orders' : 'Đơn Đã Kích Hoạt'}
          </div>
          <div className="mt-1 text-2xl font-bold text-white tabular-nums">
            {paidOrdersCount}
          </div>
          <div className="mt-1 text-[11px] text-[#12B5A6]">
            {lang === 'en' ? 'Successfully Activated' : 'Kích hoạt thành công'}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-5">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider">
            {lang === 'en' ? 'Pending / Exceptions' : 'Đơn Chờ / Ngoại Lệ'}
          </div>
          <div className="mt-1 text-2xl font-bold text-[#F5B700] tabular-nums">
            {pendingOrdersCount}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {lang === 'en' ? 'Awaiting QR scan or review' : 'Chờ quét mã hoặc cần duyệt'}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-5">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider">
            {lang === 'en' ? 'Active MT5 Accounts' : 'Tài Khoản MT5 Đang Chạy'}
          </div>
          <div className="mt-1 text-2xl font-bold text-white tabular-nums">
            {accounts.length}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {lang === 'en' ? 'Connected to Cloud London G2' : 'Đấu nối Cloud London G2'}
          </div>
        </div>
      </div>

      {/* UNDERLINE SUB-TABS NAVIGATION */}
      <div className="border-b border-slate-800 flex flex-wrap items-center gap-8">
        <button
          type="button"
          onClick={() => setActiveSubTab('reports')}
          className={`pb-3 text-sm font-semibold transition cursor-pointer relative ${
            activeSubTab === 'reports'
              ? 'text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>{lang === 'en' ? 'PDF Reports Publisher' : 'Xuất Bản Báo Cáo PDF'}</span>
          {activeSubTab === 'reports' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#12B5A6]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('orders')}
          className={`pb-3 text-sm font-semibold transition cursor-pointer relative ${
            activeSubTab === 'orders'
              ? 'text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>{lang === 'en' ? 'Billing Orders' : 'Đơn Hàng SePay'}</span>
          {pendingOrdersCount > 0 && (
            <span className="ml-2 rounded-full bg-[#F5B700]/20 px-2 py-0.5 font-mono text-[10px] text-[#F5B700]">
              {pendingOrdersCount}
            </span>
          )}
          {activeSubTab === 'orders' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#12B5A6]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('customers')}
          className={`pb-3 text-sm font-semibold transition cursor-pointer relative ${
            activeSubTab === 'customers'
              ? 'text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>{lang === 'en' ? 'Customers & Archive' : 'Khách Hàng & Lưu Trữ'}</span>
          <span className="ml-2 rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">
            {accounts.length}
          </span>
          {activeSubTab === 'customers' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#12B5A6]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('settings')}
          className={`pb-3 text-sm font-semibold transition cursor-pointer relative ${
            activeSubTab === 'settings'
              ? 'text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>{lang === 'en' ? 'VietQR Gateway & FX Rates' : 'Cấu Hình VietQR & Tỷ Giá'}</span>
          {activeSubTab === 'settings' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#12B5A6]" />
          )}
        </button>
      </div>

      {/* SUBTAB 0: PDF REPORTS PUBLISHER */}
      {activeSubTab === 'reports' && <AdminReportsPublisherSection />}

      {/* SUBTAB 1: ORDERS */}
      {activeSubTab === 'orders' && (
        <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="font-mono text-xs uppercase tracking-wider text-[#12B5A6]">
                {lang === 'en' ? 'AUTOMATED BILLING RECONCILIATION' : 'ĐỐI SOÁT TỰ ĐỘNG SEPAY'}
              </div>
              <h3 className="mt-0.5 text-base font-bold text-white">
                {lang === 'en' ? 'Service Plan Orders' : 'Danh Sách Đơn Hàng Gói Dịch Vụ'}
              </h3>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                {(['ALL', 'EXCEPTIONS', 'PAID'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setStatusFilter(f)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer transition ${
                      statusFilter === f
                        ? 'bg-[#12B5A6]/15 text-[#12B5A6] border border-[#12B5A6]/40 font-bold'
                        : 'bg-[#080E1A] text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {f === 'ALL'
                      ? (lang === 'en' ? 'All' : 'Tất cả')
                      : f === 'EXCEPTIONS'
                      ? (lang === 'en' ? 'Pending / Exceptions' : 'Chờ / Ngoại lệ')
                      : (lang === 'en' ? 'Paid' : 'Đã thanh toán')}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400 font-mono">
                  <th className="py-2.5 pr-4">{lang === 'en' ? 'Order ID' : 'Mã Đơn'}</th>
                  <th className="py-2.5 pr-4">Khách Hàng</th>
                  <th className="py-2.5 pr-4">Gói Thuê Bao</th>
                  <th className="py-2.5 pr-4 text-right">Số Tiền (VND)</th>
                  <th className="py-2.5 pr-4 text-center">
                    {lang === 'en' ? 'Entitlement Milestones (3 Steps)' : 'Tiến Trình Cấp Quyền (3 Mốc)'}
                  </th>
                  <th className="py-2.5 text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400 font-sans">
                      Không có đơn hàng nào trong bộ lọc này.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.slice(0, 50).map((o: any) => {
                    const st = String(o.status || '').toUpperCase();
                    const entSt = String(o.entitlement_status || '').toUpperCase();
                    const cldSt = String(o.cloud_deploy_status || '').toUpperCase();
                    const hasPay = Boolean(o.payment_confirmed || st === 'PAID');
                    const hasEnt = Boolean(
                      o.entitlement_applied !== undefined
                        ? o.entitlement_applied
                        : entSt === 'APPLIED' || entSt === 'GRANTED'
                    );
                    const hasCld = Boolean(o.cloud_ready || cldSt === 'DEPLOYED');
                    const isAllDone = hasPay && hasEnt && hasCld;
                    const isException =
                      st === 'UNDERPAID' ||
                      st === 'PENDING' ||
                      st === 'FAILED' ||
                      !hasPay ||
                      !hasEnt ||
                      cldSt === 'FAILED';
                    return (
                      <tr key={o.id} className="hover:bg-slate-800/20">
                        <td className="py-2.5 pr-4 text-[#12B5A6] font-bold">{o.id}</td>
                        <td className="py-2.5 pr-4 text-slate-300 font-sans">{o.user_email || o.user_id}</td>
                        <td className="py-2.5 pr-4 font-bold uppercase text-white">{o.plan_tier}</td>
                        <td className="py-2.5 pr-4 text-right text-emerald-400 font-bold tabular-nums">
                          {Number(o.amount_vnd || 0).toLocaleString('vi-VN')} đ
                        </td>
                        <td className="py-2.5 pr-4 text-center">
                          <div className="inline-flex flex-col items-center gap-1">
                            <div className="flex items-center gap-1 text-[10px] font-mono">
                              {/* Mốc 1: Nhận tiền */}
                              <span
                                title={lang === 'en' ? 'Step 1: Payment Confirmed' : 'Mốc 1: Đã nhận tiền'}
                                className={`rounded px-1.5 py-0.5 font-bold ${
                                  o.payment_confirmed || st === 'PAID'
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                }`}
                              >
                                {o.payment_confirmed || st === 'PAID' ? '✓ Tiền' : 'Chờ Tiền'}
                              </span>
                              <span className="text-slate-600">→</span>
                              {/* Mốc 2: Cấp quyền */}
                              <span
                                title={lang === 'en' ? 'Step 2: Entitlement Applied' : 'Mốc 2: Đã cấp quyền'}
                                className={`rounded px-1.5 py-0.5 font-bold ${
                                  o.entitlement_applied
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-slate-700/50 text-slate-400 border border-slate-700'
                                }`}
                              >
                                {o.entitlement_applied ? '✓ Quyền' : 'Chờ Quyền'}
                              </span>
                              <span className="text-slate-600">→</span>
                              {/* Mốc 3: Terminal Cloud */}
                              {(() => {
                                const cloudStatus = String(o.cloud_deploy_status || '').toUpperCase();
                                const isReady = Boolean(o.cloud_ready || cloudStatus === 'DEPLOYED');
                                const isFailed = cloudStatus === 'FAILED';
                                const isAwaitingLink = cloudStatus === 'PENDING_LINK' || cloudStatus === 'AWAITING_ACCOUNT' || (!o.account_id && !o.metaapi_account_id && !isReady);
                                
                                if (isReady) {
                                  return (
                                    <span
                                      title={lang === 'en' ? 'Step 3: Cloud Terminal Ready' : 'Mốc 3: Terminal Cloud đã sẵn sàng'}
                                      className="rounded px-1.5 py-0.5 font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                    >
                                      ✓ Cloud
                                    </span>
                                  );
                                }
                                if (isFailed) {
                                  return (
                                    <span
                                      title={lang === 'en' ? 'Step 3: Cloud Deploy Failed' : 'Mốc 3: Khởi tạo Cloud thất bại'}
                                      className="rounded px-1.5 py-0.5 font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30"
                                    >
                                      ✗ Cloud
                                    </span>
                                  );
                                }
                                if (isAwaitingLink) {
                                  return (
                                    <span
                                      title={lang === 'en' ? 'Step 3: Waiting for MT5 Account Linking' : 'Mốc 3: Chờ khách hàng liên kết tài khoản MT5'}
                                      className="rounded px-1.5 py-0.5 font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                    >
                                      Chờ LK
                                    </span>
                                  );
                                }
                                return (
                                  <span
                                    title={lang === 'en' ? 'Step 3: Cloud Terminal Pending' : 'Mốc 3: Đang khởi tạo Terminal Cloud'}
                                    className="rounded px-1.5 py-0.5 font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                  >
                                    Chờ Cloud
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 text-right font-sans">
                          {isException ? (
                            <button
                              type="button"
                              disabled={busyId === o.id}
                              onClick={() => handleManualApproveOrder(o.id)}
                              className="rounded-lg bg-[#F5B700]/15 border border-[#F5B700]/40 px-3 py-1 text-xs font-bold text-[#F5B700] hover:bg-[#F5B700]/25 cursor-pointer"
                            >
                              {busyId === o.id ? 'Đang duyệt...' : 'Duyệt bù thủ công'}
                            </button>
                          ) : isAllDone ? (
                            <span className="text-xs text-emerald-400">Tự động xong ✓</span>
                          ) : (
                            <span className="text-xs text-amber-400">
                              {cldSt === 'DEPLOYING' ? 'Đang khởi tạo Cloud...' : 'Chờ liên kết / Cloud'}
                            </span>
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
      )}

      {/* SUBTAB 2: CUSTOMERS & MT5 ACCOUNTS */}
      {activeSubTab === 'customers' && (
        <div className="space-y-6">
          {/* Search bar */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={searchUserQuery}
              onChange={(e) => setSearchUserQuery(e.target.value)}
              placeholder="Tìm kiếm nhanh theo email, mã MT5 login, máy chủ..."
              className="w-full max-w-md rounded-xl border border-slate-800 bg-[#10192B] px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:border-[#12B5A6] focus:outline-none"
            />
          </div>

          {/* Customer MT5 Accounts */}
          <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="font-mono text-xs uppercase tracking-wider text-[#12B5A6]">
                  TÀI KHOẢN CLOUD MT5
                </div>
                <h3 className="mt-0.5 text-base font-bold text-white">
                  Danh Sách Tài Khoản Đang Đấu Nối ({searchedAccounts.length})
                </h3>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400 font-mono">
                    <th className="py-2.5 pr-4">MT5 Login / Server</th>
                    <th className="py-2.5 pr-4">Loại Tài Khoản</th>
                    <th className="py-2.5 pr-4">Balance / Equity</th>
                    <th className="py-2.5 pr-4">Trạng Thái Cloud</th>
                    <th className="py-2.5 text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {searchedAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400 font-sans">
                        Không tìm thấy tài khoản MT5 nào.
                      </td>
                    </tr>
                  ) : (
                    searchedAccounts.map((a: any) => {
                      const autoTrade = Number(a.auto_trade ?? 0) === 1;
                      const isCent = String(a.account_type || '').toUpperCase() === 'CENT' || String(a.currency || '').toUpperCase() === 'USC';
                      const isProp = Boolean(a.is_prop_firm_mode);
                      return (
                        <tr key={a.id} className="hover:bg-slate-800/20">
                          <td className="py-2.5 pr-4">
                            <div className="font-bold text-white">{a.mt5_login || a.login}</div>
                            <div className="text-[11px] text-slate-400 font-sans">{a.broker_server || a.server}</div>
                          </td>
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-200">{a.account_type || 'STANDARD'}</span>
                              {isCent && (
                                <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 text-[9px] font-bold text-[#F5B700]">
                                  USC
                                </span>
                              )}
                              {isProp && (
                                <span className="rounded bg-[#12B5A6]/15 border border-[#12B5A6]/30 px-1.5 py-0.2 text-[9px] font-bold text-[#12B5A6]">
                                  PROP LIVE
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 pr-4 text-slate-200 tabular-nums">
                            ${Number(a.balance || 0).toLocaleString()} / ${Number(a.equity || 0).toLocaleString()}
                          </td>
                          <td className="py-2.5 pr-4">
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                                a.deployment_state === 'DEPLOYED' && autoTrade
                                  ? 'bg-[#12B5A6]/15 text-[#12B5A6] border border-[#12B5A6]/30'
                                  : 'bg-slate-800 text-slate-400 border border-slate-700'
                              }`}
                            >
                              {a.deployment_state || 'UNKNOWN'} {autoTrade ? '• AUTO' : '• PAUSED'}
                            </span>
                          </td>
                          <td className="py-2.5 text-right space-x-2 font-sans">
                            <button
                              type="button"
                              disabled={busyId === a.id}
                              onClick={() => handleAccountAction(a.id, 'toggle', autoTrade)}
                              className="rounded-lg border border-slate-700 hover:border-slate-500 bg-[#080E1A] px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
                            >
                              {autoTrade ? 'Tạm ngắt' : 'Bật lại'}
                            </button>
                            <button
                              type="button"
                              disabled={busyId === a.id}
                              onClick={() => handleAccountAction(a.id, 'delete')}
                              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-300 hover:bg-rose-500/20 cursor-pointer"
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

          {/* User Account Registry */}
          <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <div className="font-mono text-xs uppercase tracking-wider text-[#F5B700]">
                  QUẢN TRỊ TÀI KHOẢN NGƯỜI DÙNG
                </div>
                <h3 className="mt-0.5 text-base font-bold text-white">
                  Danh Sách Người Dùng Hệ Thống ({searchedUsers.length})
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
                className="rounded-xl bg-[#12B5A6] px-3.5 py-2 text-xs font-bold text-[#042F2E] hover:bg-[#14C9B8] cursor-pointer"
              >
                + Tạo Người Dùng Mới
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400 font-mono">
                    <th className="py-2.5 pr-4">Email</th>
                    <th className="py-2.5 pr-4">Phân Quyền</th>
                    <th className="py-2.5 text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {searchedUsers.map((usr: any) => (
                    <tr key={usr.id} className="hover:bg-slate-800/20">
                      <td className="py-2.5 pr-4 text-slate-200 font-sans">{usr.email}</td>
                      <td className="py-2.5 pr-4">
                        <span className="rounded-md border border-slate-700 bg-[#080E1A] px-2 py-0.5 text-[10px] uppercase font-bold text-slate-300">
                          {usr.role}
                        </span>
                      </td>
                      <td className="py-2.5 text-right space-x-2 font-sans">
                        <button
                          type="button"
                          onClick={() => {
                            setResetTarget({ id: usr.id, email: usr.email });
                            setNewPasswordInput('');
                            setShowResetPw(true);
                            setResetError('');
                          }}
                          className="rounded-lg border border-slate-700 bg-[#080E1A] px-2.5 py-1 text-xs text-slate-300 hover:text-white cursor-pointer"
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
                              await api.put(`/api/admin/users/${encodeURIComponent(usr.id)}/role`, { role: nextRole });
                              setMsg(`Đã đổi quyền ${usr.email} -> ${nextRole}.`);
                              await loadBilling();
                            } catch (err: any) {
                              setMsg(`Không thể đổi quyền: ${err.message || ''}`);
                            } finally {
                              setBusyId(null);
                            }
                          }}
                          className="rounded-lg border border-[#12B5A6]/40 bg-[#12B5A6]/10 px-2.5 py-1 text-xs font-bold text-[#12B5A6] hover:bg-[#12B5A6]/20 cursor-pointer"
                        >
                          Đổi quyền
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget({ id: usr.id, email: usr.email })}
                          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-300 hover:bg-rose-500/20 cursor-pointer"
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
      )}

      {/* SUBTAB 3: VIETQR & FX SETTINGS */}
      {activeSubTab === 'settings' && (
        <AdminBillingSettingsTab />
      )}

      {/* Modal Đặt Lại Mật Khẩu Người Dùng */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#10192B] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="font-mono text-xs uppercase tracking-wider text-[#12B5A6]">
                  BẢO MẬT TÀI KHOẢN
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

            <div className="rounded-xl border border-slate-800 bg-[#080E1A] px-3.5 py-2.5 text-xs">
              <span className="text-slate-400">Tài khoản: </span>
              <span className="font-mono font-bold text-white">{resetTarget.email}</span>
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
                  className="text-xs font-bold text-[#12B5A6] hover:underline cursor-pointer"
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
                  className="w-full rounded-xl border border-slate-800 bg-[#080E1A] px-3.5 py-2.5 pr-16 font-mono text-sm text-white focus:border-[#12B5A6] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
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
                className="rounded-xl border border-slate-800 bg-[#080E1A] px-4 py-2 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
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
                    await api.put(`/api/admin/users/${encodeURIComponent(resetTarget.id)}/password`, { password: clean });
                    setMsg(`Đã đặt lại mật khẩu cho ${resetTarget.email} thành công.`);
                    setResetTarget(null);
                    await loadBilling();
                  } catch (err: any) {
                    setResetError(err.message || 'Lỗi đặt lại mật khẩu');
                  } finally {
                    setResetSaving(false);
                  }
                }}
                className="rounded-xl bg-[#12B5A6] px-4 py-2 text-xs font-bold text-[#042F2E] hover:bg-[#14C9B8] cursor-pointer disabled:opacity-50"
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
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#10192B] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
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
                  className="w-full rounded-xl border border-slate-800 bg-[#080E1A] px-3.5 py-2 text-sm text-white focus:border-[#12B5A6] focus:outline-none"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-300">Mật khẩu (&gt;= 8 ký tự)</label>
                  <button
                    type="button"
                    onClick={() => setCreatePassword(generateRandomPassword())}
                    className="text-xs font-bold text-[#12B5A6] hover:underline cursor-pointer"
                  >
                    🎲 Ngẫu nhiên
                  </button>
                </div>
                <input
                  type="text"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-[#080E1A] px-3.5 py-2 font-mono text-sm text-white focus:border-[#12B5A6] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Phân quyền</label>
                <select
                  value={createRole}
                  onChange={(e) => setCreateRole(e.target.value as 'customer' | 'admin')}
                  className="w-full rounded-xl border border-slate-800 bg-[#080E1A] px-3.5 py-2 text-sm text-white focus:border-[#12B5A6] focus:outline-none"
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
                className="rounded-xl border border-slate-800 bg-[#080E1A] px-4 py-2 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
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
                    await api.post('/api/admin/users', {
                      email: createEmail.trim(),
                      password: createPassword.trim(),
                      role: createRole,
                    });
                    setMsg(`Đã tạo tài khoản ${createEmail.trim()} (${createRole}).`);
                    setShowCreateModal(false);
                    await loadBilling();
                  } catch (err: any) {
                    setCreateError(err.message || 'Lỗi tạo tài khoản');
                  } finally {
                    setCreateSaving(false);
                  }
                }}
                className="rounded-xl bg-[#12B5A6] px-4 py-2 text-xs font-bold text-[#042F2E] hover:bg-[#14C9B8] cursor-pointer disabled:opacity-50"
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
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-[#10192B] p-6 shadow-2xl space-y-4">
            <h4 className="text-base font-bold text-white">Xác nhận xóa người dùng</h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              Bạn có chắc chắn muốn xóa vĩnh viễn tài khoản{' '}
              <strong className="text-rose-400 font-mono">{deleteTarget.email}</strong> cùng toàn bộ dữ liệu liên quan?
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-slate-800 bg-[#080E1A] px-4 py-2 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={deleteSaving}
                onClick={async () => {
                  setDeleteSaving(true);
                  try {
                    await api.delete(`/api/admin/users/${encodeURIComponent(deleteTarget.id)}`);
                    setMsg(`Đã xóa người dùng ${deleteTarget.email}.`);
                    setDeleteTarget(null);
                    await loadBilling();
                  } catch (err: any) {
                    setMsg(`Không thể xóa: ${err.message || ''}`);
                    setDeleteTarget(null);
                  } finally {
                    setDeleteSaving(false);
                  }
                }}
                className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-bold text-white hover:bg-rose-400 cursor-pointer disabled:opacity-50"
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
