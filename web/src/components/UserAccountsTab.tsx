import React, { useState, useEffect } from 'react';
import { useCloudAccounts } from '../hooks/useQuantData';
import { fmtNum } from '../utils/strategyDecision';
import { AccountModals } from './AccountModals';
import { ConnectedAccountsListSection, type EditAccountConfigForm } from './ConnectedAccountsListSection';
import { UserReferralAndInvoicesSection } from './UserReferralAndInvoicesSection';
import { IconShield } from './Icons';
import { POPULAR_BROKERS, QUANT_PLANS, PRICING_TIERS_LIST, normalizePlanTier, type PlanTier } from '../data/quantConstants';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client.ts';
import { SpotlightBento } from './ui/SpotlightBento';

export interface UserAccountsTabProps {
  accounts?: any[];
  refetchAccounts?: () => void;
}

export const UserAccountsTab: React.FC<UserAccountsTabProps> = ({
  accounts: externalAccounts,
  refetchAccounts: externalRefetch,
}) => {
  const { data: cloudQueryData, refetch: queryRefetch } = useCloudAccounts();
  const rawAccounts = externalAccounts ?? cloudQueryData?.accounts ?? [];
  const accounts = React.useMemo(() => {
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const a of rawAccounts) {
      const login = a.login || a.mt5_login || a.account_id || a.id;
      const server = (a.server || a.broker_server || a.mt5_server || '').toLowerCase();
      const key = `${login}-${server}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(a);
      }
    }
    return deduped;
  }, [rawAccounts]);
  const refetchAccounts = () => {
    if (externalRefetch) externalRefetch();
    queryRefetch();
  };

  const [cloudSub, setCloudSub] = useState<any>(null);
  const [subTier, setSubTier] = useState<PlanTier>('starter');
  const [subBillingCycle, setSubBillingCycle] = useState('MONTHLY');
  const [subCloudSlots, setSubCloudSlots] = useState(1);

  const [cloudForm, setCloudForm] = useState({
    account_name: '',
    mt5_login: '',
    mt5_password: '',
    mt5_server: '',
    lot_multiplier: '1.0',
    max_daily_dd_pct: '4.0',
    is_prop_firm_mode: false,
    prop_stage: 'CHALLENGE' as 'CHALLENGE' | 'LIVE',
  });
  const [cloudMsg, setCloudMsg] = useState('');
  const [cloudBusy, setCloudBusy] = useState(false);

  const [checkoutOrder, setCheckoutOrder] = useState<any>(null);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [pollingPaid, setPollingPaid] = useState(false);

  const [fxRateData, setFxRateData] = useState<{ usd_vnd_rate: number; source: string; fetched_at?: string } | null>(
    null
  );
  const [fxLoading, setFxLoading] = useState(false);

  const [disclaimerModalOpen, setDisclaimerModalOpen] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);

  const [expandedConfigId, setExpandedConfigId] = useState<string | null>(null);
  const [editConfigForm, setEditConfigForm] = useState<EditAccountConfigForm>({
    lot_multiplier: '1.0',
    max_daily_dd_pct: '4.0',
    max_lot: '5.0',
    daily_profit_target_usd: '0',
    symbol_mapping_custom: '',
    is_prop_firm_mode: false,
    prop_stage: 'CHALLENGE' as 'CHALLENGE' | 'LIVE',
    allowed_strategy_ids: '',
  });

  const fetchFxRate = async () => {
    setFxLoading(true);
    try {
      const d = await apiGet<any>('/api/v1/billing/exchange-rate');
      if (d) {
        setFxRateData({
          usd_vnd_rate: Number(d.usd_vnd_rate || d.rate || 25500),
          source: d.source || 'LIVE',
        });
      }
    } catch {
      // ignore
    } finally {
      setFxLoading(false);
    }
  };

  const refreshFxRate = async () => {
    setFxLoading(true);
    try {
      const d = await apiGet<any>('/api/v1/billing/exchange-rate');
      if (d) {
        setFxRateData({
          usd_vnd_rate: Number(d.usd_vnd_rate || d.rate || 25500),
          source: d.source || 'LIVE',
        });
      }
    } catch {
      // ignore
    } finally {
      setFxLoading(false);
    }
  };

  const fetchCloudSub = async () => {
    try {
      const data = await apiGet<any>('/api/v1/billing/subscription');
      if (data) {
        setCloudSub(data);
        if (data?.plan_tier) {
          setSubTier(normalizePlanTier(data.plan_tier));
        }
        if (data?.billing_cycle) setSubBillingCycle(String(data.billing_cycle).trim().toUpperCase());
        if (data?.max_cloud_accounts) setSubCloudSlots(Number(data.max_cloud_accounts));
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchCloudSub();
    fetchFxRate();
  }, []);

  useEffect(() => {
    if (!checkoutModalOpen || !checkoutOrder?.id || checkoutOrder?.status === 'PAID' || checkoutOrder?.status === 'EXPIRED') return;
    setPollingPaid(true);
    const interval = setInterval(async () => {
      try {
        const data = await apiGet<any>(`/api/v1/billing/orders/${checkoutOrder.id}`);
        if (data) {
          setCheckoutOrder(data);
          if (data.status === 'PAID') {
            setPollingPaid(false);
            fetchCloudSub();
            refetchAccounts();
            clearInterval(interval);
          } else if (data.status === 'EXPIRED') {
            setPollingPaid(false);
            clearInterval(interval);
          }
        }
      } catch {
        // ignore
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [checkoutModalOpen, checkoutOrder?.id, checkoutOrder?.status]);

  const handleCreateCheckout = async (paymentMethod: 'SEPAY' | 'USDT' = 'SEPAY') => {
    setCloudBusy(true);
    setCloudMsg('');
    try {
      const normalizedTier = normalizePlanTier(subTier);
      const data = await apiPost<any>('/api/v1/billing/checkout', {
        plan_tier: normalizedTier,
        billing_cycle: subBillingCycle,
        cloud_slots: effectiveSlots,
        cloud_accounts_count: effectiveSlots,
        payment_method: paymentMethod,
      });
      const orderData = data?.order || (data?.id ? data : null);
      if (orderData) {
        setCheckoutOrder(orderData);
        setCheckoutModalOpen(true);
      } else {
        setCloudMsg(`Lỗi khởi tạo đơn thanh toán: Không nhận được dữ liệu đơn hàng.`);
      }
    } catch (e: any) {
      setCloudMsg(`Lỗi kết nối: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleOpenCloudConnectDisclaimer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloudSub?.is_active || Number(cloudSub?.max_cloud_accounts ?? 0) <= 0) {
      setCloudMsg(
        'Bạn chưa kích hoạt gói thuê bao Cloud MT5 (0 khe cắm khả dụng). Vui lòng bấm "Tạo Mã QR SePay" ở khung bên trái và hoàn tất thanh toán trước khi liên kết tài khoản MT5.'
      );
      return;
    }
    if (!cloudForm.mt5_login || !cloudForm.mt5_password || !cloudForm.mt5_server) {
      setCloudMsg('Vui lòng điền đầy đủ mã tài khoản MT5 Login, Mật khẩu và Máy chủ Broker.');
      return;
    }
    setDisclaimerAccepted(false);
    setDisclaimerModalOpen(true);
  };

  const executeConnectCloudAccount = async () => {
    setDisclaimerModalOpen(false);
    setCloudBusy(true);
    setCloudMsg('Đang mã hóa thông tin và khởi tạo trạm Cloud MT5...');
    try {
      const mult = Number(cloudForm.lot_multiplier) || 1.0;
      const dd = Number(cloudForm.max_daily_dd_pct) || 4.0;
      await apiPost('/api/v1/accounts', {
        login: cloudForm.mt5_login,
        mt5_login: cloudForm.mt5_login,
        password: cloudForm.mt5_password,
        mt5_password: cloudForm.mt5_password,
        server: cloudForm.mt5_server,
        mt5_server: cloudForm.mt5_server,
        account_id: cloudForm.mt5_login,
        account_name: cloudForm.account_name || `Cloud MT5 #${cloudForm.mt5_login}`,
        connection_type: 'CLOUD_METAAPI',
        risk_multiplier: mult,
        lot_multiplier: mult,
        is_prop_firm_mode: cloudForm.is_prop_firm_mode,
        prop_stage: cloudForm.is_prop_firm_mode ? cloudForm.prop_stage : 'CHALLENGE',
        prop_daily_dd_limit_pct: dd,
        max_daily_dd_pct: dd,
        disclaimer_accepted: true,
      });
      setCloudMsg('Đã kết nối và đồng bộ tài khoản Cloud MT5 thành công!');
      setCloudForm({
        account_name: '',
        mt5_login: '',
        mt5_password: '',
        mt5_server: '',
        lot_multiplier: '1.0',
        max_daily_dd_pct: '4.0',
        is_prop_firm_mode: false,
        prop_stage: 'CHALLENGE',
      });
      refetchAccounts();
      fetchCloudSub();
    } catch (e: any) {
      setCloudMsg(`Lỗi: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleSyncAccount = async (accountId: string) => {
    setCloudBusy(true);
    try {
      await apiPost(`/api/v1/accounts/${encodeURIComponent(accountId)}/sync`, {});
      setCloudMsg(`Đã đồng bộ số dư mới nhất từ sàn cho tài khoản #${accountId}.`);
      refetchAccounts();
    } catch (e: any) {
      setCloudMsg(`Lỗi kết nối đồng bộ: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCloudDeployToggle = async (accountId: string, action: 'deploy' | 'undeploy') => {
    setCloudBusy(true);
    try {
      await apiPost(`/api/v1/accounts/cloud/${encodeURIComponent(accountId)}/${action}`, {});
      setCloudMsg(
        action === 'deploy'
          ? `Đã kích hoạt trạm Cloud cho tài khoản #${accountId}`
          : `Đã tạm ngưng trạm Cloud cho tài khoản #${accountId}`
      );
      refetchAccounts();
    } catch (e: any) {
      setCloudMsg(`Lỗi kết nối Cloud: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleToggleAccount = async (accountId: string, currentActive: boolean) => {
    if (cloudBusy) return;
    setCloudBusy(true);
    try {
      await apiPost(`/api/v1/accounts/${encodeURIComponent(accountId)}/toggle`, { is_active: !currentActive });
      refetchAccounts();
    } catch (e: any) {
      setCloudMsg(`Lỗi kết nối: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    setCloudBusy(true);
    try {
      await apiDelete(`/api/v1/accounts/${encodeURIComponent(accountId)}`);
      setCloudMsg(`Đã xoá tài khoản #${accountId} thành công.`);
      refetchAccounts();
      fetchCloudSub();
    } catch (e: any) {
      setCloudMsg(`Lỗi xoá tài khoản: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleOpenEditConfig = (acc: any) => {
    const id = acc.account_id || acc.id || acc.login;
    if (expandedConfigId === id) {
      setExpandedConfigId(null);
      return;
    }
    setExpandedConfigId(id);
    setEditConfigForm({
      lot_multiplier: String(acc.lot_multiplier ?? acc.risk_multiplier ?? 1.0),
      max_daily_dd_pct: String(acc.max_daily_dd_pct ?? acc.max_daily_drawdown_pct ?? 4.0),
      max_lot: String(acc.max_lot ?? 5.0),
      daily_profit_target_usd: String(acc.daily_profit_target_usd ?? 0),
      symbol_mapping_custom: String(acc.symbol_mapping_custom ?? ''),
      is_prop_firm_mode: Boolean(acc.is_prop_firm_mode),
      prop_stage: (String(acc.prop_stage || 'CHALLENGE').toUpperCase() === 'LIVE' ? 'LIVE' : 'CHALLENGE'),
      allowed_strategy_ids: String(acc.allowed_strategy_ids ?? ''),
    });
  };

  const handleSaveAccountConfig = async (acc: any) => {
    const id = acc.id || acc.account_id || acc.login;
    setCloudBusy(true);
    try {
      const mult = Number(editConfigForm.lot_multiplier) || 1.0;
      const dd = Number(editConfigForm.max_daily_dd_pct) || 4.0;
      await apiPatch(`/api/v1/accounts/${encodeURIComponent(id)}`, {
        risk_multiplier: mult,
        lot_multiplier: mult,
        prop_daily_dd_limit_pct: dd,
        max_daily_dd_pct: dd,
        max_lot: Number(editConfigForm.max_lot) || 5.0,
        daily_profit_target_usd: Number(editConfigForm.daily_profit_target_usd) || 0,
        symbol_mapping_custom: editConfigForm.symbol_mapping_custom.trim(),
        is_prop_firm_mode: editConfigForm.is_prop_firm_mode,
        prop_stage: editConfigForm.is_prop_firm_mode ? editConfigForm.prop_stage : 'CHALLENGE',
        allowed_strategy_ids: (editConfigForm.allowed_strategy_ids || '').trim(),
      });
      setExpandedConfigId(null);
      setCloudMsg(`Đã lưu cấu hình quản trị rủi ro cho tài khoản #${id}`);
      refetchAccounts();
    } catch (e: any) {
      setCloudMsg(`Lỗi kết nối: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const maxTierSlots = QUANT_PLANS[subTier]?.slots || 1;
  const effectiveSlots = Math.max(1, Math.min(subCloudSlots, maxTierSlots));

  const calculateEstimateUsd = () => {
    const slotAddonPrice = 10;
    const base = QUANT_PLANS[subTier]?.baseUsd || 25;
    const extraSlots = Math.max(0, effectiveSlots - 1);
    const monthly = base + extraSlots * slotAddonPrice;
    const cycleMult: Record<string, number> = {
      MONTHLY: 1,
      QUARTERLY: 3 * 0.9,
      BIANNUAL: 6 * 0.85,
      ANNUAL: 12 * 0.8,
    };
    return Math.round(monthly * (cycleMult[subBillingCycle] || 1) * 100) / 100;
  };

  const estimatedUsd = calculateEstimateUsd();
  const currentRate = fxRateData?.usd_vnd_rate || 25500;
  const estimatedVnd = Math.ceil((estimatedUsd * currentRate) / 1000) * 1000;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <SpotlightBento className="flex flex-col justify-between p-6 lg:col-span-5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
                  Hạ Tầng Thuê Bao
                </span>
                <h3 className="mt-0.5 text-lg font-bold text-white">Gói Cloud MT5 & Cổng SePay</h3>
              </div>
              <span
                className={`font-mono text-xs font-bold tabular-nums ${
                  cloudSub?.is_active ? 'text-emerald-300' : 'text-amber-400'
                }`}
              >
                {cloudSub?.is_active
                  ? `ACTIVE · ${String(cloudSub?.plan_tier || 'STARTER').toUpperCase()}`
                  : `${cloudSub?.status || 'CHƯA KÍCH HOẠT'} · 0 KHE CẮM`}
              </span>
            </div>

            <div className="mt-4 rounded-xl border border-white/[0.07] bg-[#040710]/80 p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Hạn mức khe cắm Cloud MT5</span>
                <strong className="font-mono text-sm text-cyan-300 tabular-nums">
                  {accounts.length} / {cloudSub?.is_active ? Number(cloudSub?.max_cloud_accounts ?? 1) : 0} KHE CẮM
                </strong>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-500"
                  style={{
                    width: `${
                      cloudSub?.is_active && Number(cloudSub?.max_cloud_accounts ?? 0) > 0
                        ? Math.min((accounts.length / Math.max(Number(cloudSub?.max_cloud_accounts ?? 1), 1)) * 100, 100)
                        : 0
                    }%`,
                  }}
                />
              </div>

              {(() => {
                const expTs = Number(cloudSub?.service_expires_at || 0);
                const remSec = expTs - Date.now() / 1000;
                const isActive = Boolean(cloudSub?.is_active && remSec > 0);
                const daysLeft = isActive ? Math.floor(remSec / 86400) : 0;
                const hoursLeft = isActive ? Math.floor((remSec % 86400) / 3600) : 0;
                const isExpiringSoon = isActive && remSec <= 7 * 86400;
                const expText = expTs > 0 ? new Date(expTs * 1000).toLocaleString('vi-VN') : 'Chưa kích hoạt';
                const tierNameMap: Record<string, string> = {
                  starter: 'Khởi Đầu (Starter)',
                  growth: 'Tăng Trưởng (Growth)',
                  pro: 'Tăng Trưởng (Pro)',
                  alpha: 'Thi Quỹ Alpha',
                  institutional: 'Thi Quỹ Alpha',
                };
                const tierLabel = tierNameMap[String(cloudSub?.plan_tier || 'starter').toLowerCase()] || String(cloudSub?.plan_tier || 'STARTER').toUpperCase();

                return (
                  <div className="pt-2 border-t border-white/[0.06] space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-slate-400">
                        Gói hiện tại: <strong className="text-white">{tierLabel}</strong>
                      </span>
                      <span
                        className={`font-mono font-bold tabular-nums ${
                          !isActive
                            ? 'text-rose-400'
                            : isExpiringSoon
                            ? 'text-amber-300'
                            : 'text-emerald-300'
                        }`}
                      >
                        {isActive ? `Còn ${daysLeft} ngày ${hoursLeft} giờ` : expTs > 0 ? 'Đã hết hạn' : 'Chưa có gói'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
                      <span>Hết hạn: <span className="text-slate-200">{expText}</span></span>
                      <span>Chu kỳ: {cloudSub?.billing_cycle || 'MONTHLY'}</span>
                    </div>

                    {(isExpiringSoon || (!isActive && expTs > 0)) && (
                      <div
                        className={`mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                          !isActive
                            ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                            : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                        }`}
                      >
                        <span>
                          {!isActive
                            ? 'Gói cước đã hết hạn. Gia hạn ngay để khôi phục giao dịch.'
                            : `Gói sắp hết hạn (còn ${daysLeft} ngày). Gia hạn để cộng dồn thời gian!`}
                        </span>
                        <button
                          type="button"
                          disabled={cloudBusy}
                          onClick={() => handleCreateCheckout('SEPAY')}
                          className="rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-mono font-bold px-3 py-1 text-[11px] cursor-pointer whitespace-nowrap"
                        >
                          Gia Hạn Ngay →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  1. Chọn Hạng Gói Định Lượng
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {PRICING_TIERS_LIST.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSubTier(t.id)}
                      className={`rounded-xl border p-2.5 text-left transition cursor-pointer ${
                        subTier === t.id
                          ? 'border-cyan-400/60 bg-cyan-500/15 text-white shadow-[0_0_20px_rgba(6,182,212,0.18)]'
                          : 'border-white/[0.07] bg-[#040710]/60 text-slate-400 hover:border-white/20 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-mono text-[10px] font-bold text-cyan-300">
                        {t.name}
                      </div>
                      <div className="mt-1 font-mono text-sm font-extrabold text-white tabular-nums">${t.baseUsd}/th</div>
                      <div className="mt-0.5 text-[9px] text-slate-400">{t.badge}</div>
                    </button>
                  ))}
                </div>

                {/* Chi tiết quyền lợi gói đang chọn */}
                <div className="mt-3 rounded-xl border border-cyan-500/20 bg-[#040710]/70 p-3 text-xs text-slate-300 space-y-1.5">
                  <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                    Quyền lợi gói đang chọn (Đã gồm 01 tài khoản Cloud MT5):
                  </div>
                  {subTier === 'starter' && (
                    <ul className="space-y-1 text-[11px] text-slate-300">
                      <li>✓ Tối đa <strong className="text-white">01 tài khoản MT5</strong> (phù hợp tài khoản Cent / Standard nhỏ, không cần thuê VPS).</li>
                      <li>✓ Tự động chia Lot theo số dư, gắn SL theo biến động ATR &amp; chặn tin đỏ ±15 phút.</li>
                      <li>✓ Tự động cắt lỗ bảo vệ ngày <strong className="text-emerald-300">5.0%</strong> an toàn.</li>
                    </ul>
                  )}
                  {subTier === 'growth' && (
                    <ul className="space-y-1 text-[11px] text-slate-300">
                      <li>✓ Gồm sẵn 01 tài khoản Cloud (mở rộng thêm chỉ +$10/TK phụ, tối đa 3 TK).</li>
                      <li>✓ <strong className="text-amber-300">Tự động dời Hòa Vốn (+1R) &amp; Chốt 50% TP1</strong> khóa lợi nhuận.</li>
                      <li>✓ <strong className="text-emerald-300">Tự động Lãi Kép</strong> theo tăng trưởng vốn + Cắt lỗ ngày 5.0%.</li>
                    </ul>
                  )}
                  {subTier === 'alpha' && (
                    <ul className="space-y-1 text-[11px] text-slate-300">
                      <li>✓ Chuyên dụng cho thi &amp; giữ quỹ <strong className="text-white">FTMO, FundedNext, The5ers</strong> (tối đa 5 TK).</li>
                      <li>✓ Ngắt mạch cứng <strong className="text-rose-300">Daily Drawdown 4.0%</strong> + Tự đóng lệnh trước cuối tuần (T6 21:00 UTC).</li>
                      <li>✓ Mở khóa <strong className="text-amber-300">AI Swarm tự chủ</strong> &amp; Kiểm toán chuyên sâu MAE/MFE.</li>
                    </ul>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-mono uppercase tracking-wider text-slate-400">
                    2. Chu Kỳ Thanh Toán
                  </label>
                  <select
                    value={subBillingCycle}
                    onChange={(e) => setSubBillingCycle(e.target.value)}
                    className="quant-input font-mono text-xs"
                  >
                    <option value="MONTHLY">1 Tháng (Chuẩn)</option>
                    <option value="QUARTERLY">3 Tháng (-10%)</option>
                    <option value="BIANNUAL">6 Tháng (-15%)</option>
                    <option value="ANNUAL">12 Tháng (-20%)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-mono uppercase tracking-wider text-slate-400">
                    3. Tổng Số Tài Khoản MT5
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={maxTierSlots}
                    value={effectiveSlots}
                    onChange={(e) => setSubCloudSlots(Math.max(1, Math.min(maxTierSlots, Number(e.target.value) || 1)))}
                    className="quant-input font-mono text-xs tabular-nums"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-4">
            <div className="flex items-center justify-between rounded-xl border border-cyan-500/20 bg-cyan-950/15 px-3.5 py-2.5">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
                  <span>Tỷ giá: 1 USD = {currentRate.toLocaleString('vi-VN')} VND</span>
                  <button
                    type="button"
                    onClick={refreshFxRate}
                    disabled={fxLoading}
                    className="text-cyan-400 underline hover:text-cyan-300"
                  >
                    {fxLoading ? '...' : 'Làm mới'}
                  </button>
                </div>
                <div className="mt-0.5 font-mono text-base font-extrabold text-emerald-400 tabular-nums">
                  {estimatedVnd.toLocaleString('vi-VN')} VND{' '}
                  <span className="text-xs font-normal text-slate-400">(${fmtNum(estimatedUsd, 2)})</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={cloudBusy}
                  onClick={() => handleCreateCheckout('SEPAY')}
                  className="quant-btn-primary px-3 py-2 text-xs whitespace-nowrap shrink-0"
                  title="Thanh toán qua SePay VietQR (VND)"
                >
                  VietQR (VND)
                </button>
                <button
                  type="button"
                  disabled={cloudBusy}
                  onClick={() => handleCreateCheckout('USDT')}
                  className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition whitespace-nowrap shrink-0 cursor-pointer"
                  title="Thanh toán bằng USDT Crypto (NOWPayments)"
                >
                  USDT (Crypto)
                </button>
              </div>
            </div>
          </div>
        </SpotlightBento>

        <SpotlightBento className="p-6 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-400">
                Zero-VPS Cloud Bridge
              </span>
              <h3 className="mt-0.5 text-lg font-bold text-white">Kết Nối Trực Tiếp Tài Khoản MT5</h3>
            </div>
            <span className="font-mono text-[11px] text-slate-400">
              Mã hóa AES-256 · Không cần treo máy
            </span>
          </div>

          <form onSubmit={handleOpenCloudConnectDisclaimer} className="mt-4 space-y-4">
            <div>
              <div className="mb-1.5 text-[11px] font-mono uppercase tracking-wider text-slate-400">
                Chọn nhanh máy chủ sàn phổ biến:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {POPULAR_BROKERS.map((b) => (
                  <button
                    key={b.server}
                    type="button"
                    onClick={() =>
                      setCloudForm({
                        ...cloudForm,
                        mt5_server: b.server,
                        account_name: cloudForm.account_name || `${b.label} Cloud`,
                      })
                    }
                    className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] transition whitespace-nowrap shrink-0 ${
                      cloudForm.mt5_server === b.server
                        ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                        : 'border-white/[0.08] bg-[#040710]/70 text-slate-300 hover:border-cyan-500/30'
                    }`}
                  >
                    + {b.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">Tên gợi nhớ tài khoản</label>
                <input
                  type="text"
                  placeholder="VD: Quỹ FTMO $100k #1"
                  value={cloudForm.account_name}
                  onChange={(e) => setCloudForm({ ...cloudForm, account_name: e.target.value })}
                  className="quant-input text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">Mã đăng nhập MT5 (Login ID)</label>
                <input
                  type="text"
                  required
                  placeholder="VD: 50192834"
                  value={cloudForm.mt5_login}
                  onChange={(e) => setCloudForm({ ...cloudForm, mt5_login: e.target.value })}
                  className="quant-input font-mono text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">Mật khẩu giao dịch (Master Password)</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={cloudForm.mt5_password}
                  onChange={(e) => setCloudForm({ ...cloudForm, mt5_password: e.target.value })}
                  className="quant-input font-mono text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">Máy chủ sàn (Broker Server)</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Exness-MT5Real"
                  value={cloudForm.mt5_server}
                  onChange={(e) => setCloudForm({ ...cloudForm, mt5_server: e.target.value })}
                  className="quant-input font-mono text-sm"
                />
              </div>
              <div className="sm:col-span-2 rounded-xl border border-white/10 bg-[#040710]/70 px-4 py-3 text-xs space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 font-semibold text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cloudForm.is_prop_firm_mode}
                      onChange={(e) => setCloudForm({ ...cloudForm, is_prop_firm_mode: e.target.checked })}
                      className="rounded border-white/20 bg-slate-900"
                    />
                    <span>Tài khoản Quỹ (Prop Firm Guard — bỏ tick nếu là tài khoản Cá nhân)</span>
                  </label>
                  {cloudForm.is_prop_firm_mode && (
                    <select
                      value={cloudForm.prop_stage}
                      onChange={(e) =>
                        setCloudForm({ ...cloudForm, prop_stage: e.target.value as 'CHALLENGE' | 'LIVE' })
                      }
                      className="rounded-lg border border-amber-500/40 bg-[#050914] px-2.5 py-1 font-mono text-xs text-amber-300"
                    >
                      <option value="CHALLENGE">Đang thi (Challenge)</option>
                      <option value="LIVE">Tài khoản Live (Funded — Trần 1%/ý tưởng)</option>
                    </select>
                  )}
                </div>
              </div>
              <div className="sm:col-span-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200 flex items-center justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-1.5 font-semibold text-emerald-300"><IconShield className="w-4 h-4" />Quản trị Rủi ro &amp; Chia Lot Tự Động 100%</div>
                  <div className="mt-0.5 text-[11px] text-slate-300">
                    Hệ thống tự động nhận diện loại tài khoản (<strong className="text-white">Cent / Standard / Quỹ Prop</strong>), tự chia Lot theo số dư (<strong className="text-white">1.0x</strong>) và tự khóa cắt lỗ ngày (<strong className="text-white">4.0%</strong> cho Quỹ / <strong className="text-white">5.0%</strong> cho TK thường).
                  </div>
                </div>
              </div>
            </div>

            {cloudMsg && (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-4 py-2.5 text-xs text-cyan-200">
                {cloudMsg}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-xs text-slate-400">
                Tự động nhận diện hậu tố cặp tiền (<code className="text-cyan-300">XAUUSDm</code>, <code className="text-cyan-300">XAUUSD.pro</code>)
              </span>
              <button
                type="submit"
                disabled={cloudBusy}
                className="quant-btn-primary px-5 py-2.5 text-xs whitespace-nowrap shrink-0"
              >
                {cloudBusy ? 'Đang Đồng Bộ...' : '+ Kết Nối Tài Khoản MT5'}
              </button>
            </div>
          </form>
        </SpotlightBento>
      </div>

      <ConnectedAccountsListSection
        accounts={accounts}
        expandedConfigId={expandedConfigId}
        setExpandedConfigId={setExpandedConfigId}
        cloudBusy={cloudBusy}
        cloudMsg={cloudMsg}
        editConfigForm={editConfigForm}
        setEditConfigForm={setEditConfigForm}
        handleSyncAccount={handleSyncAccount}
        handleOpenEditConfig={handleOpenEditConfig}
        handleCloudDeployToggle={handleCloudDeployToggle}
        handleToggleAccount={handleToggleAccount}
        handleDeleteAccount={handleDeleteAccount}
        handleSaveAccountConfig={handleSaveAccountConfig}
      />

      <UserReferralAndInvoicesSection />

      <AccountModals
        disclaimerModalOpen={disclaimerModalOpen}
        setDisclaimerModalOpen={setDisclaimerModalOpen}
        disclaimerAccepted={disclaimerAccepted}
        setDisclaimerAccepted={setDisclaimerAccepted}
        mt5Login={cloudForm.mt5_login}
        maxDailyDdPct={cloudForm.max_daily_dd_pct}
        estimatedVnd={estimatedVnd}
        executeConnectCloudAccount={executeConnectCloudAccount}
        checkoutModalOpen={checkoutModalOpen}
        setCheckoutModalOpen={setCheckoutModalOpen}
        checkoutOrder={checkoutOrder}
        pollingPaid={pollingPaid}
      />
    </div>
  );
};
