import React, { useState, useEffect } from 'react';

interface CloudAccountItem {
  id: string;
  user_id: string;
  login: string;
  server: string;
  account_name?: string;
  account_type?: string;
  broker_type?: string;
  auto_trade: number;
  risk_multiplier?: number;
  balance: number;
  equity: number;
  metaapi_account_id?: string;
  metaapi_state?: string;
  is_deployed: number;
  user_email?: string;
  updated_at?: number;
}

export const AdminCloudInfrastructureTab: React.FC = () => {
  const [accounts, setAccounts] = useState<CloudAccountItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  async function loadAccounts() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/monitor');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch (e) {
      console.error('Error fetching admin accounts:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  async function handleForceDeploy(accountId: string) {
    setActionLoading(accountId);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/accounts/cloud/${accountId}/deploy`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ text: `Đã kích hoạt triển khai Cloud MT5 cho tài khoản #${accountId}!`, type: 'success' });
        await loadAccounts();
      } else {
        setMsg({ text: data.detail || 'Không thể triển khai tài khoản.', type: 'error' });
      }
    } catch (err: any) {
      setMsg({ text: err.message || String(err), type: 'error' });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleForceUndeploy(accountId: string) {
    if (!window.confirm('Bạn có chắc chắn muốn buộc gỡ terminal MT5 này khỏi cụm MetaApi Cloud?')) return;
    setActionLoading(accountId);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/accounts/cloud/${accountId}/undeploy`, {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ text: `Đã gỡ terminal MetaApi Cloud #${accountId} an toàn.`, type: 'success' });
        await loadAccounts();
      } else {
        setMsg({ text: data.detail || 'Không thể gỡ tài khoản.', type: 'error' });
      }
    } catch (err: any) {
      setMsg({ text: err.message || String(err), type: 'error' });
    } finally {
      setActionLoading(null);
    }
  }

  const filteredAccounts = accounts.filter((a) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      a.login.toLowerCase().includes(q) ||
      a.server.toLowerCase().includes(q) ||
      (a.user_email && a.user_email.toLowerCase().includes(q));
    const matchType = typeFilter === 'ALL' || a.account_type === typeFilter;
    return matchSearch && matchType;
  });

  const totalEquity = accounts.reduce((sum, a) => sum + Number(a.equity || 0), 0);
  const activeCount = accounts.filter((a) => a.auto_trade === 1).length;

  return (
    <div className="space-y-8 font-sans">
      {/* 1. Infrastructure Overview Stats (Bento Grid) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5 shadow-lg relative overflow-hidden">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Tài Khoản Cloud MT5</div>
          <div className="mt-2 text-2xl font-black text-cyan-400 font-mono tabular-nums">
            {accounts.length}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 font-mono">
            {activeCount} tài khoản bật Auto-Trade
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5 shadow-lg relative overflow-hidden">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Tổng Vốn Ủy Thác (Equity)</div>
          <div className="mt-2 text-2xl font-black text-emerald-400 font-mono tabular-nums">
            ${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 font-mono">
            Được bảo vệ bởi 4 Màng Lọc An Toàn
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5 shadow-lg relative overflow-hidden">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Cầu Nối London G2 Datacenter</div>
          <div className="mt-2 text-2xl font-black text-slate-100 font-mono tabular-nums flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>28 ms</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400 font-mono">
            Độ trễ microsecond qua MetaApi Cloud
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5 shadow-lg relative overflow-hidden">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Cơ Chế Khớp Lệnh</div>
          <div className="mt-2 text-2xl font-black text-amber-300 font-mono">
            Direct Cloud
          </div>
          <div className="mt-1 text-[11px] text-slate-400 font-mono">
            Zero EA · Không treo máy VPS
          </div>
        </div>
      </div>

      {/* Notification Message */}
      {msg && (
        <div
          className={`p-3 rounded-xl border text-xs font-mono ${
            msg.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
              : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* 2. Main Cloud MT5 Terminals Table */}
      <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-6 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h3 className="font-bold text-sm text-slate-100 font-mono flex items-center gap-2">
              <span>🖥️ QUẢN TRỊ DANH MỤC TERMINAL CLOUD MT5</span>
            </h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Phân loại tự động tài khoản Standard, Cent USC, Quỹ FTMO và điều khiển kết nối trực tiếp.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadAccounts}
              disabled={loading}
              className="text-xs font-mono text-cyan-400 hover:text-cyan-300 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800"
            >
              {loading ? 'Đang tải…' : '↻ Quét Lại Số Dư & Trạng Thái'}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            {['ALL', 'STANDARD', 'CENT', 'PROP_FIRM', 'RAW_ECN'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  typeFilter === t
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/60 shadow'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {t === 'ALL'
                  ? 'Tất Cả'
                  : t === 'CENT'
                  ? 'Cent · USC (1:100)'
                  : t === 'PROP_FIRM'
                  ? 'Prop Firm · Quỹ FTMO'
                  : t === 'RAW_ECN'
                  ? 'Raw ECN'
                  : 'Standard · USD'}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo Login, Server, Email…"
            className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-1.5 text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400 w-full sm:w-64"
          />
        </div>

        {/* Terminals Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800/80">
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-[#111827] text-slate-400 border-b border-slate-800 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-3.5">MT5 Login / Máy Chủ</th>
                <th className="py-3 px-3.5">Phân Loại Sàn</th>
                <th className="py-3 px-3.5 text-right">Số Dư (Balance)</th>
                <th className="py-3 px-3.5 text-right">Vốn (Equity)</th>
                <th className="py-3 px-3.5 text-center">Auto-Trade</th>
                <th className="py-3 px-3.5 text-center">Trạng Thái Cloud</th>
                <th className="py-3 px-3.5 text-right">Thao Tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
              {filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-500 text-xs">
                    Không tìm thấy tài khoản Cloud MT5 nào.
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="py-3 px-3.5">
                      <div className="font-bold text-slate-100 flex items-center gap-1.5">
                        <span>#{a.login}</span>
                        {a.account_name && <span className="text-slate-400 text-[10px]">({a.account_name})</span>}
                      </div>
                      <div className="text-[11px] text-slate-400">{a.server}</div>
                      {a.user_email && <div className="text-[10px] text-slate-500">{a.user_email}</div>}
                    </td>

                    <td className="py-3 px-3.5">
                      {a.account_type === 'CENT' ? (
                        <span className="rounded border px-2 py-0.5 text-[10px] font-bold bg-amber-950 text-amber-300 border-amber-700/60">
                          Cent · USC (1:100)
                        </span>
                      ) : a.account_type === 'PROP_FIRM' ? (
                        <span className="rounded border px-2 py-0.5 text-[10px] font-bold bg-purple-950 text-purple-300 border-purple-700/60">
                          Prop Firm · FTMO
                        </span>
                      ) : a.account_type === 'RAW_ECN' ? (
                        <span className="rounded border px-2 py-0.5 text-[10px] font-bold bg-blue-950 text-blue-300 border-blue-700/60">
                          Raw ECN · Zero Spread
                        </span>
                      ) : (
                        <span className="rounded border px-2 py-0.5 text-[10px] font-bold bg-slate-800 text-slate-300 border-slate-700">
                          Standard · USD
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-3.5 text-right text-slate-300 tabular-nums">
                      ${Number(a.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>

                    <td className="py-3 px-3.5 text-right font-black text-emerald-400 tabular-nums">
                      ${Number(a.equity || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>

                    <td className="py-3 px-3.5 text-center">
                      {a.auto_trade === 1 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-600/60">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> BẬT
                        </span>
                      ) : (
                        <span className="rounded px-2 py-0.5 text-[10px] font-bold bg-slate-900 text-slate-500 border border-slate-800">
                          TẮT
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-3.5 text-center">
                      <span className="rounded border px-2 py-0.5 text-[10px] font-bold bg-cyan-950 text-cyan-300 border-cyan-700/60">
                        {a.is_deployed === 1 ? 'DEPLOYED' : 'READY'}
                      </span>
                    </td>

                    <td className="py-3 px-3.5 text-right space-x-1.5">
                      <button
                        type="button"
                        disabled={actionLoading === a.id}
                        onClick={() => handleForceDeploy(a.id)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 text-[10px] font-bold"
                        title="Buộc triển khai terminal lên MetaApi Cloud"
                      >
                        ⚡ Deploy
                      </button>
                      <button
                        type="button"
                        disabled={actionLoading === a.id}
                        onClick={() => handleForceUndeploy(a.id)}
                        className="px-2.5 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-700/60 text-[10px] font-bold"
                        title="Buộc gỡ terminal khỏi MetaApi Cloud"
                      >
                        🛑 Undeploy
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
