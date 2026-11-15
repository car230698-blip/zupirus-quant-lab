import React, { useState, useEffect } from 'react';

interface UserAccountsTabProps {
  accounts: any[];
  newDemoLogin: string;
  setNewDemoLogin: (v: string) => void;
  newDemoServer: string;
  setNewDemoServer: (v: string) => void;
  handleAddDemoAccount: (e: React.FormEvent) => void;
  handleCreateReplay: () => void;
  handleToggleCopy: (account: any) => void;
  handleCreatePairCode: (aid: string) => void;
  handleRevoke: (aid: string) => void;
  pairCodes: Record<string, string>;
}

export const UserAccountsTab: React.FC<UserAccountsTabProps> = ({
  accounts,
  newDemoLogin,
  setNewDemoLogin,
  newDemoServer,
  setNewDemoServer,
  handleAddDemoAccount,
  handleCreateReplay,
  handleToggleCopy,
  handleCreatePairCode,
  handleRevoke,
  pairCodes,
}) => {
  // Mode selection & Compliance
  const [accountMode, setAccountMode] = useState<'DEMO' | 'REAL'>('DEMO');
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

  // Real account creation state
  const [realSubmitting, setRealSubmitting] = useState(false);
  const [realStatusMsg, setRealStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    checkDisclaimerStatus();
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

  async function handleSubmitAccount(e: React.FormEvent) {
    e.preventDefault();
    if (accountMode === 'DEMO') {
      handleAddDemoAccount(e);
      return;
    }

    // REAL Account flow
    if (!disclaimerAccepted) {
      setShowDisclaimerModal(true);
      return;
    }

    setRealSubmitting(true);
    setRealStatusMsg(null);
    try {
      const res = await fetch('/api/accounts/real', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({
          login: newDemoLogin.trim(),
          server: newDemoServer.trim(),
          risk: 0.01,
          max_spread: 0.8,
          max_dd: 5.0,
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setRealStatusMsg('✓ Đã khởi tạo tài khoản MT5 Real thành công!');
        handleCreatePairCode(data.id);
        setNewDemoLogin('');
        setNewDemoServer('');
      } else {
        setRealStatusMsg(`❌ ${data.detail || 'Không thể tạo tài khoản Real. Vui lòng thử lại.'}`);
      }
    } catch (err: any) {
      setRealStatusMsg(`❌ Lỗi kết nối: ${err.message || String(err)}`);
    } finally {
      setRealSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Compliance / Safety Mode Header */}
      <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
              <span>Ghép nối EA MT5 & Quản Lý Môi Trường Giao Dịch</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Hệ thống hỗ trợ chạy an toàn kép: Môi trường Demo / Replay (Khuyến nghị) và Môi trường Real (Vốn Thật).
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setAccountMode('DEMO')}
              className={`px-3 py-1.5 rounded-md text-xs font-mono font-bold transition-all ${
                accountMode === 'DEMO'
                  ? 'bg-emerald-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🟢 Môi Trường DEMO
            </button>
            <button
              type="button"
              onClick={() => {
                setAccountMode('REAL');
                if (!disclaimerAccepted) {
                  setShowDisclaimerModal(true);
                }
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                accountMode === 'REAL'
                  ? 'bg-gradient-to-r from-rose-600 to-amber-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>🔴 Vốn Thật (REAL MT5)</span>
              {disclaimerAccepted && <span className="text-[10px] bg-black/40 px-1 rounded">Đã ký ToS</span>}
            </button>
          </div>
        </div>

        {/* Real Mode Warning Banner */}
        {accountMode === 'REAL' && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-4 text-xs font-mono space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-amber-400 flex items-center gap-2">
                ⚠️ CHẾ ĐỘ VỐN THỰC (REAL TRADING IS ENABLED)
              </span>
              {disclaimerAccepted ? (
                <span className="text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-600/40 rounded px-2 py-0.5">
                  ✓ Chứng chỉ ToS: {disclaimerDetails?.signature_text || 'Đã ký'}
                </span>
              ) : (
                <button
                  onClick={() => setShowDisclaimerModal(true)}
                  className="rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1 text-xs"
                >
                  📜 Ký Miễn Trừ Trách Nhiệm Ngay
                </button>
              )}
            </div>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              Bạn đang liên kết tài khoản MT5 tiền thật. Hãy chắc chắn EA <code className="text-cyan-300 font-bold">Zupirus_Copy_EA</code> được cấu hình tham số rủi ro nhỏ hơn 1% vốn để phòng ngừa biến động giật giá vàng (XAU/USD).
            </p>
          </div>
        )}

        {realStatusMsg && (
          <div className={`p-3 rounded-lg text-xs font-mono ${realStatusMsg.startsWith('✓') ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-300' : 'bg-rose-950/60 border border-rose-500/40 text-rose-300'}`}>
            {realStatusMsg}
          </div>
        )}

        <form onSubmit={handleSubmitAccount} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="mt5-login" className="block text-[11px] font-mono text-slate-400 mb-1">
              Số đăng nhập MT5 ({accountMode})
            </label>
            <input
              id="mt5-login"
              type="text"
              required
              value={newDemoLogin}
              onChange={(e) => setNewDemoLogin(e.target.value)}
              placeholder="Ví dụ: 61713217"
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
            />
          </div>

          <div>
            <label htmlFor="mt5-server" className="block text-[11px] font-mono text-slate-400 mb-1">
              Máy chủ MT5 (Broker Server)
            </label>
            <input
              id="mt5-server"
              type="text"
              required
              value={newDemoServer}
              onChange={(e) => setNewDemoServer(e.target.value)}
              placeholder="Ví dụ: Exness-Real21, ICMarkets-Live..."
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={realSubmitting}
              className={`w-full rounded-lg font-bold py-2 text-xs transition-colors font-mono ${
                accountMode === 'REAL'
                  ? 'bg-rose-500 hover:bg-rose-400 text-white shadow-lg'
                  : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
              }`}
            >
              {realSubmitting ? 'Đang khởi tạo…' : accountMode === 'REAL' ? '+ Tạo & Ghép Nối Real MT5 ↗' : 'Tạo & Sinh Mã Ghép Nối ↗'}
            </button>
          </div>
        </form>

        <details className="rounded-lg border border-slate-800/80 bg-slate-950/40 p-3.5 text-xs">
          <summary className="cursor-pointer text-slate-300 font-semibold">Tùy chọn phát lại (Replay)</summary>
          <p className="my-2 text-slate-400">Xem danh mục bằng dữ liệu XAU/USD phát lại, không cần kết nối MT5.</p>
          <button
            id="new-replay"
            type="button"
            onClick={handleCreateReplay}
            className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs text-cyan-300 font-mono transition-colors whitespace-nowrap"
            title="Theo dõi danh mục bằng dữ liệu phát lại"
          >
            + Tạo tài khoản phát lại
          </button>
        </details>
      </div>

      {/* Account List */}
      <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] overflow-hidden">
        <div className="border-b border-slate-800 px-5 py-3 flex items-center justify-between">
          <span className="font-bold text-sm text-slate-200">Danh Sách Tài Khoản Đang Liên Kết</span>
          <span className="text-xs font-mono text-slate-400">{accounts.length} tài khoản</span>
        </div>

        {accounts.length === 0 ? (
          <div className="p-8 text-center text-slate-500 font-mono text-xs">
            Chưa có tài khoản MT5 nào được liên kết.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {accounts.map((a: any) => {
              const code = pairCodes[a.id];
              const isOnline = a.seen && Date.now() / 1000 - a.seen < 30;
              const isReal = a.mode === 'REAL';
              return (
                <div key={a.id} className={`p-5 space-y-3 ${isReal ? 'bg-rose-950/10 border-l-2 border-rose-500' : ''}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                      <span className="font-bold font-mono text-sm text-slate-100">
                        #{a.login} · {a.server}
                      </span>
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-mono font-bold ${
                        isReal
                          ? 'bg-rose-950 text-rose-300 border-rose-600 animate-pulse'
                          : 'bg-slate-800 border-slate-700 text-cyan-300'
                      }`}>
                        {a.mode} {isReal ? '• VỐN THỰC' : ''}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-mono ${
                          a.enabled ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' : 'bg-rose-950 text-rose-300 border border-rose-700/50'
                        }`}
                      >
                        {a.enabled ? 'ĐANG SAO CHÉP' : 'TẠM DỪNG'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => handleToggleCopy(a)}
                        className={`rounded-lg px-3 py-1 text-xs font-mono font-medium transition-colors ${
                          a.enabled
                            ? 'bg-amber-950/80 text-amber-300 border border-amber-700/40 hover:bg-amber-900/80'
                            : 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/40 hover:bg-emerald-900/80'
                        }`}
                      >
                        {a.enabled ? 'Tạm Dừng Sao Chép' : 'Bật Sao Chép'}
                      </button>

                      <button
                        hidden={a.mode === 'REPLAY'}
                        onClick={() => handleCreatePairCode(a.id)}
                        className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1 text-xs font-mono text-slate-300 transition-colors"
                      >
                        Cấp Mã Ghép Nối
                      </button>

                      <button
                        hidden={a.mode === 'REPLAY'}
                        onClick={() => handleRevoke(a.id)}
                        className="rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 px-3 py-1 text-xs font-mono text-rose-300 transition-colors"
                      >
                        Thu Hồi
                      </button>
                    </div>
                  </div>

                  {/* Metrics details */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono bg-slate-950/40 p-3 rounded-lg border border-slate-800/50">
                    <div>
                      <span className="text-slate-500 text-[10px] block">SỐ DƯ (BALANCE)</span>
                      <span className="font-bold text-slate-200">${Number(a.balance || 0).toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">VỐN (EQUITY)</span>
                      <span className="font-bold text-cyan-300">${Number(a.equity || 0).toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">DRAWDOWN HIỆN TẠI</span>
                      <span className="font-bold text-slate-300">
                        {(((a.peak - a.equity) / Math.max(a.peak, 1)) * 100).toFixed(2)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">HEARTBEAT GẦN NHẤT</span>
                      <span className="text-slate-400">
                        {a.seen ? `${Math.round(Date.now() / 1000 - a.seen)}s trước` : 'Chưa có'}
                      </span>
                    </div>
                  </div>

                  {/* Pairing box if generated */}
                  {code && (
                    <div className="rounded-lg border border-cyan-500/40 bg-cyan-950/20 p-3 text-xs font-mono space-y-1">
                      <div className="text-cyan-300 font-bold flex items-center justify-between">
                        <span>
                          Mã dùng một lần: <code className="break-all">{code}</code>
                        </span>
                        <span className="text-[10px] text-slate-400">Hết hạn sau 5 phút</span>
                      </div>
                      <p className="text-slate-400 text-[11px]">
                        Trong MT5 chart XAUUSD, mở Inputs của EA <code className="text-cyan-200">Zupirus_Copy_EA</code>:
                      </p>
                      <div className="bg-slate-900/80 p-2 rounded text-[11px] text-slate-300 select-all">
                        ApiURL = <span className="text-cyan-300">{window.location.origin}</span>
                        <br />
                        PairingCode = <span className="text-cyan-300">{code}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL TERMS OF SERVICE & HIGH-RISK DISCLAIMER */}
      {showDisclaimerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl border border-rose-500/50 bg-[#0a0f1d] p-6 shadow-2xl space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-rose-400 text-lg">⚠️</span>
                <h4 className="font-bold text-sm text-slate-100 font-mono tracking-wide">
                  ĐIỀU KHOẢN DỊCH VỤ & MIỄN TRỪ TRÁCH NHIỆM RỦI RO GIAO DỊCH VỐN THỰC
                </h4>
              </div>
              <button
                onClick={() => setShowDisclaimerModal(false)}
                className="text-slate-400 hover:text-slate-200 font-mono text-sm"
              >
                ✕
              </button>
            </div>

            {/* Legal Clauses Box */}
            <div className="max-h-64 overflow-y-auto rounded-xl bg-slate-950/80 border border-slate-800 p-4 text-xs font-mono text-slate-300 space-y-3 leading-relaxed">
              <p className="font-bold text-rose-400">
                QUÝ KHÁCH HÀNG VUI LÒNG ĐỌC KỸ TOÀN VĂN ĐIỀU KHOẢN TRƯỚC KHI LIÊN KẾT TÀI KHOẢN MT5 REAL:
              </p>
              <div>
                <strong className="text-slate-100 block">1. Cảnh báo rủi ro đòn bẩy và biến động thị trường Vàng (XAU/USD):</strong>
                Giao dịch ký quỹ tài chính tiềm ẩn rủi ro rất cao. Giá vàng có thể biến động dữ dội trong các phiên ra tin kinh tế (CPI, NFP, FED), có thể dẫn đến việc tài khoản sụt giảm nhanh chóng hoặc mất toàn bộ số dư.
              </div>
              <div>
                <strong className="text-slate-100 block">2. Bản chất công cụ công nghệ & Không nhận ủy thác:</strong>
                ZUPIRUS Quant Lab là nền tảng công nghệ định lượng tự hành cung cấp bộ công cụ thuật toán và sao chép tín hiệu. Chúng tôi TUYỆT ĐỐI KHÔNG phải quỹ tài chính, không nhận ủy thác đầu tư và không cam kết bất kỳ mức lợi nhuận danh nghĩa nào.
              </div>
              <div>
                <strong className="text-slate-100 block">3. Trượt giá (Slippage) và Giãn Spread từ Nhà Môi Giới:</strong>
                Lệnh gửi đến MT5 phụ thuộc vào đường truyền mạng và chính sách khớp lệnh của Broker bạn chọn. ZUPIRUS không chịu trách nhiệm đối với sự trượt giá (slippage) do nhà môi giới thực thi.
              </div>
              <div>
                <strong className="text-slate-100 block">4. Khuyến nghị kiểm nghiệm trên môi trường Demo:</strong>
                Hệ thống luôn khuyến cáo nhà đầu tư kiểm nghiệm tín hiệu tối thiểu 30 ngày trên tài khoản Demo trước khi quyết định mở rộng sang vốn thực.
              </div>
              <div>
                <strong className="text-slate-100 block">5. Cam kết tự nguyện và tự chịu trách nhiệm pháp lý:</strong>
                Bằng việc hoàn tất chữ ký điện tử bên dưới, bạn xác nhận bạn hoàn toàn tự nguyện kết nối tài khoản MT5 Real và đồng ý miễn trừ toàn bộ trách nhiệm pháp lý cho ZUPIRUS đối với bất kỳ rủi ro tài chính nào phát sinh.
              </div>
            </div>

            {disclaimerError && (
              <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-rose-300 text-xs font-mono">
                {disclaimerError}
              </div>
            )}

            {/* Checkboxes & Signature Form */}
            <form onSubmit={handleAcceptDisclaimer} className="space-y-4 font-mono text-xs">
              <div className="space-y-2.5 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
                <label className="flex items-start gap-2.5 cursor-pointer text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={confirmAge}
                    onChange={(e) => setConfirmAge(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-0"
                  />
                  <span>Tôi xác nhận đã đủ 18 tuổi và có đầy đủ năng lực hành vi dân sự.</span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={confirmRisk}
                    onChange={(e) => setConfirmRisk(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-0"
                  />
                  <span>Tôi hiểu rằng giao dịch XAU/USD có rủi ro cao và có thể mất toàn bộ số dư ký quỹ.</span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={confirmNoSol}
                    onChange={(e) => setConfirmNoSol(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-0"
                  />
                  <span>Tôi xác nhận ZUPIRUS không cung cấp lời khuyên ủy thác đầu tư tài chính.</span>
                </label>
              </div>

              <div>
                <label className="block text-[11px] text-slate-300 mb-1">
                  Chữ Ký Điện Tử (Nhập Họ và Tên của bạn để xác nhận) *
                </label>
                <input
                  type="text"
                  required
                  value={signatureInput}
                  onChange={(e) => setSignatureInput(e.target.value)}
                  placeholder="Ví dụ: NGUYEN HOANG MINH"
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-100 font-bold uppercase tracking-wider"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowDisclaimerModal(false)}
                  className="rounded-lg bg-slate-800 hover:bg-slate-700 px-4 py-2 text-slate-300 transition-colors"
                >
                  Huỷ bỏ
                </button>
                <button
                  type="submit"
                  disabled={submittingDisclaimer || !confirmAge || !confirmRisk || !confirmNoSol || !signatureInput.trim()}
                  className="rounded-lg bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 disabled:opacity-50 px-5 py-2 text-white font-bold transition-all shadow-lg"
                >
                  {submittingDisclaimer ? 'Đang xác thực chữ ký…' : '✓ Ký Điện Tử & Mở Khóa Chế Độ Real'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
