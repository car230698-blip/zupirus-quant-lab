type Snapshot = { ts: number; equity: number; balance: number };
const price = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

export function EquityHistory({ samples }: { samples: Snapshot[] }) {
  const points = samples.filter((point) => [point.ts, point.equity, point.balance].every(Number.isFinite));
  if (points.length < 2) return <div className="quant-chart-empty">Chưa đủ dữ liệu để vẽ lịch sử vốn.</div>;

  const values = points.flatMap(({ balance, equity }) => [balance, equity]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const margin = Math.max((high - low) * 0.12, 0.5);
  const top = high + margin;
  const bottom = low - margin;
  const start = points[0].ts;
  const elapsed = Math.max(points[points.length - 1].ts - start, 1);
  const x = (point: Snapshot) => 18 + ((point.ts - start) / elapsed) * 742;
  const y = (value: number) => 24 + ((top - value) / (top - bottom)) * 180;
  const equity = points.map((point) => `${x(point)},${y(point.equity)}`).join(' ');
  const balance = points.map((point) => `${x(point)},${y(point.balance)}`).join(' ');
  const last = points[points.length - 1];
  const timestamp = (value: number) => new Date(value * 1000).toLocaleTimeString('vi-VN');

  return (
    <div className="quant-history">
      <svg viewBox="0 0 850 230" role="img" aria-label={`Lịch sử vốn. Mẫu gần nhất: ${price.format(last.equity)} USD.`}>
        <defs>
          <linearGradient id="quant-equity-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity=".25" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((step) => {
          const value = top - (step / 4) * (top - bottom);
          return <g key={step}>
            <line x1="18" x2="760" y1={y(value)} y2={y(value)} stroke="var(--edge)" strokeDasharray="3 4" />
            <text x="770" y={y(value) + 4} fill="var(--muted)" fontSize="11">{price.format(value)}</text>
          </g>;
        })}
        <polygon points={`18,204 ${equity} ${x(last)},204`} fill="url(#quant-equity-fill)" />
        <polyline points={balance} fill="none" stroke="#8b9fb6" strokeWidth="2" strokeDasharray="5 4" />
        <polyline points={equity} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(last)} cy={y(last.equity)} r="4" fill="var(--accent)" />
      </svg>
      <div className="quant-chart-legend">
        <span>{timestamp(start)} – {timestamp(last.ts)}</span>
        <span><i /> Vốn <i className="quant-balance-key" /> Số dư</span>
      </div>
    </div>
  );
}
