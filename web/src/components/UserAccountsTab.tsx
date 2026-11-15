import React, { useState, useEffect } from 'react';

interface UserAccountsTabProps {
  accounts?: any[];
  newDemoLogin?: string;
  setNewDemoLogin?: (v: string) => void;
  newDemoServer?: string;
  setNewDemoServer?: (v: string) => void;
  handleAddDemoAccount?: (e: React.FormEvent) => void;
  handleCreateReplay?: () => void;
  handleToggleCopy?: (account: any) => void;
  handleCreatePairCode?: (aid: string) => void;
  handleRevoke?: (aid: string) => void;
  pairCodes?: Record<string, string>;
}

const BROKER_PRESETS = [
  { name: 'Exness', server: 'Exness-MT5Real' },
  { name: 'IC Markets', server: 'ICMarkets-Live' },
  { name: 'XM Global', server: 'XMGlobal-MT5' },
  { name: 'Pepperstone', server: 'Pepperstone-Edge' },
  { name: 'FBS', server: 'FBS-Real' },
  { name: 'ThinkMarkets', server: 'ThinkMarkets-Live' },
];

export const UserAccountsTab: React.FC<UserAccountsTabProps> = () => {
  // Legal & Compliance
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [disclaimerDetails, setDisclaimerDetails] = useState<any>(null);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [submittingDisclaimer, setSubmittingDisclaimer] = useState(false);
  const [disclaimerError, setDisclaimerError] = useState<string | null>(null);

  // Form checks in Modal
  const [confirmAge, setConfirmAge] = useState(false);
  const [confirmRisk, setConfirmRisk] = useState(false);
  const [confirmNoSol, setConfirmNoSol] = useState(false);
  const [signatureInput, setSignatureInput] = useState('');

  // Direct Cloud MT5 state
  const [cloudAccounts, setCloudAccounts] = useState<any[]>([]);
  const [cloudLogin, setCloudLogin] = useState('');
  const [cloudPassword, setCloudPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [cloudServer, setCloudServer] = useState('');
  const [cloudAccountName, setCloudAccountName] = useState('');
  const [cloudRiskPercent, setCloudRiskPercent] = useState('1.0');
  const [cloudMaxLot, setCloudMaxLot] = useState('1.0');
  const [cloudSubmitting, setCloudSubmitting] = useState(false);
  const [cloudMsg, setCloudMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);

  useEffect(() => {
    checkDisclaimerStatus();
    fetchCloudAccounts();
  }, []);

  async function checkDisclaimerStatus() {
    try {
      const res = await fetch('/api/legal/status', {
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        const data = await res.json();
        setDisclaimerAccepted(Boolean(data.accepted));
        setDisclaimerDetails(data.details || null);
      }
    } catch {
      // ignore
    }
  }

  async function fetchCloudAccounts() {
    setCloudLoading(true);
    try {
      const res = await fetch('/api/metaapi/accounts', {
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        const data = await res.json();
        setCloudAccounts(data.accounts || []);
      }
    } catch {
      // ignore
    } finally {
      setCloudLoading(false);
    }
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
        setDisclaimerError(data.detail || 'Không thể ghi nhận chữ ký điện tử. Vui lòng thử lại.');
      }
    } catch (err: any) {
      setDisclaimerError(err.message || String(err));
    } finally {
      setSubmittingDisclaimer(false);
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
      const res = await fetch('/api/metaapi/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({
          login: cloudLogin.trim(),
          password: cloudPassword,
          server: cloudServer.trim(),
          account_name: cloudAccountName.trim() || 'My Gold Fund',
          platform: 'mt5',
          risk_percent: parseFloat(cloudRiskPercent) || 1.0,
          max_lot: parseFloat(cloudMaxLot) || 1.0,
          multiplier: 1.0,
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setCloudMsg({
          text: '✓ Đã kết nối MT5 Cloud thành công! Hệ thống sẵn sàng tự động bắn lệnh khi có tín hiệu.',
          type: 'success',
        });
        setCloudLogin('');
        setCloudPassword('');
        setCloudServer('');
        setCloudAccountName('');
        await fetchCloudAccounts();
      } else {
        setCloudMsg({
          text: `❌ ${data.detail || 'Không thể kết nối MetaApi Cloud. Vui lòng kiểm tra lại thông tin.'}`,
          type: 'error',
        });
      }
    } catch (err: any) {
      setCloudMsg({
        text: `❌ Lỗi kết nối: ${err.message || String(err)}`,
        type: 'error',
      });
    } finally {
      setCloudSubmitting(false);
    }
  }

  async function handleToggleCloudAutoTrade(id: string) {
    try {
      const res = await fetch(`/api/metaapi/accounts/${id}/toggle`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        await fetchCloudAccounts();
      }
    } catch {
      // ignore
    }
  }

  async function handleSyncCloudAccount(id: string) {
    try {
      const res = await fetch(`/api/metaapi/accounts/${id}/sync`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        await fetchCloudAccounts();
      }
    } catch {
      // ignore
    }
  }

  async function handleDeleteCloudAccount(id: string) {
    if (!window.confirm('Bạn có chắc chắn muốn ngắt kết nối Cloud MT5 này? Hệ thống sẽ ngừng phát lệnh.')) return;
    try {
      const res = await fetch(`/api/metaapi/accounts/${id}`, {
        method: 'DELETE',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        await fetchCloudAccounts();
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Banner: 100% Cloud MT5 Direct Execution */}
      <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-[#06101e] via-[#09182d] to-[#06101e] p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl -z-10" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <h3 className="text-base font-black font-mono tracking-tight text-slate-100 flex items-center gap-2">
                <span>KẾT NỐI CLOUD MT5 TRỰC TIẾP (DIRECT-TO-USER)</span>
              </h3>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
              Nhận lệnh tự động trực tiếp từ Quant Engine vào tài khoản MT5 của bạn qua API đám mây tốc độ cao.
              <b className="text-cyan-300 font-medium"> Không cần tải file EA, không cần mở máy tính, không cần thuê VPS.</b>
            </p>
          </div>

          <div className="flex items-center gap-3">
            {disclaimerAccepted ? (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3.5 py-1.5 text-xs font-mono text-emerald-300 flex items-center gap-2">
                <span>✓ Đã Ký ToS:</span>
                <span className="font-bold text-white">{disclaimerDetails?.signature_text || 'Active'}</span>
              </div>
            ) : (
              <button
                onClick={() => setShowDisclaimerModal(true)}
                className="rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold px-4 py-2 text-xs font-mono transition-all shadow-md shadow-amber-500/20"
              >
                📜 Ký Cam Kết & Mở Khóa Cloud
              </button>
            )}
          </div>
        </div>
      </div>

      {cloudMsg && (
        <div
          className={`p-4 rounded-xl text-xs font-mono border ${
            cloudMsg.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300'
              : 'bg-rose-950/70 border-rose-500/50 text-rose-300'
          }`}
        >
          {cloudMsg.text}
        </div>
      )}

      {/* 1-Step Cloud MT5 Connection Form */}
      <form onSubmit={handleConnectCloudMT5} className="quant-panel rounded-2xl border border-slate-800 bg-[#0d1424] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold font-mono text-slate-100">+ Liên Kết Tài Khoản MT5 Mới</span>
            <span className="rounded bg-cyan-950 border border-cyan-800/60 px-2 py-0.5 text-[10px] font-mono text-cyan-400">
              1-Step Setup
            </span>
          </div>
          <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/50 border border-emerald-800/40 px-2.5 py-1 rounded-md flex items-center gap-1.5">
            <span>🔒 Bảo mật: Mật khẩu mã hóa AES-256-GCM an toàn tuyệt đối</span>
          </span>
        </div>

        {/* Broker Server Quick Select Pills */}
        <div className="space-y-1.5">
          <label className="block text-[11px] font-mono text-slate-400">
            Chọn nhanh Máy chủ Sàn phổ biến (hoặc tự nhập bên dưới):
          </label>
          <div className="flex flex-wrap gap-2">
            {BROKER_PRESETS.map((b) => (
              <button
                key={b.name}
                type="button"
                onClick={() => setCloudServer(b.server)}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition-all border ${
                  cloudServer === b.server
                    ? 'bg-cyan-500 text-slate-950 font-bold border-cyan-400 shadow-sm shadow-cyan-500/30'
                    : 'bg-slate-900/90 text-slate-300 border-slate-700/80 hover:border-slate-500 hover:text-white'
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>

        {/* Primary Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-mono text-slate-300 mb-1.5">
              Số Login MT5 *
            </label>
            <input
              type="text"
              required
              value={cloudLogin}
              onChange={(e) => setCloudLogin(e.target.value)}
              placeholder="Ví dụ: 10928371"
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-mono text-slate-300">
                Mật khẩu giao dịch MT5 *
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300"
              >
                {showPassword ? 'Ẩn' : 'Hiện'}
              </button>
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              required
              value={cloudPassword}
              onChange={(e) => setCloudPassword(e.target.value)}
              placeholder="Mật khẩu giao dịch để bắn lệnh"
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-slate-300 mb-1.5">
              Máy chủ sàn (Server) *
            </label>
            <input
              type="text"
              required
              value={cloudServer}
              onChange={(e) => setCloudServer(e.target.value)}
              placeholder="Ví dụ: Exness-MT5Real, ICMarkets-Live..."
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
            />
          </div>
        </div>

        {/* Secondary Inputs: Risk Settings */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          <div>
            <label className="block text-[11px] font-mono text-slate-400 mb-1.5">
              Tên gợi nhớ tài khoản (Tùy chọn)
            </label>
            <input
              type="text"
              value={cloudAccountName}
              onChange={(e) => setCloudAccountName(e.target.value)}
              placeholder="Ví dụ: Quỹ Vàng Alpha"
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-slate-400 mb-1.5">
              Mức rủi ro (% Vốn / Lệnh)
            </label>
            <select
              value={cloudRiskPercent}
              onChange={(e) => setCloudRiskPercent(e.target.value)}
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
            >
              <option value="0.5">0.5% / lệnh (Cực kỳ an toàn)</option>
              <option value="1.0">1.0% / lệnh (Kỷ luật chuẩn)</option>
              <option value="2.0">2.0% / lệnh (Tăng trưởng nhanh)</option>
              <option value="3.0">3.0% / lệnh (Tích cực)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-mono text-slate-400 mb-1.5">
              Khối lượng Lot tối đa
            </label>
            <select
              value={cloudMaxLot}
              onChange={(e) => setCloudMaxLot(e.target.value)}
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
            >
              <option value="0.1">Tối đa 0.10 Lot</option>
              <option value="0.5">Tối đa 0.50 Lot</option>
              <option value="1.0">Tối đa 1.00 Lot</option>
              <option value="2.0">Tối đa 2.00 Lot</option>
              <option value="5.0">Tối đa 5.00 Lot</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between pt-2 gap-3 border-t border-slate-800/80">
          <p className="text-[11px] text-slate-400 font-mono">
            Tài khoản sẽ được tự động đồng bộ số dư & vốn thực tế định kỳ.
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

      {/* List of Connected Cloud MT5 Accounts */}
      <div className="quant-panel rounded-2xl border border-slate-800 bg-[#0d1424] overflow-hidden">
        <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-100 font-mono">
              Danh Sách Tài Khoản Cloud MT5
            </span>
            <span className="text-xs text-slate-400 font-mono">
              ({cloudAccounts.length} tài khoản đang kết nối)
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
          <div className="p-10 text-center text-slate-500 font-mono text-xs space-y-2">
            <p>{cloudLoading ? 'Đang tải dữ liệu Cloud MT5...' : 'Chưa có tài khoản Cloud MT5 nào được kết nối.'}</p>
            <p className="text-[11px] text-slate-600">Nhập thông tin ở form trên để bắt đầu nhận lệnh tự động.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {cloudAccounts.map((a: any) => {
              const isAuto = a.auto_trade === 1;
              return (
                <div key={a.id} className="p-5 space-y-3.5 hover:bg-slate-900/40 transition-colors">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${isAuto ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                      <span className="font-bold font-mono text-sm text-slate-100">
                        #{a.login} · {a.server}
                      </span>
                      {a.account_name && (
                        <span className="text-xs text-slate-400 font-mono">
                          ({a.account_name})
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
                        {isAuto ? '● ĐANG BẬT AUTO-TRADE' : '⏸ ĐANG TẠM DỪNG'}
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
                        Đồng Bộ Equity
                      </button>

                      <button
                        onClick={() => handleDeleteCloudAccount(a.id)}
                        className="rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 px-3 py-1.5 text-xs font-mono text-rose-300 transition-colors"
                      >
                        Ngắt Kết Nối
                      </button>
                    </div>
                  </div>

                  {/* Account Metrics Grid */}
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
                      <span className="text-slate-500 text-[10px] block">QUẢN TRỊ RỦI RO</span>
                      <span className="font-bold text-cyan-300">{a.risk_percent}% / Max {a.max_lot} Lot</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">ĐỒNG BỘ GẦN NHẤT</span>
                      <span className="text-slate-400">
                        {a.last_sync ? `${Math.round(Date.now() / 1000 - a.last_sync)}s trước` : 'Mới tạo'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
                <b>2. Rủi ro thị trường:</b> Giao dịch ngoại hối và kim loại quý (XAUUSD) có đòn bẩy chứa đựng rủi ro thua lỗ vốn. Kết quả kiểm định quá khứ (Walk-Forward / Backtest) không bảo đảm lợi nhuận tương lai.
              </p>
              <p>
                <b>3. Quyền tự quyết & Quản trị rủi ro:</b> Bạn hoàn toàn chịu trách nhiệm đối với thiết lập mức rủi ro (% vốn/lệnh) và khối lượng Lot tối đa trên tài khoản MT5 của mình.
              </p>
              <p>
                <b>4. Cơ chế bảo vệ:</b> Hệ thống tích hợp sẵn bộ lọc tin tức kinh tế quan trọng (USD High-Impact) và khóa ngắt khẩn cấp (Emergency Kill Switch).
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
                    className="mt-0.5 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
                  />
                  <span>Tôi xác nhận tôi từ 18 tuổi trở lên và có đầy đủ năng lực hành vi dân sự.</span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmRisk}
                    onChange={(e) => setConfirmRisk(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
                  />
                  <span>Tôi hiểu rõ rủi ro đòn bẩy tài chính và hoàn toàn chịu trách nhiệm về số vốn của mình.</span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmNoSol}
                    onChange={(e) => setConfirmNoSol(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
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
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono uppercase"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowDisclaimerModal(false)}
                  className="rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 text-xs font-mono transition-colors"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  disabled={submittingDisclaimer}
                  className="rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold px-5 py-2 text-xs font-mono transition-all disabled:opacity-50"
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
