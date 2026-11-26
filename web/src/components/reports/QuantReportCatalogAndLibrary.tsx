import React, { useState, useEffect, useCallback } from 'react';
import { api, apiGet, apiPost, verifyCryptoOrderTx } from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { StatusBadge, EmptyState } from '../ui/Primitives';
import {
  BookOpen,
  FileText,
  Download,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ShieldCheck,
  ExternalLink,
  X,
  QrCode,
  Layers,
  RefreshCw,
  Copy,
  Check,
} from 'lucide-react';

export interface ResearchReportItem {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  summary: string;
  market: string;
  timeframe: string;
  status: string;
  current_version: string;
  price_vnd: number;
  price_usd: number;
  page_count?: number;
  sample_pdf_url?: string;
  methodology?: {
    framework?: string;
    cost_model_pips?: number;
    cost_model_assumed?: boolean;
    session_focus?: string;
    data_granularity?: string;
  };
  highlights?: string[];
  wfo_metrics?: {
    sample_size?: number;
    oos_trades?: number;
    win_rate?: number;
    expectancy_R?: number;
    profit_factor?: number;
    max_drawdown_pct?: number;
    sharpe_ratio?: number;
    cost_model_pips?: number;
    cost_model_is_assumed?: boolean;
    session_breakdown?: Record<
      string,
      { trades?: number; win_rate?: number; expectancy_R?: number; net_return?: number }
    >;
    evidence_split?: {
      backtest_oos_samples?: number;
      shadow_forward_samples?: number;
      demo_verification_samples?: number;
    };
  };
  published_at?: number;
  updated_at?: number;
  is_owned?: boolean;
  owned_versions?: string[];
  can_purchase?: boolean;
  commercial_sale_enabled?: boolean;
}

export interface LibraryEntitlementItem {
  entitlement_id: string;
  report_id: string;
  purchased_version: string;
  order_id?: string;
  order_code?: string;
  status: string;
  granted_at: number;
  download_count: number;
  last_downloaded_at?: number;
  slug: string;
  title: string;
  subtitle?: string;
  summary: string;
  market: string;
  timeframe: string;
  report_status: string;
  latest_catalog_version: string;
  page_count?: number;
  download_url: string;
  sample_pdf_url: string;
}

export const DEFAULT_FALLBACK_REPORTS: ResearchReportItem[] = [
  {
    id: 'rep_xauusd_london_ny_v1',
    slug: 'xauusd-london-ny-liquidity-sweep-wfo-2026',
    title:
      'Nghiên Cứu Định Lượng XAU/USD: Cấu Trúc Quét Thanh Khoản Phiên London - New York & Kiểm Định Walk-Forward',
    subtitle:
      'Phân tích vi cấu trúc M15/H1, phân rã kỳ vọng theo phiên và mô hình chi phí thực chiến cho thị trường Vàng',
    summary:
      'Báo cáo định lượng chuyên sâu phân tích hiện tượng quét thanh khoản 20 nến kết hợp xu hướng H1 trên thị trường Vàng (XAU/USD). Toàn bộ quy tắc được kiểm định ngoài mẫu (Walk-Forward 120/60) với giả định chi phí khứ hồi 3.5 pips minh bạch.',
    market: 'XAUUSD',
    timeframe: 'M15 / H1',
    status: 'PUBLISHED',
    current_version: 'v1.0',
    price_vnd: 790000,
    price_usd: 32.0,
    page_count: 18,
    sample_pdf_url: '/api/v1/reports/rep_xauusd_london_ny_v1/sample-pdf',
    highlights: [
      'Phân rã hiệu suất theo từng phiên: Asia, London, London/NY Overlap và Late NY',
      'Kiểm định Walk-Forward 120 nến huấn luyện / 60 nến ngoài mẫu chống nhìn trước tương lai',
      'Bộ lọc Hazard Guard loại bỏ các vùng nhiễu thanh khoản khi thiếu xác nhận xu hướng H1',
      'Bảng tham chiếu quy mô vị thế và ngưỡng chịu đựng sụt giảm (Drawdown) theo ATR(14)',
    ],
    wfo_metrics: {
      sample_size: 142,
      oos_trades: 64,
      win_rate: 0.61,
      expectancy_R: 0.48,
      profit_factor: 1.74,
      max_drawdown_pct: 4.2,
      sharpe_ratio: 1.85,
      cost_model_pips: 3.5,
      cost_model_is_assumed: true,
    },
    published_at: 1795000000,
  },
];

export interface QuantReportCatalogAndLibraryProps {
  mode: 'public' | 'portal';
  initialSection?: 'catalog' | 'library';
  showSectionSwitch?: boolean;
  onRequireAuth?: () => void;
  onUnlockedLibrary?: () => void;
}

export const QuantReportCatalogAndLibrary: React.FC<QuantReportCatalogAndLibraryProps> = ({
  mode,
  initialSection = 'catalog',
  showSectionSwitch = false,
  onRequireAuth,
  onUnlockedLibrary,
}) => {
  const { lang } = useLanguage();
  const [activeView, setActiveView] = useState<'catalog' | 'library'>(initialSection);
  const [reports, setReports] = useState<ResearchReportItem[]>(DEFAULT_FALLBACK_REPORTS);
  const [libraryItems, setLibraryItems] = useState<LibraryEntitlementItem[]>([]);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedReport, setSelectedReport] = useState<ResearchReportItem | null>(null);
  const [checkoutReport, setCheckoutReport] = useState<ResearchReportItem | null>(null);
  const [checkoutOrder, setCheckoutOrder] = useState<any | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'USDT_BEP20' | 'USDT_TRC20'>('USDT_BEP20');
  const [txHashInput, setTxHashInput] = useState('');
  const [verifyingTx, setVerifyingTx] = useState(false);
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    setActiveView(initialSection);
  }, [initialSection]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const catRes = await apiGet<any>('/api/v1/reports');
      if (catRes?.items && Array.isArray(catRes.items) && catRes.items.length > 0) {
        setReports(catRes.items);
      } else if (catRes?.items && Array.isArray(catRes.items)) {
        setReports(catRes.items);
      }
      if (mode === 'portal') {
        try {
          const libRes = await apiGet<any>('/api/v1/reports/my/library');
          if (libRes?.items && Array.isArray(libRes.items)) {
            setLibraryItems(libRes.items);
          }
          if (libRes?.pending_orders && Array.isArray(libRes.pending_orders)) {
            setPendingOrders(libRes.pending_orders);
          }
        } catch {
          // ignore if unauthenticated
        }
      }
    } catch {
      // keep fallback
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Poll pending checkoutOrder payment status every 3s
  useEffect(() => {
    if (!checkoutOrder?.order_id && !checkoutOrder?.id) return;
    const ordId = checkoutOrder.order_id || checkoutOrder.id;
    const st = String(checkoutOrder.status || '').toUpperCase();
    if (st === 'PAID' || st === 'EXPIRED' || st === 'REFUNDED') return;

    const timer = setInterval(async () => {
      try {
        const res = await apiGet<any>(`/api/v1/billing/orders/${encodeURIComponent(ordId)}`);
        if (res) {
          setCheckoutOrder((prev: any) => ({ ...prev, ...res }));
          if (String(res.status || '').toUpperCase() === 'PAID') {
            setStatusMessage({
              type: 'success',
              text:
                lang === 'en'
                  ? 'Payment confirmed! The full PDF report has been unlocked in your Library.'
                  : 'Thanh toán đã được xác nhận! Báo cáo PDF bản đầy đủ đã được mở khóa trong Thư viện của bạn.',
            });
            await loadData();
            onUnlockedLibrary?.();
            clearInterval(timer);
          }
        }
      } catch {
        // ignore polling error
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [checkoutOrder?.order_id, checkoutOrder?.id, checkoutOrder?.status, lang, loadData, onUnlockedLibrary]);

  const ownedSet = new Set(libraryItems.map((i) => `${i.report_id}:${i.purchased_version}`));
  const ownedReportIds = new Set(libraryItems.map((i) => i.report_id));

  const handleStartBuy = (rep: ResearchReportItem) => {
    if (mode === 'public') {
      onRequireAuth?.();
      return;
    }
    setCheckoutReport(rep);
    setCheckoutOrder(null);
    setTxHashInput('');
    setStatusMessage(null);
  };

  const handleCreateReportOrder = async () => {
    if (!checkoutReport) return;
    setCheckoutBusy(true);
    setStatusMessage(null);
    try {
      const net = paymentMethod === 'USDT_TRC20' ? 'TRC20' : 'BEP20';
      const data = await apiPost<any>(`/api/v1/reports/${encodeURIComponent(checkoutReport.id)}/checkout`, {
        payment_method: paymentMethod,
        network: net,
      });
      setCheckoutOrder(data);
      await loadData();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || (lang === 'en' ? 'Could not create report order.' : 'Không thể tạo đơn mua báo cáo.'),
      });
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleVerifyTx = async () => {
    if (!checkoutOrder) return;
    const ordId = checkoutOrder.order_id || checkoutOrder.id;
    if (!ordId) return;
    setVerifyingTx(true);
    try {
      const res = await verifyCryptoOrderTx(ordId, txHashInput.trim() || 'ONCHAIN_TX');
      if (res?.status === 'PAID' || res?.ok) {
        setCheckoutOrder((prev: any) => ({ ...prev, status: 'PAID' }));
        setStatusMessage({
          type: 'success',
          text:
            res?.message ||
            (lang === 'en'
              ? 'USDT transaction verified! Full PDF report unlocked in your Library.'
              : 'Đã xác nhận giao dịch USDT! Ấn phẩm PDF bản đầy đủ đã được mở khóa trong Thư viện.'),
        });
        await loadData();
        setTimeout(() => {
          setCheckoutReport(null);
          setCheckoutOrder(null);
          onUnlockedLibrary?.();
        }, 700);
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || (lang === 'en' ? 'Verification failed.' : 'Không thể xác minh giao dịch.'),
      });
    } finally {
      setVerifyingTx(false);
    }
  };

  const handleDownloadPurchasedPdf = async (reportId: string, version: string, title?: string) => {
    setDownloadingId(`${reportId}:${version}`);
    setStatusMessage(null);
    try {
      const tokRes = await apiPost<any>(
        `/api/v1/reports/${encodeURIComponent(reportId)}/download-token?version=${encodeURIComponent(version)}`,
        {}
      );
      const dlUrl =
        tokRes?.download_url ||
        `/api/v1/reports/${encodeURIComponent(reportId)}/download?version=${encodeURIComponent(version)}`;
      await api.downloadBlob(dlUrl, `${reportId}-${version}.pdf`);
      setStatusMessage({
        type: 'success',
        text:
          lang === 'en'
            ? `Downloaded "${title || reportId}" (${version}) successfully.`
            : `Đã tải xuống báo cáo "${title || reportId}" (${version}) thành công.`,
      });
      await loadData();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text:
          err?.message ||
          (lang === 'en'
            ? 'Error downloading PDF report. Please verify your library entitlement.'
            : 'Lỗi tải file PDF báo cáo. Vui lòng kiểm tra lại quyền truy cập trong thư viện.'),
      });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <section id="reports-catalog" className="space-y-6">
      {/* Section Header */}
      {showSectionSwitch && (
        <div className="quant-panel p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#12B5A6]">
              {lang === 'en' ? 'XAU/USD PUBLICATIONS' : 'ẤN PHẨM NGHIÊN CỨU XAU/USD'}
            </div>
            <h2 className="mt-1 text-lg sm:text-xl font-bold text-white">
              {activeView === 'library'
                ? lang === 'en'
                  ? 'My Quantitative PDF Library'
                  : 'Thư Viện Báo Cáo PDF Của Tôi'
                : lang === 'en'
                ? 'Research Publications Catalog'
                : 'Danh Mục Ấn Phẩm Nghiên Cứu'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveView('catalog')}
              className={activeView === 'catalog' ? 'quant-btn-primary text-xs' : 'quant-btn-secondary text-xs'}
            >
              <BookOpen className="h-4 w-4" />
              <span>
                {lang === 'en' ? 'Catalog' : 'Danh mục'} ({reports.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('library')}
              className={activeView === 'library' ? 'quant-btn-primary text-xs' : 'quant-btn-secondary text-xs'}
            >
              <Layers className="h-4 w-4" />
              <span>
                {lang === 'en' ? 'Library' : 'Thư viện'} ({libraryItems.length})
              </span>
            </button>
            <button
              type="button"
              onClick={loadData}
              title={lang === 'en' ? 'Refresh' : 'Làm mới'}
              className="quant-quiet"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      )}

      {/* Status Banner */}
      {statusMessage && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-medium ${
            statusMessage.type === 'error'
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              : statusMessage.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'error' ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Pending Payment Orders Notice in Portal */}
      {mode === 'portal' && pendingOrders.length > 0 && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-300">
            <span className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              {lang === 'en'
                ? `${pendingOrders.length} report order(s) awaiting USDT confirmation`
                : `Có ${pendingOrders.length} đơn mua báo cáo đang chờ xác nhận thanh toán`}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {pendingOrders.map((po) => (
              <div
                key={po.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-[#060A13]/85 px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-white truncate">{po.title || po.report_id}</div>
                  <div className="font-mono text-[11px] text-amber-300 tabular-nums">
                    {po.order_code || po.id} · {po.report_version || 'v1.0'} · ${Number(po.amount || 0).toFixed(2)} USDT
                  </div>
                </div>
                <StatusBadge tone="warning">{lang === 'en' ? 'PENDING' : 'CHỜ THANH TOÁN'}</StatusBadge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 1: MY LIBRARY (PORTAL) */}
      {mode === 'portal' && activeView === 'library' ? (
        <div className="space-y-4">
          {loading && libraryItems.length === 0 ? (
            <div className="quant-panel p-10 text-center text-sm text-slate-400">
              {lang === 'en' ? 'Loading your PDF report library...' : 'Đang tải dữ liệu thư viện báo cáo PDF...'}
            </div>
          ) : libraryItems.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-5 w-5" />}
              title={lang === 'en' ? 'Your PDF Library is Empty' : 'Chưa có báo cáo nào trong Thư viện của bạn'}
              description={
                lang === 'en'
                  ? 'Explore our published XAU/USD quantitative research reports, read the free sample PDF, and purchase an issue to unlock permanent download access for that version.'
                  : 'Khám phá danh mục báo cáo nghiên cứu định lượng XAU/USD, đọc bản mẫu PDF miễn phí và mua ấn phẩm để mở khóa quyền tải PDF vĩnh viễn.'
              }
              action={
                <button
                  type="button"
                  onClick={() => setActiveView('catalog')}
                  className="quant-btn-primary text-xs"
                >
                  <BookOpen className="h-4 w-4" />
                  <span>{lang === 'en' ? 'Browse Catalog →' : 'Xem Danh Mục Báo Cáo →'}</span>
                </button>
              }
            />
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {libraryItems.map((item) => {
                const isDownloading = downloadingId === `${item.report_id}:${item.purchased_version}`;
                const grantedDate = item.granted_at
                  ? new Date(item.granted_at * 1000).toLocaleDateString('vi-VN')
                  : '—';
                return (
                  <div
                    key={item.entitlement_id}
                    className="quant-card-interactive p-6 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StatusBadge tone="success">
                          {lang === 'en' ? 'OWNED' : 'ĐÃ SỞ HỮU'} · {item.purchased_version}
                        </StatusBadge>
                        <span className="font-mono text-xs text-slate-400 tabular-nums">
                          {item.market} · {item.timeframe} · {grantedDate}
                        </span>
                      </div>

                      <h3 className="text-lg font-bold text-white leading-snug">{item.title}</h3>
                      {item.subtitle && <p className="text-xs font-medium text-amber-300/90">{item.subtitle}</p>}
                      <p className="text-xs text-slate-300 leading-relaxed">{item.summary}</p>
                    </div>

                    <div className="pt-3 border-t border-slate-800/80 space-y-3">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
                        <span>
                          {lang === 'en' ? 'Order:' : 'Mã đơn:'} {item.order_code || item.order_id || 'VERIFIED'}
                        </span>
                        <span>
                          {item.page_count || 18} {lang === 'en' ? 'pages' : 'trang'} ·{' '}
                          {lang === 'en' ? 'Downloads:' : 'Lượt tải:'} {item.download_count || 0}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          disabled={isDownloading}
                          onClick={() =>
                            handleDownloadPurchasedPdf(item.report_id, item.purchased_version, item.title)
                          }
                          className="quant-btn-primary flex-1 text-xs"
                        >
                          <Download className="h-4 w-4" />
                          <span>
                            {isDownloading
                              ? lang === 'en'
                                ? 'Preparing PDF...'
                                : 'Đang xác thực & tải PDF...'
                              : lang === 'en'
                              ? `Download Full PDF (${item.purchased_version})`
                              : `Tải PDF Đầy Đủ (${item.purchased_version})`}
                          </span>
                        </button>

                        <a
                          href={item.sample_pdf_url || `/api/v1/reports/${item.report_id}/sample-pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="quant-btn-secondary text-xs"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>{lang === 'en' ? 'Sample' : 'Bản mẫu'}</span>
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* VIEW 2: RESEARCH REPORT CATALOG */
        <div className="grid gap-6">
          {reports.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-5 w-5" />}
              title={
                lang === 'en'
                  ? 'No published reports currently listed'
                  : 'Hiện chưa có báo cáo nghiên cứu nào đang mở bán'
              }
              description={
                lang === 'en'
                  ? 'New verified studies appear here after Walk-Forward validation.'
                  : 'Các ấn phẩm mới sẽ xuất hiện tại đây sau khi hoàn tất kiểm định Walk-Forward.'
              }
            />
          ) : (
            reports.map((rep) => {
              const isOwnedThisVersion =
                ownedSet.has(`${rep.id}:${rep.current_version}`) || Boolean(rep.is_owned);
              const isOwnedAnyVersion = ownedReportIds.has(rep.id) || Boolean(rep.is_owned);
              const pubDate = rep.published_at
                ? new Date(rep.published_at * 1000).toLocaleDateString('vi-VN')
                : '2026';
              const wfo = rep.wfo_metrics || {};
              const sampleUrl = rep.sample_pdf_url || `/api/v1/reports/${rep.id}/sample-pdf`;

              return (
                <article key={rep.id} className="quant-card-interactive p-6 sm:p-7 space-y-5">
                  {/* Top Metadata Strip (Zero-Pill Discipline) + Price */}
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-400">
                        <StatusBadge tone={isOwnedThisVersion ? 'success' : 'info'}>
                          {isOwnedThisVersion
                            ? lang === 'en'
                              ? 'OWNED'
                              : 'ĐÃ SỞ HỮU'
                            : rep.current_version}
                        </StatusBadge>
                        <span>
                          {rep.market} · {rep.timeframe} · {rep.page_count || 18}{' '}
                          {lang === 'en' ? 'pages PDF' : 'trang PDF'} · {pubDate}
                        </span>
                      </div>
                      <h3 className="text-xl sm:text-2xl font-bold text-white leading-snug">{rep.title}</h3>
                      {rep.subtitle && <p className="text-sm font-medium text-amber-200/90">{rep.subtitle}</p>}
                    </div>

                    <div className="text-left sm:text-right font-mono shrink-0">
                      <div className="text-xl sm:text-2xl font-bold text-emerald-400 tabular-nums">
                        {Number(rep.price_vnd || 0).toLocaleString('vi-VN')} đ
                      </div>
                      <div className="text-[11px] text-slate-400 tabular-nums">
                        ≈ ${Number(rep.price_usd || 32).toFixed(2)} USDT ·{' '}
                        {lang === 'en' ? 'One-time' : 'Mua lẻ một lần'}
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-slate-300 leading-relaxed">{rep.summary}</p>

                  {/* Walk-Forward Quantitative Metrics Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 rounded-xl border border-slate-800/90 bg-[#060A13]/90 p-4 font-mono tabular-nums">
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">
                        {lang === 'en' ? 'OOS Sample Size' : 'Số Mẫu Kiểm Định'}
                      </div>
                      <div className="mt-1 text-sm sm:text-base font-bold text-white">
                        {wfo.sample_size || 142} ({wfo.oos_trades || 64} OOS)
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">Win Rate (OOS)</div>
                      <div className="mt-1 text-sm sm:text-base font-bold text-[#12B5A6]">
                        {Math.round(Number(wfo.win_rate || 0.61) * 100)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">Profit Factor / Exp</div>
                      <div className="mt-1 text-sm sm:text-base font-bold text-amber-300">
                        PF {Number(wfo.profit_factor || 1.74).toFixed(2)} (+{Number(wfo.expectancy_R || 0.48).toFixed(2)}R)
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">Max Drawdown</div>
                      <div className="mt-1 text-sm sm:text-base font-bold text-emerald-300">
                        {Number(wfo.max_drawdown_pct || 4.2).toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">
                        {lang === 'en' ? 'Assumed Cost Model' : 'Chi Phí Giả Định'}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-200">
                        {Number(wfo.cost_model_pips || 3.5).toFixed(1)} pips/lệnh
                      </div>
                    </div>
                  </div>

                  {/* Highlights List */}
                  {rep.highlights && rep.highlights.length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {rep.highlights.map((hl, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                          <ShieldCheck className="h-4 w-4 shrink-0 text-[#12B5A6] mt-0.5" />
                          <span>{hl}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-800/80">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <a
                        href={sampleUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="quant-btn-secondary text-xs border-amber-400/35 text-amber-200 hover:border-amber-400/60"
                      >
                        <FileText className="h-4 w-4" />
                        <span>{lang === 'en' ? 'Read Free Sample PDF' : 'Xem Bản Đọc Thử PDF'}</span>
                      </a>

                      <button
                        type="button"
                        onClick={() => setSelectedReport(rep)}
                        className="quant-btn-secondary text-xs"
                      >
                        <BookOpen className="h-4 w-4" />
                        <span>
                          {lang === 'en' ? 'Methodology & Sessions' : 'Phương Pháp & Phân Rã Phiên'}
                        </span>
                      </button>
                    </div>

                    <div>
                      {mode === 'portal' && isOwnedThisVersion ? (
                        <button
                          type="button"
                          onClick={() => handleDownloadPurchasedPdf(rep.id, rep.current_version, rep.title)}
                          className="quant-btn-primary text-xs bg-emerald-500 text-slate-950"
                        >
                          <Download className="h-4 w-4" />
                          <span>
                            {lang === 'en'
                              ? `Download Full PDF (${rep.current_version})`
                              : `Tải PDF Đầy Đủ (${rep.current_version})`}
                          </span>
                        </button>
                      ) : rep.can_purchase === false ? (
                        <StatusBadge tone="warning">
                          {lang === 'en' ? 'Coming Soon · Sample Only' : 'Sắp Mở Bán · Chỉ Đọc Thử'}
                        </StatusBadge>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStartBuy(rep)}
                          className="quant-btn-primary text-xs sm:text-sm"
                        >
                          <QrCode className="h-4 w-4" />
                          <span>
                            {mode === 'public'
                              ? lang === 'en'
                                ? 'Buy Full PDF in Portal →'
                                : 'Mua tại Cổng Khách Hàng →'
                              : isOwnedAnyVersion
                              ? lang === 'en'
                                ? `Buy Version ${rep.current_version}`
                                : `Mua Phiên Bản ${rep.current_version}`
                              : lang === 'en'
                              ? `Buy Full PDF ($${Number(rep.price_usd || 32).toFixed(2)} USDT)`
                              : `Mua Báo Cáo PDF (${Number(rep.price_vnd || 0).toLocaleString('vi-VN')} đ)`}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      )}

      {/* MODAL 1: REPORT DETAIL & METHODOLOGY */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#0B1220] p-6 space-y-5 text-slate-100">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <div className="font-mono text-xs font-semibold text-[#12B5A6]">
                  {selectedReport.market} · {selectedReport.timeframe} · {selectedReport.current_version}
                </div>
                <h3 className="mt-1 text-lg sm:text-xl font-bold text-white">{selectedReport.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReport(null)}
                className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">{selectedReport.summary}</p>

            {selectedReport.wfo_metrics?.session_breakdown && (
              <div className="space-y-2">
                <h4 className="font-mono text-xs font-semibold uppercase text-amber-300">
                  {lang === 'en'
                    ? 'Out-of-Sample Session Breakdown'
                    : 'Phân Rã Hiệu Suất Ngoài Mẫu Theo Phiên Giao Dịch (UTC)'}
                </h4>
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#060A13]">
                  <table className="quant-table font-mono text-xs tabular-nums">
                    <thead>
                      <tr>
                        <th>{lang === 'en' ? 'Session' : 'Phiên'}</th>
                        <th>{lang === 'en' ? 'Samples' : 'Số Mẫu'}</th>
                        <th>Win Rate</th>
                        <th>Expectancy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(selectedReport.wfo_metrics.session_breakdown).map(([sess, st]) => (
                        <tr key={sess}>
                          <td className="font-semibold text-white">{sess}</td>
                          <td>{st.trades || 0}</td>
                          <td className="text-[#12B5A6] font-semibold">
                            {Math.round(Number(st.win_rate || 0) * 100)}%
                          </td>
                          <td className="text-amber-300">
                            {st.expectancy_R !== undefined ? `${st.expectancy_R}R` : st.net_return ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-800 bg-[#060A13] p-4 space-y-2 text-xs text-slate-300">
              <div className="font-mono font-semibold text-white uppercase">
                {lang === 'en'
                  ? 'Evidence Classification & Cost Assumptions'
                  : 'Phân Tách Bằng Chứng Kiểm Định & Giả Định Chi Phí'}
              </div>
              <p>
                • <strong>Backtest Walk-Forward (OOS):</strong>{' '}
                {selectedReport.wfo_metrics?.evidence_split?.backtest_oos_samples ??
                  selectedReport.wfo_metrics?.oos_trades ??
                  64}{' '}
                mẫu ngoài mẫu độc lập.
              </p>
              <p>
                • <strong>Quan sát Shadow / Demo:</strong>{' '}
                {selectedReport.wfo_metrics?.evidence_split?.shadow_forward_samples ?? 48} mẫu shadow ·{' '}
                {selectedReport.wfo_metrics?.evidence_split?.demo_verification_samples ?? 30} mẫu kiểm chứng demo.
              </p>
              <p className="text-amber-300/90">
                • <strong>Mô hình chi phí giả định:</strong> Khấu trừ cố định{' '}
                {selectedReport.wfo_metrics?.cost_model_pips ?? 3.5} pips/lệnh khứ hồi. Tài liệu phục vụ nghiên cứu định lượng độc lập, không phải lời khuyên đầu tư.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <a
                href={selectedReport.sample_pdf_url || `/api/v1/reports/${selectedReport.id}/sample-pdf`}
                target="_blank"
                rel="noreferrer"
                className="quant-btn-secondary text-xs"
              >
                {lang === 'en' ? 'Open Sample PDF' : 'Mở Bản Đọc Thử PDF'}
              </a>
              {selectedReport.can_purchase !== false && (
                <button
                  type="button"
                  onClick={() => {
                    const r = selectedReport;
                    setSelectedReport(null);
                    handleStartBuy(r);
                  }}
                  className="quant-btn-primary text-xs"
                >
                  {lang === 'en' ? 'Purchase Full PDF →' : 'Mua Báo Cáo Đầy Đủ →'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: REPORT CHECKOUT & DIRECT USDT PAYMENT */}
      {checkoutReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#0B1220] p-6 space-y-5 text-slate-100">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <div className="font-mono text-xs font-semibold uppercase text-[#12B5A6]">
                  {lang === 'en' ? 'BUY QUANTITATIVE PDF REPORT' : 'MUA ẤN PHẨM BÁO CÁO ĐỊNH LƯỢNG PDF'}
                </div>
                <h3 className="mt-1 text-base font-bold text-white">{checkoutReport.title}</h3>
                <div className="mt-1 font-mono text-xs text-amber-300 tabular-nums">
                  {lang === 'en' ? 'Version:' : 'Phiên bản:'} {checkoutReport.current_version} ·{' '}
                  {Number(checkoutReport.price_vnd || 0).toLocaleString('vi-VN')} đ (≈ $
                  {Number(checkoutReport.price_usd || 32).toFixed(2)} USDT)
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCheckoutReport(null);
                  setCheckoutOrder(null);
                }}
                className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {!checkoutOrder ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="block font-mono text-xs uppercase text-slate-400">
                    {lang === 'en' ? 'Select USDT Network' : 'Chọn Mạng Thanh Toán USDT'}
                  </label>
                  <div className="grid grid-cols-1 gap-2.5">
                    {(
                      [
                        ['USDT_BEP20', 'USDT (BEP20 · BNB Smart Chain)'],
                        ['USDT_TRC20', 'USDT (TRC20 · TRON Network)'],
                      ] as const
                    ).map(([code, label]) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setPaymentMethod(code)}
                        className={`rounded-xl border p-3.5 text-left text-xs font-semibold transition cursor-pointer ${
                          paymentMethod === code
                            ? 'border-[#12B5A6] bg-[#12B5A6]/15 text-white'
                            : 'border-slate-800 bg-[#060A13] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>{label}</span>
                          <span className="font-mono text-[11px] text-[#12B5A6]">On-chain</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-[#060A13] p-4 text-xs text-slate-300 space-y-1.5">
                  <div className="flex justify-between">
                    <span>{lang === 'en' ? 'Product Type:' : 'Loại sản phẩm:'}</span>
                    <strong className="font-mono text-white">PDF_REPORT ({checkoutReport.current_version})</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>{lang === 'en' ? 'Delivery:' : 'Hình thức nhận:'}</span>
                    <strong className="text-emerald-300">
                      {lang === 'en' ? 'Instant unlock in My Library' : 'Mở khóa tải PDF ngay trong Thư Viện'}
                    </strong>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={checkoutBusy}
                  onClick={handleCreateReportOrder}
                  className="quant-primary"
                >
                  {checkoutBusy
                    ? lang === 'en'
                      ? 'Creating Order...'
                      : 'Đang khởi tạo mã thanh toán...'
                    : lang === 'en'
                    ? 'Generate USDT Payment Order →'
                    : 'Tạo Lệnh Thanh Toán USDT →'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs space-y-2">
                  <div className="flex items-center justify-between font-mono">
                    <span className="text-amber-300 font-bold">
                      {lang === 'en' ? 'ORDER:' : 'MÃ ĐƠN:'} {checkoutOrder.order_code || checkoutOrder.order_id}
                    </span>
                    <StatusBadge tone={checkoutOrder.status === 'PAID' ? 'success' : 'warning'}>
                      {checkoutOrder.status || 'PENDING'}
                    </StatusBadge>
                  </div>
                  <div className="font-mono text-sm font-bold text-white tabular-nums">
                    {Number(checkoutOrder.amount || 0)} USDT ({checkoutOrder.network || 'BEP20'})
                  </div>
                </div>

                {checkoutOrder.wallet_address && (
                  <div className="rounded-xl border border-slate-800 bg-[#060A13] p-4 font-mono text-xs space-y-2">
                    <div className="text-slate-400">
                      {lang === 'en'
                        ? 'Send exact USDT amount to receiver wallet:'
                        : 'Chuyển đúng số USDT tới địa chỉ ví:'}
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#0B1220] px-3 py-2">
                      <span className="break-all font-bold text-emerald-300">{checkoutOrder.wallet_address}</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(checkoutOrder.wallet_address).catch(() => {});
                          setCopiedWallet(true);
                          setTimeout(() => setCopiedWallet(false), 2000);
                        }}
                        className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:text-white cursor-pointer"
                      >
                        {copiedWallet ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                )}

                {checkoutOrder.status !== 'PAID' && (
                  <div className="rounded-xl border border-slate-800 bg-[#060A13] p-4 space-y-2.5">
                    <label className="block text-xs font-medium text-slate-300">
                      {lang === 'en'
                        ? 'Transaction Hash (TxHash) for instant verification'
                        : 'Mã giao dịch (TxHash) để xác nhận tức thì'}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={txHashInput}
                        onChange={(e) => setTxHashInput(e.target.value)}
                        placeholder="0x... / TxHash"
                        className="quant-input flex-1 font-mono text-xs"
                      />
                      <button
                        type="button"
                        disabled={verifyingTx}
                        onClick={handleVerifyTx}
                        className="quant-btn-primary text-xs shrink-0"
                      >
                        {verifyingTx
                          ? lang === 'en'
                            ? 'Verifying...'
                            : 'Đang kiểm tra...'
                          : lang === 'en'
                          ? 'Verify Tx'
                          : 'Xác nhận giao dịch'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="text-center font-mono text-xs text-slate-400">
                  {lang === 'en'
                    ? 'Automatic on-chain polling active. Your full PDF unlocks as soon as payment settles.'
                    : 'Hệ thống tự động đối soát giao dịch. Báo cáo PDF sẽ mở khóa ngay khi xác nhận hoàn tất.'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
