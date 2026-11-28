import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { AdminBillingSettings } from '../../components/admin/AdminBillingSettings';
import { ToastNotification } from '../../components/ToastNotification';
import { AdminErrorBanner, AdminErrorInfo } from '../../components/AdminErrorBanner';
import { MetricCard, Panel, StatusBadge } from '../../components/ui/Primitives';
import { AdminResearchDossierModal } from '../../components/research/AdminResearchDossierModal';
import {
  CheckCircle2,
  Clock,
  X,
  Plus,
  RefreshCw,
  AlertCircle,
  FileText,
  Database,
  Cpu,
  Layers,
  Play,
} from 'lucide-react';

export interface AdminOrdersUsersPageProps {
  viewMode?: 'queue' | 'all_records' | 'settings';
  initialSubTab?: 'users' | 'billing' | 'tools' | string;
}

export const AdminOrdersUsersPage: React.FC<AdminOrdersUsersPageProps> = ({
  viewMode = 'queue',
  initialSubTab,
}) => {
  // Research Requests State (Core of the Research Lab)
  const [researchRequests, setResearchRequests] = useState<any[]>([]);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [activeDossierRequestId, setActiveDossierRequestId] = useState<string | null>(null);
  const [searchResearchQuery, setSearchResearchQuery] = useState('');
  const [actionableGroup, setActionableGroup] = useState<
    'ALL_ACTIONABLE' | 'PENDING_REPLY' | 'PENDING_QUOTE' | 'NEEDS_DATA' | 'READY_FOR_REVIEW' | 'ERROR_INTERVENTION'
  >('ALL_ACTIONABLE');
  const [allStatusFilter, setAllStatusFilter] = useState<'ALL' | 'WAITING_CLIENT' | 'RUNNING' | 'DELIVERED'>('ALL');

  // Settings & On-Demand State
  const [settingsSubTab, setSettingsSubTab] = useState<'users' | 'billing' | 'tools'>(
    initialSubTab === 'users' ? 'users' : initialSubTab === 'tools' ? 'tools' : 'billing'
  );

  useEffect(() => {
    if (initialSubTab === 'users' || initialSubTab === 'billing' || initialSubTab === 'tools') {
      setSettingsSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  // Users State (Lazy loaded when in Settings -> users)
  const [users, setUsers] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [roleChangeTarget, setRoleChangeTarget] = useState<{ id: string; email: string; currentRole: string; newRole: string } | null>(null);
  const [roleSaving, setRoleSaving] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ id: string; email: string } | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [resetSaving, setResetSaving] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<'customer' | 'admin'>('customer');
  const [createSaving, setCreateSaving] = useState(false);

  // Billing & Legacy Orders State (Lazy loaded when in Settings -> billing)
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [searchOrderQuery, setSearchOrderQuery] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'ALL' | 'PENDING' | 'PAID' | 'REFUNDED'>('ALL');
  const [approveTarget, setApproveTarget] = useState<{ id: string; email: string; amount: number; product: string } | null>(null);
  const [approveTxHash, setApproveTxHash] = useState('');
  const [approveSaving, setApproveSaving] = useState(false);

  // Tools & Data Sync State
  const [dataSyncStatus, setDataSyncStatus] = useState<any[]>([]);
  const [syncingSymbol, setSyncingSymbol] = useState<string | null>(null);
  const [dryRunRunning, setDryRunRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);

  // General Notification / Error State
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [errorBanner, setErrorBanner] = useState<AdminErrorInfo | null>(null);

  // 1. Load Research Requests
  const loadResearchRequests = useCallback(async () => {
    setResearchLoading(true);
    setResearchError(null);
    try {
      const rData: any = await api.get('/api/v1/admin/research/requests');
      const items = rData?.items || rData?.requests || [];
      setResearchRequests(Array.isArray(items) ? items : []);
    } catch (err: any) {
      setResearchError(err?.message || 'Không thể đồng bộ danh sách đơn nghiên cứu.');
    } finally {
      setResearchLoading(false);
    }
  }, []);

  // 2. Load Users on-demand
  const loadUsersOnDemand = useCallback(async () => {
    setUsersLoading(true);
    try {
      const uData = await api.get('/api/admin/users');
      setUsers(uData?.users || []);
    } catch (err: any) {
      setMsg(`Lỗi tải danh sách người dùng: ${err?.message || ''}`);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // 3. Load Billing & Legacy Orders on-demand
  const loadBillingOnDemand = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const oData = await api.get('/api/admin/orders');
      setOrders(oData?.orders || []);
    } catch (err: any) {
      setMsg(`Lỗi tải danh sách đơn hàng: ${err?.message || ''}`);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  // 4. Load Market Data Status on-demand
  const loadMarketStatusOnDemand = useCallback(async () => {
    try {
      const res: any = await api.get('/api/v1/admin/quant/data/status');
      if (res?.items) {
        setDataSyncStatus(res.items);
      }
    } catch {
      // ignore
    }
  }, []);

  // Auto-sync research requests on mount
  useEffect(() => {
    loadResearchRequests();
    const timer = setInterval(loadResearchRequests, 25000);
    return () => clearInterval(timer);
  }, [loadResearchRequests]);

  // Load Settings subtab data on-demand
  useEffect(() => {
    if (viewMode === 'settings') {
      if (settingsSubTab === 'users') {
        loadUsersOnDemand();
      } else if (settingsSubTab === 'billing') {
        loadBillingOnDemand();
      } else if (settingsSubTab === 'tools') {
        loadMarketStatusOnDemand();
      }
    }
  }, [viewMode, settingsSubTab, loadUsersOnDemand, loadBillingOnDemand, loadMarketStatusOnDemand]);

  // KPI Calculations from Research Requests
  const actionableCount = researchRequests.filter(
    (r) =>
      Number(r.unread_messages_count || 0) > 0 ||
      ['PENDING_QUOTE', 'NEEDS_DATA', 'NEEDS_ATTENTION', 'READY_FOR_REVIEW', 'FAILED', 'TIMED_OUT', 'ERROR'].includes(
        r.status
      )
  ).length;
  const pendingReplyCount = researchRequests.filter((r) => Number(r.unread_messages_count || 0) > 0).length;
  const pendingQuoteCount = researchRequests.filter((r) => r.status === 'PENDING_QUOTE').length;
  const needsDataCount = researchRequests.filter((r) => r.status === 'NEEDS_DATA' || r.status === 'NEEDS_ATTENTION').length;
  const readyReviewCount = researchRequests.filter((r) => r.status === 'READY_FOR_REVIEW').length;
  const errorCount = researchRequests.filter((r) => ['FAILED', 'TIMED_OUT', 'ERROR'].includes(r.status)).length;

  const waitingClientCount = researchRequests.filter((r) => ['WAITING_PAYMENT', 'WAITING_CLIENT', 'QUOTED'].includes(r.status)).length;
  const runningCount = researchRequests.filter((r) => ['CONFIRMED', 'RUNNING'].includes(r.status)).length;
  const deliveredCount = researchRequests.filter((r) => ['DELIVERED', 'COMPLETED'].includes(r.status)).length;

  // Manual Approval for Legacy USDT Orders
  const executeApproveOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approveTarget) return;
    setApproveSaving(true);
    try {
      const res: any = await api.post(`/api/v1/admin/billing/orders/${encodeURIComponent(approveTarget.id)}/approve`, {
        tx_hash: approveTxHash.trim() || undefined,
      });
      setMsg(res?.message || 'Đã đối soát thủ công đơn hàng thành công.');
      setApproveTarget(null);
      setApproveTxHash('');
      await loadBillingOnDemand();
    } catch (err: any) {
      setMsg(`Lỗi đối soát: ${err?.message || ''}`);
    } finally {
      setApproveSaving(false);
    }
  };

  // Refund Legacy Order
  const executeRefundOrder = async (orderId: string) => {
    if (!confirm(`Bạn có chắc chắn muốn hoàn tiền cho đơn hàng #${orderId}? Quyền tải PDF sẽ bị thu hồi ngay lập tức.`)) {
      return;
    }
    setBusyId(`refund_${orderId}`);
    try {
      const res: any = await api.post(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/refund`);
      setMsg(res?.message || `Đã hoàn tiền đơn hàng #${orderId} và thu hồi quyền tải thành công.`);
      await loadBillingOnDemand();
    } catch (err: any) {
      setMsg(`Lỗi hoàn tiền: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  // User Actions
  const executeRoleChange = async () => {
    if (!roleChangeTarget) return;
    setRoleSaving(true);
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(roleChangeTarget.id)}/role`, {
        role: roleChangeTarget.newRole,
      });
      setMsg(`Đã đổi vai trò của ${roleChangeTarget.email} sang ${roleChangeTarget.newRole.toUpperCase()}.`);
      setRoleChangeTarget(null);
      await loadUsersOnDemand();
    } catch (err: any) {
      setMsg(`Lỗi đổi vai trò: ${err?.message || ''}`);
    } finally {
      setRoleSaving(false);
    }
  };

  const handleToggleSuspendUser = async (userId: string, email: string) => {
    setBusyId(`susp_${userId}`);
    try {
      const res: any = await api.post(`/api/admin/users/${encodeURIComponent(userId)}/toggle-suspend`, {});
      setMsg(res?.message || `Đã cập nhật trạng thái hoạt động của ${email}.`);
      await loadUsersOnDemand();
    } catch (err: any) {
      setMsg(`Lỗi cập nhật trạng thái: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || newPasswordInput.trim().length < 8) {
      setMsg('Mật khẩu mới phải có tối thiểu 8 ký tự.');
      return;
    }
    setResetSaving(true);
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(resetTarget.id)}/password`, {
        password: newPasswordInput.trim(),
      });
      setMsg(`Đã đặt lại mật khẩu cho ${resetTarget.email} thành công.`);
      setResetTarget(null);
      setNewPasswordInput('');
      await loadUsersOnDemand();
    } catch (err: any) {
      setMsg(`Lỗi đổi mật khẩu: ${err?.message || ''}`);
    } finally {
      setResetSaving(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSaving(true);
    try {
      await api.post('/api/admin/users', {
        email: createEmail.trim(),
        password: createPassword.trim(),
        role: createRole,
      });
      setMsg(`Đã tạo tài khoản ${createEmail.trim()} thành công.`);
      setShowCreateModal(false);
      setCreateEmail('');
      setCreatePassword('');
      await loadUsersOnDemand();
    } catch (err: any) {
      setMsg(`Lỗi tạo tài khoản: ${err?.message || ''}`);
    } finally {
      setCreateSaving(false);
    }
  };

  // Tools Actions: Market Candle Sync
  const handleSyncCandles = async (symbol: string) => {
    setSyncingSymbol(symbol);
    setMsg('');
    try {
      const res: any = await api.post('/api/v1/admin/quant/data/sync', {
        symbol,
        timeframe: 'M15',
        range_str: '5d',
      });
      setMsg(res?.message || `Đã đồng bộ nến ${symbol} thành công.`);
      await loadMarketStatusOnDemand();
    } catch (err: any) {
      setMsg(`Lỗi đồng bộ nến ${symbol}: ${err?.message || ''}`);
    } finally {
      setSyncingSymbol(null);
    }
  };

  // Tools Actions: System Diagnostics Dry-run
  const handleRunDiagnostics = async () => {
    setDryRunRunning(true);
    setDryRunResult(null);
    try {
      const res: any = await api.post('/api/v1/telemetry/admin-radar/dry-run');
      setDryRunResult(res);
      setMsg('Kiểm tra chẩn đoán hệ thống hoàn tất.');
    } catch (err: any) {
      setMsg(`Lỗi chẩn đoán: ${err?.message || ''}`);
    } finally {
      setDryRunRunning(false);
    }
  };

  // Filter research requests
  const filteredResearchRequests = researchRequests.filter((req: any) => {
    if (searchResearchQuery.trim()) {
      const q = searchResearchQuery.toLowerCase();
      const match =
        String(req.id || '').toLowerCase().includes(q) ||
        String(req.client_email || '').toLowerCase().includes(q) ||
        String(req.user_id || '').toLowerCase().includes(q) ||
        String(req.symbol || '').toLowerCase().includes(q) ||
        String(req.hypothesis_prompt || '').toLowerCase().includes(q);
      if (!match) return false;
    }

    if (viewMode === 'queue') {
      // Must be actionable
      const isActionable =
        Number(req.unread_messages_count || 0) > 0 ||
        ['PENDING_QUOTE', 'NEEDS_DATA', 'NEEDS_ATTENTION', 'READY_FOR_REVIEW', 'FAILED', 'TIMED_OUT', 'ERROR'].includes(
          req.status
        );
      if (!isActionable) return false;

      if (actionableGroup === 'PENDING_REPLY') {
        return Number(req.unread_messages_count || 0) > 0;
      }
      if (actionableGroup === 'PENDING_QUOTE') {
        return req.status === 'PENDING_QUOTE';
      }
      if (actionableGroup === 'NEEDS_DATA') {
        return req.status === 'NEEDS_DATA' || req.status === 'NEEDS_ATTENTION';
      }
      if (actionableGroup === 'READY_FOR_REVIEW') {
        return req.status === 'READY_FOR_REVIEW';
      }
      if (actionableGroup === 'ERROR_INTERVENTION') {
        return ['FAILED', 'TIMED_OUT', 'ERROR'].includes(req.status);
      }
      return true;
    }

    if (viewMode === 'all_records') {
      if (allStatusFilter === 'WAITING_CLIENT') {
        return ['WAITING_PAYMENT', 'WAITING_CLIENT', 'QUOTED'].includes(req.status);
      }
      if (allStatusFilter === 'RUNNING') {
        return ['CONFIRMED', 'RUNNING'].includes(req.status);
      }
      if (allStatusFilter === 'DELIVERED') {
        return ['DELIVERED', 'COMPLETED'].includes(req.status);
      }
      return true;
    }

    return true;
  });

  return (
    <div className="space-y-6">
      <AdminErrorBanner error={errorBanner} onDismiss={() => setErrorBanner(null)} />
      {msg && <ToastNotification message={msg} onClose={() => setMsg('')} />}

      {/* VIEW MODE 1: ACTIONABLE QUEUE */}
      {viewMode === 'queue' && (
        <div className="space-y-6">
          <div className="quant-heading">
            <div className="space-y-1">
              <div className="font-mono text-xs uppercase tracking-wider text-amber-400 font-semibold">
                ĐIỀU HÀNH NGHIÊN CỨU THEO ĐƠN · HÀNG ĐỢI XỬ LÝ
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Hồ Sơ Cần Xử Lý ({actionableCount})
              </h1>
              <p className="text-xs text-slate-400 m-0">
                Tập trung các hồ sơ cần admin phản hồi, báo giá, bổ sung dữ liệu, duyệt bàn giao hoặc can thiệp lỗi.
              </p>
            </div>
            <button
              type="button"
              onClick={loadResearchRequests}
              className="quant-btn-secondary text-xs flex items-center gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${researchLoading ? 'animate-spin' : ''}`} />
              <span>Đồng bộ</span>
            </button>
          </div>

          {/* 4 ACTIONABLE KPI CARDS */}
          {researchError && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-xl text-sm flex items-center justify-between">
              <span>{researchError}</span>
              <button
                type="button"
                onClick={loadResearchRequests}
                className="quant-btn-secondary text-xs"
              >
                Thử lại
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="Cần Xử Lý Ngay"
              value={actionableCount}
              subtext={`${pendingReplyCount} tin nhắn khách chưa đọc`}
              icon={<AlertCircle className="h-4 w-4" />}
              tone={actionableCount > 0 ? 'amber' : 'default'}
            />
            <MetricCard
              label="Chờ Duyệt Báo Giá"
              value={pendingQuoteCount}
              subtext="Yêu cầu nghiên cứu mới"
              icon={<Clock className="h-4 w-4" />}
              tone="cyan"
            />
            <MetricCard
              label="Cần Bổ Sung Dữ Liệu"
              value={needsDataCount}
              subtext="Thiếu file CSV hoặc thông số"
              icon={<Database className="h-4 w-4" />}
              tone={needsDataCount > 0 ? 'rose' : 'default'}
            />
            <MetricCard
              label="Chờ Duyệt Bàn Giao"
              value={readyReviewCount}
              subtext="Worker đã chạy xong kết quả"
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone={readyReviewCount > 0 ? 'emerald' : 'default'}
            />
          </div>

          {/* QUEUE CONTROLS & SUB-CHIPS */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: 'ALL_ACTIONABLE', label: 'Tất cả cần xử lý', count: actionableCount },
                { key: 'PENDING_REPLY', label: 'Nhắn lại', count: pendingReplyCount },
                { key: 'PENDING_QUOTE', label: 'Chờ duyệt báo giá', count: pendingQuoteCount },
                { key: 'NEEDS_DATA', label: 'Cần bổ sung dữ liệu', count: needsDataCount },
                { key: 'READY_FOR_REVIEW', label: 'Chờ duyệt bàn giao', count: readyReviewCount },
                { key: 'ERROR_INTERVENTION', label: 'Lỗi / Can thiệp', count: errorCount },
              ].map((grp) => {
                const isActive = actionableGroup === grp.key;
                return (
                  <button
                    key={grp.key}
                    type="button"
                    onClick={() => setActionableGroup(grp.key as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                      isActive
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                        : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <span>{grp.label}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        isActive
                          ? 'bg-amber-400 text-slate-950'
                          : grp.count > 0
                          ? 'bg-amber-500/30 text-amber-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {grp.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="w-full sm:w-64">
              <input
                type="text"
                placeholder="Tìm theo ID, email, mã..."
                value={searchResearchQuery}
                onChange={(e) => setSearchResearchQuery(e.target.value)}
                className="quant-input text-xs w-full py-1.5 px-3"
              />
            </div>
          </div>

          {/* ACTIONABLE REQUEST CARDS LIST */}
          {researchLoading && researchRequests.length === 0 ? (
            <div className="quant-panel p-12 text-center text-xs text-slate-400">
              Đang đồng bộ hàng đợi xử lý...
            </div>
          ) : filteredResearchRequests.length === 0 ? (
            <div className="quant-panel p-12 text-center space-y-2">
              <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto" />
              <div className="text-sm font-semibold text-white">Hiện không có hồ sơ nào cần xử lý</div>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Tất cả đơn nghiên cứu đều đang được khách hàng xem xét, worker tự động chạy hoặc đã bàn giao hoàn tất.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredResearchRequests.map((req: any) => {
                const unreadCount = Number(req.unread_messages_count || 0);
                return (
                  <div
                    key={req.id}
                    onClick={() => setActiveDossierRequestId(req.id)}
                    className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-cyan-500/40 transition space-y-3 shadow-md cursor-pointer group"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-cyan-400 font-bold text-xs group-hover:text-cyan-300 transition">
                            {req.id}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                            {req.product_type}
                          </span>
                          <StatusBadge
                            tone={
                              req.status === 'DELIVERED' || req.status === 'COMPLETED'
                                ? 'success'
                                : req.status === 'READY_FOR_REVIEW'
                                ? 'info'
                                : req.status === 'FAILED' || req.status === 'REJECTED'
                                ? 'danger'
                                : 'warning'
                            }
                          >
                            {req.status}
                          </StatusBadge>
                          {unreadCount > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-cyan-500 text-slate-950 font-bold text-[10px] animate-pulse">
                              {unreadCount} tin nhắn mới
                            </span>
                          )}
                          {req.retry_count > 0 && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950/60 text-amber-300 border border-amber-800/40">
                              Chạy lại: {req.retry_count}/5
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-semibold text-white group-hover:text-cyan-100 transition">
                          {req.hypothesis_prompt || req.scope_notes || `Nghiên cứu ${req.symbol} ${req.timeframe}`}
                        </h4>
                        <p className="text-xs text-slate-400">
                          Khách hàng: <span className="text-slate-200">{req.client_email || req.user_id}</span> · Tạo lúc:{' '}
                          {new Date(req.created_at * 1000).toLocaleString('vi-VN')}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-400">Giá báo hợp đồng</div>
                        <div className="text-base font-bold text-emerald-400 font-mono">
                          ${Number(req.quoted_price_usd || 0).toLocaleString()} USD
                        </div>
                        <div className="text-[11px] text-slate-500">Thời hạn: {req.turnaround_hours || 24}h</div>
                      </div>
                    </div>

                    {/* Progress Reason Banner */}
                    {req.waiting_reason_vi && (
                      <div className="text-xs flex items-center gap-1.5 text-cyan-300 bg-cyan-950/30 px-3 py-2 rounded-lg border border-cyan-800/40 font-sans">
                        <Clock className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                        <span>Tiến độ hiện tại: <strong>{req.waiting_reason_vi}</strong></span>
                      </div>
                    )}

                    {req.problem_description && (
                      <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs text-slate-300">
                        <span className="text-cyan-400 font-semibold">Mô tả bài toán: </span>
                        {req.problem_description}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                      <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                        <span>Mã: <strong className="text-slate-200">{req.symbol}</strong></span>
                        <span>Khung: <strong className="text-slate-200">{req.timeframe}</strong></span>
                        <span>Bản: <strong className="text-slate-200">v{req.proposal_version || 1}</strong></span>
                        <span>Lần chạy: <strong className="text-slate-300">{req.run_count || 0}</strong></span>
                      </div>

                      {/* Single Action Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveDossierRequestId(req.id);
                        }}
                        className="quant-button quant-button-primary text-xs py-1.5 px-3 flex items-center gap-1.5 shadow-sm"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Mở Hồ Sơ Đầy Đủ</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* VIEW MODE 2: ALL RECORDS */}
      {viewMode === 'all_records' && (
        <div className="space-y-6">
          <div className="quant-heading">
            <div className="space-y-1">
              <div className="font-mono text-xs uppercase tracking-wider text-cyan-400 font-semibold">
                TRẠM QUẢN TRỊ · TẤT CẢ HỒ SƠ NGHIÊN CỨU
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Toàn Bộ Hồ Sơ Nghiên Cứu ({researchRequests.length})
              </h1>
              <p className="text-xs text-slate-400 m-0">
                Tra cứu toàn diện các nghiên cứu định lượng của khách hàng cá nhân và tổ chức trong toàn hệ thống.
              </p>
            </div>
            <button
              type="button"
              onClick={loadResearchRequests}
              className="quant-btn-secondary text-xs flex items-center gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${researchLoading ? 'animate-spin' : ''}`} />
              <span>Đồng bộ</span>
            </button>
          </div>

          {/* 4 OVERALL KPI CARDS */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="Tổng Hồ Sơ Nghiên Cứu"
              value={researchRequests.length}
              subtext="Cá nhân & Tổ chức"
              icon={<Layers className="h-4 w-4" />}
              tone="cyan"
            />
            <MetricCard
              label="Đang Chờ Khách"
              value={waitingClientCount}
              subtext="Chờ duyệt báo giá hoặc thanh toán"
              icon={<Clock className="h-4 w-4" />}
              tone="amber"
            />
            <MetricCard
              label="Worker Đang Chạy"
              value={runningCount}
              subtext="Đang thực thi mô phỏng định lượng"
              icon={<Cpu className="h-4 w-4" />}
              tone="cyan"
            />
            <MetricCard
              label="Đã Hoàn Tất Bàn Giao"
              value={deliveredCount}
              subtext="Đã gửi PDF & bộ bundle ZIP"
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="emerald"
            />
          </div>

          {/* STATUS FILTER TABS & SEARCH */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: 'ALL', label: 'Tất cả hồ sơ', count: researchRequests.length },
                { key: 'WAITING_CLIENT', label: 'Đang chờ khách', count: waitingClientCount },
                { key: 'RUNNING', label: 'Đang chạy', count: runningCount },
                { key: 'DELIVERED', label: 'Đã bàn giao', count: deliveredCount },
              ].map((tab) => {
                const isActive = allStatusFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setAllStatusFilter(tab.key as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
                      isActive
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                        : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        isActive ? 'bg-cyan-400 text-slate-950' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="w-full sm:w-64">
              <input
                type="text"
                placeholder="Tìm theo ID, email, mã..."
                value={searchResearchQuery}
                onChange={(e) => setSearchResearchQuery(e.target.value)}
                className="quant-input text-xs w-full py-1.5 px-3"
              />
            </div>
          </div>

          {/* REQUEST CARDS LIST */}
          {researchLoading && researchRequests.length === 0 ? (
            <div className="quant-panel p-12 text-center text-xs text-slate-400">
              Đang tải danh sách hồ sơ...
            </div>
          ) : filteredResearchRequests.length === 0 ? (
            <div className="quant-panel p-12 text-center text-xs text-slate-500 font-mono">
              Không có hồ sơ nào phù hợp với bộ lọc hiện tại.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredResearchRequests.map((req: any) => (
                <div
                  key={req.id}
                  onClick={() => setActiveDossierRequestId(req.id)}
                  className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-cyan-500/40 transition space-y-3 shadow-md cursor-pointer group"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-cyan-400 font-bold text-xs group-hover:text-cyan-300 transition">
                          {req.id}
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                          {req.product_type}
                        </span>
                        <StatusBadge
                          tone={
                            req.status === 'DELIVERED' || req.status === 'COMPLETED'
                              ? 'success'
                              : req.status === 'READY_FOR_REVIEW'
                              ? 'info'
                              : req.status === 'FAILED' || req.status === 'REJECTED'
                              ? 'danger'
                              : 'warning'
                          }
                        >
                          {req.status}
                        </StatusBadge>
                        {Number(req.unread_messages_count || 0) > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-cyan-500 text-slate-950 font-bold text-[10px]">
                            {req.unread_messages_count} tin mới
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-semibold text-white group-hover:text-cyan-100 transition">
                        {req.hypothesis_prompt || req.scope_notes || `Nghiên cứu ${req.symbol} ${req.timeframe}`}
                      </h4>
                      <p className="text-xs text-slate-400">
                        Khách hàng: <span className="text-slate-200">{req.client_email || req.user_id}</span> · Tạo lúc:{' '}
                        {new Date(req.created_at * 1000).toLocaleString('vi-VN')}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400">Giá báo</div>
                      <div className="text-base font-bold text-emerald-400 font-mono">
                        ${Number(req.quoted_price_usd || 0).toLocaleString()} USD
                      </div>
                    </div>
                  </div>

                  {req.waiting_reason_vi && (
                    <div className="text-xs flex items-center gap-1.5 text-slate-300 bg-slate-950/40 px-3 py-1.5 rounded border border-slate-800 font-sans">
                      <Clock className="w-3 h-3 shrink-0 text-cyan-400" />
                      <span>{req.waiting_reason_vi}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                      <span>Mã: <strong className="text-slate-200">{req.symbol}</strong></span>
                      <span>Khung: <strong className="text-slate-200">{req.timeframe}</strong></span>
                      <span>Phiên bản: <strong className="text-slate-200">v{req.proposal_version || 1}</strong></span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveDossierRequestId(req.id);
                      }}
                      className="quant-button quant-button-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Mở Hồ Sơ Đầy Đủ</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW MODE 3: SETTINGS (USERS, BILLING, TOOLS) */}
      {viewMode === 'settings' && (
        <div className="space-y-6">
          <div className="quant-heading">
            <div className="space-y-1">
              <div className="font-mono text-xs uppercase tracking-wider text-cyan-400 font-semibold">
                TRẠM QUẢN TRỊ · CÀI ĐẶT HỆ THỐNG
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Cài Đặt & Công Cụ Kỹ Thuật
              </h1>
              <p className="text-xs text-slate-400 m-0">
                Quản lý người dùng, cấu hình địa chỉ thanh toán, hoàn tiền đơn cũ và đồng bộ nến thị trường.
              </p>
            </div>
          </div>

          {/* SETTINGS SUB-TABS */}
          <div className="border-b border-slate-800 flex flex-wrap items-center gap-6 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setSettingsSubTab('users')}
              className={`pb-3 transition relative cursor-pointer ${
                settingsSubTab === 'users' ? 'text-white border-b-2 border-cyan-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Quản Lý Người Dùng
            </button>
            <button
              type="button"
              onClick={() => setSettingsSubTab('billing')}
              className={`pb-3 transition relative cursor-pointer ${
                settingsSubTab === 'billing' ? 'text-white border-b-2 border-cyan-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cấu Hình Ví & Đơn Hàng Cũ
            </button>
            <button
              type="button"
              onClick={() => setSettingsSubTab('tools')}
              className={`pb-3 transition relative cursor-pointer ${
                settingsSubTab === 'tools' ? 'text-white border-b-2 border-cyan-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Đồng Bộ Dữ Liệu & Chẩn Đoán Worker
            </button>
          </div>

          {/* 1. USERS TAB */}
          {settingsSubTab === 'users' && (
            <Panel
              title="Danh Sách Người Dùng & Phân Quyền"
              subtitle="Quản lý tài khoản, thay đổi quyền hạn customer / admin, đặt lại mật khẩu hoặc khóa tài khoản"
              action={
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="quant-btn-primary min-h-[32px] px-3 py-1 text-xs flex items-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Tạo người dùng mới</span>
                </button>
              }
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <input
                    type="text"
                    value={searchUserQuery}
                    onChange={(e) => setSearchUserQuery(e.target.value)}
                    placeholder="Tìm theo email, mã người dùng..."
                    className="quant-input text-xs font-mono py-1.5 w-72"
                  />
                  <button
                    type="button"
                    onClick={loadUsersOnDemand}
                    className="quant-btn-secondary text-xs flex items-center gap-1"
                  >
                    <RefreshCw className={`h-3 w-3 ${usersLoading ? 'animate-spin' : ''}`} />
                    <span>Làm mới</span>
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="quant-table text-xs">
                    <thead>
                      <tr>
                        <th>Người Dùng</th>
                        <th>Vai Trò</th>
                        <th>Trạng Thái</th>
                        <th>Ngày Tạo</th>
                        <th className="text-right">Thao Tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users
                        .filter((u) => {
                          if (!searchUserQuery.trim()) return true;
                          const q = searchUserQuery.toLowerCase();
                          return (
                            String(u.email || '').toLowerCase().includes(q) ||
                            String(u.id || '').toLowerCase().includes(q)
                          );
                        })
                        .map((u) => {
                          const isSusp = Boolean(u.is_suspended);
                          return (
                            <tr key={u.id}>
                              <td>
                                <div className="font-semibold text-white">{u.email}</div>
                                <div className="font-mono text-[11px] text-slate-500">{u.id}</div>
                              </td>
                              <td>
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                                    u.role === 'admin'
                                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                      : 'bg-slate-800 text-slate-300'
                                  }`}
                                >
                                  {u.role.toUpperCase()}
                                </span>
                              </td>
                              <td>
                                <StatusBadge tone={isSusp ? 'danger' : 'success'}>
                                  {isSusp ? 'ĐÃ KHÓA' : 'HOẠT ĐỘNG'}
                                </StatusBadge>
                              </td>
                              <td className="font-mono text-[11px] text-slate-400">
                                {u.created_at ? new Date(Number(u.created_at) * 1000).toLocaleDateString('vi-VN') : '—'}
                              </td>
                              <td className="text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRoleChangeTarget({
                                        id: u.id,
                                        email: u.email,
                                        currentRole: u.role,
                                        newRole: u.role === 'admin' ? 'customer' : 'admin',
                                      })
                                    }
                                    className="quant-button quant-button-secondary text-[11px] py-1 px-2"
                                  >
                                    Đổi vai trò
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setResetTarget({ id: u.id, email: u.email })}
                                    className="quant-button quant-button-secondary text-[11px] py-1 px-2"
                                  >
                                    Đổi MK
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleSuspendUser(u.id, u.email)}
                                    className={`quant-button text-[11px] py-1 px-2 ${
                                      isSusp ? 'text-emerald-400' : 'text-rose-400'
                                    }`}
                                  >
                                    {isSusp ? 'Mở khóa' : 'Khóa'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            </Panel>
          )}

          {/* 2. BILLING & LEGACY ORDERS TAB */}
          {settingsSubTab === 'billing' && (
            <div className="space-y-6">
              {/* Wallet Configuration Component */}
              <AdminBillingSettings />

              {/* Legacy Orders Table & Refund Management */}
              <Panel
                title="Đơn Mua Cũ & Xử Lý Hoàn Tiền"
                subtitle="Xem lại các đơn mua trước đây và thực hiện hoàn tiền nếu phát sinh tranh chấp hoặc đơn treo"
              >
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Trạng thái:</span>
                      <select
                        value={orderStatusFilter}
                        onChange={(e: any) => setOrderStatusFilter(e.target.value)}
                        className="quant-input text-xs py-1.5"
                      >
                        <option value="ALL">Tất cả ({orders.length})</option>
                        <option value="PENDING">Chờ đối soát</option>
                        <option value="PAID">Đã thanh toán</option>
                        <option value="REFUNDED">Đã hoàn tiền</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={searchOrderQuery}
                        onChange={(e) => setSearchOrderQuery(e.target.value)}
                        placeholder="Tìm theo mã đơn, email..."
                        className="quant-input text-xs font-mono py-1.5 w-64"
                      />
                      <button
                        type="button"
                        onClick={loadBillingOnDemand}
                        className="quant-btn-secondary text-xs flex items-center gap-1"
                      >
                        <RefreshCw className={`h-3 w-3 ${ordersLoading ? 'animate-spin' : ''}`} />
                        <span>Làm mới</span>
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="quant-table text-xs">
                      <thead>
                        <tr>
                          <th>Mã Đơn / Ngày Tạo</th>
                          <th>Khách Hàng</th>
                          <th>Mã / Phiên Bản</th>
                          <th>Cổng / Mạng</th>
                          <th className="text-right">Số Tiền (USDT)</th>
                          <th>Trạng Thái</th>
                          <th className="text-right">Thao Tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders
                          .filter((o) => {
                            if (orderStatusFilter !== 'ALL') {
                              if (orderStatusFilter === 'PENDING' && o.status !== 'PENDING') return false;
                              if (orderStatusFilter === 'PAID' && o.status !== 'PAID' && o.status !== 'COMPLETED') return false;
                              if (orderStatusFilter === 'REFUNDED' && o.status !== 'REFUNDED') return false;
                            }
                            if (searchOrderQuery.trim()) {
                              const q = searchOrderQuery.toLowerCase();
                              return (
                                String(o.id || '').toLowerCase().includes(q) ||
                                String(o.user_email || '').toLowerCase().includes(q) ||
                                String(o.tx_hash || '').toLowerCase().includes(q)
                              );
                            }
                            return true;
                          })
                          .map((o) => {
                            const isPaid = ['PAID', 'COMPLETED'].includes(String(o.status || '').toUpperCase());
                            const isRefunded = String(o.status || '').toUpperCase() === 'REFUNDED';
                            return (
                              <tr key={o.id}>
                                <td>
                                  <div className="font-mono font-semibold text-white">{o.id}</div>
                                  <div className="font-mono text-[11px] text-slate-500">
                                    {o.created_at ? new Date(Number(o.created_at) * 1000).toLocaleString('vi-VN') : '—'}
                                  </div>
                                </td>
                                <td>
                                  <div className="font-medium text-slate-200">{o.user_email || o.user_id}</div>
                                </td>
                                <td>
                                  <div className="font-semibold text-cyan-300">{o.report_id || o.plan_tier || 'N/A'}</div>
                                  <div className="font-mono text-[11px] text-amber-300">{o.report_version || 'v1.0'}</div>
                                </td>
                                <td className="font-mono text-[11px] text-slate-300">
                                  {o.payment_gateway || 'DIRECT_USDT'}
                                </td>
                                <td className="text-right font-mono font-bold text-emerald-400 tabular-nums">
                                  ${Number(o.amount_usd || o.expected_amount_usdt || 0).toFixed(2)}
                                </td>
                                <td>
                                  <StatusBadge tone={isRefunded ? 'danger' : isPaid ? 'success' : 'warning'}>
                                    {o.status}
                                  </StatusBadge>
                                </td>
                                <td className="text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {!isPaid && !isRefunded && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setApproveTarget({
                                            id: o.id,
                                            email: o.user_email || '',
                                            amount: Number(o.amount_usd || o.expected_amount_usdt || 0),
                                            product: o.report_id || 'Legacy Report',
                                          })
                                        }
                                        className="quant-btn-primary min-h-[28px] px-2 py-0.5 text-[11px]"
                                      >
                                        Duyệt thủ công
                                      </button>
                                    )}
                                    {!isRefunded && (
                                      <button
                                        type="button"
                                        disabled={busyId === `refund_${o.id}`}
                                        onClick={() => executeRefundOrder(o.id)}
                                        className="quant-button text-red-400 hover:bg-red-950/30 text-[11px] py-1 px-2"
                                      >
                                        {busyId === `refund_${o.id}` ? 'Đang hoàn...' : 'Hoàn tiền'}
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Panel>
            </div>
          )}

          {/* 3. TOOLS & DATA SYNC TAB */}
          {settingsSubTab === 'tools' && (
            <div className="space-y-6">
              {/* Market Candle Data Sync Panel */}
              <Panel
                title="Đồng Bộ Dữ Liệu Nến Thị Trường"
                subtitle="Cập nhật dữ liệu OHLCV 5 ngày gần nhất cho các cặp tài sản phục vụ kiểm định vi cấu trúc"
              >
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {['XAUUSD', 'EURUSD', 'BTCUSD'].map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        disabled={syncingSymbol === sym}
                        onClick={() => handleSyncCandles(sym)}
                        className="quant-button quant-button-primary text-xs py-2 px-3.5 flex items-center gap-2"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${syncingSymbol === sym ? 'animate-spin' : ''}`} />
                        <span>{syncingSymbol === sym ? `Đang đồng bộ ${sym}...` : `Đồng Bộ Nến ${sym} (5 Ngày)`}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={loadMarketStatusOnDemand}
                      className="quant-button quant-button-secondary text-xs py-2 px-3"
                    >
                      Kiểm Tra Trạng Thái Dữ Liệu
                    </button>
                  </div>

                  {dataSyncStatus.length > 0 && (
                    <div className="overflow-x-auto pt-2">
                      <table className="quant-table text-xs font-mono">
                        <thead>
                          <tr>
                            <th>Mã Tài Sản</th>
                            <th>Khung Giờ</th>
                            <th>Số Lượng Nến</th>
                            <th>Nến Sớm Nhất</th>
                            <th>Nến Mới Nhất</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dataSyncStatus.map((st: any, idx: number) => (
                            <tr key={idx}>
                              <td className="font-bold text-cyan-300">{st.symbol}</td>
                              <td>{st.timeframe}</td>
                              <td className="text-emerald-400 font-bold">{st.candles_count}</td>
                              <td className="text-slate-400">{st.earliest_bar || '—'}</td>
                              <td className="text-slate-200">{st.latest_bar || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </Panel>

              {/* Worker Diagnostics & Health Check */}
              <Panel
                title="Chẩn Đoán Toàn Bộ Tiến Trình Worker"
                subtitle="Kiểm tra nhịp tim worker, kết nối Redis, cơ sở dữ liệu và hàng đợi xử lý nghiên cứu"
                action={
                  <button
                    type="button"
                    disabled={dryRunRunning}
                    onClick={handleRunDiagnostics}
                    className="quant-btn-primary min-h-[32px] px-3 py-1 text-xs flex items-center gap-1.5"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>{dryRunRunning ? 'Đang kiểm tra...' : 'Chạy Kiểm Tra Ngay'}</span>
                  </button>
                }
              >
                <div className="space-y-4">
                  {dryRunResult ? (
                    <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3 font-mono text-xs">
                      <div className="flex items-center gap-2 text-emerald-400 font-bold">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>{dryRunResult.message || 'Hệ thống đang hoạt động an toàn.'}</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-[11px]">
                        <div>
                          <span className="text-slate-500">Database:</span>{' '}
                          <span className="text-emerald-400 font-bold">OK</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Research Worker:</span>{' '}
                          <span className="text-cyan-400 font-bold">ACTIVE</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Execution Mode:</span>{' '}
                          <span className="text-slate-300">ON-DEMAND RESEARCH</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Timeout Watchdog:</span>{' '}
                          <span className="text-emerald-400 font-bold">15 MIN</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">
                      Bấm &quot;Chạy Kiểm Tra Ngay&quot; để thực hiện chẩn đoán luồng xử lý worker và đảm bảo không có job nào bị treo quá hạn 15 phút.
                    </p>
                  )}
                </div>
              </Panel>
            </div>
          )}
        </div>
      )}

      {/* UNIFIED DOSSIER MODAL (The Single Place for Chat, Attachments, Quote, Run & Delivery) */}
      {activeDossierRequestId && (
        <AdminResearchDossierModal
          requestId={activeDossierRequestId}
          onClose={() => {
            setActiveDossierRequestId(null);
            loadResearchRequests();
          }}
          onUpdated={loadResearchRequests}
        />
      )}

      {/* Manual Approval Modal for Legacy USDT Orders */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0B1220] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">Đối Soát Thủ Công Đơn #{approveTarget.id}</h3>
              <button type="button" onClick={() => setApproveTarget(null)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={executeApproveOrder} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400">Mã giao dịch (Tx Hash) đã xác minh trên Blockchain:</label>
                <input
                  type="text"
                  required
                  value={approveTxHash}
                  onChange={(e) => setApproveTxHash(e.target.value)}
                  placeholder="0x... hoặc chuỗi hash"
                  className="quant-input w-full font-mono py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setApproveTarget(null)} className="quant-btn-secondary text-xs">
                  Hủy
                </button>
                <button type="submit" disabled={approveSaving} className="quant-btn-primary text-xs">
                  {approveSaving ? 'Đang xác nhận...' : 'Xác nhận Đã Thu Tiền'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change User Role Modal */}
      {roleChangeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#0B1220] p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-white">Xác Nhận Thay Đổi Vai Trò</h3>
            <p className="text-xs text-slate-300">
              Bạn có chắc muốn chuyển tài khoản <strong className="text-white">{roleChangeTarget.email}</strong> sang vai trò{' '}
              <strong className="text-cyan-400 font-mono">{roleChangeTarget.newRole.toUpperCase()}</strong>?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setRoleChangeTarget(null)} className="quant-btn-secondary text-xs">
                Hủy
              </button>
              <button type="button" disabled={roleSaving} onClick={executeRoleChange} className="quant-btn-primary text-xs">
                {roleSaving ? 'Đang lưu...' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#0B1220] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">Đặt Lại Mật Khẩu</h3>
              <button type="button" onClick={() => setResetTarget(null)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleResetPassword} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400">Mật khẩu mới cho {resetTarget.email}:</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  placeholder="Tối thiểu 8 ký tự"
                  className="quant-input w-full py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setResetTarget(null)} className="quant-btn-secondary text-xs">
                  Hủy
                </button>
                <button type="submit" disabled={resetSaving} className="quant-btn-primary text-xs">
                  {resetSaving ? 'Đang lưu...' : 'Lưu mật khẩu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#0B1220] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">Tạo Người Dùng Mới</h3>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400">Email:</label>
                <input
                  type="email"
                  required
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="quant-input w-full py-2"
                />
              </div>
              <div className="space-y-1">
                <label className="text-slate-400">Mật khẩu ban đầu:</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="Tối thiểu 8 ký tự"
                  className="quant-input w-full py-2"
                />
              </div>
              <div className="space-y-1">
                <label className="text-slate-400">Vai trò:</label>
                <select
                  value={createRole}
                  onChange={(e: any) => setCreateRole(e.target.value)}
                  className="quant-input w-full py-2"
                >
                  <option value="customer">Customer (Khách hàng)</option>
                  <option value="admin">Admin (Quản trị viên)</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="quant-btn-secondary text-xs">
                  Hủy
                </button>
                <button type="submit" disabled={createSaving} className="quant-btn-primary text-xs">
                  {createSaving ? 'Đang tạo...' : 'Tạo tài khoản'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
