import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { EquityHistory } from './components/EquityHistory.tsx';
import { PortalAuth, PortalShell } from './components/PortalChrome.tsx';

const CustomerAssistant = lazy(() => import('./components/CustomerAssistant.tsx').then((module) => ({ default: module.CustomerAssistant })));
const AdminApprovalQueue = lazy(() => import('./components/AdminApprovalQueue.tsx').then((module) => ({ default: module.AdminApprovalQueue })));

type CopyAccount = { id: string; enabled: boolean; risk: number; max_spread: number; max_positions: number; max_dd: number };

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
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [dashboardStatus, setDashboardStatus] = useState('loading');
  const [monitorStatus, setMonitorStatus] = useState('loading');
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
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [candles, setCandles] = useState<any[]>([]);
  const [timeframe, setTimeframe] = useState<'M1' | 'M5' | 'M15' | 'H1' | 'D1'>('M15');
  const [chartMode, setChartMode] = useState<'equity' | 'candles'>('equity');

  // Admin & Monitoring state
  const [monitorData, setMonitorData] = useState<any>({ accounts: [], audit: [], jobs: [], news: [], halted: null });
  const [tracingData, setTracingData] = useState<any>({
    langsmith_configured: false,
    project: 'zupirus-quant-lab',
    total_traces_recorded: 0,
    recent_traces: [],
  });
  const [readyData, setReadyData] = useState<any>(null);

  // Activity filter state
  const [activityTeamFilter, setActivityTeamFilter] = useState<'all' | 'execution' | 'research' | 'security'>('all');
  const [activityStatusFilter, setActivityStatusFilter] = useState<'all' | 'running' | 'waiting' | 'completed' | 'error' | 'stale'>('all');
  const [activitySearchQuery, setActivitySearchQuery] = useState<string>('');

  // User Order Filters
  const [orderAccountFilter, setOrderAccountFilter] = useState<string>('all');
  const [orderStateFilter, setOrderStateFilter] = useState<string>('all');

  // Admin Orders state (from /api/admin/orders)
  const [adminOrders, setAdminOrders] = useState<any[]>([]);
  const [adminOrdersTotal, setAdminOrdersTotal] = useState<number>(0);
  const [adminOrderPage, setAdminOrderPage] = useState<number>(0);
  const [adminAccountFilter, setAdminAccountFilter] = useState<string>('all');
  const [adminViewMode, setAdminViewMode] = useState<'orders' | 'activity'>('orders');

  // Risk Calendar state
  const [editingNews, setEditingNews] = useState<any | null>(null);
  const [editNewsTitle, setEditNewsTitle] = useState<string>('');
  const [editNewsWhen, setEditNewsWhen] = useState<string>('');
  const [editNewsImpact, setEditNewsImpact] = useState<'high' | 'medium' | 'low'>('high');
  const [editNewsCurrency, setEditNewsCurrency] = useState<'USD' | 'ALL' | 'EUR' | 'OTHER'>('USD');

  // Forms & notices
  const [notice, setNotice] = useState<string | null>(null);
  const [newDemoLogin, setNewDemoLogin] = useState('');
  const [newDemoServer, setNewDemoServer] = useState('');
  const [pairCodes, setPairCodes] = useState<Record<string, string>>({});
  const [newsTitle, setNewsTitle] = useState('');
  const [newsWhen, setNewsWhen] = useState('');
  const [killSwitchLoading, setKillSwitchLoading] = useState(false);

  // Check auth session
  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/me');
      if (res.ok) setCurrentUser(await res.json());
      else if (res.status !== 401) setAuthError('Không thể kiểm tra phiên đăng nhập.');
    } catch {
      setAuthError('Không thể kết nối máy chủ.');
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
        setDashboardStatus('ready');
        setSelectedAccount((prev) => {
          if (prev && d.accounts?.some((a: any) => a.id === prev)) return prev;
          return d.accounts?.[0]?.id || '';
        });
      } else if (res.status === 401) {
        setCurrentUser(null);
        setAuthError('Phiên đăng nhập đã hết hạn.');
      } else {
        setDashboardStatus('offline');
      }
    } catch {
      setDashboardStatus('offline');
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
      if (mRes.ok) {
        setMonitorData(await mRes.json());
        setMonitorStatus('ready');
      } else {
        setMonitorStatus('offline');
      }
      if (tRes.ok) setTracingData(await tRes.json());
      if (rRes.ok || rRes.status === 503) setReadyData(await rRes.json());
    } catch {
      setMonitorStatus('offline');
    }
  }, []);

  const loadAdminOrders = useCallback(async () => {
    if (!currentUser || currentUser.role !== 'admin') return;
    try {
      const params = new URLSearchParams();
      if (adminAccountFilter !== 'all') params.set('account_id', adminAccountFilter);
      if (activityStatusFilter !== 'all') {
        if (activityStatusFilter === 'waiting') params.set('state', 'queued');
        else if (activityStatusFilter === 'completed') params.set('state', 'filled');
        else if (activityStatusFilter === 'error') params.set('state', 'rejected');
      }
      if (activityTeamFilter !== 'all') params.set('team', activityTeamFilter);
      if (activitySearchQuery.trim()) params.set('search', activitySearchQuery.trim());
      params.set('limit', '50');
      params.set('offset', String(adminOrderPage * 50));
      const res = await fetch(`/api/admin/orders?${params.toString()}`);
      if (res.ok) {
        const d = await res.json();
        setAdminOrders(d.orders || []);
        setAdminOrdersTotal(d.total || 0);
      }
    } catch {
      // ignore
    }
  }, [currentUser, adminAccountFilter, activityStatusFilter, activityTeamFilter, activitySearchQuery, adminOrderPage]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (currentUser) {
      loadDashboard();
      loadCandles(timeframe);
      if (currentUser.role === 'admin') {
        loadAdminMonitor();
        loadAdminOrders();
      }
      const timer = setInterval(() => {
        loadDashboard();
        if (chartMode === 'candles') loadCandles(timeframe);
        if (currentUser.role === 'admin') {
          loadAdminMonitor();
          loadAdminOrders();
        }
      }, 5000);
      return () => clearInterval(timer);
    }
  }, [currentUser, loadDashboard, loadCandles, loadAdminMonitor, loadAdminOrders, timeframe, chartMode]);

  const showNotice = (msg: string) => {
    setNotice(msg);
  };

  const authenticate = async (email: string, password: string, register: boolean) => {
    setAuthLoading(true);
    setAuthError(null);
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({ email, password }),
    };
    try {
      if (register) {
        const registration = await fetch('/api/register', options);
        if (!registration.ok) throw new Error(registration.status === 409 ? 'Email đã được đăng ký.' : 'Không thể tạo tài khoản. Kiểm tra email và mật khẩu.');
      }
      const session = await fetch('/api/login', options);
      if (!session.ok) throw new Error(session.status === 401 ? 'Email hoặc mật khẩu không chính xác.' : 'Không thể đăng nhập. Vui lòng thử lại.');
      setDashboardStatus('loading');
      setMonitorStatus('loading');
      setNotice(null);
      setCurrentUser(await session.json());
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Không thể kết nối máy chủ.');
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
    setDashboard({ accounts: [], orders: [], series: [], health: {} });
    setMonitorData({ accounts: [], audit: [], jobs: [], news: [], halted: null });
    setReadyData(null);
    setPairCodes({});
    setNotice(null);
  };

  // EA & Account operations
  const handleToggleCopy = async (account: CopyAccount) => {
    const { id, enabled, risk, max_spread, max_positions, max_dd } = account;
    try {
      const res = await fetch(`/api/accounts/${id}/risk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ enabled: !enabled, risk, max_spread, max_positions, max_dd }),
      });
      if (!res.ok) throw new Error('Không thể thay đổi trạng thái sao chép.');
      showNotice(enabled ? 'Đã tạm dừng sao chép.' : 'Đã bật sao chép.');
      await loadDashboard();
      if (currentUser?.role === 'admin') await loadAdminMonitor();
    } catch {
      showNotice('Không thể thay đổi trạng thái sao chép. Vui lòng thử lại.');
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
      showNotice('Đã cấp mã ghép nối. Xem mã trong tài khoản bên dưới.');
    } else {
      showNotice(res.status === 409 ? 'Hãy thu hồi liên kết hiện tại trước khi cấp mã mới.' : 'Không thể cấp mã ghép nối.');
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
      showNotice(`Đã thêm tài khoản MT5 #${newDemoLogin}. Tiến hành tạo mã ghép nối bên dưới.`);
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
        }),
      });
      if (res.ok) {
        showNotice(nextHalt ? 'ĐÃ KÍCH HOẠT KILL-SWITCH: Toàn bộ việc cấp lệnh copy đã dừng an toàn.' : 'ĐÃ TẮT KILL-SWITCH: Hệ thống tiếp tục vận hành bình thường.');
        await loadDashboard();
        await loadAdminMonitor();
      } else {
        showNotice('Không thể thay đổi trạng thái cấp lệnh.');
      }
    } catch {
      showNotice('Không thể kết nối máy chủ để đổi trạng thái cấp lệnh.');
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
      showNotice('Đã đưa yêu cầu kiểm định Walk-Forward vào hàng đợi.');
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
    } else {
      showNotice('Không thể thêm sự kiện. Vui lòng kiểm tra thời điểm sự kiện.');
    }
  };

  const handleUpdateNews = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNews || !editNewsTitle.trim()) return;
    const ts = editNewsWhen ? new Date(editNewsWhen).getTime() / 1000 : editingNews.ts;
    const res = await fetch(`/api/admin/news/${editingNews.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({
        title: editNewsTitle.trim(),
        currency: editNewsCurrency,
        impact: editNewsImpact,
        ts,
      }),
    });
    if (res.ok) {
      setEditingNews(null);
      showNotice('Đã cập nhật sự kiện lịch rủi ro và ghi nhật ký audit.');
      await loadAdminMonitor();
    } else {
      showNotice('Không thể cập nhật sự kiện.');
    }
  };

  const handleDeleteNews = async (nid: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa sự kiện rủi ro này? Thao tác sẽ được ghi vào nhật ký audit.')) return;
    const res = await fetch(`/api/admin/news/${nid}`, {
      method: 'DELETE',
      headers: { 'X-Zupirus': '1' },
    });
    if (res.ok) {
      showNotice('Đã xóa sự kiện lịch rủi ro và ghi nhật ký audit.');
      await loadAdminMonitor();
    } else {
      showNotice('Không thể xóa sự kiện.');
    }
  };

  const mapBackendState = (state: string) => {
    switch (state) {
      case 'queued': return { label: 'Đang chờ', badge: 'bg-amber-950 text-amber-300 border border-amber-700/50' };
      case 'resume': return { label: 'Chờ tiếp tục', badge: 'bg-blue-950 text-blue-300 border border-blue-700/50' };
      case 'waiting_approval': return { label: 'Chờ duyệt', badge: 'bg-amber-950 text-amber-300 border border-amber-700/50' };
      case 'filled': return { label: 'Đã khớp', badge: 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' };
      case 'completed': return { label: 'Hoàn tất', badge: 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' };
      case 'cancelled': return { label: 'Đã hủy', badge: 'bg-slate-800 text-slate-300 border border-slate-700' };
      case 'expired': return { label: 'Hết hạn', badge: 'bg-slate-800 text-slate-400 border border-slate-700' };
      case 'rejected': return { label: 'Bị từ chối', badge: 'bg-rose-950 text-rose-300 border border-rose-700/50' };
      case 'intent':
      case 'unknown': return { label: 'Chưa đối soát', badge: 'bg-purple-950 text-purple-300 border border-purple-700/50' };
      case 'running': return { label: 'Đang chạy', badge: 'bg-cyan-950 text-cyan-300 border border-cyan-700/50' };
      case 'error': return { label: 'Lỗi', badge: 'bg-rose-950 text-rose-300 border border-rose-700/50' };
      default: return { label: state, badge: 'bg-slate-800 text-slate-300 border border-slate-700' };
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

  const filteredUserOrders = useMemo(() => {
    return orders.filter((o: any) => {
      if (orderAccountFilter !== 'all' && o.account_id !== orderAccountFilter) return false;
      if (orderStateFilter !== 'all' && o.state !== orderStateFilter) return false;
      return true;
    });
  }, [orders, orderAccountFilter, orderStateFilter]);

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

  if (authChecking) return <div className="quant-app quant-loading" role="status">Đang kiểm tra phiên đăng nhập…</div>;
  if (!currentUser) return <PortalAuth portal={portal} loading={authLoading} error={authError} onSubmit={authenticate} />;
  const isAdmin = currentUser.role === 'admin';
  if (portal === 'admin' && !isAdmin) {
    return <div className="quant-app quant-admin quant-loading"><div className="quant-auth-box">
      <h1>Cần quyền quản trị</h1><p>Tài khoản hiện tại không có quyền truy cập.</p>
      <button className="quant-primary" onClick={handleLogout}>Đăng nhập bằng tài khoản khác</button>
    </div></div>;
  }
  const researchTick = Number(dashboard.health?.research_heartbeat);
  const executionTick = Number(dashboard.health?.execution_heartbeat);
  const researchActive = Number.isFinite(researchTick) && Date.now() / 1000 - researchTick < 60;
  const lastResearchJob = monitorData.jobs[0];
  const formatHeartbeat = (timestamp: number) => Number.isFinite(timestamp)
    ? new Date(timestamp * 1000).toLocaleTimeString('vi-VN') : 'Chưa ghi nhận';
  const status = portal === 'admin' ? monitorStatus : dashboardStatus;
  const alternatePortal = portal === 'admin' ? 'user' : 'admin';
  const switchPortal = () => {
    const targetHost = alternatePortal === 'admin' ? 'adm.zupirus.com' : 'zupirus.com';
    if (['zupirus.com', 'www.zupirus.com', 'adm.zupirus.com'].includes(location.hostname)) {
      location.assign(`https://${targetHost}`);
      return;
    }
    setPortal(alternatePortal);
  };
  return (
    <PortalShell portal={portal} page={portal === 'admin' ? adminTab : userTab} email={currentUser.email}
      onNavigate={(page) => portal === 'admin' ? setAdminTab(page as AdminTabKey) : setUserTab(page as UserTabKey)}
      logout={handleLogout} switchPortal={isAdmin ? switchPortal : undefined}>
        {status === 'loading' && <div className="quant-status" role="status">Đang tải dữ liệu…</div>}
        {status === 'offline' && <div className="quant-alert" role="status">Không thể cập nhật. Dữ liệu đang hiển thị có thể đã cũ.</div>}
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
                <div className="quant-metrics grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-4 font-mono">
                    <div className="text-[11px] text-slate-500">Tổng số dư</div>
                    <div className="text-xl font-bold text-slate-100 mt-1">${totalBalance.toLocaleString()}</div>
                    <div className="text-[10px] text-slate-500 mt-1">{accounts.length} tài khoản liên kết</div>
                  </div>

                  <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-4 font-mono">
                    <div className="text-[11px] text-slate-500">Vốn thả nổi</div>
                    <div className="text-xl font-bold text-cyan-300 mt-1">${totalEquity.toLocaleString()}</div>
                    <div className={`text-[10px] mt-1 ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {totalPnl >= 0 ? `+${totalPnl.toFixed(2)}` : `${totalPnl.toFixed(2)}`} P&L thả nổi
                    </div>
                  </div>

                  <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-4 font-mono">
                    <div className="text-[11px] text-slate-500">Vị thế đang mở</div>
                    <div className="text-xl font-bold text-slate-100 mt-1">{totalPositions}</div>
                    <div className="text-[10px] text-slate-400 mt-1">Trên các tài khoản liên kết</div>
                  </div>

                  <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-4 font-mono">
                    <div className="text-[11px] text-slate-500">Đang bật sao chép</div>
                    <div className="text-xl font-bold text-cyan-300 mt-1">{accounts.filter((account: any) => account.enabled).length}</div>
                    <div className="text-[10px] text-slate-400 mt-1">Tài khoản đã bật</div>
                  </div>
                </div>

                {/* Market Chart */}
                <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-200">
                        {chartMode === 'candles' ? `Biểu đồ nến XAU/USD · Khung ${timeframe} (${timeframe === 'M15' ? '15 phút' : timeframe === 'M1' ? '1 phút' : timeframe === 'M5' ? '5 phút' : timeframe === 'H1' ? '1 giờ' : '1 ngày'})` : 'Lịch sử vốn'}
                      </span>
                      {chartMode === 'candles' && (
                        <span className="rounded bg-slate-800/90 border border-slate-700 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                          Nguồn dữ liệu: PostgreSQL / TimescaleDB hypertable (DEMO)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {chartMode === 'equity' && accounts.length > 0 && (
                        <select aria-label="Tài khoản hiển thị" className="quant-chart-select" value={selectedAccount}
                          onChange={(event) => setSelectedAccount(event.target.value)}>
                          {accounts.map((account: any) => <option key={account.id} value={account.id}>#{account.login} · {account.server}</option>)}
                        </select>
                      )}
                      {chartMode === 'candles' && <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-xs font-mono">
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
                      </div>}

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
                    <div className="space-y-3">
                      {renderCandlestickSvg()}
                      {dashboard.health?.strategy_last_decision && (() => {
                        let strat: any = {};
                        try {
                          strat = typeof dashboard.health.strategy_last_decision === 'string'
                            ? JSON.parse(dashboard.health.strategy_last_decision)
                            : dashboard.health.strategy_last_decision;
                        } catch {
                          strat = {};
                        }
                        const candleTimeStr = strat.candle_time
                          ? new Date(strat.candle_time * 1000).toLocaleTimeString('vi-VN')
                          : 'Vừa xong';
                        return (
                          <div className="rounded-lg bg-slate-950/60 border border-slate-800/80 p-3 font-mono text-xs flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <span className="text-cyan-400 font-bold">Chiến lược: {strat.version || 'v2.1.0'}</span>
                              <span className="text-slate-400">Khung nến đã đóng: <b className="text-slate-200">{strat.timeframe || timeframe}</b></span>
                              <span className="text-slate-400">Thời điểm nến đóng: <b className="text-slate-200">{candleTimeStr}</b></span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-slate-400">Lý do:</span>
                              <span className="text-amber-300 font-semibold max-w-md truncate" title={strat.reason}>
                                {strat.reason || 'Đang theo dõi nến đã đóng'}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <EquityHistory samples={dashboard.series.filter((point: {account_id: string}) => point.account_id === selectedAccount)} />
                  )}
                </div>
              </div>
            )}

            {/* USER TAB: ACCOUNTS & EA PAIRING */}
            {userTab === 'accounts' && (
              <div className="space-y-6">
                {/* Form Add Demo Account & Pair EA */}
                <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                  <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
                    <span>Ghép nối EA MT5</span>
                    <span className="text-xs font-normal text-slate-400">(Nhận tín hiệu trực tiếp qua WebRequest HTTP)</span>
                  </h3>

                  <form onSubmit={handleAddDemoAccount} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="mt5-login" className="block text-[11px] font-mono text-slate-400 mb-1">Số đăng nhập MT5</label>
                      <input id="mt5-login"
                        type="text"
                        required
                        value={newDemoLogin}
                        onChange={(e) => setNewDemoLogin(e.target.value)}
                        placeholder="Ví dụ: 61713217"
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
                      />
                    </div>

                    <div>
                      <label htmlFor="mt5-server" className="block text-[11px] font-mono text-slate-400 mb-1">Máy chủ MT5</label>
                      <input id="mt5-server"
                        type="text"
                        required
                        value={newDemoServer}
                        onChange={(e) => setNewDemoServer(e.target.value)}
                        placeholder="Nhập máy chủ từ MT5"
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
                      />
                    </div>

                    <div className="flex items-end">
                      <button
                        type="submit"
                        className="w-full rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2 text-xs transition-colors"
                      >
                        Tạo & Sinh Mã Ghép Nối ↗
                      </button>
                    </div>
                  </form>

                  {/* Secondary Option: Replay Account */}
                  <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                    <div>
                      <span className="text-slate-300 font-semibold">Tùy chọn phụ: Tài khoản phát lại (Replay Mode)</span>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        Mô phỏng khớp nến XAUUSD tự động mà không cần kết nối phần mềm MT5 bên ngoài.
                      </p>
                    </div>
                    <button
                      id="new-replay"
                      type="button"
                      onClick={handleCreateReplay}
                      className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs text-cyan-300 font-mono transition-colors whitespace-nowrap"
                      title="Theo dõi danh mục bằng dữ liệu phát lại"
                    >
                      + Tạo tài khoản phát lại
                    </button>
                  </div>
                </div>

                {/* Account List */}
                <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] overflow-hidden">
                  <div className="border-b border-slate-800 px-5 py-3 flex items-center justify-between">
                    <span className="font-bold text-sm text-slate-200">Danh Sách Tài Khoản Đang Liên Kết</span>
                    <span className="text-xs font-mono text-slate-400">{accounts.length} tài khoản</span>
                  </div>

                  {accounts.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 font-mono text-xs">
                      Chưa có tài khoản MT5 nào được liên kết.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/80">
                      {accounts.map((a: any) => {
                        const code = pairCodes[a.id];
                        const isOnline = a.seen && Date.now() / 1000 - a.seen < 30;
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

                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  onClick={() => handleToggleCopy(a)}
                                  className={`rounded-lg px-3 py-1 text-xs font-mono font-medium transition-colors ${
                                    a.enabled
                                      ? 'bg-amber-950/80 text-amber-300 border border-amber-700/40 hover:bg-amber-900/80'
                                      : 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/40 hover:bg-emerald-900/80'
                                  }`}
                                >
                                  {a.enabled ? 'Tạm Dừng Sao Chép' : 'Bật Sao Chép'}
                                </button>

                                <button
                                  hidden={a.mode === 'REPLAY'}
                                  onClick={() => handleCreatePairCode(a.id)}
                                  className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1 text-xs font-mono text-slate-300 transition-colors"
                                >
                                  Cấp Mã Ghép Nối
                                </button>

                                <button
                                  hidden={a.mode === 'REPLAY'}
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
                                  <span>Mã dùng một lần: <code className="break-all">{code}</code></span>
                                  <span className="text-[10px] text-slate-400">Hết hạn sau 5 phút</span>
                                </div>
                                <p className="text-slate-400 text-[11px]">
                                  Trong MT5 chart XAUUSD, mở Inputs của EA <code className="text-cyan-200">Zupirus_Copy_EA</code>:
                                </p>
                                <div className="bg-slate-900/80 p-2 rounded text-[11px] text-slate-300 select-all">
                                  ApiURL = <span className="text-cyan-300">{window.location.origin}</span>
                                  <br />
                                  PairingCode = <span className="text-cyan-300">{code}</span>
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
                          <option key={a.id} value={a.id}>#{a.login} · {a.server}</option>
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

                      <span className="text-xs font-mono text-slate-400 ml-1">
                        {filteredUserOrders.length} lệnh
                      </span>
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
                                    <span className="block text-[10px] font-normal text-slate-500">
                                      Sig: {o.signal_id || '—'}
                                    </span>
                                  </td>
                                  <td className="p-3 text-slate-300">
                                    #{o.login || o.account_id?.slice(0, 8)}
                                  </td>
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
                                  <td className="p-3 text-slate-300">
                                    {o.ticket ? `${o.ticket}${o.deal ? ` / ${o.deal}` : ''}` : '—'}
                                  </td>
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
                                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${o.side === 'BUY' ? 'text-emerald-400 bg-emerald-950/60' : 'text-amber-400 bg-amber-950/60'}`}>
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
                                    <span className="text-slate-200">#{o.login || o.account_id?.slice(0, 8)} ({o.server || 'DEMO'})</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Tín hiệu ID:</span>
                                    <span className="text-slate-300">{o.signal_id || '—'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Cắt lỗ (SL) / Chốt lời (TP):</span>
                                    <span className="text-slate-300">{slStr} / {tpStr}</span>
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
            )}

            {/* USER TAB: ASSISTANT */}
            {userTab === 'assistant' && (
              <div className="space-y-4">
                <Suspense fallback={<div className="quant-status" role="status">Đang tải trợ lý…</div>}>
                  <CustomerAssistant onNavigate={(tab) => setUserTab(tab)} />
                </Suspense>
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
                <div className="quant-metrics grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    ['Tài khoản', monitorData.accounts.length],
                    ['Đang sao chép', monitorData.accounts.filter((account: any) => account.enabled).length],
                    ['Nghiên cứu đang chờ', monitorData.jobs.filter((job: any) => ['queued', 'waiting_approval'].includes(job.state)).length],
                    ['Kết nối hệ thống', readyData?.status === 'ready' ? 'Sẵn sàng' : readyData ? 'Gián đoạn' : '—'],
                  ].map(([label, value]) => (
                    <div className="quant-panel p-4" key={label}>
                      <div className="text-slate-400 text-xs">{label}</div>
                      <div className="mt-2 text-xl font-semibold">{status === 'ready' ? value : '—'}</div>
                    </div>
                  ))}
                </div>
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
                        <span>Ngắt cấp lệnh khẩn cấp (Toàn Hệ Thống)</span>
                      </div>
                      <p className="text-xs text-slate-300">
                        {monitorData.halted == null
                          ? 'Chưa xác định trạng thái cấp lệnh.'
                          : monitorData.halted
                          ? 'Toàn bộ việc cấp lệnh sao chép đang bị ngắt an toàn. Các vị thế hiện tại vẫn được theo dõi.'
                          : 'Hệ thống đang cho phép cấp lệnh sao chép bình thường theo quy chuẩn rủi ro.'}
                      </p>
                      <div className="text-[11px] font-mono text-slate-400 pt-1">
                        ■ Tài khoản đang bật sao chép:{' '}
                        <b className="text-slate-200">
                          {monitorData.accounts.filter((a: any) => a.enabled).length}/{monitorData.accounts.length}
                        </b>{' '}
                        · Cờ ngắt cấp lệnh hệ thống hoạt động độc lập với cờ bật/tắt riêng của từng tài khoản.
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleKillSwitch(monitorData.halted)}
                        disabled={killSwitchLoading || status !== 'ready' || monitorData.halted == null}
                        className={`rounded-lg px-4 py-2 text-xs font-bold font-mono transition-colors shadow ${
                          monitorData.halted
                            ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                            : 'bg-rose-600 hover:bg-rose-500 text-white'
                        }`}
                      >
                        {killSwitchLoading
                          ? 'Đang xử lý...'
                          : monitorData.halted
                          ? 'Mở lại cấp lệnh'
                          : 'Ngắt cấp lệnh'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* The Two Agent Teams */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* TEAM 1: Execution & Real-Time Dispatch Team */}
                  <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
                        <h3 className="font-bold text-sm text-slate-100">Phân tích & Thực thi</h3>
                      </div>
                      <span className="rounded bg-cyan-950/70 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                        Deterministic Engine
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">
                      Theo dõi báo giá XAU/USD, đánh giá chiến lược theo nến đã đóng và kiểm tra rủi ro trước khi cấp tín hiệu.
                    </p>

                    <div className="space-y-2 text-xs font-mono bg-slate-950/40 p-3 rounded-lg border border-slate-800/60">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Trạng thái vận hành:</span>
                        <span className="text-emerald-400 font-bold">
                          {monitorData.halted ? 'Đã ngắt cấp lệnh' : readyData?.execution_worker?.heartbeat_active ? 'Đang hoạt động' : 'Chưa có nhịp gần đây'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Heartbeat gần nhất:</span>
                        <span className="text-slate-200">
                          {formatHeartbeat(executionTick)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Kết nối Redis:</span>
                        <span className="text-cyan-300">{readyData ? readyData.redis?.connected ? 'Đã kết nối' : 'Gián đoạn' : '—'}</span>
                      </div>
                    </div>
                  </div>

                  {/* TEAM 2: Research & Validation Team */}
                  <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                        <h3 className="font-bold text-sm text-slate-100">Nghiên cứu & Kiểm định</h3>
                      </div>
                      <span className="rounded bg-amber-950/70 border border-amber-500/30 px-2 py-0.5 text-[10px] font-mono text-amber-300">
                        LangGraph Checkpoint
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">
                      Kiểm định Walk-Forward ngoài mẫu và đưa ứng viên vào hàng đợi phê duyệt.
                    </p>

                    <div className="space-y-2 text-xs font-mono bg-slate-950/40 p-3 rounded-lg border border-slate-800/60">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Trạng thái worker:</span>
                        <span className={researchActive ? 'text-emerald-400' : 'text-slate-300'}>{researchActive ? 'Đang hoạt động' : 'Chưa có nhịp gần đây'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Heartbeat gần nhất:</span>
                        <span className="text-slate-200">{formatHeartbeat(researchTick)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Kiểm định gần nhất:</span>
                        <span className="text-slate-200">{lastResearchJob ? formatHeartbeat(Number(lastResearchJob.created)) : 'Chưa có'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Đề xuất chờ duyệt:</span>
                        <span className="text-amber-400 font-bold">
                          {(monitorData.jobs || []).filter((j: any) => j.state === 'waiting_approval').length} chiến lược
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={handleStartResearch}
                        className="flex-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold py-2 text-xs font-mono transition-colors"
                      >
                        + Chạy kiểm định ngay
                      </button>
                      <button
                        onClick={() => setAdminTab('approvals')}
                        className="flex-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold py-2 text-xs font-mono transition-colors"
                      >
                        Đi đến Phê duyệt & Kiểm định →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ADMIN TAB: STRATEGY APPROVALS */}
            {adminTab === 'approvals' && (
              <div className="space-y-6">
                <Suspense fallback={<div className="quant-status" role="status">Đang tải hàng đợi…</div>}><AdminApprovalQueue /></Suspense>
              </div>
            )}

            {/* ADMIN TAB: CONSOLIDATED ACTIVITY & ORDERS LOGS */}
            {adminTab === 'activity' && (
              <div className="space-y-4">
                <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-3">
                      <h3 className="font-bold text-sm text-slate-200">
                        Nhật Ký & Quản Trị Hệ Thống
                      </h3>
                      <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-xs font-mono">
                        <button
                          onClick={() => setAdminViewMode('orders')}
                          className={`px-2.5 py-1 rounded ${
                            adminViewMode === 'orders' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Lệnh toàn hệ thống ({adminOrdersTotal})
                        </button>
                        <button
                          onClick={() => setAdminViewMode('activity')}
                          className={`px-2.5 py-1 rounded ${
                            adminViewMode === 'activity' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Nhật ký sự kiện & Audit ({filteredActivities.length})
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
                            {monitorData.accounts.map((a: any) => (
                              <option key={a.id} value={a.id}>#{a.login} · {a.server}</option>
                            ))}
                          </select>

                          <select
                            aria-label="Lọc theo trạng thái admin"
                            value={activityStatusFilter}
                            onChange={(e: any) => {
                              setActivityStatusFilter(e.target.value);
                              setAdminOrderPage(0);
                            }}
                            className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-slate-200 font-mono"
                          >
                            <option value="all">Tất cả trạng thái</option>
                            <option value="queued">Đang chờ (queued)</option>
                            <option value="resume">Chờ tiếp tục (resume)</option>
                            <option value="waiting_approval">Chờ duyệt (waiting_approval)</option>
                            <option value="completed">Đã khớp (filled)</option>
                            <option value="error">Bị từ chối (rejected)</option>
                            <option value="cancelled">Đã hủy (cancelled)</option>
                            <option value="expired">Hết hạn (expired)</option>
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
                            <option value="running">Đang chạy</option>
                            <option value="waiting">Đang chờ</option>
                            <option value="completed">Hoàn tất</option>
                            <option value="error">Lỗi</option>
                          </select>
                        </>
                      )}

                      <input
                        type="text"
                        value={activitySearchQuery}
                        onChange={(e) => {
                          setActivitySearchQuery(e.target.value);
                          setAdminOrderPage(0);
                        }}
                        placeholder="Tìm ID tín hiệu / job / ticket..."
                        className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-1 text-xs text-slate-200 font-mono placeholder-slate-500"
                      />
                    </div>
                  </div>

                  {/* VIEW 1: All System Orders (/api/admin/orders) */}
                  {adminViewMode === 'orders' ? (
                    adminOrders.length === 0 ? (
                      <div className="p-8 text-center text-slate-500 font-mono text-xs">
                        Không tìm thấy lệnh nào phù hợp với bộ lọc quản trị.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs font-mono">
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
                                const slStr = o.sl != null ? `$${Number(o.sl).toFixed(1)}` : '—';
                                const tpStr = o.tp != null ? `$${Number(o.tp).toFixed(1)}` : '—';
                                const reasonStr = o.reason || 'Chưa ghi nhận';

                                return (
                                  <tr key={o.id} className="hover:bg-slate-900/40">
                                    <td className="p-3 font-bold text-slate-300">
                                      #{o.id}
                                      <span className="block text-[10px] font-normal text-slate-500">
                                        Sig: {o.signal_id || '—'}
                                      </span>
                                    </td>
                                    <td className="p-3 text-slate-300">
                                      #{o.login || o.account_id?.slice(0, 8)}
                                      <span className="block text-[10px] text-slate-500">{o.server || 'DEMO'}</span>
                                    </td>
                                    <td className="p-3 text-slate-400 text-[11px]">{o.user_email || '—'}</td>
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
                                    <td className="p-3 text-slate-300">
                                      {o.ticket ? `${o.ticket}${o.deal ? ` / ${o.deal}` : ''}` : '—'}
                                    </td>
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

                        {/* Pagination Bar */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs font-mono text-slate-400 border-t border-slate-800/80">
                          <div>
                            Hiển thị từ {adminOrderPage * 50 + 1} đến {Math.min((adminOrderPage + 1) * 50, adminOrdersTotal)} trong tổng số {adminOrdersTotal} lệnh
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
                  ) : (
                    /* VIEW 2: Consolidated System Events & Audit Logs */
                    filteredActivities.length === 0 ? (
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
                    )
                  )}
                </div>
              </div>
            )}

            {/* ADMIN TAB: TRACING TELEMETRY */}
            {adminTab === 'tracing' && (
              <div className="space-y-6">
                <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-200">
                        {tracingData.tracing_tool || 'LangSmith Tracing Telemetry'}
                      </span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                        Dự án: {tracingData.project}
                      </span>
                    </div>

                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-mono ${
                        tracingData.langsmith_connected
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}
                    >
                      {tracingData.langsmith_connected ? 'ĐÃ KẾT NỐI CLOUD' : 'BẬT (BUFFER CỤC BỘ)'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
                    <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">CÔNG CỤ TRUY VẾT</span>
                      <span className="text-sm font-bold text-slate-100 mt-1 truncate block">
                        {tracingData.tracing_tool || 'Local Buffer'}
                      </span>
                    </div>
                    <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">TỔNG TRACES ĐÃ GHI</span>
                      <span className="text-lg font-bold text-cyan-300 mt-1">{tracingData.total_traces_recorded}</span>
                    </div>
                    <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">LẦN CẬP NHẬT</span>
                      <span className="text-xs font-bold text-amber-300 mt-1">
                        {tracingData.last_updated ? new Date(tracingData.last_updated * 1000).toLocaleTimeString('vi-VN') : 'Vừa xong'}
                      </span>
                    </div>
                    <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">TÌNH TRẠNG KHẢ DỤNG</span>
                      <span className="text-xs font-bold text-emerald-400 mt-1 truncate block">
                        {tracingData.availability_info || 'Sẵn sàng'}
                      </span>
                    </div>
                  </div>

                  {/* Recent trace events */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-300">Các vết suy luận thực tế gần nhất:</h4>
                    {tracingData.recent_traces?.length === 0 ? (
                      <div className="p-4 text-center text-slate-500 font-mono text-xs">
                        Chưa có trace event nào được ghi. Khi AI Assistant hoặc LangGraph chạy, vết sự kiện sẽ hiển thị ở đây.
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

            {/* ADMIN TAB: NEWS BLACKOUT & RISK CALENDAR */}
            {adminTab === 'news' && (
              <div className="space-y-6">
                {/* Form Add Event */}
                <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                  <h3 className="font-bold text-sm text-slate-200 flex items-center justify-between">
                    <span>Thêm Sự Kiện Lịch Kinh Tế (Bảo Vệ Rủi Ro Ra Tin)</span>
                    <span className="text-xs font-normal text-cyan-300 font-mono">Cửa sổ chặn: ±15 phút quanh giờ tin</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Cơ chế bảo vệ tài khoản khách: Tự động chặn mở lệnh mới trong khoảng ±15 phút trước và sau thời điểm ra tin để tránh trượt giá dãn spread.
                  </p>

                  <form onSubmit={handleAddNews} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-mono text-slate-400 mb-1">Tên sự kiện *</label>
                      <input
                        type="text"
                        required
                        value={newsTitle}
                        onChange={(e) => setNewsTitle(e.target.value)}
                        placeholder="Ví dụ: US Non-Farm Payrolls / CPI"
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-mono text-slate-400 mb-1">Thời điểm ra tin *</label>
                      <input
                        type="datetime-local"
                        required
                        value={newsWhen}
                        onChange={(e) => setNewsWhen(e.target.value)}
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 font-mono"
                      />
                    </div>

                    <div className="flex items-end">
                      <button
                        type="submit"
                        className="w-full rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2 text-xs font-mono transition-colors"
                      >
                        + Thêm Khung Giờ Chặn
                      </button>
                    </div>
                  </form>
                </div>

                {/* Edit News Modal / Form */}
                {editingNews && (
                  <div className="quant-panel rounded-xl border border-cyan-500/50 bg-[#0d1829] p-5 space-y-4 shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <h4 className="font-bold text-sm text-cyan-300">
                        Chỉnh sửa sự kiện #{editingNews.id}
                      </h4>
                      <button
                        onClick={() => setEditingNews(null)}
                        className="text-slate-400 hover:text-slate-200 text-xs font-mono"
                      >
                        ✕ Đóng
                      </button>
                    </div>

                    <form onSubmit={handleUpdateNews} className="grid grid-cols-1 sm:grid-cols-4 gap-3 font-mono text-xs">
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] text-slate-400 mb-1">Tên sự kiện</label>
                        <input
                          type="text"
                          required
                          value={editNewsTitle}
                          onChange={(e) => setEditNewsTitle(e.target.value)}
                          className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-slate-100"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Thời điểm mới</label>
                        <input
                          type="datetime-local"
                          value={editNewsWhen}
                          onChange={(e) => setEditNewsWhen(e.target.value)}
                          className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-slate-100"
                        />
                      </div>

                      <div className="flex items-end gap-2">
                        <button
                          type="submit"
                          className="flex-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-1.5 text-xs transition-colors"
                        >
                          Lưu thay đổi
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingNews(null)}
                          className="rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-slate-300 transition-colors"
                        >
                          Hủy
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Risk Calendar Table */}
                <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] overflow-hidden">
                  <div className="border-b border-slate-800 px-5 py-3 flex items-center justify-between">
                    <span className="font-bold text-sm text-slate-200">
                      Danh Sách Sự Kiện Lịch Rủi Ro Đã Nhập
                    </span>
                    <span className="text-xs font-mono text-slate-400">
                      {(monitorData.news || []).length} sự kiện
                    </span>
                  </div>

                  {(monitorData.news || []).length === 0 ? (
                    <div className="p-8 text-center text-slate-500 font-mono text-xs">
                      Chưa có sự kiện lịch rủi ro nào được cấu hình.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-slate-950/60 border-b border-slate-800 text-[11px] text-slate-400">
                          <tr>
                            <th className="p-3">SỰ KIỆN</th>
                            <th className="p-3">TIỀN TỆ</th>
                            <th className="p-3">TÁC ĐỘNG</th>
                            <th className="p-3">THỜI ĐIỂM (GIỜ ĐỊA PHƯƠNG)</th>
                            <th className="p-3">CỬA SỔ CHẶN (±15 PHÚT)</th>
                            <th className="p-3">TRẠNG THÁI HIỆN TẠI</th>
                            <th className="p-3">THAO TÁC</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {(monitorData.news || []).map((item: any) => {
                            const nowTs = Date.now() / 1000;
                            const isBlocking = Math.abs(nowTs - item.ts) <= 900;
                            const isUpcoming = nowTs < item.ts - 900;

                            const windowStartStr = new Date((item.ts - 900) * 1000).toLocaleTimeString('vi-VN');
                            const windowEndStr = new Date((item.ts + 900) * 1000).toLocaleTimeString('vi-VN');
                            const eventTimeStr = new Date(item.ts * 1000).toLocaleString('vi-VN');

                            return (
                              <tr key={item.id} className="hover:bg-slate-900/40">
                                <td className="p-3 font-bold text-slate-200">{item.title}</td>
                                <td className="p-3">
                                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-cyan-300">
                                    {item.currency || 'USD'}
                                  </span>
                                </td>
                                <td className="p-3">
                                  <span className="rounded bg-rose-950 text-rose-300 border border-rose-800/40 px-1.5 py-0.5 text-[10px] font-bold uppercase">
                                    {item.impact || 'high'}
                                  </span>
                                </td>
                                <td className="p-3 text-slate-300">
                                  {eventTimeStr}
                                </td>
                                <td className="p-3 text-slate-400">
                                  {windowStartStr} – {windowEndStr}
                                </td>
                                <td className="p-3">
                                  {isBlocking ? (
                                    <span className="rounded px-2 py-0.5 text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-700/50 animate-pulse">
                                      ĐANG CHẶN LỆNH (±15m)
                                    </span>
                                  ) : isUpcoming ? (
                                    <span className="rounded px-2 py-0.5 text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700/50">
                                      SẮP DIỄN RA
                                    </span>
                                  ) : (
                                    <span className="rounded px-2 py-0.5 text-[10px] font-bold bg-slate-800 text-slate-400">
                                      ĐÃ QUA
                                    </span>
                                  )}
                                </td>
                                <td className="p-3">
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => {
                                        setEditingNews(item);
                                        setEditNewsTitle(item.title);
                                        setEditNewsCurrency(item.currency || 'USD');
                                        setEditNewsImpact(item.impact || 'high');
                                        const dateObj = new Date(item.ts * 1000);
                                        const localIso = new Date(dateObj.getTime() - dateObj.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                                        setEditNewsWhen(localIso);
                                      }}
                                      className="rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 transition-colors"
                                    >
                                      Sửa
                                    </button>
                                    <button
                                      onClick={() => handleDeleteNews(item.id)}
                                      className="rounded bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 px-2 py-0.5 text-[11px] text-rose-300 transition-colors"
                                    >
                                      Xóa
                                    </button>
                                  </div>
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
          </>
        )}
    </PortalShell>
  );
};

export default App;
