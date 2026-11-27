import React, { useState } from 'react';
import { api } from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { Panel } from '../ui/Primitives';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Play,
  RefreshCw,
  Sparkles,
  TrendingDown,
  UploadCloud,
} from 'lucide-react';

export const AdminQuantLabPanel: React.FC<{ setMsg: (m: string) => void }> = ({ setMsg }) => {
  const { lang } = useLanguage();
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState('M15');
  const [strategyName, setStrategyName] = useState('breakout_retest');
  const [costR, setCostR] = useState('0.025');
  const [titleVi, setTitleVi] = useState('Nghiên cứu Định Lượng Breakout & Retest XAU/USD M15');
  const [titleEn, setTitleEn] = useState('XAU/USD M15 Breakout & Retest Quantitative Study');
  const [priceUsd, setPriceUsd] = useState('32.0');

  const [loading, setLoading] = useState(false);
  const [syncingFeed, setSyncingFeed] = useState(false);
  const [triggeringAutonomous, setTriggeringAutonomous] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [parsedData, setParsedData] = useState<any>(null);
  const [studyResult, setStudyResult] = useState<any>(null);
  const [activeJob, setActiveJob] = useState<{ id: string; status: string; message: string; startedAt?: number } | null>(null);

  const handleTriggerAutonomous = async () => {
    const jobId = `job_quant_${Date.now()}`;
    setActiveJob({ id: jobId, status: 'RUNNING', message: 'Đang chạy pipeline nghiên cứu định lượng tự động và chuẩn bị bản nháp...', startedAt: Date.now() });
    setTriggeringAutonomous(true);
    setMsg('');
    try {
      const res: any = await api.post('/api/v1/admin/quant/autonomous/trigger', { force: false });
      if (res?.summary) {
        const draftId = res.summary.draft_report_id || 'N/A';
        setActiveJob({ id: jobId, status: 'COMPLETED', message: `Hoàn tất nghiên cứu: Tạo bản nháp #${draftId} thành công (Chờ Admin duyệt phát hành).` });
        setMsg(`Chu kỳ nghiên cứu hoàn tất: Đã kiểm định ${res.summary.total_candidates} chiến lược, tạo bản nháp #${draftId} lưu vào hàng đợi chờ Admin phê duyệt.`);
      } else {
        setActiveJob({ id: jobId, status: 'COMPLETED', message: 'Pipeline nghiên cứu đã hoàn tất thành công.' });
        setMsg('Đã hoàn thành chu kỳ nghiên cứu định lượng (Chờ Admin duyệt phát hành).');
      }
    } catch (err: any) {
      setActiveJob({ id: jobId, status: 'FAILED', message: err?.message || 'Tiến trình nghiên cứu gặp lỗi.' });
      setMsg(err?.message || 'Lỗi khi kích hoạt tiến trình nghiên cứu.');
    } finally {
      setTriggeringAutonomous(false);
    }
  };

  const handleLiveFeedSync = async () => {
    setSyncingFeed(true);
    setMsg('');
    try {
      const res: any = await api.post('/api/v1/admin/quant/data/sync', {
        symbol,
        timeframe,
        range_str: '5d',
      });
      if (res?.data?.candles && res.data.candles.length > 0) {
        setParsedData(res.data);
        setMsg(`Đồng bộ thành công ${res.data.total_candles} nến thực tế ${symbol} (${timeframe}) từ thị trường!`);
      } else {
        setMsg('Đã kích hoạt đồng bộ dữ liệu thị trường.');
      }
    } catch (err: any) {
      setMsg(err?.message || 'Lỗi đồng bộ nến từ thị trường.');
    } finally {
      setSyncingFeed(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvText(text || '');
      setMsg(`Đã nạp tệp "${file.name}" (${(file.size / 1024).toFixed(1)} KB).`);
    };
    reader.readAsText(file);
  };

  const loadSampleData = () => {
    const baseTs = 1704067200; // 2024-01-01 00:00 UTC
    let curPrice = 2062.5;
    const rows = ['Date,Time,Open,High,Low,Close,Volume'];
    for (let i = 0; i < 200; i++) {
      const ts = baseTs + i * 900;
      const d = new Date(ts * 1000);
      const dateStr = d.toISOString().split('T')[0].replace(/-/g, '.');
      const timeStr = d.toISOString().split('T')[1].substring(0, 5);
      const change = (Math.sin(i * 0.25) * 1.5 + (Math.random() - 0.48) * 2.2);
      const open = curPrice;
      const close = curPrice + change;
      const high = Math.max(open, close) + Math.random() * 1.2;
      const low = Math.min(open, close) - Math.random() * 1.2;
      const vol = Math.floor(150 + Math.random() * 300);
      rows.push(`${dateStr},${timeStr},${open.toFixed(2)},${high.toFixed(2)},${low.toFixed(2)},${close.toFixed(2)},${vol}`);
      curPrice = close;
    }
    setCsvText(rows.join('\n'));
    setFileName('sample_xauusd_m15_200bars.csv');
    setMsg('Đã nạp 200 nến mẫu XAU/USD M15 để thử nghiệm.');
  };

  const handleParseCsv = async () => {
    if (!csvText.trim()) {
      setMsg('Vui lòng chọn tệp CSV hoặc dán nội dung nến vào ô dữ liệu.');
      return;
    }
    setLoading(true);
    setMsg('');
    try {
      const res: any = await api.post('/api/v1/admin/quant/lab/upload-csv', {
        csv_text: csvText,
        symbol,
        timeframe,
        source: 'CSV_UPLOAD',
        save_to_db: false,
      });
      setParsedData(res);
      setMsg(`Phân tích thành công: ${res.total_candles} nến hợp lệ (${res.start_datetime} -> ${res.end_datetime}).`);
    } catch (err: any) {
      setMsg(err?.message || 'Lỗi phân tích cú pháp CSV.');
    } finally {
      setLoading(false);
    }
  };

  const handleRunStudy = async () => {
    const candles = parsedData?.candles;
    if (!candles || candles.length < 2) {
      setMsg('Vui lòng bấm "Phân tích CSV" hoặc "Đồng bộ nến thị trường" trước khi chạy nghiên cứu định lượng.');
      return;
    }
    setLoading(true);
    setMsg('');
    try {
      const res: any = await api.post('/api/v1/admin/quant/lab/run', {
        symbol,
        timeframe,
        strategy_name: strategyName,
        round_trip_cost_r: Number(costR) || 0.0,
        candles,
      });
      setStudyResult(res);
      setMsg('Đã hoàn thành phân tích định lượng toàn diện, Monte Carlo và ma trận chi phí.');
    } catch (err: any) {
      setMsg(err?.message || 'Lỗi thực thi nghiên cứu định lượng.');
    } finally {
      setLoading(false);
    }
  };

  const handleExportDraft = async () => {
    const candles = parsedData?.candles;
    if (!candles || candles.length < 2) {
      setMsg('Chưa có dữ liệu nến để xuất bản.');
      return;
    }
    setExporting(true);
    try {
      const res: any = await api.post('/api/v1/admin/quant/studies', {
        symbol,
        timeframe,
        strategy_name: strategyName,
        title_vi: titleVi,
        title_en: titleEn,
        price_usd: Number(priceUsd) || 32.0,
        round_trip_cost_r: Number(costR) || 0.0,
        candles,
      });
      setMsg(`Đã tạo bản nháp báo cáo thành công! Mã: ${res?.id || ''}. Báo cáo đã tự sinh đầy đủ PDF song ngữ.`);
    } catch (err: any) {
      setMsg(err?.message || 'Lỗi xuất bản bản nháp PDF.');
    } finally {
      setExporting(false);
    }
  };

  const s = studyResult?.summary;
  const equitySeries: any[] = s?.equity_series || [];
  const drawdownSeries: any[] = s?.drawdown_series || [];
  const costMatrix = s?.cost_stress_matrix;
  const mc = s?.monte_carlo_risk;

  return (
    <div className="space-y-6">
      {/* ACTIVE JOB BANNER */}
      {activeJob && (
        <div className={`rounded-xl border p-4 space-y-1 text-xs font-mono transition ${
          activeJob.status === 'RUNNING'
            ? 'border-cyan-500/40 bg-cyan-950/20 text-cyan-200'
            : activeJob.status === 'COMPLETED'
            ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200'
            : 'border-rose-500/40 bg-rose-950/20 text-rose-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">
              {activeJob.status === 'RUNNING' && <RefreshCw className="h-4 w-4 animate-spin text-cyan-400" />}
              {activeJob.status === 'COMPLETED' && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
              <span>TIẾN TRÌNH NGHIÊN CỨU: {activeJob.id}</span>
            </div>
            <span className="font-bold uppercase tracking-wider">{activeJob.status}</span>
          </div>
          <p className="text-[11px] text-slate-300 m-0">{activeJob.message}</p>
        </div>
      )}

      {/* DATASET IDENTITY BANNER (When data parsed) */}
      {parsedData?.dataset_identity && (
        <div className="rounded-xl border border-slate-800 bg-[#060A13] p-4 text-xs font-mono space-y-2">
          <div className="text-cyan-400 font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-[#12B5A6]" />
            <span>ĐỊNH DANH BỘ DỮ LIỆU NGHIÊN CỨU (DATASET PROVENANCE)</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-[11px] text-slate-300">
            <div>Tài sản / Công cụ: <strong className="text-white">{parsedData.dataset_identity.canonical_symbol} ({parsedData.dataset_identity.instrument_type})</strong></div>
            <div>Nguồn gốc: <strong className="text-cyan-300">{parsedData.dataset_identity.source_provenance}</strong></div>
            <div>Múi giờ: <strong className="text-amber-300">{parsedData.dataset_identity.timezone_utc}</strong></div>
            <div>Chi phí giả định: <strong className="text-emerald-300">{parsedData.dataset_identity.friction_assumed_pips} pips</strong></div>
          </div>
          <div className="text-[10px] text-slate-500 truncate">
            SHA-256: <span className="text-slate-400">{parsedData.dataset_identity.data_sha256}</span> · Mã phiên bản: <span className="text-slate-400">{parsedData.dataset_identity.data_version_id}</span>
          </div>
        </div>
      )}

      {/* SECTION 1: CSV DATA INGESTION & PARAMETERS */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          icon={<FileSpreadsheet className="h-4 w-4 text-cyan-400" />}
          title={lang === 'en' ? 'CSV Data Ingestion & Parser' : 'Nạp & Phân Tích Dữ Liệu Nến CSV'}
          subtitle={lang === 'en' ? 'Supports MetaTrader 4/5, TradingView, and Dukascopy OHLCV exports' : 'Hỗ trợ xuất file nến từ MT4/MT5, TradingView và Dukascopy'}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-xs font-semibold text-cyan-300 cursor-pointer transition">
                <UploadCloud className="h-4 w-4" />
                <span>{fileName ? `Đã chọn: ${fileName}` : (lang === 'en' ? 'Select CSV File' : 'Chọn tệp CSV từ máy')}</span>
                <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={syncingFeed}
                  onClick={handleLiveFeedSync}
                  className="quant-btn-secondary text-xs border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                >
                  <RefreshCw className={`h-3.5 w-3.5 text-emerald-400 ${syncingFeed ? 'animate-spin' : ''}`} />
                  <span>{syncingFeed ? 'Đang đồng bộ...' : (lang === 'en' ? 'Sync Live Feed' : 'Đồng bộ nến thị trường (Live)')}</span>
                </button>

                <button
                  type="button"
                  disabled={triggeringAutonomous}
                  onClick={handleTriggerAutonomous}
                  className="quant-btn-primary text-xs bg-indigo-600/80 hover:bg-indigo-600 text-white border-indigo-500/40 shadow-sm"
                  title="Chạy pipeline nghiên cứu tự động: thu thập dữ liệu, kiểm định và tạo bản nháp (Admin duyệt trước khi phát hành)"
                >
                  <Sparkles className={`h-3.5 w-3.5 text-amber-300 ${triggeringAutonomous ? 'animate-spin' : ''}`} />
                  <span>{triggeringAutonomous ? 'Đang chạy pipeline...' : (lang === 'en' ? 'Run Research Pipeline (Draft)' : 'Chạy pipeline nghiên cứu (Tạo bản nháp)')}</span>
                </button>

                <button
                  type="button"
                  onClick={loadSampleData}
                  className="quant-btn-secondary text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                  <span>{lang === 'en' ? 'Load Sample (200 Bars M15)' : 'Nạp mẫu test (200 nến M15)'}</span>
                </button>
              </div>
            </div>

            <div>
              <textarea
                rows={6}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder="Dán dữ liệu CSV tại đây (Date,Time,Open,High,Low,Close,Volume)..."
                className="quant-input font-mono text-xs"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-400 font-mono">
                {parsedData ? (
                  <span className="text-[#12B5A6] flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    Đã nạp {parsedData.total_candles} nến ({parsedData.start_datetime} - {parsedData.end_datetime})
                  </span>
                ) : (
                  <span>Chưa phân tích dữ liệu</span>
                )}
              </div>

              <button
                type="button"
                disabled={loading || !csvText.trim()}
                onClick={handleParseCsv}
                className="quant-btn-primary text-xs px-4"
              >
                <span>{loading ? 'Đang phân tích...' : (lang === 'en' ? 'Validate & Parse CSV' : '1. Kiểm tra & Phân tích CSV')}</span>
              </button>
            </div>
          </div>
        </Panel>

        {/* PARAMETERS PANEL */}
        <Panel
          icon={<Activity className="h-4 w-4 text-amber-300" />}
          title={lang === 'en' ? 'Study Parameters' : 'Tham Số Nghiên Cứu'}
          subtitle={lang === 'en' ? 'Configure friction and metadata' : 'Cấu hình chi phí khứ hồi và thông tin'}
        >
          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Cặp & Khung thời gian</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  className="quant-input font-mono text-xs"
                />
                <input
                  type="text"
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value.toUpperCase())}
                  className="quant-input font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Chi phí khứ hồi (R-cost)</label>
              <select
                value={costR}
                onChange={(e) => setCostR(e.target.value)}
                className="quant-input font-mono text-xs"
              >
                <option value="0.0">0.00R (Không ma sát / Thử nghiệm)</option>
                <option value="0.025">0.025R (Tương đương ECN ~1.0 pip)</option>
                <option value="0.05">0.050R (Tương đương Standard ~2.5 pips)</option>
                <option value="0.10">0.100R (Stress test khắc nghiệt ~5.0 pips)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Mô hình Định Lượng (Strategy)</label>
              <select
                value={strategyName}
                onChange={(e) => {
                  const val = e.target.value;
                  setStrategyName(val);
                  if (val === 'breakout_retest') {
                    setTitleVi('Nghiên cứu Định Lượng Breakout & Retest XAU/USD M15');
                    setTitleEn('XAU/USD M15 Breakout & Retest Quantitative Study');
                  } else if (val === 'asian_mean_reversion') {
                    setTitleVi('Nghiên cứu Định Lượng Asian Session Mean-Reversion XAU/USD');
                    setTitleEn('XAU/USD Asian Session Mean-Reversion Quantitative Study');
                  } else if (val === 'london_sweep') {
                    setTitleVi('Nghiên cứu Định Lượng London Liquidity Sweep XAU/USD');
                    setTitleEn('XAU/USD London Liquidity Sweep Quantitative Study');
                  }
                }}
                className="quant-input font-mono text-xs text-cyan-300 font-semibold"
              >
                <option value="breakout_retest">Breakout & Retest (London Break of Asia Range)</option>
                <option value="asian_mean_reversion">Asian Session Mean-Reversion (ATR Extreme Fade)</option>
                <option value="london_sweep">London Liquidity Sweep (Asia Range Purge & Reversal)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Tiêu đề (Tiếng Việt)</label>
              <input
                type="text"
                value={titleVi}
                onChange={(e) => setTitleVi(e.target.value)}
                className="quant-input text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Title (English)</label>
              <input
                type="text"
                value={titleEn}
                onChange={(e) => setTitleEn(e.target.value)}
                className="quant-input text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Giá bán dự kiến (USDT)</label>
              <input
                type="number"
                step="0.5"
                value={priceUsd}
                onChange={(e) => setPriceUsd(e.target.value)}
                className="quant-input font-mono text-xs text-emerald-300"
              />
            </div>

            <button
              type="button"
              disabled={loading || !parsedData}
              onClick={handleRunStudy}
              className="w-full quant-btn-primary text-xs py-2.5 justify-center mt-2"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>{loading ? 'Đang tính toán...' : (lang === 'en' ? '2. Run Quant Studies' : '2. Chạy Nghiên Cứu Định Lượng')}</span>
            </button>
          </div>
        </Panel>
      </div>

      {/* SECTION 2: STUDY RESULTS & VISUALIZATIONS */}
      {studyResult && (
        <div className="space-y-6">
          {/* TOP KPI CARDS */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="rounded-xl border border-slate-800 bg-[#0B1220] p-3">
              <div className="text-[11px] text-slate-400">Số Lệnh (Trades)</div>
              <div className="text-lg font-bold text-white font-mono">{s?.trades_count ?? '-'}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0B1220] p-3">
              <div className="text-[11px] text-slate-400">Win Rate</div>
              <div className="text-lg font-bold text-[#12B5A6] font-mono">
                {s?.win_rate !== undefined ? `${(s.win_rate * 100).toFixed(1)}%` : '-'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0B1220] p-3">
              <div className="text-[11px] text-slate-400">Profit Factor</div>
              <div className="text-lg font-bold text-amber-300 font-mono">
                {s?.profit_factor !== undefined ? Number(s.profit_factor).toFixed(2) : '-'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0B1220] p-3">
              <div className="text-[11px] text-slate-400">Max Drawdown</div>
              <div className="text-lg font-bold text-rose-300 font-mono">
                {s?.max_drawdown_r !== undefined ? `-${Number(s.max_drawdown_r).toFixed(2)}R` : '-'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0B1220] p-3">
              <div className="text-[11px] text-slate-400">Sharpe Ratio</div>
              <div className="text-lg font-bold text-cyan-300 font-mono">
                {s?.sharpe_ratio !== undefined ? Number(s.sharpe_ratio).toFixed(2) : '-'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0B1220] p-3">
              <div className="text-[11px] text-slate-400">Sortino Ratio</div>
              <div className="text-lg font-bold text-emerald-300 font-mono">
                {s?.sortino_ratio !== undefined ? Number(s.sortino_ratio).toFixed(2) : '-'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0B1220] p-3">
              <div className="text-[11px] text-slate-400">t-Statistic</div>
              <div className="text-lg font-bold text-indigo-300 font-mono">
                {s?.t_statistic !== undefined ? Number(s.t_statistic).toFixed(2) : '-'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0B1220] p-3">
              <div className="text-[11px] text-slate-400">p-Value (H0: μ=0)</div>
              <div className="text-lg font-bold text-purple-300 font-mono">
                {s?.p_value !== undefined ? Number(s.p_value).toFixed(4) : '-'}
              </div>
            </div>
          </div>

          {/* INTERACTIVE SVG CHARTS: EQUITY & UNDERWATER */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* EQUITY CURVE */}
            <Panel
              icon={<TrendingDown className="h-4 w-4 text-[#12B5A6] rotate-180" />}
              title="Đường Cong Vốn Tích Lũy (Cumulative Equity Curve - R)"
              subtitle="Diễn biến số bội R theo thứ tự chuỗi lệnh lịch sử"
            >
              {equitySeries.length > 0 ? (
                <div className="space-y-3">
                  <div className="h-56 w-full rounded-xl border border-slate-800/80 bg-[#060A13] p-3 flex flex-col justify-between">
                    <svg className="w-full h-full overflow-visible" viewBox="0 0 500 160" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#12B5A6" stopOpacity="0.35" />
                          <stop offset="100%" stopColor="#12B5A6" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      {/* Zero line */}
                      <line x1="0" y1="80" x2="500" y2="80" stroke="#334155" strokeDasharray="3,3" strokeWidth="1" />
                      {/* Polyline */}
                      {(() => {
                        const vals = equitySeries.map((p) => Number(p.equity_r || 0));
                        const min = Math.min(...vals, -1);
                        const max = Math.max(...vals, 1);
                        const span = max - min || 1;
                        const pts = vals.map((v, i) => {
                          const x = (i / Math.max(1, vals.length - 1)) * 500;
                          const y = 150 - ((v - min) / span) * 140;
                          return `${x},${y}`;
                        });
                        const polylineStr = pts.join(' ');
                        const areaStr = `0,160 ${polylineStr} 500,160`;
                        return (
                          <>
                            <polygon points={areaStr} fill="url(#equityGrad)" />
                            <polyline fill="none" stroke="#12B5A6" strokeWidth="2.5" points={polylineStr} />
                          </>
                        );
                      })()}
                    </svg>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                    <span>Lệnh #1</span>
                    <span className="text-[#12B5A6] font-semibold">
                      Kết quả ròng: {equitySeries[equitySeries.length - 1]?.equity_r > 0 ? '+' : ''}
                      {equitySeries[equitySeries.length - 1]?.equity_r}R
                    </span>
                    <span>Lệnh #{equitySeries.length}</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-8 text-center">Chưa có chuỗi lệnh để vẽ đường cong vốn</div>
              )}
            </Panel>

            {/* UNDERWATER DRAWDOWN */}
            <Panel
              icon={<TrendingDown className="h-4 w-4 text-rose-400" />}
              title="Biểu Đồ Sụt Giảm Vốn (Underwater Drawdown - R)"
              subtitle="Mức sụt giảm từ đỉnh tích lũy cao nhất theo từng lệnh"
            >
              {drawdownSeries.length > 0 ? (
                <div className="space-y-3">
                  <div className="h-56 w-full rounded-xl border border-slate-800/80 bg-[#060A13] p-3 flex flex-col justify-between">
                    <svg className="w-full h-full overflow-visible" viewBox="0 0 500 160" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.0" />
                          <stop offset="100%" stopColor="#F43F5E" stopOpacity="0.45" />
                        </linearGradient>
                      </defs>
                      {/* Zero baseline at top */}
                      <line x1="0" y1="10" x2="500" y2="10" stroke="#991B1B" strokeWidth="1.2" />
                      {(() => {
                        const vals = drawdownSeries.map((p) => Math.abs(Number(p.drawdown_r || 0)));
                        const maxDd = Math.max(...vals, 1);
                        const pts = vals.map((v, i) => {
                          const x = (i / Math.max(1, vals.length - 1)) * 500;
                          const y = 10 + (v / maxDd) * 140;
                          return `${x},${y}`;
                        });
                        const polylineStr = pts.join(' ');
                        const areaStr = `0,10 ${polylineStr} 500,10`;
                        return (
                          <>
                            <polygon points={areaStr} fill="url(#ddGrad)" />
                            <polyline fill="none" stroke="#F43F5E" strokeWidth="2" points={polylineStr} />
                          </>
                        );
                      })()}
                    </svg>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                    <span>Baseline 0.0R</span>
                    <span className="text-rose-400 font-semibold">Max DD: -{Number(s?.max_drawdown_r || 0).toFixed(2)}R</span>
                    <span>Lệnh #{drawdownSeries.length}</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-8 text-center">Chưa có chuỗi lệnh để vẽ biểu đồ sụt giảm</div>
              )}
            </Panel>
          </div>

          {/* TABLES: COST STRESS MATRIX & MONTE CARLO */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* COST STRESS MATRIX */}
            <Panel
              icon={<BarChart3 className="h-4 w-4 text-cyan-400" />}
              title="Ma Trận Nhạy Chi Phí Giao Dịch (Cost Stress Matrix)"
              subtitle="Kiểm định độ bền lợi thế qua 4 nấc ma sát spread & trượt giá"
            >
              {costMatrix?.rows ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="border-b border-slate-800 text-slate-400">
                      <tr>
                        <th className="pb-2">Nấc chi phí</th>
                        <th className="pb-2">Win%</th>
                        <th className="pb-2">Kỳ vọng (Exp)</th>
                        <th className="pb-2">PF</th>
                        <th className="pb-2">Max DD</th>
                        <th className="pb-2">t-stat</th>
                        <th className="pb-2">p-val</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-200">
                      {costMatrix.rows.map((r: any[], idx: number) => (
                        <tr key={idx} className="hover:bg-slate-800/30">
                          <td className="py-2.5 font-medium text-white">{r[0]}</td>
                          <td className="py-2.5 text-[#12B5A6]">{r[3]}%</td>
                          <td className="py-2.5">{r[4] > 0 ? `+${r[4]}` : r[4]}R</td>
                          <td className="py-2.5 text-amber-300">{r[5] ?? '-'}</td>
                          <td className="py-2.5 text-rose-300">-{r[6]}R</td>
                          <td className="py-2.5">{r[7] ?? '-'}</td>
                          <td className="py-2.5">{r[8] ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-6 text-center">Không có dữ liệu ma trận chi phí</div>
              )}
            </Panel>

            {/* MONTE CARLO TAIL RISK */}
            <Panel
              icon={<Activity className="h-4 w-4 text-purple-400" />}
              title="Đánh Giá Rủi Ro Đuôi Monte Carlo (1,000 Bootstraps)"
              subtitle="Mô phỏng đảo chuỗi lệnh để ước tính rủi ro phân vị xấu"
            >
              {mc?.simulations ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                    <div className="rounded-lg border border-slate-800 bg-[#060A13] p-3">
                      <div className="text-slate-400 text-[11px]">Sụt giảm trung vị P50</div>
                      <div className="text-base font-bold text-amber-300 mt-0.5">-{mc.p50_max_dd}R</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-[#060A13] p-3">
                      <div className="text-slate-400 text-[11px]">Sụt giảm phân vị P95</div>
                      <div className="text-base font-bold text-rose-400 mt-0.5">-{mc.p95_max_dd}R</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-[#060A13] p-3">
                      <div className="text-slate-400 text-[11px]">Sụt giảm xấu nhất P99</div>
                      <div className="text-base font-bold text-rose-500 mt-0.5">-{mc.p99_max_dd}R</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-[#060A13] p-3">
                      <div className="text-slate-400 text-[11px]">Chuỗi thua tối đa P95</div>
                      <div className="text-base font-bold text-slate-200 mt-0.5">{mc.p95_max_losing_streak} lệnh</div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-[#060A13] p-3 space-y-2 text-xs font-mono">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Xác suất gặp chuỗi thua &gt;= 5 lệnh:</span>
                      <span className="text-amber-300 font-bold">{(mc.prob_loss_streak_5 * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Xác suất gặp chuỗi thua &gt;= 7 lệnh:</span>
                      <span className="text-rose-400 font-bold">{(mc.prob_loss_streak_7 * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Xác suất gặp chuỗi thua &gt;= 10 lệnh:</span>
                      <span className="text-rose-500 font-bold">{(mc.prob_loss_streak_10 * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-6 text-center">Không có dữ liệu mô phỏng Monte Carlo</div>
              )}
            </Panel>
          </div>

          {/* ACTION BUTTON: EXPORT DRAFT REPORT WITH 1-CLICK */}
          <div className="rounded-2xl border border-cyan-500/35 bg-gradient-to-r from-cyan-950/40 via-[#0B1220] to-[#0B1220] p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="font-semibold text-white flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-cyan-400" />
                <span>3. Xuất Bản Nháp Báo Cáo PDF Tự Động</span>
              </div>
              <p className="text-xs text-slate-300 max-w-xl m-0">
                Tự động tạo bản nháp trong danh mục ấn phẩm, sinh sẵn file PDF song ngữ (Sample &amp; Full có dấu tiếng Việt) kèm đầy đủ chỉ số WFO, ma trận nhạy chi phí và biểu đồ vốn.
              </p>
            </div>

            <button
              type="button"
              disabled={exporting}
              onClick={handleExportDraft}
              className="quant-btn-primary px-5 py-2.5 text-xs shrink-0"
            >
              <ArrowUpRight className="h-4 w-4" />
              <span>{exporting ? 'Đang tạo bản nháp & sinh PDF...' : 'Tạo Bản Nháp Báo Cáo & PDF'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
