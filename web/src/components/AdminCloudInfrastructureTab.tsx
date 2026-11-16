import React, { useState } from 'react';
import { useCloudAccounts } from '../hooks/useQuantData';
import { fmtNum, fmtTime } from '../utils/strategyDecision';

export interface AdminCloudInfrastructureTabProps {
  accounts?: any[];
  refetchAll?: () => void;
}

export const AdminCloudInfrastructureTab: React.FC<AdminCloudInfrastructureTabProps> = ({
  accounts: externalAccounts,
  refetchAll,
}) => {
  const { data: cloudData, refetch: queryRefetch } = useCloudAccounts();
  const rawAccounts = externalAccounts ?? cloudData?.accounts ?? [];

  // Deduplicate accounts by (login, server)
  const accounts = React.useMemo(() => {
    const seen = new Set<string>();
    const res: any[] = [];
    for (const a of rawAccounts) {
      const login = a.login || a.mt5_login || a.id;
      const srv = (a.server || a.broker_server || '').toLowerCase();
      const key = `${login}@${srv}`;
      if (!seen.has(key)) {
        seen.add(key);
        res.push(a);
      }
    }
    return res;
  }, [rawAccounts]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | 'CLOUD_METAAPI' | 'DIRECT_TERMINAL'>('ALL');
  const [msg, setMsg] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filtered = accounts.filter((acc) => {
    if (filterType === 'ALL') return true;
    return (acc.connection_type || 'CLOUD_METAAPI') === filterType;
  });

  const cloudCount = accounts.filter((a) => (a.connection_type || 'CLOUD_METAAPI') === 'CLOUD_METAAPI').length;
  const deployedCount = accounts.filter(
    (a) => (a.deployment_status || a.deployment_state || 'DEPLOYED') === 'DEPLOYED'
  ).length;
  const activeCopyCount = accounts.filter((a) => a.is_active !== false).length;

  const triggerRefetch = () => {
    if (refetchAll) refetchAll();
    queryRefetch();
  };

  const handleAction = async (
    accountId: string,
    action: 'deploy' | 'undeploy' | 'sync' | 'toggle' | 'delete',
    currentActive?: boolean
  ) => {
    setBusyId(accountId);
    setMsg('');
    try {
      let res: Response;
      const baseHeaders = { 'X-Zupirus': '1' };
      if (action === 'sync') {
        res = await fetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/sync`, {
          method: 'POST',
          headers: baseHeaders,
          credentials: 'include',
        });
      } else if (action === 'toggle') {
        res = await fetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/toggle`, {
          method: 'POST',
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ is_active: !currentActive }),
        });
      } else if (action === 'delete') {
        res = await fetch(`/api/v1/accounts/${encodeURIComponent(accountId)}`, {
          method: 'DELETE',
          headers: baseHeaders,
          credentials: 'include',
        });
      } else {
        res = await fetch(`/api/v1/accounts/cloud/${encodeURIComponent(accountId)}/${action}`, {
          method: 'POST',
          headers: baseHeaders,
          credentials: 'include',
        });
      }

      if (res.ok) {
        setMsg(`✓ Đã thực thi [${action.toUpperCase()}] thành công cho trạm #${accountId}`);
        setConfirmDeleteId(null);
        triggerRefetch();
      } else {
        const d = await res.json().catch(() => ({}));
        setMsg(`Lỗi: ${d.detail || d.message || res.status}`);
      }
    } catch (e: any) {
      setMsg(`Lỗi kết nối: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-slate-400">
            Tổng Tài Khoản MT5
          </div>
          <div className="mt-2 font-mono text-2xl font-extrabold text-white tabular-nums">
            {accounts.length}
          </div>
        </div>
        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-cyan-400">
            Cầu Nối Cloud MetaAPI
          </div>
          <div className="mt-2 font-mono text-2xl font-extrabold text-cyan-300 tabular-nums">
            {cloudCount}
          </div>
        </div>
        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-emerald-400">
            Trạm Đang Chạy (Deployed)
          </div>
          <div className="mt-2 font-mono text-2xl font-extrabold text-emerald-400 tabular-nums">
            {deployedCount}
          </div>
        </div>
        <div className="quant-card-interactive p-5">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-amber-300">
            Đang Bật Copy Lệnh
          </div>
          <div className="mt-2 font-mono text-2xl font-extrabold text-amber-300 tabular-nums">
            {activeCopyCount}
          </div>
        </div>
      </div>

      {msg && (
        <div className="rounded-xl border border-cyan-500/35 bg-cyan-950/30 px-4 py-2.5 font-mono text-xs text-cyan-200">
          {msg}
        </div>
      )}

      <div className="quant-panel p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
              Quản Trị Hạ Tầng Đám Mây
            </span>
            <h3 className="mt-0.5 text-lg font-bold text-white">
              Điều Khiển Vòng Đời Máy Chủ Cloud MT5 (Deploy / Undeploy / Sync)
            </h3>
          </div>

          <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#040710] p-1">
            {[
              { id: 'ALL', label: 'Tất Cả' },
              { id: 'CLOUD_METAAPI', label: 'Cloud MetaAPI' },
              { id: 'DIRECT_TERMINAL', label: 'Direct EA' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterType(tab.id as any)}
                className={`rounded-lg px-3 py-1.5 font-mono text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                  filterType === tab.id
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-[#040710]/85">
          <table className="quant-table">
            <thead>
              <tr>
                <th>Tài Khoản / Máy Chủ</th>
                <th>Chủ Sở Hữu</th>
                <th className="text-right">Balance / Equity</th>
                <th className="text-right">Hệ Số / Max DD</th>
                <th>Trạng Thái Cloud</th>
                <th>Heartbeat</th>
                <th className="text-right">Thao Tác Quản Trị</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-slate-500">
                    Không có trạm MT5 nào khớp với bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                filtered.map((acc) => {
                  const id = acc.account_id || acc.id || acc.login;
                  const deployState = acc.deployment_status || acc.deployment_state || 'DEPLOYED';
                  const isDeployed = deployState === 'DEPLOYED';
                  const isBusy = busyId === id;
                  return (
                    <tr key={id}>
                      <td>
                        <div className="font-semibold text-white">{acc.account_name || acc.login || id}</div>
                        <div className="font-mono text-[11px] text-slate-400">
                          #{id} · {acc.mt5_server || acc.broker_server || 'MT5'}
                        </div>
                      </td>
                      <td className="font-mono text-xs text-slate-300">{acc.user_id || 'admin'}</td>
                      <td className="text-right font-mono text-xs tabular-nums">
                        <div className="font-bold text-white">${fmtNum(acc.balance, 2)}</div>
                        <div className="text-cyan-300">${fmtNum(acc.equity, 2)}</div>
                      </td>
                      <td className="text-right font-mono text-xs text-slate-300 tabular-nums">
                        x{fmtNum(acc.lot_multiplier || acc.risk_multiplier || 1, 2)} ·{' '}
                        {fmtNum(acc.max_daily_dd_pct || 4, 1)}%
                      </td>
                      <td className="font-mono text-xs">
                        <span className={isDeployed ? 'font-bold text-emerald-400' : 'text-amber-300'}>
                          {deployState}
                        </span>
                      </td>
                      <td className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {acc.last_heartbeat ? fmtTime(acc.last_heartbeat) : 'Trực tuyến'}
                      </td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleAction(id, 'sync')}
                            className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 font-mono text-[11px] text-cyan-300 hover:bg-cyan-500/20"
                          >
                            Sync
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleAction(id, isDeployed ? 'undeploy' : 'deploy')}
                            className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-slate-300 hover:text-white"
                          >
                            {isDeployed ? 'Undeploy' : 'Deploy'}
                          </button>
                          {confirmDeleteId === id ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleAction(id, 'delete')}
                                className="rounded-lg border border-rose-500 bg-rose-500/25 px-2.5 py-1 font-mono text-[11px] font-bold text-rose-200 hover:bg-rose-500/40"
                              >
                                Xác nhận xoá
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setConfirmDeleteId(null)}
                                className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-slate-400 hover:text-white"
                              >
                                Huỷ
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setConfirmDeleteId(id)}
                              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 font-mono text-[11px] text-rose-300 hover:bg-rose-500/20"
                            >
                              Xoá
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
