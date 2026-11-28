import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageProvider } from '../i18n/LanguageContext';
import { resolveRoutePath } from '../hooks/useRoute';
import { LandingPage } from '../pages/landing/LandingPage';
import { AuthScreen } from './auth/AuthScreen';
import { UserLayout } from '../layouts/UserLayout';
import { AdminLayout } from '../layouts/AdminLayout';
import { QuantReportCatalogAndLibrary } from './reports/QuantReportCatalogAndLibrary';
import { UserBillingSection } from './reports/UserBillingSection';
import { AdminOverviewPage } from '../pages/admin/AdminOverviewPage';

const withLang = (node: React.ReactElement) =>
  React.createElement(LanguageProvider, null, node);

test('resolveRoutePath isolates Landing, User Portal, and Admin Console routes cleanly', () => {
  assert.deepEqual(resolveRoutePath('/'), {
    pathname: '/',
    zone: 'landing',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'overview',
  });

  assert.deepEqual(resolveRoutePath('/login'), {
    pathname: '/login',
    zone: 'user',
    isAuthRoute: true,
    userPage: 'catalog',
    adminPage: 'overview',
  });

  assert.deepEqual(resolveRoutePath('/portal/library'), {
    pathname: '/portal/library',
    zone: 'user',
    isAuthRoute: false,
    userPage: 'library',
    adminPage: 'overview',
  });

  assert.deepEqual(resolveRoutePath('/portal/billing'), {
    pathname: '/portal/billing',
    zone: 'user',
    isAuthRoute: false,
    userPage: 'billing',
    adminPage: 'overview',
  });

  assert.deepEqual(resolveRoutePath('/admin/login'), {
    pathname: '/admin/login',
    zone: 'admin',
    isAuthRoute: true,
    userPage: 'catalog',
    adminPage: 'overview',
  });

  assert.deepEqual(resolveRoutePath('/admin/research'), {
    pathname: '/admin/research',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'research',
  });

  assert.deepEqual(resolveRoutePath('/admin/orders'), {
    pathname: '/admin/orders',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'orders',
  });

  assert.deepEqual(resolveRoutePath('/admin/users'), {
    pathname: '/admin/users',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'orders',
    adminSubTab: 'users',
  });

  assert.deepEqual(resolveRoutePath('/admin/settings'), {
    pathname: '/admin/settings',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'orders',
    adminSubTab: 'settings',
  });
});

test('LandingPage renders separated public landing layout, catalog, methodology, and FAQ', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(
    withLang(React.createElement(LandingPage, { onNavigate: noop }))
  );

  assert.match(html, /ZUPIRUS/);
  assert.match(html, /COMEX|GC=F|Gold/);
  assert.match(html, /M15/);
  assert.doesNotMatch(html, /ADMIN OPERATIONS CONSOLE/);
});

test('AuthScreen separates Customer Portal login (OTP registration enabled) from Admin Console login', () => {
  const noopAsync = async () => {};
  const noop = () => {};

  const userAuthHtml = renderToStaticMarkup(
    withLang(
      React.createElement(AuthScreen, {
        mode: 'user',
        loading: false,
        error: null,
        onSubmit: noopAsync,
        onNavigateHome: noop,
      })
    )
  );
  assert.match(userAuthHtml, /data-portal="user"/);
  assert.match(userAuthHtml, /ZUPIRUS RESEARCH LIBRARY/);
  assert.doesNotMatch(userAuthHtml, /ADMIN OPERATIONS CONSOLE/);

  const adminAuthHtml = renderToStaticMarkup(
    withLang(
      React.createElement(AuthScreen, {
        mode: 'admin',
        loading: false,
        error: null,
        onSubmit: noopAsync,
        onNavigateHome: noop,
      })
    )
  );
  assert.match(adminAuthHtml, /data-portal="admin"/);
  assert.match(adminAuthHtml, /ADMIN OPERATIONS CONSOLE/);
  assert.doesNotMatch(adminAuthHtml, /Register with email OTP/);
});

test('UserLayout and AdminLayout render strictly separated navigation shells', () => {
  const noop = () => {};

  const userShellHtml = renderToStaticMarkup(
    withLang(
      React.createElement(UserLayout, {
        activePage: 'library',
        email: 'client@example.com',
        onNavigate: noop,
        onLogout: noop,
        children: React.createElement('div', null, 'User Body'),
      })
    )
  );
  assert.match(userShellHtml, /data-portal="user"/);
  assert.match(userShellHtml, /client@example\.com/);
  assert.match(userShellHtml, /User Body/);
  assert.doesNotMatch(userShellHtml, /Admin Console/);

  const adminShellHtml = renderToStaticMarkup(
    withLang(
      React.createElement(AdminLayout, {
        activePage: 'reports',
        email: 'admin@zupirus.local',
        onNavigate: noop,
        onLogout: noop,
        children: React.createElement('div', null, 'Admin Body'),
      })
    )
  );
  assert.match(adminShellHtml, /data-portal="admin"/);
  assert.match(adminShellHtml, /admin@zupirus\.local/);
  assert.match(adminShellHtml, /Admin Console/);
  assert.match(adminShellHtml, /Admin Body/);
});

test('QuantReportCatalogAndLibrary renders research catalog without fake fallback reports', () => {
  const html = renderToStaticMarkup(
    withLang(
      React.createElement(QuantReportCatalogAndLibrary, {
        mode: 'public',
      })
    )
  );
  assert.match(html, /reports-catalog/);
  assert.match(html, /No published reports currently listed|Hiện chưa có báo cáo/);
});

test('UserBillingSection and AdminOverviewPage render without crashes or legacy globals', () => {
  const noop = () => {};
  const billingHtml = renderToStaticMarkup(
    withLang(React.createElement(UserBillingSection))
  );
  assert.match(billingHtml, /USDT|Referral|Biên lai|Receipts/i);

  const adminOverviewHtml = renderToStaticMarkup(
    withLang(React.createElement(AdminOverviewPage, { onNavigate: noop }))
  );
  assert.match(adminOverviewHtml, /ZUPIRUS|Admin|Published|Research/i);
});
