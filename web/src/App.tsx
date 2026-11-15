import React, { useState, useEffect, useCallback } from 'react';
import { CustomerAssistant } from './components/CustomerAssistant.tsx';
import { AdminApprovalQueue } from './components/AdminApprovalQueue.tsx';

type TabKey = 'overview' | 'accounts' | 'orders' | 'assistant' | 'admin_approvals' | 'monitor';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [dashboard, setDashboard] = useState<any>({
    accounts: [],
    orders: [],
    series: [],
    health: {},
    real_trading: false,
  });
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [candles, setCandles] = useState<any[]>([]);
  const [timeframe, setTimeframe] = useState<'M1' | 'M5' | 'M15' | 'H1' | 'D1'>('M15');
  const [chartMode, setChartMode] = useState<'equity' | 'candles'>('equity');

  // Admin & Monitoring state
  const [monitorData, setMonitorData] = useState<any>({ accounts: [], audit: [], jobs: [], news: [], halted: false });
  const [tracingData, setTracingData] = useState<any>({
    langsmith_configured: true,
    project: 'zupirus-quant-lab',
    total_traces_recorded: 0,
    recent_traces: [],
  });
  const [readyData, setReadyData] = useState<any>(null);

  // Forms & notices
  const [notice, setNotice] = useState<string | null>(null);
  const [newDemoLogin, setNewDemoLogin] = useState('');
  const [newDemoServer, setNewDemoServer] = useState('ICMarketsSC-Demo');
  const [pairCodes, setPairCodes] = useState<Record<string, string>>({});
  const [newsTitle, setNewsTitle] = useState('');
  const [newsWhen, setNewsWhen] = useState('');
  const [visionResult, setVisionResult] = useState<string>('');
  const [visionLoading, setVisionLoading] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (res.ok) {
        const d = await res.json();
        setDashboard(d);
        setSelectedAccount((prev) => {
          if (prev && d.accounts?.some((a: any) => a.id === prev)) return prev;
          return d.accounts?.[0]?.id || '';
        });
      }
    } catch {
      // ignore offline
    }
  }, []);

  const loadCandles = useCallback(async (tf: string) => {
    try {
      const res = await fetch(`/api/timescale/candles?symbol=XAUUSD&timeframe=${tf}&source=DEMO&limit=36`);
      if (res.ok) {
        const d = await res.json();
        setCandles((d.candles || []).slice().reverse());
      }
    } catch {
      // ignore
    }
  }, []);

  const loadAdminMonitor = useCallback(async () => {
    try {
      const [mRes, tRes, rRes] = await Promise.all([
        fetch('/api/admin/monitor'),
        fetch('/api/admin/tracing'),
        fetch('/readyz'),
      ]);
      if (mRes.ok) setMonitorData(await mRes.json());
      if (tRes.ok) setTracingData(await tRes.json());
      if (rRes.ok) setReadyData(await rRes.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    loadCandles(timeframe);
    loadAdminMonitor();
    const timer = setInterval(() => {
      loadDashboard();
      if (activeTab === 'monitor' || activeTab === 'admin_approvals') {
        loadAdminMonitor();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [loadDashboard, loadCandles, loadAdminMonitor, timeframe, activeTab]);

  const showNotice = (msg: string) => {
    setNotice(msg);
  };

  const handleCreateReplay = async () => {
    const res = await fetch('/api/replay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
    });
    if (res.ok) {
      showNotice('Đã khởi tạo tài khoản Replay XAUUSD mới với dữ liệu 900 bar tổng hợp.');
      await loadDashboard();
    }
  };

  const handleCreateDemo = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({ login: newDemoLogin, server: newDemoServer, mode: 'DEMO' }),
    });
    const d = await res.json();
    if (!res.ok) {
      showNotice(`Lỗi: ${d.detail || 'Không thể thêm tài khoản'}`);
      return;
    }
    setNewDemoLogin('');
    showNotice(`Đã thêm tài khoản MT5 Demo #${newDemoLogin} (${newDemoServer}).`);
    await loadDashboard();
  };

  const handleSaveRisk = async (acc: any, formData: FormData) => {
    const payload = {
      enabled: Boolean(acc.enabled),
      risk: Number(formData.get('risk')),
      max_spread: Number(formData.get('max_spread')),
      max_positions: Number(formData.get('max_positions')),
      max_dd: Number(formData.get('max_dd')),
    };
    const res = await fetch(`/api/accounts/${acc.id}/risk`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showNotice(`Đã lưu cấu hình giới hạn rủi ro cho tài khoản #${acc.login}.`);
      await loadDashboard();
    }
  };

  const handleToggleCopy = async (acc: any) => {
    const payload = {
      enabled: !acc.enabled,
      risk: acc.risk,
      max_spread: acc.max_spread,
      max_positions: acc.max_positions,
      max_dd: acc.max_dd,
    };
    const res = await fetch(`/api/accounts/${acc.id}/risk`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showNotice(`${!acc.enabled ? 'Đã bật' : 'Đã tạm dừng'} sao chép cho tài khoản #${acc.login}.`);
      await loadDashboard();
    }
  };

  const handlePairCode = async (accId: string) => {
    const res = await fetch(`/api/accounts/${accId}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
    });
    const d = await res.json();
    if (res.ok) {
      setPairCodes((prev) => ({ ...prev, [accId]: d.code }));
      showNotice(`Đã cấp mã ghép nối EA dùng một lần (hiệu lực 5 phút): ${d.code}`);
    } else {
      showNotice(`Lỗi: ${d.detail}`);
    }
  };

  const handleRevoke = async (accId: string, login: string) => {
    const res = await fetch(`/api/accounts/${accId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
    });
    if (res.ok) {
      setPairCodes((prev) => {
        const copy = { ...prev };
        delete copy[accId];
        return copy;
      });
      showNotice(`Đã thu hồi thiết bị EA và tạm dừng copy cho tài khoản #${login}.`);
      await loadDashboard();
    }
  };

  const handleSystemSafety = async (haltState: boolean) => {
    const res = await fetch('/api/admin/safety', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({ halted: haltState }),
    });
    if (res.ok) {
      showNotice(
        haltState
          ? 'ĐÃ DỪNG TOÀN HỆ THỐNG: Mọi tín hiệu mới bị chặn; các vị thế đang mở giữ nguyên SL/TP tại broker.'
          : 'ĐÃ GỠ KHÓA HỆ THỐNG: Khách hàng có thể bật lại sao chép cho từng tài khoản.'
      );
      await loadDashboard();
      await loadAdminMonitor();
    }
  };

  const handleAddNews = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newsTitle.trim()) return;
    const ts = newsWhen ? new Date(newsWhen).getTime() / 1000 : Date.now() / 1000 + 3600;
    const res = await fetch('/api/admin/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({ title: newsTitle, ts, currency: 'USD', impact: 'high' }),
    });
    if (res.ok) {
      setNewsTitle('');
      setNewsWhen('');
      showNotice('Đã thêm sự kiện lịch kinh tế USD · High Impact (chặn lệnh Demo mới ±15 phút).');
      await loadAdminMonitor();
    }
  };

  const handleVisionSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fileInput = e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    setVisionLoading(true);
    try {
      let dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      if (file) {
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
      const res = await fetch('/api/admin/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ image: dataUrl }),
      });
      const d = await res.json();
      setVisionResult(d.text || 'Đã hoàn tất phân tích biểu đồ.');
    } catch (err: any) {
      setVisionResult(`Lỗi phân tích: ${err.message}`);
    } finally {
      setVisionLoading(false);
    }
  };

  const accounts = dashboard.accounts || [];
  const orders = dashboard.orders || [];
  const totalBalance = accounts.reduce((s: number, a: any) => s + (a.balance || 0), 0);
  const totalEquity = accounts.reduce((s: number, a: any) => s + (a.equity || 0), 0);
  const activeCopyCount = accounts.filter((a: any) => a.enabled).length;
  const pendingReconcile = orders.filter((o: any) => ['unknown', 'intent', 'queued'].includes(o.state)).length;

  // Prepare SVG chart points
  const accountSeries = (dashboard.series || []).filter((s: any) => s.account_id === selectedAccount);
  const renderEquitySvg = () => {
    if (accountSeries.length < 2) {
      return (
        <svg viewBox="0 0 760 220" className="w-full h-52 overflow-visible">
          <text x="380" y="110" textAnchor="middle" fill="#64748b" fontSize="12" fontFamily="monospace">
            Chờ dữ liệu snapshot • nhấn &ldquo;+ Tạo Tài Khoản Replay&rdquo; để bắt đầu
          </text>
        </svg>
      );
    }
    const vals = accountSeries.flatMap((x: any) => [x.equity, x.balance]);
    const min = Math.min(...vals) - 8;
    const max = Math.max(...vals) + 8;
    const span = Math.max(max - min, 1);
    const pts = (key: 'balance' | 'equity') =>
      accountSeries
        .map(
          (v: any, i: number) =>
            `${48 + (i / (accountSeries.length - 1)) * 695},${195 - ((v[key] - min) / span) * 165}`
        )
        .join(' ');

    return (
      <svg viewBox="0 0 760 220" className="w-full h-52 overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = 195 - t * 165;
          const label = Math.round(min + t * span).toLocaleString();
          return (
            <g key={t}>
              <line x1="48" x2="745" y1={y} y2={y} stroke="#1e293b" strokeDasharray="3 5" />
              <text x="4" y={y + 4} fill="#64748b" fontSize="9.5" fontFamily="monospace">
                ${label}
              </text>
            </g>
          );
        })}
        <polyline points={pts('balance')} fill="none" stroke="#64748b" strokeWidth="1.6" strokeDasharray="4 3" />
        <polyline points={pts('equity')} fill="none" stroke="#22d3ee" strokeWidth="2.5" />
      </svg>
    );
  };

  const renderCandlesSvg = () => {
    if (candles.length < 2) {
      return (
        <svg viewBox="0 0 760 220" className="w-full h-52">
          <text x="380" y="110" textAnchor="middle" fill="#64748b" fontSize="12" fontFamily="monospace">
            Đang tải chuỗi nến TimescaleDB time_bucket...
          </text>
        </svg>
      );
    }
    const lows = candles.map((c) => c.low);
    const highs = candles.map((c) => c.high);
    const min = Math.min(...lows) - 1;
    const max = Math.max(...highs) + 1;
    const span = Math.max(max - min, 1);
    const yOf = (val: number) => 195 - ((val - min) / span) * 165;

    return (
      <svg viewBox="0 0 760 220" className="w-full h-52 overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = 195 - t * 165;
          const label = (min + t * span).toFixed(1);
          return (
            <g key={t}>
              <line x1="48" x2="745" y1={y} y2={y} stroke="#1e293b" strokeDasharray="3 5" />
              <text x="4" y={y + 4} fill="#64748b" fontSize="9.5" fontFamily="monospace">
                {label}
              </text>
            </g>
          );
        })}
        {candles.map((c, i) => {
          const x = 58 + (i / Math.max(candles.length - 1, 1)) * 675;
          const bull = c.close >= c.open;
          const color = bull ? '#10b981' : '#f43f5e';
          const top = yOf(Math.max(c.open, c.close));
          const bot = yOf(Math.min(c.open, c.close));
          const bodyH = Math.max(Math.abs(bot - top), 2.5);
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={yOf(c.high)} y2={yOf(c.low)} stroke={color} strokeWidth="1.2" />
              <rect x={x - 5} y={top} width="10" height={bodyH} fill={color} rx="1" />
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 bg-[#0c1322] px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="font-bold tracking-tight text-lg text-cyan-400 font-mono">
            Z◈ ZUPIRUS QUANT LAB
          </div>
          <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-mono text-slate-300">
            v0.2.0 · TimescaleDB + Redis + LangSmith + Vercel AI SDK 6
          </span>
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded bg-emerald-950/70 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            DEMO & REPLAY ONLY · REAL LOCKED
          </span>
        </div>

        <nav className="flex flex-wrap gap-1.5 text-xs">
          {(
            [
              ['overview', 'Tổng Quan'],
              ['accounts', `Tài Khoản & EA (${accounts.length})`],
              ['orders', `Nhật Ký Lệnh (${orders.length})`],
              ['assistant', 'Trợ Lý AI (Vercel SDK 6)'],
              ['admin_approvals', 'Admin Phê Duyệt & Lab'],
              ['monitor', 'Giám Sát & Tracing'],
            ] as Array<[TabKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === key
                  ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">
        {notice && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-xs text-amber-200 font-mono flex items-center justify-between">
            <span>▣ {notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-amber-400 hover:text-amber-200 font-bold ml-4"
            >
              ✕
            </button>
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Safety & Architecture Banner */}
            <div className="rounded-xl border border-slate-800 bg-gradient-to-r from-[#0c1624] to-[#0c1322] p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-semibold">
                    QUANT WORKSPACE 01 · SYSTEMATIC EXECUTION
                  </span>
                  {dashboard.health?.halted === '1' && (
                    <span className="rounded bg-rose-950 border border-rose-500 px-2 py-0.5 text-[10px] font-mono text-rose-300 font-bold">
                      SYSTEM HALTED
                    </span>
                  )}
                </div>
                <h1 className="text-lg font-bold text-slate-100">
                  Một góc nhìn. Toàn bộ danh mục định lượng XAUUSD.
                </h1>
                <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
                  Real bị khóa cứng ở cả Backend và EA. Dữ liệu chuỗi thời gian lưu trên PostgreSQL + TimescaleDB
                  (Hypertables), phân phối tín hiệu qua Redis Streams/PubSub kèm Khóa phân tán (Distributed Lock),
                  và phê duyệt chiến lược qua Vercel AI SDK 6 ToolLoopAgent.
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleCreateReplay}
                  className="rounded-lg bg-cyan-500 hover:bg-cyan-400 px-4 py-2 text-xs font-bold text-slate-950 transition-colors"
                >
                  + Tạo Tài Khoản Replay
                </button>
                <button
                  type="button"
                  onClick={() => {
                    loadDashboard();
                    loadCandles(timeframe);
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-900 hover:border-cyan-500/50 px-3 py-2 text-xs text-slate-200 font-mono transition-colors"
                >
                  ↻ Cập Nhật
                </button>
              </div>
            </div>

            {/* 4 KPI Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-slate-800 bg-[#0c1322] p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Tổng Balance</span>
                  <span className="text-cyan-400 font-mono">↗</span>
                </div>
                <div className="text-2xl font-bold font-mono text-slate-100 my-1.5">
                  ${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-[11px] text-slate-500 font-mono">TimescaleDB snapshot / Postgres</div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0c1322] p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Tổng Equity</span>
                  <span className="text-emerald-400 font-mono">●</span>
                </div>
                <div className="text-2xl font-bold font-mono text-cyan-300 my-1.5">
                  ${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-[11px] text-slate-500 font-mono">Vốn thả nổi cập nhật thời gian thực</div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0c1322] p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Copy Đang Bật</span>
                  <span className="text-cyan-400 font-mono">⌁</span>
                </div>
                <div className="text-2xl font-bold font-mono text-slate-100 my-1.5">
                  {activeCopyCount} / {accounts.length}
                </div>
                <div className="text-[11px] text-slate-500 font-mono">Redis Stream & Heartbeat Cache</div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0c1322] p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Chờ Đối Soát</span>
                  <span className="text-amber-400 font-mono">⇄</span>
                </div>
                <div className="text-2xl font-bold font-mono text-slate-100 my-1.5">{pendingReconcile}</div>
                <div className="text-[11px] text-slate-500 font-mono">Distributed Lock chống gửi trùng</div>
              </div>
            </div>

            {/* Chart + Execution Pipeline */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <article className="lg:col-span-2 rounded-xl border border-slate-800 bg-[#0c1322] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider">
                      PORTFOLIO & TIMESCALEDB TELEMETRY
                    </div>
                    <h2 className="text-base font-bold text-slate-100">
                      {chartMode === 'equity' ? 'Biểu Đồ Equity & Balance' : `Nến XAUUSD (${timeframe}) — TimescaleDB`}
                    </h2>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-[11px] font-mono">
                      <button
                        type="button"
                        onClick={() => setChartMode('equity')}
                        className={`px-2.5 py-1 rounded-md ${
                          chartMode === 'equity' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400'
                        }`}
                      >
                        Equity
                      </button>
                      <button
                        type="button"
                        onClick={() => setChartMode('candles')}
                        className={`px-2.5 py-1 rounded-md ${
                          chartMode === 'candles' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400'
                        }`}
                      >
                        Nến XAUUSD
                      </button>
                    </div>

                    {chartMode === 'equity' ? (
                      <select
                        aria-label="Chọn tài khoản biểu đồ"
                        value={selectedAccount}
                        onChange={(e) => setSelectedAccount(e.target.value)}
                        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-mono text-slate-200"
                      >
                        {accounts.map((a: any) => (
                          <option key={a.id} value={a.id}>
                            {a.mode} · #{a.login} ({a.server})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        aria-label="Chọn khung thời gian TimescaleDB"
                        value={timeframe}
                        onChange={(e) => {
                          const tf = e.target.value as any;
                          setTimeframe(tf);
                          loadCandles(tf);
                        }}
                        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-mono text-slate-200"
                      >
                        {(['M1', 'M5', 'M15', 'H1', 'D1'] as const).map((tf) => (
                          <option key={tf} value={tf}>
                            Khung {tf}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                  {chartMode === 'equity' ? (
                    <div className="flex items-center gap-4">
                      <span className="text-cyan-400">● Equity</span>
                      <span className="text-slate-400">--- Balance</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <span className="text-emerald-400">▮ Nến Tăng</span>
                      <span className="text-rose-400">▮ Nến Giảm</span>
                    </div>
                  )}
                  <span>
                    Giá XAUUSD tham chiếu: <b className="text-slate-200">${dashboard.health?.replay_price || '2655.20'}</b>
                  </span>
                </div>

                <div className="rounded-lg bg-[#080d19] border border-slate-800/80 p-3">
                  {chartMode === 'equity' ? renderEquitySvg() : renderCandlesSvg()}
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 border-t border-slate-800/80 pt-2.5">
                  <span>Quan sát theo thời gian thực • Đơn vị USD</span>
                  <span>
                    Nguồn:{' '}
                    {accounts.find((a: any) => a.id === selectedAccount)?.mode === 'REPLAY'
                      ? 'SYNTHETIC REPLAY (900 bars)'
                      : 'MT5 DEMO · TimescaleDB Hypertable'}
                  </span>
                </div>
              </article>

              {/* Execution Pipeline */}
              <article className="rounded-xl border border-slate-800 bg-[#0c1322] p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div>
                    <div className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider">
                      EXECUTION PIPELINE
                    </div>
                    <h2 className="text-base font-bold text-slate-100">Từ dữ liệu tới thực thi</h2>
                  </div>

                  <ol className="space-y-3.5 text-xs">
                    <li className="flex items-center justify-between rounded-lg bg-slate-900/70 border border-slate-800/80 p-3">
                      <div className="flex items-center gap-3">
                        <span className="h-7 w-7 rounded-full border border-cyan-500/40 bg-cyan-950/50 text-cyan-300 font-mono text-[11px] flex items-center justify-center font-bold">
                          01
                        </span>
                        <div>
                          <div className="font-semibold text-slate-200">Price Engine & TimescaleDB</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            Online · Hypertable quotes & candles
                          </div>
                        </div>
                      </div>
                      <span className="text-emerald-400 text-xs">●</span>
                    </li>

                    <li className="flex items-center justify-between rounded-lg bg-slate-900/70 border border-slate-800/80 p-3">
                      <div className="flex items-center gap-3">
                        <span className="h-7 w-7 rounded-full border border-cyan-500/40 bg-cyan-950/50 text-cyan-300 font-mono text-[11px] flex items-center justify-center font-bold">
                          02
                        </span>
                        <div>
                          <div className="font-semibold text-slate-200">Risk Gates (2 Lớp)</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            Spread, DD, News USD, Margin & TTL
                          </div>
                        </div>
                      </div>
                      <span className="text-emerald-400 text-xs">●</span>
                    </li>

                    <li className="flex items-center justify-between rounded-lg bg-slate-900/70 border border-slate-800/80 p-3">
                      <div className="flex items-center gap-3">
                        <span className="h-7 w-7 rounded-full border border-cyan-500/40 bg-cyan-950/50 text-cyan-300 font-mono text-[11px] flex items-center justify-center font-bold">
                          03
                        </span>
                        <div>
                          <div className="font-semibold text-slate-200">Redis Stream & Lock</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            SET NX PX · SEND_ONCE / RECONCILE
                          </div>
                        </div>
                      </div>
                      <span className="text-emerald-400 text-xs">●</span>
                    </li>

                    <li className="flex items-center justify-between rounded-lg bg-slate-900/70 border border-slate-800/80 p-3">
                      <div className="flex items-center gap-3">
                        <span className="h-7 w-7 rounded-full border border-cyan-500/40 bg-cyan-950/50 text-cyan-300 font-mono text-[11px] flex items-center justify-center font-bold">
                          04
                        </span>
                        <div>
                          <div className="font-semibold text-slate-200">LangGraph WFO + LangSmith</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            Checkpoint bền vững · Admin duyệt
                          </div>
                        </div>
                      </div>
                      <span className="text-emerald-400 text-xs">●</span>
                    </li>
                  </ol>
                </div>

                <div className="text-[11px] text-slate-500 font-mono border-t border-slate-800 pt-3">
                  Execution hoạt động độc lập, không phụ thuộc vào trạng thái của AI hay LangGraph.
                </div>
              </article>
            </div>

            {/* Strategy Approval Queue Preview */}
            <AdminApprovalQueue />
          </div>
        )}

        {activeTab === 'accounts' && (
          <div className="space-y-6">
            <article className="rounded-xl border border-slate-800 bg-[#0c1322] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-100">Kết Nối Tài Khoản MT5 Demo & Replay</h2>
                  <p className="text-xs text-slate-400">
                    Tên Broker Server phải khớp chính xác với terminal MT5. Mã ghép nối EA có hiệu lực một lần trong 5 phút.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCreateReplay}
                  className="rounded-lg border border-cyan-500/50 bg-cyan-950/40 hover:bg-cyan-900/50 px-3.5 py-2 text-xs font-mono font-semibold text-cyan-300 transition-colors"
                >
                  + Thêm Tài Khoản Replay
                </button>
              </div>

              <form onSubmit={handleCreateDemo} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end pt-1">
                <label className="block text-xs text-slate-300 font-mono">
                  MT5 Login (Chỉ số)
                  <input
                    type="text"
                    required
                    pattern="[0-9]+"
                    value={newDemoLogin}
                    onChange={(e) => setNewDemoLogin(e.target.value)}
                    placeholder="Ví dụ: 50918274"
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-400"
                  />
                </label>
                <label className="block text-xs text-slate-300 font-mono">
                  Broker Server
                  <input
                    type="text"
                    required
                    value={newDemoServer}
                    onChange={(e) => setNewDemoServer(e.target.value)}
                    placeholder="ICMarketsSC-Demo"
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-400"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-lg bg-cyan-500 hover:bg-cyan-400 px-4 py-2 text-xs font-bold text-slate-950 transition-colors h-[34px]"
                >
                  Thêm MT5 Demo ↗
                </button>
              </form>
            </article>

            <div className="space-y-4">
              {accounts.map((acc: any) => (
                <article
                  key={acc.id}
                  className="rounded-xl border border-slate-800 bg-[#0c1322] p-5 space-y-4 shadow-md"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-bold font-mono text-slate-100">#{acc.login}</h3>
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-cyan-300 font-semibold">
                          {acc.mode}
                        </span>
                        {acc.cached_heartbeat && (
                          <span className="rounded bg-emerald-950/70 border border-emerald-600/40 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
                            Redis Heartbeat Cache: OK
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 font-mono mt-1">
                        {acc.server} · Balance:{' '}
                        <b className="text-slate-200">${Number(acc.balance).toLocaleString()}</b> · Equity:{' '}
                        <b className="text-cyan-300">${Number(acc.equity).toLocaleString()}</b> · Vị thế mở:{' '}
                        <b className="text-slate-200">{acc.positions}</b>
                      </div>
                    </div>

                    <span
                      className={`rounded-md px-2.5 py-1 text-[11px] font-mono font-bold uppercase ${
                        acc.enabled
                          ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40'
                          : 'bg-amber-950/80 text-amber-300 border border-amber-500/40'
                      }`}
                    >
                      {acc.enabled ? 'COPY ON' : 'PAUSED'}
                    </span>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveRisk(acc, new FormData(e.currentTarget));
                    }}
                    className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end font-mono text-xs"
                  >
                    <label className="block text-slate-400">
                      Rủi ro / lệnh (%)
                      <input
                        name="risk"
                        type="number"
                        min="0.01"
                        max="1"
                        step="0.01"
                        defaultValue={acc.risk}
                        required
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100"
                      />
                    </label>
                    <label className="block text-slate-400">
                      Spread tối đa ($/oz)
                      <input
                        name="max_spread"
                        type="number"
                        min="0.01"
                        max="2"
                        step="0.01"
                        defaultValue={acc.max_spread}
                        required
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100"
                      />
                    </label>
                    <label className="block text-slate-400">
                      Số lệnh tối đa
                      <input
                        name="max_positions"
                        type="number"
                        min="1"
                        max="3"
                        defaultValue={acc.max_positions}
                        required
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100"
                      />
                    </label>
                    <label className="block text-slate-400">
                      Drawdown tối đa (%)
                      <input
                        name="max_dd"
                        type="number"
                        min="1"
                        max="20"
                        step="0.1"
                        defaultValue={acc.max_dd}
                        required
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded-lg border border-slate-700 bg-slate-800 hover:border-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors h-[34px]"
                    >
                      Lưu Giới Hạn
                    </button>
                  </form>

                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => handleToggleCopy(acc)}
                      className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-colors ${
                        acc.enabled
                          ? 'bg-amber-500/20 border border-amber-500/50 text-amber-300 hover:bg-amber-500/30'
                          : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                      }`}
                    >
                      {acc.enabled ? 'Tạm Dừng Copy' : 'Bật Copy Ngay'}
                    </button>

                    {acc.mode === 'DEMO' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handlePairCode(acc.id)}
                          className="rounded-lg border border-slate-700 bg-slate-900 hover:border-cyan-400 px-3.5 py-1.5 text-xs font-mono text-slate-200 transition-colors"
                        >
                          Lấy Mã Ghép Nối EA
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRevoke(acc.id, acc.login)}
                          className="rounded-lg border border-rose-700/50 bg-rose-950/30 hover:bg-rose-900/40 px-3.5 py-1.5 text-xs font-mono text-rose-300 transition-colors"
                        >
                          Thu Hồi EA
                        </button>
                      </>
                    )}
                  </div>

                  {pairCodes[acc.id] && (
                    <div className="rounded-lg border border-cyan-500/40 bg-cyan-950/30 p-3 font-mono text-xs text-cyan-300">
                      🔑 Mã ghép nối dùng một lần (hết hạn sau 5 phút): <b className="text-white">{pairCodes[acc.id]}</b>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'orders' && (
          <article className="rounded-xl border border-slate-800 bg-[#0c1322] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-100">Nhật Ký Thực Thi & Đối Soát Lệnh</h2>
                <p className="text-xs text-slate-400">
                  UNKNOWN: chờ EA đối soát lịch sử broker, tuyệt đối không gửi lại. FILLED: đã xác nhận đủ Order Ticket & Deal.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400">100 lệnh gần nhất</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase">
                    <th className="py-3 px-2.5">ID / Nguồn</th>
                    <th className="py-3 px-2.5">Chiều</th>
                    <th className="py-3 px-2.5">Giá Tín Hiệu</th>
                    <th className="py-3 px-2.5">Trạng Thái</th>
                    <th className="py-3 px-2.5">Order Ticket / Deal</th>
                    <th className="py-3 px-2.5">Thời Điểm</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {orders.map((o: any) => (
                    <tr key={o.id} className="hover:bg-slate-900/40">
                      <td className="py-3 px-2.5">
                        <span className="text-slate-200 font-semibold">#{o.id}</span>{' '}
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-cyan-300 ml-1">
                          {o.source}
                        </span>
                      </td>
                      <td className="py-3 px-2.5">
                        <span className={o.side === 'BUY' ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                          {o.side}
                        </span>
                      </td>
                      <td className="py-3 px-2.5 text-slate-200">${Number(o.price).toFixed(2)}</td>
                      <td className="py-3 px-2.5">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] uppercase font-bold ${
                            o.state === 'filled'
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/40'
                              : 'bg-amber-950/80 text-amber-300 border border-amber-600/40'
                          }`}
                        >
                          {o.state}
                        </span>
                      </td>
                      <td className="py-3 px-2.5 text-slate-300">
                        {o.ticket || '—'} / {o.deal || '—'}
                      </td>
                      <td className="py-3 px-2.5 text-slate-400">
                        {o.created ? new Date(o.created * 1000).toLocaleString('vi-VN') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        )}

        {activeTab === 'assistant' && (
          <div className="space-y-4">
            <CustomerAssistant />
          </div>
        )}

        {activeTab === 'admin_approvals' && (
          <div className="space-y-6">
            <AdminApprovalQueue />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Economic Calendar Filter */}
              <article className="rounded-xl border border-slate-800 bg-[#0c1322] p-5 space-y-4">
                <div>
                  <div className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider">
                    DETERMINISTIC NEWS GATE
                  </div>
                  <h3 className="text-base font-bold text-slate-100">Bộ Lọc Lịch Kinh Tế (USD · High)</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Sự kiện USD/ALL tác động cao tự động khóa phát lệnh Demo mới trong khung ±15 phút.
                  </p>
                </div>

                <form onSubmit={handleAddNews} className="space-y-3 font-mono text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      required
                      value={newsTitle}
                      onChange={(e) => setNewsTitle(e.target.value)}
                      placeholder="Tên sự kiện (VD: US CPI, FOMC)"
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
                    />
                    <input
                      type="datetime-local"
                      value={newsWhen}
                      onChange={(e) => setNewsWhen(e.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-lg bg-cyan-500 hover:bg-cyan-400 px-4 py-2 text-xs font-bold text-slate-950 transition-colors"
                  >
                    + Thêm Lịch USD · High Impact
                  </button>
                </form>

                <div className="space-y-1.5 pt-2">
                  {(monitorData.news || []).map((n: any) => (
                    <div
                      key={n.id}
                      className="flex items-center justify-between rounded-lg bg-slate-900/70 border border-slate-800 px-3 py-2 text-xs font-mono"
                    >
                      <span className="text-slate-200 font-semibold">{n.title}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-[11px]">
                          {n.ts ? new Date(n.ts * 1000).toLocaleString('vi-VN') : ''}
                        </span>
                        <span className="rounded bg-amber-950 border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300 uppercase">
                          {n.impact}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              {/* Vision Incident Review */}
              <article className="rounded-xl border border-slate-800 bg-[#0c1322] p-5 space-y-4">
                <div>
                  <div className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider">
                    VISION INCIDENT REVIEW
                  </div>
                  <h3 className="text-base font-bold text-slate-100">Đọc & Chẩn Đoán Biểu Đồ Sự Cố</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Phân tích ảnh chụp biểu đồ XAUUSD M15 (PNG/JPEG) và ghi vết trực tiếp vào LangSmith Tracing.
                  </p>
                </div>

                <form onSubmit={handleVisionSubmit} className="space-y-3 text-xs font-mono">
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-300 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={visionLoading}
                    className="rounded-lg border border-cyan-500/50 bg-cyan-950/40 hover:bg-cyan-900/50 px-4 py-2 text-xs font-semibold text-cyan-300 transition-colors disabled:opacity-50"
                  >
                    {visionLoading ? 'Đang phân tích bằng Vision AI...' : 'Phân Tích Biểu Đồ Sự Cố ↗'}
                  </button>
                </form>

                {visionResult && (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 text-xs text-slate-300 leading-relaxed font-mono">
                    {visionResult}
                  </div>
                )}
              </article>
            </div>
          </div>
        )}

        {activeTab === 'monitor' && (
          <div className="space-y-6">
            {/* System Safety Switch */}
            <article className="rounded-xl border border-slate-800 bg-[#0c1322] p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[10px] font-mono text-amber-400 uppercase tracking-wider">
                  EMERGENCY CIRCUIT BREAKER
                </div>
                <h2 className="text-base font-bold text-slate-100">System Safety Switch (Khóa Khẩn Cấp Toàn Hệ Thống)</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Dừng ngay lập tức mọi lệnh mới trên toàn hệ thống. Không tự động đóng vị thế đang mở; các intent đang chờ vẫn được đối soát an toàn.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleSystemSafety(true)}
                  className="rounded-lg border border-rose-600/60 bg-rose-950/60 hover:bg-rose-900/60 px-4 py-2 text-xs font-bold text-rose-200 transition-colors"
                >
                  ■ Dừng Toàn Hệ Thống
                </button>
                <button
                  type="button"
                  onClick={() => handleSystemSafety(false)}
                  className="rounded-lg bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-bold text-slate-950 transition-colors"
                >
                  ▶ Gỡ Khóa Hệ Thống
                </button>
              </div>
            </article>

            {/* Readiness Probe & 4 Core Technologies Status */}
            {readyData && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-xs">
                <div className="rounded-xl border border-slate-800 bg-[#0c1322] p-4 space-y-1.5">
                  <div className="text-[10px] text-slate-400">POSTGRESQL + TIMESCALEDB</div>
                  <div className="text-sm font-bold text-emerald-400">
                    ● {readyData.database?.engine?.toUpperCase()} ({readyData.status?.toUpperCase()})
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Hypertables: {(readyData.timescaledb?.hypertables || []).map((h: any) => h.table).join(', ')}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-[#0c1322] p-4 space-y-1.5">
                  <div className="text-[10px] text-slate-400">REDIS STREAMS & LOCK</div>
                  <div className="text-sm font-bold text-emerald-400">
                    ● {readyData.redis?.connected ? 'CONNECTED (stream:signals)' : 'FALLBACK'}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Worker Heartbeat: {readyData.execution_worker?.heartbeat_active ? 'Active (<60s)' : 'Idle'}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-[#0c1322] p-4 space-y-1.5">
                  <div className="text-[10px] text-slate-400">LANGSMITH TELEMETRY</div>
                  <div className="text-sm font-bold text-cyan-400">
                    ● Project: {tracingData.project}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Tổng số vết (Traces): {tracingData.total_traces_recorded} runs
                  </div>
                </div>
              </div>
            )}

            {/* LangSmith Recent Traces */}
            <article className="rounded-xl border border-slate-800 bg-[#0c1322] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100 font-mono">
                  LangSmith Tracing Telemetry (Sanitized Inputs/Outputs)
                </h3>
                <span className="text-xs font-mono text-cyan-400">
                  {tracingData.recent_traces?.length || 0} traces gần nhất
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse font-mono text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase">
                      <th className="py-2.5 px-2">Run Name</th>
                      <th className="py-2.5 px-2">Loại</th>
                      <th className="py-2.5 px-2">Độ Trễ</th>
                      <th className="py-2.5 px-2">Tokens</th>
                      <th className="py-2.5 px-2">Tóm Tắt Output</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {(tracingData.recent_traces || []).map((t: any) => (
                      <tr key={t.id} className="hover:bg-slate-900/40">
                        <td className="py-2.5 px-2 text-cyan-300 font-semibold">{t.name}</td>
                        <td className="py-2.5 px-2 text-slate-400">{t.run_type}</td>
                        <td className="py-2.5 px-2 text-emerald-400">{t.latency_ms} ms</td>
                        <td className="py-2.5 px-2 text-slate-300">{t.tokens?.total_tokens || 0} tok</td>
                        <td className="py-2.5 px-2 text-slate-400 truncate max-w-xs">
                          {JSON.stringify(t.outputs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            {/* Audit Trail */}
            <article className="rounded-xl border border-slate-800 bg-[#0c1322] p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-100 font-mono">Audit Trail (Nhật Ký Kiểm Toán Bất Biến)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse font-mono text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase">
                      <th className="py-2.5 px-2">Thời Điểm</th>
                      <th className="py-2.5 px-2">Actor</th>
                      <th className="py-2.5 px-2">Sự Kiện</th>
                      <th className="py-2.5 px-2">Chi Tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {(monitorData.audit || []).map((a: any) => (
                      <tr key={a.id} className="hover:bg-slate-900/40">
                        <td className="py-2.5 px-2 text-slate-400">
                          {a.ts ? new Date(a.ts * 1000).toLocaleString('vi-VN') : ''}
                        </td>
                        <td className="py-2.5 px-2 text-slate-300">{a.actor}</td>
                        <td className="py-2.5 px-2 text-cyan-300 font-semibold">{a.event}</td>
                        <td className="py-2.5 px-2 text-slate-400">{a.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-900 py-3 text-center text-[11px] text-slate-500 font-mono">
        ZUPIRUS QUANT LAB · SYSTEMATIC THINKING · MEASURED EXECUTION
      </footer>
    </div>
  );
};
