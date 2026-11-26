import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

export const AdminBillingSettingsTab: React.FC = () => {
  const [settings, setSettings] = useState({
    sepay_bank_name: 'VietinBank',
    sepay_account_number: '',
    sepay_account_holder: '',
    sepay_webhook_secret_masked: '',
    fallback_usd_vnd_rate: 25600,
    fx_rate_provider_url: 'https://open.er-api.com/v6/latest/USD',
    fx_rate_cache_ttl_seconds: 1800,
    current_live_rate: 25600,
    current_rate_source: 'LIVE_OPEN_ER_API',
  });
  const [webhookSecretInput, setWebhookSecretInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [previewUsd, setPreviewUsd] = useState(59);

  // Direct USDT On-Chain State
  const [cryptoWallets, setCryptoWallets] = useState<{
    enabled: boolean;
    trc20_address: string;
    bep20_address: string;
  }>({
    enabled: true,
    trc20_address: '',
    bep20_address: '',
  });
  const [cryptoBusy, setCryptoBusy] = useState(false);
  const [cryptoMsg, setCryptoMsg] = useState('');

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/admin/billing/settings');
      if (data && typeof data === 'object') {
        const bank = (data.sepay_bank_name || data.bank_name || '').trim();
        const acc = (data.sepay_account_number || data.account_number || '').trim();
        const holder = (data.sepay_account_holder || data.account_holder || '').trim().toUpperCase();
        setSettings((prev) => ({
          ...prev,
          ...data,
          sepay_bank_name: bank || prev.sepay_bank_name || 'VietinBank',
          sepay_account_number: acc || prev.sepay_account_number || '',
          sepay_account_holder: holder || prev.sepay_account_holder || '',
        }));
      }

      // Fetch Crypto Wallets Config
      try {
        const cData = await api.get('/api/v1/admin/billing/crypto-wallets');
        if (cData && typeof cData === 'object') {
          setCryptoWallets({
            enabled: cData.enabled !== false,
            trc20_address: cData.trc20_address || '',
            bep20_address: cData.bep20_address || '',
          });
        }
      } catch {}
    } catch (e: any) {
      setMsg(`Lỗi tải cấu hình SePay: ${e?.message || 'Không thể kết nối API'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCryptoWallets = async (e: React.FormEvent) => {
    e.preventDefault();
    setCryptoBusy(true);
    setCryptoMsg('');

    const trc20 = cryptoWallets.trc20_address.trim();
    const bep20 = cryptoWallets.bep20_address.trim();

    if (trc20 && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trc20)) {
      setCryptoMsg('❌ Địa chỉ ví USDT TRC20 không hợp lệ (phải bắt đầu bằng chữ T và dài 34 ký tự).');
      setCryptoBusy(false);
      return;
    }

    if (bep20 && !/^0x[a-fA-F0-9]{40}$/.test(bep20)) {
      setCryptoMsg('❌ Địa chỉ ví USDT BEP20 không hợp lệ (phải bắt đầu bằng 0x và dài 42 ký tự).');
      setCryptoBusy(false);
      return;
    }

    try {
      await api.put('/api/v1/admin/billing/crypto-wallets', {
        enabled: cryptoWallets.enabled,
        trc20_address: trc20,
        bep20_address: bep20,
      });
      setCryptoMsg('✓ Đã lưu cài đặt ví USDT on-chain thành công!');
    } catch (err: any) {
      setCryptoMsg(`❌ Lỗi lưu ví USDT: ${err?.message || 'Không thể kết nối API'}`);
    } finally {
      setCryptoBusy(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg('');
    try {
      const payload: any = {
        sepay_bank_name: (settings.sepay_bank_name || 'VietinBank').trim(),
        sepay_account_number: (settings.sepay_account_number || '').trim(),
        sepay_account_holder: (settings.sepay_account_holder || '').trim().toUpperCase(),
        fallback_usd_vnd_rate: Number(settings.fallback_usd_vnd_rate) || 25600,
        fx_rate_provider_url: settings.fx_rate_provider_url || 'https://open.er-api.com/v6/latest/USD',
        fx_rate_cache_ttl_seconds: Number(settings.fx_rate_cache_ttl_seconds) || 1800,
      };
      if (webhookSecretInput.trim()) {
        payload.sepay_webhook_secret = webhookSecretInput.trim();
      }
      const data = await api.put('/api/admin/billing/settings', payload);
      setMsg('Đã lưu cấu hình thanh toán SePay & tỷ giá USD/VND thành công.');
      setWebhookSecretInput('');
      if (data?.settings) {
        const s = data.settings;
        const bank = (s.sepay_bank_name || s.bank_name || '').trim();
        const acc = (s.sepay_account_number || s.account_number || '').trim();
        const holder = (s.sepay_account_holder || s.account_holder || '').trim().toUpperCase();
        setSettings((prev) => ({
          ...prev,
          ...s,
          sepay_bank_name: bank || prev.sepay_bank_name || 'VietinBank',
          sepay_account_number: acc || prev.sepay_account_number || '',
          sepay_account_holder: holder || prev.sepay_account_holder || '',
        }));
      }
    } catch (e: any) {
      setMsg(`Lỗi: ${e.message || 'Lỗi lưu cấu hình'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFlushFx = async () => {
    setLoading(true);
    setMsg('Đang xoá bộ nhớ đệm Redis và cập nhật tỷ giá USD/VND mới nhất...');
    try {
      const data = await api.post('/api/admin/billing/flush-fx-cache');
      const liveRate = Number(data.new_rate ?? data.usd_vnd_rate ?? 0);
      setSettings((prev) => ({
        ...prev,
        current_live_rate: liveRate || prev.current_live_rate,
        current_rate_source: data.source || prev.current_rate_source,
      }));
      setMsg(
        `Đã cập nhật tỷ giá trực tiếp: 1 USD = ${(liveRate || settings.current_live_rate).toLocaleString('vi-VN')} VND (${data.source})`
      );
    } catch (e: any) {
      setMsg(`Lỗi: ${e.message || 'Lỗi cập nhật tỷ giá'}`);
    } finally {
      setLoading(false);
    }
  };

  const currentBank = (settings.sepay_bank_name || (settings as any).bank_name || 'VietinBank').trim();
  const currentAcc = (settings.sepay_account_number || (settings as any).account_number || '').trim();
  const currentHolder = (settings.sepay_account_holder || (settings as any).account_holder || '').trim().toUpperCase();
  const previewVnd = Math.round(((previewUsd * (settings.current_live_rate || 25600)) / 1000)) * 1000;
  const isVietin = currentBank.toLowerCase().includes('vietin') || currentBank.toLowerCase() === 'icb';
  const testMemo = isVietin ? 'SEVQR ZPTEST999' : 'ZPTEST999';
  const previewQrUrl =
    currentBank && currentAcc
      ? `https://qr.sepay.vn/img?bank=${encodeURIComponent(currentBank)}&acc=${encodeURIComponent(
          currentAcc
        )}&template=compact&amount=${previewVnd}&des=${encodeURIComponent(testMemo)}`
      : '';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 7 Cols: SePay & FX Configuration Form */}
        <form onSubmit={handleSave} className="rounded-2xl border border-white/10 bg-[#0B1221]/80 backdrop-blur-xl p-6 space-y-5 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] pb-4">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
                Cổng Thanh Toán & Tỷ Giá
              </span>
              <h3 className="mt-0.5 text-lg font-bold text-white">
                Cấu Hình Ngân Hàng SePay & Đồng Bộ Tỷ Giá USD/VND
              </h3>
            </div>
            <button
              type="button"
              onClick={handleFlushFx}
              disabled={loading}
              className="quant-btn-secondary px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
            >
              Làm Mới Tỷ Giá Ngay
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Tên Ngân Hàng Nhận (Mã VietQR / SePay)
              </label>
              <input
                type="text"
                list="supported-sepay-banks"
                value={settings.sepay_bank_name}
                onChange={(e) => setSettings({ ...settings, sepay_bank_name: e.target.value })}
                placeholder="VD: VietinBank, MBBank, VCB, ACB, TCB, BIDV..."
                className="quant-input font-mono text-sm"
              />
              <datalist id="supported-sepay-banks">
                <option value="VietinBank">VietinBank (ICB)</option>
                <option value="MBBank">MBBank (MB)</option>
                <option value="Vietcombank">Vietcombank (VCB)</option>
                <option value="Techcombank">Techcombank (TCB)</option>
                <option value="ACB">ACB</option>
                <option value="VPBank">VPBank</option>
                <option value="TPBank">TPBank</option>
                <option value="BIDV">BIDV</option>
                <option value="Sacombank">Sacombank</option>
                <option value="HDBank">HDBank</option>
              </datalist>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Số Tài Khoản Ngân Hàng Nhận
              </label>
              <input
                type="text"
                value={settings.sepay_account_number}
                onChange={(e) => setSettings({ ...settings, sepay_account_number: e.target.value })}
                placeholder="VD: 0987654321"
                className="quant-input font-mono text-sm tabular-nums"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Tên Chủ Tài Khoản (In Hoa Không Dấu)
              </label>
              <input
                type="text"
                value={settings.sepay_account_holder}
                onChange={(e) => setSettings({ ...settings, sepay_account_holder: e.target.value.toUpperCase() })}
                placeholder="VD: NGUYEN VAN A"
                className="quant-input font-mono text-sm uppercase"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                SePay Webhook Secret ({settings.sepay_webhook_secret_masked || 'Chưa đặt'})
              </label>
              <input
                type="password"
                value={webhookSecretInput}
                onChange={(e) => setWebhookSecretInput(e.target.value)}
                placeholder="Để trống nếu giữ nguyên khóa hiện tại"
                className="quant-input font-mono text-sm"
              />
            </div>
          </div>

          <div className="border-t border-white/[0.06] pt-4">
            <div className="mb-3 text-xs font-mono uppercase tracking-wider text-emerald-300">
              Bộ Quy Đổi Tỷ Giá Tự Động (USD → VND)
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Tỷ Giá Dự Phòng (VND)</label>
                <input
                  type="number"
                  value={settings.fallback_usd_vnd_rate}
                  onChange={(e) =>
                    setSettings({ ...settings, fallback_usd_vnd_rate: Number(e.target.value) })
                  }
                  className="quant-input font-mono text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Thời Gian Cache Redis (Giây)</label>
                <input
                  type="number"
                  value={settings.fx_rate_cache_ttl_seconds}
                  onChange={(e) =>
                    setSettings({ ...settings, fx_rate_cache_ttl_seconds: Number(e.target.value) })
                  }
                  className="quant-input font-mono text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Tỷ Giá Thực Tế Hiện Tại</label>
                <div className="flex h-[42px] items-center rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-3.5 font-mono text-sm font-bold text-emerald-300 tabular-nums">
                  {Number(settings.current_live_rate || 25500).toLocaleString('vi-VN')} VND
                </div>
              </div>
            </div>
          </div>

          {msg && (
            <div className="rounded-xl border border-cyan-500/35 bg-cyan-950/30 px-4 py-2.5 text-xs text-cyan-200">
              {msg}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading}
              className="quant-btn-primary px-6 py-2.5 text-xs whitespace-nowrap shrink-0"
            >
              {loading ? 'Đang Lưu...' : 'Lưu Cấu Hình Thanh Toán'}
            </button>
          </div>
        </form>

        {/* Right 5 Cols: Live VietQR Simulator Card */}
        <div className="rounded-2xl border border-white/10 bg-[#0B1221]/80 backdrop-blur-xl flex flex-col justify-between p-6 lg:col-span-5">
          <div className="space-y-4">
            <div className="border-b border-white/[0.07] pb-4">
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-400">
                Mô Phỏng Trực Tiếp
              </span>
              <h3 className="mt-0.5 text-lg font-bold text-white">Kiểm Tra Hiển Thị Mã VietQR</h3>
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-slate-400">Mức giá gói thử nghiệm (USD)</label>
              <div className="flex gap-2">
                {[39, 59, 149].map((usd) => (
                  <button
                    key={usd}
                    type="button"
                    onClick={() => setPreviewUsd(usd)}
                    className={`flex-1 rounded-xl border py-2 font-mono text-xs font-bold transition tabular-nums ${
                      previewUsd === usd
                        ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                        : 'border-white/[0.08] bg-[#040710]/70 text-slate-400 hover:text-white'
                    }`}
                  >
                    ${usd}
                  </button>
                ))}
              </div>
            </div>

            {previewQrUrl ? (
              <div className="mx-auto w-52 overflow-hidden rounded-2xl border border-cyan-500/30 bg-white p-3 shadow-[0_0_30px_rgba(6,182,212,0.2)]">
                <img src={previewQrUrl} alt="VietQR Preview" className="h-full w-full object-contain" />
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#040710]/60 p-4 text-center text-xs text-slate-400">
                Nhập Mã Ngân Hàng và Số Tài Khoản bên trái để xem trước mã VietQR.
              </div>
            )}

            <div className="space-y-1.5 rounded-xl border border-white/[0.07] bg-[#040710] p-3.5 font-mono text-xs tabular-nums">
              <div className="flex justify-between">
                <span className="text-slate-400">Ngân hàng thụ hưởng:</span>
                <strong className="text-white">{currentBank || '—'}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Số tài khoản:</span>
                <strong className="text-cyan-300">{currentAcc || '—'}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Chủ tài khoản:</span>
                <strong className="text-slate-200 uppercase">{currentHolder || '—'}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Số tiền quy đổi:</span>
                <strong className="text-emerald-400">{previewVnd.toLocaleString('vi-VN')} VND</strong>
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-white/[0.06] pt-3 font-mono text-[11px] text-slate-400">
            Webhook URL: <code className="text-cyan-300">/api/webhooks/sepay</code>
          </div>
        </div>
      </div>

      {/* DIRECT USDT ON-CHAIN WALLET CONFIGURATION CARD */}
      <div className="rounded-2xl border border-emerald-500/30 bg-[#10192B] p-6 shadow-xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs uppercase tracking-wider text-emerald-400 font-bold">
                THANH TOÁN QUỐC TẾ TRỰC TIẾP (DIRECT USDT ON-CHAIN)
              </span>
              <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
                0% PHÍ TRUNG GIAN · TIỀN VỀ THẲNG VÍ
              </span>
            </div>
            <h3 className="mt-1 text-lg font-bold text-white">
              Cấu Hình Địa Chỉ Ví Nhận USDT (TRC20 &amp; BEP20)
            </h3>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed max-w-2xl">
              Hệ thống xác minh giao dịch trực tiếp trên hợp đồng thông minh USDT chính thức (TronGrid &amp; BSC RPC). 
              Khách quốc tế chuyển USDT vào đúng ví của Admin, không lưu trữ Private Key trên VPS.
            </p>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <span className="text-xs font-semibold text-slate-300">
              {cryptoWallets.enabled ? 'Cổng USDT đang BẬT' : 'Cổng USDT đang TẮT'}
            </span>
            <input
              type="checkbox"
              checked={cryptoWallets.enabled}
              onChange={(e) => setCryptoWallets((prev) => ({ ...prev, enabled: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-400 cursor-pointer"
            />
          </label>
        </div>

        {cryptoMsg && (
          <div
            className={`rounded-xl border p-3.5 text-xs font-medium ${
              cryptoMsg.startsWith('✓')
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
            }`}
          >
            {cryptoMsg}
          </div>
        )}

        <form onSubmit={handleSaveCryptoWallets} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* TRC20 Wallet */}
            <div className="rounded-xl border border-slate-800 bg-[#080E1A] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200">
                  Địa Chỉ Ví USDT (TRC20 - Mạng TRON)
                </label>
                <span className="font-mono text-[10px] text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded">
                  Phổ biến nhất
                </span>
              </div>
              <input
                type="text"
                value={cryptoWallets.trc20_address}
                onChange={(e) => setCryptoWallets((prev) => ({ ...prev, trc20_address: e.target.value }))}
                placeholder="Ví dụ: TQ3g...xyz (bắt đầu bằng T, dài 34 ký tự)"
                className="w-full rounded-xl border border-slate-800 bg-[#10192B] px-3.5 py-2.5 font-mono text-xs text-white placeholder-slate-600 focus:border-emerald-400 focus:outline-none"
              />
              <p className="font-mono text-[11px] text-slate-500">
                Official Contract: <span className="text-slate-400">TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t</span>
              </p>
            </div>

            {/* BEP20 Wallet */}
            <div className="rounded-xl border border-slate-800 bg-[#080E1A] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200">
                  Địa Chỉ Ví USDT (BEP20 - BNB Smart Chain)
                </label>
                <span className="font-mono text-[10px] text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded">
                  Phí gas rẻ
                </span>
              </div>
              <input
                type="text"
                value={cryptoWallets.bep20_address}
                onChange={(e) => setCryptoWallets((prev) => ({ ...prev, bep20_address: e.target.value }))}
                placeholder="Ví dụ: 0x71...abc (bắt đầu bằng 0x, dài 42 ký tự)"
                className="w-full rounded-xl border border-slate-800 bg-[#10192B] px-3.5 py-2.5 font-mono text-xs text-white placeholder-slate-600 focus:border-emerald-400 focus:outline-none"
              />
              <p className="font-mono text-[11px] text-slate-500">
                Official Contract: <span className="text-slate-400">0x55d398326f99059fF775485246999027B3197955</span>
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-800 pt-4">
            <div className="text-xs text-slate-400">
              💡 Lưu ý: Hệ thống phân bổ số lẻ (VD: $25.01 - $25.99) để xác minh tự động khớp lệnh trong 30 phút.
            </div>
            <button
              type="submit"
              disabled={cryptoBusy}
              className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-2.5 text-xs font-bold text-[#042F2E] hover:from-emerald-400 hover:to-teal-400 transition cursor-pointer disabled:opacity-50 shadow-md"
            >
              {cryptoBusy ? 'Đang lưu ví USDT...' : 'Lưu Cài Đặt Ví USDT On-Chain'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
