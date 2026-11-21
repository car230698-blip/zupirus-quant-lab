import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCentAccount,
  normalizeCentToUsd,
  formatAccountMoney,
  formatAccountBalance,
  formatAccountEquity,
  formatTradePnl,
  formatAccountPnL,
} from './currencyFormat';

test('currencyFormat correctly identifies cent accounts', () => {
  assert.equal(isCentAccount({ account_type: 'CENT' }), true);
  assert.equal(isCentAccount({ currency: 'USC' }), true);
  assert.equal(isCentAccount({ currency: 'EUC' }), true);
  assert.equal(isCentAccount({ broker_server: 'Exness-Cent' }), true);
  assert.equal(isCentAccount({ account_server: 'ICMarkets-Cent' }), true);
  assert.equal(isCentAccount({ account_type: 'STANDARD', currency: 'USD' }), false);
});

test('currencyFormat normalizes cent values to USD', () => {
  assert.equal(normalizeCentToUsd(50000, { currency: 'USC' }), 500);
  assert.equal(normalizeCentToUsd(100, { currency: 'USD' }), 100);
});

test('currencyFormat formats money for Cent and Standard accounts', () => {
  assert.equal(formatAccountMoney(50000, { currency: 'USC' }), '50,000 USC (≈ $500.00)');
  assert.equal(formatAccountMoney(500, { currency: 'USD' }), '$500.00');
  assert.equal(formatAccountBalance(50000, { currency: 'USC' }), '50,000 USC (≈ $500.00)');
  assert.equal(formatAccountEquity(50000, { currency: 'USC' }), '50,000 USC (≈ $500.00)');
});

test('currencyFormat formats trade PnL for Cent and Standard accounts', () => {
  assert.equal(formatTradePnl(500, { currency: 'USC' }), '+500 USC (≈ +$5.00)');
  assert.equal(formatTradePnl(-250, { currency: 'USC' }), '-250 USC (≈ -$2.50)');
  assert.equal(formatTradePnl(50, { currency: 'USD' }), '+$50.00');
  assert.equal(formatTradePnl(-25, { currency: 'USD' }), '-$25.00');
  assert.equal(formatAccountPnL(500, { currency: 'USC' }), '+500 USC (≈ +$5.00)');
});
