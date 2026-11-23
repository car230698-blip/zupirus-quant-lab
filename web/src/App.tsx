import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient.ts';
import { apiGet, apiPost } from './api/client.ts';
import { useOrderQuery } from './hooks/useOrderQuery.ts';
import { PortalAuth, PortalShell } from './components/PortalChrome.tsx';
import { UserOverviewTab } from './components/UserOverviewTab.tsx';
import { UserAccountsTab } from './components/UserAccountsTab.tsx';
import { UserOrdersTab } from './components/UserOrdersTab.tsx';
import { AdminCommandRadarTab } from './components/AdminCommandRadarTab.tsx';
import { AdminAIEvolutionTab } from './components/AdminAIEvolutionTab.tsx';
import { AdminBusinessCustomersTab } from './components/AdminBusinessCustomersTab.tsx';
import { ToastNotification, ToastType } from './components/ToastNotification.tsx';
import { normalizeCentToUsd } from './utils/currencyFormat.ts';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext.tsx';

const LandingPage = lazy(() =>
  import('./components/LandingPage.tsx').then((m) => ({ default: m.LandingPage }))
);

type UserTabKey = 'overview' | 'accounts' | 'orders';
type AdminTabKey = 'radar' | 'ai' | 'business';
export type PortalType = 'landing' | 'user' | 'admin';

interface UserInfo {
  email: string;
  role: 'customer' | 'admin';
}

const AppContent: React.FC = () => {
  const { lang } = useLanguage();
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
    return 'landing';
  });

  // Auth state
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authPreviewOpen, setAuthPreviewOpen] = useState(false);
  const [dashboardStatus, setDashboardStatus] = useState('loading');
  const [monitorStatus, setMonitorStatus] = useState('loading');
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Tab navigation
  const [userTab, setUserTab] = useState<UserTabKey>('overview');
  const [adminTab, setAdminTab] = useState<AdminTabKey>('radar');

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
  const [chartMode, setChartMode] = useState<'equity' | 'candles'>('candles');

  // Admin & Monitoring state
  const [monitorData, setMonitorData] = useState<any>({ accounts: [], audit: [], jobs: [], news: [], halted: null });

  // User Order Filters
  const [orderAccountFilter, setOrderAccountFilter] = useState<string>('all');
  const [orderStateFilter, setOrderStateFilter] = useState<string>('all');

  // Forms & notices
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeType, setNoticeType] = useState<ToastType>('info');
  const [killSwitchLoading, setKillSwitchLoading] = useState(false);

  // Check auth session
  const checkAuth = useCallback(async () => {
    try {
      const data = await apiGet<UserInfo>('/api/me');
      setCurrentUser(data);
    } catch (err: any) {
      if (err?.status && err.status !== 401) setAuthError('Không thể kiểm tra phiên đăng nhập.');
    } finally {
      setAuthChecking(false);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const d = await apiGet<any>('/api/dashboard');
      setDashboard(d);
      setDashboardStatus('ready');
      setSelectedAccount((prev) => {
        if (prev && d.accounts?.some((a: any) => a.id === prev)) return prev;
        return d.accounts?.[0]?.id || '';
      });
    } catch (err: any) {
      if (err?.status === 401) {
        setCurrentUser(null);
        setAuthError('Phiên đăng nhập đã hết hạn.');
      } else {
        setDashboardStatus('offline');
      }
    }
  }, []);

  const loadCandles = useCallback(async (tf: string) => {
    try {
      const d = await apiGet<any>(`/api/timescale/candles?symbol=XAUUSD&timeframe=${tf}&source=ALL&limit=48`);
      setCandles((d.candles || []).slice().reverse());
    } catch {
      // ignore
    }
  }, []);

  const loadAdminMonitor = useCallback(async () => {
    try {
      const data = await apiGet<any>('/api/admin/monitor');
      setMonitorData(data);
      setMonitorStatus('ready');
    } catch {
      setMonitorStatus('offline');
    }
  }, []);

  const userOrderParams = new URLSearchParams();
  if (orderAccountFilter !== 'all') userOrderParams.set('account_id', orderAccountFilter);
  if (orderStateFilter !== 'all') userOrderParams.set('state', orderStateFilter);
  const sessionKey = currentUser?.email ?? null;
  const userOrderQuery = useOrderQuery(
    portal === 'user' && userTab === 'orders' && currentUser ? `/api/dashboard?${userOrderParams}` : null,
    sessionKey
  );

  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (portal === 'admin') {
        document.title = 'ZUPIRUS — Trạm Quản Trị Chỉ Huy Định Lượng';
      } else if (portal === 'user') {
        document.title = 'ZUPIRUS — Cổng Giao Dịch Định Lượng XAU/USD';
      } else {
        document.title = 'ZUPIRUS — Bot Trade Vàng XAU/USD Cloud MT5 Chuẩn Quỹ';
      }
    }
  }, [portal]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__ZUPIRUS_USER_KEY__ = currentUser?.email || 'anonymous';
    }
    queryClient.clear();
  }, [currentUser?.email]);

  useEffect(() => {
    if (currentUser) {
      loadDashboard();
      if (portal === 'user' && userTab === 'overview') loadCandles(timeframe);
      if (portal === 'admin' && currentUser.role === 'admin') loadAdminMonitor();
    }
  }, [currentUser, loadDashboard, loadCandles, loadAdminMonitor, timeframe, portal, userTab]);

  const showNotice = (msg: string, type: ToastType = 'info') => {
    setNotice(msg);
    setNoticeType(type);
  };

  const authenticate = async (email: string, password: string, register: boolean, otp?: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      if (register) {
        try {
          await apiPost('/api/register', { email, password, ...(otp ? { otp_code: otp } : {}) });
        } catch (err: any) {
          throw new Error(
            err?.data?.detail ||
              (err?.status === 409 ? 'Email đã được đăng ký.' : 'Không thể tạo tài khoản. Kiểm tra email và mã OTP.')
          );
        }
      }
      let session: any;
      try {
        session = await apiPost<UserInfo>('/api/login', { email, password });
      } catch (err: any) {
        throw new Error(
          err?.status === 401 ? 'Email hoặc mật khẩu không chính xác.' : 'Không thể đăng nhập. Vui lòng thử lại.'
        );
      }
      setDashboardStatus('loading');
      setMonitorStatus('loading');
      setNotice(null);
      setAuthPreviewOpen(false);
      setCurrentUser(session);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Không thể kết nối máy chủ.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiPost('/api/logout');
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined') {
      (window as any).__ZUPIRUS_USER_KEY__ = 'anonymous';
    }
    queryClient.clear();
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
      await apiPost('/api/admin/safety', { halted: nextHalt });
      showNotice(
        nextHalt
          ? 'Đã ngắt cấp lệnh và tạm dừng sao chép trên mọi tài khoản.'
          : 'Đã mở cấp lệnh ở cấp hệ thống. Bật lại sao chép trên từng tài khoản khi cần.',
        nextHalt ? 'warning' : 'success'
      );
      await loadDashboard();
      await loadAdminMonitor();
    } catch {
      showNotice('Không thể kết nối máy chủ để đổi trạng thái cấp lệnh.', 'error');
    } finally {
      setKillSwitchLoading(false);
    }
  };

  // Calculations for User Dashboard (normalize Cent USC/EUC accounts by /100 when summing USD totals)
  const accounts = dashboard.accounts || [];
  const totalBalance = accounts.reduce((acc: number, a: any) => acc + normalizeCentToUsd(Number(a.balance || 0), a), 0);
  const totalEquity = accounts.reduce((acc: number, a: any) => acc + normalizeCentToUsd(Number(a.equity || 0), a), 0);
  const totalPositions = accounts.reduce((acc: number, a: any) => acc + (a.positions || 0), 0);
  const totalPnl = totalEquity - totalBalance;

  const navigateToPortal = (target: PortalType) => {
    setAuthPreviewOpen(false);
    if (
      typeof window !== 'undefined' &&
      ['zupirus.com', 'www.zupirus.com', 'adm.zupirus.com', 'app.zupirus.com'].includes(window.location.hostname)
    ) {
      const hostMap: Record<PortalType, string> = {
        landing: 'zupirus.com',
        user: 'app.zupirus.com',
        admin: 'adm.zupirus.com',
      };
      if (window.location.hostname !== hostMap[target]) {
        const queryLang = lang === 'en' ? '?lang=en' : '';
        window.location.assign(`https://${hostMap[target]}${queryLang}`);
        return;
      }
    }
    setPortal(target);
  };

  // Render Landing Page for zupirus.com / landing mode
  if (portal === 'landing') {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-[#03050a] flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-xl border border-amber-500/40 bg-amber-950/30 flex items-center justify-center text-amber-400 font-mono font-bold animate-pulse">
                Z
              </div>
              <span className="font-mono text-xs text-amber-300">Đang khởi tạo không gian lượng tử…</span>
            </div>
          </div>
        }
      >
        <LandingPage
          onEnterApp={() => navigateToPortal('user')}
        />
      </Suspense>
    );
  }

  if (authChecking) {
    return (
      <div className="quant-app quant-loading" role="status">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl border border-cyan-500/40 bg-cyan-950/30 flex items-center justify-center text-cyan-400 font-mono font-bold">
            Z
          </div>
          <span>Đang đồng bộ phiên giao dịch định lượng…</span>
        </div>
      </div>
    );
  }

  if (!currentUser || authPreviewOpen) {
    return (
      <PortalAuth
        portal={portal}
        loading={authLoading}
        error={authError}
        onSubmit={authenticate}
        onClosePreview={currentUser ? () => setAuthPreviewOpen(false) : undefined}
      />
    );
  }

  const isAdmin = currentUser.role === 'admin';
  if (portal === 'admin' && !isAdmin) {
    return (
      <div className="quant-app quant-admin quant-loading">
        <div className="quant-auth-box">
          <h2>{lang === 'en' ? 'Admin Authorization Required' : 'Cần quyền quản trị'}</h2>
          <p>
            {lang === 'en'
              ? 'Current account does not have permission to access the Admin Command Station.'
              : 'Tài khoản hiện tại không có quyền truy cập Trạm Chỉ Huy Điều Hành.'}
          </p>
          <div className="flex gap-3">
            <button className="quant-primary flex-1" onClick={handleLogout}>
              {lang === 'en' ? 'Switch Account' : 'Đổi Tài Khoản'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const status = portal === 'admin' ? monitorStatus : dashboardStatus;

  return (
    <PortalShell
      portal={portal}
      page={portal === 'admin' ? adminTab : userTab}
      email={currentUser.email}
      onNavigate={(page) => (portal === 'admin' ? setAdminTab(page as AdminTabKey) : setUserTab(page as UserTabKey))}
      logout={handleLogout}
    >
      {status === 'loading' && (
        <div className="quant-status" role="status">
          Đang đồng bộ luồng dữ liệu định lượng…
        </div>
      )}
      {status === 'offline' && (
        <div className="quant-alert" role="status">
          Không thể cập nhật dữ liệu mới. Đang hiển thị bản ghi bộ nhớ đệm gần nhất.
        </div>
      )}
      <ToastNotification
        message={notice}
        type={noticeType}
        onClose={() => setNotice(null)}
      />

      {/* USER PORTAL VIEWS */}
      {portal === 'user' && (
        <>
          {userTab === 'overview' && (
            <UserOverviewTab
              totalBalance={totalBalance}
              totalEquity={totalEquity}
              totalPnl={totalPnl}
              totalPositions={totalPositions}
              mt5Connected={accounts.some((a: any) => a.deployment_state === 'DEPLOYED' || a.enabled || Number(a.auto_trade ?? 0) === 1)}
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
              activeTabSetter={(tab) => setUserTab(tab)}
            />
          )}

          {userTab === 'accounts' && (
            <UserAccountsTab accounts={accounts} refetchAccounts={loadDashboard} />
          )}

          {userTab === 'orders' && (
            <UserOrdersTab
              accounts={accounts}
              filteredUserOrders={userOrderQuery.data?.orders ?? dashboard.orders ?? []}
              status={userOrderQuery.status}
              orderAccountFilter={orderAccountFilter}
              setOrderAccountFilter={setOrderAccountFilter}
              orderStateFilter={orderStateFilter}
              setOrderStateFilter={setOrderStateFilter}
            />
          )}
        </>
      )}

      {/* ADMIN PORTAL VIEWS (3 Simplified Autonomous Tabs) */}
      {portal === 'admin' && (
        <>
          {adminTab === 'radar' && (
            <AdminCommandRadarTab
              killSwitchLoading={killSwitchLoading}
              handleToggleKillSwitch={handleToggleKillSwitch}
              onNavigateTab={(tab) => setAdminTab(tab)}
              monitorData={monitorData}
              refetchMonitor={loadAdminMonitor}
            />
          )}

          {adminTab === 'ai' && <AdminAIEvolutionTab />}

          {adminTab === 'business' && (
            <AdminBusinessCustomersTab accounts={monitorData.accounts} refetchAll={loadAdminMonitor} />
          )}
        </>
      )}
    </PortalShell>
  );
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AppContent />
      </LanguageProvider>
    </QueryClientProvider>
  );
};

export default App;
