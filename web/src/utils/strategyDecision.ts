export type StrategyDecision = { version?: string; timeframe?: string; reason?: string; candle_time?: number };

export function readStrategyDecision(value: unknown): StrategyDecision | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
