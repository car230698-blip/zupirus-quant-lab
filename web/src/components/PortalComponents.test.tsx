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
import { OrderChatModal } from './research/OrderChatModal';

const withLang = (node: React.ReactElement) =>
  React.createElement(LanguageProvider, null, node);

test('resolveRoutePath isolates Landing, User Portal, and Admin Console routes cleanly', () => {
  assert.deepEqual(resolveRoutePath('/'), {
    pathname: '/',
    zone: 'landing',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'queue',
  });

  assert.deepEqual(resolveRoutePath('/login'), {
    pathname: '/login',
    zone: 'user',
    isAuthRoute: true,
    userPage: 'catalog',
    adminPage: 'queue',
  });

  assert.deepEqual(resolveRoutePath('/portal/library'), {
    pathname: '/portal/library',
    zone: 'user',
    isAuthRoute: false,
    userPage: 'library',
    adminPage: 'queue',
  });

  assert.deepEqual(resolveRoutePath('/portal/billing'), {
    pathname: '/portal/billing',
    zone: 'user',
    isAuthRoute: false,
    userPage: 'billing',
    adminPage: 'queue',
  });

  assert.deepEqual(resolveRoutePath('/admin/login'), {
    pathname: '/admin/login',
    zone: 'admin',
    isAuthRoute: true,
    userPage: 'catalog',
    adminPage: 'queue',
  });

  assert.deepEqual(resolveRoutePath('/admin/research'), {
    pathname: '/admin/research',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'queue',
  });

  assert.deepEqual(resolveRoutePath('/admin/orders'), {
    pathname: '/admin/orders',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'all_records',
  });

  assert.deepEqual(resolveRoutePath('/admin/users'), {
    pathname: '/admin/users',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'settings',
    adminSubTab: 'users',
  });

  assert.deepEqual(resolveRoutePath('/admin/settings'), {
    pathname: '/admin/settings',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'settings',
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
        activePage: 'queue',
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

test('resolveRoutePath on adm.zupirus.com resolves /admin, /admin/all, /admin/settings, /admin/login and legacy /all, /settings cleanly', () => {
  const host = 'adm.zupirus.com';

  // 1. Root and queue
  assert.deepEqual(resolveRoutePath('/', host), {
    pathname: '/admin',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'queue',
  });
  assert.deepEqual(resolveRoutePath('/admin', host), {
    pathname: '/admin',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'queue',
  });
  assert.deepEqual(resolveRoutePath('/queue', host), {
    pathname: '/admin',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'queue',
  });

  // 2. All records and legacy /all, /orders
  assert.deepEqual(resolveRoutePath('/admin/all', host), {
    pathname: '/admin/all',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'all_records',
  });
  assert.deepEqual(resolveRoutePath('/all', host), {
    pathname: '/admin/all',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'all_records',
  });
  assert.deepEqual(resolveRoutePath('/orders', host), {
    pathname: '/admin/all',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'all_records',
  });

  // 3. Settings and legacy /settings, /users
  assert.deepEqual(resolveRoutePath('/admin/settings', host), {
    pathname: '/admin/settings',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'settings',
    adminSubTab: 'settings',
  });
  assert.deepEqual(resolveRoutePath('/settings', host), {
    pathname: '/admin/settings',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'settings',
    adminSubTab: 'settings',
  });
  assert.deepEqual(resolveRoutePath('/admin/users', host), {
    pathname: '/admin/users',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'settings',
    adminSubTab: 'users',
  });
  assert.deepEqual(resolveRoutePath('/users', host), {
    pathname: '/admin/settings',
    zone: 'admin',
    isAuthRoute: false,
    userPage: 'catalog',
    adminPage: 'settings',
    adminSubTab: 'users',
  });

  // 4. Admin Login and legacy /login on adm subdomain
  assert.deepEqual(resolveRoutePath('/admin/login', host), {
    pathname: '/admin/login',
    zone: 'admin',
    isAuthRoute: true,
    userPage: 'catalog',
    adminPage: 'queue',
  });
  assert.deepEqual(resolveRoutePath('/login', host), {
    pathname: '/admin/login',
    zone: 'admin',
    isAuthRoute: true,
    userPage: 'catalog',
    adminPage: 'queue',
  });
});

test('AdminLayout renders 3-item navigation, mobile toggle, and search shortcut', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(
    withLang(
      React.createElement(AdminLayout, {
        activePage: 'all_records',
        email: 'ops@zupirus.com',
        onNavigate: noop,
        onLogout: noop,
        children: React.createElement('div', null, 'Queue Content'),
      })
    )
  );

  // Checks 3 nav buttons
  assert.match(html, /Cần xử lý|Actionable Queue/);
  assert.match(html, /Tất cả hồ sơ|All Records/);
  assert.match(html, /Cài đặt|Settings/);

  // Checks mobile toggle button
  assert.match(html, /aria-label="Toggle sidebar"/);

  // Checks search shortcut
  assert.match(html, /⌘K|Ctrl\+K/);

  // Checks active page content
  assert.match(html, /Queue Content/);
});

test('OrderChatModal renders close buttons and supports embedded mode for admin dossier', () => {
  const noop = () => {};

  // Modal mode (e.g. client portal)
  const modalHtml = renderToStaticMarkup(
    React.createElement(OrderChatModal, {
      requestId: 'crr_test_123',
      orderTitle: 'XAUUSD Quant Study',
      currentStatus: 'PENDING_QUOTE',
      userRole: 'admin',
      embedded: false,
      onClose: noop,
    })
  );
  assert.match(modalHtml, /role="dialog"/);
  assert.match(modalHtml, /fixed inset-0/);
  assert.match(modalHtml, /title="Đóng \(Esc\)"/);
  assert.match(modalHtml, /crr_test_123/);

  // Embedded mode (e.g. inside admin dossier tab)
  const embeddedHtml = renderToStaticMarkup(
    React.createElement(OrderChatModal, {
      requestId: 'crr_test_embedded',
      orderTitle: 'EURUSD Quant Study',
      currentStatus: 'READY_FOR_REVIEW',
      userRole: 'admin',
      embedded: true,
      onClose: noop,
    })
  );
  assert.doesNotMatch(embeddedHtml, /role="dialog"/);
  assert.doesNotMatch(embeddedHtml, /fixed inset-0/);
  assert.doesNotMatch(embeddedHtml, /title="Đóng \(Esc\)"/);
  assert.match(embeddedHtml, /crr_test_embedded/);
});
