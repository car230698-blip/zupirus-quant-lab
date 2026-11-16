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

interface GeminiKeyItem {
  id: string;
  name: string;
  key_masked: string;
  is_active: number | boolean;
  requests_count: number;
  last_used?: string | number | null;
}

interface HindsightMemoryItem {
  id: string;
  category: 'episodic' | 'semantic' | 'reflective';
  title?: string;
  content: string;
  tags?: string[];
  relevance_score?: number;
  created?: number;
}

export const AdminCloudInfrastructureTab: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'terminals' | 'gemini' | 'hindsight'>('terminals');

  // Terminals State
  const [accounts, setAccounts] = useState<CloudAccountItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Gemini State
  const [keys, setKeys] = useState<GeminiKeyItem[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyInput, setNewKeyInput] = useState('');
  const [testPrompt, setTestPrompt] = useState('Đánh giá các điều kiện rủi ro cho chiến lược giao dịch XAUUSD.');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // Hindsight State
  const [memories, setMemories] = useState<HindsightMemoryItem[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [memoryFilter, setMemoryFilter] = useState<'all' | 'episodic' | 'semantic' | 'reflective'>('all');
  const [memorySearch, setMemorySearch] = useState('');
  const [newMemCategory, setNewMemCategory] = useState<'episodic' | 'semantic' | 'reflective'>('semantic');
  const [newMemContent, setNewMemContent] = useState('');

  // 1. Load Terminals
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

  // 2. Load Gemini Keys
  async function loadGeminiKeys() {
    setLoadingKeys(true);
    try {
      const res = await fetch('/api/admin/gemini/keys', {
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch (e) {
      console.error('Error fetching gemini keys:', e);
    } finally {
      setLoadingKeys(false);
    }
  }

  // 3. Load Hindsight Memories
  async function loadHindsightMemories() {
    setLoadingMemories(true);
    try {
      const res = await fetch('/api/admin/hindsight/memories', {
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      }
    } catch (e) {
      console.error('Error fetching memories:', e);
    } finally {
      setLoadingMemories(false);
    }
  }

  useEffect(() => {
    loadAccounts();
    loadGeminiKeys();
    loadHindsightMemories();
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

  // Gemini Handlers
  async function handleAddKeySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyInput) return;
    try {
      const res = await fetch('/api/admin/gemini/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ key: newKeyInput, name: newKeyName || 'Gemini Key' }),
      });
      if (res.ok) {
        setNewKeyInput('');
        setNewKeyName('');
        await loadGeminiKeys();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleToggleKey(id: string) {
    try {
      await fetch(`/api/admin/gemini/keys/${id}/toggle`, {
        method: 'PUT',
        headers: { 'X-Zupirus': '1' },
      });
      await loadGeminiKeys();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeleteKey(id: string) {
    if (!window.confirm('Bạn có chắc chắn muốn xóa khóa API Gemini này?')) return;
    try {
      await fetch(`/api/admin/gemini/keys/${id}`, {
        method: 'DELETE',
        headers: { 'X-Zupirus': '1' },
      });
      await loadGeminiKeys();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleRunTest() {
    if (!testPrompt) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/gemini/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ prompt: testPrompt }),
      });
      const data = await res.json();
      setTestResult(data);
      await loadGeminiKeys();
    } catch (e: any) {
      setTestResult({ success: false, error: e.message || String(e) });
    } finally {
      setTesting(false);
    }
  }

  // Hindsight Handlers
  async function handleAddMemorySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newMemContent) return;
    try {
      const res = await fetch('/api/admin/hindsight/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ category: newMemCategory, content: newMemContent }),
      });
      if (res.ok) {
        setNewMemContent('');
        await loadHindsightMemories();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeleteMemory(id: string) {
    if (!window.confirm('Bạn có chắc chắn muốn xóa bản ghi bộ nhớ Hindsight này?')) return;
    try {
      await fetch(`/api/admin/hindsight/memories/${id}`, {
        method: 'DELETE',
        headers: { 'X-Zupirus': '1' },
      });
      await loadHindsightMemories();
    } catch (e) {
      console.error(e);
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

  const filteredMemories = memories.filter((m) => {
    if (memoryFilter !== 'all' && m.category !== memoryFilter) return false;
    if (memorySearch && !m.content.toLowerCase().includes(memorySearch.toLowerCase())) return false;
    return true;
  });

  const totalEquity = accounts.reduce((sum, a) => sum + Number(a.equity || 0), 0);
  const activeCount = accounts.filter((a) => a.auto_trade === 1).length;

  return (
    <div className="space-y-6 font-sans">
      {/* Subtab Navigation Pill Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3 font-mono text-xs">
        <button
          type="button"
          onClick={() => setActiveSubTab('terminals')}
          className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 ${
            activeSubTab === 'terminals'
              ? 'bg-cyan-500 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)]'
              : 'bg-slate-900/90 text-slate-300 hover:bg-slate-800 border border-slate-800'
          }`}
        >
          <span>🖥️ Cụm Terminal Cloud MT5</span>
          <span className="text-[10px] bg-slate-950/60 px-1.5 py-0.5 rounded text-cyan-300 font-bold">
            {accounts.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('gemini')}
          className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 ${
            activeSubTab === 'gemini'
              ? 'bg-cyan-500 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)]'
              : 'bg-slate-900/90 text-slate-300 hover:bg-slate-800 border border-slate-800'
          }`}
        >
          <span>⚡ Bể Khóa Gemini AI (Failover Pool)</span>
          <span className="text-[10px] bg-slate-950/60 px-1.5 py-0.5 rounded text-cyan-300 font-bold">
            {keys.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('hindsight')}
          className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 ${
            activeSubTab === 'hindsight'
              ? 'bg-purple-500 text-slate-950 shadow-[0_0_15px_rgba(168,85,247,0.4)]'
              : 'bg-slate-900/90 text-slate-300 hover:bg-slate-800 border border-slate-800'
          }`}
        >
          <span>🧠 Bộ Nhớ Hindsight Engine</span>
          <span className="text-[10px] bg-slate-950/60 px-1.5 py-0.5 rounded text-purple-300 font-bold">
            {memories.length}
          </span>
        </button>
      </div>

      {/* SUBTAB 1: TERMINALS */}
      {activeSubTab === 'terminals' && (
        <div className="space-y-6">
          {/* Infrastructure Overview Stats (Bento Grid) */}
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

          {/* Main Cloud MT5 Terminals Table */}
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
      )}

      {/* SUBTAB 2: GEMINI FAILOVER POOL */}
      {activeSubTab === 'gemini' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-[#0B1120] p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="font-bold text-sm text-slate-100 font-mono">Bể Khóa API Gemini (Multi-Key Failover)</h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    Tự động phân phối yêu cầu và tự động chuyển khóa dự phòng khi gặp hạn mức (HTTP 429).
                  </p>
                </div>
                <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-1 rounded-lg font-bold">
                  {keys.filter((k) => k.is_active).length} / {keys.length} Đang hoạt động
                </span>
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-800/80">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[#111827] text-slate-400 border-b border-slate-800 text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-3.5">Tên / Nhãn</th>
                      <th className="py-3 px-3.5">Mã Khóa (Masked)</th>
                      <th className="py-3 px-3.5">Trạng Thái</th>
                      <th className="py-3 px-3.5">Số Lượt Gọi</th>
                      <th className="py-3 px-3.5">Lần Dùng Gần Nhất</th>
                      <th className="py-3 px-3.5 text-right">Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-950/40 text-slate-200">
                    {loadingKeys ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">Đang tải danh sách khóa...</td>
                      </tr>
                    ) : keys.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">Chưa có khóa nào trong hệ thống.</td>
                      </tr>
                    ) : (
                      keys.map((k) => (
                        <tr key={k.id} className="hover:bg-slate-900/40 transition-colors">
                          <td className="py-3 px-3.5 font-bold text-slate-100">{k.name}</td>
                          <td className="py-3 px-3.5 text-cyan-300 font-mono">{k.key_masked}</td>
                          <td className="py-3 px-3.5">
                            {k.is_active ? (
                              <span className="text-emerald-400 font-bold inline-flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
                              </span>
                            ) : (
                              <span className="text-slate-500">○ Tắt</span>
                            )}
                          </td>
                          <td className="py-3 px-3.5 text-slate-300 tabular-nums">{k.requests_count}</td>
                          <td className="py-3 px-3.5 text-slate-400 text-[11px]">
                            {k.last_used ? new Date(Number(k.last_used) * 1000).toLocaleTimeString('vi-VN') : 'Chưa dùng'}
                          </td>
                          <td className="py-3 px-3.5 text-right space-x-1.5">
                            <button
                              type="button"
                              onClick={() => handleToggleKey(k.id)}
                              className="rounded-lg bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] text-cyan-300 border border-slate-700 font-bold"
                            >
                              {k.is_active ? 'Tạm dừng' : 'Bật'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteKey(k.id)}
                              className="rounded-lg bg-red-950/60 hover:bg-red-900/80 px-2.5 py-1 text-[11px] text-red-400 border border-red-800/80 font-bold"
                            >
                              Xoá
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Add Key Form */}
            <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-6 space-y-4 font-mono text-xs shadow-xl">
              <h3 className="font-bold text-sm text-slate-100">Thêm API Key Gemini</h3>
              <p className="text-slate-400 text-[11px]">
                Khóa được lưu mã hóa an toàn và chỉ hiển thị dạng rút gọn trên giao diện.
              </p>
              <form onSubmit={handleAddKeySubmit} className="space-y-3.5">
                <div>
                  <label className="block text-slate-400 mb-1 text-[11px]">Tên / Nhãn khóa</label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="Ví dụ: Gemini Pro Reserve #6"
                    className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 text-[11px]">Gemini API Key *</label>
                  <input
                    type="password"
                    required
                    value={newKeyInput}
                    onChange={(e) => setNewKeyInput(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black py-2.5 text-xs transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                >
                  + Thêm Vào Bể Xoay Vòng
                </button>
              </form>
            </div>
          </div>

          {/* Test Runner */}
          <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-6 space-y-3 font-mono text-xs shadow-xl">
            <h3 className="font-bold text-sm text-slate-100">Kiểm Thử Kết Nối Bể Khóa Gemini</h3>
            <p className="text-slate-400 text-[11px]">
              Gửi một prompt kiểm thử qua hệ thống xoay vòng để xác nhận API key hoạt động và kiểm tra tính năng failover.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                className="flex-1 min-w-[280px] rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
              <button
                type="button"
                onClick={handleRunTest}
                disabled={testing}
                className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black px-5 py-2 text-xs transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50"
              >
                {testing ? 'Đang gọi AI...' : 'Chạy Thử Nghiệm'}
              </button>
            </div>

            {testResult && (
              <div
                className={`p-4 rounded-xl border text-xs font-mono ${
                  testResult.success
                    ? 'bg-emerald-950/40 border-emerald-800/80 text-slate-200'
                    : 'bg-rose-950/40 border-rose-800/80 text-rose-200'
                }`}
              >
                <div className="flex items-center justify-between font-bold mb-1">
                  <span>Kết quả: {testResult.success ? '✅ Thành công' : '❌ Lỗi'}</span>
                  {testResult.key_used && (
                    <span className="text-[11px] text-cyan-300">Khóa sử dụng: {testResult.key_used}</span>
                  )}
                </div>
                {testResult.response && (
                  <p className="text-slate-300 text-xs mt-2 bg-slate-900/60 p-3 rounded-lg border border-slate-800 leading-relaxed">
                    {testResult.response}
                  </p>
                )}
                {testResult.error && (
                  <p className="text-rose-400 text-xs mt-2 bg-rose-950/60 p-3 rounded-lg border border-rose-800/60 font-bold">
                    {testResult.error}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBTAB 3: HINDSIGHT ENGINE */}
      {activeSubTab === 'hindsight' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-[#0B1120] p-6 space-y-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3 font-mono text-xs">
                <div>
                  <h3 className="font-bold text-sm text-slate-100">Bộ Nhớ Dài Hạn Hindsight (vectorize-io/hindsight)</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Lưu trữ kinh nghiệm, quy tắc suy luận và các bài học từ giao dịch thực tế vào TimescaleDB.
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {(['all', 'semantic', 'reflective', 'episodic'] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setMemoryFilter(cat)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${
                        memoryFilter === cat
                          ? 'bg-purple-950 text-purple-300 border border-purple-600/80 shadow'
                          : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search */}
              <input
                type="text"
                value={memorySearch}
                onChange={(e) => setMemorySearch(e.target.value)}
                placeholder="Tìm kiếm nội dung bộ nhớ Hindsight…"
                className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2 text-slate-100 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-purple-400"
              />

              {/* Memory List */}
              <div className="space-y-2.5">
                {loadingMemories ? (
                  <div className="p-8 text-center text-slate-500 font-mono text-xs">Đang tải bộ nhớ Hindsight...</div>
                ) : filteredMemories.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 font-mono text-xs">Chưa có bản ghi nào.</div>
                ) : (
                  filteredMemories.map((m) => (
                    <div
                      key={m.id}
                      className="p-3.5 rounded-xl border border-slate-800/80 bg-slate-950/60 font-mono text-xs space-y-1.5 hover:border-purple-800/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              m.category === 'semantic'
                                ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/60'
                                : m.category === 'reflective'
                                ? 'bg-purple-950/80 text-purple-300 border border-purple-800/60'
                                : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                            }`}
                          >
                            {m.category}
                          </span>
                          {m.title && <span className="font-bold text-slate-200">{m.title}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500">
                            {m.created ? new Date(Number(m.created) * 1000).toLocaleDateString('vi-VN') : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteMemory(m.id)}
                            className="text-slate-500 hover:text-rose-400 text-xs px-1"
                            title="Xóa bản ghi"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <p className="text-slate-300 text-xs leading-relaxed">{m.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Add Memory Form */}
            <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-6 space-y-4 font-mono text-xs shadow-xl">
              <h3 className="font-bold text-sm text-slate-100">Đúc Kết Thêm Bản Ghi Mới</h3>
              <p className="text-slate-400 text-[11px]">
                Bổ sung trực tiếp quy tắc thị trường hoặc lưu ý rủi ro vào kho kiến thức dài hạn của Agent.
              </p>
              <form onSubmit={handleAddMemorySubmit} className="space-y-3.5">
                <div>
                  <label className="block text-slate-400 mb-1 text-[11px]">Phân loại bản ghi</label>
                  <select
                    value={newMemCategory}
                    onChange={(e: any) => setNewMemCategory(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2 text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400"
                  >
                    <option value="semantic">Semantic (Quy tắc định lượng)</option>
                    <option value="reflective">Reflective (Đúc kết kinh nghiệm)</option>
                    <option value="episodic">Episodic (Sự kiện thị trường cụ thể)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 text-[11px]">Nội dung quy tắc / kinh nghiệm *</label>
                  <textarea
                    required
                    rows={4}
                    value={newMemContent}
                    onChange={(e) => setNewMemContent(e.target.value)}
                    placeholder="Ví dụ: Khi spread giãn trên 4.0 pips tại phiên giao dịch Tokyo, dừng kích hoạt chiến lược đột phá..."
                    className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-purple-500 hover:bg-purple-400 text-slate-950 font-black py-2.5 text-xs transition-all shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                >
                  + Lưu Vào Bộ Nhớ Dài Hạn
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
