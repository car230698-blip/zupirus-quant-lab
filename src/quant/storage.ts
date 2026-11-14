import fs from 'fs';
import path from 'path';
import { cloneBrokerSchedule, evaluateMarketSchedule } from './marketSchedule.ts';
import { cloneRiskLimits, computeSlOvershootP95Buffer } from './riskGate.ts';
import {
  BASELINE_POLICY_ID,
  createBaselinePolicyRecord,
} from './strategies.ts';
import {
  createInitialDataSourceTelemetry,
  createInitialTickIngestionState,
} from './tickIngestor.ts';
import {
  QuantSystemState,
  SystemJournalEntry,
} from './types.ts';

export interface StorageConfig {
  dataDir: string;
  stateFileName?: string;
  journalFileName?: string;
}

export class DurableQuantStorage {
  private readonly dataDir: string;
  private readonly stateFilePath: string;
  private readonly journalFilePath: string;

  constructor(config: StorageConfig) {
    this.dataDir = path.resolve(config.dataDir);
    this.stateFilePath = path.join(
      this.dataDir,
      config.stateFileName || 'quant-state.json'
    );
    this.journalFilePath = path.join(
      this.dataDir,
      config.journalFileName || 'journal.ndjson'
    );
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  public getPaths(): {
    dataDir: string;
    stateFilePath: string;
    journalFilePath: string;
  } {
    return {
      dataDir: this.dataDir,
      stateFilePath: this.stateFilePath,
      journalFilePath: this.journalFilePath,
    };
  }

  public createFreshInitialState(
    totalReplayCandles: number,
    replayIntervalMs: number,
    initialMarketTime: string = '2026-03-02T08:00:00.000Z',
    systemTime: string = new Date().toISOString()
  ): QuantSystemState {
    const baselinePolicy = createBaselinePolicyRecord(initialMarketTime, systemTime);
    const initialBalanceUsd = 10000;
    const brokerSchedule = cloneBrokerSchedule({ updatedAtSystemTime: systemTime });
    const lastScheduleEvaluation = evaluateMarketSchedule(initialMarketTime, brokerSchedule);
    const slOvershootP95 = computeSlOvershootP95Buffer([]);
    const tickIngestionState = createInitialTickIngestionState('REPLAY_DATASET');

    return {
      schemaVersion: 2,
      executionMode: 'SIMULATION_ONLY',
      symbol: 'XAUUSD',
      timeframe: 'M15',
      startedAtSystemTime: systemTime,
      lastUpdatedSystemTime: systemTime,
      lastProcessedMarketTime: null,
      replayCursorIndex: 0,
      totalReplayCandles,
      isReplayComplete: false,
      isLoopRunning: false,
      replayIntervalMs,
      restartCount: 0,
      lastRestartRecoveredAtSystemTime: null,

      initialBalanceUsd,
      balanceUsd: initialBalanceUsd,
      equityUsd: initialBalanceUsd,
      highWaterMarkEquityUsd: initialBalanceUsd,
      currentDrawdownPct: 0,
      maxDrawdownPct: 0,

      processedCandleIds: [],
      processedSignalIds: [],
      processedExecutionIds: [],

      riskLimits: cloneRiskLimits(),
      brokerSchedule,
      lastScheduleEvaluation,
      slOvershootP95,
      dataSourceTelemetry: tickIngestionState.telemetry,
      tickIngestionState,

      activePolicyId: BASELINE_POLICY_ID,
      baselinePolicyId: BASELINE_POLICY_ID,
      policies: [baselinePolicy],

      openPositions: [],
      closedPositions: [],
      rejectedOrExpiredOrders: [],
      reconciliations: [],
      shadowOutcomes: [],
      openShadowPositions: {},
      learningRuns: [],
      cycleTraces: [],
      equityCurve: [],
      journal: [
        {
          entryId: `JRN-INIT-0001`,
          timestampSystem: systemTime,
          timestampMarket: initialMarketTime,
          cycleId: 'CYCLE-BOOT',
          team: 'ORCHESTRATOR',
          level: 'INFO',
          eventCode: 'SYSTEM_INITIALIZED',
          messageVi: `Khởi tạo hệ thống mô phỏng ZUPIRUS Quant Lab (XAUUSD M15). Số dư gốc: ${initialBalanceUsd.toLocaleString(
            'en-US'
          )} USD, Chính sách cơ sở: ${BASELINE_POLICY_ID}.`,
        },
      ],

      teamExecutionStatus: {
        teamId: 'TEAM_ANALYSIS_EXECUTION',
        teamNameVi: 'Đội 1: Phân tích & Thực thi (Analysis & Execution)',
        isActive: false,
        currentTaskVi: 'Sẵn sàng nhận nến XAUUSD M15 đã đóng từ bộ phát lại hoặc luồng tick MT5 Demo',
        lastCompletedTaskVi: 'Khởi tạo trạng thái ban đầu',
        lastCompletedMarketTime: null,
        lastCompletedSystemTime: systemTime,
        waitStateReasonVi: 'Đang chờ chu kỳ phát lại hoặc lô báo giá đầu tiên',
        lastErrorVi: null,
        recoveryStatusVi: null,
        processedCount: 0,
      },

      teamResearchStatus: {
        teamId: 'TEAM_RESEARCH_VALIDATION',
        teamNameVi: 'Đội 2: Nghiên cứu & Kiểm định (Research & Validation)',
        isActive: false,
        currentTaskVi: 'Theo dõi tập kết quả đối soát và mô phỏng song song (Shadow Sim)',
        lastCompletedTaskVi: 'Thiết lập đường cơ sở Walk-Forward',
        lastCompletedMarketTime: null,
        lastCompletedSystemTime: systemTime,
        waitStateReasonVi: 'Chờ đủ kết quả giao dịch hoàn tất và đối soát để kích hoạt kỳ học đầu tiên',
        lastErrorVi: null,
        recoveryStatusVi: null,
        processedCount: 0,
      },
    };
  }

  public loadOrInitializeState(
    totalReplayCandles: number,
    replayIntervalMs: number
  ): { state: QuantSystemState; recoveredFromDisk: boolean } {
    this.ensureDir();
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as QuantSystemState;
        const now = new Date().toISOString();
        parsed.restartCount = (parsed.restartCount || 0) + 1;
        parsed.lastRestartRecoveredAtSystemTime = now;
        parsed.lastUpdatedSystemTime = now;
        parsed.totalReplayCandles = Math.max(
          totalReplayCandles,
          parsed.totalReplayCandles || 0
        );

        if (!parsed.brokerSchedule) {
          parsed.brokerSchedule = cloneBrokerSchedule({ updatedAtSystemTime: now });
        }
        if (!parsed.lastScheduleEvaluation) {
          parsed.lastScheduleEvaluation = evaluateMarketSchedule(
            parsed.lastProcessedMarketTime || '2026-03-02T08:00:00.000Z',
            parsed.brokerSchedule
          );
        }
        parsed.slOvershootP95 = computeSlOvershootP95Buffer(parsed.closedPositions || []);
        if (!parsed.tickIngestionState) {
          parsed.tickIngestionState = createInitialTickIngestionState('REPLAY_DATASET');
        }
        if (!parsed.dataSourceTelemetry) {
          parsed.dataSourceTelemetry =
            parsed.tickIngestionState.telemetry ||
            createInitialDataSourceTelemetry('REPLAY_DATASET');
        } else {
          parsed.tickIngestionState.telemetry = parsed.dataSourceTelemetry;
        }

        const recoveryEntry: SystemJournalEntry = {
          entryId: `JRN-RESTART-${parsed.restartCount}-${Date.now()}`,
          timestampSystem: now,
          timestampMarket:
            parsed.lastProcessedMarketTime || '2026-03-02T08:00:00.000Z',
          cycleId:
            parsed.cycleTraces[parsed.cycleTraces.length - 1]?.cycleId ||
            'CYCLE-RECOVERY',
          team: 'ORCHESTRATOR',
          level: 'INFO',
          eventCode: 'RESTART_STATE_RECOVERED',
          messageVi: `Khôi phục trạng thái bền vững sau restart (Lần #${parsed.restartCount}): Tiếp tục từ nến thứ ${parsed.replayCursorIndex}/${parsed.totalReplayCandles}, Chính sách đang hiệu lực: ${parsed.activePolicyId}, Số dư: ${parsed.balanceUsd.toFixed(
            2
          )} USD, Vị thế mở: ${parsed.openPositions.length}.`,
        };

        parsed.journal.push(recoveryEntry);
        parsed.teamExecutionStatus.recoveryStatusVi = `Đã khôi phục từ tiến độ nến ${parsed.replayCursorIndex}/${parsed.totalReplayCandles} (Restart #${parsed.restartCount})`;
        parsed.teamResearchStatus.recoveryStatusVi = `Đã khôi phục ${parsed.learningRuns.length} lần học và ${parsed.shadowOutcomes.length} mẫu đối chiếu`;

        this.saveState(parsed);
        this.appendJournalToDisk(recoveryEntry);
        return { state: parsed, recoveredFromDisk: true };
      } catch (err) {
        const now = new Date().toISOString();
        const fresh = this.createFreshInitialState(
          totalReplayCandles,
          replayIntervalMs,
          '2026-03-02T08:00:00.000Z',
          now
        );
        fresh.teamExecutionStatus.lastErrorVi = `Lỗi đọc file trạng thái cũ: ${
          err instanceof Error ? err.message : String(err)
        }`;
        fresh.teamExecutionStatus.recoveryStatusVi =
          'Đã khởi tạo lại trạng thái an toàn do file cũ bị hỏng.';
        this.saveState(fresh);
        return { state: fresh, recoveredFromDisk: false };
      }
    }

    const fresh = this.createFreshInitialState(
      totalReplayCandles,
      replayIntervalMs
    );
    this.saveState(fresh);
    if (fresh.journal.length > 0) {
      this.appendJournalToDisk(fresh.journal[0]);
    }
    return { state: fresh, recoveredFromDisk: false };
  }

  public saveState(state: QuantSystemState, durable = false): void {
    this.ensureDir();
    const tmpPath = `${this.stateFilePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), { encoding: 'utf-8', flush: durable });
    fs.renameSync(tmpPath, this.stateFilePath);
    if (durable && process.platform !== 'win32') {
      try {
        const directory = fs.openSync(this.dataDir, 'r');
        try {
          fs.fsyncSync(directory);
        } finally {
          fs.closeSync(directory);
        }
      } catch (error) {
        // Rename has committed. Keep the snapshot and surface the disk error.
        console.error('Không đồng bộ được thư mục trạng thái:', error);
      }
    }
  }

  public appendJournalToDisk(entry: SystemJournalEntry): void {
    this.ensureDir();
    fs.appendFileSync(
      this.journalFilePath,
      JSON.stringify(entry) + '\n',
      'utf-8'
    );
  }

  public resetStorage(
    totalReplayCandles: number,
    replayIntervalMs: number
  ): QuantSystemState {
    this.ensureDir();
    if (fs.existsSync(this.stateFilePath)) {
      fs.unlinkSync(this.stateFilePath);
    }
    if (fs.existsSync(this.journalFilePath)) {
      fs.unlinkSync(this.journalFilePath);
    }
    const fresh = this.createFreshInitialState(
      totalReplayCandles,
      replayIntervalMs
    );
    this.saveState(fresh);
    if (fresh.journal.length > 0) {
      this.appendJournalToDisk(fresh.journal[0]);
    }
    return fresh;
  }
}
