/**
 * ZUPIRUS Quant Lab — Standardized Currency & Cent Account Formatting
 * Handles Cent / USC / EUC balance, equity, and PnL normalization uniformly.
 */

import { fmtNum, fmtPnL } from './strategyDecision';

export function isCentAccount(account: any): boolean {
  if (!account || typeof account !== 'object') return false;
  const acctType = String(account.account_type || '').toUpperCase();
  const currency = String(account.currency || '').toUpperCase();
  const server = String(account.broker_server || account.mt5_server || '').toUpperCase();

  return (
    acctType === 'CENT' ||
    currency === 'USC' ||
    currency === 'EUC' ||
    server.includes('CENT')
  );
}

export function normalizeCentToUsd(val: number, account: any): number {
  const numericVal = Number(val) || 0;
  return isCentAccount(account) ? numericVal / 100.0 : numericVal;
}

export function formatAccountBalance(val: number | unknown, account: any): string {
  const num = Number(val) || 0;
  if (isCentAccount(account)) {
    return `${fmtNum(num, 0)} USC (≈ $${fmtNum(num / 100, 2)})`;
  }
  return `$${fmtNum(num, 2)}`;
}

export function formatAccountEquity(val: number | unknown, account: any): string {
  const num = Number(val) || 0;
  if (isCentAccount(account)) {
    return `${fmtNum(num, 0)} USC (≈ $${fmtNum(num / 100, 2)})`;
  }
  return `$${fmtNum(num, 2)}`;
}

export function formatAccountPnL(val: number | unknown, account: any): string {
  const num = Number(val) || 0;
  if (isCentAccount(account)) {
    const usdVal = num / 100;
    const sign = num > 0 ? '+' : num < 0 ? '-' : '';
    return `${sign}${fmtNum(Math.abs(num), 0)} USC (≈ ${fmtPnL(usdVal, 2)})`;
  }
  return fmtPnL(num, 2);
}
