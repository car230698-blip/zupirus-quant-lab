import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateQuantLotSizing,
  calculateSubscriptionPricing,
  computeOrderLedgerMetrics,
} from './quantMath';
import { fmtNum, fmtPnL, readStrategyDecision } from './strategyDecision';
import { translateOrderStatus, translateAction, translateRegime } from './stateMapping';

test('calculateQuantLotSizing computes accurate Standard, Cent, and Prop lot sizes and R-multiples', () => {
  const std = calculateQuantLotSizing({
    equity: 10000,
    riskPct: 1.0,
    slPoints: 250,
    accountType: 'standard',
  });
  assert.equal(std.riskDollars, 100);
  assert.equal(std.recommendedLot, 0.4);
  assert.equal(std.oneRProfitDollars, 100);
  assert.equal(std.twoRProfitDollars, 200);
  assert.equal(std.propDailyLimitDollars, 450);

  const cent = calculateQuantLotSizing({
    equity: 1000,
    riskPct: 1.5,
    slPoints: 300,
    accountType: 'cent',
  });
  assert.equal(cent.riskDollars, 15);
  assert.equal(cent.recommendedLot, 5.0);
  assert.equal(cent.lotUnitLabel, 'Cent Lots (USC)');
});

test('calculateSubscriptionPricing applies cycle discounts and rounds VND to nearest thousand', () => {
  const monthly = calculateSubscriptionPricing(25, 1, 'MONTHLY', 25500);
  assert.equal(monthly.usdTotal, 25);
  assert.equal(monthly.discountPct, 0);
  assert.equal(monthly.vndTotal, 638000);

  const annual = calculateSubscriptionPricing(59, 2, 'ANNUAL', 25500);
  // (59 + 10) * 12 * 0.80 = 662.4 USD
  assert.equal(annual.usdTotal, 662.4);
  assert.equal(annual.discountPct, 20);
  assert.equal(annual.effectiveMonthlyUsd, 55.2);
});

test('computeOrderLedgerMetrics calculates win rate, net PnL, and profit factor accurately', () => {
  const metrics = computeOrderLedgerMetrics([
    { id: 1, state: 'filled', pnl: 120.5 },
    { id: 2, state: 'filled', pnl: 80.0 },
    { id: 3, state: 'filled', pnl: -50.0 },
    { id: 4, state: 'queued', pnl: 0 },
  ]);
  assert.equal(metrics.totalCount, 4);
  assert.equal(metrics.filledCount, 3);
  assert.equal(metrics.winCount, 2);
  assert.equal(metrics.lossCount, 1);
  assert.equal(metrics.winRatePct, 66.7);
  assert.equal(metrics.netPnl, 150.5);
  assert.equal(metrics.profitFactor, 4.01);
});

test('strategyDecision and stateMapping formatters handle edge cases cleanly', () => {
  assert.equal(fmtNum(2908.456, 2), '2,908.46');
  assert.equal(fmtPnL(145.2), '+$145.20');
  assert.equal(fmtPnL(-42.5), '-$42.50');
  assert.deepEqual(readStrategyDecision('{"version":"2.5","timeframe":"M15"}'), {
    version: '2.5',
    timeframe: 'M15',
  });
  assert.equal(translateOrderStatus('filled'), 'Đã khớp');
  assert.equal(translateAction('BUY'), 'MUA (BUY)');
  assert.equal(translateRegime('TRENDING_BULL'), 'Xu Hướng Mạnh (Trending)');
});
