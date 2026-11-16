import React, { useState } from 'react';
import { fmtNum, fmtPnL, fmtTime } from '../utils/strategyDecision';
import { translateOrderStatus, orderStates } from '../utils/stateMapping';

export interface UserOrdersTabProps {
  accounts?: any[];
  orders?: any[];
  filteredUserOrders?: any[];
  status?: 'loading' | 'ready' | 'offline' | string;
  orderAccountFilter?: string;
  setOrderAccountFilter?: React.Dispatch<React.SetStateAction<string>>;
  orderStateFilter?: string;
  setOrderStateFilter?: React.Dispatch<React.SetStateAction<string>>;
  selectedOrder?: any | null;
  setSelectedOrder?: (o: any | null) => void;
}

export const UserOrdersTab: React.FC<UserOrdersTabProps> = ({
  accounts = [],
  orders: externalOrders,
  filteredUserOrders,
  status,
  orderAccountFilter = 'all',
  setOrderAccountFilter,
  orderStateFilter = 'all',
  setOrderStateFilter,
  selectedOrder: externalSelectedOrder,
  setSelectedOrder: externalSetSelectedOrder,
}) => {
  const [sideFilter, setSideFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [localSelectedOrder, setLocalSelectedOrder] = useState<any | null>(null);

  const selectedOrder = externalSelectedOrder !== undefined ? externalSelectedOrder : localSelectedOrder;
  const setSelectedOrder = externalSetSelectedOrder || setLocalSelectedOrder;

  const rawOrders = filteredUserOrders ?? externalOrders ?? [];
  const filteredOrders = rawOrders.filter((o) => {
    if (sideFilter === 'ALL') return true;
    return String(o.side || '').toUpperCase() === sideFilter;
  });

  const totalPnl = filteredOrders.reduce((acc, o) => acc + Number(o.pnl || 0), 0);
  const winCount = filteredOrders.filter((o) => Number(o.pnl || 0) > 0).length;

  return (
    <div className="space-y-5">
      {/* Header & Filter Bar */}
      <div className="quant-panel flex flex-col justify-between gap-4 p-5 lg:flex-row lg:items-center">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
            Sổ Cái Thực Thi Định Lượng
          </span>
          <h3 className="mt-0.5 text-lg font-bold text-white">Nhật Ký Khớp Lệnh & Đối Soát MT5</h3>
          <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-xs text-slate-400 tabular-nums">
            <span>Tổng lệnh: <strong className="text-white">{filteredOrders.length}</strong></span>
            <span>·</span>
            <span>Lệnh thắng: <strong className="text-emerald-300">{winCount}</strong></span>
            <span>·</span>
            <span>
              Tổng PnL:{' '}
              <strong className={totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtPnL(totalPnl)}
              </strong>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {setOrderAccountFilter && accounts.length > 0 && (
            <select
              value={orderAccountFilter}
              onChange={(e) => setOrderAccountFilter(e.target.value)}
              className="quant-input w-auto py-1.5 font-mono text-xs"
            >
              <option value="all">Tất cả tài khoản MT5</option>
              {accounts.map((a: any) => {
                const id = a.id || a.account_id || a.login;
                return (
                  <option key={id} value={id}>
                    #{a.login || id} ({a.server || a.broker_server || 'MT5'})
                  </option>
                );
              })}
            </select>
          )}

          {setOrderStateFilter && (
            <select
              value={orderStateFilter}
              onChange={(e) => setOrderStateFilter(e.target.value)}
              className="quant-input w-auto py-1.5 font-mono text-xs"
            >
              <option value="all">Mọi trạng thái</option>
              {orderStates.map((st) => (
                <option key={st} value={st}>
                  {translateOrderStatus(st)}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-[#040710] p-1">
            {(['ALL', 'BUY', 'SELL'] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => setSideFilter(side)}
                className={`rounded-lg px-3 py-1 font-mono text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                  sideFilter === side
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {side === 'ALL' ? 'Tất Cả' : side}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Desktop High-Density Tabular Ledger */}
      <div className="quant-panel hidden md:block overflow-hidden">
        <div className="overflow-x-auto">
          <table className="quant-table">
            <thead>
              <tr>
                <th>Mã Lệnh / Thời Gian</th>
                <th>Tài Khoản / Nguồn</th>
                <th>Chiều / Cặp</th>
                <th className="text-right">Khối Lượng</th>
                <th className="text-right">Giá Khớp</th>
                <th className="text-right">SL / TP</th>
                <th className="text-right">PnL Thực Tế</th>
                <th className="text-right">Trạng Thái</th>
              </tr>
            </thead>
            <tbody>
              {status === 'loading' ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-slate-400">
                    Đang tải sổ cái lệnh MT5...
                  </td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-slate-400">
                    Chưa có bản ghi lệnh nào trong bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o, idx) => {
                  const orderId = o.client_order_id || o.id || `ORD-${idx}`;
                  const isBuy = String(o.side || '').toUpperCase() === 'BUY';
                  const pnl = Number(o.pnl || 0);
                  const orderState = o.status || o.state || 'filled';
                  const price = o.filled_price || o.requested_price || o.price || 0;
                  return (
                    <tr
                      key={orderId}
                      onClick={() => setSelectedOrder(o)}
                      className="cursor-pointer"
                    >
                      <td>
                        <div className="font-mono text-xs font-semibold text-white">#{orderId}</div>
                        <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {fmtTime(o.created_at || o.created)}
                        </div>
                      </td>
                      <td className="font-mono text-xs text-slate-300">
                        {o.account_id || o.source || 'MT5-Cloud'}
                      </td>
                      <td>
                        <div className="flex items-center gap-2 font-mono text-xs">
                          <span className={`font-bold ${isBuy ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {o.side}
                          </span>
                          <span className="text-slate-500">·</span>
                          <span className="text-slate-200">{o.symbol || 'XAUUSD'}</span>
                        </div>
                      </td>
                      <td className="text-right font-mono text-xs font-bold text-cyan-300 tabular-nums">
                        {fmtNum(o.quantity || o.volume || 0.1, 2)} lot
                      </td>
                      <td className="text-right font-mono text-xs text-slate-200 tabular-nums">
                        {fmtNum(price, 2)}
                      </td>
                      <td className="text-right font-mono text-[11px] text-slate-400 tabular-nums">
                        <span className="text-rose-300/90">{o.stop_loss ? fmtNum(o.stop_loss, 2) : 'Auto'}</span>
                        {' / '}
                        <span className="text-emerald-300/90">{o.take_profit ? fmtNum(o.take_profit, 2) : 'Open'}</span>
                      </td>
                      <td
                        className={`text-right font-mono text-xs font-bold tabular-nums ${
                          pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {fmtPnL(pnl)}
                      </td>
                      <td className="text-right font-mono text-xs text-slate-300">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              String(orderState).toLowerCase() === 'filled' ? 'bg-emerald-400' : 'bg-amber-400'
                            }`}
                          />
                          {translateOrderStatus(orderState)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Cards */}
      <div className="space-y-3 md:hidden">
        {filteredOrders.map((o, idx) => {
          const orderId = o.client_order_id || o.id || `ORD-${idx}`;
          const isBuy = String(o.side || '').toUpperCase() === 'BUY';
          const pnl = Number(o.pnl || 0);
          const orderState = o.status || o.state || 'filled';
          const price = o.filled_price || o.requested_price || o.price || 0;
          return (
            <button
              key={orderId}
              type="button"
              onClick={() => setSelectedOrder(o)}
              className="quant-panel w-full p-4 text-left"
            >
              <div className="flex items-center justify-between">
                <div className="font-mono text-xs font-bold text-white">
                  <span className={isBuy ? 'text-emerald-400' : 'text-rose-400'}>{o.side}</span> ·{' '}
                  {fmtNum(o.quantity || o.volume || 0.1, 2)} lot · {o.symbol || 'XAUUSD'}
                </div>
                <div
                  className={`font-mono text-sm font-bold tabular-nums ${
                    pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {fmtPnL(pnl)}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-slate-400 tabular-nums">
                <span>Giá: {fmtNum(price, 2)}</span>
                <span>{translateOrderStatus(orderState)}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Order Inspector Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="quant-panel w-full max-w-md space-y-4 p-6 border-cyan-500/40">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400">
                  Chi Tiết Khớp Lệnh MT5
                </span>
                <h4 className="font-mono text-base font-bold text-white">
                  #{selectedOrder.client_order_id || selectedOrder.id}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/[0.07] bg-[#040710] p-4 font-mono text-xs tabular-nums">
              <div>
                <div className="text-[10px] text-slate-500">CHIỀU / SYMBOL</div>
                <div className="mt-0.5 font-bold text-white">
                  {selectedOrder.side} · {selectedOrder.symbol || 'XAUUSD'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">KHỐI LƯỢNG</div>
                <div className="mt-0.5 font-bold text-cyan-300">
                  {fmtNum(selectedOrder.quantity || selectedOrder.volume || 0.1, 2)} lot
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">GIÁ KHỚP</div>
                <div className="mt-0.5 font-bold text-white">
                  {fmtNum(
                    selectedOrder.filled_price || selectedOrder.requested_price || selectedOrder.price,
                    2
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">LỢI NHUẬN (PNL)</div>
                <div
                  className={`mt-0.5 font-bold ${
                    Number(selectedOrder.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {fmtPnL(selectedOrder.pnl)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">TICKET / DEAL</div>
                <div className="mt-0.5 text-slate-300">{selectedOrder.ticket || selectedOrder.deal || 'Auto'}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">TRẠNG THÁI</div>
                <div className="mt-0.5 text-emerald-300">
                  {translateOrderStatus(selectedOrder.status || selectedOrder.state)}
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="quant-btn-secondary px-4 py-2 text-xs"
              >
                Đóng Chi Tiết
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
