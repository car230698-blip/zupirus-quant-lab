import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

export const AdminBillingSettingsTab: React.FC = () => {
  const [settings, setSettings] = useState({
    fallback_usd_vnd_rate: 25600,
    fx_rate_provider_url: 'https://open.er-api.com/v6/latest/USD',
    fx_rate_cache_ttl_seconds: 1800,
    current_live_rate: 25600,
    current_rate_source: 'LIVE_OPEN_ER_API',
  });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

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
        setSettings((prev) => ({
          ...prev,
          ...data,
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
      setMsg(`Lỗi tải cấu hình thanh toán: ${e?.message || 'Không thể kết nối API'}`);
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

  const handleSaveFx = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg('');
    try {
      const payload: any = {
        fallback_usd_vnd_rate: Number(settings.fallback_usd_vnd_rate) || 25600,
        fx_rate_provider_url: settings.fx_rate_provider_url || 'https://open.er-api.com/v6/latest/USD',
        fx_rate_cache_ttl_seconds: Number(settings.fx_rate_cache_ttl_seconds) || 1800,
      };
      const data = await api.put('/api/admin/billing/settings', payload);
      setMsg('Đã lưu cấu hình tỷ giá USD/VND thành công.');
      if (data?.settings) {
        setSettings((prev) => ({
          ...prev,
          ...data.settings,
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

  return (
    <div className="space-y-6">
      {/* DIRECT USDT ON-CHAIN WALLET CONFIGURATION CARD */}
      <div className="rounded-2xl border border-emerald-500/30 bg-[#10192B] p-6 shadow-xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs uppercase tracking-wider text-emerald-400 font-bold">
                CỔNG THANH TOÁN QUỐC TẾ MẶC ĐỊNH (DIRECT USDT ON-CHAIN)
              </span>
              <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
                0% PHÍ TRUNG GIAN · TIỀN VỀ THẲNG VÍ
              </span>
            </div>
            <h3 className="mt-1 text-lg font-bold text-white">
              Cấu Hình Địa Chỉ Ví Nhận USDT (TRC20 &amp; BEP20)
            </h3>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed max-w-2xl">
              Hệ thống xác minh giao dịch tự động trực tiếp trên smart contract USDT chính thức (TronGrid &amp; BSC RPC).
              Khách mua báo cáo chuyển USDT vào ví của Admin, không lưu trữ Private Key trên máy chủ.
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
              💡 Lưu ý: Hệ thống phân bổ số lẻ (VD: $32.01 - $32.99) để xác minh tự động khớp đơn mua báo cáo trong 30 phút.
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

      {/* FX RATE REFERENCE CARD */}
      <form onSubmit={handleSaveFx} className="rounded-2xl border border-white/10 bg-[#0B1221]/80 backdrop-blur-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] pb-4">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
              Tham Chiếu Giá Quy Đổi
            </span>
            <h3 className="mt-0.5 text-lg font-bold text-white">
              Cấu Hình Tham Chiếu Tỷ Giá USD / VND
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
            <label className="mb-1 block text-xs text-slate-400">Tỷ Giá Tham Chiếu Hiện Tại</label>
            <div className="flex h-[42px] items-center rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-3.5 font-mono text-sm font-bold text-emerald-300 tabular-nums">
              {Number(settings.current_live_rate || 25600).toLocaleString('vi-VN')} VND
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
            {loading ? 'Đang Lưu...' : 'Lưu Cấu Hình Tỷ Giá'}
          </button>
        </div>
      </form>
    </div>
  );
};
