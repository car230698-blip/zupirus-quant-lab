import type { AgentOperationalStateCode } from '../quant/agentActivityTracker.ts';
import type { MarketRegime, PositionExitReason } from '../quant/types.ts';

export function formatUsd(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

export function formatSignedUsd(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return '—';
  const sign = val > 0 ? '+' : '';
  return `${sign}${formatUsd(val)}`;
}

export function formatPrice(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return '—';
  return val.toFixed(2);
}

export function formatPct(val: number | undefined | null, digits = 2): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return '—';
  return `${val.toFixed(digits)}%`;
}

export function formatLots(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return '—';
  return `${val.toFixed(2)} lot`;
}

export function formatUtcShort(iso: string | null | undefined): string {
  if (!iso) return 'Chưa có';
  return iso.replace('T', ' ').slice(0, 19) + ' UTC';
}

export function formatUtcTimeOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(11, 19) + ' UTC';
}

export const EXIT_REASON_LABELS_VI: Record<PositionExitReason, string> = {
  TP2_FULL_TARGET: 'Chốt lời toàn phần TP2',
  SL_AFTER_PARTIAL_TP1: 'Chốt 50% TP1 -> Dừng lỗ phần còn lại',
  STOP_LOSS_HIT: 'Chạm Dừng lỗ (SL)',
  INTRA_BAR_SL_TP_CONFLICT_SL_FIRST: 'Xung đột SL/TP nội nến (Ưu tiên SL bảo thủ)',
  TIME_EXPIRED: 'Hết thời hạn nắm giữ (Time Expiry)',
  FRIDAY_15_15_CUTOFF: 'Đóng bắt buộc 15 phút trước giờ đóng phiên (Quy tắc 15/15)',
  MISSED_CUTOFF_FIRST_VALID_QUOTE: 'Đóng ngay ở báo giá hợp lệ đầu tiên sau khi lỡ giờ cắt 15/15',
  REJECTED_AT_ENTRY: 'Từ chối khi vào lệnh',
  ORDER_EXPIRED_UNFILLED: 'Hết hạn chưa khớp',
  OPEN: 'Đang mở',
};

export const REGIME_BADGE_TONES: Record<
  MarketRegime,
  'cyan' | 'emerald' | 'amber' | 'rose' | 'slate'
> = {
  TRENDING: 'emerald',
  RANGING: 'cyan',
  SQUEEZE_PRE_BREAKOUT: 'amber',
  VOLATILITY_SHOCK: 'rose',
  INSUFFICIENT_DATA: 'slate',
};

export const OPERATIONAL_STATE_TONES: Record<
  AgentOperationalStateCode,
  'cyan' | 'emerald' | 'amber' | 'rose' | 'slate'
> = {
  PROCESSING: 'cyan',
  COMPLETED: 'emerald',
  WAITING_FOR_CANDLE: 'amber',
  MARKET_CLOSED: 'amber',
  INSUFFICIENT_SAMPLES: 'amber',
  SOURCE_DISCONNECTED: 'rose',
  RISK_VETOED: 'rose',
  HALTED_BY_LEARNER: 'rose',
};

export function formatExitReasonVi(reason?: PositionExitReason | string | null): string {
  if (!reason) return 'Đang mở';
  return EXIT_REASON_LABELS_VI[reason as PositionExitReason] ?? reason;
}

export const STRATEGY_LABELS_VI: Record<string, string> = {
  STRAT_TREND_FOLLOW: 'Theo xu hướng động lượng',
  STRAT_MEAN_REVERT: 'Hồi quy trung bình biên độ',
  STRAT_MEAN_REVERSION: 'Hồi quy trung bình biên độ',
  STRAT_VOL_BREAKOUT: 'Phá vỡ nén biến động',
  STRAT_BREAKOUT_SQUEEZE: 'Phá vỡ nén biến động',
};

export function formatStrategyNameVi(strategyId?: string | null): string {
  if (!strategyId) return 'Đứng ngoài';
  return STRATEGY_LABELS_VI[strategyId] ?? strategyId;
}

export function formatCleanJournalMessageVi(rawMessage: string): string {
  if (!rawMessage) return '';
  return rawMessage
    .replace(/^\[[^\]]+\]\s*/g, '')
    .replace(/\bPOLICY_BASELINE_FIXED_V1\b/g, 'Chính sách cơ sở (v1)')
    .replace(/\bPOLICY_ADAPTIVE_V(\d+)\b/g, 'Chính sách thích ứng (v$1)')
    .replace(/\bSTRAT_TREND_FOLLOW(?:@v[\d.]+(?:-[A-Z0-9-]+)?)?\b/g, 'Theo xu hướng')
    .replace(/\bSTRAT_MEAN_REVERT(?:@v[\d.]+(?:-[A-Z0-9-]+)?)?\b/g, 'Hồi quy trung bình')
    .replace(/\bSTRAT_MEAN_REVERSION(?:@v[\d.]+(?:-[A-Z0-9-]+)?)?\b/g, 'Hồi quy trung bình')
    .replace(/\bSTRAT_VOL_BREAKOUT(?:@v[\d.]+(?:-[A-Z0-9-]+)?)?\b/g, 'Phá vỡ nén biến động')
    .replace(/\bSTRAT_BREAKOUT_SQUEEZE(?:@v[\d.]+(?:-[A-Z0-9-]+)?)?\b/g, 'Phá vỡ nén biến động')
    .replace(/\bKEEP_CURRENT_POLICY_INSUFFICIENT_SAMPLES\b/g, 'Giữ chính sách (thiếu mẫu)')
    .replace(/\bKEEP_CURRENT_POLICY_NO_OUTPERFORMANCE\b/g, 'Giữ chính sách (chưa vượt trội)')
    .replace(/\bPROMOTE_NEW_POLICY\b/g, 'Kích hoạt chính sách mới')
    .replace(/\bROLLBACK_TO_PREVIOUS_POLICY\b/g, 'Quay lui chính sách an toàn')
    .replace(/\bHALT_NEW_POSITIONS_DEGRADED\b/g, 'Tạm dừng mở vị thế mới')
    .replace(/\bSIMULATION_ONLY\b/g, 'mô phỏng')
    .trim();
}

