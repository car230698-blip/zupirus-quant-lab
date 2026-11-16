import React, { useState, useEffect } from 'react';
import { formatApiError } from '../utils/formatError.ts';

export const AdminBillingSettingsTab: React.FC = () => {
  const [settings, setSettings] = useState({
    sepay_bank_name: '',
    sepay_account_number: '',
    sepay_account_holder: '',
    sepay_webhook_secret_masked: '',
    fallback_usd_vnd_rate: 25500,
    fx_rate_provider_url: 'https://open.er-api.com/v6/latest/USD',
    fx_rate_cache_ttl_seconds: 1800,
    current_live_rate: 25500,
    current_rate_source: 'LIVE_OPEN_ER_API',
  });
  const [webhookSecretInput, setWebhookSecretInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [previewUsd, setPreviewUsd] = useState(59);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/billing/settings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
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
        sepay_bank_name: settings.sepay_bank_name,
        sepay_account_number: settings.sepay_account_number,
        sepay_account_holder: settings.sepay_account_holder,
        fallback_usd_vnd_rate: Number(settings.fallback_usd_vnd_rate) || 25500,
        fx_rate_provider_url: settings.fx_rate_provider_url,
        fx_rate_cache_ttl_seconds: Number(settings.fx_rate_cache_ttl_seconds) || 1800,
      };
      if (webhookSecretInput.trim()) {
        payload.sepay_webhook_secret = webhookSecretInput.trim();
      }
      const res = await fetch('/api/admin/billing/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg('Đã lưu cấu hình thanh toán SePay & tỷ giá USD/VND thành công.');
        setWebhookSecretInput('');
        if (data.settings) setSettings(data.settings);
      } else {
        setMsg(`Lỗi: ${formatApiError(data, res.status)}`);
      }
    } catch (e: any) {
      setMsg(`Lỗi mạng: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFlushFx = async () => {
    setLoading(true);
    setMsg('Đang xoá bộ nhớ đệm Redis và cập nhật tỷ giá USD/VND mới nhất...');
    try {
      const res = await fetch('/api/admin/billing/flush-fx-cache', {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSettings((prev) => ({
          ...prev,
          current_live_rate: data.usd_vnd_rate || prev.current_live_rate,
          current_rate_source: data.source || prev.current_rate_source,
        }));
        setMsg(
          `Đã cập nhật tỷ giá trực tiếp: 1 USD = ${Number(data.usd_vnd_rate).toLocaleString('vi-VN')} VND (${data.source})`
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const previewVnd = Math.round(((previewUsd * (settings.current_live_rate || 25500)) / 1000)) * 1000;
  const previewQrUrl =
    settings.sepay_bank_name && settings.sepay_account_number
      ? `https://qr.sepay.vn/img?bank=${encodeURIComponent(settings.sepay_bank_name)}&acc=${encodeURIComponent(
          settings.sepay_account_number
        )}&template=compact&amount=${previewVnd}&des=ZUPTEST999`
      : '';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 7 Cols: SePay & FX Configuration Form */}
        <form onSubmit={handleSave} className="quant-panel p-6 space-y-5 lg:col-span-7">
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
                value={settings.sepay_bank_name}
                onChange={(e) => setSettings({ ...settings, sepay_bank_name: e.target.value })}
                placeholder="VD: MB, VCB, ACB, TCB, BIDV..."
                className="quant-input font-mono text-sm"
              />
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
        <div className="quant-panel flex flex-col justify-between p-6 lg:col-span-5">
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
                <strong className="text-white">{settings.sepay_bank_name || '—'}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Số tài khoản:</span>
                <strong className="text-cyan-300">{settings.sepay_account_number || '—'}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Số tiền quy đổi:</span>
                <strong className="text-emerald-400">{previewVnd.toLocaleString('vi-VN')} VND</strong>
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-white/[0.06] pt-3 font-mono text-[11px] text-slate-400">
            Webhook URL: <code className="text-cyan-300">/api/v1/webhooks/sepay</code>
          </div>
        </div>
      </div>
    </div>
  );
};
