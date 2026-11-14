import path from 'path';
import fs from 'fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import { createQuantServer } from '../server.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSession(dataDir: string) {
  const replayFile = path.resolve(__dirname, '../data/xauusd_m15_replay.json');
  const collectorToken = randomUUID();

  console.log('=== GIAI ĐOẠN 1: KHỞI TẠO PHIÊN MT5_DEMO_LIVE VỚI THƯ MỤC TRẠNG THÁI RIÊNG ===');
  console.log('Thư mục runtime riêng:', dataDir);

  const replayRaw = JSON.parse(fs.readFileSync(replayFile, 'utf8'));
  const candles = replayRaw.candles;

  let serverInstance = await createQuantServer({
    dataDir,
    replayFilePath: replayFile,
    autoStart: false,
    attachFrontend: false,
    liveTicks: true,
    strictAuth: true,
    collectorToken,
  });

  const app = serverInstance.app;
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const colHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${collectorToken}`,
  };

  console.log(`Server MT5_DEMO_LIVE tạm thời đang lắng nghe tại ${baseUrl}`);

  function makeTicksForCandle(c: any, index: number) {
    const t0 = Date.parse(c.openTime);
    const spread = (c.spreadPts || 16) * 0.01;
    return [
      { rawSymbol: 'XAUUSDm', timeMs: t0 + 1_000, seqWithinMs: 0, bid: c.open, ask: Number((c.open + spread).toFixed(2)) },
      { rawSymbol: 'XAUUSDm', timeMs: t0 + 250_000, seqWithinMs: 0, bid: c.high, ask: Number((c.high + spread).toFixed(2)) },
      { rawSymbol: 'XAUUSDm', timeMs: t0 + 550_000, seqWithinMs: 0, bid: c.low, ask: Number((c.low + spread).toFixed(2)) },
      { rawSymbol: 'XAUUSDm', timeMs: t0 + 850_000, seqWithinMs: 0, bid: c.close, ask: Number((c.close + spread).toFixed(2)) },
    ];
  }

  // --- 1. GỬI LÔ ĐẦU TIÊN VÀ THỬ GỬI LẶP LÔ (IDEMPOTENCY) ---
  console.log('\n=== GIAI ĐOẠN 2: THỬ NGHIỆM GỬI LẶP LÔ (IDEMPOTENCY / RETRY) ===');
  const batch1 = {
    batchId: 'BATCH-MT5-LIVE-0001',
    collectorId: 'WIN-MT5-PROD-01',
    rawSymbol: 'XAUUSDm',
    ticks: makeTicksForCandle(candles[0], 0),
  };

  const res1 = await fetch(`${baseUrl}/api/ingest/ticks`, {
    method: 'POST',
    headers: colHeaders,
    body: JSON.stringify(batch1),
  });
  const ack1 = await res1.json();
  console.log('Lô 1 gửi lần đầu: HTTP', res1.status, 'ACK:', JSON.stringify(ack1));

  // Gửi lặp lại cùng batchId
  const res1Dup = await fetch(`${baseUrl}/api/ingest/ticks`, {
    method: 'POST',
    headers: colHeaders,
    body: JSON.stringify(batch1),
  });
  const ack1Dup = await res1Dup.json();
  console.log('Lô 1 gửi LẶP LẠI (Duplicate): HTTP', res1Dup.status, 'ACK:', JSON.stringify(ack1Dup));
  if (ack1Dup.idempotentReplay && ack1Dup.acceptedTicks === 0 && ack1Dup.duplicateTicksSkipped === 4) {
    console.log('=> ĐẠT: Cơ chế Idempotent đã phát hiện lô trùng lặp và bỏ qua an toàn 4 ticks trùng!');
  } else {
    throw new Error('Lỗi: Gửi lặp lô không được xử lý đúng!');
  }

  // --- 2. GỬI CÁC NẾN TỪ 1 ĐẾN 9 ĐỂ ĐÓNG CÁC NẾN M15 ĐẦU TIÊN ---
  console.log('\n=== GIAI ĐOẠN 3: ĐẨY TICK ĐÓNG CÁC NẾN M15 ĐẦU TIÊN VÀ GHI NHẬN LỆNH MÔ PHỎNG ===');
  for (let i = 1; i < 10; i++) {
    const b = {
      batchId: `BATCH-MT5-LIVE-${String(i + 1).padStart(4, '0')}`,
      collectorId: 'WIN-MT5-PROD-01',
      rawSymbol: 'XAUUSDm',
      ticks: makeTicksForCandle(candles[i], i),
    };
    const res = await fetch(`${baseUrl}/api/ingest/ticks`, {
      method: 'POST',
      headers: colHeaders,
      body: JSON.stringify(b),
    });
    if (!res.ok) throw new Error(`Lỗi gửi lô ${i + 1}: ${res.statusText}`);
  }

  let state1 = serverInstance.orchestrator.getState();
  console.log(`Đã đóng ${state1.dataSourceTelemetry?.closedBarsBuiltFromTicks} nến M15 từ tick.`);
  console.log(`Số chu kỳ quyết định: ${state1.cycleTraces.length}`);
  console.log(`Số vị thế đã mở: ${state1.openPositions.length}, Vị thế đã đóng: ${state1.closedPositions.length}`);
  console.log(`Số deals đã đối soát: ${state1.reconciliations.length}`);
  console.log(`Số dư hiện tại: ${state1.balanceUsd} USD, Equity: ${state1.equityUsd} USD`);

  const barsBeforeRestart = state1.dataSourceTelemetry?.closedBarsBuiltFromTicks;
  const tracesBeforeRestart = state1.cycleTraces.length;
  const balanceBeforeRestart = state1.balanceUsd;
  const reconsBeforeRestart = state1.reconciliations.length;

  // --- 3. RESTART GIỮA CHỪNG ---
  console.log('\n=== GIAI ĐOẠN 4: RESTART GIỮA CHỪNG VÀ KHÔI PHỤC TRẠNG THÁI TỪ DISK ===');
  server.close();
  console.log('Đã đóng server MT5_DEMO_LIVE ban đầu.');

  const restartedInstance = await createQuantServer({
    dataDir,
    replayFilePath: replayFile,
    autoStart: false,
    attachFrontend: false,
    liveTicks: true,
    strictAuth: true,
    collectorToken,
  });
  const server2 = restartedInstance.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => server2.once('listening', resolve).once('error', reject));
  const port2 = (server2.address() as any).port;
  const baseUrl2 = `http://127.0.0.1:${port2}`;

  let stateAfterRestart = restartedInstance.orchestrator.getState();
  console.log('Khởi động lại thành công!');
  console.log(`Restart Count sau restart: ${stateAfterRestart.restartCount} (Tăng từ 0 lên 1)`);
  console.log(`Số nến đóng khôi phục: ${stateAfterRestart.dataSourceTelemetry?.closedBarsBuiltFromTicks} (Trước: ${barsBeforeRestart})`);
  console.log(`Số chu kỳ khôi phục: ${stateAfterRestart.cycleTraces.length} (Trước: ${tracesBeforeRestart})`);
  console.log(`Số dư khôi phục: ${stateAfterRestart.balanceUsd} (Trước: ${balanceBeforeRestart})`);
  console.log(`Số đối soát khôi phục: ${stateAfterRestart.reconciliations.length} (Trước: ${reconsBeforeRestart})`);

  if (stateAfterRestart.restartCount !== 1 ||
      stateAfterRestart.dataSourceTelemetry?.closedBarsBuiltFromTicks !== barsBeforeRestart ||
      stateAfterRestart.cycleTraces.length !== tracesBeforeRestart ||
      stateAfterRestart.balanceUsd !== balanceBeforeRestart ||
      stateAfterRestart.reconciliations.length !== reconsBeforeRestart) {
    throw new Error('Lỗi: Khôi phục trạng thái sau restart không khớp!');
  }
  console.log('=> ĐẠT: Khôi phục trạng thái sau restart giữa chừng chính xác 100%, không mất dữ liệu, không xử lý trùng!');

  // Phát hết fixture để kiểm tra khớp, đối soát và bộ học.
  console.log('\n=== GIAI ĐOẠN 5: TIẾP TỤC ĐẨY TICK ĐỂ VƯỢT MỐC CHU KỲ 18 VÀ KÍCH HOẠT WALK-FORWARD ===');
  for (let i = 10; i < candles.length; i++) {
    const b = {
      batchId: `BATCH-MT5-LIVE-${String(i + 1).padStart(4, '0')}`,
      collectorId: 'WIN-MT5-PROD-01',
      rawSymbol: 'XAUUSDm',
      ticks: makeTicksForCandle(candles[i], i),
    };
    const res = await fetch(`${baseUrl2}/api/ingest/ticks`, {
      method: 'POST',
      headers: colHeaders,
      body: JSON.stringify(b),
    });
    if (!res.ok) throw new Error(`Lỗi gửi lô ${i + 1}: ${res.statusText}`);
  }

  let finalState = restartedInstance.orchestrator.getState();
  console.log(`Tổng nến đóng tạo từ tick: ${finalState.dataSourceTelemetry?.closedBarsBuiltFromTicks}`);
  console.log(`Tổng chu kỳ quyết định: ${finalState.cycleTraces.length}`);
  console.log(`Vị thế mở: ${finalState.openPositions.length}, Vị thế đã đóng: ${finalState.closedPositions.length}`);
  console.log(`Tổng đối soát lệnh hoàn tất: ${finalState.reconciliations.length}`);
  console.log(`Số đợt học Walk-Forward đã kích hoạt: ${finalState.learningRuns.length}`);

  if (finalState.closedPositions.length === 0 ||
      finalState.reconciliations.length !== finalState.closedPositions.length ||
      finalState.reconciliations.some(record => record.status !== 'RECONCILED_OK')) {
    throw new Error('Fixture phải có vị thế đóng và đối soát đầy đủ.');
  }
  if (finalState.learningRuns.length === 0) {
    throw new Error('Lỗi: Chưa kích hoạt được Walk-Forward Learning!');
  }

  const lr = finalState.learningRuns[0];
  console.log('\n=== BÁO CÁO CHI TIẾT BỘ HỌC WALK-FORWARD ĐÃ CHẠY ===');
  console.log(`Mã đợt học (Run ID): ${lr.runId}`);
  console.log(`Chu kỳ kích hoạt (Trigger Cycle): ${lr.triggerCycleId}`);
  console.log(`Phiên bản bộ học (Learner Version): ${lr.learnerVersion}`);
  console.log(`Thời điểm quyết định (Market Time): ${lr.executedAtMarketTime}`);
  console.log(`Lý do kích hoạt: ${lr.triggerReasonVi}`);
  console.log(`Quyết định bộ học (Decision): ${lr.decision}`);
  console.log(`Chính sách trước đó: ${lr.previousPolicyId} -> Kết quả: ${lr.resultingPolicyId}`);
  console.log(`Chi tiết lý do quyết định: ${lr.decisionReasonVi}`);
  console.log(`Tổng mẫu hoàn tất sử dụng: ${lr.totalCompletedSamplesUsed}`);
  console.log(`Tổng mẫu loại trừ: ${lr.totalExcludedSamples}`);
  console.log(`Số giả thuyết đã kiểm thử: ${lr.hypothesesTested.length}`);
  for (const h of lr.hypothesesTested) {
    console.log(`  * [${h.targetRegime} -> ${h.proposedStrategyId}@${h.proposedVersion}]: ${h.validationStatus} - ${h.validationNoteVi}`);
  }

  server2.close();
  console.log('\n=> Fixture MT5_DEMO_LIVE đạt.');
}

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zupirus-mt5-fixture-'));
runSession(fixtureDir).finally(() => fs.rmSync(fixtureDir, { recursive: true, force: true })).catch((err) => {
  console.error('LỖI PHIÊN MT5_DEMO_LIVE:', err);
  process.exit(1);
});