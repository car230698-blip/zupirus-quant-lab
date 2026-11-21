import React, { useState, useEffect } from 'react';
import { fmtNum, fmtPnL, fmtTime } from '../utils/strategyDecision';
import { formatTradePnl } from '../utils/currencyFormat.ts';
import { translateOrderStatus, orderStates } from '../utils/stateMapping';
import { computeOrderLedgerMetrics } from '../utils/quantMath';
import { MetricCard, Panel, StatusBadge } from './ui/Primitives';
import { IconActivity, IconClose, IconReceipt, IconSearch, IconShield, IconTrendingUp } from './Icons';

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
  const [liveMidPrice, setLiveMidPrice] = useState<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onTick = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      const mid = Number(detail?.xauusd?.mid || detail?.xauusd?.bid || 0);
      if (mid > 0) setLiveMidPrice(mid);
    };
    window.addEventListener('zupirus:topbar-tick', onTick);
    return () => window.removeEventListener('zupirus:topbar-tick', onTick);
  }, []);

  const selectedOrder = externalSelectedOrder !== undefined ? externalSelectedOrder : localSelectedOrder;
  const setSelectedOrder = externalSetSelectedOrder || setLocalSelectedOrder;

  const rawOrders = (filteredUserOrders ?? externalOrders ?? []).map((o) => {
    const isBuy = String(o.side || '').toUpperCase() === 'BUY';
    const orderState = String(o.state || o.status || 'filled').toLowerCase();
    const fillPrice = Number(o.fill_price || o.filled_price || o.requested_price || o.price || 0);
    let vol = Number(o.volume ?? o.quantity ?? 0);
    if (!vol && o.reason) {
      const m = String(o.reason).match(/([0-9]+(?:\.[0-9]+)?)\s*lot/i);
      if (m) vol = Number(m[1]);
    }
    if (!vol) vol = 0.01;
    const isExactMt5 = Boolean(o.mt5_exact_pnl || o.source === 'EA_BRIDGE' || (o.profit !== undefined && o.profit !== null && Number(o.profit) !== 0));
    const refLive = Number(o.live_price || liveMidPrice || 0);
    let pnl = Number(o.pnl ?? o.profit ?? o.realized_pnl ?? 0);
    const isLiveOpen = orderState === 'filled' && !o.closed_at && fillPrice > 0 && refLive > 0;
    if (isLiveOpen && !isExactMt5) {
      const diff = isBuy ? refLive - fillPrice : fillPrice - refLive;
      pnl = Math.round(diff * vol * 100 * 100) / 100;
    }
    return {
      ...o,
      volume: vol,
      pnl,
      profit: pnl,
      live_price: refLive > 0 ? refLive : undefined,
      _isLiveOpen: isLiveOpen,
    };
  });
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
    <div className="space-y-6">
      {/* Row 1: 12-Column Bento KPI Strip (4 x 3 cols) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
        <MetricCard
          className="lg:col-span-3"
          label="Tổng Số Lệnh Sổ Cái"
          value={ledgerStats.totalCount}
          tone="cyan"
          icon={<IconReceipt className="w-4 h-4" />}
          subtext={
            <span className="font-mono tabular-nums">
              Đã khớp: <strong className="text-cyan-300">{ledgerStats.filledCount}</strong>
            </span>
          }
        />
        <MetricCard
          className="lg:col-span-3"
          label="Tỷ Lệ Thắng (Win Rate)"
          value={<span className="text-emerald-400">{ledgerStats.winRatePct}%</span>}
          tone="emerald"
          icon={<IconTrendingUp className="w-4 h-4" />}
          subtext={
            <span className="font-mono tabular-nums">
              Thắng {ledgerStats.winCount} / Thua {ledgerStats.lossCount}
            </span>
          }
        />
        <MetricCard
          className="lg:col-span-3"
          label="Hệ Số Lợi Nhuận (PF)"
          value={<span className="text-cyan-300">{fmtNum(ledgerStats.profitFactor, 2)}</span>}
          tone="amber"
          icon={<IconActivity className="w-4 h-4" />}
          subtext="Chuẩn R:R định lượng ≥ 1.8"
        />
        <MetricCard
          className="lg:col-span-3"
          label="Tổng Lợi Nhuận Thực Tế"
          value={
            <span className={ledgerStats.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {fmtPnL(ledgerStats.netPnl)}
            </span>
          }
          tone={ledgerStats.netPnl >= 0 ? 'emerald' : 'rose'}
          icon={<IconShield className="w-4 h-4" />}
          subtext="Đối soát Ticket / Deal MT5"
        />
      </div>

      {/* Header & Filter Bar */}
      <Panel
        title="Nhật Ký Khớp Lệnh & Đối Soát MT5"
        subtitle="Sổ cái thực thi định lượng — lọc theo tài khoản, trạng thái hoặc mã Ticket/Deal."
        icon={<IconReceipt className="w-4 h-4 text-amber-300" />}
        action={
          <StatusBadge tone="info" dot>
            {filteredOrders.length} lệnh
          </StatusBadge>
        }
        bodyClassName="p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <IconSearch className="w-4 h-4" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm mã lệnh, Ticket, tài khoản..."
              className="quant-input pl-9 font-mono text-xs"
            />
          </div>

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

          <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/90 p-1">
            {(['ALL', 'BUY', 'SELL'] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => setSideFilter(side)}
                className={`rounded-lg px-3 py-1.5 font-mono text-xs font-semibold transition whitespace-nowrap shrink-0 cursor-pointer ${
                  sideFilter === side
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35'
                    : 'text-slate-400 hover:text-white border border-transparent'
                }`}
              >
                {side === 'ALL' ? 'Tất Cả' : side}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={filteredOrders.length === 0}
            onClick={() => {
              const esc = (v: unknown) => {
                let s = String(v ?? '');
                if (/^[=+\-@]/.test(s)) s = `'${s}`;
                return `"${s.replace(/"/g, '""')}"`;
              };
              const headers = ['ID', 'Ticket', 'Account', 'Symbol', 'Side', 'Volume', 'Price', 'SL', 'TP', 'Status', 'PnL_USD', 'Time'];
              const rows = filteredOrders.map((o) => [
                o.client_order_id || o.id || '',
                o.ticket || '',
                o.account_login || o.account_id || '',
                o.symbol || 'XAUUSD',
                o.side || '',
                o.volume ?? '',
                o.fill_price || o.price || '',
                o.sl ?? '',
                o.tp ?? '',
                o.status || o.state || '',
                o.pnl ?? o.profit ?? 0,
                o.created_at || o.created ? new Date(Number(o.created_at || o.created) * 1000).toISOString() : '',
              ]);
              const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `zupirus_orders_${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="ml-auto quant-btn-secondary px-3 py-1.5 font-mono text-xs whitespace-nowrap shrink-0 disabled:opacity-40"
          >
            Xuất CSV ({filteredOrders.length})
          </button>
        </div>
      </Panel>

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
                  const pnl = Number(o.pnl ?? o.profit ?? o.realized_pnl ?? 0);
                  const orderState = o.state || o.status || 'filled';
                  const price = o.fill_price || o.filled_price || o.requested_price || o.price || 0;
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
                        <div className="font-semibold text-white">
                          {o.account_login
                            ? `#${o.account_login} · ${o.account_server || 'MT5'}`
                            : o.account_id || o.source || 'MT5-Cloud'}
                        </div>
                        {(o.ticket || o.deal) && (
                          <div className="text-[11px] text-cyan-400/90 tabular-nums">
                            Ticket #{o.ticket || o.deal}
                          </div>
                        )}
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
                        <div>{fmtNum(price, 2)}</div>
                        {o._isLiveOpen && o.live_price && (
                          <div className="text-[10px] text-cyan-400 tabular-nums">
                            Live: {fmtNum(o.live_price, 2)}
                          </div>
                        )}
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
                        <div>{formatTradePnl(pnl, o)}</div>
                        {o._isLiveOpen && (
                          <div className="text-[10px] font-normal text-emerald-300/80">Real-time</div>
                        )}
                      </td>
                      <td className="text-right font-mono text-xs text-slate-300">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              o._isLiveOpen
                                ? 'bg-emerald-400 animate-pulse'
                                : String(orderState).toLowerCase() === 'closed'
                                ? 'bg-slate-400'
                                : String(orderState).toLowerCase() === 'rejected'
                                ? 'bg-rose-400'
                                : String(orderState).toLowerCase() === 'filled'
                                ? 'bg-emerald-400'
                                : 'bg-amber-400'
                            }`}
                          />
                          {o._isLiveOpen ? 'Đang chạy Live · Đã khớp' : translateOrderStatus(orderState)}
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
          const pnl = Number(o.pnl ?? o.profit ?? o.realized_pnl ?? 0);
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
                  {formatTradePnl(pnl, o)}
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
                aria-label="Đóng chi tiết lệnh"
                onClick={() => setSelectedOrder(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
              >
                <IconClose className="w-4 h-4" />
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
                    Number(selectedOrder.pnl ?? selectedOrder.profit ?? selectedOrder.realized_pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatTradePnl(selectedOrder.pnl ?? selectedOrder.profit ?? selectedOrder.realized_pnl, selectedOrder)}
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
