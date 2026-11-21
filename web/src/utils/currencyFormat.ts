/**
 * ZUPIRUS Quant Lab — Standardized Currency & Cent Account Formatting
 * Handles Cent / USC / EUC balance, equity, and PnL normalization uniformly.
 */

import { fmtNum, fmtPnL } from './strategyDecision';

export function isCentAccount(account: any): boolean {
  if (!account || typeof account !== 'object') return false;
  const acctType = String(account.account_type || account.type || '').toUpperCase();
  const currency = String(account.currency || account.acct_currency || '').toUpperCase();
  const server = String(account.broker_server || account.mt5_server || account.account_server || account.server || '').toUpperCase();
  const login = String(account.login || account.mt5_login || account.account_login || account.account_id || '').toUpperCase();

  return (
    acctType === 'CENT' ||
    currency === 'USC' ||
    currency === 'EUC' ||
    server.includes('CENT') ||
    login.includes('CENT')
  );
}

export function normalizeCentToUsd(val: number, account: any): number {
  const numericVal = Number(val) || 0;
  return isCentAccount(account) ? numericVal / 100.0 : numericVal;
}

export function formatAccountMoney(val: number | unknown, account: any): string {
  const num = Number(val) || 0;
  if (isCentAccount(account)) {
    return `${fmtNum(num, 0)} USC (≈ $${fmtNum(num / 100, 2)})`;
  }
  return `$${fmtNum(num, 2)}`;
}

export const formatAccountBalance = formatAccountMoney;
export const formatAccountEquity = formatAccountMoney;

export function formatTradePnl(pnl: number | unknown, account: any): string {
  const num = Number(pnl) || 0;
  if (isCentAccount(account)) {
    const usdVal = num / 100.0;
    const sign = num > 0 ? '+' : num < 0 ? '-' : '';
    return `${sign}${fmtNum(Math.abs(num), 0)} USC (≈ ${fmtPnL(usdVal, 2)})`;
  }
  return fmtPnL(num, 2);
}

export const formatAccountPnL = formatTradePnl;
