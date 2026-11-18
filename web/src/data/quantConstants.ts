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
    title: 'CPI · NFP · FOMC ±30m',
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
