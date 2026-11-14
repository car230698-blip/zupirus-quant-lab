import { useEffect } from 'react';
import { StatusLabel } from '../shared/UiPrimitives.tsx';

export function UserDemoPairingCard() {
  useEffect(() => {
    // Earlier builds put an EA credential and placeholder balances in browser storage.
    try {
      window.localStorage.removeItem('zupirus_demo_account');
    } catch {
      // The page can still render when browser storage is unavailable.
    }
  }, []);

  return (
    <section className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-800 bg-[#0c1322] p-5 sm:p-6">
      <div className="min-w-0 space-y-1">
        <h2 className="text-base font-semibold text-slate-100">Kết nối MT5 demo</h2>
        <p className="text-sm text-slate-400">
          Quản trị viên cấp mã liên kết để nhập trong EA Copy trên MT5 demo.
          Bảng bên dưới hiển thị kết quả mô phỏng của Quant Lab.
        </p>
      </div>
      <StatusLabel label="Chờ tích hợp EA Copy" tone="amber" />
    </section>
  );
}
