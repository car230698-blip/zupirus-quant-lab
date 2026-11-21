import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCentAccount,
  normalizeCentToUsd,
  formatAccountBalance,
  formatAccountEquity,
  formatAccountPnL,
} from './currencyFormat';

test('currencyFormat correctly identifies cent accounts', () => {
  assert.equal(isCentAccount({ account_type: 'CENT' }), true);
  assert.equal(isCentAccount({ currency: 'USC' }), true);
  assert.equal(isCentAccount({ currency: 'EUC' }), true);
  assert.equal(isCentAccount({ broker_server: 'Exness-Cent' }), true);
  assert.equal(isCentAccount({ account_type: 'STANDARD', currency: 'USD' }), false);
});

test('currencyFormat normalizes cent values to USD', () => {
  assert.equal(normalizeCentToUsd(10000, { currency: 'USC' }), 100);
  assert.equal(normalizeCentToUsd(100, { currency: 'USD' }), 100);
});

test('currencyFormat formats balances, equity and PnL', () => {
  assert.match(formatAccountBalance(10000, { currency: 'USC' }), /10,000 USC.*\$100\.00/);
  assert.equal(formatAccountBalance(100, { currency: 'USD' }), '$100.00');

  assert.match(formatAccountEquity(10500, { currency: 'USC' }), /10,500 USC.*\$105\.00/);
  assert.equal(formatAccountEquity(105, { currency: 'USD' }), '$105.00');

  assert.match(formatAccountPnL(500, { currency: 'USC' }), /\+500 USC.*\+\$5\.00/);
  assert.equal(formatAccountPnL(50, { currency: 'USD' }), '+$50.00');
});
