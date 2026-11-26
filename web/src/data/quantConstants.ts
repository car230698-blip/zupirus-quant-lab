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
    code: 'ẤN PHẨM 01 // ĐỌC THỬ',
    name: 'Bản đọc thử',
    baseUsd: 0,
    slots: 1,
    badge: 'Miễn phí',
    features: [
      'Xem phạm vi dữ liệu và tuyên bố rủi ro',
      'Không cần tài khoản giao dịch',
      'Không có lệnh tự động',
      'Giá các bản đầy đủ do người xuất bản đặt',
    ],
  },
  growth: {
    id: 'growth',
    code: 'ẤN PHẨM 02 // MỘT CUỐN',
    name: 'Một phương pháp PDF',
    baseUsd: 29,
    slots: 1,
    badge: 'Ví dụ giá',
    popular: true,
    features: [
      'Bảng phiên, biến động, mùa vụ và một quy tắc minh họa',
      'Song ngữ Việt và Anh, có biểu đồ',
      'Thanh toán USDT BEP20 hoặc TRC20',
      'Số liệu là mô tả mẫu, không phải lợi nhuận tương lai',
    ],
  },
  alpha: {
    id: 'alpha',
    code: 'ẤN PHẨM 03 // BẢN ĐẦY ĐỦ',
    name: 'Bản đầy đủ có watermark',
    baseUsd: 49,
    slots: 1,
    badge: 'Ví dụ giá',
    features: [
      'Đường đi lịch sử của quy tắc, gồm mức sụt giảm trên mẫu',
      'Trang cấp quyền ghi email người mua',
      'Liên kết tải có thời hạn',
      'Bạn tự quyết định có dùng quy tắc hay không',
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
