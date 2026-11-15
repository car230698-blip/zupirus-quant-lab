import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useExchangeRate, useCloudAccounts, useUserSubscription } from '../hooks/useQuantData.ts';

interface UserAccountsTabProps {
  [key: string]: any;
}

const BROKER_PRESETS = [
  { name: 'Exness', server: 'Exness-MT5Real' },
  { name: 'IC Markets', server: 'ICMarketsSC-Live' },
  { name: 'XM Global', server: 'XMGlobal-MT5' },
  { name: 'Pepperstone', server: 'Pepperstone-Edge' },
  { name: 'FBS', server: 'FBS-Real' },
  { name: 'ThinkMarkets', server: 'ThinkMarkets-Live' },
];

export const UserAccountsTab: React.FC<UserAccountsTabProps> = () => {
  const queryClient = useQueryClient();

  // Queries via TanStack Query
  const { data: fxData } = useExchangeRate();
  const fxRate = fxData?.rate || 25730.0;

  const { data: accountsData } = useCloudAccounts();
  const cloudAccounts = accountsData?.accounts || [];

  const { data: subData } = useUserSubscription();
  const subscription = subData || null;

  // Legal & Compliance
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [submittingDisclaimer, setSubmittingDisclaimer] = useState(false);
  const [disclaimerError, setDisclaimerError] = useState<string | null>(null);

  // Form checks in Disclaimer Modal
  const [confirmAge, setConfirmAge] = useState(false);
  const [confirmRisk, setConfirmRisk] = useState(false);
  const [confirmNoSol, setConfirmNoSol] = useState(false);
  const [signatureInput, setSignatureInput] = useState('');

  // Subscription & Expiry Tracker
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [checkoutTier, setCheckoutTier] = useState<string>('growth');
  const [checkoutSlots, setCheckoutSlots] = useState<number>(1);
  const [activeOrder, setActiveOrder] = useState<any>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [orderCountdown, setOrderCountdown] = useState<number>(1200);

  // Direct Cloud MT5 form state
  const [cloudLogin, setCloudLogin] = useState('');
  const [cloudPassword, setCloudPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [cloudServer, setCloudServer] = useState('');
  const [cloudAccountName, setCloudAccountName] = useState('');
  const [cloudSubmitting, setCloudSubmitting] = useState(false);
  const [cloudMsg, setCloudMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Account editing state
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editMultiplier, setEditMultiplier] = useState<number>(1.0);
  const [editCompounding, setEditCompounding] = useState<boolean>(false);
  const [editPropMode, setEditPropMode] = useState<boolean>(false);
  const [editDailyDD, setEditDailyDD] = useState<number>(4.5);
  const [editProfitTarget, setEditProfitTarget] = useState<number>(8.0);
  const [editAutoBePartialTp, setEditAutoBePartialTp] = useState<boolean>(true);
  const [savingRisk, setSavingRisk] = useState(false);

  useEffect(() => {
    checkDisclaimerStatus();
  }, []);

  async function fetchSubscription() {
    await queryClient.invalidateQueries({ queryKey: ['subscription'] });
  }

  async function fetchCloudAccounts() {
    await queryClient.invalidateQueries({ queryKey: ['accounts'] });
  }

  async function checkDisclaimerStatus() {
    try {
      const res = await fetch('/api/legal/status', {
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        const data = await res.json();
        setDisclaimerAccepted(Boolean(data.accepted));
      }
    } catch {}
  }

  async function handleAcceptDisclaimer(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmAge || !confirmRisk || !confirmNoSol || !signatureInput.trim()) {
      setDisclaimerError('Vui lòng tích chọn đầy đủ 3 cam kết và nhập họ tên chữ ký điện tử.');
      return;
    }
    setSubmittingDisclaimer(true);
    setDisclaimerError(null);
    try {
      const res = await fetch('/api/legal/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({
          signature_text: signatureInput.trim(),
          confirmed_age: confirmAge,
          confirmed_risk: confirmRisk,
          confirmed_no_solicitation: confirmNoSol,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setDisclaimerAccepted(true);
        setShowDisclaimerModal(false);
        await checkDisclaimerStatus();
      } else {
        setDisclaimerError(data.detail || 'Không thể ghi nhận chữ ký điện tử.');
      }
    } catch (err: any) {
      setDisclaimerError(err.message || String(err));
    } finally {
      setSubmittingDisclaimer(false);
    }
  }

  async function handleCreateCheckoutOrder() {
    setCreatingOrder(true);
    try {
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({
          plan_tier: checkoutTier,
          cloud_slots: checkoutSlots,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActiveOrder(data);
        setOrderCountdown(1200);
      } else {
        alert(data.detail || 'Không thể tạo đơn hàng thanh toán.');
      }
    } catch (e: any) {
      alert(e.message || String(e));
    } finally {
      setCreatingOrder(false);
    }
  }

  async function handleCheckPaymentStatus(orderId: string) {
    try {
      const res = await fetch(`/api/v1/billing/orders/${orderId}`, {
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'PAID') {
          alert('Thanh toán thành công! Gói dịch vụ và slot Cloud MT5 đã được kích hoạt.');
          setActiveOrder(null);
          setShowCheckoutModal(false);
          await fetchSubscription();
          await fetchCloudAccounts();
          return;
        }
      }
      alert('Hệ thống chưa ghi nhận tiền chuyển khoản. Vui lòng kiểm tra lại đúng cú pháp nội dung chuyển.');
    } catch (e: any) {
      alert(e.message || String(e));
    }
  }

  async function handleConnectCloudMT5(e: React.FormEvent) {
    e.preventDefault();
    if (!disclaimerAccepted) {
      setShowDisclaimerModal(true);
      return;
    }

    setCloudSubmitting(true);
    setCloudMsg(null);
    try {
      const res = await fetch('/api/v1/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({
          login: cloudLogin.trim(),
          password: cloudPassword,
          server: cloudServer.trim(),
          account_name: cloudAccountName.trim() || 'My Gold Fund',
          platform: 'mt5',
          risk_multiplier: 1.0,
          is_compounding: false,
          is_prop_firm_mode: false,
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setCloudMsg({
          text: `Kết nối Cloud MT5 thành công! Terminal ID: ${data.metaapi_account_id}. Quant Engine đang giám sát và phát lệnh.`,
          type: 'success',
        });
        setCloudLogin('');
        setCloudPassword('');
        setCloudServer('');
        setCloudAccountName('');
        await fetchCloudAccounts();
      } else {
        setCloudMsg({ text: data.detail || 'Lỗi khi liên kết tài khoản MT5 Cloud.', type: 'error' });
      }
    } catch (err: any) {
      setCloudMsg({ text: err.message || String(err), type: 'error' });
    } finally {
      setCloudSubmitting(false);
    }
  }

  async function handleToggleCloudAutoTrade(accountId: string) {
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}/toggle`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        await fetchCloudAccounts();
      }
    } catch {}
  }

  async function handleSyncCloudAccount(accountId: string) {
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}/sync`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        await fetchCloudAccounts();
      }
    } catch {}
  }

  async function handleDeleteCloudAccount(accountId: string) {
    if (!confirm('Bạn có chắc chắn muốn ngắt kết nối tài khoản MT5 Cloud này khỏi ZUPIRUS?')) {
      return;
    }
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}`, {
        method: 'DELETE',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        await fetchCloudAccounts();
      }
    } catch {}
  }

  function startEditingAccount(acc: any) {
    setEditingAccountId(acc.id);
    setEditMultiplier(acc.risk_multiplier || 1.0);
    setEditCompounding(Boolean(acc.is_compounding));
    setEditPropMode(Boolean(acc.is_prop_firm_mode));
    setEditDailyDD(acc.prop_daily_dd_limit_pct || 4.5);
    setEditProfitTarget(acc.prop_profit_target_pct || 8.0);
    setEditAutoBePartialTp(acc.auto_be_partial_tp !== undefined ? Boolean(acc.auto_be_partial_tp) : true);
  }

  async function saveAccountRisk(accountId: string) {
    setSavingRisk(true);
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({
          risk_multiplier: editMultiplier,
          is_compounding: editCompounding,
          is_prop_firm_mode: editPropMode,
          prop_daily_dd_limit_pct: editDailyDD,
          prop_profit_target_pct: editProfitTarget,
          auto_be_partial_tp: editAutoBePartialTp,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditingAccountId(null);
        await fetchCloudAccounts();
      } else {
        alert(data.detail || 'Lỗi cập nhật cấu hình.');
      }
    } catch (e: any) {
      alert(e.message || String(e));
    } finally {
      setSavingRisk(false);
    }
  }

  const planTier = subscription?.plan_tier || 'starter';
  const serviceExp = subscription?.service_expires_at;
  const isServiceActive = serviceExp && serviceExp * 1000 > Date.now();
  const daysLeft = serviceExp ? Math.max(0, Math.ceil((serviceExp * 1000 - Date.now()) / 86400000)) : 0;

  return (
    <div className="space-y-6">
      {/* Dual Expiry Tracker & Subscription Header */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
        {/* Card 1: Gói Tín Hiệu Copy-Trade */}
        <div className="p-4 rounded-xl border border-slate-800 bg-[#0d1424] space-y-2 relative overflow-hidden">
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-slate-400 uppercase">GÓI TÍN HIỆU COPY-TRADE</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              planTier === 'alpha' ? 'bg-purple-950 text-purple-300 border border-purple-700/60' :
              planTier === 'growth' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60' :
              'bg-slate-800 text-slate-300'
            }`}>
              {planTier.toUpperCase()}
            </span>
          </div>
          <div className="text-base font-bold text-slate-100">
            {isServiceActive ? (
              <span className="text-emerald-400">● Đang hoạt động ({daysLeft} ngày còn lại)</span>
            ) : (
              <span className="text-amber-400">● Chưa kích hoạt / Hết hạn</span>
            )}
          </div>
          <div className="text-[10px] text-slate-500">
            {serviceExp ? `Hết hạn: ${new Date(serviceExp * 1000).toLocaleDateString('vi-VN')}` : 'Chưa có chu kỳ thanh toán'}
          </div>
        </div>

        {/* Card 2: Hạ Tầng Cloud MT5 Bridge */}
        <div className="p-4 rounded-xl border border-slate-800 bg-[#0d1424] space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-slate-400 uppercase">HẠ TẦNG CLOUD MT5 BRIDGE</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/60">
              $10/SLOT
            </span>
          </div>
          <div className="text-base font-bold text-cyan-300">
            {cloudAccounts.length} / {subscription?.max_mt5_accounts || 1} Slot đang dùng
          </div>
          <div className="text-[10px] text-slate-500">
            Máy chủ London G2 · Độ trễ &lt; 35ms · Zero VPS
          </div>
        </div>

        {/* Card 3: Nâng cấp / Gia Hạn VietQR Action */}
        <div className="p-4 rounded-xl border border-cyan-500/40 bg-gradient-to-br from-cyan-950/40 via-slate-900/60 to-[#0d1424] flex flex-col justify-between">
          <div>
            <div className="text-[11px] text-cyan-300 font-bold uppercase flex items-center gap-1.5">
              <span>💳 THANH TOÁN SEPAY VIETQR</span>
              <span className="text-[9px] text-emerald-400">TỶ GIÁ THỰC TẾ</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Gia hạn gói tín hiệu hoặc mở thêm slot Cloud MT5 chỉ trong 10 giây.
            </div>
          </div>
          <button
            onClick={() => {
              setActiveOrder(null);
              setShowCheckoutModal(true);
            }}
            className="mt-3 w-full py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-black text-xs transition-all shadow-md shadow-cyan-500/20"
          >
            ⚡ Gia Hạn / Nâng Cấp Gói ↗
          </button>
        </div>
      </div>

      {/* Compliance / Disclaimer Banner */}
      {!disclaimerAccepted && (
        <div className="p-4 rounded-xl border border-amber-500/50 bg-amber-950/20 flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
          <div className="space-y-1">
            <div className="font-bold text-amber-300 flex items-center gap-2">
              <span>⚠️ YÊU CẦU PHÁP LÝ & MIỄN TRỪ TRÁCH NHIỆM</span>
            </div>
            <p className="text-slate-400 text-[11px] font-sans">
              Trước khi kết nối tài khoản MT5 nhận lệnh tự động, bạn cần đọc và ký điện tử Điều khoản Miễn trừ trách nhiệm pháp lý.
            </p>
          </div>
          <button
            onClick={() => setShowDisclaimerModal(true)}
            className="rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2 text-xs transition-colors"
          >
            Đọc & Ký Xác Nhận ↗
          </button>
        </div>
      )}

      {/* Form: Kết nối MT5 Cloud */}
      <form onSubmit={handleConnectCloudMT5} className="quant-panel rounded-2xl border border-slate-800 bg-[#0d1424] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-950 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-mono font-bold text-sm">
              ☁
            </div>
            <div>
              <h3 className="font-mono font-bold text-sm text-slate-100">
                Kết Nối Tài Khoản MT5 Cloud Trực Tiếp
              </h3>
              <p className="font-mono text-xs text-slate-400">
                100% Cloud MT5 Bridge qua MetaApi · Zero EA · Không cần treo máy VPS
              </p>
            </div>
          </div>
          <span className="rounded-full border border-cyan-500/30 bg-cyan-950/40 px-3 py-1 font-mono text-[11px] text-cyan-300">
            Hạ Tầng London G2 Active
          </span>
        </div>

        {cloudMsg && (
          <div
            className={`p-3 rounded-xl border text-xs font-mono ${
              cloudMsg.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
            }`}
          >
            {cloudMsg.text}
          </div>
        )}

        {/* Hidden inputs to absorb browser autofill heuristics */}
        <input type="text" style={{ display: 'none' }} tabIndex={-1} autoComplete="username" />
        <input type="password" style={{ display: 'none' }} tabIndex={-1} autoComplete="current-password" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
          <div>
            <label className="block text-slate-400 mb-1.5 font-bold">MT5 LOGIN (SỐ TÀI KHOẢN) *</label>
            <input
              type="text"
              name="mt5_login_number"
              autoComplete="off"
              inputMode="numeric"
              pattern="[0-9]*"
              required
              value={cloudLogin}
              onChange={(e) => setCloudLogin(e.target.value.replace(/\D/g, ''))}
              placeholder="VD: 10928374"
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-400"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1.5 font-bold">MẬT KHẨU GIAO DỊCH (MASTER) *</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={cloudPassword}
                onChange={(e) => setCloudPassword(e.target.value)}
                placeholder="Mật khẩu giao dịch"
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 pr-10 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 text-xs"
              >
                {showPassword ? 'Ẩn' : 'Hiện'}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1.5 font-bold">MÁY CHỦ SÀN (BROKER SERVER) *</label>
            <input
              type="text"
              required
              value={cloudServer}
              onChange={(e) => setCloudServer(e.target.value)}
              placeholder="VD: Exness-MT5Real"
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-400"
            />
            <div className="flex flex-wrap gap-1 mt-1.5">
              {BROKER_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.name}
                  onClick={() => setCloudServer(p.server)}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-cyan-300"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1.5 font-bold">TÊN GỢI NHỚ TÀI KHOẢN</label>
            <input
              type="text"
              value={cloudAccountName}
              onChange={(e) => setCloudAccountName(e.target.value)}
              placeholder="VD: Gold Fund #1"
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-400"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between pt-2 gap-3 border-t border-slate-800/80">
          <p className="text-[11px] text-slate-400 font-mono">
            Hạ tầng tự động đọc Equity và kiểm toán 4 màng lọc an toàn trước mỗi lệnh bắn.
          </p>
          <button
            type="submit"
            disabled={cloudSubmitting}
            className="rounded-xl bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-black px-7 py-3 text-xs font-mono transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
          >
            {cloudSubmitting ? 'Đang kết nối MetaApi Cloud…' : '🚀 Kết Nối & Bật Tự Động Bắn Lệnh MT5 ↗'}
          </button>
        </div>
      </form>

      {/* List of Connected Accounts */}
      <div className="quant-panel rounded-2xl border border-slate-800 bg-[#0d1424] overflow-hidden">
        <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-100 font-mono">
              Danh Sách Tài Khoản Cloud MT5
            </span>
            <span className="text-xs text-slate-400 font-mono">
              ({cloudAccounts.length} tài khoản)
            </span>
          </div>
          <button
            onClick={fetchCloudAccounts}
            className="text-xs font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5"
          >
            <span>↻ Làm mới</span>
          </button>
        </div>

        {cloudAccounts.length === 0 ? (
          <div className="p-8 text-center text-slate-400 font-mono text-xs space-y-6">
            <p className="text-slate-300 text-sm font-semibold">Chưa có tài khoản Cloud MT5 nào được kết nối.</p>
            <div className="max-w-2xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                <div className="w-6 h-6 rounded-full bg-cyan-950 border border-cyan-500/50 text-cyan-300 flex items-center justify-center font-bold text-xs">1</div>
                <div className="font-bold text-slate-200 text-xs">Mở Tài Khoản MT5</div>
                <div className="text-[11px] text-slate-400 leading-relaxed">
                  Đăng ký tài khoản MT5 tại sàn uy tín: Exness (Standard / Raw), IC Markets, hoặc FTMO.
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                <div className="w-6 h-6 rounded-full bg-cyan-950 border border-cyan-500/50 text-cyan-300 flex items-center justify-center font-bold text-xs">2</div>
                <div className="font-bold text-slate-200 text-xs">Kích Hoạt Cloud Bridge</div>
                <div className="text-[11px] text-slate-400 leading-relaxed">
                  Nhập số Login, Mật khẩu giao dịch & Máy chủ vào form bên trên để kết nối trực tiếp London G2.
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                <div className="w-6 h-6 rounded-full bg-cyan-950 border border-cyan-500/50 text-cyan-300 flex items-center justify-center font-bold text-xs">3</div>
                <div className="font-bold text-slate-200 text-xs">Bật Auto-Trade & Thảnh Thơi</div>
                <div className="text-[11px] text-slate-400 leading-relaxed">
                  Bật công tắc Auto-Trade và thiết lập hệ số rủi ro. Hệ thống tự động sao chép lệnh định lượng 24/5.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {cloudAccounts.map((a: any) => {
              const isAuto = a.auto_trade === 1;
              const isEditing = editingAccountId === a.id;

              return (
                <div key={a.id} className="p-5 space-y-4 hover:bg-slate-900/40 transition-colors">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${isAuto ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                      <span className="font-bold font-mono text-sm text-slate-100">
                        #{a.login || a.mt5_login} · {a.server || a.broker_server}
                      </span>
                      {a.account_name && (
                        <span className="text-xs text-slate-400 font-mono">({a.account_name})</span>
                      )}
                      {a.account_type === 'CENT' ? (
                        <span className="rounded border px-2 py-0.5 text-[10px] font-mono font-bold bg-amber-950 text-amber-300 border-amber-700/60">
                          Cent · USC (1:100)
                        </span>
                      ) : a.account_type === 'PROP_FIRM' ? (
                        <span className="rounded border px-2 py-0.5 text-[10px] font-mono font-bold bg-purple-950 text-purple-300 border-purple-700/60">
                          Prop Firm · FTMO
                        </span>
                      ) : a.account_type === 'RAW_ECN' ? (
                        <span className="rounded border px-2 py-0.5 text-[10px] font-mono font-bold bg-blue-950 text-blue-300 border-blue-700/60">
                          Raw ECN · Zero Spread
                        </span>
                      ) : (
                        <span className="rounded border px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-800 text-slate-300 border-slate-700">
                          Standard · USD
                        </span>
                      )}
                      <span className="rounded border px-2 py-0.5 text-[10px] font-mono font-bold bg-cyan-950 text-cyan-300 border-cyan-700/60">
                        METAAPI CLOUD
                      </span>
                      <span
                        className={`rounded px-2.5 py-0.5 text-[10px] font-mono font-bold border ${
                          isAuto
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
                            : 'bg-rose-950 text-rose-300 border-rose-500/50'
                        }`}
                      >
                        {isAuto ? '● ĐANG BẬT AUTO-TRADE' : '⏸ TẠM DỪNG'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleCloudAutoTrade(a.id)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-mono font-bold transition-all ${
                          isAuto
                            ? 'bg-amber-950/80 text-amber-300 border border-amber-700/50 hover:bg-amber-900'
                            : 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/50 hover:bg-emerald-900'
                        }`}
                      >
                        {isAuto ? 'Tạm Dừng' : 'Bật Auto-Trade'}
                      </button>

                      <button
                        onClick={() => handleSyncCloudAccount(a.id)}
                        className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-mono text-cyan-300 transition-colors"
                      >
                        Đồng Bộ
                      </button>

                      <button
                        onClick={() => (isEditing ? setEditingAccountId(null) : startEditingAccount(a))}
                        className="rounded-lg bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-700/50 px-3 py-1.5 text-xs font-mono text-cyan-300 transition-colors"
                      >
                        {isEditing ? 'Đóng Cài Đặt' : '⚙ Cài Đặt Rủi Ro'}
                      </button>

                      <button
                        onClick={() => handleDeleteCloudAccount(a.id)}
                        className="rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 px-3 py-1.5 text-xs font-mono text-rose-300 transition-colors"
                      >
                        Gỡ
                      </button>
                    </div>
                  </div>

                  {/* Metrics Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono bg-slate-950/50 p-3.5 rounded-xl border border-slate-800/60">
                    <div>
                      <span className="text-slate-500 text-[10px] block">SỐ DƯ (BALANCE)</span>
                      <span className="font-bold text-slate-200">${Number(a.balance || 0).toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">VỐN THỰC (EQUITY)</span>
                      <span className="font-bold text-emerald-400">${Number(a.equity || 0).toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">HỆ SỐ RỦI RO / MULTIPLIER</span>
                      <span className="font-bold text-cyan-300">{a.risk_multiplier || 1.0}x {a.is_compounding ? '(Lãi Kép)' : ''}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">CHẾ ĐỘ THI QUỸ</span>
                      <span className={`font-bold ${a.is_prop_firm_mode ? 'text-purple-400' : 'text-slate-500'}`}>
                        {a.is_prop_firm_mode ? `BẬT (DD ${a.prop_daily_dd_limit_pct}% / Target ${a.prop_profit_target_pct}%)` : 'TẮT'}
                      </span>
                    </div>
                  </div>

                  {/* Interactive Risk & Tier Controls Panel */}
                  {isEditing && (
                    <div className="p-4 rounded-xl border border-cyan-500/30 bg-[#09101f] space-y-4 font-mono text-xs">
                      <div className="font-bold text-cyan-300 border-b border-slate-800 pb-2">
                        Tùy Biến Rủi Ro & Chế Độ Gói Thuê Bao (#{a.login || a.mt5_login})
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Control 1: Risk Multiplier */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between">
                            <span className="text-slate-300 font-bold">Risk Multiplier:</span>
                            <span className="text-cyan-400 font-bold">{editMultiplier}x</span>
                          </div>
                          <input
                            type="range"
                            min="0.5"
                            max="3.0"
                            step="0.1"
                            value={editMultiplier}
                            disabled={!subscription?.allow_custom_multiplier}
                            onChange={(e) => setEditMultiplier(parseFloat(e.target.value))}
                            className="w-full"
                          />
                          {!subscription?.allow_custom_multiplier && (
                            <span className="text-[10px] text-amber-400 block">🔒 Yêu cầu gói Growth hoặc Alpha để tùy biến</span>
                          )}
                        </div>

                        {/* Control 2: Auto Compounding */}
                        <div className="space-y-1.5">
                          <span className="text-slate-300 font-bold block">Tự Động Lãi Kép:</span>
                          <label className="flex items-center gap-2 cursor-pointer pt-1">
                            <input
                              type="checkbox"
                              checked={editCompounding}
                              disabled={!subscription?.allow_compounding}
                              onChange={(e) => setEditCompounding(e.target.checked)}
                              className="rounded border-slate-700 bg-slate-900 text-cyan-500"
                            />
                            <span className="text-slate-300">Tự tăng Lot khi Equity tăng trưởng</span>
                          </label>
                          {!subscription?.allow_compounding && (
                            <span className="text-[10px] text-amber-400 block">🔒 Yêu cầu gói Growth hoặc Alpha</span>
                          )}
                        </div>

                        {/* Control 3: Auto Break-Even & Partial TP */}
                        <div className="space-y-1.5">
                          <span className="text-slate-300 font-bold block">Auto BE & Chốt 50%:</span>
                          <label className="flex items-center gap-2 cursor-pointer pt-1">
                            <input
                              type="checkbox"
                              checked={editAutoBePartialTp}
                              onChange={(e) => setEditAutoBePartialTp(e.target.checked)}
                              className="rounded border-slate-700 bg-slate-900 text-emerald-500"
                            />
                            <span className="text-emerald-300 font-bold">Dời SL về hòa vốn khi đạt 1R</span>
                          </label>
                        </div>

                        {/* Control 4: Prop Firm Mode */}
                        <div className="space-y-1.5">
                          <span className="text-slate-300 font-bold block">Chế Độ Thi Quỹ Pass Guard:</span>
                          <label className="flex items-center gap-2 cursor-pointer pt-1">
                            <input
                              type="checkbox"
                              checked={editPropMode}
                              disabled={!subscription?.allow_prop_firm_mode}
                              onChange={(e) => setEditPropMode(e.target.checked)}
                              className="rounded border-slate-700 bg-slate-900 text-purple-500"
                            />
                            <span className="text-purple-300 font-bold">Khóa lệnh khi chạm Daily DD</span>
                          </label>
                          {!subscription?.allow_prop_firm_mode && (
                            <span className="text-[10px] text-amber-400 block">🔒 Dành riêng cho gói Prop Firm Alpha</span>
                          )}
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => setEditingAccountId(null)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                        >
                          Hủy
                        </button>
                        <button
                          type="button"
                          disabled={savingRisk}
                          onClick={() => saveAccountRisk(a.id)}
                          className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold disabled:opacity-50"
                        >
                          {savingRisk ? 'Đang lưu…' : 'Lưu Cài Đặt'}
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

      {/* SePay VietQR Checkout Modal */}
      {showCheckoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-cyan-500/50 bg-[#0d1424] p-6 shadow-2xl space-y-5 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="font-bold text-sm text-cyan-300 flex items-center gap-2">
                <span>💳 THANH TOÁN SEPAY VIETQR · TỰ ĐỘNG KÍCH HOẠT</span>
              </span>
              <button
                onClick={() => setShowCheckoutModal(false)}
                className="text-slate-400 hover:text-slate-200 text-base"
              >
                ✕
              </button>
            </div>

            {!activeOrder ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-slate-400 mb-1.5 font-bold">CHỌN GÓI DỊCH VỤ COPY-TRADE:</label>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <button
                      type="button"
                      onClick={() => setCheckoutTier('starter')}
                      className={`p-3 rounded-xl border text-xs ${
                        checkoutTier === 'starter'
                          ? 'border-cyan-400 bg-cyan-950/60 text-cyan-300 font-bold'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold">STARTER</div>
                      <div className="text-[11px] text-slate-300 mt-1">$20/mo</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCheckoutTier('growth')}
                      className={`p-3 rounded-xl border text-xs ${
                        checkoutTier === 'growth'
                          ? 'border-cyan-400 bg-cyan-950/60 text-cyan-300 font-bold'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold">GROWTH</div>
                      <div className="text-[11px] text-cyan-300 mt-1">$35/mo</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCheckoutTier('alpha')}
                      className={`p-3 rounded-xl border text-xs ${
                        checkoutTier === 'alpha'
                          ? 'border-purple-400 bg-purple-950/60 text-purple-300 font-bold'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold">PROP ALPHA</div>
                      <div className="text-[11px] text-purple-300 mt-1">$49/mo</div>
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-slate-400 mb-1.5">
                    <span className="font-bold">SỐ LƯỢNG SLOT CLOUD MT5 BRIDGE ($10/SLOT):</span>
                    <span className="text-cyan-300 font-bold">{checkoutSlots} Slot</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={checkoutSlots}
                    onChange={(e) => setCheckoutSlots(parseInt(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                    <span>1 Slot (Mặc định)</span>
                    <span>3 Slots</span>
                    <span>5 Slots (Tối đa)</span>
                  </div>
                </div>

                {/* Pricing Summary */}
                <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/70 space-y-1.5">
                  <div className="flex justify-between text-slate-400">
                    <span>Phí Gói Tín Hiệu:</span>
                    <span className="text-slate-200">
                      ${checkoutTier === 'alpha' ? 49 : checkoutTier === 'growth' ? 35 : 20} USD
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Phí Hạ Tầng Cloud MT5 ({checkoutSlots} slot):</span>
                    <span className="text-slate-200">${checkoutSlots * 10} USD</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Tỷ Giá Chốt Thời Gian Thực:</span>
                    <span className="text-cyan-300">{fxRate.toLocaleString('vi-VN')} VND/USD</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t border-slate-800 pt-2 text-slate-100">
                    <span>Tổng Thanh Toán:</span>
                    <span className="text-emerald-400">
                      {(
                        Math.ceil(
                          ((checkoutTier === 'alpha' ? 49 : checkoutTier === 'growth' ? 35 : 20) + checkoutSlots * 10) *
                            fxRate /
                            1000
                        ) * 1000
                      ).toLocaleString('vi-VN')}
                      ₫
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={creatingOrder}
                  onClick={handleCreateCheckoutOrder}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-black text-xs transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  {creatingOrder ? 'Đang tạo mã VietQR…' : '⚡ Tạo Mã Thanh Toán VietQR Chốt Tỷ Giá ↗'}
                </button>
              </div>
            ) : (
              /* Active Order Screen with VietQR */
              <div className="space-y-4 text-center">
                <div className="p-2 rounded-lg bg-amber-950/50 border border-amber-600/40 text-amber-300 text-[11px] flex justify-between items-center">
                  <span>Tỷ giá đã khóa thành công</span>
                  <span className="font-bold">
                    Còn {Math.floor(orderCountdown / 60)}:{String(orderCountdown % 60).padStart(2, '0')}
                  </span>
                </div>

                {(() => {
                  const displayBank = (activeOrder.bank_name && activeOrder.bank_name !== 'MBBank') ? activeOrder.bank_name : 'VietinBank';
                  const displayAcc = (activeOrder.account_number && activeOrder.account_number !== '0336230698') ? activeOrder.account_number : '105887054819';
                  const displayHolder = activeOrder.account_holder || 'LE NGUYEN NHU THUY';
                  const encodedContent = encodeURIComponent(activeOrder.payment_content);
                  const qrSrc = activeOrder.qr_code_url
                    ? activeOrder.qr_code_url.replace(/ /g, '%20')
                    : `https://qr.sepay.vn/img?acc=${displayAcc}&bank=${displayBank}&amount=${activeOrder.amount_vnd}&des=${encodedContent}`;
                  const fallbackQr = `https://img.vietqr.io/image/VietinBank-105887054819-compact2.png?amount=${activeOrder.amount_vnd}&addInfo=${encodedContent}&accountName=LE%20NGUYEN%20NHU%20THUY`;

                  return (
                    <>
                      <div className="flex justify-center p-3 rounded-2xl bg-white max-w-[220px] mx-auto shadow-xl relative min-h-[200px]">
                        <img
                          src={qrSrc}
                          alt="SePay VietQR"
                          className="w-full h-auto object-contain"
                          loading="eager"
                          onError={(e) => {
                            const target = e.currentTarget;
                            if (target.src !== fallbackQr) {
                              target.src = fallbackQr;
                            }
                          }}
                        />
                      </div>

                      <div className="space-y-2 text-left bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Ngân hàng:</span>
                          <span className="font-bold text-slate-200">{displayBank}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Chủ tài khoản:</span>
                          <span className="font-bold text-slate-200 uppercase">{displayHolder}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Số tài khoản:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-cyan-300 select-all">{displayAcc}</span>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard.writeText(displayAcc);
                                alert('Đã sao chép số tài khoản!');
                              }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400"
                              title="Sao chép số tài khoản"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Số tiền:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-emerald-400 text-sm">{activeOrder.amount_vnd.toLocaleString('vi-VN')}₫</span>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard.writeText(String(activeOrder.amount_vnd));
                                alert('Đã sao chép số tiền!');
                              }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-400"
                              title="Sao chép số tiền"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Nội dung chuyển:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-black text-amber-400 text-sm select-all">{activeOrder.payment_content}</span>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard.writeText(activeOrder.payment_content);
                                alert('Đã sao chép nội dung chuyển khoản!');
                              }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-400"
                              title="Sao chép nội dung chuyển"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}

                <p className="text-[10px] text-slate-400 font-sans">
                  Vui lòng chuyển chính xác số tiền và <strong>nội dung chuyển khoản</strong> để hệ thống tự động kích hoạt ngay lập tức.
                </p>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveOrder(null)}
                    className="w-1/3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                  >
                    Chọn Lại
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCheckPaymentStatus(activeOrder.id)}
                    className="w-2/3 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black"
                  >
                    ✓ Tôi Đã Chuyển Khoản
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legal & Compliance Disclaimer Modal */}
      {showDisclaimerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-[#0d1424] p-6 shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <span>📜 ĐIỀU KHOẢN MIỄN TRỪ TRÁCH NHIỆM & KẾT NỐI CLOUD MT5</span>
              </span>
              <button
                onClick={() => setShowDisclaimerModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2.5 text-slate-300 text-[11px] leading-relaxed pr-2 border border-slate-800 p-3 rounded-lg bg-slate-950/60">
              <p>
                <b>1. Bản chất công nghệ:</b> ZUPIRUS Quant Lab cung cấp hạ tầng phần mềm tính toán định lượng và tự động hóa phát lệnh đám mây qua API MetaApi. Chúng tôi không phải là sàn môi giới, không nhận ủy thác và không huy động vốn.
              </p>
              <p>
                <b>2. Rủi ro thị trường:</b> Giao dịch ngoại hối và kim loại quý (XAUUSD) có đòn bẩy chứa đựng rủi ro thua lỗ vốn. Kết quả kiểm định quá khứ không bảo đảm lợi nhuận tương lai.
              </p>
              <p>
                <b>3. Quyền tự quyết & Quản trị rủi ro:</b> Bạn hoàn toàn chịu trách nhiệm đối với thiết lập mức rủi ro và khối lượng Lot tối đa trên tài khoản MT5 của mình.
              </p>
            </div>

            {disclaimerError && (
              <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-500/50 text-rose-300 text-[11px]">
                {disclaimerError}
              </div>
            )}

            <form onSubmit={handleAcceptDisclaimer} className="space-y-3 pt-2">
              <div className="space-y-2 text-slate-300 text-[11px]">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmAge}
                    onChange={(e) => setConfirmAge(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 bg-slate-900 text-cyan-500"
                  />
                  <span>Tôi xác nhận tôi từ 18 tuổi trở lên và có đầy đủ năng lực hành vi dân sự.</span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmRisk}
                    onChange={(e) => setConfirmRisk(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 bg-slate-900 text-cyan-500"
                  />
                  <span>Tôi hiểu rõ rủi ro đòn bẩy tài chính và hoàn toàn chịu trách nhiệm về số vốn của mình.</span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmNoSol}
                    onChange={(e) => setConfirmNoSol(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 bg-slate-900 text-cyan-500"
                  />
                  <span>Tôi xác nhận ZUPIRUS không chào mời đầu tư tài chính ủy thác.</span>
                </label>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Nhập Họ và Tên của bạn để ký điện tử xác nhận:
                </label>
                <input
                  type="text"
                  required
                  value={signatureInput}
                  onChange={(e) => setSignatureInput(e.target.value)}
                  placeholder="Ví dụ: NGUYEN VAN A"
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 font-mono uppercase"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowDisclaimerModal(false)}
                  className="rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 text-xs font-mono"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  disabled={submittingDisclaimer}
                  className="rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold px-5 py-2 text-xs font-mono disabled:opacity-50"
                >
                  {submittingDisclaimer ? 'Đang xác nhận…' : 'Ký Điện Tử & Tiếp Tục ↗'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
