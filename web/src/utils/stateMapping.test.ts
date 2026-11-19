import test from 'node:test';
import assert from 'node:assert/strict';
import {
  translateOrderStatus,
  translateAction,
  translateRegime,
  orderStates,
} from './stateMapping';
import { formatApiError } from './formatError';

test('translateOrderStatus maps known statuses and falls back safely', () => {
  assert.equal(translateOrderStatus('filled'), 'Đã khớp');
  assert.equal(translateOrderStatus('FILLED'), 'Đã khớp');
  assert.equal(translateOrderStatus('rejected'), 'Bị từ chối');
  assert.equal(translateOrderStatus('queued'), 'Đang chờ');
  assert.ok(Array.isArray(orderStates) && orderStates.length > 0);
  assert.equal(typeof translateOrderStatus(undefined as any), 'string');
});

test('translateAction and translateRegime map trading enums accurately', () => {
  assert.equal(translateAction('BUY'), 'MUA (BUY)');
  assert.equal(translateAction('SELL'), 'BÁN (SELL)');
  assert.equal(translateRegime('TRENDING_BULL'), 'Xu Hướng Mạnh (Trending)');
  assert.equal(typeof translateRegime('UNKNOWN_REGIME'), 'string');
});

test('formatApiError normalizes FastAPI string, array, and object errors', () => {
  assert.equal(formatApiError({ detail: 'Invalid credentials' }, 'Fallback'), 'Invalid credentials');
  assert.equal(
    formatApiError({ detail: [{ msg: 'Field required', loc: ['body', 'email'] }] }, 'Fallback'),
    'email: Field required',
  );
  assert.equal(formatApiError(null, 'Fallback message'), 'Lỗi Fallback message');
});
