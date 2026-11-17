import React, { useState, useEffect } from 'react';
import { useCloudAccounts } from '../hooks/useQuantData';
import { fmtNum } from '../utils/strategyDecision';
import { formatApiError } from '../utils/formatError.ts';

export interface UserAccountsTabProps {
  accounts?: any[];
  refetchAccounts?: () => void;
}

const POPULAR_BROKERS = [
  { label: 'Exness', server: 'Exness-MT5Real' },
  { label: 'FTMO', server: 'FTMO-Server' },
  { label: 'ICMarkets', server: 'ICMarketsSC-MT5' },
  { label: 'Vantage', server: 'VantageInternational-Live' },
  { label: 'Pepperstone', server: 'Pepperstone-MT5-Live01' },
];

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
  const [subTier, setSubTier] = useState('STARTER');
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
  const [editConfigForm, setEditConfigForm] = useState({
    lot_multiplier: '1.0',
    max_daily_dd_pct: '4.0',
    max_lot: '5.0',
    daily_profit_target_usd: '0',
    symbol_mapping_custom: '',
    is_prop_firm_mode: false,
    prop_stage: 'CHALLENGE' as 'CHALLENGE' | 'LIVE',
  });

  const fetchFxRate = async () => {
    setFxLoading(true);
    try {
      const res = await fetch('/api/v1/billing/exchange-rate', { credentials: 'include' });
      if (res.ok) {
        const d = await res.json();
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
      const res = await fetch('/api/v1/billing/refresh-exchange-rate', {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
        credentials: 'include',
      });
      if (res.ok) {
        const d = await res.json();
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
      const res = await fetch('/api/v1/billing/subscription', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setCloudSub(data);
        if (data?.plan_tier) {
          const upper = String(data.plan_tier).trim().toUpperCase();
          const tierMap: Record<string, string> = {
            STARTER: 'STARTER',
            GROWTH: 'PRO',
            PRO: 'PRO',
            ALPHA: 'INSTITUTIONAL',
            INSTITUTIONAL: 'INSTITUTIONAL',
          };
          setSubTier(tierMap[upper] || 'STARTER');
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
        const res = await fetch(`/api/v1/billing/orders/${checkoutOrder.id}`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
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

  const handleCreateCheckout = async () => {
    setCloudBusy(true);
    setCloudMsg('');
    try {
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        credentials: 'include',
        body: JSON.stringify({
          plan_tier: subTier,
          billing_cycle: subBillingCycle,
          cloud_accounts_count: Number(subCloudSlots) || 1,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const orderData = data.order || (data.id ? data : null);
      if (res.ok && orderData) {
        setCheckoutOrder(orderData);
        setCheckoutModalOpen(true);
      } else {
        setCloudMsg(`Lỗi khởi tạo đơn thanh toán: ${formatApiError(data, res.status)}`);
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
      const res = await fetch('/api/v1/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        credentials: 'include',
        body: JSON.stringify({
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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
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
      } else {
        setCloudMsg(`Lỗi: ${formatApiError(data, res.status)}`);
      }
    } catch (e: any) {
      setCloudMsg(`Lỗi mạng: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleSyncAccount = async (accountId: string) => {
    setCloudBusy(true);
    try {
      const res = await fetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/sync`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
        credentials: 'include',
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setCloudMsg(`Đã đồng bộ số dư mới nhất từ sàn cho tài khoản #${accountId}.`);
        refetchAccounts();
      } else {
        setCloudMsg(`Lỗi đồng bộ số dư: ${formatApiError(d, res.status)}`);
      }
    } catch (e: any) {
      setCloudMsg(`Lỗi kết nối đồng bộ: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCloudDeployToggle = async (accountId: string, action: 'deploy' | 'undeploy') => {
    setCloudBusy(true);
    try {
      const res = await fetch(`/api/v1/accounts/cloud/${encodeURIComponent(accountId)}/${action}`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
        credentials: 'include',
      });
      if (res.ok) {
        setCloudMsg(
          action === 'deploy'
            ? `Đã kích hoạt trạm Cloud cho tài khoản #${accountId}`
            : `Đã tạm ngưng trạm Cloud cho tài khoản #${accountId}`
        );
        refetchAccounts();
      } else {
        const d = await res.json().catch(() => ({}));
        setCloudMsg(`Lỗi thao tác Cloud (${action}): ${formatApiError(d, res.status)}`);
      }
    } catch (e: any) {
      setCloudMsg(`Lỗi kết nối Cloud: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleToggleAccount = async (accountId: string, currentActive: boolean) => {
    try {
      const res = await fetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        credentials: 'include',
        body: JSON.stringify({ is_active: !currentActive }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setCloudMsg(`Lỗi bật/tắt tự động giao dịch: ${formatApiError(d, res.status)}`);
        return;
      }
      refetchAccounts();
    } catch (e: any) {
      setCloudMsg(`Lỗi kết nối: ${e.message}`);
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn ngắt kết nối và xoá tài khoản #${accountId} khỏi hệ thống không?`)) {
      return;
    }
    setCloudBusy(true);
    try {
      const res = await fetch(`/api/v1/accounts/${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
        headers: { 'X-Zupirus': '1' },
        credentials: 'include',
      });
      if (res.ok) {
        setCloudMsg(`Đã xoá tài khoản #${accountId} thành công.`);
        refetchAccounts();
        fetchCloudSub();
      } else {
        const d = await res.json().catch(() => ({}));
        setCloudMsg(`Lỗi xoá tài khoản: ${formatApiError(d, res.status)}`);
      }
    } catch (e: any) {
      setCloudMsg(`Lỗi kết nối: ${e.message}`);
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
    });
  };

  const handleSaveAccountConfig = async (acc: any) => {
    const id = acc.id || acc.account_id || acc.login;
    setCloudBusy(true);
    try {
      const mult = Number(editConfigForm.lot_multiplier) || 1.0;
      const dd = Number(editConfigForm.max_daily_dd_pct) || 4.0;
      const res = await fetch(`/api/v1/accounts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        credentials: 'include',
        body: JSON.stringify({
          risk_multiplier: mult,
          lot_multiplier: mult,
          prop_daily_dd_limit_pct: dd,
          max_daily_dd_pct: dd,
          max_lot: Number(editConfigForm.max_lot) || 5.0,
          daily_profit_target_usd: Number(editConfigForm.daily_profit_target_usd) || 0,
          symbol_mapping_custom: editConfigForm.symbol_mapping_custom.trim(),
          is_prop_firm_mode: editConfigForm.is_prop_firm_mode,
          prop_stage: editConfigForm.is_prop_firm_mode ? editConfigForm.prop_stage : 'CHALLENGE',
        }),
      });
      if (res.ok) {
        setExpandedConfigId(null);
        setCloudMsg(`Đã lưu cấu hình quản trị rủi ro cho tài khoản #${id}`);
        refetchAccounts();
      } else {
        const d = await res.json().catch(() => ({}));
        setCloudMsg(`Lỗi lưu cấu hình: ${formatApiError(d, res.status)}`);
      }
    } catch (e: any) {
      setCloudMsg(`Lỗi kết nối: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const calculateEstimateUsd = () => {
    const basePrices: Record<string, number> = { STARTER: 25, PRO: 39, INSTITUTIONAL: 59 };
    const slotAddonPrice = 10;
    const base = basePrices[subTier] || 25;
    const extraSlots = Math.max(0, subCloudSlots - 1);
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
        <div className="quant-panel flex flex-col justify-between p-6 lg:col-span-5">
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

            <div className="mt-4 rounded-xl border border-white/[0.07] bg-[#040710]/80 p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Hạn mức khe cắm Cloud MT5</span>
                <strong className="font-mono text-sm text-cyan-300 tabular-nums">
                  {accounts.length} / {cloudSub?.is_active ? Number(cloudSub?.max_cloud_accounts ?? 1) : 0} KHE CẮM
                </strong>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
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
              <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>Chu kỳ: {cloudSub?.billing_cycle || 'MONTHLY'}</span>
                <span>Tự động kích hoạt qua VietQR</span>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  1. Chọn Hạng Gói Định Lượng
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'STARTER', name: 'Khởi Đầu / Cent', price: '$25/th', badge: 'Trọn gói 1 TK' },
                    { id: 'PRO', name: 'Tăng Trưởng', price: '$39/th', badge: 'Phổ biến nhất' },
                    { id: 'INSTITUTIONAL', name: 'Thi Quỹ Alpha', price: '$59/th', badge: 'Chuyên Quỹ' },
                  ].map((t) => (
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
                      <div className="mt-1 font-mono text-sm font-extrabold text-white tabular-nums">{t.price}</div>
                      <div className="mt-0.5 text-[9px] text-slate-400">{t.badge}</div>
                    </button>
                  ))}
                </div>

                {/* Chi tiết quyền lợi gói đang chọn */}
                <div className="mt-3 rounded-xl border border-cyan-500/20 bg-[#040710]/70 p-3 text-xs text-slate-300 space-y-1.5">
                  <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                    Quyền lợi gói đang chọn (Đã gồm 01 tài khoản Cloud MT5):
                  </div>
                  {subTier === 'STARTER' && (
                    <ul className="space-y-1 text-[11px] text-slate-300">
                      <li>✓ Tối đa <strong className="text-white">01 tài khoản MT5</strong> (phù hợp tài khoản Cent / Standard nhỏ, không cần thuê VPS).</li>
                      <li>✓ Tự động chia Lot theo số dư, gắn SL theo biến động ATR &amp; chặn tin đỏ ±15 phút.</li>
                      <li>✓ Tự động cắt lỗ bảo vệ ngày <strong className="text-emerald-300">5.0%</strong> an toàn.</li>
                    </ul>
                  )}
                  {subTier === 'PRO' && (
                    <ul className="space-y-1 text-[11px] text-slate-300">
                      <li>✓ Gồm sẵn 01 tài khoản Cloud (mở rộng thêm chỉ +$10/TK phụ).</li>
                      <li>✓ <strong className="text-amber-300">Tự động dời Hòa Vốn (+1R) &amp; Chốt 50% TP1</strong> khóa lợi nhuận.</li>
                      <li>✓ <strong className="text-emerald-300">Tự động Lãi Kép</strong> theo tăng trưởng vốn + Cắt lỗ ngày 5.0%.</li>
                    </ul>
                  )}
                  {subTier === 'INSTITUTIONAL' && (
                    <ul className="space-y-1 text-[11px] text-slate-300">
                      <li>✓ Chuyên dụng cho thi &amp; giữ quỹ <strong className="text-white">FTMO, FundedNext, The5ers</strong>.</li>
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
                    max={20}
                    value={subCloudSlots}
                    onChange={(e) => setSubCloudSlots(Math.max(1, Number(e.target.value) || 1))}
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
              <button
                type="button"
                disabled={cloudBusy}
                onClick={handleCreateCheckout}
                className="quant-btn-primary px-4 py-2.5 text-xs whitespace-nowrap shrink-0"
              >
                Tạo Mã QR SePay
              </button>
            </div>
          </div>
        </div>

        <div className="quant-panel p-6 lg:col-span-7">
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
                  <div className="font-bold text-emerald-300">🛡️ Quản trị Rủi ro &amp; Chia Lot Tự Động 100%</div>
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
        </div>
      </div>

      {/* Connected Accounts List */}
      <div className="quant-panel p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
              Danh Sách Trạm Đầu Cuối
            </span>
            <h3 className="mt-0.5 text-lg font-bold text-white">
              Quản Trị Tài Khoản MT5 & Lá Chắn Quỹ (Prop Firm Guard)
            </h3>
          </div>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            Tổng cộng: {accounts.length} tài khoản
          </span>
        </div>

        {accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-[#040710]/50 p-8 text-center text-sm text-slate-400">
            Chưa có tài khoản MT5 nào. Hãy điền thông tin ở biểu mẫu phía trên để khởi chạy trạm Cloud MT5 đầu tiên.
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((acc: any) => {
              const id = acc.account_id || acc.id || acc.login;
              const isExpanded = expandedConfigId === id;
              const isActive = Boolean(acc.is_active);
              const deployState = acc.deployment_status || acc.deployment_state || 'DEPLOYED';
              const isDeployed = deployState === 'DEPLOYED';
              return (
                <div
                  key={id}
                  className="rounded-xl border border-white/[0.08] bg-[#040710]/85 p-4 transition hover:border-cyan-500/30"
                >
                  <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                          }`}
                        />
                        <span className="text-base font-bold text-white">
                          {acc.account_name || acc.login || id}
                        </span>
                        <span className="font-mono text-xs text-slate-400">
                          #{id} · {acc.broker_server || acc.mt5_server || 'MT5 Cloud'} ·{' '}
                          <strong className={isDeployed ? 'text-emerald-300' : 'text-amber-300'}>
                            {deployState}
                          </strong>
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 pt-1 font-mono text-xs text-slate-300 tabular-nums">
                        <span>
                          Balance: <strong className="text-white">${fmtNum(acc.balance, 2)}</strong>
                        </span>
                        <span className="text-slate-600">·</span>
                        <span>
                          Equity: <strong className="text-cyan-300">${fmtNum(acc.equity, 2)}</strong>
                        </span>
                        <span className="text-slate-600">·</span>
                        <span>
                          Hệ số Lot:{' '}
                          <strong className="text-emerald-300">
                            x{fmtNum(acc.lot_multiplier || acc.risk_multiplier || 1, 2)}
                          </strong>
                        </span>
                        <span className="text-slate-600">·</span>
                        <span>
                          Daily DD: <strong className="text-amber-300">{fmtNum(acc.daily_dd_pct || 0, 2)}%</strong> /{' '}
                          {fmtNum(acc.max_daily_dd_pct || acc.max_daily_drawdown_pct || 4, 1)}%
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={cloudBusy}
                        onClick={() => handleSyncAccount(id)}
                        className="quant-btn-secondary px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                        title="Đồng bộ Balance/Equity từ MetaApi"
                      >
                        Đồng bộ
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenEditConfig(acc)}
                        className="quant-btn-secondary px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                      >
                        {isExpanded ? 'Đóng Cấu Hình' : 'Cấu Hình Rủi Ro'}
                      </button>

                      <button
                        type="button"
                        disabled={cloudBusy}
                        onClick={() => handleCloudDeployToggle(id, isDeployed ? 'undeploy' : 'deploy')}
                        className="quant-btn-secondary px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                      >
                        {isDeployed ? 'Ngắt Cloud' : 'Bật Cloud'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleAccount(id, isActive)}
                        className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition whitespace-nowrap shrink-0 ${
                          isActive
                            ? 'border border-rose-500/35 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                            : 'border border-emerald-500/35 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                        }`}
                      >
                        {isActive ? 'Tạm Dừng Copy' : 'Kích Hoạt Copy'}
                      </button>

                      <button
                        type="button"
                        disabled={cloudBusy}
                        onClick={() => handleDeleteAccount(id)}
                        className="rounded-xl px-2.5 py-1.5 text-xs font-bold transition whitespace-nowrap shrink-0 border border-rose-500/40 bg-rose-950/30 text-rose-300 hover:bg-rose-900/50 hover:text-white"
                        title="Xoá và ngắt kết nối tài khoản"
                      >
                        Xoá
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 border-t border-white/[0.08] pt-4">
                      <div className="mb-3 text-xs font-mono uppercase tracking-wider text-cyan-300">
                        Tham Số Quản Trị Rủi Ro & Prop Firm Guard — Tài Khoản #{id}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                        <div>
                          <label className="mb-1 block text-[11px] text-slate-400">Hệ Số Nhân Lot (x)</label>
                          <input
                            type="number"
                            step="0.1"
                            value={editConfigForm.lot_multiplier}
                            onChange={(e) =>
                              setEditConfigForm({ ...editConfigForm, lot_multiplier: e.target.value })
                            }
                            className="quant-input font-mono text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] text-slate-400">Trần Lỗ Ngày (%)</label>
                          <input
                            type="number"
                            step="0.5"
                            value={editConfigForm.max_daily_dd_pct}
                            onChange={(e) =>
                              setEditConfigForm({ ...editConfigForm, max_daily_dd_pct: e.target.value })
                            }
                            className="quant-input font-mono text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] text-slate-400">Lot Tối Đa / Lệnh</label>
                          <input
                            type="number"
                            step="0.1"
                            value={editConfigForm.max_lot}
                            onChange={(e) => setEditConfigForm({ ...editConfigForm, max_lot: e.target.value })}
                            className="quant-input font-mono text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] text-slate-400">Mục Tiêu Lãi Ngày ($)</label>
                          <input
                            type="number"
                            step="10"
                            value={editConfigForm.daily_profit_target_usd}
                            onChange={(e) =>
                              setEditConfigForm({
                                ...editConfigForm,
                                daily_profit_target_usd: e.target.value,
                              })
                            }
                            className="quant-input font-mono text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] text-slate-400">Mã Symbol Sàn (Tuỳ chọn)</label>
                          <input
                            type="text"
                            placeholder="VD: XAUUSDm"
                            value={editConfigForm.symbol_mapping_custom}
                            onChange={(e) =>
                              setEditConfigForm({
                                ...editConfigForm,
                                symbol_mapping_custom: e.target.value,
                              })
                            }
                            className="quant-input font-mono text-xs"
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editConfigForm.is_prop_firm_mode}
                              onChange={(e) =>
                                setEditConfigForm({ ...editConfigForm, is_prop_firm_mode: e.target.checked })
                              }
                            />
                            <span>Chế độ Quỹ (Prop Firm)</span>
                          </label>
                          {editConfigForm.is_prop_firm_mode && (
                            <select
                              value={editConfigForm.prop_stage}
                              onChange={(e) =>
                                setEditConfigForm({
                                  ...editConfigForm,
                                  prop_stage: e.target.value as 'CHALLENGE' | 'LIVE',
                                })
                              }
                              className="rounded-lg border border-amber-500/40 bg-[#050914] px-2 py-1 font-mono text-[11px] text-amber-300"
                            >
                              <option value="CHALLENGE">Đang thi (Challenge)</option>
                              <option value="LIVE">Live (Funded — Trần 1%)</option>
                            </select>
                          )}
                        </div>
                        <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setExpandedConfigId(null)}
                          className="quant-btn-secondary px-3.5 py-1.5 text-xs"
                        >
                          Huỷ
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveAccountConfig(acc)}
                          className="quant-btn-primary px-4 py-1.5 text-xs"
                        >
                          Lưu Tham Số Bảo Vệ
                        </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Disclaimer Modal */}
      {disclaimerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="quant-panel max-w-lg w-full p-6 space-y-4 border-cyan-500/40">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400">
                  Xác Nhận Pháp Lý & Quản Trị Rủi Ro
                </span>
                <h4 className="text-base font-bold text-white">Đồng Ý Điều Khoản Thực Thi Định Lượng</h4>
              </div>
              <button
                type="button"
                onClick={() => setDisclaimerModalOpen(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 rounded-xl border border-white/[0.07] bg-[#040710] p-4 text-xs leading-relaxed text-slate-300">
              <p>
                1. <strong>Quyền kiểm soát tài khoản:</strong> ZUPIRUS Quant Lab chỉ sử dụng thông tin đăng nhập MT5 của bạn để đồng bộ vị thế XAU/USD và kiểm soát ngưỡng cắt lỗ ngày (Daily Drawdown Guard).
              </p>
              <p>
                2. <strong>Cảnh báo rủi ro thị trường:</strong> Giao dịch CFD/Kim loại quý có đòn bẩy cao. Lá chắn 4 lớp giúp giới hạn rủi ro trong ngưỡng cài đặt ({cloudForm.max_daily_dd_pct}%/ngày) nhưng không loại trừ hoàn toàn trượt giá thị trường (slippage) trong tin tức cực đoan.
              </p>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-200">
              <input
                type="checkbox"
                checked={disclaimerAccepted}
                onChange={(e) => setDisclaimerAccepted(e.target.checked)}
                className="mt-0.5 rounded border-slate-600"
              />
              <span>
                Tôi đã đọc, hiểu rõ cơ chế Lá Chắn Rủi Ro 4 Lớp và xác nhận uỷ quyền kết nối tài khoản MT5{' '}
                <strong className="font-mono text-cyan-300">#{cloudForm.mt5_login}</strong>.
              </span>
            </label>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDisclaimerModalOpen(false)}
                className="quant-btn-secondary px-4 py-2 text-xs"
              >
                Huỷ Bỏ
              </button>
              <button
                type="button"
                disabled={!disclaimerAccepted}
                onClick={executeConnectCloudAccount}
                className="quant-btn-primary px-5 py-2 text-xs disabled:opacity-40"
              >
                Ký Xác Nhận & Kết Nối Cloud
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VietQR Modal */}
      {checkoutModalOpen && checkoutOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="quant-panel max-w-md w-full p-6 space-y-4 border-cyan-500/40 text-center">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3 text-left">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400">
                  Cổng Thanh Toán Tự Động SePay
                </span>
                <h4 className="text-base font-bold text-white">Quét Mã VietQR Kích Hoạt Gói Cloud</h4>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutModalOpen(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {(() => {
              const displayOrderId = checkoutOrder.order_code || checkoutOrder.order_id || checkoutOrder.id || '';
              const displayBank = checkoutOrder.bank_name || 'Chưa cấu hình';
              const displayAccNum = checkoutOrder.account_number || 'Chưa cấu hình';
              const displayHolder = checkoutOrder.account_holder || 'ZUPIRUS QUANT LAB';
              const displayMemo = checkoutOrder.payment_content || `ZP ${displayOrderId.slice(-6).toUpperCase()}`;
              const displayAmountVnd = Number(checkoutOrder.amount_vnd || estimatedVnd || 0);
              const qrCodeUrl =
                checkoutOrder.qr_code_url ||
                checkoutOrder.qr_url ||
                `https://qr.sepay.vn/img?acc=${encodeURIComponent(displayAccNum)}&bank=${encodeURIComponent(displayBank)}&amount=${encodeURIComponent(displayAmountVnd)}&des=${encodeURIComponent(displayMemo)}`;

              return (
                <>
                  <div className="mx-auto w-64 overflow-hidden rounded-2xl border border-cyan-500/40 bg-white p-3 shadow-[0_0_35px_rgba(6,182,212,0.25)]">
                    <img
                      src={qrCodeUrl}
                      alt="VietQR SePay"
                      className="h-full w-full object-contain"
                    />
                  </div>

                  <div className="space-y-2 rounded-xl border border-white/[0.07] bg-[#040710] p-3.5 text-left font-mono text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Mã đơn hàng:</span>
                      <strong className="text-cyan-300 select-all">{displayOrderId}</strong>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Số tiền thanh toán:</span>
                      <strong className="text-emerald-400 tabular-nums font-bold">
                        {displayAmountVnd.toLocaleString('vi-VN')} VND
                      </strong>
                    </div>
                    <div className="flex justify-between items-center border-t border-white/[0.05] pt-1.5">
                      <span className="text-slate-400">Ngân hàng:</span>
                      <span className="text-white font-bold">{displayBank}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Số tài khoản:</span>
                      <span className="text-amber-300 font-bold select-all flex items-center gap-1.5">
                        {displayAccNum}
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(displayAccNum)}
                          className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-slate-300 hover:text-white"
                          title="Sao chép số tài khoản"
                        >
                          Copy
                        </button>
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Chủ tài khoản:</span>
                      <span className="text-slate-200">{displayHolder}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-white/[0.05] pt-1.5">
                      <span className="text-slate-400">Nội dung CK:</span>
                      <span className="text-cyan-300 font-bold select-all flex items-center gap-1.5">
                        {displayMemo}
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(displayMemo)}
                          className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-slate-300 hover:text-white"
                          title="Sao chép nội dung"
                        >
                          Copy
                        </button>
                      </span>
                    </div>
                    <div className="flex justify-between items-center border-t border-white/[0.05] pt-1.5">
                      <span className="text-slate-400">Trạng thái:</span>
                      <strong
                        className={
                          checkoutOrder.status === 'PAID'
                            ? 'text-emerald-400'
                            : checkoutOrder.status === 'UNDERPAID' || checkoutOrder.status === 'EXPIRED'
                            ? 'text-rose-400'
                            : 'text-amber-300'
                        }
                      >
                        {checkoutOrder.status === 'PAID'
                          ? '✓ ĐÃ THANH TOÁN (KÍCH HOẠT CLOUD)'
                          : checkoutOrder.status === 'UNDERPAID'
                          ? '⚠ CHUYỂN THIẾU TIỀN (CHỜ BÙ)'
                          : checkoutOrder.status === 'EXPIRED'
                          ? '✕ ĐƠN HÀNG ĐÃ HẾT HẠN'
                          : '⏳ ĐANG CHỜ WEBHOOK SEPAY...'}
                      </strong>
                    </div>
                    {checkoutOrder.status === 'UNDERPAID' && (
                      <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-[11px] text-rose-200">
                        Đã nhận:{' '}
                        <strong>{Number(checkoutOrder.paid_amount_vnd || 0).toLocaleString('vi-VN')} VND</strong>. Vui lòng chuyển khoản bù thêm{' '}
                        <strong className="text-amber-300">
                          {Math.max(0, displayAmountVnd - Number(checkoutOrder.paid_amount_vnd || 0)).toLocaleString('vi-VN')} VND
                        </strong>{' '}
                        với cùng nội dung <strong className="text-cyan-300">{displayMemo}</strong> để hệ thống tự động kích hoạt.
                      </div>
                    )}
                    {checkoutOrder.status === 'EXPIRED' && (
                      <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-[11px] text-rose-200">
                        Đơn thanh toán đã quá thời hạn giữ tỷ giá (15 phút). Vui lòng đóng cửa sổ này và bấm Tạo Mã QR SePay mới.
                      </div>
                    )}
                  </div>

                  {pollingPaid && checkoutOrder.status !== 'PAID' && checkoutOrder.status !== 'EXPIRED' && (
                    <div className="pt-1 text-[11px] font-mono text-slate-400">
                      Hệ thống tự động kiểm tra giao dịch SePay mỗi 3 giây...
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};
