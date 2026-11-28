import { useState, useEffect, useCallback } from 'react';

export type ZoneType = 'landing' | 'user' | 'admin';
export type UserPageKey = 'catalog' | 'library' | 'billing';
export type AdminPageKey = 'queue' | 'all_records' | 'settings';
export type AdminSubTabKey = 'users' | 'settings' | 'tools';

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

  const isAdmHost = cleanHost.startsWith('adm.');
  const isAdminQuery = queryPortal === 'admin';
  const isAdminPath = path === '/admin' || path.startsWith('/admin/');

  // Admin zone routes (adm subdomain, ?portal=admin, or explicit /admin path)
  if (isAdmHost || isAdminQuery || isAdminPath) {
    if (path === '/admin/login' || (isAdmHost && (path === '/login' || path === '/register'))) {
      return {
        pathname: path.startsWith('/admin/') ? path : '/admin/login',
        zone: 'admin',
        isAuthRoute: true,
        userPage: 'catalog',
        adminPage: 'queue',
      };
    }

    if (
      path === '/admin/all' ||
      path === '/admin/orders' ||
      path === '/admin/records' ||
      ((isAdmHost || isAdminQuery) && (path === '/all' || path === '/orders' || path === '/records'))
    ) {
      return {
        pathname: path.startsWith('/admin/') ? path : '/admin/all',
        zone: 'admin',
        isAuthRoute: false,
        userPage: 'catalog',
        adminPage: 'all_records',
      };
    }

    if (
      path === '/admin/users' ||
      ((isAdmHost || isAdminQuery) && path === '/users')
    ) {
      return {
        pathname: path.startsWith('/admin/') ? path : '/admin/settings',
        zone: 'admin',
        isAuthRoute: false,
        userPage: 'catalog',
        adminPage: 'settings',
        adminSubTab: 'users',
      };
    }

    if (
      path === '/admin/tools' ||
      ((isAdmHost || isAdminQuery) && path === '/tools')
    ) {
      return {
        pathname: path.startsWith('/admin/') ? path : '/admin/settings',
        zone: 'admin',
        isAuthRoute: false,
        userPage: 'catalog',
        adminPage: 'settings',
        adminSubTab: 'tools',
      };
    }

    if (
      path === '/admin/settings' ||
      ((isAdmHost || isAdminQuery) && path === '/settings')
    ) {
      return {
        pathname: path.startsWith('/admin/') ? path : '/admin/settings',
        zone: 'admin',
        isAuthRoute: false,
        userPage: 'catalog',
        adminPage: 'settings',
        adminSubTab: 'settings',
      };
    }

    // Default queue for admin (/admin, /admin/queue, /queue, /, /overview, etc.)
    return {
      pathname: path.startsWith('/admin/') ? path : '/admin',
      zone: 'admin',
      isAuthRoute: false,
      userPage: 'catalog',
      adminPage: 'queue',
    };
  }

  // Backward compatibility for legacy ?portal=user or app. subdomain
  if (queryPortal === 'user' || (cleanHost.startsWith('app.') && path === '/')) {
    return {
      pathname: '/portal',
      zone: 'user',
      isAuthRoute: false,
      userPage: 'catalog',
      adminPage: 'queue',
    };
  }

  // User portal routes
  if (path === '/login' || path === '/register') {
    return {
      pathname: '/login',
      zone: 'user',
      isAuthRoute: true,
      userPage: 'catalog',
      adminPage: 'queue',
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
      adminPage: 'queue',
    };
  }

  // Public landing route
  return {
    pathname: '/',
    zone: 'landing',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'queue',
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
