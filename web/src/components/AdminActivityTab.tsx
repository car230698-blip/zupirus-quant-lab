import React from 'react';
import { activityStates, mapBackendState, orderStates } from '../utils/stateMapping.ts';

interface AdminActivityTabProps {
  adminViewMode: 'orders' | 'activity';
  setAdminViewMode: (v: 'orders' | 'activity') => void;
  adminOrdersTotal: number;
  filteredActivities: any[];
  adminAccountFilter: string;
  setAdminAccountFilter: (v: string) => void;
  adminOrderPage: number;
  setAdminOrderPage: (updater: number | ((p: number) => number)) => void;
  activityStatusFilter: string;
  setActivityStatusFilter: (v: any) => void;
  activityTeamFilter: string;
  setActivityTeamFilter: (v: any) => void;
  activitySearchQuery: string;
  setActivitySearchQuery: (v: string) => void;
  accounts: any[];
  ordersStatus: string;
  adminOrderState: string;
  setAdminOrderState: (state: string) => void;
  adminOrderSource: string;
  setAdminOrderSource: (source: string) => void;
  adminOrderSearch: string;
  setAdminOrderSearch: (query: string) => void;
  adminOrders: any[];
}

export const AdminActivityTab: React.FC<AdminActivityTabProps> = ({
  adminViewMode,
  setAdminViewMode,
  adminOrdersTotal,
  filteredActivities,
  adminAccountFilter,
  setAdminAccountFilter,
  adminOrderPage,
  setAdminOrderPage,
  activityStatusFilter,
  setActivityStatusFilter,
  activityTeamFilter,
  setActivityTeamFilter,
  activitySearchQuery,
  setActivitySearchQuery,
  accounts,
  adminOrders, ordersStatus, adminOrderState, setAdminOrderState,
  adminOrderSource, setAdminOrderSource, adminOrderSearch, setAdminOrderSearch,
}) => {
  return (
    <div className="space-y-4">
      <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-bold text-sm text-slate-200">Nhật ký vận hành</h3>
            <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-xs font-mono">
              <button
                aria-pressed={adminViewMode === 'orders'}
                onClick={() => setAdminViewMode('orders')}
                className={`px-2.5 py-1 rounded ${
                  adminViewMode === 'orders' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Lệnh toàn hệ thống
              </button>
              <button
                aria-pressed={adminViewMode === 'activity'}
                onClick={() => setAdminViewMode('activity')}
                className={`px-2.5 py-1 rounded ${
                  adminViewMode === 'activity' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Sự kiện và tác vụ
              </button>
            </div>
          </div>

          {/* Filter controls */}
          <div className="flex flex-wrap items-center gap-2">
            {adminViewMode === 'orders' ? (
              <>
                <select
                  aria-label="Lọc theo tài khoản admin"
                  value={adminAccountFilter}
                  onChange={(e) => {
                    setAdminAccountFilter(e.target.value);
                    setAdminOrderPage(0);
                  }}
                  className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-slate-200 font-mono"
                >
                  <option value="all">Tất cả tài khoản</option>
                  {accounts.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      #{a.login} · {a.server}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Lọc nguồn lệnh"
                  value={adminOrderSource}
                  onChange={(event) => { setAdminOrderSource(event.target.value); setAdminOrderPage(0); }}
                  className="quant-filter"
                >
                  <option value="all">Tất cả nguồn</option>
                  <option value="execution">MT5</option>
                  <option value="replay">Phát lại</option>
                </select>
                <select
                  aria-label="Lọc theo trạng thái lệnh"
                  value={adminOrderState}
                  onChange={(event) => { setAdminOrderState(event.target.value); setAdminOrderPage(0); }}
                  className="quant-filter"
                >
                  <option value="all">Tất cả trạng thái</option>
                  {orderStates.map((state) => <option key={state} value={state}>{mapBackendState(state).label}</option>)}
                </select>
              </>
            ) : (
              <>
                <select
                  aria-label="Lọc theo đội phụ trách"
                  value={activityTeamFilter}
                  onChange={(e: any) => setActivityTeamFilter(e.target.value)}
                  className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-slate-200 font-mono"
                >
                  <option value="all">Tất cả đội</option>
                  <option value="execution">Đội Thực Thi (Execution)</option>
                  <option value="research">Đội Nghiên Cứu (Research)</option>
                  <option value="security">Bảo Mật & Rủi Ro (Security)</option>
                </select>

                <select
                  aria-label="Lọc trạng thái hoạt động"
                  value={activityStatusFilter}
                  onChange={(e: any) => setActivityStatusFilter(e.target.value)}
                  className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-slate-200 font-mono"
                >
                  <option value="all">Tất cả trạng thái</option>
                  {activityStates.map((state) => <option key={state} value={state}>{mapBackendState(state).label}</option>)}
                </select>
              </>
            )}

            <input
              type="text"
              aria-label={adminViewMode === 'orders' ? 'Tìm lệnh' : 'Tìm sự kiện'}
              value={adminViewMode === 'orders' ? adminOrderSearch : activitySearchQuery}
              onChange={(event) => {
                if (adminViewMode === 'orders') {
                  setAdminOrderSearch(event.target.value);
                  setAdminOrderPage(0);
                } else {
                  setActivitySearchQuery(event.target.value);
                }
              }}
              placeholder={adminViewMode === 'orders' ? 'Mã tín hiệu, tài khoản, ticket…' : 'Mã tác vụ hoặc nội dung…'}
              className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-1 text-xs text-slate-200 font-mono placeholder-slate-500"
            />
          </div>
        </div>

        {adminViewMode === 'orders' && ordersStatus !== 'ready' && (
          <div className={ordersStatus === 'offline' ? 'quant-alert' : 'quant-status'} role="status">
            {ordersStatus === 'offline' ? 'Không thể cập nhật lệnh.' : 'Đang tải lệnh…'}
          </div>
        )}
        {/* VIEW 1: All System Orders (/api/admin/orders) */}
        {adminViewMode === 'orders' ? (
          adminOrders.length === 0 ? (
            ordersStatus === 'ready' && <div className="p-8 text-center text-slate-500 font-mono text-xs">
              Không tìm thấy lệnh nào phù hợp với bộ lọc quản trị.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="quant-data-table w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950/60 border-b border-slate-800 text-[11px] text-slate-400">
                    <tr>
                      <th className="p-3">ID / TÍN HIỆU</th>
                      <th className="p-3">TÀI KHOẢN</th>
                      <th className="p-3">NGƯỜI DÙNG</th>
                      <th className="p-3">CHIỀU</th>
                      <th className="p-3">GIÁ TÍN HIỆU</th>
                      <th className="p-3">GIÁ KHỚP</th>
                      <th className="p-3">SL / TP</th>
                      <th className="p-3">TICKET / DEAL</th>
                      <th className="p-3">TRẠNG THÁI</th>
                      <th className="p-3">LÝ DO BACKEND</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {adminOrders.map((o: any) => {
                      const stateInfo = mapBackendState(o.state);
                      const signalPriceStr = o.price != null ? `$${Number(o.price).toFixed(2)}` : '—';
                      const fillPriceStr = o.fill_price != null ? `$${Number(o.fill_price).toFixed(2)}` : '—';
                      const slStr = o.sl != null ? `$${Number(o.sl).toFixed(2)}` : '—';
                      const tpStr = o.tp != null ? `$${Number(o.tp).toFixed(2)}` : '—';
                      const reasonStr = o.reason || 'Chưa ghi nhận';

                      return (
                        <tr key={o.id} className="hover:bg-slate-900/40">
                          <td data-label="Mã lệnh" className="p-3 font-bold text-slate-300">
                            #{o.id}
                            <span className="block text-[10px] font-normal text-slate-500">Sig: {o.signal_id || '—'}</span>
                          </td>
                          <td data-label="Tài khoản" className="p-3 text-slate-300">
                            #{o.account_login || o.account_id?.slice(0, 8)}
                            <span className="block text-[10px] text-slate-500">{o.account_server || '—'}</span>
                          </td>
                          <td data-label="Người dùng" className="p-3 text-slate-400 text-[11px]">{o.user_email || '—'}</td>
                          <td data-label="Chiều" className="p-3">
                            <span className={o.side === 'BUY' ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                              {o.side}
                            </span>
                          </td>
                          <td data-label="Giá tín hiệu" className="p-3 text-slate-200">{signalPriceStr}</td>
                          <td data-label="Giá khớp" className="p-3 text-cyan-300 font-semibold">{fillPriceStr}</td>
                          <td data-label="SL / TP" className="p-3 text-slate-400">
                            {slStr} / {tpStr}
                          </td>
                          <td data-label="Ticket / Deal" className="p-3 text-slate-300">{o.ticket ? `${o.ticket}${o.deal ? ` / ${o.deal}` : ''}` : '—'}</td>
                          <td data-label="Trạng thái" className="p-3">
                            <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${stateInfo.badge}`}>
                              {stateInfo.label}
                            </span>
                          </td>
                          <td data-label="Lý do" className="p-3 text-slate-400 max-w-xs truncate" title={reasonStr}>
                            {reasonStr}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs font-mono text-slate-400 border-t border-slate-800/80">
                <div>
                  Hiển thị từ {adminOrderPage * 50 + 1} đến {Math.min((adminOrderPage + 1) * 50, adminOrdersTotal)} trong tổng
                  số {adminOrdersTotal} lệnh
                </div>
                <div className="flex items-center gap-2">
                  <button
                    disabled={adminOrderPage === 0}
                    onClick={() => setAdminOrderPage((p) => Math.max(0, p - 1))}
                    className="rounded px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 transition-colors"
                  >
                    ← Trang trước
                  </button>
                  <span className="px-2 text-slate-300 font-bold">
                    Trang {adminOrderPage + 1} / {Math.max(1, Math.ceil(adminOrdersTotal / 50))}
                  </span>
                  <button
                    disabled={(adminOrderPage + 1) * 50 >= adminOrdersTotal}
                    onClick={() => setAdminOrderPage((p) => p + 1)}
                    className="rounded px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 transition-colors"
                  >
                    Trang sau →
                  </button>
                </div>
              </div>
            </div>
          )
        ) : filteredActivities.length === 0 ? (
          <div className="p-8 text-center text-slate-500 font-mono text-xs">
            Không tìm thấy bản ghi hoạt động nào phù hợp với bộ lọc.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="quant-data-table w-full text-left text-xs font-mono">
              <thead className="bg-slate-950/60 border-b border-slate-800 text-[11px] text-slate-400">
                <tr>
                  <th className="p-3">THỜI ĐIỂM</th>
                  <th className="p-3">ĐỘI PHỤ TRÁCH</th>
                  <th className="p-3">SỰ KIỆN</th>
                  <th className="p-3">TÁC NHÂN</th>
                  <th className="p-3">TRẠNG THÁI</th>
                  <th className="p-3">CHI TIẾT & TRUY VẾT ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredActivities.slice(0, 100).map((item) => (
                  <tr key={item.id} className="hover:bg-slate-900/40">
                    <td data-label="Thời điểm" className="p-3 text-slate-400 whitespace-nowrap">{new Date(item.ts * 1000).toLocaleTimeString()}</td>
                    <td data-label="Đội" className="p-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          item.team === 'execution'
                            ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/40'
                            : item.team === 'research'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800/40'
                            : 'bg-purple-950 text-purple-300 border border-purple-800/40'
                        }`}
                      >
                        {item.team.toUpperCase()}
                      </span>
                    </td>
                    <td data-label="Sự kiện" className="p-3 font-semibold text-slate-200">{item.event}</td>
                    <td data-label="Tác nhân" className="p-3 text-slate-400">{item.actor}</td>
                    <td data-label="Trạng thái" className="p-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${mapBackendState(item.status).badge}`}
                      >
                        {mapBackendState(item.status).label}
                      </span>
                    </td>
                    <td data-label="Chi tiết" className="p-3 text-slate-300 max-w-sm truncate" title={item.detail}>
                      {item.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
