import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UserOrdersTab } from './UserOrdersTab';
import { ConnectedAccountsListSection } from './ConnectedAccountsListSection';
import { CandlestickTelemetryChart } from './CandlestickTelemetryChart';
import { LandingPricingAndFaqSection } from './LandingPricingAndFaqSection';
import { QuantReportCatalogAndLibrary } from './QuantReportCatalogAndLibrary';
import { PRICING_TIERS } from '../data/landingData';

test('UserOrdersTab renders Prop Firm ledger KPIs, win rate, and net PnL accurately', () => {
  const html = renderToStaticMarkup(
    React.createElement(UserOrdersTab, {
      accounts: [{ id: 'acc_prop_ftmo_100k_passed', login: '88109245', server: 'FTMO-Server' }],
      orders: [
        {
          id: 'exec_1',
          account_id: 'acc_prop_ftmo_100k_passed',
          symbol: 'XAUUSD',
          side: 'BUY',
          volume: 1.2,
          price: 3720.5,
          state: 'filled',
          status: 'FILLED',
          pnl: 1320.0,
          created_at: 1795000000,
        },
        {
          id: 'exec_2',
          account_id: 'acc_prop_ftmo_100k_passed',
          symbol: 'XAUUSD',
          side: 'SELL',
          volume: 1.0,
          price: 3714.0,
          state: 'filled',
          status: 'FILLED',
          pnl: -420.0,
          created_at: 1795003600,
        },
      ],
      status: 'ready',
    }),
  );

  assert.match(html, /XAUUSD/);
  assert.match(html, /50%/);
  assert.match(html, /900\.00/);
});

test('ConnectedAccountsListSection renders 3 LIVE Prop accounts and empty state cleanly', () => {
  const noop = () => {};
  const form = {
    lot_multiplier: '1.0',
    max_daily_dd_pct: '4.0',
    max_lot: '2.0',
    daily_profit_target_usd: '2500',
    symbol_mapping_custom: 'XAUUSD',
    is_prop_firm_mode: true,
    prop_stage: 'LIVE' as const,
  };

  const emptyHtml = renderToStaticMarkup(
    React.createElement(ConnectedAccountsListSection, {
      accounts: [],
      expandedConfigId: null,
      setExpandedConfigId: noop,
      cloudBusy: false,
      editConfigForm: form,
      setEditConfigForm: noop as any,
      handleSyncAccount: noop,
      handleOpenEditConfig: noop,
      handleCloudDeployToggle: noop,
      handleToggleAccount: noop,
      handleDeleteAccount: noop,
      handleSaveAccountConfig: noop,
    }),
  );
  assert.match(emptyHtml, /Chưa có tài khoản MT5 nào/);

  const populatedHtml = renderToStaticMarkup(
    React.createElement(ConnectedAccountsListSection, {
      accounts: [
        {
          id: 'acc_1',
          account_name: 'FTMO $100K — LIVE FUNDED (+10.42%)',
          broker_server: 'FTMO-Server',
          deployment_state: 'DEPLOYED',
          balance: 110420,
          equity: 110420,
          is_active: true,
        },
        {
          id: 'acc_2',
          account_name: 'The5ers $100K — LIVE FUNDED (+8.65%)',
          broker_server: 'FivePercentOnline-Live',
          deployment_state: 'DEPLOYED',
          balance: 108650,
          equity: 108650,
          is_active: true,
        },
      ],
      expandedConfigId: 'acc_1',
      setExpandedConfigId: noop,
      cloudBusy: false,
      editConfigForm: form,
      setEditConfigForm: noop as any,
      handleSyncAccount: noop,
      handleOpenEditConfig: noop,
      handleCloudDeployToggle: noop,
      handleToggleAccount: noop,
      handleDeleteAccount: noop,
      handleSaveAccountConfig: noop,
    }),
  );
  assert.match(populatedHtml, /FTMO \$100K/);
  assert.match(populatedHtml, /The5ers \$100K/);
  assert.match(populatedHtml, /Tổng cộng: 2 tài khoản/);
  assert.match(populatedHtml, /Tham Số Quản Trị Rủi Ro/);
});

test('CandlestickTelemetryChart renders SVG candles and empty sync state', () => {
  const noop = () => {};
  const emptyHtml = renderToStaticMarkup(
    React.createElement(CandlestickTelemetryChart, {
      candles: [],
      symbol: 'XAUUSD',
      timeframe: 'M15',
      liveBid: 3725.5,
      liveAtr14: 4.2,
      hoveredCandleIdx: null,
      setHoveredCandleIdx: noop,
      showEmaOverlay: true,
      setShowEmaOverlay: noop as any,
      showBbChannel: true,
      setShowBbChannel: noop as any,
    }),
  );
  assert.match(emptyHtml, /Đang đồng bộ luồng nến XAUUSD/);

  const chartHtml = renderToStaticMarkup(
    React.createElement(CandlestickTelemetryChart, {
      candles: [
        { timestamp: 1, open: 3710, high: 3722, low: 3705, close: 3718 },
        { timestamp: 2, open: 3718, high: 3730, low: 3715, close: 3726 },
      ],
      symbol: 'XAUUSD',
      timeframe: 'M15',
      liveBid: 3726.0,
      liveAtr14: 5.5,
      hoveredCandleIdx: null,
      setHoveredCandleIdx: noop,
      showEmaOverlay: true,
      setShowEmaOverlay: noop as any,
      showBbChannel: true,
      setShowBbChannel: noop as any,
    }),
  );
  assert.match(chartHtml, /data-testid="candlestick-svg"/);
  assert.match(chartHtml, /EMA-10 ON/);
});

test('LandingPricingAndFaqSection renders all pricing tiers and FAQ items', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(
    React.createElement(LandingPricingAndFaqSection, {
      tiers: PRICING_TIERS,
      billingCycle: 'MONTHLY',
      setBillingCycle: noop,
      currencyMode: 'VND',
      setCurrencyMode: noop,
      usdVndRate: 25500,
      setQrPreviewTier: noop,
      onEnterPortal: noop,
    }),
  );
  assert.match(html, /Biểu Phí Hạ Tầng Đám Mây Cloud MT5/);
  assert.match(html, /Câu Hỏi Thường Gặp/);
  assert.match(html, /ZUPIRUS có giữ tiền nạp của tôi không/);
});

test('QuantReportCatalogAndLibrary renders published XAU/USD PDF research catalog and sample preview link', () => {
  const html = renderToStaticMarkup(
    React.createElement(QuantReportCatalogAndLibrary, {
      mode: 'public',
    }),
  );
  assert.match(html, /Danh Mục Báo Cáo Nghiên Cứu Định Lượng XAU\/USD/);
  assert.match(html, /XAUUSD/);
  assert.match(html, /v1\.0/);
  assert.match(html, /Xem Bản Đọc Thử PDF/);
});
