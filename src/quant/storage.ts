import fs from 'fs';
import path from 'path';
import {
  BASELINE_POLICY_ID,
  createBaselinePolicyRecord,
} from './strategies.ts';
import { cloneRiskLimits } from './riskGate.ts';
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

    return {
      schemaVersion: 1,
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
        currentTaskVi: 'Sẵn sàng nhận nến XAUUSD M15 đã đóng từ bộ phát lại',
        lastCompletedTaskVi: 'Khởi tạo trạng thái ban đầu',
        lastCompletedMarketTime: null,
        lastCompletedSystemTime: systemTime,
        waitStateReasonVi: 'Đang chờ chu kỳ phát lại đầu tiên',
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
        parsed.totalReplayCandles = totalReplayCandles;

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

  public saveState(state: QuantSystemState): void {
    this.ensureDir();
    const tmpPath = `${this.stateFilePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.stateFilePath);
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
