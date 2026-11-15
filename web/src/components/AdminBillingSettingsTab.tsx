import React, { useState, useEffect } from 'react';

export function AdminBillingSettingsTab() {
  const [bankName, setBankName] = useState('VietinBank');
  const [accountNumber, setAccountNumber] = useState('105887054819');
  const [accountHolder, setAccountHolder] = useState('LE NGUYEN NHU THUY');
  const [contentPrefix, setContentPrefix] = useState('ZP');
  const [fxMode, setFxMode] = useState('AUTO');
  const [manualFxRate, setManualFxRate] = useState(25600);
  const [currentFxRate, setCurrentFxRate] = useState(25600);
  const [fxSource, setFxSource] = useState('API');
  const [supportedBanks, setSupportedBanks] = useState<any[]>([]);

  // Preview QR state
  const [previewAmount, setPreviewAmount] = useState<number>(772000);
  const [previewMemo, setPreviewMemo] = useState<string>('ZP TESTQR');
  const [previewQrUrl, setPreviewQrUrl] = useState<string>('');
  const [fallbackQrUrl, setFallbackQrUrl] = useState<string>('');

  const [, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  async function fetchBillingSettings() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/billing/settings', {
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        const data = await res.json();
        setBankName(data.bank_name || 'VietinBank');
        setAccountNumber(data.account_number || '105887054819');
        setAccountHolder(data.account_holder || 'LE NGUYEN NHU THUY');
        setContentPrefix(data.content_prefix || 'ZP');
        setFxMode(data.fx_mode || 'AUTO');
        setManualFxRate(data.manual_fx_rate || 25600);
        setCurrentFxRate(data.current_fx_rate || 25600);
        setFxSource(data.fx_source || 'API');
        setSupportedBanks(data.supported_banks || []);
      }
    } catch (e: any) {
      setMsg({ text: 'Lỗi tải cấu hình: ' + e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBillingSettings();
  }, []);

  // Update preview QR whenever bank, acc, or amount changes
  useEffect(() => {
    const encodedMemo = encodeURIComponent(previewMemo);
    const encodedHolder = encodeURIComponent(accountHolder);
    const sepayQr = `https://qr.sepay.vn/img?acc=${accountNumber}&bank=${bankName}&amount=${previewAmount}&des=${encodedMemo}`;
    const vietqr = `https://img.vietqr.io/image/${bankName}-${accountNumber}-compact2.png?amount=${previewAmount}&addInfo=${encodedMemo}&accountName=${encodedHolder}`;
    setPreviewQrUrl(sepayQr);
    setFallbackQrUrl(vietqr);
  }, [bankName, accountNumber, accountHolder, previewAmount, previewMemo]);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/billing/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({
          bank_name: bankName,
          account_number: accountNumber,
          account_holder: accountHolder,
          content_prefix: contentPrefix,
          fx_mode: fxMode,
          manual_fx_rate: Number(manualFxRate),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ text: data.message || 'Lưu cấu hình thành công.', type: 'success' });
        await fetchBillingSettings();
      } else {
        setMsg({ text: data.detail || 'Lỗi lưu cấu hình.', type: 'error' });
      }
    } catch (e: any) {
      setMsg({ text: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleFlushFxCache() {
    setFlushing(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/billing/flush-fx-cache', {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ text: `${data.message} Tỷ giá mới: ${Number(data.new_rate).toLocaleString()} đ/USD (${data.source})`, type: 'success' });
        setCurrentFxRate(data.new_rate);
        setFxSource(data.source);
      } else {
        setMsg({ text: data.detail || 'Lỗi làm mới cache.', type: 'error' });
      }
    } catch (e: any) {
      setMsg({ text: e.message, type: 'error' });
    } finally {
      setFlushing(false);
    }
  }

  return (
    <div className="space-y-6 font-mono text-xs">
      {msg && (
        <div
          className={`p-3.5 rounded-xl border ${
            msg.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
              : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Grid: Form Settings on Left, Live Preview VietQR on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Settings Form */}
        <div className="lg:col-span-2 space-y-6">
          <form onSubmit={handleSaveSettings} className="quant-panel rounded-2xl border border-slate-800 bg-[#0d1424] p-6 space-y-5 shadow-xl">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <span>💳</span>
                <span>CẤU HÌNH TÀI KHOẢN NGÂN HÀNG SEPAY & VIETQR</span>
              </h3>
              <span className="text-[11px] text-emerald-400 bg-emerald-950/80 border border-emerald-700/60 px-2 py-0.5 rounded font-bold">
                Tự Động Kích Hoạt Qua Webhook
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-400 mb-1.5 font-bold">NGÂN HÀNG THỤ HƯỞNG *</label>
                <select
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
                >
                  {supportedBanks.map((b) => (
                    <option key={b.shortName} value={b.shortName}>
                      {b.shortName} - {b.name}
                    </option>
                  ))}
                  {supportedBanks.length === 0 && (
                    <>
                      <option value="VietinBank">VietinBank (ICB)</option>
                      <option value="MBBank">MBBank (MB)</option>
                      <option value="Vietcombank">Vietcombank (VCB)</option>
                      <option value="Techcombank">Techcombank (TCB)</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1.5 font-bold">SỐ TÀI KHOẢN NGÂN HÀNG *</label>
                <input
                  type="text"
                  required
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.trim())}
                  placeholder="VD: 105887054819"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1.5 font-bold">CHỦ TÀI KHOẢN (IN HOA) *</label>
                <input
                  type="text"
                  required
                  value={accountHolder}
                  onChange={(e) => setAccountHolder(e.target.value.toUpperCase())}
                  placeholder="VD: LE NGUYEN NHU THUY"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1.5 font-bold">TIỀN TỐ NỘI DUNG CHUYỂN KHOẢN</label>
                <input
                  type="text"
                  required
                  value={contentPrefix}
                  onChange={(e) => setContentPrefix(e.target.value.toUpperCase().trim())}
                  placeholder="VD: ZP"
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                />
              </div>
            </div>

            {/* Exchange Rate Management Section */}
            <div className="pt-4 border-t border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-200">QUẢN LÝ TỶ GIÁ USD/VND</h4>
                  <p className="text-[11px] text-slate-400">
                    Tỷ giá dùng để quy đổi giá gói thuê bao ($29, $49, $99) sang VNĐ cho khách quét VietQR.
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 block">TỶ GIÁ HIỆN HÀNH</span>
                  <span className="font-bold text-cyan-300 text-sm">{Number(currentFxRate).toLocaleString()} đ/USD</span>
                  <span className="text-[10px] text-slate-500 block">Nguồn: {fxSource}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1.5 font-bold">CHẾ ĐỘ CẬP NHẬT TỶ GIÁ</label>
                  <select
                    value={fxMode}
                    onChange={(e) => setFxMode(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
                  >
                    <option value="AUTO">AUTO (Tự động cập nhật qua Vietcombank / Open Exchange API)</option>
                    <option value="MANUAL">MANUAL (Cố định tỷ giá theo số nhập thủ công)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1.5 font-bold">TỶ GIÁ CỐ ĐỊNH (KHI CHỌN MANUAL)</label>
                  <input
                    type="number"
                    value={manualFxRate}
                    disabled={fxMode !== 'MANUAL'}
                    onChange={(e) => setManualFxRate(parseFloat(e.target.value))}
                    className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleFlushFxCache}
                  disabled={flushing}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-bold transition-all disabled:opacity-50"
                >
                  {flushing ? 'Đang làm mới cache…' : '↻ Làm Mới Cache Tỷ Giá (Flush Redis)'}
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold transition-all disabled:opacity-50 shadow-lg shadow-cyan-500/20"
                >
                  {saving ? 'Đang lưu…' : 'Lưu Cấu Hình Thanh Toán'}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Right Col: Live Preview VietQR Test Modal Simulator */}
        <div className="quant-panel rounded-2xl border border-slate-800 bg-[#0d1424] p-5 space-y-4 shadow-xl">
          <div className="border-b border-slate-800 pb-2.5 flex items-center justify-between">
            <span className="font-bold text-slate-200">XEM TRƯỚC MÃ VIETQR THỰC TẾ</span>
            <span className="text-[10px] text-cyan-400">Live Preview</span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-slate-400 text-[11px] block mb-1">Số tiền test (VNĐ):</label>
              <input
                type="number"
                value={previewAmount}
                onChange={(e) => setPreviewAmount(parseInt(e.target.value) || 0)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-slate-100 font-mono text-xs"
              />
            </div>

            <div>
              <label className="text-slate-400 text-[11px] block mb-1">Nội dung chuyển khoản test:</label>
              <input
                type="text"
                value={previewMemo}
                onChange={(e) => setPreviewMemo(e.target.value)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-slate-100 font-mono text-xs"
              />
            </div>
          </div>

          {/* QR Render Canvas */}
          <div className="bg-white p-3 rounded-2xl max-w-[210px] mx-auto shadow-2xl relative min-h-[190px] flex items-center justify-center">
            {previewQrUrl ? (
              <img
                src={previewQrUrl}
                alt="SePay VietQR Preview"
                className="w-full h-auto object-contain rounded-lg"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (target.src !== fallbackQrUrl) {
                    target.src = fallbackQrUrl;
                  }
                }}
              />
            ) : (
              <span className="text-slate-400 text-xs">Đang tạo mã QR...</span>
            )}
          </div>

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">Ngân hàng:</span>
              <span className="font-bold text-slate-200">{bankName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Số tài khoản:</span>
              <span className="font-bold text-cyan-300">{accountNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Chủ tài khoản:</span>
              <span className="font-bold text-slate-200">{accountHolder}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Số tiền:</span>
              <span className="font-bold text-emerald-400">{previewAmount.toLocaleString()} đ</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Nội dung:</span>
              <span className="font-bold text-amber-400">{previewMemo}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
