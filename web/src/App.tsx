import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { CustomerAssistant } from './components/CustomerAssistant.tsx';
import { AdminApprovalQueue } from './components/AdminApprovalQueue.tsx';

type UserTabKey = 'overview' | 'accounts' | 'orders' | 'assistant';
type AdminTabKey = 'overview' | 'approvals' | 'activity' | 'tracing' | 'news';

interface UserInfo {
  email: string;
  role: 'customer' | 'admin';
}

export const App: React.FC = () => {
  // Determine initial portal based on hostname or search params
  const [portal, setPortal] = useState<'user' | 'admin'>(() => {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname.toLowerCase();
      const params = new URLSearchParams(window.location.search);
      if (params.get('portal') === 'admin' || host === 'adm.zupirus.com' || host.startsWith('adm.')) {
        return 'admin';
      }
    }
    return 'user';
  });

  // Auth state
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('demo_admin') === '1') {
        return { email: 'admin@zupirus.com', role: 'admin' };
      }
      if (params.get('demo_user') === '1') {
        return { email: 'user@zupirus.com', role: 'customer' };
      }
    }
    return null;
  });
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Tab navigation
  const [userTab, setUserTab] = useState<UserTabKey>('overview');
  const [adminTab, setAdminTab] = useState<AdminTabKey>('overview');

  // Dashboard & Market Data
  const [dashboard, setDashboard] = useState<any>({
    accounts: [],
    orders: [],
    series: [],
    health: {},
    real_trading: false,
  });
  const [, setSelectedAccount] = useState<string>('');
  const [candles, setCandles] = useState<any[]>([]);
  const [timeframe, setTimeframe] = useState<'M1' | 'M5' | 'M15' | 'H1' | 'D1'>('M15');
  const [chartMode, setChartMode] = useState<'equity' | 'candles'>('equity');

  // Admin & Monitoring state
  const [monitorData, setMonitorData] = useState<any>({ accounts: [], audit: [], jobs: [], news: [], halted: false });
  const [tracingData, setTracingData] = useState<any>({
    langsmith_configured: true,
    project: 'zupirus-quant-lab',
    total_traces_recorded: 0,
    recent_traces: [],
  });
  const [readyData, setReadyData] = useState<any>(null);

  // Activity filter state
  const [activityTeamFilter, setActivityTeamFilter] = useState<'all' | 'execution' | 'research' | 'security'>('all');
  const [activityStatusFilter, setActivityStatusFilter] = useState<'all' | 'running' | 'waiting' | 'completed' | 'error' | 'stale'>('all');
  const [activitySearchQuery, setActivitySearchQuery] = useState<string>('');

  // Forms & notices
  const [notice, setNotice] = useState<string | null>(null);
  const [newDemoLogin, setNewDemoLogin] = useState('');
  const [newDemoServer, setNewDemoServer] = useState('ICMarketsSC-Demo');
  const [pairCodes, setPairCodes] = useState<Record<string, string>>({});
  const [newsTitle, setNewsTitle] = useState('');
  const [newsWhen, setNewsWhen] = useState('');
  const [killSwitchReason, setKillSwitchReason] = useState('');
  const [killSwitchLoading, setKillSwitchLoading] = useState(false);

  // Check auth session
  const checkAuth = useCallback(async () => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const hasDemoParam = params && (params.get('demo_admin') === '1' || params.get('demo_user') === '1');
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        const u = await res.json();
        setCurrentUser(u);
      } else if (!hasDemoParam) {
        setCurrentUser(null);
      }
    } catch {
      if (!hasDemoParam) {
        setCurrentUser(null);
      }
    } finally {
      setAuthChecking(false);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (res.ok) {
        const d = await res.json();
        setDashboard(d);
        setSelectedAccount((prev) => {
          if (prev && d.accounts?.some((a: any) => a.id === prev)) return prev;
          return d.accounts?.[0]?.id || '';
        });
      }
    } catch {
      // offline fallback
    }
  }, []);

  const loadCandles = useCallback(async (tf: string) => {
    try {
      const res = await fetch(`/api/timescale/candles?symbol=XAUUSD&timeframe=${tf}&source=DEMO&limit=36`);
      if (res.ok) {
        const d = await res.json();
        setCandles((d.candles || []).slice().reverse());
      }
    } catch {
      // ignore
    }
  }, []);

  const loadAdminMonitor = useCallback(async () => {
    try {
      const [mRes, tRes, rRes] = await Promise.all([
        fetch('/api/admin/monitor'),
        fetch('/api/admin/tracing'),
        fetch('/readyz'),
      ]);
      if (mRes.ok) setMonitorData(await mRes.json());
      if (tRes.ok) setTracingData(await tRes.json());
      if (rRes.ok) setReadyData(await rRes.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (currentUser) {
      loadDashboard();
      loadCandles(timeframe);
      if (currentUser.role === 'admin') {
        loadAdminMonitor();
      }
      const timer = setInterval(() => {
        loadDashboard();
        if (currentUser.role === 'admin') {
          loadAdminMonitor();
        }
      }, 5000);
      return () => clearInterval(timer);
    }
  }, [currentUser, loadDashboard, loadCandles, loadAdminMonitor, timeframe]);

  const showNotice = (msg: string) => {
    setNotice(msg);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Đăng nhập thất bại' }));
        throw new Error(err.detail || 'Email hoặc mật khẩu không chính xác');
      }
      const u = await res.json();
      setCurrentUser(u);
      showNotice(`Đăng nhập thành công với vai trò ${u.role === 'admin' ? 'Quản Trị Viên (Admin)' : 'Khách Hàng (User)'}`);
    } catch (err: any) {
      setAuthError(err.message || 'Lỗi kết nối máy chủ');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Đăng ký thất bại' }));
        throw new Error(err.detail || 'Không thể tạo tài khoản');
      }
      showNotice('Đăng ký tài khoản thành công! Đang tự động đăng nhập...');
      // Auto-login
      const logRes = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      if (logRes.ok) {
        const u = await logRes.json();
        setCurrentUser(u);
      }
    } catch (err: any) {
      setAuthError(err.message || 'Lỗi đăng ký');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST', headers: { 'X-Zupirus': '1' } });
    } catch {
      // ignore
    }
    setCurrentUser(null);
    showNotice('Đã đăng xuất an toàn.');
  };

  // EA & Account operations
  const handleToggleCopy = async (aid: string, currentEnabled: boolean) => {
    const res = await fetch(`/api/accounts/${aid}/toggle`, {
      method: 'POST',
      headers: { 'X-Zupirus': '1' },
    });
    if (res.ok) {
      showNotice(`Đã ${currentEnabled ? 'tạm dừng' : 'bật kích hoạt'} nhận lệnh sao chép cho tài khoản #${aid.slice(0, 8)}.`);
      await loadDashboard();
      if (currentUser?.role === 'admin') await loadAdminMonitor();
    }
  };

  const handleRevoke = async (aid: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn thu hồi quyền truy cập của EA MT5 này?')) return;
    const res = await fetch(`/api/accounts/${aid}/revoke`, {
      method: 'POST',
      headers: { 'X-Zupirus': '1' },
    });
    if (res.ok) {
      showNotice(`Đã thu hồi liên kết EA cho tài khoản #${aid.slice(0, 8)}. EA sẽ bị ngắt kết nối.`);
      await loadDashboard();
      if (currentUser?.role === 'admin') await loadAdminMonitor();
    }
  };

  const handleCreatePairCode = async (aid: string) => {
    const res = await fetch(`/api/accounts/${aid}/pair`, {
      method: 'POST',
      headers: { 'X-Zupirus': '1' },
    });
    if (res.ok) {
      const data = await res.json();
      setPairCodes((prev) => ({ ...prev, [aid]: data.code }));
      showNotice(`Đã sinh mã ghép nối EA một lần: ${data.code} (Hết hạn sau 10 phút)`);
    }
  };

  const handleAddDemoAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDemoLogin.trim()) return;
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({
        login: newDemoLogin.trim(),
        server: newDemoServer.trim(),
        mode: 'DEMO',
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setNewDemoLogin('');
      showNotice(`Đã thêm tài khoản MT5 Demo #${newDemoLogin}. Tiến hành tạo mã ghép nối bên dưới.`);
      await loadDashboard();
      if (data.id) handleCreatePairCode(data.id);
    } else {
      const err = await res.json().catch(() => ({ detail: 'Lỗi' }));
      showNotice(`Lỗi tạo tài khoản: ${err.detail}`);
    }
  };

  const handleCreateReplay = async () => {
    const res = await fetch('/api/replay', {
      method: 'POST',
      headers: { 'X-Zupirus': '1' },
    });
    if (res.ok) {
      showNotice('Đã tạo tài khoản Replay tự động mô phỏng nến XAUUSD.');
      await loadDashboard();
    }
  };

  // Admin operations
  const handleToggleKillSwitch = async (currentHalted: boolean) => {
    setKillSwitchLoading(true);
    try {
      const nextHalt = !currentHalted;
      const res = await fetch('/api/admin/safety', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({
          halted: nextHalt,
          reason: killSwitchReason || (nextHalt ? 'Bật nút ngắt khẩn cấp từ Admin Portal' : 'Khôi phục vận hành hệ thống'),
        }),
      });
      if (res.ok) {
        showNotice(nextHalt ? 'ĐÃ KÍCH HOẠT KILL-SWITCH: Toàn bộ việc cấp lệnh copy đã dừng an toàn.' : 'ĐÃ TẮT KILL-SWITCH: Hệ thống tiếp tục vận hành bình thường.');
        setKillSwitchReason('');
        await loadDashboard();
        await loadAdminMonitor();
      }
    } finally {
      setKillSwitchLoading(false);
    }
  };

  const handleStartResearch = async () => {
    const res = await fetch('/api/admin/research', {
      method: 'POST',
      headers: { 'X-Zupirus': '1' },
    });
    if (res.ok) {
      showNotice('Đã bắt đầu chu kỳ nghiên cứu Walk-Forward. LangGraph đang lưu checkpoint trên PostgreSQL.');
      await loadAdminMonitor();
    }
  };

  const handleAddNews = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newsTitle.trim()) return;
    const ts = newsWhen ? new Date(newsWhen).getTime() / 1000 : Date.now() / 1000 + 3600;
    const res = await fetch('/api/admin/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({
        currency: 'USD',
        impact: 'high',
        title: newsTitle.trim(),
        ts,
      }),
    });
    if (res.ok) {
      setNewsTitle('');
      setNewsWhen('');
      showNotice('Đã thêm sự kiện tin tức USD High Impact (bảo vệ tài khoản: chặn lệnh mới ±15 phút).');
      await loadAdminMonitor();
    }
  };

  // Consolidated activity items
  const consolidatedActivities = useMemo(() => {
    const list: any[] = [];
    // From audit logs
    (monitorData.audit || []).forEach((a: any) => {
      let team = 'security';
      if (a.event.includes('replay') || a.event.includes('signal') || a.event.includes('dispatch') || a.event.includes('deal')) {
        team = 'execution';
      } else if (a.event.includes('research') || a.event.includes('walk_forward') || a.event.includes('approval')) {
        team = 'research';
      }
      list.push({
        id: `audit_${a.id}`,
        ts: a.ts,
        team,
        type: 'audit',
        event: a.event,
        actor: a.actor,
        status: 'completed',
        detail: typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail),
      });
    });

    // From jobs (Research Walk-Forward)
    (monitorData.jobs || []).forEach((j: any) => {
      list.push({
        id: `job_${j.id}`,
        ts: j.created || Date.now() / 1000,
        team: 'research',
        type: 'job',
        event: 'walk_forward_evaluation',
        actor: 'langgraph_worker',
        status: j.state === 'waiting_approval' ? 'waiting' : j.state === 'completed' ? 'completed' : j.state === 'running' ? 'running' : 'error',
        detail: `Proposal ID: ${j.id} · Decision: ${j.decision || 'Chờ duyệt'}`,
      });
    });

    // From recent orders
    (dashboard.orders || []).forEach((o: any) => {
      list.push({
        id: `disp_${o.id}`,
        ts: o.created || Date.now() / 1000,
        team: 'execution',
        type: 'dispatch',
        event: `order_${o.side.toLowerCase()}`,
        actor: o.source,
        status: o.state === 'filled' ? 'completed' : o.state === 'rejected' ? 'error' : o.state === 'queued' ? 'waiting' : 'running',
        detail: `Signal: ${o.signal_id} · Ticket: ${o.ticket || '—'} · Deal: ${o.deal || '—'}${o.reason ? ` · Lý do: ${o.reason}` : ''}`,
      });
    });

    // Sort descending by timestamp
    return list.sort((a, b) => b.ts - a.ts);
  }, [monitorData, dashboard]);

  const filteredActivities = useMemo(() => {
    return consolidatedActivities.filter((item) => {
      if (activityTeamFilter !== 'all' && item.team !== activityTeamFilter) return false;
      if (activityStatusFilter !== 'all' && item.status !== activityStatusFilter) return false;
      if (activitySearchQuery.trim()) {
        const q = activitySearchQuery.toLowerCase();
        const matches =
          item.id.toLowerCase().includes(q) ||
          item.event.toLowerCase().includes(q) ||
          item.detail.toLowerCase().includes(q) ||
          item.actor.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [consolidatedActivities, activityTeamFilter, activityStatusFilter, activitySearchQuery]);

  // Calculations for User Dashboard
  const accounts = dashboard.accounts || [];
  const orders = dashboard.orders || [];
  const totalBalance = accounts.reduce((acc: number, a: any) => acc + (a.balance || 0), 0);
  const totalEquity = accounts.reduce((acc: number, a: any) => acc + (a.equity || 0), 0);
  const totalPositions = accounts.reduce((acc: number, a: any) => acc + (a.positions || 0), 0);
  const totalPnl = totalEquity - totalBalance;

  // Render SVG Candlestick Chart
  const renderCandlestickSvg = () => {
    if (!candles || candles.length === 0) {
      return (
        <div className="h-64 flex flex-col items-center justify-center text-slate-500 font-mono text-xs">
          <span>Chưa có dữ liệu nến cho khung {timeframe}</span>
          <span className="text-[10px] mt-1 text-slate-600">Nguồn: PostgreSQL/TimescaleDB hypertable</span>
        </div>
      );
    }

    const minLow = Math.min(...candles.map((c) => c.low));
    const maxHigh = Math.max(...candles.map((c) => c.high));
    const range = Math.max(maxHigh - minLow, 1.0);
    const width = 800;
    const height = 240;
    const padding = 25;
    const chartH = height - padding * 2;
    const barWidth = Math.max(width / (candles.length * 1.5), 6);

    const yOf = (val: number) => height - padding - ((val - minLow) / range) * chartH;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-64 overflow-visible font-mono">
        <line x1={0} x2={width} y1={yOf(maxHigh)} y2={yOf(maxHigh)} stroke="#334155" strokeDasharray="3 3" />
        <line x1={0} x2={width} y1={yOf(minLow)} y2={yOf(minLow)} stroke="#334155" strokeDasharray="3 3" />
        <text x={10} y={yOf(maxHigh) - 4} fill="#64748b" fontSize="10">High: ${maxHigh.toFixed(2)}</text>
        <text x={10} y={yOf(minLow) + 12} fill="#64748b" fontSize="10">Low: ${minLow.toFixed(2)}</text>

        {candles.map((c, i) => {
          const x = padding + (i / Math.max(candles.length - 1, 1)) * (width - padding * 2);
          const isUp = c.close >= c.open;
          const color = isUp ? '#10b981' : '#f43f5e';
          const top = yOf(Math.max(c.open, c.close));
          const bot = yOf(Math.min(c.open, c.close));
          const bodyH = Math.max(bot - top, 2);

          return (
            <g key={i} className="hover:opacity-80 transition-opacity">
              <line x1={x} x2={x} y1={yOf(c.high)} y2={yOf(c.low)} stroke={color} strokeWidth="1.2" />
              <rect x={x - barWidth / 2} y={top} width={barWidth} height={bodyH} fill={color} rx="1" />
            </g>
          );
        })}
      </svg>
    );
  };

  // If loading session
  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#070b14] text-slate-300 flex items-center justify-center font-mono text-xs">
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 rounded-full bg-cyan-400 animate-ping" />
          <span>Đang khởi động ZUPIRUS Quant Lab...</span>
        </div>
      </div>
    );
  }

  // If unauthenticated: render login / register screen according to active portal
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans">
        {/* Top Navbar */}
        <header className="border-b border-slate-800 bg-[#0c1322] px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold tracking-tight text-lg text-cyan-400 font-mono">Z◈ ZUPIRUS QUANT LAB</span>
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-mono text-slate-300">
              v0.2.0 · TimescaleDB + Redis + AI SDK 6
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPortal(portal === 'user' ? 'admin' : 'user')}
              className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-mono text-cyan-300 transition-colors"
            >
              {portal === 'user' ? 'Chuyển sang Cổng Quản Trị (adm.zupirus.com) ↗' : 'Chuyển sang Cổng Người Dùng (zupirus.com) ↗'}
            </button>
          </div>
        </header>

        {/* Auth Container */}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0d1424] p-8 shadow-2xl space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-bold text-xl font-mono">
                Z
              </div>
              <h1 className="text-xl font-bold tracking-tight text-slate-100">
                {portal === 'admin' ? 'Cổng Quản Trị Hệ Thống (adm.zupirus.com)' : 'Cổng Khách Hàng (zupirus.com)'}
              </h1>
              <p className="text-xs text-slate-400">
                {portal === 'admin'
                  ? 'Yêu cầu tài khoản có quyền Quản trị viên để truy cập Control Plane'
                  : 'Nền tảng phân tích định lượng XAUUSD M15 & sao chép lệnh MT5 Demo'}
              </p>
            </div>

            {/* User portal can toggle login / register; Admin portal is login only */}
            {portal === 'user' && (
              <div className="flex rounded-lg bg-slate-900/80 p-1 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setAuthTab('login')}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-all ${
                    authTab === 'login' ? 'bg-cyan-500 text-slate-950 font-bold shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Đăng Nhập
                </button>
                <button
                  type="button"
                  onClick={() => setAuthTab('register')}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-all ${
                    authTab === 'register' ? 'bg-cyan-500 text-slate-950 font-bold shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Đăng Ký Mới
                </button>
              </div>
            )}

            {authError && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-300 font-mono">
                ⚠ {authError}
              </div>
            )}

            <form onSubmit={authTab === 'login' || portal === 'admin' ? handleLogin : handleRegister} className="space-y-4">
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">ĐỊA CHỈ EMAIL</label>
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder={portal === 'admin' ? 'admin@zupirus.com' : 'user@zupirus.com'}
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">MẬT KHẨU</label>
                <input
                  type="password"
                  required
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2.5 text-xs transition-colors shadow-lg shadow-cyan-500/20 disabled:opacity-50"
              >
                {authLoading ? 'Đang xác thực...' : authTab === 'login' || portal === 'admin' ? 'Đăng Nhập Vào Hệ Thống →' : 'Tạo Tài Khoản Mới →'}
              </button>
            </form>

            <div className="border-t border-slate-800/80 pt-4 text-center">
              <div className="text-[11px] text-slate-500 font-mono">
                {portal === 'admin' ? 'Gợi ý tài khoản demo: admin@zupirus.com' : 'Gợi ý tài khoản demo: test@zupirus.com'}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // AUTHENTICATED: RENDER USER PORTAL OR ADMIN PORTAL
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans">
      {/* Universal Header */}
      <header className="border-b border-slate-800 bg-[#0c1322] px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-tight text-base sm:text-lg text-cyan-400 font-mono flex items-center gap-2">
            <span>Z◈</span>
            <span>{portal === 'admin' ? 'ZUPIRUS ADMIN CONTROL' : 'ZUPIRUS QUANT LAB'}</span>
          </span>
          <span className="hidden md:inline-flex rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-mono text-slate-300">
            {portal === 'admin' ? 'adm.zupirus.com' : 'zupirus.com'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded bg-emerald-950/70 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            DEMO & REPLAY ONLY · REAL LOCKED
          </span>
        </div>

        {/* User Info & Switcher */}
        <div className="flex items-center gap-3">
          {/* Quick portal switch */}
          <button
            onClick={() => setPortal(portal === 'user' ? 'admin' : 'user')}
            className="rounded bg-slate-800/90 hover:bg-slate-700 border border-slate-700 px-2.5 py-1 text-[11px] font-mono text-cyan-300 transition-colors"
            title="Chuyển chế độ xem cổng"
          >
            {portal === 'user' ? 'Cổng Admin ↗' : 'Cổng Khách Hàng ↗'}
          </button>

          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-semibold text-slate-200">{currentUser.email}</span>
            <span className="text-[10px] font-mono text-cyan-400 uppercase">
              {currentUser.role === 'admin' ? 'Quản Trị Viên' : 'Khách Hàng'}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="rounded bg-slate-800 hover:bg-rose-950/50 hover:text-rose-300 border border-slate-700 px-2.5 py-1 text-xs transition-colors"
          >
            Đăng xuất
          </button>
        </div>
      </header>

      {/* Portal-Specific Subnavigation */}
      <div className="border-b border-slate-800 bg-[#090e1a] px-4 sm:px-6 py-2 overflow-x-auto">
        <nav className="flex gap-2 text-xs">
          {portal === 'user' ? (
            <>
              {(
                [
                  ['overview', 'Tổng Quan Vốn & Lãi Lỗ'],
                  ['accounts', `Tài Khoản & Ghép Nối EA (${accounts.length})`],
                  ['orders', `Nhật Ký Lệnh & Khớp Deal (${orders.length})`],
                  ['assistant', 'Trợ Lý AI (Vercel SDK 6)'],
                ] as Array<[UserTabKey, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setUserTab(key)}
                  className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                    userTab === key
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  {label}
                </button>
              ))}
            </>
          ) : (
            <>
              {(
                [
                  ['overview', 'Hai Đội Agent & Giám Sát Vận Hành'],
                  ['approvals', 'Hàng Đợi Phê Duyệt Chiến Lược (AI SDK 6)'],
                  ['activity', `Nhật Ký Toàn Hệ Thống (${consolidatedActivities.length})`],
                  ['tracing', 'LangSmith Tracing Telemetry'],
                  ['news', 'Lịch Rủi Ro Tin Tức USD'],
                ] as Array<[AdminTabKey, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setAdminTab(key)}
                  className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                    adminTab === key
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  {label}
                </button>
              ))}
            </>
          )}
        </nav>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {notice && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-xs text-amber-200 font-mono flex items-center justify-between">
            <span>■ {notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-amber-400 hover:text-amber-200 font-bold ml-4"
            >
              ✕
            </button>
          </div>
        )}

        {/* ================================================================= */}
        {/* USER PORTAL VIEWS */}
        {/* ================================================================= */}
        {portal === 'user' && (
          <>
            {/* USER TAB: OVERVIEW */}
            {userTab === 'overview' && (
              <div className="space-y-6">
                {/* Metric Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-4 font-mono">
                    <div className="text-[11px] text-slate-500">TỔNG SỐ DƯ (BALANCE)</div>
                    <div className="text-xl font-bold text-slate-100 mt-1">${totalBalance.toLocaleString()}</div>
                    <div className="text-[10px] text-slate-500 mt-1">{accounts.length} tài khoản liên kết</div>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-4 font-mono">
                    <div className="text-[11px] text-slate-500">VỐN THẢ NỔI (EQUITY)</div>
                    <div className="text-xl font-bold text-cyan-300 mt-1">${totalEquity.toLocaleString()}</div>
                    <div className={`text-[10px] mt-1 ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {totalPnl >= 0 ? `+${totalPnl.toFixed(2)}` : `${totalPnl.toFixed(2)}`} P&L thả nổi
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-4 font-mono">
                    <div className="text-[11px] text-slate-500">VỊ THẾ ĐANG MỞ</div>
                    <div className="text-xl font-bold text-slate-100 mt-1">{totalPositions}</div>
                    <div className="text-[10px] text-emerald-400 mt-1">Giới hạn max 3 lệnh/tài khoản</div>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-4 font-mono">
                    <div className="text-[11px] text-slate-500">BẢO VỆ RỦI RO (DD LIMIT)</div>
                    <div className="text-xl font-bold text-emerald-400 mt-1">&lt; 5.0%</div>
                    <div className="text-[10px] text-slate-400 mt-1">Hard lock tự động khi DD &gt; 5%</div>
                  </div>
                </div>

                {/* Market Chart */}
                <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-200">XAUUSD Chuỗi Thời Gian · TimescaleDB</span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                        Hypertable Chunks
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-xs font-mono">
                        {(['M1', 'M5', 'M15', 'H1', 'D1'] as const).map((tf) => (
                          <button
                            key={tf}
                            onClick={() => {
                              setTimeframe(tf);
                              loadCandles(tf);
                            }}
                            className={`px-2 py-0.5 rounded ${
                              timeframe === tf ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {tf}
                          </button>
                        ))}
                      </div>

                      <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-xs font-mono">
                        <button
                          onClick={() => setChartMode('equity')}
                          className={`px-2 py-0.5 rounded ${
                            chartMode === 'equity' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Vốn
                        </button>
                        <button
                          onClick={() => setChartMode('candles')}
                          className={`px-2 py-0.5 rounded ${
                            chartMode === 'candles' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Nến
                        </button>
                      </div>
                    </div>
                  </div>

                  {chartMode === 'candles' ? (
                    renderCandlestickSvg()
                  ) : (
                    <div className="h-64 flex flex-col items-center justify-center text-slate-500 font-mono text-xs">
                      <div className="text-cyan-400 font-bold text-lg mb-1">${totalEquity.toLocaleString()}</div>
                      <span>Đường cong vốn tài khoản khách hàng (Cập nhật theo nhịp tick)</span>
                      <span className="text-[10px] text-slate-600 mt-1">Nguồn: snapshots hypertable PostgreSQL</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* USER TAB: ACCOUNTS & EA PAIRING */}
            {userTab === 'accounts' && (
              <div className="space-y-6">
                {/* Form Add Demo Account & Pair EA */}
                <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                  <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
                    <span>🔌 Ghép Nối EA MT5 Demo Mới</span>
                    <span className="text-xs font-normal text-slate-400">(Nhận tín hiệu trực tiếp qua WebRequest HTTP)</span>
                  </h3>

                  <form onSubmit={handleAddDemoAccount} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-mono text-slate-400 mb-1">SỐ LOGIN MT5 DEMO</label>
                      <input
                        type="text"
                        required
                        value={newDemoLogin}
                        onChange={(e) => setNewDemoLogin(e.target.value)}
                        placeholder="Ví dụ: 61713217"
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-mono text-slate-400 mb-1">TÊN SERVER BROKER DEMO</label>
                      <input
                        type="text"
                        required
                        value={newDemoServer}
                        onChange={(e) => setNewDemoServer(e.target.value)}
                        placeholder="Ví dụ: MetaQuotes-Demo hoặc ICMarketsSC-Demo"
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
                      />
                    </div>

                    <div className="flex items-end gap-2">
                      <button
                        type="submit"
                        className="flex-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2 text-xs transition-colors"
                      >
                        Tạo & Sinh Mã Ghép Nối ↗
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateReplay}
                        className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-2 text-xs text-slate-300 transition-colors whitespace-nowrap"
                        title="Tạo tài khoản giả lập replay để test nhanh không cần mở MT5"
                      >
                        + Replay Test
                      </button>
                    </div>
                  </form>
                </div>

                {/* Account List */}
                <div className="rounded-xl border border-slate-800 bg-[#0d1424] overflow-hidden">
                  <div className="border-b border-slate-800 px-5 py-3 flex items-center justify-between">
                    <span className="font-bold text-sm text-slate-200">Danh Sách Tài Khoản Đang Liên Kết</span>
                    <span className="text-xs font-mono text-slate-400">{accounts.length} tài khoản</span>
                  </div>

                  {accounts.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 font-mono text-xs">
                      Chưa có tài khoản nào được kết nối. Hãy thêm tài khoản Demo ở trên.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/80">
                      {accounts.map((a: any) => {
                        const code = pairCodes[a.id];
                        const isOnline = a.seen && Date.now() / 1000 - a.seen < 45;
                        return (
                          <div key={a.id} className="p-5 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                                <span className="font-bold font-mono text-sm text-slate-100">
                                  #{a.login} · {a.server}
                                </span>
                                <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                                  {a.mode}
                                </span>
                                <span
                                  className={`rounded px-2 py-0.5 text-[10px] font-mono ${
                                    a.enabled ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' : 'bg-rose-950 text-rose-300 border border-rose-700/50'
                                  }`}
                                >
                                  {a.enabled ? 'ĐANG SAO CHÉP' : 'TẠM DỪNG'}
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleToggleCopy(a.id, a.enabled)}
                                  className={`rounded-lg px-3 py-1 text-xs font-mono font-medium transition-colors ${
                                    a.enabled
                                      ? 'bg-amber-950/80 text-amber-300 border border-amber-700/40 hover:bg-amber-900/80'
                                      : 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/40 hover:bg-emerald-900/80'
                                  }`}
                                >
                                  {a.enabled ? 'Tạm Dừng Sao Chép' : 'Bật Sao Chép'}
                                </button>

                                <button
                                  onClick={() => handleCreatePairCode(a.id)}
                                  className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1 text-xs font-mono text-slate-300 transition-colors"
                                >
                                  Cấp Mã Ghép Nối
                                </button>

                                <button
                                  onClick={() => handleRevoke(a.id)}
                                  className="rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 px-3 py-1 text-xs font-mono text-rose-300 transition-colors"
                                >
                                  Thu Hồi
                                </button>
                              </div>
                            </div>

                            {/* Metrics details */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono bg-slate-950/40 p-3 rounded-lg border border-slate-800/50">
                              <div>
                                <span className="text-slate-500 text-[10px] block">SỐ DƯ (BALANCE)</span>
                                <span className="font-bold text-slate-200">${Number(a.balance || 0).toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 text-[10px] block">VỐN (EQUITY)</span>
                                <span className="font-bold text-cyan-300">${Number(a.equity || 0).toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 text-[10px] block">DRAWDOWN HIỆN TẠI</span>
                                <span className="font-bold text-slate-300">
                                  {(((a.peak - a.equity) / Math.max(a.peak, 1)) * 100).toFixed(2)}%
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500 text-[10px] block">HEARTBEAT GẦN NHẤT</span>
                                <span className="text-slate-400">
                                  {a.seen ? `${Math.round(Date.now() / 1000 - a.seen)}s trước` : 'Chưa có'}
                                </span>
                              </div>
                            </div>

                            {/* Pairing box if generated */}
                            {code && (
                              <div className="rounded-lg border border-cyan-500/40 bg-cyan-950/20 p-3 text-xs font-mono space-y-1">
                                <div className="text-cyan-300 font-bold flex items-center justify-between">
                                  <span>MÃ GHÉP NỐI EA DÙNG MỘT LẦN: {code}</span>
                                  <span className="text-[10px] text-slate-400">TTL 10 phút</span>
                                </div>
                                <p className="text-slate-400 text-[11px]">
                                  Trong MT5 chart XAUUSD, mở Inputs của EA <code className="text-cyan-200">Zupirus_Demo_Link_EA</code>:
                                </p>
                                <div className="bg-slate-900/80 p-2 rounded text-[11px] text-slate-300 select-all">
                                  InpServerUrl = <span className="text-cyan-300">{window.location.origin}</span>
                                  <br />
                                  InpPairingCode = <span className="text-cyan-300">{code}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* USER TAB: ORDERS & DEALS */}
            {userTab === 'orders' && (
              <div className="space-y-6">
                <div className="rounded-xl border border-slate-800 bg-[#0d1424] overflow-hidden">
                  <div className="border-b border-slate-800 px-5 py-3 flex items-center justify-between">
                    <span className="font-bold text-sm text-slate-200">Nhật Ký Tín Hiệu & Đối Soát Lệnh Thực Thi</span>
                    <span className="text-xs font-mono text-slate-400">{orders.length} lệnh</span>
                  </div>

                  {orders.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 font-mono text-xs">
                      Chưa có lệnh nào được tạo. Khi Quant Engine phát tín hiệu hoặc EA khớp lệnh, bản ghi sẽ xuất hiện tại đây.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-slate-950/60 border-b border-slate-800 text-[11px] text-slate-400">
                          <tr>
                            <th className="p-3">ID / TÍN HIỆU</th>
                            <th className="p-3">NGUỒN</th>
                            <th className="p-3">CHIỀU</th>
                            <th className="p-3">GIÁ VÀO</th>
                            <th className="p-3">SL / TP</th>
                            <th className="p-3">TICKET / DEAL</th>
                            <th className="p-3">TRẠNG THÁI</th>
                            <th className="p-3">LÝ DO THỰC TẾ (NẾU BỎ LỠ/TỪ CHỐI)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {orders.map((o: any) => {
                            let reasonText = o.reason || '—';
                            if (o.state === 'rejected' && o.reason === 'below_min_lot') {
                              reasonText = 'Vốn hoặc tỷ lệ rủi ro không đủ mở khối lượng tối thiểu (0.01 lot)';
                            } else if (o.state === 'expired') {
                              reasonText = 'Hết hạn nhận lệnh (quá 45s EA không phản hồi)';
                            } else if (o.state === 'cancelled') {
                              reasonText = 'Tài khoản tạm dừng sao chép hoặc vượt ngưỡng Max DD > 5%';
                            }

                            return (
                              <tr key={o.id} className="hover:bg-slate-900/40">
                                <td className="p-3 font-bold text-slate-300">#{o.id}</td>
                                <td className="p-3">
                                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-cyan-300">
                                    {o.source}
                                  </span>
                                </td>
                                <td className="p-3">
                                  <span className={o.side === 'BUY' ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                                    {o.side}
                                  </span>
                                </td>
                                <td className="p-3 text-slate-200">${Number(o.price).toFixed(2)}</td>
                                <td className="p-3 text-slate-400">
                                  ${Number(o.sl).toFixed(1)} / ${Number(o.tp).toFixed(1)}
                                </td>
                                <td className="p-3 text-slate-300">
                                  {o.ticket || '—'} {o.deal ? `/ Deal: ${o.deal}` : ''}
                                </td>
                                <td className="p-3">
                                  <span
                                    className={`rounded px-2 py-0.5 text-[10px] uppercase font-bold ${
                                      o.state === 'filled'
                                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50'
                                        : o.state === 'queued'
                                        ? 'bg-amber-950 text-amber-300 border border-amber-700/50 animate-pulse'
                                        : 'bg-rose-950 text-rose-300 border border-rose-700/50'
                                    }`}
                                  >
                                    {o.state}
                                  </span>
                                </td>
                                <td className="p-3 text-slate-400 max-w-xs truncate" title={reasonText}>
                                  {reasonText}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* USER TAB: ASSISTANT */}
            {userTab === 'assistant' && (
              <div className="space-y-4">
                <CustomerAssistant />
              </div>
            )}
          </>
        )}

        {/* ================================================================= */}
        {/* ADMIN PORTAL VIEWS */}
        {/* ================================================================= */}
        {portal === 'admin' && (
          <>
            {/* ADMIN TAB: TWO AGENT TEAMS & OVERVIEW */}
            {adminTab === 'overview' && (
              <div className="space-y-6">
                {/* Kill Switch Banner */}
                <div
                  className={`rounded-xl border p-5 transition-colors ${
                    monitorData.halted
                      ? 'border-rose-500/60 bg-rose-950/40 text-rose-200'
                      : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <span className={`h-3 w-3 rounded-full ${monitorData.halted ? 'bg-rose-500 animate-ping' : 'bg-emerald-400'}`} />
                        <span>NÚT NGẮT KHẨN CẤP TOÀN HỆ THỐNG (SYSTEM KILL-SWITCH)</span>
                      </div>
                      <p className="text-xs text-slate-300">
                        {monitorData.halted
                          ? 'HỆ THỐNG ĐANG DỪNG: Toàn bộ việc cấp tín hiệu và gửi lệnh copy đã bị chặn hoàn toàn.'
                          : 'HỆ THỐNG ĐANG HOẠT ĐỘNG: Tín hiệu và lệnh sao chép được cấp phát bình thường.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={killSwitchReason}
                        onChange={(e) => setKillSwitchReason(e.target.value)}
                        placeholder="Lý do thao tác..."
                        className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 font-mono"
                      />
                      <button
                        onClick={() => handleToggleKillSwitch(monitorData.halted)}
                        disabled={killSwitchLoading}
                        className={`rounded-lg px-4 py-2 text-xs font-bold font-mono transition-colors shadow ${
                          monitorData.halted
                            ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                            : 'bg-rose-600 hover:bg-rose-500 text-white'
                        }`}
                      >
                        {killSwitchLoading
                          ? 'Đang xử lý...'
                          : monitorData.halted
                          ? 'Khôi Phục Vận Hành ↗'
                          : 'KÍCH HOẠT KILL-SWITCH ✕'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* The Two Agent Teams */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* TEAM 1: Execution & Real-Time Dispatch Team */}
                  <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
                        <h3 className="font-bold text-sm text-slate-100">Đội Phân Tích & Thực Thi (Execution Team)</h3>
                      </div>
                      <span className="rounded bg-cyan-950/70 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                        Deterministic Engine
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">
                      Chịu trách nhiệm tiếp nhận tick nến XAUUSD chuỗi thời gian, điều phối đa chiến lược (Trend Following,
                      Mean Reversion, Breakout), kiểm tra risk gate, đẩy vào Transactional Outbox và phân phối qua Redis Streams.
                    </p>

                    <div className="space-y-2 text-xs font-mono bg-slate-950/40 p-3 rounded-lg border border-slate-800/60">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Trạng thái vận hành:</span>
                        <span className="text-emerald-400 font-bold">
                          {monitorData.halted ? 'HALTED' : 'RUNNING (Loop 2s)'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Heartbeat gần nhất:</span>
                        <span className="text-slate-200">
                          {readyData?.execution_worker?.heartbeat_active ? 'Healthy (<60s)' : 'Active (Local WAL)'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Redis Stream Outbox:</span>
                        <span className="text-cyan-300">stream:signals (Pub/Sub & ACK)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Distributed Lock:</span>
                        <span className="text-slate-300">lock:dispatch:aid:sid (Anti-Duplicate)</span>
                      </div>
                    </div>
                  </div>

                  {/* TEAM 2: Research & Validation Team */}
                  <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                        <h3 className="font-bold text-sm text-slate-100">Đội Nghiên Cứu & Kiểm Định (Research Team)</h3>
                      </div>
                      <span className="rounded bg-amber-950/70 border border-amber-500/30 px-2 py-0.5 text-[10px] font-mono text-amber-300">
                        LangGraph Checkpoint
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">
                      Chạy Walk-Forward out-of-sample loại trừ chồng lấn, đánh giá candidate strategy có trừ phí/spread.
                      Tạo interrupt checkpoint chờ Admin phê duyệt trước khi lưu trữ ứng viên.
                    </p>

                    <div className="space-y-2 text-xs font-mono bg-slate-950/40 p-3 rounded-lg border border-slate-800/60">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Mô hình kiểm định:</span>
                        <span className="text-amber-300">Walk-Forward 120 Train / 60 OOS</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">LangGraph Checkpointer:</span>
                        <span className="text-slate-200">PostgresSaver / SqliteSaver Durable</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Đề xuất chờ duyệt:</span>
                        <span className="text-amber-400 font-bold">
                          {(monitorData.jobs || []).filter((j: any) => j.state === 'waiting_approval').length} chiến lược
                        </span>
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        onClick={handleStartResearch}
                        className="w-full rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold py-2 text-xs font-mono transition-colors"
                      >
                        + Kích Hoạt Vòng Kiểm Định Walk-Forward Mới
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ADMIN TAB: STRATEGY APPROVALS */}
            {adminTab === 'approvals' && (
              <div className="space-y-6">
                <AdminApprovalQueue />
              </div>
            )}

            {/* ADMIN TAB: CONSOLIDATED ACTIVITY LOGS */}
            {adminTab === 'activity' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                    <h3 className="font-bold text-sm text-slate-200">
                      Nhật Ký Hoạt Động Toàn Hệ Thống & Truy Vết
                    </h3>

                    {/* Filter controls */}
                    <div className="flex flex-wrap items-center gap-2">
                      <select
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
                        value={activityStatusFilter}
                        onChange={(e: any) => setActivityStatusFilter(e.target.value)}
                        className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-slate-200 font-mono"
                      >
                        <option value="all">Tất cả trạng thái</option>
                        <option value="running">Đang chạy</option>
                        <option value="waiting">Đang chờ</option>
                        <option value="completed">Hoàn tất</option>
                        <option value="error">Lỗi</option>
                      </select>

                      <input
                        type="text"
                        value={activitySearchQuery}
                        onChange={(e) => setActivitySearchQuery(e.target.value)}
                        placeholder="Tìm ID tín hiệu / job / cycle..."
                        className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-1 text-xs text-slate-200 font-mono placeholder-slate-500"
                      />
                    </div>
                  </div>

                  {filteredActivities.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 font-mono text-xs">
                      Không tìm thấy bản ghi hoạt động nào phù hợp với bộ lọc.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs font-mono">
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
                              <td className="p-3 text-slate-400 whitespace-nowrap">
                                {new Date(item.ts * 1000).toLocaleTimeString()}
                              </td>
                              <td className="p-3">
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
                              <td className="p-3 font-semibold text-slate-200">{item.event}</td>
                              <td className="p-3 text-slate-400">{item.actor}</td>
                              <td className="p-3">
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase font-bold ${
                                    item.status === 'completed'
                                      ? 'bg-emerald-950 text-emerald-300'
                                      : item.status === 'waiting'
                                      ? 'bg-amber-950 text-amber-300'
                                      : item.status === 'running'
                                      ? 'bg-cyan-950 text-cyan-300 animate-pulse'
                                      : 'bg-rose-950 text-rose-300'
                                  }`}
                                >
                                  {item.status}
                                </span>
                              </td>
                              <td className="p-3 text-slate-300 max-w-sm truncate" title={item.detail}>
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
            )}

            {/* ADMIN TAB: LANGSMITH TRACING */}
            {adminTab === 'tracing' && (
              <div className="space-y-6">
                <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-200">LangSmith Tracing Telemetry</span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                        {tracingData.project}
                      </span>
                    </div>

                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-mono ${
                        tracingData.langsmith_connected
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {tracingData.langsmith_connected ? 'CONNECTED TO CLOUD' : 'OFFLINE BUFFER MODE'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
                    <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">TỔNG TRACES ĐÃ GHI</span>
                      <span className="text-lg font-bold text-slate-100 mt-1">{tracingData.total_traces_recorded}</span>
                    </div>
                    <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">TRUY VẾT LANGGRAPH</span>
                      <span className="text-lg font-bold text-cyan-300 mt-1">Bật (StateGraph)</span>
                    </div>
                    <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">VERCEL AI SDK 6</span>
                      <span className="text-lg font-bold text-amber-300 mt-1">Traced (ToolLoop)</span>
                    </div>
                    <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">BẢO MẬT BÍ MẬT</span>
                      <span className="text-lg font-bold text-emerald-400 mt-1">Sanitized [REDACTED]</span>
                    </div>
                  </div>

                  {/* Recent trace events */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-300">Các vết suy luận gần nhất:</h4>
                    {tracingData.recent_traces?.length === 0 ? (
                      <div className="p-4 text-center text-slate-500 font-mono text-xs">
                        Chưa có trace event nào được ghi. Khi AI hoặc LangGraph chạy, vết sự kiện sẽ hiển thị ở đây.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {tracingData.recent_traces.map((t: any, idx: number) => (
                          <div
                            key={idx}
                            className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded bg-slate-950/60 border border-slate-800/80 font-mono text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-cyan-400 font-bold">{t.run_type || 'llm'}</span>
                              <span className="text-slate-300">{t.name}</span>
                            </div>
                            <div className="flex items-center gap-3 text-slate-400 text-[11px]">
                              <span>Độ trễ: {Number(t.latency_ms || 0).toFixed(1)}ms</span>
                              <span>Tokens: {(t.prompt_tokens || 0) + (t.completion_tokens || 0)}</span>
                              <span className={t.status === 'success' ? 'text-emerald-400' : 'text-rose-400'}>
                                {t.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ADMIN TAB: NEWS BLACKOUT */}
            {adminTab === 'news' && (
              <div className="space-y-6">
                <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                  <h3 className="font-bold text-sm text-slate-200">Thêm Sự Kiện Lịch Kinh Tế USD High Impact</h3>
                  <p className="text-xs text-slate-400">
                    Cơ chế bảo vệ tài khoản: Tự động chặn mở lệnh mới trong khoảng ±15 phút trước và sau thời điểm ra tin.
                  </p>

                  <form onSubmit={handleAddNews} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      type="text"
                      required
                      value={newsTitle}
                      onChange={(e) => setNewsTitle(e.target.value)}
                      placeholder="Tên tin (ví dụ: US Non-Farm Payrolls)"
                      className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 font-mono"
                    />

                    <input
                      type="datetime-local"
                      value={newsWhen}
                      onChange={(e) => setNewsWhen(e.target.value)}
                      className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 font-mono"
                    />

                    <button
                      type="submit"
                      className="rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2 text-xs font-mono transition-colors"
                    >
                      + Thêm Khung Giờ Chặn Lệnh
                    </button>
                  </form>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-[#080d1a] px-6 py-4 text-center text-xs text-slate-500 font-mono">
        ZUPIRUS Quant Lab · Phiên bản 0.2.0 · Khóa cứng giao dịch tiền thật · PostgreSQL + TimescaleDB + Redis Streams + LangSmith + Vercel AI SDK 6
      </footer>
    </div>
  );
};

export default App;
