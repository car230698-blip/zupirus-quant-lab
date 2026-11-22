import { PRICING_TIERS_LIST } from './quantConstants';

export const GUARD_LAYERS_VI = [
  {
    id: '01',
    code: 'REDIS_IDEMPOTENCY_LOCK',
    title: 'Khóa Chống Lặp Lệnh Redis (Idempotency Lock)',
    metric: '< 0.8 ms',
    desc: 'Mỗi tín hiệu được băm SHA-256 và khóa nguyên tử trên Redis trước khi phân phối. Triệt tiêu 100% lỗi bắn trùng lệnh khi webhook hoặc đường truyền rung lắc.',
    rule: 'SETNX signal:{hash}:account:{id} EX 60',
  },
  {
    id: '02',
    code: 'MANDATORY_HARD_STOP_LOSS',
    title: 'Bắt Buộc SL Cứng & Tự Động Dời Hòa Vốn (1R BE)',
    metric: '100% SL Enforced',
    desc: 'Từ chối thực thi mọi tín hiệu thiếu Stop-Loss nếu không bật chế độ Auto ATR(14) SL. Tự động dời SL về điểm vào lệnh (Break-Even) ngay khi lợi nhuận đạt 1R.',
    rule: 'IF stop_loss IS NULL AND NOT auto_atr_sl -> REJECT_FAIL_CLOSED',
  },
  {
    id: '03',
    code: 'MACRO_USD_NEWS_SHIELD',
    title: 'Lá Chắn Tin Tức Vĩ Mô USD Đỏ (CPI / NFP / FOMC)',
    metric: '±15 Phút Phong Tỏa',
    desc: 'Đồng bộ lịch kinh tế thời gian thực và tự động đóng băng mở vị thế mới trong bán kính ±15 phút quanh các bản tin USD High-Impact để tránh giãn spread.',
    rule: 'IF abs(now - usd_high_impact_ts) <= 900s -> HALT_NEW_ENTRIES',
  },
  {
    id: '04',
    code: 'PROP_DRAWDOWN_CIRCUIT_BREAKER',
    title: 'Cầu Dao Bảo Vệ Quỹ Prop & Giới Hạn Trượt Giá',
    metric: 'Max 4.0% Daily DD',
    desc: 'Kiểm toán độ giãn Spread thực tế trên cầu nối London G2 và tự động ngắt kết nối bảo toàn tài khoản nếu mức sụt giảm trong ngày chạm ngưỡng cài đặt.',
    rule: 'IF daily_dd_pct >= max_daily_dd OR spread > 4.5_pips -> CIRCUIT_BREAK',
  },
];

export const GUARD_LAYERS_EN = [
  {
    id: '01',
    code: 'REDIS_IDEMPOTENCY_LOCK',
    title: 'Redis Idempotency Lock (De-Duplication)',
    metric: '< 0.8 ms',
    desc: 'Every trade signal is SHA-256 hashed and atomically locked in Redis prior to fanout. 100% eliminates duplicate order firing from flaky webhook deliveries.',
    rule: 'SETNX signal:{hash}:account:{id} EX 60',
  },
  {
    id: '02',
    code: 'MANDATORY_HARD_STOP_LOSS',
    title: 'Mandatory Hard Stop Loss & Auto Break-Even (1R BE)',
    metric: '100% SL Enforced',
    desc: 'Rejects execution for any signal missing a Stop Loss unless Auto ATR(14) SL is active. Automatically moves SL to Entry (Break-Even) once profit reaches 1R.',
    rule: 'IF stop_loss IS NULL AND NOT auto_atr_sl -> REJECT_FAIL_CLOSED',
  },
  {
    id: '03',
    code: 'MACRO_USD_NEWS_SHIELD',
    title: 'Macro USD High-Impact News Shield (CPI / NFP / FOMC)',
    metric: '±15m Blackout Zone',
    desc: 'Synchronizes live macroeconomic calendars and freezes new order dispatches within ±15 minutes around red USD releases to prevent spread blowout.',
    rule: 'IF abs(now - usd_high_impact_ts) <= 900s -> HALT_NEW_ENTRIES',
  },
  {
    id: '04',
    code: 'PROP_DRAWDOWN_CIRCUIT_BREAKER',
    title: 'Prop Firm Drawdown Circuit Breaker & Slippage Cap',
    metric: 'Max 4.0% Daily DD',
    desc: 'Audits live London G2 bridge latency & spread. Automatically trips circuit breakers to preserve capital if daily drawdown hits user threshold.',
    rule: 'IF daily_dd_pct >= max_daily_dd OR spread > 4.5_pips -> CIRCUIT_BREAK',
  },
];

export const getGuardLayers = (lang: 'vi' | 'en' = 'vi') => (lang === 'en' ? GUARD_LAYERS_EN : GUARD_LAYERS_VI);

export const GUARD_LAYERS = GUARD_LAYERS_VI;

export const PRICING_TIERS_VI = PRICING_TIERS_LIST;

export const PRICING_TIERS_EN = [
  {
    id: 'starter',
    code: 'TIER 01 // STARTER & CENT',
    name: 'Starter & Cent',
    baseUsd: 25,
    slots: 1,
    badge: '1 Cloud MT5 Slot Included',
    popular: false,
    features: [
      'Includes 1 Cloud MT5 London G2 account (saves $10/mo VPS cost)',
      'Auto-detects Cent / Standard accounts with dynamic lot sizing',
      'Activates 3 Shield Layers: Auto ATR Stop Loss, News Shield ±15m',
      'Autonomous daily drawdown circuit breaker (Max Daily DD 5.0%)',
    ],
  },
  {
    id: 'growth',
    code: 'TIER 02 // CAPITAL ACCELERATION (GROWTH)',
    name: 'Growth & Compounding',
    baseUsd: 39,
    slots: 3,
    badge: 'Up to 3 Cloud Accounts',
    popular: true,
    features: [
      'Includes 1 Cloud slot (expand up to 3 MT5s, only +$10/slot)',
      'Automated Break-Even (+1R BE) & partial 50% TP1 profit lock',
      'Auto-Compounding lot sizing synchronized with equity growth',
      'AI-filtered signal execution + automated 5.0% daily circuit breaker',
    ],
  },
  {
    id: 'alpha',
    code: 'TIER 03 // PROP FIRM PASS & FUND (ALPHA)',
    name: 'Alpha Prop Firm',
    baseUsd: 59,
    slots: 5,
    badge: 'Up to 5 Cloud Accounts',
    popular: false,
    features: [
      'Includes 1 Cloud slot (expand up to 5 MT5s, only +$10/slot)',
      'Hard 4.0% Daily DD Circuit Breaker (safe for 5% FTMO/FundedNext rules)',
      'Automated weekend position flattening (Friday 21:00 UTC)',
      'Unlocks autonomous AI Swarm & deep MAE / MFE execution telemetry',
    ],
  },
];

export const getPricingTiers = (lang: 'vi' | 'en' = 'vi') => (lang === 'en' ? PRICING_TIERS_EN : PRICING_TIERS_VI);

export const PRICING_TIERS = PRICING_TIERS_LIST;
