export type StrategyDecision = {
  version?: string;
  timeframe?: string;
  reason?: string;
  candle_time?: number;
};

export function readStrategyDecision(value: unknown): StrategyDecision | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function fmtNum(val: unknown, decimals = 2): string {
  const num = Number(val);
  if (!Number.isFinite(num)) return (0).toFixed(decimals);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtPnL(val: unknown, decimals = 2): string {
  const num = Number(val);
  if (!Number.isFinite(num)) return '$0.00';
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  return `${sign}$${Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function fmtTime(val: unknown): string {
  if (!val) return '—';
  if (typeof val === 'number') {
    const ms = val > 1e12 ? val : val * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? String(val) : d.toLocaleString('vi-VN');
  }
  const d = new Date(String(val));
  return Number.isNaN(d.getTime()) ? String(val) : d.toLocaleString('vi-VN');
}
