import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient.ts';
import { useOrderQuery } from './hooks/useOrderQuery.ts';
import { PortalAuth, PortalShell } from './components/PortalChrome.tsx';
import { UserOverviewTab } from './components/UserOverviewTab.tsx';
import { UserAccountsTab } from './components/UserAccountsTab.tsx';
import { UserOrdersTab } from './components/UserOrdersTab.tsx';
import { AdminOverviewTab } from './components/AdminOverviewTab.tsx';
import { AdminSourcesTab } from './components/AdminSourcesTab.tsx';
import { AdminBillingSettingsTab } from './components/AdminBillingSettingsTab.tsx';
import { AdminOrdersSubscriptionsTab } from './components/AdminOrdersSubscriptionsTab.tsx';
import { AdminCloudInfrastructureTab } from './components/AdminCloudInfrastructureTab.tsx';
import { AdminRiskShieldUsersTab } from './components/AdminRiskShieldUsersTab.tsx';
import { LandingPage } from './components/LandingPage.tsx';

const CustomerAssistant = lazy(() =>
  import('./components/CustomerAssistant.tsx').then((module) => ({ default: module.CustomerAssistant }))
);

type UserTabKey = 'overview' | 'accounts' | 'orders' | 'assistant';
type AdminTabKey = 'overview' | 'billing' | 'sources' | 'orders' | 'infrastructure' | 'risk_users';
export type PortalType = 'landing' | 'user' | 'admin';

interface UserInfo {
  email: string;
  role: 'customer' | 'admin';
}

const AppContent: React.FC = () => {
  // Determine initial portal based on hostname or search params
  const [portal, setPortal] = useState<PortalType>(() => {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname.toLowerCase();
      const params = new URLSearchParams(window.location.search);
      const queryPortal = params.get('portal');
      if (queryPortal === 'admin' || host === 'adm.zupirus.com' || host.startsWith('adm.')) {
        return 'admin';
      }
      if (queryPortal === 'user' || host === 'app.zupirus.com' || host.startsWith('app.')) {
        return 'user';
      }
      if (queryPortal === 'landing' || host === 'zupirus.com' || host === 'www.zupirus.com') {
        return 'landing';
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
  const [readyData, setReadyData] = useState<any>(null);

  // User Order Filters
  const [orderAccountFilter, setOrderAccountFilter] = useState<string>('all');
  const [orderStateFilter, setOrderStateFilter] = useState<string>('all');

  // Forms & notices
  const [notice, setNotice] = useState<string | null>(null);
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
      const [mRes, rRes] = await Promise.all([
        fetch('/api/admin/monitor'),
        fetch('/readyz'),
      ]);
      if (mRes.ok) {
        setMonitorData(await mRes.json());
        setMonitorStatus('ready');
      } else {
        setMonitorStatus('offline');
      }
      if (rRes.ok || rRes.status === 503) setReadyData(await rRes.json());
    } catch {
      setMonitorStatus('offline');
    }
  }, []);

  const userOrderParams = new URLSearchParams();
  if (orderAccountFilter !== 'all') userOrderParams.set('account_id', orderAccountFilter);
  if (orderStateFilter !== 'all') userOrderParams.set('state', orderStateFilter);
  const sessionKey = currentUser?.email ?? null;
  const userOrderQuery = useOrderQuery(portal === 'user' && userTab === 'orders' && currentUser
    ? `/api/dashboard?${userOrderParams}` : null, sessionKey);

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

  const authenticate = async (email: string, password: string, register: boolean, otp?: string) => {
    setAuthLoading(true);
    setAuthError(null);
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({ email, password, ...(otp ? { otp_code: otp } : {}) }),
    };
    try {
      if (register) {
        const registration = await fetch('/api/register', options);
        if (!registration.ok) {
          const data = await registration.json().catch(() => ({}));
          throw new Error(data.detail || (registration.status === 409 ? 'Email đã được đăng ký.' : 'Không thể tạo tài khoản. Kiểm tra email và mã OTP.'));
        }
      }
      const session = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ email, password }),
      });
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
    setNotice(null);
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

  // Calculations for User Dashboard
  const accounts = dashboard.accounts || [];
  const totalBalance = accounts.reduce((acc: number, a: any) => acc + (a.balance || 0), 0);
  const totalEquity = accounts.reduce((acc: number, a: any) => acc + (a.equity || 0), 0);
  const totalPositions = accounts.reduce((acc: number, a: any) => acc + (a.positions || 0), 0);
  const totalPnl = totalEquity - totalBalance;

  // Render Landing Page for zupirus.com / landing mode
  if (portal === 'landing') {
    return (
      <LandingPage
        onEnterApp={() => {
          if (typeof window !== 'undefined' && ['zupirus.com', 'www.zupirus.com'].includes(window.location.hostname)) {
            window.location.assign('https://app.zupirus.com');
          } else {
            setPortal('user');
          }
        }}
        onEnterAdmin={() => {
          if (typeof window !== 'undefined' && ['zupirus.com', 'www.zupirus.com'].includes(window.location.hostname)) {
            window.location.assign('https://adm.zupirus.com');
          } else {
            setPortal('admin');
          }
        }}
      />
    );
  }

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
  const formatHeartbeat = (timestamp: number | null | undefined) => (typeof timestamp === 'number' && Number.isFinite(timestamp))
    ? new Date(timestamp * 1000).toLocaleTimeString('vi-VN') : 'Chưa ghi nhận';
  const status = portal === 'admin' ? monitorStatus : dashboardStatus;
  const alternatePortal = portal === 'admin' ? 'user' : 'admin';
  const switchPortal = () => {
    const targetHost = alternatePortal === 'admin' ? 'adm.zupirus.com' : 'app.zupirus.com';
    if (['zupirus.com', 'www.zupirus.com', 'adm.zupirus.com', 'app.zupirus.com'].includes(location.hostname)) {
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
            <UserAccountsTab />
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
              onNavigateApprovals={() => setAdminTab('sources')}
            />
          )}

          {adminTab === 'billing' && <AdminBillingSettingsTab />}

          {adminTab === 'sources' && <AdminSourcesTab />}

          {adminTab === 'orders' && <AdminOrdersSubscriptionsTab />}

          {adminTab === 'infrastructure' && <AdminCloudInfrastructureTab />}

          {adminTab === 'risk_users' && <AdminRiskShieldUsersTab />}
        </>
      )}
    </PortalShell>
  );
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
};

export default App;
