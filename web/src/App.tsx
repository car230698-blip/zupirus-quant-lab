import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { readStrategyDecision } from './utils/strategyDecision.ts';
import { useOrderQuery } from './hooks/useOrderQuery.ts';
import { PortalAuth, PortalShell } from './components/PortalChrome.tsx';
import { UserOverviewTab } from './components/UserOverviewTab.tsx';
import { UserAccountsTab } from './components/UserAccountsTab.tsx';
import { UserOrdersTab } from './components/UserOrdersTab.tsx';
import { AdminOverviewTab } from './components/AdminOverviewTab.tsx';
import { AdminActivityTab } from './components/AdminActivityTab.tsx';
import { AdminTracingTab } from './components/AdminTracingTab.tsx';
import { AdminRiskCalendarTab } from './components/AdminRiskCalendarTab.tsx';
import { AdminUsersTab, type AdminUser } from './components/AdminUsersTab.tsx';
import { AdminAITab, type GeminiKeyItem, type HindsightMemoryItem } from './components/AdminAITab.tsx';

const CustomerAssistant = lazy(() =>
  import('./components/CustomerAssistant.tsx').then((module) => ({ default: module.CustomerAssistant }))
);
const AdminApprovalQueue = lazy(() =>
  import('./components/AdminApprovalQueue.tsx').then((module) => ({ default: module.AdminApprovalQueue }))
);

type CopyAccount = { id: string; enabled: boolean; risk: number; max_spread: number; max_positions: number; max_dd: number };

type UserTabKey = 'overview' | 'accounts' | 'orders' | 'assistant';
type AdminTabKey = 'overview' | 'approvals' | 'activity' | 'tracing' | 'news' | 'users' | 'ai';

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
  const [tracingData, setTracingData] = useState<any>(null);
  const [readyData, setReadyData] = useState<any>(null);

  // Activity filter state
  const [activityTeamFilter, setActivityTeamFilter] = useState<'all' | 'execution' | 'research' | 'security'>('all');
  const [activityStatusFilter, setActivityStatusFilter] = useState('all');
  const [activitySearchQuery, setActivitySearchQuery] = useState<string>('');

  // User Order Filters
  const [orderAccountFilter, setOrderAccountFilter] = useState<string>('all');
  const [orderStateFilter, setOrderStateFilter] = useState<string>('all');

  // Admin Orders state (from /api/admin/orders)
  const [adminOrderPage, setAdminOrderPage] = useState<number>(0);
  const [adminAccountFilter, setAdminAccountFilter] = useState<string>('all');
  const [adminOrderState, setAdminOrderState] = useState('all');
  const [adminOrderSource, setAdminOrderSource] = useState('all');
  const [adminOrderSearch, setAdminOrderSearch] = useState('');
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

  // User Management state
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Gemini & Memory state
  const [geminiKeys, setGeminiKeys] = useState<GeminiKeyItem[]>([]);
  const [loadingGeminiKeys, setLoadingGeminiKeys] = useState(false);
  const [hindsightMemories, setHindsightMemories] = useState<HindsightMemoryItem[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [syncingCalendar, setSyncingCalendar] = useState(false);

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
      setTracingData(tRes.ok ? await tRes.json() : null);
      if (rRes.ok || rRes.status === 503) setReadyData(await rRes.json());
    } catch {
      setMonitorStatus('offline');
      setTracingData(null);
    }
  }, []);

  const userOrderParams = new URLSearchParams();
  if (orderAccountFilter !== 'all') userOrderParams.set('account_id', orderAccountFilter);
  if (orderStateFilter !== 'all') userOrderParams.set('state', orderStateFilter);
  const systemOrderParams = new URLSearchParams({ limit: '50', offset: String(adminOrderPage * 50) });
  if (adminAccountFilter !== 'all') systemOrderParams.set('account_id', adminAccountFilter);
  if (adminOrderState !== 'all') systemOrderParams.set('state', adminOrderState);
  if (adminOrderSource !== 'all') systemOrderParams.set('team', adminOrderSource);
  if (adminOrderSearch.trim()) systemOrderParams.set('search', adminOrderSearch.trim());
  const sessionKey = currentUser?.email ?? null;
  const userOrderQuery = useOrderQuery(portal === 'user' && userTab === 'orders' && currentUser
    ? `/api/dashboard?${userOrderParams}` : null, sessionKey);
  const systemOrders = useOrderQuery(
    portal === 'admin' && adminTab === 'activity' && adminViewMode === 'orders' && currentUser?.role === 'admin'
      ? `/api/admin/orders?${systemOrderParams}` : null,
    sessionKey,
  );

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (currentUser) {
      loadDashboard();
      if (portal === 'user' && userTab === 'overview' && chartMode === 'candles') loadCandles(timeframe);
      if (portal === 'admin' && currentUser.role === 'admin') loadAdminMonitor();
      const timer = setInterval(() => {
        loadDashboard();
        if (portal === 'user' && userTab === 'overview' && chartMode === 'candles') loadCandles(timeframe);
        if (portal === 'admin' && currentUser.role === 'admin') loadAdminMonitor();
      }, 5000);
      return () => clearInterval(timer);
    }
  }, [currentUser, loadDashboard, loadCandles, loadAdminMonitor, timeframe, chartMode, portal, userTab]);

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
        showNotice(nextHalt ? 'Đã ngắt cấp lệnh và tạm dừng sao chép trên mọi tài khoản.' : 'Đã mở cấp lệnh ở cấp hệ thống. Bật lại sao chép trên từng tài khoản khi cần.');
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

  const handleAddNews = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newsTitle.trim()) return;
    const ts = newsWhen ? new Date(newsWhen).getTime() / 1000 : NaN;
    if (!Number.isFinite(ts) || ts <= 0) return showNotice('Hãy nhập thời điểm sự kiện hợp lệ.');
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
    const ts = editNewsWhen ? new Date(editNewsWhen).getTime() / 1000 : NaN;
    if (!Number.isFinite(ts) || ts <= 0) return showNotice('Hãy nhập thời điểm sự kiện hợp lệ.');
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

  const handleSyncCalendar = async () => {
    setSyncingCalendar(true);
    try {
      const res = await fetch('/api/admin/news/sync', { method: 'POST', headers: { 'X-Zupirus': '1' } });
      if (res.ok) {
        const d = await res.json();
        showNotice(`Đã tự động đồng bộ ${d.synced_count || 0} sự kiện kinh tế quan trọng`);
        await loadAdminMonitor();
      } else {
        showNotice('Không thể đồng bộ lịch kinh tế tự động.');
      }
    } catch {
      showNotice('Lỗi kết nối khi đồng bộ lịch kinh tế.');
    } finally {
      setSyncingCalendar(false);
    }
  };

  // User Management Handlers
  const loadAdminUsers = useCallback(async () => {
    if (!currentUser || currentUser.role !== 'admin') return;
    setLoadingUsers(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const d = await res.json();
        setAdminUsers(d.users || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingUsers(false);
    }
  }, [currentUser]);

  const handleCreateUser = async (email: string, pass: string, role: string) => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ email, password: pass, role }),
      });
      if (res.ok) {
        showNotice(`Đã tạo thành công tài khoản ${email}`);
        await loadAdminUsers();
      } else {
        const err = await res.json().catch(() => ({}));
        showNotice(`Lỗi: ${err.detail || 'Không thể tạo tài khoản'}`);
      }
    } catch {
      showNotice('Lỗi kết nối khi tạo tài khoản');
    }
  };

  const handleToggleUserRole = async (uid: string, newRole: string) => {
    try {
      const res = await fetch(`/api/admin/users/${uid}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        showNotice(`Đã cập nhật vai trò thành ${newRole}`);
        await loadAdminUsers();
      }
    } catch {
      showNotice('Lỗi khi cập nhật vai trò người dùng');
    }
  };

  const handleResetUserPassword = async (uid: string, newPass: string) => {
    try {
      const res = await fetch(`/api/admin/users/${uid}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ password: newPass }),
      });
      if (res.ok) {
        showNotice('Đã đặt lại mật khẩu thành công');
      }
    } catch {
      showNotice('Lỗi khi đặt lại mật khẩu');
    }
  };

  const handleDeleteUser = async (uid: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xoá người dùng này?')) return;
    try {
      const res = await fetch(`/api/admin/users/${uid}`, { method: 'DELETE', headers: { 'X-Zupirus': '1' } });
      if (res.ok) {
        showNotice('Đã xoá người dùng');
        await loadAdminUsers();
      }
    } catch {
      showNotice('Lỗi khi xoá người dùng');
    }
  };

  // Gemini & Memory Handlers
  const loadGeminiKeys = useCallback(async () => {
    if (!currentUser || currentUser.role !== 'admin') return;
    setLoadingGeminiKeys(true);
    try {
      const res = await fetch('/api/admin/gemini/keys');
      if (res.ok) {
        const d = await res.json();
        setGeminiKeys(d.keys || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingGeminiKeys(false);
    }
  }, [currentUser]);

  const handleAddGeminiKey = async (key: string, name?: string) => {
    try {
      const res = await fetch('/api/admin/gemini/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ key, name }),
      });
      if (res.ok) {
        showNotice('Đã thêm API Key Gemini vào bể xoay vòng');
        await loadGeminiKeys();
      } else {
        const err = await res.json().catch(() => ({}));
        showNotice(`Lỗi: ${err.detail || 'Không thể thêm API Key'}`);
      }
    } catch {
      showNotice('Lỗi kết nối khi thêm API Key');
    }
  };

  const handleToggleGeminiKey = async (kid: string) => {
    try {
      const res = await fetch(`/api/admin/gemini/keys/${kid}/toggle`, { method: 'PUT', headers: { 'X-Zupirus': '1' } });
      if (res.ok) {
        await loadGeminiKeys();
      }
    } catch {
      showNotice('Lỗi khi cập nhật trạng thái khóa');
    }
  };

  const handleDeleteGeminiKey = async (kid: string) => {
    if (!window.confirm('Bạn có chắc muốn xoá khóa Gemini này khỏi bể?')) return;
    try {
      const res = await fetch(`/api/admin/gemini/keys/${kid}`, { method: 'DELETE', headers: { 'X-Zupirus': '1' } });
      if (res.ok) {
        showNotice('Đã xoá API Key khỏi bể');
        await loadGeminiKeys();
      }
    } catch {
      showNotice('Lỗi khi xoá API Key');
    }
  };

  const handleTestGemini = async (prompt: string) => {
    try {
      const res = await fetch('/api/admin/gemini/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ prompt }),
      });
      return await res.json();
    } catch (e: any) {
      return { success: false, error: e.message || 'Lỗi kết nối máy chủ' };
    }
  };

  const loadHindsightMemories = useCallback(async () => {
    if (!currentUser || currentUser.role !== 'admin') return;
    setLoadingMemories(true);
    try {
      const res = await fetch('/api/admin/memory');
      if (res.ok) {
        const d = await res.json();
        setHindsightMemories(d.memories || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMemories(false);
    }
  }, [currentUser]);

  const handleAddMemory = async (category: 'episodic' | 'semantic' | 'reflective', content: string) => {
    try {
      const res = await fetch('/api/admin/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ category, content }),
      });
      if (res.ok) {
        showNotice('Đã lưu ký ức vào bộ nhớ Hindsight');
        await loadHindsightMemories();
      }
    } catch {
      showNotice('Lỗi khi ghi nhớ vào Hindsight');
    }
  };

  const handleDeleteMemory = async (mid: string) => {
    try {
      const res = await fetch(`/api/admin/memory/${mid}`, { method: 'DELETE', headers: { 'X-Zupirus': '1' } });
      if (res.ok) {
        await loadHindsightMemories();
      }
    } catch {
      showNotice('Lỗi khi xoá ký ức');
    }
  };

  useEffect(() => {
    if (currentUser?.role === 'admin') {
      if (adminTab === 'users') {
        loadAdminUsers();
      } else if (adminTab === 'ai') {
        loadGeminiKeys();
        loadHindsightMemories();
      }
    }
  }, [currentUser, adminTab, loadAdminUsers, loadGeminiKeys, loadHindsightMemories]);

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
        status: j.state,
        detail: `Mã kiểm định: ${j.id} · ${j.decision == null ? 'Chưa có quyết định' : j.decision ? 'Đã duyệt' : 'Đã từ chối'}`,
      });
    });

    // Sort descending by timestamp
    return list.sort((a, b) => b.ts - a.ts);
  }, [monitorData]);

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
  const totalBalance = accounts.reduce((acc: number, a: any) => acc + (a.balance || 0), 0);
  const totalEquity = accounts.reduce((acc: number, a: any) => acc + (a.equity || 0), 0);
  const totalPositions = accounts.reduce((acc: number, a: any) => acc + (a.positions || 0), 0);
  const totalPnl = totalEquity - totalBalance;

  if (authChecking) return <div className="quant-app quant-loading" role="status">Đang kiểm tra phiên đăng nhập…</div>;
  if (!currentUser) return <PortalAuth portal={portal} loading={authLoading} error={authError} onSubmit={authenticate} />;
  const isAdmin = currentUser.role === 'admin';
  if (portal === 'admin' && !isAdmin) {
    return (
      <div className="quant-app quant-admin quant-loading">
        <div className="quant-auth-box">
          <h1>Cần quyền quản trị</h1>
          <p>Tài khoản hiện tại không có quyền truy cập.</p>
          <button className="quant-primary" onClick={handleLogout}>Đăng nhập bằng tài khoản khác</button>
        </div>
      </div>
    );
  }

  const researchTick = Number(dashboard.health?.research_heartbeat);
  const executionTick = Number(dashboard.health?.execution_heartbeat);
  const researchActive = Number.isFinite(researchTick) && Date.now() / 1000 - researchTick < 60;
  const lastResearchJob = monitorData.jobs?.[0];
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
    <PortalShell
      portal={portal}
      page={portal === 'admin' ? adminTab : userTab}
      email={currentUser.email}
      onNavigate={(page) => portal === 'admin' ? setAdminTab(page as AdminTabKey) : setUserTab(page as UserTabKey)}
      logout={handleLogout}
      switchPortal={isAdmin ? switchPortal : undefined}
    >
      {status === 'loading' && <div className="quant-status" role="status">Đang tải dữ liệu…</div>}
      {status === 'offline' && <div className="quant-alert" role="status">Không thể cập nhật. Dữ liệu đang hiển thị có thể đã cũ.</div>}
      {notice && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-xs text-amber-200 font-mono flex items-center justify-between">
          <span role="status">{notice}</span>
          <button
            type="button"
            aria-label="Đóng thông báo"
            onClick={() => setNotice(null)}
            className="text-amber-400 hover:text-amber-200 font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* USER PORTAL VIEWS */}
      {portal === 'user' && (
        <>
          {userTab === 'overview' && (
            <UserOverviewTab
              totalBalance={totalBalance}
              totalEquity={totalEquity}
              totalPnl={totalPnl}
              totalPositions={totalPositions}
              chartMode={chartMode}
              setChartMode={setChartMode}
              selectedAccount={selectedAccount}
              setSelectedAccount={setSelectedAccount}
              accounts={accounts}
              candles={candles}
              series={dashboard.series || []}
              health={dashboard.health || {}}
              timeframe={timeframe}
              setTimeframe={setTimeframe}
              loadCandles={loadCandles}
            />
          )}

          {userTab === 'accounts' && (
            <UserAccountsTab
              accounts={accounts}
              newDemoLogin={newDemoLogin}
              setNewDemoLogin={setNewDemoLogin}
              newDemoServer={newDemoServer}
              setNewDemoServer={setNewDemoServer}
              handleAddDemoAccount={handleAddDemoAccount}
              handleCreateReplay={handleCreateReplay}
              pairCodes={pairCodes}
              handleCreatePairCode={handleCreatePairCode}
              handleToggleCopy={handleToggleCopy}
              handleRevoke={handleRevoke}
            />
          )}

          {userTab === 'orders' && (
            <UserOrdersTab
              accounts={accounts}
              filteredUserOrders={userOrderQuery.data?.orders ?? []}
              status={userOrderQuery.status}
              orderAccountFilter={orderAccountFilter}
              setOrderAccountFilter={setOrderAccountFilter}
              orderStateFilter={orderStateFilter}
              setOrderStateFilter={setOrderStateFilter}
            />
          )}

          {userTab === 'assistant' && (
            <div className="space-y-4">
              <Suspense fallback={<div className="quant-status" role="status">Đang tải trợ lý…</div>}>
                <CustomerAssistant onNavigate={(tab) => setUserTab(tab)} />
              </Suspense>
            </div>
          )}
        </>
      )}

      {/* ADMIN PORTAL VIEWS */}
      {portal === 'admin' && (
        <>
          {adminTab === 'overview' && (
            <AdminOverviewTab
              monitorData={monitorData}
              readyData={readyData}
              status={status}
              killSwitchLoading={killSwitchLoading}
              handleToggleKillSwitch={handleToggleKillSwitch}
              executionTick={executionTick}
              researchTick={researchTick}
              researchActive={researchActive}
              lastResearchJob={lastResearchJob}
              formatHeartbeat={formatHeartbeat}
              onNavigateApprovals={() => setAdminTab('approvals')}
            />
          )}

          {adminTab === 'approvals' && (
            <div className="space-y-6">
              <Suspense fallback={<div className="quant-status" role="status">Đang tải hàng đợi…</div>}>
                <AdminApprovalQueue decision={readStrategyDecision(dashboard.health?.strategy_last_decision)} />
              </Suspense>
            </div>
          )}

          {adminTab === 'activity' && (
            <AdminActivityTab
              adminViewMode={adminViewMode}
              setAdminViewMode={setAdminViewMode}
              adminOrdersTotal={systemOrders.data?.total ?? 0}
              filteredActivities={filteredActivities}
              adminAccountFilter={adminAccountFilter}
              setAdminAccountFilter={setAdminAccountFilter}
              adminOrderPage={adminOrderPage}
              setAdminOrderPage={setAdminOrderPage}
              activityStatusFilter={activityStatusFilter}
              setActivityStatusFilter={setActivityStatusFilter}
              activityTeamFilter={activityTeamFilter}
              setActivityTeamFilter={setActivityTeamFilter}
              activitySearchQuery={activitySearchQuery}
              setActivitySearchQuery={setActivitySearchQuery}
              accounts={monitorData.accounts || []}
              adminOrders={systemOrders.data?.orders ?? []}
              ordersStatus={systemOrders.status}
              adminOrderState={adminOrderState}
              setAdminOrderState={setAdminOrderState}
              adminOrderSource={adminOrderSource}
              setAdminOrderSource={setAdminOrderSource}
              adminOrderSearch={adminOrderSearch}
              setAdminOrderSearch={setAdminOrderSearch}
            />
          )}

          {adminTab === 'tracing' && (
            <AdminTracingTab tracingData={tracingData} />
          )}

          {adminTab === 'news' && (
            <AdminRiskCalendarTab
              monitorData={monitorData}
              newsTitle={newsTitle}
              setNewsTitle={setNewsTitle}
              newsWhen={newsWhen}
              setNewsWhen={setNewsWhen}
              handleAddNews={handleAddNews}
              editingNews={editingNews}
              setEditingNews={setEditingNews}
              editNewsTitle={editNewsTitle}
              setEditNewsTitle={setEditNewsTitle}
              editNewsWhen={editNewsWhen}
              setEditNewsWhen={setEditNewsWhen}
              editNewsCurrency={editNewsCurrency}
              setEditNewsCurrency={setEditNewsCurrency}
              editNewsImpact={editNewsImpact}
              setEditNewsImpact={setEditNewsImpact}
              handleUpdateNews={handleUpdateNews}
              handleDeleteNews={handleDeleteNews}
              onSyncCalendar={handleSyncCalendar}
              syncing={syncingCalendar}
            />
          )}

          {adminTab === 'users' && (
            <AdminUsersTab
              users={adminUsers}
              loading={loadingUsers}
              onCreateUser={handleCreateUser}
              onToggleRole={handleToggleUserRole}
              onResetPassword={handleResetUserPassword}
              onDeleteUser={handleDeleteUser}
            />
          )}

          {adminTab === 'ai' && (
            <AdminAITab
              keys={geminiKeys}
              memories={hindsightMemories}
              loadingKeys={loadingGeminiKeys}
              loadingMemories={loadingMemories}
              onAddKey={handleAddGeminiKey}
              onToggleKey={handleToggleGeminiKey}
              onDeleteKey={handleDeleteGeminiKey}
              onTestGemini={handleTestGemini}
              onAddMemory={handleAddMemory}
              onDeleteMemory={handleDeleteMemory}
            />
          )}
        </>
      )}
    </PortalShell>
  );
};

export default App;
