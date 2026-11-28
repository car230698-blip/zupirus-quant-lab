import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { AdminBillingSettings } from '../../components/admin/AdminBillingSettings';
import { ToastNotification } from '../../components/ToastNotification';
import { AdminErrorBanner, AdminErrorInfo } from '../../components/AdminErrorBanner';
import { MetricCard, Panel, StatusBadge } from '../../components/ui/Primitives';
import { OrderChatModal } from '../../components/research/OrderChatModal';
import { AdminResearchDossierModal } from '../../components/research/AdminResearchDossierModal';
import {
  CheckCircle2,
  Clock,
  DollarSign,
  X,
  KeyRound,
  ShieldAlert,
  Plus,
  MessageSquare,
  Play,
  RotateCcw,
  RefreshCw,
  AlertCircle,
  FileText,
} from 'lucide-react';

export interface AdminOrdersUsersPageProps {
  initialSubTab?: 'research_orders' | 'orders' | 'trials' | 'users' | 'settings';
}

export const AdminOrdersUsersPage: React.FC<AdminOrdersUsersPageProps> = ({ initialSubTab }) => {
  const [summary, setSummary] = useState<any>({ orders: { paid_revenue_usd: 0 } });
  const [orders, setOrders] = useState<any[]>([]);
  const [trials, setTrials] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [researchRequests, setResearchRequests] = useState<any[]>([]);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'research_orders' | 'orders' | 'trials' | 'users' | 'settings'>(
    initialSubTab || 'research_orders'
  );

  useEffect(() => {
    if (initialSubTab) {
      setActiveSubTab(initialSubTab);
    }
  }, [initialSubTab]);
  const [researchStatusFilter, setResearchStatusFilter] = useState<
    'ACTIONABLE' | 'WAITING_CLIENT' | 'RUNNING' | 'DELIVERED' | 'ALL'
  >('ACTIONABLE');
  const [actionableGroup, setActionableGroup] = useState<
    'ALL_ACTIONABLE' | 'PENDING_REPLY' | 'PENDING_QUOTE' | 'NEEDS_DATA' | 'READY_FOR_REVIEW' | 'ERROR_INTERVENTION'
  >('ALL_ACTIONABLE');
  const [activeDossierRequestId, setActiveDossierRequestId] = useState<string | null>(null);
  const [searchResearchQuery, setSearchResearchQuery] = useState('');
  const [activeChatOrder, setActiveChatOrder] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'PAID'>('ALL');
  const [searchOrderQuery, setSearchOrderQuery] = useState('');
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [errorBanner, setErrorBanner] = useState<AdminErrorInfo | null>(null);

  // Quote Modal State for Custom Research Requests
  const [quoteTarget, setQuoteTarget] = useState<any | null>(null);
  const [quotePriceInput, setQuotePriceInput] = useState<number>(10000);
  const [quoteNotesInput, setQuoteNotesInput] = useState<string>('Bao gồm mô hình truyền dẫn CPI liên thị trường và bộ replay độc lập.');
  const [quoteSaving, setQuoteSaving] = useState(false);

  // Manual Approval Modal State (Requires tx_hash)
  const [approveTarget, setApproveTarget] = useState<{ id: string; email: string; amount: number; product: string } | null>(null);
  const [approveTxHash, setApproveTxHash] = useState('');
  const [approveSaving, setApproveSaving] = useState(false);

  // Trial Grant Modal State
  const [showGrantTrialModal, setShowGrantTrialModal] = useState(false);
  const [trialEmailInput, setTrialEmailInput] = useState('');
  const [trialReportInput, setTrialReportInput] = useState('gold-m15-breakout-retest-v1');
  const [trialVersionInput, setTrialVersionInput] = useState('v1.0');
  const [trialDaysInput, setTrialDaysInput] = useState(30);
  const [trialNotesInput, setTrialNotesInput] = useState('Institutional Pilot Agreement');
  const [trialSaving, setTrialSaving] = useState(false);

  // Trial Extend / Revoke / Transfer Modal States
  const [extendTrialTarget, setExtendTrialTarget] = useState<any | null>(null);
  const [extendDaysInput, setExtendDaysInput] = useState(30);
  const [revokeTrialTarget, setRevokeTrialTarget] = useState<any | null>(null);
  const [revokeReasonInput, setRevokeReasonInput] = useState('Đã hết hạn thỏa thuận dùng thử');
  const [transferTrialTarget, setTransferTrialTarget] = useState<any | null>(null);
  const [transferEmailInput, setTransferEmailInput] = useState('');

  // Role Confirmation Modal State
  const [roleChangeTarget, setRoleChangeTarget] = useState<{ id: string; email: string; currentRole: string; newRole: string } | null>(null);
  const [roleSaving, setRoleSaving] = useState(false);

  // Password Reset Modal State
  const [resetTarget, setResetTarget] = useState<{ id: string; email: string } | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [resetSaving, setResetSaving] = useState(false);

  // Create User Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<'customer' | 'admin'>('customer');
  const [createSaving, setCreateSaving] = useState(false);

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

  const loadBillingAndUsers = useCallback(async () => {
    try {
      const [sData, oData, tData, uData] = await Promise.all([
        api.get('/api/admin/billing/summary'),
        api.get('/api/admin/billing/orders'),
        api.get('/api/v1/admin/billing/trials').catch(() => ({ trials: [] })),
        api.get('/api/admin/users'),
      ]);
      if (sData) setSummary(sData);
      if (oData) setOrders(oData.orders || oData || []);
      if (tData) setTrials(tData.trials || []);
      if (uData) setUsers(uData.users || uData || []);
      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner({
        status: err?.status,
        message: err?.message || 'Không thể đồng bộ dữ liệu đơn hàng, giấy phép & người dùng.',
      });
    }
  }, []);

  const loadData = useCallback(async () => {
    await Promise.allSettled([loadResearchRequests(), loadBillingAndUsers()]);
  }, [loadResearchRequests, loadBillingAndUsers]);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 20000);
    return () => clearInterval(timer);
  }, [loadData]);

  const executeManualApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approveTarget) return;
    const cleanTx = approveTxHash.trim();
    if (cleanTx.length < 8) {
      setMsg('Vui lòng nhập mã băm giao dịch blockchain (tx_hash) tối thiểu 8 ký tự.');
      return;
    }
    setApproveSaving(true);
    try {
      const res: any = await api.post(`/api/admin/billing/orders/${encodeURIComponent(approveTarget.id)}/approve`, {
        tx_hash: cleanTx,
      });
      setMsg(res?.message || `Đã duyệt đơn hàng ${approveTarget.id} thành công với tx_hash.`);
      setApproveTarget(null);
      setApproveTxHash('');
      await loadData();
    } catch (err: any) {
      setMsg(`Lỗi duyệt đơn: ${err?.message || ''}`);
    } finally {
      setApproveSaving(false);
    }
  };

  const executeGrantTrial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trialEmailInput.trim()) return;
    setTrialSaving(true);
    try {
      const res: any = await api.post('/api/v1/admin/billing/trials/grant', {
        email: trialEmailInput.trim(),
        report_id: trialReportInput.trim(),
        version: trialVersionInput.trim(),
        duration_days: trialDaysInput,
        notes: trialNotesInput,
      });
      setMsg(res?.message || 'Đã cấp giấy phép dùng thử thành công.');
      setShowGrantTrialModal(false);
      setTrialEmailInput('');
      await loadData();
    } catch (err: any) {
      setMsg(`Lỗi cấp giấy phép: ${err?.message || ''}`);
    } finally {
      setTrialSaving(false);
    }
  };

  const executeExtendTrial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extendTrialTarget) return;
    setBusyId(`ext_${extendTrialTarget.id}`);
    try {
      const res: any = await api.post(`/api/v1/admin/billing/trials/${encodeURIComponent(extendTrialTarget.id)}/extend`, {
        extra_days: extendDaysInput,
      });
      setMsg(res?.message || 'Đã gia hạn giấy phép thành công.');
      setExtendTrialTarget(null);
      await loadData();
    } catch (err: any) {
      setMsg(`Lỗi gia hạn: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const executeRevokeTrial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokeTrialTarget) return;
    setBusyId(`rev_${revokeTrialTarget.id}`);
    try {
      const res: any = await api.post(`/api/v1/admin/billing/trials/${encodeURIComponent(revokeTrialTarget.id)}/revoke`, {
        reason: revokeReasonInput,
      });
      setMsg(res?.message || 'Đã thu hồi giấy phép dùng thử thành công.');
      setRevokeTrialTarget(null);
      await loadData();
    } catch (err: any) {
      setMsg(`Lỗi thu hồi: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const executeTransferTrial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTrialTarget || !transferEmailInput.trim()) return;
    setBusyId(`trans_${transferTrialTarget.id}`);
    try {
      const res: any = await api.post(`/api/v1/admin/billing/trials/${encodeURIComponent(transferTrialTarget.id)}/change-email`, {
        new_email: transferEmailInput.trim(),
      });
      setMsg(res?.message || 'Đã chuyển đổi email người nhận giấy phép.');
      setTransferTrialTarget(null);
      setTransferEmailInput('');
      await loadData();
    } catch (err: any) {
      setMsg(`Lỗi chuyển đổi email: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const executeRoleChange = async () => {
    if (!roleChangeTarget) return;
    setRoleSaving(true);
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(roleChangeTarget.id)}/role`, {
        role: roleChangeTarget.newRole,
      });
      setMsg(`Đã đổi vai trò của ${roleChangeTarget.email} sang ${roleChangeTarget.newRole.toUpperCase()}.`);
      setRoleChangeTarget(null);
      await loadData();
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
      await loadData();
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
      await loadData();
    } catch (err: any) {
      setMsg(`Lỗi đổi mật khẩu: ${err?.message || ''}`);
    } finally {
      setResetSaving(false);
    }
  };

  const handleRunResearch = async (reqId: string) => {
    setBusyId(`run_${reqId}`);
    try {
      const res: any = await api.post(`/api/v1/admin/research/requests/${encodeURIComponent(reqId)}/run`, {});
      setMsg(res?.message || 'Đã thực thi nghiên cứu định lượng thành công.');
      await loadData();
    } catch (err: any) {
      setMsg(`Lỗi chạy nghiên cứu: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleApproveResearch = async (reqId: string) => {
    setBusyId(`app_${reqId}`);
    try {
      const res: any = await api.post(`/api/v1/admin/research/requests/${encodeURIComponent(reqId)}/approve`, {});
      setMsg(res?.message || 'Đã duyệt bàn giao riêng cho khách hàng.');
      await loadData();
    } catch (err: any) {
      setMsg(`Lỗi duyệt bàn giao: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleExecuteQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quoteTarget) return;
    setQuoteSaving(true);
    try {
      const res: any = await api.post(`/api/v1/admin/research/requests/${encodeURIComponent(quoteTarget.id)}/quote`, {
        quoted_price_usd: Number(quotePriceInput),
        scope_notes: quoteNotesInput,
      });
      setMsg(res?.message || 'Đã lưu báo giá thành công.');
      setQuoteTarget(null);
      await loadData();
    } catch (err: any) {
      setMsg(`Lỗi báo giá: ${err?.message || ''}`);
    } finally {
      setQuoteSaving(false);
    }
  };

  const handleCloseResearch = async (reqId: string) => {
    if (!confirm('Bạn có chắc chắn muốn đóng yêu cầu nghiên cứu này?')) return;
    setBusyId(`close_${reqId}`);
    try {
      const res: any = await api.post(`/api/v1/admin/research/requests/${encodeURIComponent(reqId)}/close`, {
        reason: 'Đã đóng theo thỏa thuận quản trị viên.',
      });
      setMsg(res?.message || 'Đã đóng yêu cầu nghiên cứu.');
      await loadData();
    } catch (err: any) {
      setMsg(`Lỗi đóng yêu cầu: ${err?.message || ''}`);
    } finally {
      setBusyId(null);
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
      await loadData();
    } catch (err: any) {
      setMsg(`Lỗi tạo tài khoản: ${err?.message || ''}`);
    } finally {
      setCreateSaving(false);
    }
  };

  // Filter orders (Exclude trials from commercial orders view or tag them clearly)
  const filteredOrders = orders.filter((o: any) => {
    const isTrial = o.payment_status === 'FREE_TRIAL' || String(o.id || '').startsWith('trial_');
    if (isTrial) return false; // Trials belong in the dedicated Trials sub-tab
    const st = String(o.status || '').toUpperCase();
    if (statusFilter === 'PAID') {
      if (st !== 'PAID') return false;
    } else if (statusFilter === 'PENDING') {
      if (st === 'PAID') return false;
    }
    if (searchOrderQuery.trim()) {
      const q = searchOrderQuery.toLowerCase();
      const idMatch = String(o.id || '').toLowerCase().includes(q);
      const emailMatch = String(o.user_email || '').toLowerCase().includes(q);
      const txMatch = String(o.tx_hash || '').toLowerCase().includes(q);
      if (!idMatch && !emailMatch && !txMatch) return false;
    }
    return true;
  });

  const paidOrdersCount = orders.filter(
    (o: any) => String(o.status || '').toUpperCase() === 'PAID' && o.payment_status !== 'FREE_TRIAL' && !String(o.id || '').startsWith('trial_')
  ).length;

  const pendingOrdersCount = orders.filter(
    (o: any) => String(o.status || '').toUpperCase() !== 'PAID' && o.payment_status !== 'FREE_TRIAL' && !String(o.id || '').startsWith('trial_')
  ).length;

  const totalRevenueUsd = Number(summary?.orders?.paid_revenue_usd ?? 0);
  const activeTrialsCount = trials.filter((t: any) => t.is_active).length;

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
            TRẠM QUẢN TRỊ · ĐƠN HÀNG, GIẤY PHÉP & NGƯỜI DÙNG
          </div>
          <h1>Quản Lý Đơn Hàng USDT & Giấy Phép Nghiên Cứu</h1>
          <p className="text-sm text-slate-400 m-0">
            Tách bạch đơn mua thương mại USDT on-chain và giấy phép dùng thử độc lập cho các đội khách hàng.
          </p>
        </div>
      </div>

      <ToastNotification message={msg || null} type="info" onClose={() => setMsg('')} />
      <AdminErrorBanner error={errorBanner} onRetry={loadData} onDismiss={() => setErrorBanner(null)} />

      {/* TOP 4 KPI CARDS */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Doanh Thu Đã Thu"
          value={`$${totalRevenueUsd.toFixed(2)}`}
          subtext="USDT On-Chain (Đã đối soát)"
          icon={<DollarSign className="h-4 w-4" />}
          tone="emerald"
        />
        <MetricCard
          label="Đơn Đã Mở Khóa"
          value={paidOrdersCount}
          subtext="Bản quyền PDF vĩnh viễn"
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="cyan"
        />
        <MetricCard
          label="Đơn Chờ Đối Soát"
          value={pendingOrdersCount}
          subtext="Yêu cầu nhập tx_hash"
          icon={<Clock className="h-4 w-4" />}
          tone="amber"
        />
        <MetricCard
          label="Giấy Phép Dùng Thử"
          value={activeTrialsCount}
          subtext={`${trials.length} tổng giấy phép cấp`}
          icon={<KeyRound className="h-4 w-4" />}
          tone="cyan"
        />
      </div>

      {/* SUB-TABS NAVIGATION */}
      <div className="border-b border-slate-800 flex flex-wrap items-center gap-6 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveSubTab('research_orders')}
          className={`pb-3 transition relative cursor-pointer ${
            activeSubTab === 'research_orders' ? 'text-white border-b-2 border-cyan-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Đơn Nghiên Cứu ({researchRequests.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('orders')}
          className={`pb-3 transition relative cursor-pointer ${
            activeSubTab === 'orders' ? 'text-white border-b-2 border-cyan-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Đơn Mua USDT ({filteredOrders.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('trials')}
          className={`pb-3 transition relative cursor-pointer ${
            activeSubTab === 'trials' ? 'text-white border-b-2 border-cyan-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Giấy Phép Dùng Thử ({trials.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('users')}
          className={`pb-3 transition relative cursor-pointer ${
            activeSubTab === 'users' ? 'text-white border-b-2 border-cyan-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Người Dùng & Quyền Hạn ({users.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('settings')}
          className={`pb-3 transition relative cursor-pointer ${
            activeSubTab === 'settings' ? 'text-white border-b-2 border-cyan-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Vận Hành & Cấu Hình Ví
        </button>
      </div>

      {/* 0. RESEARCH ORDERS SUB-TAB (DEFAULT - ACTIONABLE QUEUE) */}
      {activeSubTab === 'research_orders' && (
        <Panel
          title="Hàng Đợi Xử Lý Nghiên Cứu Định Lượng"
          subtitle="Tập trung vào các hồ sơ cần xử lý ngoại lệ và phê duyệt quan trọng. Tự động hóa tối đa các tác vụ thường quy."
        >
          <div className="space-y-4">
            {/* Primary Queue Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                {[
                  {
                    key: 'ACTIONABLE',
                    label: 'Cần xử lý',
                    tone: 'amber',
                    count: researchRequests.filter(
                      (r) =>
                        Number(r.unread_messages_count || 0) > 0 ||
                        ['PENDING_QUOTE', 'NEEDS_DATA', 'NEEDS_ATTENTION', 'READY_FOR_REVIEW', 'FAILED', 'TIMED_OUT', 'ERROR'].includes(
                          r.status
                        )
                    ).length,
                  },
                  {
                    key: 'WAITING_CLIENT',
                    label: 'Đang chờ khách',
                    tone: 'slate',
                    count: researchRequests.filter((r) => ['QUOTED', 'WAITING_PAYMENT'].includes(r.status)).length,
                  },
                  {
                    key: 'RUNNING',
                    label: 'Đang chạy',
                    tone: 'cyan',
                    count: researchRequests.filter((r) => ['CONFIRMED', 'RUNNING'].includes(r.status)).length,
                  },
                  {
                    key: 'DELIVERED',
                    label: 'Đã bàn giao',
                    tone: 'emerald',
                    count: researchRequests.filter((r) => ['DELIVERED', 'COMPLETED'].includes(r.status)).length,
                  },
                  {
                    key: 'ALL',
                    label: 'Tất cả hồ sơ',
                    tone: 'slate',
                    count: researchRequests.length,
                  },
                ].map((tab) => {
                  const isActive = researchStatusFilter === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setResearchStatusFilter(tab.key as any)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
                        isActive
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                          : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                          isActive
                            ? 'bg-cyan-400 text-slate-950'
                            : tab.count > 0 && tab.key === 'ACTIONABLE'
                            ? 'bg-amber-500/30 text-amber-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Search Bar */}
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

            {/* Sub-chips for Actionable Queue */}
            {researchStatusFilter === 'ACTIONABLE' && (
              <div className="flex flex-wrap items-center gap-2 pt-1 pb-2">
                <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Phân nhóm:</span>
                {[
                  {
                    key: 'ALL_ACTIONABLE',
                    label: 'Tất cả cần xử lý',
                    count: researchRequests.filter(
                      (r) =>
                        Number(r.unread_messages_count || 0) > 0 ||
                        ['PENDING_QUOTE', 'NEEDS_DATA', 'NEEDS_ATTENTION', 'READY_FOR_REVIEW', 'FAILED', 'TIMED_OUT', 'ERROR'].includes(
                          r.status
                        )
                    ).length,
                  },
                  {
                    key: 'PENDING_REPLY',
                    label: 'Nhắn lại',
                    count: researchRequests.filter((r) => Number(r.unread_messages_count || 0) > 0).length,
                  },
                  {
                    key: 'PENDING_QUOTE',
                    label: 'Chờ duyệt báo giá',
                    count: researchRequests.filter((r) => r.status === 'PENDING_QUOTE').length,
                  },
                  {
                    key: 'NEEDS_DATA',
                    label: 'Cần bổ sung dữ liệu',
                    count: researchRequests.filter((r) => r.status === 'NEEDS_DATA' || r.status === 'NEEDS_ATTENTION').length,
                  },
                  {
                    key: 'READY_FOR_REVIEW',
                    label: 'Chờ duyệt bàn giao',
                    count: researchRequests.filter((r) => r.status === 'READY_FOR_REVIEW').length,
                  },
                  {
                    key: 'ERROR_INTERVENTION',
                    label: 'Lỗi / Cần can thiệp',
                    count: researchRequests.filter((r) => ['FAILED', 'TIMED_OUT', 'ERROR'].includes(r.status)).length,
                  },
                ].map((grp) => {
                  const isGrpActive = actionableGroup === grp.key;
                  return (
                    <button
                      key={grp.key}
                      type="button"
                      onClick={() => setActionableGroup(grp.key as any)}
                      className={`px-2 py-0.8 rounded text-[11px] transition flex items-center gap-1.5 ${
                        isGrpActive
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold'
                          : 'bg-slate-900/60 text-slate-400 border border-slate-800/80 hover:text-slate-300'
                      }`}
                    >
                      <span>{grp.label}</span>
                      <span className="text-[10px] opacity-75">({grp.count})</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Research Loading State */}
            {researchLoading && researchRequests.length === 0 && (
              <div className="p-8 text-center border border-dashed border-cyan-500/30 rounded-xl text-cyan-300 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                <span>Đang đồng bộ danh sách đơn nghiên cứu...</span>
              </div>
            )}

            {/* Research Error Banner with Retry */}
            {researchError && (
              <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{researchError}</span>
                </div>
                <button
                  type="button"
                  onClick={loadResearchRequests}
                  className="quant-button quant-button-secondary text-xs py-1 px-3"
                >
                  Thử lại
                </button>
              </div>
            )}

            {/* Request Cards List */}
            {!researchLoading && !researchError && researchRequests.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs">
                Chưa có đơn nghiên cứu theo yêu cầu nào. Khi khách hàng cá nhân hoặc tổ chức gửi yêu cầu, thông tin sẽ hiển thị tại đây.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {researchRequests
                  .filter((req: any) => {
                    // Search query matching
                    if (searchResearchQuery.trim()) {
                      const q = searchResearchQuery.trim().toLowerCase();
                      const matchId = String(req.id || '').toLowerCase().includes(q);
                      const matchEmail = String(req.client_email || '').toLowerCase().includes(q);
                      const matchSymbol = String(req.symbol || '').toLowerCase().includes(q);
                      const matchPrompt = String(req.hypothesis_prompt || req.problem_description || '').toLowerCase().includes(q);
                      if (!matchId && !matchEmail && !matchSymbol && !matchPrompt) return false;
                    }

                    // Main Queue filtering
                    if (researchStatusFilter === 'ALL') return true;
                    if (researchStatusFilter === 'WAITING_CLIENT') {
                      return ['QUOTED', 'WAITING_PAYMENT'].includes(req.status);
                    }
                    if (researchStatusFilter === 'RUNNING') {
                      return ['CONFIRMED', 'RUNNING'].includes(req.status);
                    }
                    if (researchStatusFilter === 'DELIVERED') {
                      return ['DELIVERED', 'COMPLETED'].includes(req.status);
                    }

                    // Actionable sub-filters
                    if (researchStatusFilter === 'ACTIONABLE') {
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
                    return true;
                  })
                  .map((req: any) => {
                    const unreadCount = Number(req.unread_messages_count || 0);
                    return (
                      <div
                        key={req.id}
                        className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700/80 transition space-y-3 shadow-md"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-cyan-400 font-bold text-xs">{req.id}</span>
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
                            <h4 className="text-sm font-semibold text-white">
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

                        {/* Waiting reason highlighted */}
                        {req.waiting_reason_vi && (
                          <div className="text-xs flex items-center gap-1.5 text-cyan-300 bg-cyan-950/30 px-3 py-2 rounded-lg border border-cyan-800/40 font-sans">
                            <Clock className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                            <span>Lý do chờ / Tiến độ: <strong>{req.waiting_reason_vi}</strong></span>
                          </div>
                        )}

                        {req.problem_description && (
                          <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs text-slate-300">
                            <span className="text-cyan-400 font-semibold">Mô tả bài toán: </span>
                            {req.problem_description}
                          </div>
                        )}

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2 px-3 bg-slate-950/40 rounded-lg border border-slate-800/80 text-xs font-mono">
                          <div>
                            <span className="text-slate-500">Mã chính:</span> <span className="text-slate-200 font-bold">{req.symbol}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Khung:</span> <span className="text-slate-200">{req.timeframe}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Phiên bản:</span> <span className="text-slate-200">v{req.proposal_version || 1}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Lượt chạy:</span> <span className="text-slate-300">{req.run_count || 0}</span>
                          </div>
                        </div>

                        {/* Bottom Actions Bar */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                          <div className="flex items-center gap-2">
                            {/* 1-click Dossier Modal Button */}
                            <button
                              type="button"
                              onClick={() => setActiveDossierRequestId(req.id)}
                              className="quant-button quant-button-primary text-xs py-1.5 px-3 flex items-center gap-1.5 shadow-sm"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>Mở Hồ Sơ Đầy Đủ</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setActiveChatOrder(req)}
                              className="quant-button quant-button-secondary text-xs py-1.5 px-2.5 flex items-center gap-1.5"
                            >
                              <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                              <span>Trao Đổi</span>
                              {unreadCount > 0 && (
                                <span className="px-1.5 py-0.2 rounded-full bg-cyan-500 text-slate-950 font-bold text-[10px]">
                                  {unreadCount}
                                </span>
                              )}
                            </button>

                            {req.deliverable_pdf_path && (
                              <a
                                href={`/api/v1/research/orders/${encodeURIComponent(req.id)}/download-pdf`}
                                target="_blank"
                                rel="noreferrer"
                                className="quant-button quant-button-secondary text-xs py-1.5 px-2.5"
                              >
                                Xem PDF
                              </a>
                            )}
                            {req.deliverable_bundle_path && (
                              <a
                                href={`/api/v1/research/orders/${encodeURIComponent(req.id)}/download-bundle`}
                                target="_blank"
                                rel="noreferrer"
                                className="quant-button quant-button-secondary text-xs py-1.5 px-2.5"
                              >
                                Tải Bundle ZIP
                              </a>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {req.status === 'PENDING_QUOTE' && (
                              <button
                                type="button"
                                disabled={busyId === `close_${req.id}`}
                                onClick={() => handleCloseResearch(req.id)}
                                className="quant-button text-red-400 hover:bg-red-950/30 text-xs py-1.5 px-2"
                              >
                                Đóng
                              </button>
                            )}

                            {req.status === 'CONFIRMED' && (
                              <button
                                type="button"
                                disabled={busyId === `run_${req.id}`}
                                onClick={() => handleRunResearch(req.id)}
                                className="quant-button quant-button-primary text-xs py-1.5 px-3 flex items-center gap-1 font-semibold"
                              >
                                <Play className="w-3 h-3" />
                                <span>{busyId === `run_${req.id}` ? 'Đang chạy...' : 'Chạy Nghiên Cứu'}</span>
                              </button>
                            )}

                            {req.status === 'READY_FOR_REVIEW' && (
                              <button
                                type="button"
                                disabled={busyId === `app_${req.id}`}
                                onClick={() => handleApproveResearch(req.id)}
                                className="quant-button bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-1.5 px-3 flex items-center gap-1 font-semibold"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>{busyId === `app_${req.id}` ? 'Đang duyệt...' : 'Duyệt Bàn Giao'}</span>
                              </button>
                            )}

                            {(req.status === 'NEEDS_DATA' || req.status === 'FAILED' || req.status === 'NEEDS_ATTENTION') && (
                              <button
                                type="button"
                                onClick={() => setActiveDossierRequestId(req.id)}
                                className="quant-button bg-amber-600 hover:bg-amber-500 text-white text-xs py-1.5 px-3 flex items-center gap-1 font-semibold"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Xử Lý / Can Thiệp</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* 1. ORDERS SUB-TAB */}
      {activeSubTab === 'orders' && (
        <Panel
          title="Danh Sách Đơn Mua Thương Mại USDT"
          subtitle="Các đơn mua PDF nghiên cứu qua ví USDT TRC20/BEP20. Không tính đơn dùng thử vào doanh thu."
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Trạng thái:</span>
                <select
                  value={statusFilter}
                  onChange={(e: any) => setStatusFilter(e.target.value)}
                  className="quant-input text-xs py-1.5"
                >
                  <option value="ALL">Tất cả ({orders.length})</option>
                  <option value="PENDING">Chờ đối soát ({pendingOrdersCount})</option>
                  <option value="PAID">Đã thanh toán ({paidOrdersCount})</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={searchOrderQuery}
                  onChange={(e) => setSearchOrderQuery(e.target.value)}
                  placeholder="Tìm theo mã đơn, email, tx_hash..."
                  className="quant-input text-xs font-mono py-1.5 w-64"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="quant-table text-xs">
                <thead>
                  <tr>
                    <th>Mã Đơn / Ngày Tạo</th>
                    <th>Khách Hàng</th>
                    <th>Ấn Phẩm / Phiên Bản</th>
                    <th>Cổng / Mạng</th>
                    <th className="text-right">Số Tiền (USDT)</th>
                    <th>Mã Giao Dịch (Tx Hash)</th>
                    <th>Trạng Thái</th>
                    <th className="text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-slate-500 font-mono text-xs">
                        Không có đơn hàng nào phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((o) => {
                      const isPaid = String(o.status || '').toUpperCase() === 'PAID';
                      return (
                        <tr key={o.id}>
                          <td>
                            <div className="font-mono font-semibold text-white">{o.id}</div>
                            <div className="font-mono text-[11px] text-slate-500">
                              {o.created_at ? new Date(Number(o.created_at) * 1000).toLocaleString('vi-VN') : '—'}
                            </div>
                          </td>
                          <td>
                            <div className="font-medium text-slate-200">{o.user_email || '—'}</div>
                            <div className="font-mono text-[11px] text-slate-500">{o.user_id}</div>
                          </td>
                          <td>
                            <div className="font-semibold text-cyan-300">
                              {o.report_id || o.plan_tier || 'Gold Research Suite'}
                            </div>
                            <div className="font-mono text-[11px] text-amber-300">{o.report_version || 'v1.0'}</div>
                          </td>
                          <td className="font-mono text-[11px] text-slate-300">
                            {o.payment_gateway || 'DIRECT_USDT'}
                          </td>
                          <td className="text-right font-mono font-bold text-emerald-400 tabular-nums">
                            ${Number(o.amount_usd || o.expected_amount_usdt || 0).toFixed(2)}
                          </td>
                          <td className="font-mono text-[11px] max-w-[140px] truncate">
                            {o.tx_hash ? (
                              <span className="text-cyan-300" title={o.tx_hash}>
                                {o.tx_hash.slice(0, 8)}...{o.tx_hash.slice(-6)}
                              </span>
                            ) : (
                              <span className="text-slate-600">Chưa ghi nhận</span>
                            )}
                          </td>
                          <td>
                            <StatusBadge tone={isPaid ? 'success' : 'warning'}>
                              {isPaid ? 'PAID' : 'PENDING'}
                            </StatusBadge>
                          </td>
                          <td className="text-right">
                            {!isPaid ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setApproveTarget({
                                    id: o.id,
                                    email: o.user_email || '',
                                    amount: Number(o.amount_usd || o.expected_amount_usdt || 0),
                                    product: o.report_id || 'Gold Research Suite',
                                  })
                                }
                                className="quant-btn-primary min-h-[30px] px-2.5 py-1 text-[11px]"
                              >
                                Duyệt thủ công
                              </button>
                            ) : (
                              <span className="text-[11px] font-mono text-emerald-400">Đã mở quyền</span>
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
        </Panel>
      )}

      {/* 2. TRIALS SUB-TAB */}
      {activeSubTab === 'trials' && (
        <Panel
          title="Quản Lý Giấy Phép Dùng Thử (Trial Licenses)"
          subtitle="Cấp quyền truy cập tài liệu và bộ bằng chứng có thời hạn cho các đội đánh giá trước khi ký hợp đồng"
          action={
            <button
              type="button"
              onClick={() => setShowGrantTrialModal(true)}
              className="quant-btn-primary text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Cấp Giấy Phép Dùng Thử</span>
            </button>
          }
        >
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="quant-table text-xs">
                <thead>
                  <tr>
                    <th>Mã Quyền / Đơn</th>
                    <th>Email Người Nhận</th>
                    <th>Ấn Phẩm / Bản</th>
                    <th>Ngày Cấp</th>
                    <th>Thời Hạn & Còn Lại</th>
                    <th className="text-center">Lượt Tải</th>
                    <th>Trạng Thái</th>
                    <th className="text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody>
                  {trials.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-slate-500 font-mono text-xs">
                        Chưa có giấy phép dùng thử nào được cấp. Bấm &quot;Cấp Giấy Phép Dùng Thử&quot; để tạo mới.
                      </td>
                    </tr>
                  ) : (
                    trials.map((t) => {
                      const exp = floatToDate(t.expires_at);
                      const granted = floatToDate(t.granted_at);
                      const isExpired = t.expires_at && t.expires_at < Date.now() / 1000;
                      const isRevoked = Boolean(t.revoked_at || t.status === 'REVOKED');
                      return (
                        <tr key={t.id}>
                          <td>
                            <div className="font-mono font-semibold text-white">{t.id}</div>
                            <div className="font-mono text-[11px] text-slate-500">{t.order_id}</div>
                          </td>
                          <td>
                            <div className="font-medium text-slate-200">{t.user_email || '—'}</div>
                            <div className="font-mono text-[11px] text-slate-500">{t.user_id}</div>
                          </td>
                          <td>
                            <div className="font-semibold text-indigo-300">{t.report_title || t.report_id}</div>
                            <div className="font-mono text-[11px] text-amber-300">{t.purchased_version || 'v1.0'}</div>
                          </td>
                          <td className="font-mono text-slate-400">{granted}</td>
                          <td>
                            <div className="font-mono text-slate-300">{exp}</div>
                            <div className="font-mono text-[11px] text-cyan-400">
                              {t.is_active ? `Còn ${t.days_remaining} ngày` : 'Hết hạn'}
                            </div>
                          </td>
                          <td className="text-center font-mono font-bold text-white tabular-nums">
                            {t.download_count || 0}
                          </td>
                          <td>
                            <StatusBadge tone={isRevoked ? 'danger' : isExpired ? 'neutral' : 'success'}>
                              {isRevoked ? 'REVOKED' : isExpired ? 'EXPIRED' : 'ACTIVE'}
                            </StatusBadge>
                          </td>
                          <td className="text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setExtendTrialTarget(t)}
                                className="quant-quiet min-h-[30px] px-2 py-1 text-[11px] text-cyan-300"
                                title="Gia hạn thời gian dùng thử"
                              >
                                Gia hạn
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setTransferTrialTarget(t);
                                  setTransferEmailInput(t.user_email || '');
                                }}
                                className="quant-quiet min-h-[30px] px-2 py-1 text-[11px] text-slate-300"
                                title="Chuyển sang email đối tác khác"
                              >
                                Đổi email
                              </button>
                              {!isRevoked && (
                                <button
                                  type="button"
                                  onClick={() => setRevokeTrialTarget(t)}
                                  className="quant-quiet min-h-[30px] px-2 py-1 text-[11px] text-rose-400 hover:text-rose-300"
                                  title="Thu hồi quyền dùng thử ngay lập tức"
                                >
                                  Thu hồi
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      )}

      {/* 3. USERS SUB-TAB */}
      {activeSubTab === 'users' && (
        <Panel
          title="Tài Khoản Người Dùng & Phân Quyền Quản Trị"
          subtitle="Quản lý vai trò (customer / admin), đặt lại mật khẩu và khóa tài khoản khi cần đình chỉ"
          action={
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="quant-btn-primary text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Tạo Người Dùng Mới</span>
            </button>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <input
                type="text"
                value={searchUserQuery}
                onChange={(e) => setSearchUserQuery(e.target.value)}
                placeholder="Tìm tài khoản theo email hoặc vai trò..."
                className="quant-input text-xs font-mono py-1.5 w-72"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="quant-table text-xs">
                <thead>
                  <tr>
                    <th>Mã / Email</th>
                    <th>Vai Trò</th>
                    <th>Trạng Thái</th>
                    <th className="text-center">Số Ấn Phẩm Có Quyền</th>
                    <th className="text-center">Phiên Đăng Nhập</th>
                    <th className="text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody>
                  {searchedUsers.map((u) => {
                    const isAdmin = u.role === 'admin';
                    const isSusp = Boolean(u.is_suspended);
                    return (
                      <tr key={u.id} className={isSusp ? 'opacity-60 bg-rose-950/10' : ''}>
                        <td>
                          <div className="font-semibold text-white">{u.email}</div>
                          <div className="font-mono text-[11px] text-slate-500">{u.id}</div>
                        </td>
                        <td>
                          <StatusBadge tone={isAdmin ? 'info' : 'neutral'}>
                            {u.role?.toUpperCase()}
                          </StatusBadge>
                        </td>
                        <td>
                          <StatusBadge tone={isSusp ? 'danger' : 'success'}>
                            {isSusp ? 'ĐÃ ĐÌNH CHỈ' : 'HOẠT ĐỘNG'}
                          </StatusBadge>
                        </td>
                        <td className="text-center font-mono font-bold text-white tabular-nums">
                          {u.entitlements_count || 0}
                        </td>
                        <td className="text-center font-mono tabular-nums text-slate-300">
                          {u.active_sessions || 0}
                        </td>
                        <td className="text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setRoleChangeTarget({
                                  id: u.id,
                                  email: u.email,
                                  currentRole: u.role,
                                  newRole: isAdmin ? 'customer' : 'admin',
                                })
                              }
                              className="quant-quiet min-h-[30px] px-2 py-1 text-[11px] text-amber-300"
                            >
                              Đổi vai trò
                            </button>

                            <button
                              type="button"
                              onClick={() => setResetTarget({ id: u.id, email: u.email })}
                              className="quant-quiet min-h-[30px] px-2 py-1 text-[11px] text-cyan-300"
                            >
                              Đổi mật khẩu
                            </button>

                            <button
                              type="button"
                              disabled={busyId === `susp_${u.id}`}
                              onClick={() => handleToggleSuspendUser(u.id, u.email)}
                              className={`min-h-[30px] px-2 py-1 text-[11px] rounded-lg border font-mono transition ${
                                isSusp
                                  ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/40'
                                  : 'border-rose-500/40 bg-rose-950/20 text-rose-300 hover:bg-rose-950/40'
                              }`}
                            >
                              {isSusp ? 'Mở khóa' : 'Đình chỉ'}
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

      {/* 4. SETTINGS SUB-TAB */}
      {activeSubTab === 'settings' && <AdminBillingSettings />}

      {/* MANUAL APPROVE MODAL (With TX_HASH requirement) */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <form
            onSubmit={executeManualApprove}
            className="w-full max-w-lg rounded-2xl border border-cyan-500/40 bg-[#060A13] p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-cyan-300 font-semibold text-sm">
                <ShieldAlert className="h-5 w-5 text-cyan-400" />
                <span>Duyệt Thủ Công Đơn Mua Nghiên Cứu</span>
              </div>
              <button
                type="button"
                onClick={() => setApproveTarget(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0A0F1D] p-3.5 space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Mã đơn hàng:</span>
                <span className="text-white font-bold">{approveTarget.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Email khách hàng:</span>
                <span className="text-cyan-300">{approveTarget.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Ấn phẩm nghiên cứu:</span>
                <span className="text-white">{approveTarget.product}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Số tiền đối soát:</span>
                <span className="text-emerald-400 font-bold">${approveTarget.amount.toFixed(2)} USDT</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-300">
                Mã băm giao dịch Blockchain (Tx Hash) *
              </label>
              <input
                type="text"
                required
                value={approveTxHash}
                onChange={(e) => setApproveTxHash(e.target.value)}
                placeholder="VD: 0x8a7f... hoặc b3c9..."
                className="quant-input font-mono text-xs"
              />
              <p className="text-[11px] text-slate-400 m-0 leading-relaxed">
                Hệ thống yêu cầu nhập tx_hash thực tế trên mạng TRC20/BEP20 để lưu vào nhật ký audit log. Quyền tải
                báo cáo sẽ được cấp đúng 1 lần (idempotent).
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setApproveTarget(null)}
                className="quant-btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={approveSaving}
                className="quant-btn-primary text-xs"
              >
                {approveSaving ? 'Đang duyệt...' : 'Xác Nhận & Mở Quyền Tải'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* GRANT TRIAL MODAL */}
      {showGrantTrialModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <form
            onSubmit={executeGrantTrial}
            className="w-full max-w-lg rounded-2xl border border-indigo-500/40 bg-[#060A13] p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-300 font-semibold text-sm">
                <KeyRound className="h-5 w-5 text-indigo-400" />
                <span>Cấp Giấy Phép Dùng Thử Mới</span>
              </div>
              <button
                type="button"
                onClick={() => setShowGrantTrialModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Email đối tác / Quỹ *</label>
                <input
                  type="email"
                  required
                  value={trialEmailInput}
                  onChange={(e) => setTrialEmailInput(e.target.value)}
                  placeholder="quant-team@partner.com"
                  className="quant-input text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Mã ấn phẩm nghiên cứu</label>
                <input
                  type="text"
                  value={trialReportInput}
                  onChange={(e) => setTrialReportInput(e.target.value)}
                  className="quant-input font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Phiên bản</label>
                  <input
                    type="text"
                    value={trialVersionInput}
                    onChange={(e) => setTrialVersionInput(e.target.value)}
                    className="quant-input font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Thời hạn (ngày)</label>
                  <input
                    type="number"
                    min="1"
                    max="180"
                    value={trialDaysInput}
                    onChange={(e) => setTrialDaysInput(Number(e.target.value))}
                    className="quant-input font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Ghi chú đối tác</label>
                <input
                  type="text"
                  value={trialNotesInput}
                  onChange={(e) => setTrialNotesInput(e.target.value)}
                  className="quant-input text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowGrantTrialModal(false)}
                className="quant-btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={trialSaving}
                className="quant-btn-primary text-xs bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {trialSaving ? 'Đang cấp...' : 'Cấp Giấy Phép'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* EXTEND TRIAL MODAL */}
      {extendTrialTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <form
            onSubmit={executeExtendTrial}
            className="w-full max-w-md rounded-2xl border border-cyan-500/40 bg-[#060A13] p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <span className="text-cyan-300 font-semibold text-sm">Gia Hạn Giấy Phép Dùng Thử</span>
              <button type="button" onClick={() => setExtendTrialTarget(null)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs text-slate-300">
              Đối tác: <strong className="text-white">{extendTrialTarget.user_email}</strong> ({extendTrialTarget.report_id})
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Số ngày gia hạn thêm</label>
              <input
                type="number"
                min="1"
                max="365"
                value={extendDaysInput}
                onChange={(e) => setExtendDaysInput(Number(e.target.value))}
                className="quant-input font-mono text-xs"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setExtendTrialTarget(null)} className="quant-btn-secondary text-xs">Hủy</button>
              <button type="submit" className="quant-btn-primary text-xs">Xác Nhận Gia Hạn</button>
            </div>
          </form>
        </div>
      )}

      {/* REVOKE TRIAL MODAL */}
      {revokeTrialTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <form
            onSubmit={executeRevokeTrial}
            className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-[#060A13] p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <span className="text-rose-400 font-semibold text-sm">Thu Hồi Giấy Phép Dùng Thử</span>
              <button type="button" onClick={() => setRevokeTrialTarget(null)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-slate-300">
              Bạn có chắc chắn muốn thu hồi quyền tải ấn phẩm của <strong>{revokeTrialTarget.user_email}</strong>?
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Lý do thu hồi</label>
              <input
                type="text"
                value={revokeReasonInput}
                onChange={(e) => setRevokeReasonInput(e.target.value)}
                className="quant-input text-xs"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setRevokeTrialTarget(null)} className="quant-btn-secondary text-xs">Hủy</button>
              <button type="submit" className="quant-btn-danger text-xs">Thu Hồi Ngay</button>
            </div>
          </form>
        </div>
      )}

      {/* TRANSFER TRIAL MODAL */}
      {transferTrialTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <form
            onSubmit={executeTransferTrial}
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#060A13] p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <span className="text-white font-semibold text-sm">Chuyển Đổi Email Nhận Giấy Phép</span>
              <button type="button" onClick={() => setTransferTrialTarget(null)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email mới</label>
              <input
                type="email"
                required
                value={transferEmailInput}
                onChange={(e) => setTransferEmailInput(e.target.value)}
                className="quant-input text-xs"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setTransferTrialTarget(null)} className="quant-btn-secondary text-xs">Hủy</button>
              <button type="submit" className="quant-btn-primary text-xs">Cập Nhật Email</button>
            </div>
          </form>
        </div>
      )}

      {/* CONFIRM ROLE CHANGE MODAL */}
      {roleChangeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#060A13] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-amber-300 font-semibold text-sm">Xác Nhận Thay Đổi Vai Trò</span>
              <button type="button" onClick={() => setRoleChangeTarget(null)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0A0F1D] p-3 space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Email:</span>
                <span className="text-white font-bold">{roleChangeTarget.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Vai trò hiện tại:</span>
                <span className="text-slate-300 font-bold uppercase">{roleChangeTarget.currentRole}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Vai trò mới:</span>
                <span className="text-cyan-400 font-bold uppercase">{roleChangeTarget.newRole}</span>
              </div>
            </div>
            <p className="text-xs text-slate-300">
              Quyền quản trị cho phép xem số liệu nhạy cảm, phê duyệt báo cáo và cấu hình cổng thanh toán. Hãy kiểm tra kỹ trước khi cấp quyền.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setRoleChangeTarget(null)} className="quant-btn-secondary text-xs">Hủy</button>
              <button type="button" disabled={roleSaving} onClick={executeRoleChange} className="quant-btn-primary text-xs bg-amber-600 hover:bg-amber-500 text-white">
                {roleSaving ? 'Đang cập nhật...' : 'Xác Nhận Đổi Vai Trò'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RESET PASSWORD MODAL */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <form
            onSubmit={handleResetPassword}
            className="w-full max-w-md rounded-2xl border border-cyan-500/40 bg-[#060A13] p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <span className="text-cyan-300 font-semibold text-sm">Đặt Lại Mật Khẩu</span>
              <button type="button" onClick={() => setResetTarget(null)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs text-slate-300">
              Tài khoản: <strong className="text-white">{resetTarget.email}</strong>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Mật khẩu mới (Tối thiểu 8 ký tự)</label>
              <input
                type="password"
                required
                value={newPasswordInput}
                onChange={(e) => setNewPasswordInput(e.target.value)}
                className="quant-input text-xs font-mono"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setResetTarget(null)} className="quant-btn-secondary text-xs">Hủy</button>
              <button type="submit" disabled={resetSaving} className="quant-btn-primary text-xs">
                {resetSaving ? 'Đang lưu...' : 'Đặt Lại Mật Khẩu'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CREATE USER MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateUser}
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#060A13] p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <span className="text-white font-semibold text-sm">Tạo Tài Khoản Mới</span>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  className="quant-input text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Mật khẩu</label>
                <input
                  type="password"
                  required
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  className="quant-input text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Vai trò</label>
                <select
                  value={createRole}
                  onChange={(e: any) => setCreateRole(e.target.value)}
                  className="quant-input text-xs"
                >
                  <option value="customer">Khách hàng (customer)</option>
                  <option value="admin">Quản trị viên (admin)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowCreateModal(false)} className="quant-btn-secondary text-xs">Hủy</button>
              <button type="submit" disabled={createSaving} className="quant-btn-primary text-xs">
                {createSaving ? 'Đang tạo...' : 'Tạo Tài Khoản'}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* 5. QUOTE MODAL */}
      {quoteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">Chỉnh Báo Giá Nghiên Cứu</h3>
              <button
                type="button"
                onClick={() => setQuoteTarget(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleExecuteQuote} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Giá báo hợp đồng (USD)
                </label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={quotePriceInput}
                  onChange={(e) => setQuotePriceInput(Number(e.target.value))}
                  className="quant-input text-xs w-full"
                  required
                />
                <p className="text-[11px] text-slate-500 mt-1">Mức 10.000 USD là mục tiêu cho hợp đồng phù hợp, không phải mặc định bắt buộc.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Ghi chú phạm vi nghiên cứu (Scope Notes)
                </label>
                <textarea
                  rows={3}
                  value={quoteNotesInput}
                  onChange={(e) => setQuoteNotesInput(e.target.value)}
                  className="quant-input text-xs w-full"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setQuoteTarget(null)}
                  className="quant-button quant-button-secondary text-xs"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={quoteSaving}
                  className="quant-button quant-button-primary text-xs"
                >
                  {quoteSaving ? 'Đang lưu...' : 'Lưu Báo Giá'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Real-time Order Chat & Attachments Modal for Admin */}
      {activeChatOrder && (
        <OrderChatModal
          requestId={activeChatOrder.id}
          orderTitle={activeChatOrder.hypothesis_prompt || activeChatOrder.problem_description}
          currentStatus={activeChatOrder.status}
          userRole="admin"
          onClose={() => {
            setActiveChatOrder(null);
            loadData();
          }}
          onOrderUpdated={loadData}
        />
      )}

      {/* Unified Single Dossier Modal for Admin */}
      {activeDossierRequestId && (
        <AdminResearchDossierModal
          requestId={activeDossierRequestId}
          onClose={() => {
            setActiveDossierRequestId(null);
            loadResearchRequests();
          }}
          onUpdated={() => {
            loadResearchRequests();
          }}
        />
      )}
    </div>
  );
};

function floatToDate(val: any): string {
  if (!val) return '—';
  try {
    const num = Number(val);
    if (isNaN(num) || num <= 0) return '—';
    return new Date(num * 1000).toLocaleString('vi-VN');
  } catch {
    return '—';
  }
}
