import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('node scripts/pack-mt5-ticks.mjs ticks.csv ticks.bin');

const lines = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
let columns, bid, ask, writer;
let previous = -Infinity;
let count = 0;
let date, day;
let chunk = Buffer.allocUnsafe(24 * 4096);
let offset = 0;
for await (const line of lines) {
  if (!columns) {
    const names = line.replace(/^\uFEFF/, '').split('\t');
    columns = ['<DATE>', '<TIME>', '<BID>', '<ASK>'].map((name) => names.indexOf(name));
    if (columns.includes(-1)) throw new Error('Cần file Ticks MT5 phân cách bằng tab.');
    writer = createWriteStream(output, { flags: 'wx' });
    continue;
  }
  if (!line) continue;
  const row = line.split('\t');
  const [currentDate, time, newBid, newAsk] = columns.map((index) => row[index]);
  if (!newBid && !newAsk) continue;
  if (currentDate !== date) {
    date = currentDate;
    day = Date.parse(date.replaceAll('.', '-') + 'T00:00:00Z');
  }
  const [hours, minutes, seconds] = time.split(':').map(Number);
  const timestamp = day + Math.round((3600 * hours + 60 * minutes + seconds) * 1000);
  if (!Number.isSafeInteger(timestamp) || timestamp < previous) throw new Error('Tick sai thứ tự hoặc sai thời gian.');
  previous = timestamp;
  if (newBid) bid = Number(newBid);
  if (newAsk) ask = Number(newAsk);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) continue;
  chunk.writeDoubleLE(timestamp, offset);
  chunk.writeDoubleLE(bid, offset + 8);
  chunk.writeDoubleLE(ask, offset + 16);
  offset += 24;
  count++;
  if (offset === chunk.length) {
    if (!writer.write(chunk)) await once(writer, 'drain');
    chunk = Buffer.allocUnsafe(chunk.length);
    offset = 0;
  }
}
if (!writer || !count) throw new Error('Không có báo giá Bid/Ask hợp lệ.');
writer.end(chunk.subarray(0, offset));
await finished(writer);
console.log(`Đã lưu ${count} báo giá UTC.`);
