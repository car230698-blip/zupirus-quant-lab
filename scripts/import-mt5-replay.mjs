import { readFileSync, writeFileSync } from 'node:fs';

const interval = 15 * 60_000;

function readExport(file, columns) {
  const [header, ...rows] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const separator = header.includes('\t') ? '\t' : header.includes(';') ? ';' : ',';
  const names = header.replace(/^\uFEFF/, '').split(separator)
    .map((name) => name.trim().replace(/[<>" ]/g, '').toUpperCase());
  for (const name of columns) {
    if (!names.includes(name)) throw new Error(`Thiếu cột ${name} trong ${file}`);
  }
  return rows.map((line) => {
    const fields = line.split(separator).map((value) => value.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(names.map((name, index) => [name, fields[index] ?? '']));
  });
}

function timestamp(row) {
  const date = row.DATE.replaceAll('.', '-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/.test(row.TIME)) {
    throw new Error(`Thời gian MT5 không hợp lệ: ${row.DATE} ${row.TIME}`);
  }
  const time = Date.parse(`${date}T${row.TIME}Z`);
  if (!Number.isFinite(time)) throw new Error(`Thời gian MT5 không hợp lệ: ${row.DATE} ${row.TIME}`);
  return time;
}

function number(value, label) {
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed)) throw new Error(`Giá trị ${label} không hợp lệ`);
  return parsed;
}

const [barsFile, ticksFile, output] = process.argv.slice(2);
if (!barsFile || !ticksFile || !output) {
  throw new Error('Cách dùng: node scripts/import-mt5-replay.mjs bars.csv ticks.csv replay.json');
}

const bars = readExport(barsFile, ['DATE', 'TIME', 'OPEN', 'HIGH', 'LOW', 'CLOSE', 'TICKVOL']);
const ticks = readExport(ticksFile, ['DATE', 'TIME', 'BID', 'ASK']);
const quotes = new Map();
let previousTick = -Infinity;
let bid, ask;
for (const row of ticks) {
  const time = timestamp(row);
  if (time < previousTick) throw new Error('Tick phải theo thứ tự thời gian');
  previousTick = time;
  if (!row.BID && !row.ASK) continue;
  if (row.BID) bid = number(row.BID, 'BID');
  if (row.ASK) ask = number(row.ASK, 'ASK');
  if (!(bid > 0 && ask >= bid)) {
    quotes.delete(Math.floor(time / interval) * interval);
    continue;
  }
  quotes.set(Math.floor(time / interval) * interval, Math.round((ask - bid) * 100));
}

let previousBar = -Infinity;
let missingQuotes = 0;
const candles = [];
for (const bar of bars) {
  const time = timestamp(bar);
  if (time % interval !== 0 || time <= previousBar) throw new Error('Nến phải là M15 theo thứ tự, không trùng');
  previousBar = time;
  const spreadPts = quotes.get(time);
  if (spreadPts === undefined) {
    missingQuotes++;
    continue;
  }
  const [open, high, low, close, volume] = ['OPEN', 'HIGH', 'LOW', 'CLOSE', 'TICKVOL']
    .map((name) => number(bar[name], name));
  if (Math.min(open, low, close) <= 0 || low > Math.min(open, close) ||
      high < Math.max(open, close) || !Number.isSafeInteger(volume) || volume <= 0) {
    throw new Error(`OHLC/tick volume không hợp lệ tại ${bar.DATE} ${bar.TIME}`);
  }
  candles.push({
    candleId: `EXNESS-XAU-M15-${time}`, symbol: 'XAUUSD', timeframe: 'M15',
    openTime: new Date(time).toISOString(), closeTime: new Date(time + interval).toISOString(),
    open, high, low, close, volume, spreadPts, isClosed: true,
  });
}

if (!candles.length) throw new Error('Không có nến M15 khớp với dữ liệu Bid/Ask');
writeFileSync(output, JSON.stringify({
  metadata: {
    datasetId: `EXNESS-XAU-M15-${candles[0].openTime}`,
    symbol: 'XAUUSD', timeframe: 'M15',
    sourceDescription: 'Exness MT5 M15 và ticks xuất từ UTC+0',
    syntheticDisclosure: 'OHLC và tick volume từ MT5. Spread theo báo giá cuối trong nến. Khớp lệnh mô phỏng.',
    intraCandleConflictRule: 'CONSERVATIVE_SL_FIRST', totalCandles: candles.length,
  },
  candles,
}, null, 2), { flag: 'wx' });
console.log(JSON.stringify({
  candles: candles.length, missingQuotes,
  spreadsAbove40: candles.filter((bar) => bar.spreadPts > 40).length,
}));
