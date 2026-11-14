import { readFileSync } from 'node:fs';
import type { M15Candle } from './types.ts';

export interface ReplayQuote {
  time: number;
  bid: number;
  ask: number;
}

// Binary rows: UTC timestamp (ms), bid and ask, 3 little-endian Float64s.
export class TickReplay {
  private readonly bytes: Buffer;

  constructor(file: string) {
    this.bytes = readFileSync(file);
    if (!this.bytes.length || this.bytes.length % 24 !== 0) {
      throw new Error('File tick phát lại rỗng hoặc sai định dạng.');
    }
    let previous = -Infinity;
    for (let i = 0; i < this.bytes.length / 24; i++) {
      const { time, bid, ask } = this.quote(i);
      if (!Number.isSafeInteger(time) || time < previous ||
          !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) {
        throw new Error(`Tick không hợp lệ tại dòng ${i + 1}`);
      }
      previous = time;
    }
  }

  private quote(i: number): ReplayQuote {
    const offset = i * 24;
    return {
      time: this.bytes.readDoubleLE(offset),
      bid: this.bytes.readDoubleLE(offset + 8),
      ask: this.bytes.readDoubleLE(offset + 16),
    };
  }

  private lowerBound(time: number) {
    let lo = 0;
    let hi = this.bytes.length / 24;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.bytes.readDoubleLE(mid * 24) < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  firstAfterClose(candle: M15Candle) {
    const time = Date.parse(candle.closeTime);
    const i = this.lowerBound(time);
    if (i * 24 === this.bytes.length) return undefined;
    const quote = this.quote(i);
    return quote.time - time <= 5000 ? quote : undefined;
  }

  *within(candle: M15Candle): IterableIterator<ReplayQuote> {
    const start = Date.parse(candle.openTime);
    const end = Date.parse(candle.closeTime);
    for (let i = this.lowerBound(start); i * 24 < this.bytes.length; i++) {
      const quote = this.quote(i);
      if (quote.time >= end) break;
      yield quote;
    }
  }
}
