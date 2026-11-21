import { PRICING_TIERS_LIST } from './quantConstants';

export const GUARD_LAYERS = [
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

export const PRICING_TIERS = PRICING_TIERS_LIST;
