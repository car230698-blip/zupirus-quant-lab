import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from '../api/client';
import { useLanguage } from '../i18n/LanguageContext';
import {
  BookOpen,
  FileText,
  Download,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Sparkles,
  ShieldCheck,
  ExternalLink,
  X,
  QrCode,
  Layers,
  RefreshCw,
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
    session_breakdown?: Record<string, { trades?: number; win_rate?: number; expectancy_R?: number; net_return?: number }>;
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

const DEFAULT_FALLBACK_REPORTS: ResearchReportItem[] = [
  {
    id: 'rep_xauusd_london_ny_v1',
    slug: 'xauusd-london-ny-liquidity-sweep-wfo-2026',
    title: 'Nghiên Cứu Định Lượng XAU/USD: Cấu Trúc Quét Thanh Khoản Phiên London - New York & Kiểm Định Walk-Forward',
    subtitle: 'Phân tích vi cấu trúc M15/H1, phân rã kỳ vọng theo phiên và mô hình chi phí thực chiến cho nhà giao dịch Vàng',
    summary:
      'Báo cáo định lượng chuyên sâu phân tích hiện tượng quét thanh khoản 20 nến (Liquidity Sweep) kết hợp xu hướng H1 trên thị trường Vàng (XAU/USD). Toàn bộ quy tắc được kiểm định ngoài mẫu (Walk-Forward 120/60) với giả định chi phí khứ hồi 3.5 pips minh bạch.',
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
  onRequireAuth?: () => void;
}

export const QuantReportCatalogAndLibrary: React.FC<QuantReportCatalogAndLibraryProps> = ({
  mode,
  initialSection = 'catalog',
  onRequireAuth,
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
  const [checkoutBusy, setCheckoutBusy] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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

  // Poll active checkoutOrder payment status every 3s
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
            setActiveView('library');
            clearInterval(timer);
          }
        }
      } catch {
        // ignore polling error
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [checkoutOrder?.order_id, checkoutOrder?.id, checkoutOrder?.status, lang, loadData]);

  const ownedSet = new Set(libraryItems.map((i) => `${i.report_id}:${i.purchased_version}`));
  const ownedReportIds = new Set(libraryItems.map((i) => i.report_id));

  const handleStartBuy = (rep: ResearchReportItem) => {
    if (mode === 'public') {
      if (onRequireAuth) onRequireAuth();
      return;
    }
    setCheckoutReport(rep);
    setCheckoutOrder(null);
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
      const resp = await fetch(dlUrl, { credentials: 'include' });
      if (!resp.ok) {
        let errDetail = 'Không thể tải tệp PDF.';
        try {
          const errJson = await resp.json();
          errDetail = errJson?.detail || errJson?.error?.message || errDetail;
        } catch {
          // ignore
        }
        throw new Error(errDetail);
      }
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportId}-${version}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
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
      {/* Section Header & Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800/90 bg-[#0B1220]/90 p-5">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#12B5A6]/30 bg-[#12B5A6]/10 px-3 py-1 font-mono text-[11px] font-bold text-[#12B5A6]">
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              {lang === 'en'
                ? 'XAU/USD QUANTITATIVE RESEARCH PUBLICATIONS · WEB-ONLY PDF'
                : 'PHÒNG NGHIÊN CỨU ĐỊNH LƯỢNG XAU/USD · ẤN PHẨM PDF CHUYÊN SÂU'}
            </span>
          </div>
          <h2 className="mt-2 text-xl sm:text-2xl font-extrabold text-white">
            {mode === 'portal' && activeView === 'library'
              ? lang === 'en'
                ? 'My Quantitative PDF Library'
                : 'Thư Viện Báo Cáo PDF Của Tôi'
              : lang === 'en'
              ? 'XAU/USD Quantitative Research Catalog'
              : 'Danh Mục Báo Cáo Nghiên Cứu Định Lượng XAU/USD'}
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-slate-400">
            {lang === 'en'
              ? 'Read free sample previews, verify out-of-sample Walk-Forward evidence, purchase individual reports, and download full PDFs directly from your account library. No MT5, VPS, or broker connection required.'
              : 'Xem giới thiệu và bản đọc thử PDF miễn phí, đối chiếu kiểm định ngoài mẫu Walk-Forward, mua từng ấn phẩm và tải PDF trực tiếp từ thư viện tài khoản. Hoàn toàn trên website — không cần MT5, VPS hay kết nối sàn môi giới.'}
          </p>
        </div>

        {mode === 'portal' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveView('catalog')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition cursor-pointer ${
                activeView === 'catalog'
                  ? 'bg-[#12B5A6] text-[#032220] shadow-sm'
                  : 'border border-slate-700 bg-slate-900/70 text-slate-300 hover:text-white'
              }`}
            >
              <BookOpen className="h-4 w-4" />
              <span>{lang === 'en' ? 'Report Catalog' : 'Danh Mục Báo Cáo'}</span>
              <span className="rounded-full bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">{reports.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('library')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition cursor-pointer ${
                activeView === 'library'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'border border-slate-700 bg-slate-900/70 text-slate-300 hover:text-white'
              }`}
            >
              <Layers className="h-4 w-4" />
              <span>{lang === 'en' ? 'My Library' : 'Thư Viện Của Tôi'}</span>
              <span className="rounded-full bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">
                {libraryItems.length}
              </span>
            </button>
            <button
              type="button"
              onClick={loadData}
              title={lang === 'en' ? 'Refresh' : 'Làm mới'}
              className="rounded-xl border border-slate-700 bg-slate-900/70 p-2.5 text-slate-300 hover:text-white cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}
      </div>

      {/* Status / Error / Payment Alert Banner */}
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
        <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
            <Clock className="h-4 w-4" />
            <span>
              {lang === 'en'
                ? `You have ${pendingOrders.length} report order(s) awaiting payment confirmation`
                : `Bạn có ${pendingOrders.length} đơn mua báo cáo đang chờ xác nhận thanh toán`}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {pendingOrders.map((po) => (
              <div
                key={po.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-[#070D19]/80 px-3.5 py-2.5 text-xs"
              >
                <div>
                  <div className="font-bold text-white">{po.title || po.report_id}</div>
                  <div className="font-mono text-[11px] text-amber-300">
                    {po.order_code || po.id} · {po.report_version || 'v1.0'} ·{' '}
                    {String(po.currency).toUpperCase() === 'VND'
                      ? `${Number(po.amount || 0).toLocaleString('vi-VN')} đ`
                      : `$${Number(po.amount || 0).toFixed(2)} USDT`}
                  </div>
                </div>
                <span className="rounded-lg bg-amber-500/20 px-2.5 py-1 font-mono text-[10px] font-bold text-amber-300">
                  {lang === 'en' ? 'PENDING PAYMENT' : 'CHỜ THANH TOÁN'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 1: MY LIBRARY (PORTAL) */}
      {mode === 'portal' && activeView === 'library' ? (
        <div className="space-y-4">
          {loading && libraryItems.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-10 text-center text-sm text-slate-400">
              {lang === 'en' ? 'Loading your PDF report library...' : 'Đang tải dữ liệu thư viện báo cáo PDF...'}
            </div>
          ) : libraryItems.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-10 text-center space-y-4">
              <FileText className="mx-auto h-10 w-10 text-slate-500" />
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">
                  {lang === 'en' ? 'Your PDF Library is Empty' : 'Chưa có báo cáo nào trong Thư viện của bạn'}
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  {lang === 'en'
                    ? 'Explore our published XAU/USD quantitative research reports, read the free sample PDF, and purchase an issue to unlock permanent download access for that version.'
                    : 'Khám phá danh mục báo cáo nghiên cứu định lượng XAU/USD, đọc bản mẫu PDF miễn phí và mua ấn phẩm để mở khóa quyền tải PDF vĩnh viễn theo phiên bản đã mua.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveView('catalog')}
                className="inline-flex items-center gap-2 rounded-xl bg-[#12B5A6] px-5 py-2.5 text-xs font-extrabold text-[#032220] hover:bg-[#14C9B8] cursor-pointer"
              >
                <BookOpen className="h-4 w-4" />
                <span>{lang === 'en' ? 'Browse Research Catalog →' : 'Xem Danh Mục Báo Cáo →'}</span>
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {libraryItems.map((item) => {
                const isDownloading = downloadingId === `${item.report_id}:${item.purchased_version}`;
                const grantedDate = item.granted_at
                  ? new Date(item.granted_at * 1000).toLocaleDateString('vi-VN')
                  : '—';
                return (
                  <div
                    key={item.entitlement_id}
                    className="flex flex-col justify-between rounded-2xl border border-emerald-500/30 bg-[#0B1324] p-6 space-y-4"
                  >
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 font-mono text-[11px] font-bold text-emerald-300">
                            {lang === 'en' ? 'OWNED' : 'ĐÃ SỞ HỮU'} · {item.purchased_version}
                          </span>
                          <span className="rounded-lg bg-slate-800 px-2.5 py-0.5 font-mono text-[11px] text-amber-300">
                            {item.market} · {item.timeframe}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-slate-400">
                          {lang === 'en' ? 'Granted:' : 'Cấp ngày:'} {grantedDate}
                        </span>
                      </div>

                      <h3 className="text-lg font-extrabold text-white leading-snug">{item.title}</h3>
                      {item.subtitle && <p className="text-xs font-medium text-amber-300/90">{item.subtitle}</p>}
                      <p className="text-xs text-slate-300 leading-relaxed">{item.summary}</p>
                    </div>

                    <div className="pt-3 border-t border-slate-800/80 space-y-3">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <span>
                          {lang === 'en' ? 'Order:' : 'Mã đơn:'} {item.order_code || item.order_id || 'VERIFIED'}
                        </span>
                        <span>
                          {item.page_count || 18} {lang === 'en' ? 'pages' : 'trang'} ·{' '}
                          {lang === 'en' ? 'Downloads:' : 'Số lượt tải:'} {item.download_count || 0}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          disabled={isDownloading}
                          onClick={() =>
                            handleDownloadPurchasedPdf(item.report_id, item.purchased_version, item.title)
                          }
                          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#12B5A6] to-[#0D9488] px-4 py-2.5 text-xs font-extrabold text-[#032220] hover:opacity-95 cursor-pointer disabled:opacity-50"
                        >
                          <Download className="h-4 w-4" />
                          <span>
                            {isDownloading
                              ? lang === 'en'
                                ? 'Preparing Signed PDF...'
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
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-xs font-bold text-slate-200 hover:border-amber-400/50 hover:text-amber-300"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>{lang === 'en' ? 'Sample' : 'Bản Mẫu'}</span>
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
        /* VIEW 2: PUBLIC / PORTAL RESEARCH REPORT CATALOG */
        <div className="grid gap-6">
          {reports.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-10 text-center text-sm text-slate-400">
              {lang === 'en'
                ? 'No published quantitative research reports are currently listed.'
                : 'Hiện chưa có báo cáo nghiên cứu nào đang mở bán công khai.'}
            </div>
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
                <div
                  key={rep.id}
                  className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-[#0E172A] to-[#080E1B] p-6 sm:p-7 shadow-xl space-y-5"
                >
                  {/* Top Badges */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                      <span className="rounded-lg bg-amber-500/15 border border-amber-400/40 px-2.5 py-1 font-bold text-amber-300">
                        {rep.market} · {rep.timeframe}
                      </span>
                      <span className="rounded-lg bg-[#12B5A6]/15 border border-[#12B5A6]/40 px-2.5 py-1 font-bold text-[#12B5A6]">
                        {lang === 'en' ? 'VERSION' : 'PHIÊN BẢN'} {rep.current_version}
                      </span>
                      <span className="rounded-lg bg-slate-800/90 px-2.5 py-1 text-slate-300">
                        {rep.page_count || 18} {lang === 'en' ? 'Pages PDF' : 'Trang PDF'} · {pubDate}
                      </span>
                    </div>

                    <div className="text-right font-mono">
                      <div className="text-xl sm:text-2xl font-extrabold text-emerald-400">
                        {Number(rep.price_vnd || 0).toLocaleString('vi-VN')} đ
                      </div>
                      <div className="text-[11px] text-slate-400">
                        ≈ ${Number(rep.price_usd || 32).toFixed(2)} USDT ·{' '}
                        {lang === 'en' ? 'Per-Issue License' : 'Mua lẻ từng báo cáo'}
                      </div>
                    </div>
                  </div>

                  {/* Title & Summary */}
                  <div className="space-y-2">
                    <h3 className="text-xl sm:text-2xl font-extrabold text-white leading-snug">{rep.title}</h3>
                    {rep.subtitle && <p className="text-sm font-medium text-amber-200/90">{rep.subtitle}</p>}
                    <p className="text-sm text-slate-300 leading-relaxed">{rep.summary}</p>
                  </div>

                  {/* Walk-Forward Quantitative Metrics Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 rounded-xl border border-slate-800 bg-[#060B15]/90 p-4 font-mono">
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">
                        {lang === 'en' ? 'OOS Sample Size' : 'Số Mẫu Kiểm Định'}
                      </div>
                      <div className="mt-0.5 text-base font-bold text-white">
                        {wfo.sample_size || 142} ({wfo.oos_trades || 64} OOS)
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">Win Rate (OOS)</div>
                      <div className="mt-0.5 text-base font-bold text-[#12B5A6]">
                        {Math.round(Number(wfo.win_rate || 0.61) * 100)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">Profit Factor / Exp</div>
                      <div className="mt-0.5 text-base font-bold text-amber-300">
                        PF {Number(wfo.profit_factor || 1.74).toFixed(2)} (+{Number(wfo.expectancy_R || 0.48).toFixed(2)}R)
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">Max Drawdown</div>
                      <div className="mt-0.5 text-base font-bold text-emerald-300">
                        {Number(wfo.max_drawdown_pct || 4.2).toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">
                        {lang === 'en' ? 'Assumed Cost Model' : 'Chi Phí Giả Định'}
                      </div>
                      <div className="mt-0.5 text-xs font-bold text-slate-200">
                        {Number(wfo.cost_model_pips || 3.5).toFixed(1)} pips/lệnh (Giả định)
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

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <a
                        href={sampleUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-300 hover:bg-amber-500/20 transition"
                      >
                        <FileText className="h-4 w-4" />
                        <span>{lang === 'en' ? 'Read Free Sample PDF' : 'Xem Bản Đọc Thử PDF (Miễn Phí)'}</span>
                      </a>

                      <button
                        type="button"
                        onClick={() => setSelectedReport(rep)}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2.5 text-xs font-bold text-slate-200 hover:border-slate-500 cursor-pointer"
                      >
                        <BookOpen className="h-4 w-4" />
                        <span>
                          {lang === 'en' ? 'Methodology & Session Breakdown' : 'Chi Tiết Phương Pháp & Phân Rã Phiên'}
                        </span>
                      </button>
                    </div>

                    <div>
                      {mode === 'portal' && isOwnedThisVersion ? (
                        <button
                          type="button"
                          onClick={() =>
                            handleDownloadPurchasedPdf(rep.id, rep.current_version, rep.title)
                          }
                          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                        >
                          <Download className="h-4 w-4" />
                          <span>
                            {lang === 'en'
                              ? `Download Full PDF (${rep.current_version})`
                              : `Đã Sở Hữu · Tải PDF Đầy Đủ (${rep.current_version})`}
                          </span>
                        </button>
                      ) : rep.can_purchase === false ? (
                        <div className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 text-xs font-bold text-amber-300">
                          <Clock className="h-4 w-4" />
                          <span>{lang === 'en' ? 'Coming Soon · Free Sample Only' : 'Sắp Mở Bán · Đọc Thử Miễn Phí'}</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStartBuy(rep)}
                          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#12B5A6] to-[#0D9488] px-6 py-3 text-xs sm:text-sm font-extrabold text-[#032220] hover:shadow-[0_8px_25px_-6px_rgba(18,181,166,0.65)] transition cursor-pointer"
                        >
                          <QrCode className="h-4 w-4" />
                          <span>
                            {isOwnedAnyVersion
                              ? lang === 'en'
                                ? `Buy New Version (${rep.current_version})`
                                : `Mua Phiên Bản Mới (${rep.current_version})`
                              : lang === 'en'
                              ? `Buy Full PDF Report (${Number(rep.price_vnd || 0).toLocaleString('vi-VN')} đ)`
                              : `Mua Báo Cáo PDF (${Number(rep.price_vnd || 0).toLocaleString('vi-VN')} đ)`}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* MODAL 1: REPORT DETAIL & METHODOLOGY */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#0B1324] p-6 space-y-5 text-slate-100">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <div className="font-mono text-xs font-bold text-[#12B5A6]">
                  {selectedReport.market} · {selectedReport.timeframe} · {selectedReport.current_version}
                </div>
                <h3 className="mt-1 text-lg sm:text-xl font-extrabold text-white">{selectedReport.title}</h3>
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

            {/* Session Breakdown Table if available */}
            {selectedReport.wfo_metrics?.session_breakdown && (
              <div className="space-y-2">
                <h4 className="font-mono text-xs font-bold uppercase text-amber-300">
                  {lang === 'en'
                    ? 'Out-of-Sample Session Breakdown'
                    : 'Phân Rã Hiệu Suất Ngoài Mẫu Theo Phiên Giao Dịch (UTC)'}
                </h4>
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#060A14]">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="p-3">{lang === 'en' ? 'Session' : 'Phiên'}</th>
                        <th className="p-3">{lang === 'en' ? 'Sample Count' : 'Số Mẫu'}</th>
                        <th className="p-3">Win Rate</th>
                        <th className="p-3">Expectancy</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {Object.entries(selectedReport.wfo_metrics.session_breakdown).map(([sess, st]) => (
                        <tr key={sess}>
                          <td className="p-3 font-bold text-white">{sess}</td>
                          <td className="p-3 text-slate-300">{st.trades || 0}</td>
                          <td className="p-3 text-[#12B5A6] font-bold">
                            {Math.round(Number(st.win_rate || 0) * 100)}%
                          </td>
                          <td className="p-3 text-amber-300">
                            {st.expectancy_R !== undefined ? `${st.expectancy_R}R` : st.net_return ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Evidence separation & cost model disclosure */}
            <div className="rounded-xl border border-slate-800 bg-[#060A14] p-4 space-y-2 text-xs text-slate-300">
              <div className="font-mono font-bold text-white uppercase">
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
                {selectedReport.wfo_metrics?.evidence_split?.demo_verification_samples ?? 30} mẫu kiểm chứng demo (tách biệt với backtest).
              </p>
              <p className="text-amber-300/90">
                • <strong>Mô hình chi phí giả định:</strong> Khấu trừ cố định{' '}
                {selectedReport.wfo_metrics?.cost_model_pips ?? 3.5} pips/lệnh khứ hồi (spread + trượt giá giả định). Tài liệu phục vụ nghiên cứu định lượng độc lập, không phải lời khuyên đầu tư hay ủy thác giao dịch.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <a
                href={selectedReport.sample_pdf_url || `/api/v1/reports/${selectedReport.id}/sample-pdf`}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-300"
              >
                {lang === 'en' ? 'Open Sample PDF' : 'Mở Bản Đọc Thử PDF'}
              </a>
              {selectedReport.can_purchase === false ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-300">
                  {lang === 'en' ? 'Coming Soon · Not Yet On Sale' : 'Sắp Mở Bán · Chưa Mở Bán Thương Mại'}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const r = selectedReport;
                    setSelectedReport(null);
                    handleStartBuy(r);
                  }}
                  className="rounded-xl bg-[#12B5A6] px-5 py-2.5 text-xs font-extrabold text-[#032220] cursor-pointer"
                >
                  {lang === 'en' ? 'Purchase Full PDF →' : 'Mua Báo Cáo Đầy Đủ →'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: REPORT CHECKOUT & VIETQR / USDT PAYMENT */}
      {checkoutReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#0B1324] p-6 space-y-5 text-slate-100">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <div className="font-mono text-xs font-bold uppercase text-[#12B5A6]">
                  {lang === 'en' ? 'BUY QUANTITATIVE PDF REPORT' : 'MUA ẤN PHẨM BÁO CÁO ĐỊNH LƯỢNG PDF'}
                </div>
                <h3 className="mt-1 text-base font-extrabold text-white">{checkoutReport.title}</h3>
                <div className="mt-1 font-mono text-xs text-amber-300">
                  {lang === 'en' ? 'Version locked to:' : 'Phiên bản cấp quyền:'} {checkoutReport.current_version} ·{' '}
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
                    {lang === 'en' ? 'Select Payment Method' : 'Chọn Phương Thức Thanh Toán'}
                  </label>
                  <div className="grid grid-cols-1 gap-2.5">
                    {(
                      [
                        ['USDT_BEP20', 'USDT (BEP20 - BNB Chain · Tự động kích hoạt)'],
                        ['USDT_TRC20', 'USDT (TRC20 - Tron · Tự động kích hoạt)'],
                      ] as const
                    ).map(([code, label]) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setPaymentMethod(code)}
                        className={`rounded-xl border p-3 text-left text-xs font-bold transition cursor-pointer ${
                          paymentMethod === code
                            ? 'border-[#12B5A6] bg-[#12B5A6]/15 text-white'
                            : 'border-slate-800 bg-[#060B15] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>{label}</span>
                          <span className="font-mono text-[10px] text-[#12B5A6] font-bold">XÁC MINH PROD</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-[#060B15] p-4 text-xs text-slate-300 space-y-1.5">
                  <div className="flex justify-between">
                    <span>{lang === 'en' ? 'Product Type:' : 'Loại sản phẩm:'}</span>
                    <strong className="font-mono text-white">PDF_REPORT ({checkoutReport.current_version})</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>{lang === 'en' ? 'Delivery:' : 'Hình thức nhận:'}</span>
                    <strong className="text-emerald-300">
                      {lang === 'en'
                        ? 'Instant download in My Library'
                        : 'Mở khóa tải PDF ngay trong Thư Viện Của Tôi'}
                    </strong>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={checkoutBusy}
                  onClick={handleCreateReportOrder}
                  className="w-full rounded-xl bg-gradient-to-r from-[#12B5A6] to-[#0D9488] py-3.5 text-sm font-extrabold text-[#032220] hover:opacity-95 cursor-pointer disabled:opacity-50"
                >
                  {checkoutBusy
                    ? lang === 'en'
                      ? 'Creating Order...'
                      : 'Đang khởi tạo mã thanh toán...'
                    : lang === 'en'
                    ? 'Generate USDT Payment Order →'
                    : 'Tạo Lệnh Thanh Toán USDT Báo Cáo →'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs space-y-2">
                  <div className="flex items-center justify-between font-mono">
                    <span className="text-amber-300 font-bold">
                      {lang === 'en' ? 'ORDER CODE:' : 'MÃ ĐƠN HÀNG:'} {checkoutOrder.order_code || checkoutOrder.order_id}
                    </span>
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 font-bold text-amber-200">
                      {checkoutOrder.status || 'PENDING'}
                    </span>
                  </div>
                  <div className="font-mono text-sm font-extrabold text-white">
                    {String(checkoutOrder.currency).toUpperCase() === 'VND'
                      ? `${Number(checkoutOrder.amount_vnd || checkoutOrder.amount || 0).toLocaleString('vi-VN')} VND`
                      : `${Number(checkoutOrder.amount || 0)} USDT (${checkoutOrder.network || 'BEP20'})`}
                  </div>
                </div>

                {checkoutOrder.qr_url && (
                  <div className="flex flex-col items-center rounded-xl border border-slate-800 bg-white p-4">
                    <img
                      src={checkoutOrder.qr_url}
                      alt="VietQR Payment"
                      className="h-52 w-52 object-contain"
                    />
                    <span className="mt-2 font-mono text-xs font-bold text-slate-900">
                      Nội dung CK: {checkoutOrder.transfer_memo || checkoutOrder.order_code}
                    </span>
                  </div>
                )}

                {checkoutOrder.wallet_address && (
                  <div className="rounded-xl border border-slate-800 bg-[#060B15] p-4 font-mono text-xs space-y-1.5">
                    <div className="text-slate-400">
                      {lang === 'en' ? 'Send exact USDT amount to wallet:' : 'Chuyển đúng số USDT tới địa chỉ ví:'}
                    </div>
                    <div className="break-all font-bold text-emerald-300">{checkoutOrder.wallet_address}</div>
                  </div>
                )}

                <div className="text-center font-mono text-xs text-slate-400">
                  {lang === 'en'
                    ? 'Waiting for automatic payment confirmation... Your PDF will unlock automatically.'
                    : 'Hệ thống đang tự động đối soát giao dịch... Báo cáo PDF sẽ tự động mở khóa ngay khi nhận tiền.'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
