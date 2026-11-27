import React, { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { Panel, StatusBadge } from '../ui/Primitives';
import { Wallet, RefreshCw, ShieldAlert, Lock, Unlock, Database, Cpu } from 'lucide-react';

export const AdminBillingSettings: React.FC = () => {
  const [settings, setSettings] = useState({
    fallback_usd_vnd_rate: 25600,
    fx_rate_provider_url: 'https://open.er-api.com/v6/latest/USD',
    fx_rate_cache_ttl_seconds: 1800,
    current_live_rate: 25600,
    current_rate_source: 'LIVE_OPEN_ER_API',
  });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const [cryptoWallets, setCryptoWallets] = useState<{
    enabled: boolean;
    trc20_address: string;
    bep20_address: string;
    db_saved_enabled?: boolean;
    env_payment_usdt_enabled?: boolean;
    env_commercial_sales_enabled?: boolean;
    checkout_locked?: boolean;
    checkout_status?: string;
  }>({
    enabled: true,
    trc20_address: '',
    bep20_address: '',
  });

  const [cryptoBusy, setCryptoBusy] = useState(false);
  const [cryptoMsg, setCryptoMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [cryptoLoadError, setCryptoLoadError] = useState<string | null>(null);

  const fetchSettings = async () => {
    setLoading(true);
    setCryptoLoadError(null);
    try {
      const data = await api.get('/api/admin/billing/settings');
      if (data && typeof data === 'object') {
        setSettings((prev) => ({
          ...prev,
          ...data,
        }));
      }

      try {
        const cData = await api.get('/api/v1/admin/billing/crypto-wallets');
        if (cData && typeof cData === 'object') {
          setCryptoWallets({
            enabled: cData.enabled !== false,
            trc20_address: cData.trc20_address || '',
            bep20_address: cData.bep20_address || '',
            db_saved_enabled: cData.db_saved_enabled,
            env_payment_usdt_enabled: cData.env_payment_usdt_enabled,
            env_commercial_sales_enabled: cData.env_commercial_sales_enabled,
            checkout_locked: cData.checkout_locked,
            checkout_status: cData.checkout_status,
          });
        }
      } catch (err: any) {
        setCryptoLoadError(err?.message || 'Không thể tải cấu hình ví USDT.');
      }
    } catch (e: any) {
      setMsg(`Lỗi tải cấu hình thanh toán: ${e?.message || 'Không thể kết nối API'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSaveCryptoWallets = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cryptoLoadError) {
      setCryptoMsg({
        type: 'err',
        text: 'Không thể lưu vì dữ liệu cấu hình ban đầu nạp thất bại. Vui lòng thử tải lại trang trước.',
      });
      return;
    }

    setCryptoBusy(true);
    setCryptoMsg(null);

    const trc20 = cryptoWallets.trc20_address.trim();
    const bep20 = cryptoWallets.bep20_address.trim();

    if (trc20 && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trc20)) {
      setCryptoMsg({
        type: 'err',
        text: 'Địa chỉ ví USDT TRC20 không hợp lệ (bắt đầu bằng chữ T và dài 34 ký tự).',
      });
      setCryptoBusy(false);
      return;
    }

    if (bep20 && !/^0x[a-fA-F0-9]{40}$/.test(bep20)) {
      setCryptoMsg({
        type: 'err',
        text: 'Địa chỉ ví USDT BEP20 không hợp lệ (bắt đầu bằng 0x và dài 42 ký tự).',
      });
      setCryptoBusy(false);
      return;
    }

    try {
      await api.put('/api/v1/admin/billing/crypto-wallets', {
        enabled: cryptoWallets.enabled,
        trc20_address: trc20,
        bep20_address: bep20,
      });
      setCryptoMsg({ type: 'ok', text: 'Đã lưu cấu hình ví nhận USDT on-chain thành công.' });
      await fetchSettings();
    } catch (err: any) {
      setCryptoMsg({ type: 'err', text: `Lỗi lưu ví USDT: ${err?.message || 'Không thể kết nối API'}` });
    } finally {
      setCryptoBusy(false);
    }
  };

  const handleSaveFx = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg('');
    try {
      const payload = {
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
    setMsg('Đang cập nhật tỷ giá USD/VND mới nhất...');
    try {
      const data = await api.post('/api/admin/billing/flush-fx-cache');
      const liveRate = Number(data.new_rate ?? data.usd_vnd_rate ?? 0);
      setSettings((prev) => ({
        ...prev,
        current_live_rate: liveRate || prev.current_live_rate,
        current_rate_source: data.source || prev.current_rate_source,
      }));
      setMsg(
        `Đã cập nhật tỷ giá: 1 USD = ${(liveRate || settings.current_live_rate).toLocaleString('vi-VN')} VND`
      );
    } catch (e: any) {
      setMsg(`Lỗi: ${e.message || 'Lỗi cập nhật tỷ giá'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* DIRECT USDT ON-CHAIN WALLET CONFIGURATION */}
      <Panel
        icon={<Wallet className="h-4 w-4 text-emerald-300" />}
        title="Cấu hình Ví nhận USDT On-Chain (TRC20 & BEP20)"
        subtitle="Đối soát trực tiếp smart contract USDT trên TronGrid & BSC RPC · Không lưu Private Key"
        action={
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <StatusBadge tone={cryptoWallets.enabled ? 'success' : 'neutral'}>
              {cryptoWallets.enabled ? 'Đang bật' : 'Tạm tắt'}
            </StatusBadge>
            <input
              type="checkbox"
              checked={cryptoWallets.enabled}
              onChange={(e) => setCryptoWallets((prev) => ({ ...prev, enabled: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-emerald-500 cursor-pointer"
            />
          </label>
        }
      >
        {/* OPERATIONAL SAFETY DIAGNOSTIC STRIP */}
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
          <div className="rounded-xl border border-slate-800 bg-[#060A13] p-3 space-y-1">
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-cyan-400" />
              <span>Trạng Thái Lưu Trong DB</span>
            </div>
            <div className="font-bold text-white">
              {cryptoWallets.db_saved_enabled ? (
                <span className="text-emerald-400">ENABLED (Đã bật trong KV)</span>
              ) : (
                <span className="text-slate-400">DISABLED (Chưa bật)</span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#060A13] p-3 space-y-1">
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-amber-400" />
              <span>Biến Môi Trường (ENV)</span>
            </div>
            <div className="font-bold text-white">
              USDT: {cryptoWallets.env_payment_usdt_enabled ? (
                <strong className="text-emerald-400">ON</strong>
              ) : (
                <strong className="text-slate-400">OFF</strong>
              )}{' '}
              · Sale: {cryptoWallets.env_commercial_sales_enabled ? (
                <strong className="text-emerald-400">ON</strong>
              ) : (
                <strong className="text-amber-400">LOCKED</strong>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#060A13] p-3 space-y-1">
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              {cryptoWallets.checkout_locked ? (
                <Lock className="h-3.5 w-3.5 text-amber-400" />
              ) : (
                <Unlock className="h-3.5 w-3.5 text-emerald-400" />
              )}
              <span>Cổng Thanh Toán Production</span>
            </div>
            <div className="font-bold text-xs truncate">
              {cryptoWallets.checkout_locked ? (
                <span className="text-amber-400">ĐÃ KHÓA (An Toàn Tuyệt Đối)</span>
              ) : (
                <span className="text-emerald-400">MỞ BÁN THỰC TẾ</span>
              )}
            </div>
          </div>
        </div>

        {cryptoLoadError && (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-950/20 p-3.5 text-xs text-rose-200 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
            <span>
              {cryptoLoadError}. Nút lưu cấu hình ví USDT đã bị khóa để bảo vệ hệ thống tránh ghi đè trắng.
            </span>
          </div>
        )}

        {cryptoMsg && (
          <div
            className={`mb-4 rounded-xl border p-3.5 text-xs font-medium ${
              cryptoMsg.type === 'ok'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
            }`}
          >
            {cryptoMsg.text}
          </div>
        )}

        <form onSubmit={handleSaveCryptoWallets} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="rounded-xl border border-slate-800 bg-[#060A13] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-200">
                  Địa Chỉ Ví USDT (TRC20 · TRON)
                </label>
                <span className="font-mono text-[11px] text-amber-300">Phổ biến</span>
              </div>
              <input
                type="text"
                value={cryptoWallets.trc20_address}
                onChange={(e) => setCryptoWallets((prev) => ({ ...prev, trc20_address: e.target.value }))}
                placeholder="TQ3g...xyz (34 ký tự)"
                className="quant-input font-mono text-xs"
              />
              <p className="font-mono text-[11px] text-slate-500">
                Contract: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#060A13] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-200">
                  Địa Chỉ Ví USDT (BEP20 · BNB Smart Chain)
                </label>
                <span className="font-mono text-[11px] text-cyan-300">Phí gas thấp</span>
              </div>
              <input
                type="text"
                value={cryptoWallets.bep20_address}
                onChange={(e) => setCryptoWallets((prev) => ({ ...prev, bep20_address: e.target.value }))}
                placeholder="0x71...abc (42 ký tự)"
                className="quant-input font-mono text-xs"
              />
              <p className="font-mono text-[11px] text-slate-500">
                Contract: 0x55d398326f99059fF775485246999027B3197955
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
            <span className="text-xs text-slate-400">
              Hệ thống tự động gán số lẻ (VD: $32.01 – $32.99) để khớp giao dịch mua báo cáo.
            </span>
            <button
              type="submit"
              disabled={cryptoBusy || Boolean(cryptoLoadError)}
              className="quant-btn-primary text-xs"
            >
              {cryptoBusy ? 'Đang lưu ví USDT...' : 'Lưu Cài Đặt Ví USDT'}
            </button>
          </div>
        </form>
      </Panel>

      {/* FX RATE REFERENCE */}
      <Panel
        icon={<RefreshCw className="h-4 w-4 text-cyan-300" />}
        title="Tham Chiếu Tỷ Giá USD / VND"
        subtitle="Dùng để quy đổi giá tham chiếu hiển thị bằng VND trên trang danh mục"
        action={
          <button type="button" onClick={handleFlushFx} disabled={loading} className="quant-btn-secondary text-xs">
            Làm mới tỷ giá
          </button>
        }
      >
        <form onSubmit={handleSaveFx} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Tỷ Giá Dự Phòng (VND)</label>
              <input
                type="number"
                value={settings.fallback_usd_vnd_rate}
                onChange={(e) => setSettings({ ...settings, fallback_usd_vnd_rate: Number(e.target.value) })}
                className="quant-input font-mono text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Cache TTL (Giây)</label>
              <input
                type="number"
                value={settings.fx_rate_cache_ttl_seconds}
                onChange={(e) => setSettings({ ...settings, fx_rate_cache_ttl_seconds: Number(e.target.value) })}
                className="quant-input font-mono text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Tỷ Giá Tham Chiếu Hiện Tại</label>
              <div className="flex h-[40px] items-center rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-3.5 font-mono text-sm font-bold text-emerald-300 tabular-nums">
                {Number(settings.current_live_rate || 25600).toLocaleString('vi-VN')} VND
              </div>
            </div>
          </div>

          {msg && (
            <div className="rounded-xl border border-cyan-500/35 bg-cyan-950/30 px-4 py-2.5 text-xs text-cyan-200">
              {msg}
            </div>
          )}

          <div className="flex justify-end">
            <button type="submit" disabled={loading} className="quant-btn-primary text-xs">
              {loading ? 'Đang lưu...' : 'Lưu Cấu Hình Tỷ Giá'}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
};
