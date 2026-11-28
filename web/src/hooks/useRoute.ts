import { useState, useEffect, useCallback } from 'react';

export type ZoneType = 'landing' | 'user' | 'admin';
export type UserPageKey = 'catalog' | 'library' | 'billing';
export type AdminPageKey = 'overview' | 'reports' | 'research' | 'orders';
export type AdminSubTabKey = 'research_orders' | 'orders' | 'trials' | 'users' | 'settings';

export interface RouteState {
  pathname: string;
  zone: ZoneType;
  isAuthRoute: boolean;
  userPage: UserPageKey;
  adminPage: AdminPageKey;
  adminSubTab?: AdminSubTabKey;
}

export function resolveRoutePath(
  rawPath: string,
  host = '',
  queryPortal: string | null = null
): RouteState {
  const cleanHost = host.toLowerCase();
  const path = rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath || '/';

  // Subdomain adm.zupirus.com support
  if (cleanHost.startsWith('adm.')) {
    if (path === '/' || path === '' || path === '/overview') {
      return {
        pathname: '/admin',
        zone: 'admin',
        isAuthRoute: false,
        userPage: 'catalog',
        adminPage: 'overview',
      };
    }
    if (path === '/reports') {
      return {
        pathname: '/admin/reports',
        zone: 'admin',
        isAuthRoute: false,
        userPage: 'catalog',
        adminPage: 'reports',
      };
    }
    if (path === '/research') {
      return {
        pathname: '/admin/research',
        zone: 'admin',
        isAuthRoute: false,
        userPage: 'catalog',
        adminPage: 'research',
      };
    }
    if (path === '/users') {
      return {
        pathname: '/admin/users',
        zone: 'admin',
        isAuthRoute: false,
        userPage: 'catalog',
        adminPage: 'orders',
        adminSubTab: 'users',
      };
    }
    if (path === '/settings') {
      return {
        pathname: '/admin/settings',
        zone: 'admin',
        isAuthRoute: false,
        userPage: 'catalog',
        adminPage: 'orders',
        adminSubTab: 'settings',
      };
    }
    if (path === '/orders') {
      return {
        pathname: '/admin/orders',
        zone: 'admin',
        isAuthRoute: false,
        userPage: 'catalog',
        adminPage: 'orders',
        adminSubTab: 'orders',
      };
    }
  }

  // Backward compatibility for legacy ?portal=user | ?portal=admin or subdomain deployments
  if (queryPortal === 'admin' || (cleanHost.startsWith('adm.') && path === '/')) {
    return {
      pathname: '/admin',
      zone: 'admin',
      isAuthRoute: false,
      userPage: 'catalog',
      adminPage: 'overview',
    };
  }
  if (queryPortal === 'user' || (cleanHost.startsWith('app.') && path === '/')) {
    return {
      pathname: '/portal',
      zone: 'user',
      isAuthRoute: false,
      userPage: 'catalog',
      adminPage: 'overview',
    };
  }

  // Admin zone routes
  if (path === '/admin/login') {
    return {
      pathname: path,
      zone: 'admin',
      isAuthRoute: true,
      userPage: 'catalog',
      adminPage: 'overview',
    };
  }
  if (path === '/admin' || path.startsWith('/admin/')) {
    let adminPage: AdminPageKey = 'overview';
    let adminSubTab: AdminSubTabKey | undefined = undefined;

    if (path === '/admin' || path === '/admin/overview') {
      adminPage = 'overview';
    } else if (path === '/admin/reports') {
      adminPage = 'reports';
    } else if (path === '/admin/research') {
      adminPage = 'research';
    } else if (path === '/admin/orders') {
      adminPage = 'orders';
    } else if (path === '/admin/users') {
      adminPage = 'orders';
      adminSubTab = 'users';
    } else if (path === '/admin/settings') {
      adminPage = 'orders';
      adminSubTab = 'settings';
    } else {
      adminPage = 'orders';
    }

    const ret: RouteState = {
      pathname: path,
      zone: 'admin',
      isAuthRoute: false,
      userPage: 'catalog',
      adminPage,
    };
    if (adminSubTab) {
      ret.adminSubTab = adminSubTab;
    }
    return ret;
  }

  // User portal routes
  if (path === '/login' || path === '/register') {
    return {
      pathname: '/login',
      zone: 'user',
      isAuthRoute: true,
      userPage: 'catalog',
      adminPage: 'overview',
    };
  }
  if (path === '/portal' || path.startsWith('/portal/')) {
    let userPage: UserPageKey = 'catalog';
    if (path === '/portal/library') userPage = 'library';
    else if (path === '/portal/billing') userPage = 'billing';

    return {
      pathname: path,
      zone: 'user',
      isAuthRoute: false,
      userPage,
      adminPage: 'overview',
    };
  }

  // Public landing route
  return {
    pathname: '/',
    zone: 'landing',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'overview',
  };
}

function parseLocation(): RouteState {
  if (typeof window === 'undefined') {
    return resolveRoutePath('/');
  }

  const host = window.location.hostname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const queryPortal = params.get('portal');
  const rawPath = window.location.pathname || '/';
  return resolveRoutePath(rawPath, host, queryPortal);
}

export function useRoute() {
  const [route, setRoute] = useState<RouteState>(() => parseLocation());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Normalize legacy ?portal= query into clean path URL
    const params = new URLSearchParams(window.location.search);
    const qPortal = params.get('portal');
    if (qPortal === 'admin' || qPortal === 'user') {
      const target = qPortal === 'admin' ? '/admin' : '/portal';
      params.delete('portal');
      const qs = params.toString();
      window.history.replaceState({}, '', `${target}${qs ? `?${qs}` : ''}`);
      setRoute(parseLocation());
    }

    const onPopState = () => {
      setRoute(parseLocation());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (typeof window === 'undefined') return;
    const normalized = to.startsWith('/') ? to : `/${to}`;
    const nextUrl = new URL(normalized, window.location.origin);
    if (opts?.replace) {
      window.history.replaceState({}, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
    } else {
      window.history.pushState({}, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
    }
    setRoute(parseLocation());
    if (!nextUrl.hash) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, []);

  return { ...route, navigate };
}
