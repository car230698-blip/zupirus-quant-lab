export const POPULAR_BROKERS = [
  { label: 'Exness', server: 'Exness-MT5Real' },
  { label: 'FTMO', server: 'FTMO-Server' },
  { label: 'ICMarkets', server: 'ICMarketsSC-MT5' },
  { label: 'Vantage', server: 'VantageInternational-Live' },
  { label: 'Pepperstone', server: 'Pepperstone-MT5-Live01' },
];

export const SHIELD_LAYERS = [
  {
    id: '01',
    code: 'REDIS LOCK',
    title: 'Chống Bắn Trùng Lệnh',
    status: 'ACTIVE',
    latency: '0.6 ms',
    detail: 'Khóa nguyên tử SHA-256 trên Redis ngăn chặn 100% lệnh lặp từ nguồn ngoại vi trong 60 giây.',
  },
  {
    id: '02',
    code: 'HARD STOP-LOSS',
    title: 'ATR(14) & Auto 1R BE',
    status: 'ENFORCED',
    latency: '1.1 ms',
    detail: 'Bắt buộc SL cứng cho mọi vị thế. Tự động dời Stop-Loss về điểm vào lệnh ngay khi lãi chạm 1R.',
  },
  {
    id: '03',
    code: 'USD NEWS SHIELD',
    title: 'CPI · NFP · FOMC ±15m',
    status: 'ARMED',
    latency: '2.0 ms',
    detail: 'Tự động phong tỏa mở lệnh mới trước và sau 15 phút các sự kiện tin tức USD High-Impact.',
  },
  {
    id: '04',
    code: 'PROP DD BREAKER',
    title: 'Bảo Vệ Trần Lỗ Ngày',
    status: 'NOMINAL',
    latency: '0.9 ms',
    detail: 'Ngắt kết nối bảo toàn vốn tự động khi mức sụt giảm ngày chạm ngưỡng cài đặt của quỹ Prop.',
  },
];

export const SHIELD_LAYERS_EN = [
  {
    id: '01',
    code: 'REDIS LOCK',
    title: 'De-Duplication Lock',
    status: 'ACTIVE',
    latency: '0.6 ms',
    detail: 'SHA-256 atomic Redis lock blocks duplicate executions from external webhooks within 60s.',
  },
  {
    id: '02',
    code: 'HARD STOP-LOSS',
    title: 'ATR(14) & Auto 1R BE',
    status: 'ENFORCED',
    latency: '1.1 ms',
    detail: 'Mandatory hard SL for all positions. Automatically moves SL to Break-Even at 1R profit.',
  },
  {
    id: '03',
    code: 'USD NEWS SHIELD',
    title: 'CPI · NFP · FOMC ±15m',
    status: 'ARMED',
    latency: '2.0 ms',
    detail: 'Autonomous trade freeze window 15 minutes before and after high-impact USD economic releases.',
  },
  {
    id: '04',
    code: 'PROP DD BREAKER',
    title: 'Daily DD Capital Guard',
    status: 'NOMINAL',
    latency: '0.9 ms',
    detail: 'Autonomous circuit breaker halts trading when daily drawdown threshold is reached.',
  },
];

export const getShieldLayers = (lang: 'vi' | 'en' = 'vi') => (lang === 'en' ? SHIELD_LAYERS_EN : SHIELD_LAYERS);

export type PlanTier = 'starter' | 'growth' | 'alpha';

export interface PlanConfig {
  id: PlanTier;
  code: string;
  name: string;
  baseUsd: number;
  slots: number;
  badge: string;
  popular?: boolean;
  features: string[];
}

export const QUANT_PLANS: Record<PlanTier, PlanConfig> = {
  starter: {
    id: 'starter',
    code: 'GÓI 01 // TRẢI NGHIỆM & CENT',
    name: 'Khởi Đầu / Cent',
    baseUsd: 25,
    slots: 1,
    badge: 'Trọn Gói 1 TK Cloud',
    features: [
      'Đã bao gồm sẵn 01 Tài khoản Cloud MT5 London G2 (tiết kiệm $10 VPS)',
      'Tự động nhận diện Cent / Standard và chia Lot an toàn theo số dư',
      'Kích hoạt 3 Lớp Giáp: Tự gắn SL theo ATR, Chặn tin đỏ ±15 phút',
      'Tự động cắt lỗ bảo vệ ngày (Max Daily DD 5.0%)',
    ],
  },
  growth: {
    id: 'growth',
    code: 'GÓI 02 // TĂNG TRƯỞNG VỐN (GROWTH)',
    name: 'Growth & Lãi Kép',
    baseUsd: 39,
    slots: 3,
    badge: 'Tối đa 3 TK Cloud',
    popular: true,
    features: [
      'Đã bao gồm sẵn 01 Tài khoản Cloud (mở rộng tối đa 3 TK, thêm chỉ +$10/TK)',
      'Tự động Dời Hòa Vốn (+1R) & Chốt lời 50% TP1 khóa lợi nhuận',
      'Tự động Lãi Kép (Auto-Compounding) tăng Lot theo tăng trưởng vốn',
      'Tín hiệu chọn lọc qua AI lọc nhiễu + Cắt lỗ ngày tự động 5.0%',
    ],
  },
  alpha: {
    id: 'alpha',
    code: 'ẤN PHẨM 03 // NGHIÊN CỨU ĐỊNH LƯỢNG (ALPHA)',
    name: 'Alpha Quant Research',
    baseUsd: 59,
    slots: 5,
    badge: 'Bản Đầy Đủ & Dữ Liệu',
    features: [
      'Ấn phẩm báo cáo PDF định lượng hoàn chỉnh với quyền tải vĩnh viễn',
      'Kiểm định Walk-Forward ngoài mẫu đa chu kỳ qua các phiên Âu và Mỹ',
      'Mô hình chi phí ma sát thực tế (Spread, Commission, Trượt giá)',
      'Mở khóa toàn bộ bảng đối soát, phân phối MFE/MAE và dữ liệu thô',
    ],
  },
};

export const PRICING_TIERS_LIST: PlanConfig[] = [
  QUANT_PLANS.starter,
  QUANT_PLANS.growth,
  QUANT_PLANS.alpha,
];

export function normalizePlanTier(rawTier: string | null | undefined): PlanTier {
  const t = String(rawTier || 'starter').trim().toLowerCase();
  if (t === 'pro' || t === 'growth') return 'growth';
  if (t === 'institutional' || t === 'alpha') return 'alpha';
  return 'starter';
}
