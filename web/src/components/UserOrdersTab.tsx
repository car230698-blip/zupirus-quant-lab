import React from 'react';
import { mapBackendState } from '../utils/stateMapping.ts';

interface UserOrdersTabProps {
  accounts: any[];
  orders: any[];
  filteredUserOrders: any[];
  orderAccountFilter: string;
  setOrderAccountFilter: (v: string) => void;
  orderStateFilter: string;
  setOrderStateFilter: (v: string) => void;
}

export const UserOrdersTab: React.FC<UserOrdersTabProps> = ({
  accounts,
  orders,
  filteredUserOrders,
  orderAccountFilter,
  setOrderAccountFilter,
  orderStateFilter,
  setOrderStateFilter,
}) => {
  return (
    <div className="space-y-6">
      <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] overflow-hidden">
        <div className="border-b border-slate-800 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <span className="font-bold text-sm text-slate-200">Nhật Ký Tín Hiệu & Đối Soát Lệnh Thực Thi</span>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter by account */}
            <select
              aria-label="Lọc theo tài khoản"
              value={orderAccountFilter}
              onChange={(e) => setOrderAccountFilter(e.target.value)}
              className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-slate-200 font-mono"
            >
              <option value="all">Tất cả tài khoản</option>
              {accounts.map((a: any) => (
                <option key={a.id} value={a.id}>
                  #{a.login} · {a.server}
                </option>
              ))}
            </select>

            {/* Filter by state */}
            <select
              aria-label="Lọc theo trạng thái"
              value={orderStateFilter}
              onChange={(e) => setOrderStateFilter(e.target.value)}
              className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-slate-200 font-mono"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="queued">Đang chờ (queued)</option>
              <option value="filled">Đã khớp (filled)</option>
              <option value="rejected">Bị từ chối (rejected)</option>
              <option value="cancelled">Đã hủy (cancelled)</option>
              <option value="expired">Hết hạn (expired)</option>
              <option value="intent">Chưa đối soát (intent)</option>
            </select>

            <span className="text-xs font-mono text-slate-400 ml-1">{filteredUserOrders.length} lệnh</span>
          </div>
        </div>

        {filteredUserOrders.length === 0 ? (
          <div className="p-8 text-center text-slate-500 font-mono text-xs">
            {orders.length === 0
              ? 'Chưa có lệnh nào được tạo. Khi Quant Engine phát tín hiệu hoặc EA khớp lệnh, bản ghi sẽ xuất hiện tại đây.'
              : 'Không có lệnh nào khớp với bộ lọc hiện tại.'}
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950/60 border-b border-slate-800 text-[11px] text-slate-400">
                  <tr>
                    <th className="p-3">ID / TÍN HIỆU</th>
                    <th className="p-3">TÀI KHOẢN</th>
                    <th className="p-3">CHIỀU</th>
                    <th className="p-3">GIÁ TÍN HIỆU</th>
                    <th className="p-3">GIÁ KHỚP</th>
                    <th className="p-3">SL / TP</th>
                    <th className="p-3">TICKET / DEAL</th>
                    <th className="p-3">TRẠNG THÁI</th>
                    <th className="p-3">LÝ DO TỪ BACKEND</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredUserOrders.map((o: any) => {
                    const stateInfo = mapBackendState(o.state);
                    const signalPriceStr = o.price != null ? `$${Number(o.price).toFixed(2)}` : '—';
                    const fillPriceStr = o.fill_price != null ? `$${Number(o.fill_price).toFixed(2)}` : '—';
                    const slStr = o.sl != null ? `$${Number(o.sl).toFixed(1)}` : '—';
                    const tpStr = o.tp != null ? `$${Number(o.tp).toFixed(1)}` : '—';
                    const reasonStr = o.reason || 'Chưa ghi nhận';

                    return (
                      <tr key={o.id} className="hover:bg-slate-900/40">
                        <td className="p-3 font-bold text-slate-300">
                          #{o.id}
                          <span className="block text-[10px] font-normal text-slate-500">Sig: {o.signal_id || '—'}</span>
                        </td>
                        <td className="p-3 text-slate-300">#{o.login || o.account_id?.slice(0, 8)}</td>
                        <td className="p-3">
                          <span className={o.side === 'BUY' ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                            {o.side}
                          </span>
                        </td>
                        <td className="p-3 text-slate-200">{signalPriceStr}</td>
                        <td className="p-3 text-cyan-300 font-semibold">{fillPriceStr}</td>
                        <td className="p-3 text-slate-400">
                          {slStr} / {tpStr}
                        </td>
                        <td className="p-3 text-slate-300">{o.ticket ? `${o.ticket}${o.deal ? ` / ${o.deal}` : ''}` : '—'}</td>
                        <td className="p-3">
                          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${stateInfo.badge}`}>
                            {stateInfo.label}
                          </span>
                        </td>
                        <td className="p-3 text-slate-400 max-w-xs truncate" title={reasonStr}>
                          {reasonStr}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View with Expandable Details */}
            <div className="md:hidden divide-y divide-slate-800/80">
              {filteredUserOrders.map((o: any) => {
                const stateInfo = mapBackendState(o.state);
                const signalPriceStr = o.price != null ? `$${Number(o.price).toFixed(2)}` : '—';
                const fillPriceStr = o.fill_price != null ? `$${Number(o.fill_price).toFixed(2)}` : '—';
                const slStr = o.sl != null ? `$${Number(o.sl).toFixed(1)}` : '—';
                const tpStr = o.tp != null ? `$${Number(o.tp).toFixed(1)}` : '—';
                const reasonStr = o.reason || 'Chưa ghi nhận';

                return (
                  <div key={o.id} className="p-4 space-y-2 font-mono text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-200">#{o.id}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            o.side === 'BUY' ? 'text-emerald-400 bg-emerald-950/60' : 'text-amber-400 bg-amber-950/60'
                          }`}
                        >
                          {o.side}
                        </span>
                      </div>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${stateInfo.badge}`}>
                        {stateInfo.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-slate-300">
                      <div>
                        <span className="text-[10px] text-slate-500 block">GIÁ TÍN HIỆU</span>
                        <span>{signalPriceStr}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">GIÁ KHỚP</span>
                        <span className="text-cyan-300 font-semibold">{fillPriceStr}</span>
                      </div>
                    </div>

                    {/* Expandable Technical Details */}
                    <details className="mt-2 text-[11px] text-slate-400 bg-slate-950/40 rounded-lg p-2 border border-slate-800/60">
                      <summary className="cursor-pointer text-cyan-400 hover:text-cyan-300 font-medium select-none">
                        Thông số kỹ thuật lệnh ▾
                      </summary>
                      <div className="mt-2 space-y-1.5 pt-2 border-t border-slate-800/80">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Tài khoản:</span>
                          <span className="text-slate-200">
                            #{o.login || o.account_id?.slice(0, 8)} ({o.server || 'DEMO'})
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Tín hiệu ID:</span>
                          <span className="text-slate-300">{o.signal_id || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Cắt lỗ (SL) / Chốt lời (TP):</span>
                          <span className="text-slate-300">
                            {slStr} / {tpStr}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">MT5 Ticket / Deal:</span>
                          <span className="text-slate-300">{o.ticket ? `${o.ticket}${o.deal ? ` / ${o.deal}` : ''}` : '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Nguồn phát:</span>
                          <span className="text-cyan-300">{o.source || 'Engine'}</span>
                        </div>
                        <div className="flex flex-col gap-0.5 pt-1">
                          <span className="text-slate-500">Lý do từ Backend:</span>
                          <span className="text-amber-200/90 break-words">{reasonStr}</span>
                        </div>
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
