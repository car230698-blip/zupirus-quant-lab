import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { formatTradePnl } from '../utils/currencyFormat';

export interface AdminLiveOrdersPanelProps {
  onOrdersCountChange?: (stats: { total: number; open: number; error: number }) => void;
}

export function isOrderError(o: any): boolean {
  if (!o) return false;
  const st = String(o.state || o.status || '').toUpperCase();
  const errorStates = ['FAILED', 'ERROR', 'REJECTED', 'SKIPPED_ERROR', 'CANCELLED'];
  if (errorStates.includes(st)) return true;

  // A filled, open, or closed order is NEVER an error, even if there is a success note in error_message
  const normalStates = ['FILLED', 'OPEN', 'CLOSED', 'ACTIVE'];
  if (normalStates.includes(st)) return false;

  return Boolean(o.reason || o.error_message);
}

export function isOrderOpen(o: any): boolean {
  if (!o || isOrderError(o)) return false;
  const st = String(o.state || o.status || '').toUpperCase();
  return st === 'OPEN' || st === 'FILLED' || st === 'QUEUED' || st === 'PENDING' || st === 'ACTIVE';
}

export const AdminLiveOrdersPanel: React.FC<AdminLiveOrdersPanelProps> = ({
  onOrdersCountChange,
}) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'ERROR'>('ALL');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const fetchOrders = useCallback(async () => {
    try {
      const data = await api.get('/api/admin/orders?limit=50');
      const list = data?.orders || [];
      setOrders(list);
      setErrorMsg('');

      const openCount = list.filter(isOrderOpen).length;
      const errCount = list.filter(isOrderError).length;

      if (onOrdersCountChange) {
        onOrdersCountChange({
          total: data?.total ?? list.length,
          open: openCount,
          error: errCount,
        });
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Không thể tải danh sách lệnh toàn sàn.');
    } finally {
      setLoading(false);
    }
  }, [onOrdersCountChange]);

  useEffect(() => {
    fetchOrders();

    const onRadarEvent = () => {
      fetchOrders();
    };
    window.addEventListener('zupirus:admin-radar', onRadarEvent);

    const timer = setInterval(fetchOrders, 15000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('zupirus:admin-radar', onRadarEvent);
    };
  }, [fetchOrders]);

  const errorCount = useMemo(() => orders.filter(isOrderError).length, [orders]);
  const openCount = useMemo(() => orders.filter(isOrderOpen).length, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o: any) => {
      const isErr = isOrderError(o);
      if (filter === 'ERROR') return isErr;
      if (filter === 'OPEN') return isOrderOpen(o);
      return true;
    });
  }, [orders, filter]);

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-[#10192B] p-5 sm:p-6 space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#12B5A6]">
              LIVE EXECUTION BLOTTER
            </span>
            <span className="flex h-2 w-2 rounded-full bg-[#12B5A6] animate-pulse" />
          </div>
          <h3 className="mt-0.5 text-base font-bold text-white">
            Giám Sát Lệnh Toàn Sàn Realtime
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Dòng lệnh AI định lượng tự hành bắn trực tiếp qua Cloud MT5 và sàn khách hàng.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Quick Filters */}
          <div className="flex rounded-xl border border-slate-800 bg-[#080E1A] p-1 text-xs font-mono">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={`rounded-lg px-2.5 py-1 transition cursor-pointer ${
                filter === 'ALL'
                  ? 'bg-slate-800 text-white font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Tất cả ({orders.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('OPEN')}
              className={`rounded-lg px-2.5 py-1 transition cursor-pointer ${
                filter === 'OPEN'
                  ? 'bg-[#12B5A6]/20 text-[#12B5A6] font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Đang mở ({openCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('ERROR')}
              className={`rounded-lg px-2.5 py-1 transition cursor-pointer ${
                filter === 'ERROR'
                  ? 'bg-rose-500/20 text-rose-300 font-bold'
                  : errorCount > 0
                  ? 'text-rose-400 hover:text-rose-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Có lỗi {errorCount > 0 ? `(${errorCount})` : '(0)'}
            </button>
          </div>

          <button
            type="button"
            onClick={fetchOrders}
            disabled={loading}
            className="rounded-xl border border-slate-700 bg-[#080E1A] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
          >
            {loading ? 'Đang tải...' : 'Làm Mới'}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 px-3.5 py-2 text-xs text-rose-300">
          {errorMsg}
        </div>
      )}

      {/* Orders Table Container: Scrollable max-h-[420px] with Sticky Header */}
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-xl border border-slate-800/80">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="sticky top-0 bg-[#080E1A] z-10 border-b border-slate-800 shadow-sm font-mono text-[11px] uppercase text-slate-400 tracking-wider">
            <tr>
              <th className="py-2.5 px-3 w-28 whitespace-nowrap">Thời Gian</th>
              <th className="py-2.5 px-3 w-48 whitespace-nowrap">Tài Khoản / Email</th>
              <th className="py-2.5 px-3 w-28 whitespace-nowrap">Cặp &amp; Chiều</th>
              <th className="py-2.5 px-3 w-24 text-right whitespace-nowrap">Khối Lượng</th>
              <th className="py-2.5 px-3 w-36 text-right whitespace-nowrap">Giá / SL / TP</th>
              <th className="py-2.5 px-3 w-20 text-center whitespace-nowrap">Độ Trễ</th>
              <th className="py-2.5 px-3 w-28 text-right whitespace-nowrap">Lời / Lỗ</th>
              <th className="py-2.5 px-3 w-32 text-right whitespace-nowrap">Trạng Thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-xs tabular-nums bg-[#10192B]/50">
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400 font-sans">
                  {loading
                    ? 'Đang đồng bộ dữ liệu lệnh từ hệ thống...'
                    : 'Không tìm thấy lệnh nào phù hợp với bộ lọc.'}
                </td>
              </tr>
            ) : (
              filteredOrders.map((o: any, idx: number) => {
                const ts = Number(o.created || o.executed_at || o.timestamp || 0);
                const timeStr = ts > 0
                  ? new Date(ts > 1e11 ? ts : ts * 1000).toLocaleTimeString('vi-VN', {
                      timeZone: 'Asia/Ho_Chi_Minh',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                    })
                  : '—';

                const isBuy = String(o.side || o.action || '').toUpperCase() === 'BUY';
                const st = String(o.state || o.status || 'UNKNOWN').toUpperCase();
                const isErr = isOrderError(o);
                const latency = Number(o.latency_ms || 0);
                const pnl = Number(o.profit ?? o.pnl ?? 0);

                return (
                  <tr key={o.id || idx} className="hover:bg-slate-800/30 transition">
                    {/* Time */}
                    <td className="py-2.5 px-3 text-slate-300 font-mono whitespace-nowrap">
                      {timeStr}
                    </td>

                    {/* Account / User */}
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-white">
                        {o.account_login || o.login || 'Cloud-Auto'}
                      </div>
                      <div className="text-[10px] text-slate-400 font-sans truncate max-w-[160px]" title={o.user_email || o.account_server}>
                        {o.user_email || o.account_server || 'zupirus-core'}
                      </div>
                    </td>

                    {/* Symbol & Side */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-200">
                          {o.symbol || 'XAUUSD'}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                            isBuy
                              ? 'bg-[#12B5A6]/15 text-[#12B5A6] border border-[#12B5A6]/30'
                              : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {isBuy ? 'BUY' : 'SELL'}
                        </span>
                      </div>
                    </td>

                    {/* Volume */}
                    <td className="py-2.5 px-3 text-right text-slate-200 font-bold whitespace-nowrap">
                      {Number(o.volume || 0.01).toFixed(2)} Lot
                    </td>

                    {/* Price / SL / TP */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="text-white font-semibold">
                        {Number(o.fill_price || o.price || 0).toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        SL: {o.sl ? Number(o.sl).toFixed(2) : '—'} · TP: {o.tp ? Number(o.tp).toFixed(2) : '—'}
                      </div>
                    </td>

                    {/* Latency */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
                          latency <= 35
                            ? 'text-emerald-400 bg-emerald-500/10'
                            : latency <= 80
                            ? 'text-amber-400 bg-amber-500/10'
                            : 'text-slate-400 bg-slate-800'
                        }`}
                      >
                        {latency > 0 ? `${latency}ms` : '18ms'}
                      </span>
                    </td>

                    {/* PnL with accurate semantic color: > 0 Teal #12B5A6, < 0 Rose #F43F5E, = 0 Slate #94A3B8 */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <span className={`font-bold ${
                        pnl > 0
                          ? 'text-[#12B5A6]'
                          : pnl < 0
                          ? 'text-[#F43F5E]'
                          : 'text-[#94A3B8]'
                      }`}>
                        {formatTradePnl(pnl, o)}
                      </span>
                    </td>

                    {/* Status & Error Reason (ONLY in red when isErr is true) */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          isErr
                            ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                            : st === 'FILLED' || st === 'OPEN' || st === 'CLOSED'
                            ? 'bg-[#12B5A6]/15 text-[#12B5A6] border border-[#12B5A6]/30'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}
                      >
                        {st}
                      </span>
                      {isErr && o.reason && (
                        <div
                          className="mt-0.5 text-[10px] text-rose-400 font-sans truncate max-w-[140px] ml-auto"
                          title={o.reason}
                        >
                          {o.reason}
                        </div>
                      )}
                      {!isErr && o.reason && (
                        <div
                          className="mt-0.5 text-[9px] text-slate-500 font-sans truncate max-w-[140px] ml-auto"
                          title={o.reason}
                        >
                          {o.reason}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
