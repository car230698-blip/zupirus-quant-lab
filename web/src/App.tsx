import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { apiGet, apiPost } from './api/client';
import { useRoute } from './hooks/useRoute';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import { AuthScreen } from './components/auth/AuthScreen';
import { UserLayout } from './layouts/UserLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ShieldAlert } from 'lucide-react';

const LandingPage = lazy(() =>
  import('./pages/landing/LandingPage').then((m) => ({ default: m.LandingPage }))
);
const UserCatalogPage = lazy(() =>
  import('./pages/user/UserCatalogPage').then((m) => ({ default: m.UserCatalogPage }))
);
const UserLibraryPage = lazy(() =>
  import('./pages/user/UserLibraryPage').then((m) => ({ default: m.UserLibraryPage }))
);
const UserBillingPage = lazy(() =>
  import('./pages/user/UserBillingPage').then((m) => ({ default: m.UserBillingPage }))
);
const AdminOverviewPage = lazy(() =>
  import('./pages/admin/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage }))
);
const AdminReportsPage = lazy(() =>
  import('./pages/admin/AdminReportsPage').then((m) => ({ default: m.AdminReportsPage }))
);
const AdminResearchPage = lazy(() =>
  import('./pages/admin/AdminResearchPage').then((m) => ({ default: m.AdminResearchPage }))
);
const AdminOrdersUsersPage = lazy(() =>
  import('./pages/admin/AdminOrdersUsersPage').then((m) => ({ default: m.AdminOrdersUsersPage }))
);

interface UserInfo {
  email: string;
  role: 'customer' | 'admin';
}

const PageLoader: React.FC<{ label?: string }> = ({ label }) => (
  <div className="min-h-screen bg-[#060A13] flex items-center justify-center p-6">
    <div className="flex flex-col items-center gap-3">
      <div className="h-9 w-9 rounded-lg border border-[#12B5A6]/40 bg-[#0B1220] flex items-center justify-center font-mono font-bold text-[#12B5A6]">
        Z
      </div>
      <span className="font-mono text-xs text-slate-400">{label || 'Đang tải...'}</span>
    </div>
  </div>
);

const AppContent: React.FC = () => {
  const { lang } = useLanguage();
  const { zone, isAuthRoute, userPage, adminPage, navigate } = useRoute();

  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      const data = await apiGet<UserInfo>('/api/me');
      setCurrentUser(data);
    } catch (err: any) {
      if (err?.status && err.status !== 401) {
        setAuthError('Không thể kiểm tra phiên đăng nhập.');
      }
      setCurrentUser(null);
    } finally {
      setAuthChecking(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__ZUPIRUS_USER_KEY__ = currentUser?.email || 'anonymous';
    }
    queryClient.clear();
  }, [currentUser?.email]);

  // Document title per separated zone
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (zone === 'admin') {
      document.title = 'ZUPIRUS Admin Console · Quản Trị Ấn Phẩm & Hệ Thống';
    } else if (zone === 'user') {
      document.title = 'ZUPIRUS Customer Portal · Thư Viện Báo Cáo PDF';
    } else {
      document.title = 'ZUPIRUS Quant Lab · Nghiên Cứu Định Lượng XAU/USD';
    }
  }, [zone]);

  // Helper to validate and get safe portal redirect target (ensuring internal navigation)
  const getSafePortalRedirect = useCallback((): string => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('zupirus_auth_redirect');
      if (stored && stored.startsWith('/portal') && !stored.includes('//')) {
        sessionStorage.removeItem('zupirus_auth_redirect');
        return stored;
      }
      const current = window.location.pathname;
      if (current && current.startsWith('/portal') && !current.includes('//')) {
        return current;
      }
    }
    return '/portal';
  }, []);

  // Save intended internal portal destination when visiting while unauthenticated
  useEffect(() => {
    if (typeof window !== 'undefined' && zone === 'user' && !currentUser && !isAuthRoute) {
      const current = window.location.pathname;
      if (current && current.startsWith('/portal') && !current.includes('//')) {
        sessionStorage.setItem('zupirus_auth_redirect', current);
      }
    }
  }, [zone, currentUser, isAuthRoute]);

  // Redirect away from /login or /admin/login once authenticated
  useEffect(() => {
    if (authChecking || !currentUser || !isAuthRoute) return;
    if (zone === 'admin' && currentUser.role === 'admin') {
      navigate('/admin', { replace: true });
    } else if (zone === 'user') {
      const dest = getSafePortalRedirect();
      navigate(dest, { replace: true });
    }
  }, [authChecking, currentUser, isAuthRoute, zone, navigate, getSafePortalRedirect]);

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

      let session: UserInfo;
      try {
        session = await apiPost<UserInfo>('/api/login', { email, password });
      } catch (err: any) {
        throw new Error(
          err?.status === 401 ? 'Email hoặc mật khẩu không chính xác.' : 'Không thể đăng nhập. Vui lòng thử lại.'
        );
      }

      setCurrentUser(session);
      if (zone === 'admin') {
        if (session.role === 'admin') {
          navigate('/admin', { replace: true });
        }
      } else {
        const dest = getSafePortalRedirect();
        navigate(dest, { replace: true });
      }
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
    setAuthError(null);
    navigate(zone === 'admin' ? '/admin/login' : '/login', { replace: true });
  };

  // 1. PUBLIC LANDING PAGE (/)
  if (zone === 'landing') {
    return (
      <Suspense fallback={<PageLoader label="Đang tải ZUPIRUS Quant Lab..." />}>
        <LandingPage onNavigate={navigate} />
      </Suspense>
    );
  }

  // Wait for auth check for private workspaces
  if (authChecking) {
    return <PageLoader label={lang === 'en' ? 'Verifying session...' : 'Đang xác thực phiên làm việc...'} />;
  }

  // 2. ADMIN CONSOLE (/admin/login, /admin/*)
  if (zone === 'admin') {
    if (!currentUser || isAuthRoute) {
      return (
        <AuthScreen
          mode="admin"
          loading={authLoading}
          error={authError}
          onSubmit={authenticate}
          onNavigateHome={() => navigate('/')}
          onSwitchZone={() => navigate('/login')}
        />
      );
    }

    if (currentUser.role !== 'admin') {
      return (
        <div data-portal="admin" className="min-h-screen bg-[#060A13] flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/35 bg-[#0B1220] p-7 space-y-5 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-rose-500/35 bg-rose-500/10 text-rose-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div className="space-y-1.5">
              <div className="font-mono text-xs font-semibold uppercase tracking-wider text-rose-400">
                403 · FORBIDDEN
              </div>
              <h1 className="text-xl font-bold text-white">
                {lang === 'en' ? 'Admin Authorization Required' : 'Cần quyền Quản trị viên'}
              </h1>
              <p className="text-xs text-slate-400 leading-relaxed">
                {lang === 'en'
                  ? `Signed in as ${currentUser.email} (customer). This route is restricted to administrators.`
                  : `Tài khoản ${currentUser.email} thuộc nhóm Khách hàng, không có quyền truy cập Trạm Quản Trị.`}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => navigate('/portal')}
                className="quant-btn-secondary flex-1 text-xs"
              >
                {lang === 'en' ? 'Open Customer Portal' : 'Về Cổng Khách Hàng'}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="quant-btn-primary flex-1 text-xs"
              >
                {lang === 'en' ? 'Sign In as Admin' : 'Đổi tài khoản Admin'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <AdminLayout
        activePage={adminPage}
        email={currentUser.email}
        onNavigate={navigate}
        onLogout={handleLogout}
      >
        <Suspense fallback={<PageLoader label="Đang tải phân hệ quản trị..." />}>
          {adminPage === 'overview' && <AdminOverviewPage onNavigate={navigate} />}
          {adminPage === 'reports' && <AdminReportsPage />}
          {adminPage === 'research' && <AdminResearchPage />}
          {adminPage === 'orders' && <AdminOrdersUsersPage />}
        </Suspense>
      </AdminLayout>
    );
  }

  // 3. CUSTOMER PORTAL (/login, /portal/*)
  if (!currentUser || isAuthRoute) {
    return (
      <AuthScreen
        mode="user"
        loading={authLoading}
        error={authError}
        onSubmit={authenticate}
        onNavigateHome={() => navigate('/')}
        onSwitchZone={() => navigate('/admin/login')}
      />
    );
  }

  return (
    <UserLayout
      activePage={userPage}
      email={currentUser.email}
      onNavigate={navigate}
      onLogout={handleLogout}
    >
      <Suspense fallback={<PageLoader label="Đang tải thư viện..." />}>
        {userPage === 'catalog' && <UserCatalogPage onNavigate={navigate} />}
        {userPage === 'library' && <UserLibraryPage onNavigate={navigate} />}
        {userPage === 'billing' && <UserBillingPage onNavigate={navigate} />}
      </Suspense>
    </UserLayout>
  );
};

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <AppContent />
        </LanguageProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
