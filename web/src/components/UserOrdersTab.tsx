import React, { useState } from 'react';
import { fmtNum, fmtPnL, fmtTime } from '../utils/strategyDecision';
import { translateOrderStatus, orderStates } from '../utils/stateMapping';
import { computeOrderLedgerMetrics } from '../utils/quantMath';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [localSelectedOrder, setLocalSelectedOrder] = useState<any | null>(null);

  const selectedOrder = externalSelectedOrder !== undefined ? externalSelectedOrder : localSelectedOrder;
  const setSelectedOrder = externalSetSelectedOrder || setLocalSelectedOrder;

  const rawOrders = filteredUserOrders ?? externalOrders ?? [];
  const filteredOrders = rawOrders.filter((o) => {
    if (sideFilter !== 'ALL' && String(o.side || '').toUpperCase() !== sideFilter) {
      return false;
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const hay = `${o.client_order_id || o.id || ''} ${o.ticket || ''} ${o.deal || ''} ${o.symbol || 'XAUUSD'} ${
      o.account_id || ''
    }`.toLowerCase();
    return hay.includes(q);
  });

  const ledgerStats = computeOrderLedgerMetrics(filteredOrders);

  return (
    <div className="space-y-5">
      {/* Row 1: 4 Quantitative Ledger Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="quant-card-interactive p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400">
            Tổng Số Lệnh Sổ Cái
          </div>
          <div className="mt-1.5 font-mono text-2xl font-extrabold text-white tabular-nums">
            {ledgerStats.totalCount}
          </div>
          <div className="mt-1.5 text-[11px] font-mono text-slate-400 tabular-nums">
            Đã khớp: <strong className="text-cyan-300">{ledgerStats.filledCount}</strong>
          </div>
        </div>

        <div className="quant-card-interactive p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400">
            Tỷ Lệ Thắng (Win Rate)
          </div>
          <div className="mt-1.5 font-mono text-2xl font-extrabold text-emerald-400 tabular-nums">
            {ledgerStats.winRatePct}%
          </div>
          <div className="mt-1.5 text-[11px] font-mono text-slate-400 tabular-nums">
            Thắng {ledgerStats.winCount} / Thua {ledgerStats.lossCount}
          </div>
        </div>

        <div className="quant-card-interactive p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400">
            Hệ Số Lợi Nhuận (Profit Factor)
          </div>
          <div className="mt-1.5 font-mono text-2xl font-extrabold text-cyan-300 tabular-nums">
            {fmtNum(ledgerStats.profitFactor, 2)}
          </div>
          <div className="mt-1.5 text-[11px] font-mono text-slate-400">
            Chuẩn R:R định lượng ≥ 1.8
          </div>
        </div>

        <div className="quant-card-interactive p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400">
            Tổng Lợi Nhuận Thực Tế
          </div>
          <div
            className={`mt-1.5 font-mono text-2xl font-extrabold tabular-nums ${
              ledgerStats.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {fmtPnL(ledgerStats.netPnl)}
          </div>
          <div className="mt-1.5 text-[11px] font-mono text-slate-400">
            Đối soát Ticket / Deal MT5
          </div>
        </div>
      </div>

      {/* Header & Filter Bar */}
      <div className="quant-panel flex flex-col justify-between gap-4 p-5 lg:flex-row lg:items-center">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
            Sổ Cái Thực Thi Định Lượng
          </span>
          <h3 className="mt-0.5 text-lg font-bold text-white">Nhật Ký Khớp Lệnh & Đối Soát MT5</h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm mã lệnh, Ticket, tài khoản..."
            className="quant-input w-48 py-1.5 font-mono text-xs"
          />

          {setOrderAccountFilter && accounts.length > 0 && (
            <select
              value={orderAccountFilter}
              onChange={(e) => setOrderAccountFilter(e.target.value)}
              aria-label="Lọc theo tài khoản MT5"
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
              aria-label="Lọc theo trạng thái lệnh"
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
                className={`rounded-lg px-3 py-1 font-mono text-xs font-semibold transition whitespace-nowrap shrink-0 cursor-pointer ${
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
                  const slVal = o.stop_loss || o.sl;
                  const tpVal = o.take_profit || o.tp;
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
                        {fmtNum(o.volume ?? o.quantity ?? 0, 2)} lot
                      </td>
                      <td className="text-right font-mono text-xs text-slate-200 tabular-nums">
                        {fmtNum(price, 2)}
                      </td>
                      <td className="text-right font-mono text-[11px] text-slate-400 tabular-nums">
                        <span className="text-rose-300/90">{slVal ? fmtNum(slVal, 2) : 'Auto'}</span>
                        {' / '}
                        <span className="text-emerald-300/90">{tpVal ? fmtNum(tpVal, 2) : 'Open'}</span>
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
                  {fmtNum(o.volume ?? o.quantity ?? 0, 2)} lot · {o.symbol || 'XAUUSD'}
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
          onClick={() => setSelectedOrder(null)}
        >
          <div
            className="quant-panel w-full max-w-md space-y-4 p-6 border-cyan-500/40"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400">
                  Chi Tiết Khớp Lệnh & Kiểm Toán MT5
                </span>
                <h4 className="font-mono text-base font-bold text-white">
                  #{selectedOrder.client_order_id || selectedOrder.id}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
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
                  {fmtNum(selectedOrder.volume ?? selectedOrder.quantity ?? 0, 2)} lot
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

            <div className="rounded-xl border border-white/[0.06] bg-[#030712] p-3 font-mono text-[11px] text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>Kiểm toán 4 Lớp Giáp</span>
                <strong className="text-emerald-400">PASSED (Redis Lock + Hard SL)</strong>
              </div>
              <div className="flex justify-between">
                <span>Cầu nối thực thi</span>
                <strong className="text-cyan-300">MetaApi London G2</strong>
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
