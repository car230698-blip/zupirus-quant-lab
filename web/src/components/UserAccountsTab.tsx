import React, { useState, useEffect } from 'react';
import { useCloudAccounts } from '../hooks/useQuantData';
import { fmtNum } from '../utils/strategyDecision';

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
  const accounts = externalAccounts ?? cloudQueryData?.accounts ?? [];
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
        if (data?.plan_tier) setSubTier(data.plan_tier);
        if (data?.billing_cycle) setSubBillingCycle(data.billing_cycle);
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
    if (!checkoutModalOpen || !checkoutOrder?.id || checkoutOrder?.status === 'PAID') return;
    setPollingPaid(true);
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/billing/orders/${checkoutOrder.id}`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'PAID') {
            setCheckoutOrder(data);
            setPollingPaid(false);
            fetchCloudSub();
            refetchAccounts();
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
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          plan_tier: subTier,
          billing_cycle: subBillingCycle,
          cloud_accounts_count: Number(subCloudSlots) || 1,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.order) {
        setCheckoutOrder(data.order);
        setCheckoutModalOpen(true);
      } else {
        setCloudMsg(`Lỗi khởi tạo đơn thanh toán: ${data.detail || res.status}`);
      }
    } catch (e: any) {
      setCloudMsg(`Lỗi kết nối: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleOpenCloudConnectDisclaimer = (e: React.FormEvent) => {
    e.preventDefault();
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
      const res = await fetch('/api/v1/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          account_id: cloudForm.mt5_login,
          account_name: cloudForm.account_name || `Cloud MT5 #${cloudForm.mt5_login}`,
          connection_type: 'CLOUD_METAAPI',
          mt5_login: cloudForm.mt5_login,
          mt5_password: cloudForm.mt5_password,
          mt5_server: cloudForm.mt5_server,
          lot_multiplier: Number(cloudForm.lot_multiplier) || 1.0,
          max_daily_dd_pct: Number(cloudForm.max_daily_dd_pct) || 4.0,
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
        });
        refetchAccounts();
        fetchCloudSub();
      } else {
        setCloudMsg(`Lỗi: ${data.detail || res.status}`);
      }
    } catch (e: any) {
      setCloudMsg(`Lỗi mạng: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCloudDeployToggle = async (accountId: string, action: 'deploy' | 'undeploy') => {
    setCloudBusy(true);
    try {
      const res = await fetch(`/api/v1/accounts/cloud/${encodeURIComponent(accountId)}/${action}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        setCloudMsg(
          action === 'deploy'
            ? `Đã kích hoạt trạm Cloud cho tài khoản #${accountId}`
            : `Đã tạm ngưng trạm Cloud cho tài khoản #${accountId}`
        );
        refetchAccounts();
      }
    } finally {
      setCloudBusy(false);
    }
  };

  const handleToggleAccount = async (accountId: string, currentActive: boolean) => {
    try {
      await fetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_active: !currentActive }),
      });
      refetchAccounts();
    } catch {
      // ignore
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
    });
  };

  const handleSaveAccountConfig = async (acc: any) => {
    const id = acc.account_id || acc.id || acc.login;
    setCloudBusy(true);
    try {
      const res = await fetch('/api/v1/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          account_id: id,
          account_name: acc.account_name || acc.login || id,
          broker_server: acc.broker_server || acc.mt5_server || 'MetaTrader5',
          connection_type: acc.connection_type || 'CLOUD_METAAPI',
          mt5_login: acc.mt5_login || acc.login || id,
          mt5_server: acc.mt5_server || acc.broker_server || '',
          lot_multiplier: Number(editConfigForm.lot_multiplier) || 1.0,
          max_daily_dd_pct: Number(editConfigForm.max_daily_dd_pct) || 4.0,
          max_lot: Number(editConfigForm.max_lot) || 5.0,
          daily_profit_target_usd: Number(editConfigForm.daily_profit_target_usd) || 0,
          symbol_mapping_custom: editConfigForm.symbol_mapping_custom.trim(),
        }),
      });
      if (res.ok) {
        setExpandedConfigId(null);
        setCloudMsg(`Đã lưu cấu hình quản trị rủi ro cho tài khoản #${id}`);
        refetchAccounts();
      }
    } finally {
      setCloudBusy(false);
    }
  };

  const calculateEstimateUsd = () => {
    const basePrices: Record<string, number> = { STARTER: 39, PRO: 59, INSTITUTIONAL: 149 };
    const slotAddonPrice = 25;
    const base = basePrices[subTier] || 39;
    const extraSlots = Math.max(0, subCloudSlots - 1);
    const monthly = base + extraSlots * slotAddonPrice;
    const cycleMult: Record<string, number> = {
      MONTHLY: 1,
      QUARTERLY: 3 * 0.9,
      BIANNUAL: 6 * 0.85,
      ANNUAL: 12 * 0.75,
    };
    return Math.round(monthly * (cycleMult[subBillingCycle] || 1) * 100) / 100;
  };

  const estimatedUsd = calculateEstimateUsd();
  const currentRate = fxRateData?.usd_vnd_rate || 25500;
  const estimatedVnd = Math.round((estimatedUsd * currentRate) / 1000) * 1000;

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
              <span className="font-mono text-xs font-bold text-emerald-300 tabular-nums">
                {cloudSub?.status || 'ACTIVE'} · {cloudSub?.plan_tier || 'PRO'}
              </span>
            </div>

            <div className="mt-4 rounded-xl border border-white/[0.07] bg-[#040710]/80 p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Hạn mức khe cắm Cloud MT5</span>
                <strong className="font-mono text-sm text-cyan-300 tabular-nums">
                  {accounts.length} / {cloudSub?.max_cloud_accounts || 2} KHE CẮM
                </strong>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      (accounts.length / Math.max(cloudSub?.max_cloud_accounts || 2, 1)) * 100,
                      100
                    )}%`,
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
                    { id: 'STARTER', name: 'STARTER', price: '$39/th' },
                    { id: 'PRO', name: 'QUANT PRO', price: '$59/th' },
                    { id: 'INSTITUTIONAL', name: 'FUND VIP', price: '$149/th' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSubTier(t.id)}
                      className={`rounded-xl border p-2.5 text-left transition ${
                        subTier === t.id
                          ? 'border-cyan-400/50 bg-cyan-500/15 text-white shadow-[0_0_20px_rgba(6,182,212,0.15)]'
                          : 'border-white/[0.07] bg-[#040710]/60 text-slate-400 hover:border-white/20 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                        {t.name}
                      </div>
                      <div className="mt-1 font-mono text-sm font-extrabold text-white tabular-nums">{t.price}</div>
                    </button>
                  ))}
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
                    <option value="ANNUAL">12 Tháng (-25%)</option>
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
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">Hệ số nhân khối lượng (Lot Multiplier)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.01"
                  max="20"
                  value={cloudForm.lot_multiplier}
                  onChange={(e) => setCloudForm({ ...cloudForm, lot_multiplier: e.target.value })}
                  className="quant-input font-mono text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">Cắt lỗ bảo vệ ngày (Max Daily DD %)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="20"
                  value={cloudForm.max_daily_dd_pct}
                  onChange={(e) => setCloudForm({ ...cloudForm, max_daily_dd_pct: e.target.value })}
                  className="quant-input font-mono text-sm tabular-nums"
                />
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
                      <div className="mt-3 flex justify-end gap-2">
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

            {checkoutOrder.qr_url && (
              <div className="mx-auto w-56 overflow-hidden rounded-2xl border border-cyan-500/30 bg-white p-3 shadow-[0_0_35px_rgba(6,182,212,0.25)]">
                <img
                  src={checkoutOrder.qr_url}
                  alt="VietQR SePay"
                  className="h-full w-full object-contain"
                />
              </div>
            )}

            <div className="space-y-1.5 rounded-xl border border-white/[0.07] bg-[#040710] p-3.5 text-left font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Mã đơn hàng:</span>
                <strong className="text-cyan-300">{checkoutOrder.order_code}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Số tiền VND:</span>
                <strong className="text-emerald-400 tabular-nums">
                  {Number(checkoutOrder.amount_vnd || estimatedVnd).toLocaleString('vi-VN')} VND
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Trạng thái:</span>
                <strong className={checkoutOrder.status === 'PAID' ? 'text-emerald-400' : 'text-amber-300'}>
                  {checkoutOrder.status === 'PAID' ? 'ĐÃ THANH TOÁN' : 'ĐANG CHỜ WEBHOOK SEPAY...'}
                </strong>
              </div>
            </div>

            {pollingPaid && checkoutOrder.status !== 'PAID' && (
              <div className="text-[11px] font-mono text-slate-400">
                Hệ thống tự động kiểm tra giao dịch mỗi 3 giây...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
