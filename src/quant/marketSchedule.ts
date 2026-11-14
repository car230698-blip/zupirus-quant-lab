export type MarketSessionState =
  | 'OPEN'
  | 'CLOSE_ONLY_15_15'
  | 'CLOSE_ONLY_MANUAL'
  | 'MARKET_CLOSED';

export interface EarlyCloseOverride {
  localDate: string; // YYYY-MM-DD in broker schedule timezone
  closeLocalTime: string; // HH:mm in broker schedule timezone (e.g. "13:00")
  reasonVi: string;
}

export interface CloseOnlyDateOverride {
  localDate: string; // YYYY-MM-DD in broker schedule timezone
  reasonVi: string;
}

export interface BrokerSessionScheduleConfig {
  scheduleId: string;
  version: string;
  source: string;
  timezone: string; // IANA timezone, e.g. "America/New_York"
  updatedAtSystemTime: string;
  fridayCloseLocalTime: string; // HH:mm, e.g. "17:00"
  sundayOpenLocalTime: string; // HH:mm, e.g. "18:00"
  cutoffStopNewEntriesMinutesBeforeClose: number; // 15
  cutoffFlattenPositionsMinutesBeforeClose: number; // 15
  earlyCloseOverrides: EarlyCloseOverride[];
  closeOnlyDates: CloseOnlyDateOverride[];
  manualCloseOnlyMode: boolean;
  manualCloseOnlyReasonVi?: string;
  enabled: boolean;
}

export interface MarketScheduleEvaluation {
  marketTimeUtc: string;
  localDate: string;
  localTimeStr: string;
  weekday: string;
  timezone: string;
  utcOffsetLabel: string;
  isDstActive: boolean;
  sessionState: MarketSessionState;
  allowNewEntries: boolean;
  mustFlattenOpenPositions: boolean;
  isEarlyCloseDay: boolean;
  earlyCloseReasonVi?: string;
  minutesUntilSessionClose: number | null;
  cutoffWindowStartLocalTime: string | null;
  sessionCloseLocalTime: string | null;
  scheduleId: string;
  scheduleVersion: string;
  scheduleSource: string;
  reasonVi: string;
}

export const DEFAULT_BROKER_SCHEDULE: Readonly<BrokerSessionScheduleConfig> = Object.freeze({
  scheduleId: 'EXNESS_XAUUSD_NY_15_15',
  version: 'v1.2.0',
  source: 'Exness / NY Metals Session Schedule (America/New_York, DST-aware)',
  timezone: 'America/New_York',
  updatedAtSystemTime: '2026-03-01T00:00:00.000Z',
  fridayCloseLocalTime: '17:00',
  sundayOpenLocalTime: '18:00',
  cutoffStopNewEntriesMinutesBeforeClose: 15,
  cutoffFlattenPositionsMinutesBeforeClose: 15,
  earlyCloseOverrides: [
    {
      localDate: '2026-11-26',
      closeLocalTime: '13:00',
      reasonVi: 'Lễ Tạ ơn Hoa Kỳ (Thanksgiving) — Đóng phiên sớm lúc 13:00 giờ New York',
    },
    {
      localDate: '2026-12-24',
      closeLocalTime: '13:45',
      reasonVi: 'Trước Giáng sinh (Christmas Eve) — Đóng phiên sớm lúc 13:45 giờ New York',
    },
  ],
  closeOnlyDates: [],
  manualCloseOnlyMode: false,
  enabled: true,
});

export function cloneBrokerSchedule(
  overrides?: Partial<BrokerSessionScheduleConfig>
): BrokerSessionScheduleConfig {
  return {
    ...structuredClone(DEFAULT_BROKER_SCHEDULE),
    ...overrides,
    earlyCloseOverrides: overrides?.earlyCloseOverrides
      ? structuredClone(overrides.earlyCloseOverrides)
      : structuredClone(DEFAULT_BROKER_SCHEDULE.earlyCloseOverrides),
    closeOnlyDates: overrides?.closeOnlyDates
      ? structuredClone(overrides.closeOnlyDates)
      : structuredClone(DEFAULT_BROKER_SCHEDULE.closeOnlyDates),
  };
}

function parseHhMmToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    throw new Error(`Định dạng giờ lịch phiên không hợp lệ: ${hhmm}`);
  }
  return h * 60 + m;
}

function formatMinutesToHhMm(totalMinutes: number): string {
  const clamped = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface LocalTimeParts {
  year: string;
  month: string;
  day: string;
  localDate: string;
  weekday: string; // 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat'
  hour: number;
  minute: number;
  second: number;
  minutesOfDay: number;
  utcOffsetLabel: string;
  utcOffsetMinutes: number;
  isDstActive: boolean;
}

export function extractLocalTimeParts(
  utcIsoOrMs: string | number,
  timezone: string
): LocalTimeParts {
  const ms = typeof utcIsoOrMs === 'number' ? utcIsoOrMs : Date.parse(utcIsoOrMs);
  if (!Number.isFinite(ms)) {
    throw new Error(`Thời gian thị trường không hợp lệ: ${String(utcIsoOrMs)}`);
  }
  const d = new Date(ms);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  });

  const parts = formatter.formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = p.value;
    }
  }

  const year = map.year || '2026';
  const month = map.month || '01';
  const day = map.day || '01';
  const localDate = `${year}-${month}-${day}`;
  const weekday = map.weekday || 'Mon';
  const rawHour = Number(map.hour || 0);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(map.minute || 0);
  const second = Number(map.second || 0);
  const minutesOfDay = hour * 60 + minute + second / 60;
  const utcOffsetLabel = map.timeZoneName || 'GMT';

  // Compute offset in minutes relative to UTC for DST detection without Date.parse locale quirks
  const getOffsetMinAt = (targetMs: number): number => {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const m: Record<string, string> = {};
    for (const p of f.formatToParts(new Date(targetMs))) {
      if (p.type !== 'literal') m[p.type] = p.value;
    }
    const h = Number(m.hour || 0) === 24 ? 0 : Number(m.hour || 0);
    const asUtc = Date.UTC(
      Number(m.year),
      Number(m.month) - 1,
      Number(m.day),
      h,
      Number(m.minute || 0),
      Number(m.second || 0)
    );
    const secMs = Math.floor(targetMs / 1000) * 1000;
    return Math.round((asUtc - secMs) / 60000);
  };

  const currentOffsetMin = getOffsetMinAt(ms);
  const janMs = Date.UTC(Number(year), 0, 15, 12, 0, 0);
  const julMs = Date.UTC(Number(year), 6, 15, 12, 0, 0);
  const stdOffsetMin = Math.min(getOffsetMinAt(janMs), getOffsetMinAt(julMs));
  const isDstActive = currentOffsetMin > stdOffsetMin;

  return {
    year,
    month,
    day,
    localDate,
    weekday,
    hour,
    minute,
    second,
    minutesOfDay,
    utcOffsetLabel,
    utcOffsetMinutes: currentOffsetMin,
    isDstActive,
  };
}

/**
 * Evaluates the broker session schedule and 15/15 Friday / Early-Close rules
 * strictly from the causal market timestamp and configured schedule (zero future tick inference).
 */
export function evaluateMarketSchedule(
  marketTimeIso: string,
  schedule: BrokerSessionScheduleConfig = DEFAULT_BROKER_SCHEDULE
): MarketScheduleEvaluation {
  const parts = extractLocalTimeParts(marketTimeIso, schedule.timezone);
  const localTimeStr = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`;
  const dstText = parts.isDstActive ? 'Giờ mùa hè (DST)' : 'Giờ mùa đông (Chuẩn)';

  if (!schedule.enabled) {
    return {
      marketTimeUtc: marketTimeIso,
      localDate: parts.localDate,
      localTimeStr,
      weekday: parts.weekday,
      timezone: schedule.timezone,
      utcOffsetLabel: parts.utcOffsetLabel,
      isDstActive: parts.isDstActive,
      sessionState: 'OPEN',
      allowNewEntries: true,
      mustFlattenOpenPositions: false,
      isEarlyCloseDay: false,
      minutesUntilSessionClose: null,
      cutoffWindowStartLocalTime: null,
      sessionCloseLocalTime: null,
      scheduleId: schedule.scheduleId,
      scheduleVersion: schedule.version,
      scheduleSource: schedule.source,
      reasonVi: 'Lịch giới hạn phiên đang tắt trong cấu hình thử nghiệm.',
    };
  }

  // 1. Weekend check: Saturday all day is MARKET_CLOSED
  if (parts.weekday === 'Sat') {
    return {
      marketTimeUtc: marketTimeIso,
      localDate: parts.localDate,
      localTimeStr,
      weekday: parts.weekday,
      timezone: schedule.timezone,
      utcOffsetLabel: parts.utcOffsetLabel,
      isDstActive: parts.isDstActive,
      sessionState: 'MARKET_CLOSED',
      allowNewEntries: false,
      mustFlattenOpenPositions: true,
      isEarlyCloseDay: false,
      minutesUntilSessionClose: 0,
      cutoffWindowStartLocalTime: null,
      sessionCloseLocalTime: null,
      scheduleId: schedule.scheduleId,
      scheduleVersion: schedule.version,
      scheduleSource: schedule.source,
      reasonVi: `Thị trường đóng cửa cuối tuần (Thứ Bảy ${parts.localDate} ${localTimeStr} ${schedule.timezone}, ${dstText}).`,
    };
  }

  // 2. Sunday check: Closed before sundayOpenLocalTime
  if (parts.weekday === 'Sun') {
    const sundayOpenMin = parseHhMmToMinutes(schedule.sundayOpenLocalTime);
    if (parts.minutesOfDay < sundayOpenMin) {
      return {
        marketTimeUtc: marketTimeIso,
        localDate: parts.localDate,
        localTimeStr,
        weekday: parts.weekday,
        timezone: schedule.timezone,
        utcOffsetLabel: parts.utcOffsetLabel,
        isDstActive: parts.isDstActive,
        sessionState: 'MARKET_CLOSED',
        allowNewEntries: false,
        mustFlattenOpenPositions: true,
        isEarlyCloseDay: false,
        minutesUntilSessionClose: 0,
        cutoffWindowStartLocalTime: null,
        sessionCloseLocalTime: null,
        scheduleId: schedule.scheduleId,
        scheduleVersion: schedule.version,
        scheduleSource: schedule.source,
        reasonVi: `Thị trường chưa mở phiên tuần mới (Chủ Nhật ${localTimeStr} < giờ mở cửa ${schedule.sundayOpenLocalTime} ${schedule.timezone}, ${dstText}).`,
      };
    }
  }

  // 3. Check Early Close Override or Friday Close
  const earlyOverride = schedule.earlyCloseOverrides.find(
    (item) => item.localDate === parts.localDate
  );
  const isFriday = parts.weekday === 'Fri';
  const hasSessionCloseToday = Boolean(earlyOverride) || isFriday;

  if (hasSessionCloseToday) {
    const closeLocalTime = earlyOverride
      ? earlyOverride.closeLocalTime
      : schedule.fridayCloseLocalTime;
    const closeMin = parseHhMmToMinutes(closeLocalTime);
    const minutesUntilClose = Number((closeMin - parts.minutesOfDay).toFixed(2));
    const stopNewMin = Math.max(
      schedule.cutoffStopNewEntriesMinutesBeforeClose,
      schedule.cutoffFlattenPositionsMinutesBeforeClose
    );
    const cutoffStartLocalTime = formatMinutesToHhMm(closeMin - stopNewMin);

    if (minutesUntilClose <= 0) {
      return {
        marketTimeUtc: marketTimeIso,
        localDate: parts.localDate,
        localTimeStr,
        weekday: parts.weekday,
        timezone: schedule.timezone,
        utcOffsetLabel: parts.utcOffsetLabel,
        isDstActive: parts.isDstActive,
        sessionState: 'MARKET_CLOSED',
        allowNewEntries: false,
        mustFlattenOpenPositions: true,
        isEarlyCloseDay: Boolean(earlyOverride),
        earlyCloseReasonVi: earlyOverride?.reasonVi,
        minutesUntilSessionClose: 0,
        cutoffWindowStartLocalTime: cutoffStartLocalTime,
        sessionCloseLocalTime: closeLocalTime,
        scheduleId: schedule.scheduleId,
        scheduleVersion: schedule.version,
        scheduleSource: schedule.source,
        reasonVi: earlyOverride
          ? `Đã qua giờ đóng phiên sớm (${closeLocalTime} ${schedule.timezone} — ${earlyOverride.reasonVi}). Thị trường đã đóng cửa.`
          : `Đã qua giờ đóng phiên Thứ Sáu (${closeLocalTime} ${schedule.timezone}, ${dstText}). Thị trường đóng cửa nghỉ cuối tuần.`,
      };
    }

    if (
      minutesUntilClose <= schedule.cutoffStopNewEntriesMinutesBeforeClose ||
      minutesUntilClose <= schedule.cutoffFlattenPositionsMinutesBeforeClose
    ) {
      const mustFlatten =
        minutesUntilClose <= schedule.cutoffFlattenPositionsMinutesBeforeClose;
      return {
        marketTimeUtc: marketTimeIso,
        localDate: parts.localDate,
        localTimeStr,
        weekday: parts.weekday,
        timezone: schedule.timezone,
        utcOffsetLabel: parts.utcOffsetLabel,
        isDstActive: parts.isDstActive,
        sessionState: 'CLOSE_ONLY_15_15',
        allowNewEntries: false,
        mustFlattenOpenPositions: mustFlatten,
        isEarlyCloseDay: Boolean(earlyOverride),
        earlyCloseReasonVi: earlyOverride?.reasonVi,
        minutesUntilSessionClose: minutesUntilClose,
        cutoffWindowStartLocalTime: cutoffStartLocalTime,
        sessionCloseLocalTime: closeLocalTime,
        scheduleId: schedule.scheduleId,
        scheduleVersion: schedule.version,
        scheduleSource: schedule.source,
        reasonVi: earlyOverride
          ? `Quy tắc 15/15 (Ngày đóng sớm — ${earlyOverride.reasonVi}): Còn ${minutesUntilClose.toFixed(
              1
            )} phút trước giờ đóng phiên (${closeLocalTime} ${schedule.timezone}). Ngừng mở lệnh mới và đóng toàn bộ vị thế đang mở.`
          : `Quy tắc 15/15 Thứ Sáu: Còn ${minutesUntilClose.toFixed(
              1
            )} phút trước giờ đóng phiên (${closeLocalTime} ${schedule.timezone}, ${dstText}). Ngừng mở lệnh mới và tất toán vị thế còn lại.`,
      };
    }
  }

  // 4. Check Close-Only Mode (Manual or Date-based)
  const closeOnlyDate = schedule.closeOnlyDates.find(
    (item) => item.localDate === parts.localDate
  );
  if (schedule.manualCloseOnlyMode || closeOnlyDate) {
    const why =
      closeOnlyDate?.reasonVi ||
      schedule.manualCloseOnlyReasonVi ||
      'Chế độ chỉ cho phép đóng lệnh (Close-Only) đang bật theo lịch vận hành.';
    return {
      marketTimeUtc: marketTimeIso,
      localDate: parts.localDate,
      localTimeStr,
      weekday: parts.weekday,
      timezone: schedule.timezone,
      utcOffsetLabel: parts.utcOffsetLabel,
      isDstActive: parts.isDstActive,
      sessionState: 'CLOSE_ONLY_MANUAL',
      allowNewEntries: false,
      mustFlattenOpenPositions: false,
      isEarlyCloseDay: Boolean(earlyOverride),
      earlyCloseReasonVi: earlyOverride?.reasonVi,
      minutesUntilSessionClose: null,
      cutoffWindowStartLocalTime: null,
      sessionCloseLocalTime: earlyOverride?.closeLocalTime || (isFriday ? schedule.fridayCloseLocalTime : null),
      scheduleId: schedule.scheduleId,
      scheduleVersion: schedule.version,
      scheduleSource: schedule.source,
      reasonVi: `Trạng thái CHỈ ĐÓNG LỆNH (Close-Only): ${why}`,
    };
  }

  // 5. Normal Open Session
  const closeLocalTime = earlyOverride
    ? earlyOverride.closeLocalTime
    : isFriday
    ? schedule.fridayCloseLocalTime
    : null;
  const closeMin = closeLocalTime ? parseHhMmToMinutes(closeLocalTime) : null;
  const minutesUntilClose =
    closeMin !== null ? Number((closeMin - parts.minutesOfDay).toFixed(2)) : null;

  return {
    marketTimeUtc: marketTimeIso,
    localDate: parts.localDate,
    localTimeStr,
    weekday: parts.weekday,
    timezone: schedule.timezone,
    utcOffsetLabel: parts.utcOffsetLabel,
    isDstActive: parts.isDstActive,
    sessionState: 'OPEN',
    allowNewEntries: true,
    mustFlattenOpenPositions: false,
    isEarlyCloseDay: Boolean(earlyOverride),
    earlyCloseReasonVi: earlyOverride?.reasonVi,
    minutesUntilSessionClose: minutesUntilClose,
    cutoffWindowStartLocalTime:
      closeMin !== null
        ? formatMinutesToHhMm(closeMin - schedule.cutoffFlattenPositionsMinutesBeforeClose)
        : null,
    sessionCloseLocalTime: closeLocalTime,
    scheduleId: schedule.scheduleId,
    scheduleVersion: schedule.version,
    scheduleSource: schedule.source,
    reasonVi: `Phiên giao dịch đang mở bình thường (${parts.weekday} ${parts.localDate} ${localTimeStr} ${schedule.timezone}, ${dstText}).`,
  };
}

/**
 * Checks whether an open position should be force-closed due to:
 * (a) Currently inside the 15/15 cutoff window (`CLOSE_ONLY_15_15`), OR
 * (b) Having missed a scheduled 15/15 Friday or Early-Close cutoff between `entryMarketTime`
 *     and `currentQuoteMarketTime`, and `currentQuoteMarketTime` is the first valid quote
 *     when the market is open / tradable again.
 */
export function checkMandatoryCutoffClose(params: {
  entryMarketTimeUtc: string;
  currentQuoteTimeUtc: string;
  schedule: BrokerSessionScheduleConfig;
}): {
  mustClose: boolean;
  missedScheduledCutoff: boolean;
  scheduleEval: MarketScheduleEvaluation;
  reasonVi: string;
} {
  const { entryMarketTimeUtc, currentQuoteTimeUtc, schedule } = params;
  const currentEval = evaluateMarketSchedule(currentQuoteTimeUtc, schedule);

  if (!schedule.enabled) {
    return {
      mustClose: false,
      missedScheduledCutoff: false,
      scheduleEval: currentEval,
      reasonVi: currentEval.reasonVi,
    };
  }

  // Cannot execute a close while the market is completely closed; wait for first valid open quote
  if (currentEval.sessionState === 'MARKET_CLOSED') {
    return {
      mustClose: false,
      missedScheduledCutoff: false,
      scheduleEval: currentEval,
      reasonVi: `Đang trong giờ đóng cửa thị trường (${currentEval.reasonVi}) — Chờ báo giá hợp lệ đầu tiên khi phiên mở lại để xử lý vị thế tồn đọng.`,
    };
  }

  // Case 1: Directly inside the 15/15 cutoff window on Friday or an Early-Close day
  if (currentEval.mustFlattenOpenPositions) {
    return {
      mustClose: true,
      missedScheduledCutoff: false,
      scheduleEval: currentEval,
      reasonVi: currentEval.reasonVi,
    };
  }

  // Case 2: Did this position cross a Friday close or Early-Close cutoff between entryMarketTimeUtc and currentQuoteTimeUtc?
  const entryMs = Date.parse(entryMarketTimeUtc);
  const currentMs = Date.parse(currentQuoteTimeUtc);
  if (!Number.isFinite(entryMs) || !Number.isFinite(currentMs) || currentMs <= entryMs) {
    return {
      mustClose: false,
      missedScheduledCutoff: false,
      scheduleEval: currentEval,
      reasonVi: currentEval.reasonVi,
    };
  }

  // Scan in 15-minute steps (up to 7 days) from entryMs to currentMs to see if a cutoff or market close occurred
  const stepMs = 15 * 60 * 1000;
  const maxScanMs = Math.min(currentMs, entryMs + 8 * 24 * 3600 * 1000);
  for (let t = entryMs + stepMs; t < maxScanMs; t += stepMs) {
    const probeIso = new Date(t).toISOString();
    const probeEval = evaluateMarketSchedule(probeIso, schedule);
    if (probeEval.mustFlattenOpenPositions || probeEval.sessionState === 'MARKET_CLOSED') {
      return {
        mustClose: true,
        missedScheduledCutoff: true,
        scheduleEval: currentEval,
        reasonVi: `ĐÃ LỠ GIỜ ĐÓNG PHIÊN 15/15 (Mốc lỡ: ${probeEval.localDate} ${
          probeEval.sessionCloseLocalTime || schedule.fridayCloseLocalTime
        } ${schedule.timezone}): Đóng bắt buộc vị thế tồn đọng ngay tại báo giá hợp lệ đầu tiên (${currentQuoteTimeUtc}).`,
      };
    }
  }

  return {
    mustClose: false,
    missedScheduledCutoff: false,
    scheduleEval: currentEval,
    reasonVi: currentEval.reasonVi,
  };
}
