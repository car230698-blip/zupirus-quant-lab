import type { M15Candle } from './types.ts';

export function latestClosedContext(
  history: readonly M15Candle[], decisionTime: string, timeframe: 'H1' | 'H4'
) {
  const baseMs = 15 * 60_000;
  const count = timeframe === 'H1' ? 4 : 16;
  const duration = count * baseMs;
  const end = Math.floor(Date.parse(decisionTime) / duration) * duration;
  const start = end - duration;
  const candles = history.filter((bar) =>
    bar.isClosed && Date.parse(bar.openTime) >= start && Date.parse(bar.closeTime) <= end
  );
  if (candles.length !== count || candles.some((bar, index) =>
    Date.parse(bar.openTime) !== start + index * baseMs ||
    Date.parse(bar.closeTime) !== start + (index + 1) * baseMs
  )) return undefined;
  return {
    closeTime: new Date(end).toISOString(),
    direction: Math.sign(candles[count - 1].close - candles[0].open),
  };
}
