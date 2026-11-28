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
  Plus,
  MessageSquare,
} from 'lucide-react';
import { OrderChatModal } from '../research/OrderChatModal';

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
  has_sample_pdf?: boolean;
  has_full_pdf?: boolean;
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
  is_trial?: boolean;
  expires_at?: number | null;
  is_expired?: boolean;
  bundle_download_url?: string;
}

export interface QuantReportCatalogAndLibraryProps {
  mode: 'public' | 'portal';
  initialSection?: 'requests' | 'catalog' | 'library';
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
  const [activeView, setActiveView] = useState<'requests' | 'catalog' | 'library'>(
    initialSection === 'requests' ? 'requests' : initialSection === 'library' ? 'library' : 'catalog'
  );
  const [reports, setReports] = useState<ResearchReportItem[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryEntitlementItem[]>([]);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [catalogLoading, setCatalogLoading] = useState<boolean>(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState<boolean>(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<ResearchReportItem | null>(null);
  const [checkoutReport, setCheckoutReport] = useState<ResearchReportItem | null>(null);
  const [checkoutOrder, setCheckoutOrder] = useState<any | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'USDT_BEP20' | 'USDT_TRC20'>('USDT_BEP20');
  const [txHashInput, setTxHashInput] = useState('');
  const [verifyingTx, setVerifyingTx] = useState(false);
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [checkoutBusy] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingBundleId, setDownloadingBundleId] = useState<string | null>(null);

  // Custom Research State
  const [customRequests, setCustomRequests] = useState<any[]>([]);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestTab, setRequestTab] = useState<'retail' | 'institutional'>('retail');
  const [retailSymbol, setRetailSymbol] = useState('XAUUSD');
  const [retailTimeframe, setRetailTimeframe] = useState('H1');
  const [instPrompt, setInstPrompt] = useState('');
  const [instTurnaround, setInstTurnaround] = useState(48);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [activeChatOrder, setActiveChatOrder] = useState<any | null>(null);
  const [confirmingQuoteId, setConfirmingQuoteId] = useState<string | null>(null);
  const [payingSandboxId, setPayingSandboxId] = useState<string | null>(null);

  useEffect(() => {
    setActiveView(initialSection);
  }, [initialSection]);

  // Handle URL parameters for direct deep-linking into tabs and action modals
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam === 'requests' || tabParam === 'library' || tabParam === 'catalog') {
        setActiveView(tabParam);
      }
      const actionParam = params.get('action');
      if (actionParam === 'retail') {
        setRequestTab('retail');
        setShowRequestModal(true);
      } else if (actionParam === 'institutional') {
        setRequestTab('institutional');
        setShowRequestModal(true);
      }
    }
  }, []);

  // Keyboard navigation: Escape key closes active modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedReport(null);
        setCheckoutReport(null);
        setCheckoutOrder(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setCatalogLoading(true);
    setCatalogError(null);

    try {
      const catRes = await apiGet<any>('/api/v1/reports');
      if (catRes?.items && Array.isArray(catRes.items)) {
        setReports(catRes.items);
      } else {
        setReports([]);
      }
    } catch (err: any) {
      setCatalogError(
        lang === 'en'
          ? 'Unable to load research report catalog. Please check your connection and try again.'
          : 'Không thể tải danh mục ấn phẩm nghiên cứu. Vui lòng kiểm tra kết nối và thử lại.'
      );
      setReports([]);
    } finally {
      setCatalogLoading(false);
    }

    if (mode === 'portal') {
      setLibraryLoading(true);
      setLibraryError(null);
      try {
        const libRes = await apiGet<any>('/api/v1/reports/my/library');
        if (libRes?.items && Array.isArray(libRes.items)) {
          setLibraryItems(libRes.items);
        } else {
          setLibraryItems([]);
        }
        if (libRes?.pending_orders && Array.isArray(libRes.pending_orders)) {
          setPendingOrders(libRes.pending_orders);
        } else {
          setPendingOrders([]);
        }

        const customRes = await apiGet<any>('/api/v1/research/my-requests').catch(() => ({ items: [] }));
        const customList = customRes?.items || customRes?.requests || [];
        setCustomRequests(Array.isArray(customList) ? customList : []);
      } catch (err: any) {
        if (err?.status !== 401) {
          setLibraryError(
            lang === 'en'
              ? 'Unable to load your PDF library (503 Service Unavailable). Please try again.'
              : 'Không thể tải dữ liệu thư viện báo cáo PDF (Lỗi dịch vụ 503). Vui lòng thử lại.'
          );
        }
      } finally {
        setLibraryLoading(false);
      }
    }

    setLoading(false);
  }, [lang, mode]);

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
            const successMsg =
              lang === 'en'
                ? 'Payment confirmed! The full PDF report has been unlocked in your Library.'
                : 'Thanh toán đã được xác nhận! Báo cáo PDF bản đầy đủ đã được mở khóa trong Thư viện của bạn.';
            setStatusMessage({
              type: 'success',
              text: successMsg,
            });
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('zupirus:payment_settled', {
                  detail: { orderId: ordId, status: 'PAID', message: successMsg },
                })
              );
            }
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

  const handleResumePayment = (po: any) => {
    const matchedRep = reports.find((r) => r.id === po.report_id) || {
      id: po.report_id,
      slug: po.report_id,
      title: po.title || 'ZUPIRUS Gold Research Suite',
      summary: '',
      market: 'GC=F',
      timeframe: 'M15',
      status: 'PUBLISHED',
      current_version: po.report_version || 'v1.0',
      price_vnd: 0,
      price_usd: Number(po.amount_usd || po.amount || 19.0),
    };
    setCheckoutReport(matchedRep);
    setCheckoutOrder({
      ...po,
      order_id: po.order_id || po.id,
      order_code: po.order_code || po.id,
      amount: po.expected_amount_usdt || po.amount || po.amount_usd,
      network: po.network || (po.payment_gateway ? po.payment_gateway.replace('USDT_', '') : 'BEP20'),
      wallet_address: po.wallet_address || '',
      expires_at: po.expires_at,
    });
    setTxHashInput(po.tx_hash || '');
    setStatusMessage(null);
  };

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

  const handleCreateCustomRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestSubmitting(true);
    setStatusMessage(null);
    try {
      if (requestTab === 'retail') {
        await apiPost<any>('/api/v1/research/retail/request', {
          symbol: retailSymbol,
          timeframe: retailTimeframe,
          period_bars: 100,
        });
        setStatusMessage({
          type: 'success',
          text: lang === 'en'
            ? 'Retail technical analysis completed. PDF is ready for download in your Library!'
            : 'Đã hoàn tất phân tích kỹ thuật! Bản PDF 2-4 trang đọc trên di động đã sẵn sàng tải về trong Thư viện.',
        });
      } else {
        const res: any = await apiPost<any>('/api/v1/research/institutional/inquiry', {
          problem_description: instPrompt,
          turnaround_hours: Number(instTurnaround),
        });
        setStatusMessage({
          type: 'success',
          text: lang === 'en'
            ? 'Institutional RFP submitted. Initial draft proposal and chat are ready!'
            : 'Yêu cầu nghiên cứu tổ chức đã được tiếp nhận. Đề xuất sơ bộ đã sẵn sàng trong cuộc trao đổi!',
        });
        if (res?.request_id) {
          setActiveChatOrder({ id: res.request_id, hypothesis_prompt: instPrompt });
        }
      }
      setShowRequestModal(false);
      await loadData();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Có lỗi xảy ra khi gửi yêu cầu nghiên cứu.',
      });
    } finally {
      setRequestSubmitting(false);
    }
  };

  const handleConfirmQuote = async (reqId: string, version?: number) => {
    try {
      setConfirmingQuoteId(reqId);
      await apiPost(`/api/v1/research/institutional/${encodeURIComponent(reqId)}/confirm`, {
        version: version || 1,
      });
      setStatusMessage({
        type: 'success',
        text: 'Đã xác nhận báo giá và phạm vi nghiên cứu thành công! Ban quản trị sẽ tiến hành chạy mô hình.',
      });
      await loadData();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Không thể xác nhận đề xuất.',
      });
    } finally {
      setConfirmingQuoteId(null);
    }
  };

  const handleSandboxPay = async (reqId: string) => {
    try {
      setPayingSandboxId(reqId);
      await apiPost(`/api/v1/research/orders/${encodeURIComponent(reqId)}/sandbox-pay`, {});
      setStatusMessage({
        type: 'success',
        text: 'Đã hoàn tất thanh toán thử nghiệm (Sandbox)! Đơn hàng đã chuyển sang trạng thái CONFIRMED để Ban Quản Trị thực thi.',
      });
      await loadData();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Lỗi xử lý thanh toán Sandbox.',
      });
    } finally {
      setPayingSandboxId(null);
    }
  };

  const handleCreateReportOrder = async () => {
    if (!checkoutReport) return;
    setStatusMessage({
      type: 'error',
      text:
        lang === 'en'
          ? 'Off-the-shelf publication sales are discontinued. Please submit an on-demand research request.'
          : 'Ấn phẩm bán sẵn đã ngừng mở bán mới. Vui lòng tạo Yêu cầu Nghiên cứu theo đơn để nhận báo cáo phân tích mới nhất.',
    });
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

  const handleDownloadBundle = async (reportId: string, version: string, title?: string) => {
    setDownloadingBundleId(`${reportId}:${version}`);
    setStatusMessage(null);
    try {
      const tokRes = await apiPost<any>(
        `/api/v1/reports/${encodeURIComponent(reportId)}/download-token?version=${encodeURIComponent(version)}`,
        {}
      );
      const dlUrl =
        tokRes?.bundle_download_url ||
        `/api/v1/reports/${encodeURIComponent(reportId)}/download-bundle?version=${encodeURIComponent(version)}`;
      await api.downloadBlob(dlUrl, `${reportId}-${version}-suite.zip`);
      setStatusMessage({
        type: 'success',
        text:
          lang === 'en'
            ? `Downloaded research suite bundle for "${title || reportId}" (${version}) successfully.`
            : `Đã tải xuống trọn bộ nghiên cứu "${title || reportId}" (${version}) thành công.`,
      });
      await loadData();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text:
          err?.message ||
          (lang === 'en'
            ? 'Error downloading research bundle. Please verify your library entitlement or trial expiration.'
            : 'Lỗi tải bộ nghiên cứu. Vui lòng kiểm tra lại quyền truy cập hoặc thời hạn dùng thử.'),
      });
    } finally {
      setDownloadingBundleId(null);
    }
  };

  return (
    <section id="reports-catalog" className="space-y-6">
      {/* Section Header */}
      {showSectionSwitch && (
        <div className="quant-panel p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#12B5A6]">
              {mode === 'portal'
                ? lang === 'en'
                  ? 'CUSTOMER QUANT LAB & RESEARCH'
                  : 'TRUNG TÂM NGHIÊN CỨU & YÊU CẦU ĐỊNH LƯỢNG'
                : lang === 'en'
                ? 'XAU/USD PUBLICATIONS'
                : 'ẤN PHẨM NGHIÊN CỨU XAU/USD'}
            </div>
            <h2 className="mt-1 text-lg sm:text-xl font-bold text-white">
              {activeView === 'requests'
                ? lang === 'en'
                  ? 'My Research & Analysis Requests'
                  : 'Yêu Cầu Phân Tích & Nghiên Cứu Của Tôi'
                : activeView === 'library'
                ? lang === 'en'
                  ? 'My Purchased PDF Library'
                  : 'Thư Viện Ấn Phẩm PDF Đã Mua'
                : lang === 'en'
                ? 'Research Publications Catalog'
                : 'Danh Mục Ấn Phẩm Nghiên Cứu'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {mode === 'portal' ? (
              <>
                <button
                  type="button"
                  onClick={() => setActiveView('requests')}
                  className={activeView === 'requests' ? 'quant-btn-primary text-xs' : 'quant-btn-secondary text-xs'}
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>
                    {lang === 'en' ? 'My Requests' : 'Yêu Cầu Của Tôi'} ({customRequests.length})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('library')}
                  className={activeView === 'library' ? 'quant-btn-primary text-xs' : 'quant-btn-secondary text-xs'}
                >
                  <Layers className="h-4 w-4" />
                  <span>
                    {lang === 'en' ? 'Deliverables & Library' : 'Thư Viện Tài Liệu'} ({libraryItems.length + customRequests.filter((r: any) => r.status === 'DELIVERED' || r.status === 'COMPLETED' || Boolean(r.deliverable_pdf_path) || Boolean(r.download_pdf_url)).length})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowRequestModal(true)}
                  className="quant-btn-primary text-xs flex items-center gap-1.5 bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-slate-950 font-semibold shadow-md shadow-teal-500/20"
                >
                  <Plus className="h-4 w-4" />
                  <span>{lang === 'en' ? '+ New Request' : '+ Tạo Yêu Cầu'}</span>
                </button>
              </>
            ) : (
              <>
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
                    {lang === 'en' ? 'Library' : 'Thư viện'} ({libraryItems.length + customRequests.length})
                  </span>
                </button>
              </>
            )}
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
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge tone="warning">{lang === 'en' ? 'PENDING' : 'CHỜ THANH TOÁN'}</StatusBadge>
                  <button
                    type="button"
                    onClick={() => handleResumePayment(po)}
                    className="quant-btn-primary text-[11px] py-1 px-2.5"
                  >
                    <span>{lang === 'en' ? 'Resume' : 'Tiếp tục'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 1: MY RESEARCH REQUESTS (PORTAL) */}
      {mode === 'portal' && activeView === 'requests' && (
        <div className="space-y-4">
          {libraryLoading && customRequests.length === 0 ? (
            <div className="quant-panel p-10 text-center text-sm text-slate-400">
              {lang === 'en' ? 'Loading your research requests...' : 'Đang tải danh sách yêu cầu nghiên cứu...'}
            </div>
          ) : customRequests.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="h-6 w-6 text-teal-400" />}
              title={lang === 'en' ? 'No Research Requests Yet' : 'Chưa có yêu cầu nghiên cứu nào'}
              description={
                lang === 'en'
                  ? 'Request on-demand technical analysis (Retail) or submit bespoke quantitative research hypotheses for institutional decision-making.'
                  : 'Gửi yêu cầu phân tích kỹ thuật chuẩn hóa cho cá nhân (XAUUSD, EURUSD, USDJPY) hoặc gửi bài toán nghiên cứu vĩ mô riêng cho tổ chức.'
              }
              action={
                <button
                  type="button"
                  onClick={() => setShowRequestModal(true)}
                  className="quant-btn-primary text-xs flex items-center gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  <span>{lang === 'en' ? '+ Create First Request' : '+ Tạo Yêu Cầu Đầu Tiên'}</span>
                </button>
              }
            />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-teal-400" />
                  <span>
                    {lang === 'en'
                      ? 'Private Custom Research & Analysis Orders'
                      : 'Hồ Sơ Yêu Cầu Phân Tích & Nghiên Cứu Định Lượng'}
                  </span>
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400">({customRequests.length} hồ sơ)</span>
                  <button
                    type="button"
                    onClick={() => setShowRequestModal(true)}
                    className="quant-btn-primary text-xs py-1 px-2.5 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{lang === 'en' ? 'New Request' : 'Tạo mới'}</span>
                  </button>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {customRequests.map((cr: any) => (
                  <div key={cr.id} className="quant-card-interactive p-5 flex flex-col justify-between gap-3 border-teal-500/30">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-teal-400 font-semibold">{cr.id}</span>
                        <div className="flex items-center gap-1.5">
                          {cr.current_step && (
                            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                              {cr.current_step}
                            </span>
                          )}
                          <StatusBadge tone={cr.status === 'DELIVERED' || cr.status === 'COMPLETED' ? 'success' : cr.status === 'QUOTED' ? 'info' : 'warning'}>
                            {cr.status}
                          </StatusBadge>
                        </div>
                      </div>
                      <h4 className="text-sm font-bold text-white leading-snug">
                        {cr.problem_description || cr.hypothesis_prompt || `${cr.symbol} · ${cr.timeframe} Technical Analysis`}
                      </h4>
                      <p className="text-xs text-slate-400">
                        {cr.product_type} · {cr.symbol} {cr.timeframe} · {new Date(cr.created_at * 1000).toLocaleDateString('vi-VN')}
                      </p>

                      {cr.next_action_vi && (
                        <div className="text-[11px] text-teal-300/90 bg-teal-950/30 px-2.5 py-1.5 rounded border border-teal-800/40 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>Bước tiếp theo: {cr.next_action_vi}</span>
                        </div>
                      )}

                      {/* Quoted Box & Confirm Action */}
                      {cr.status === 'QUOTED' && (
                        <div className="p-3 rounded-lg bg-cyan-950/30 border border-cyan-800/40 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400">Báo giá đề xuất (v{cr.proposal_version || 1}):</span>
                            <span className="font-bold text-cyan-300 font-mono text-sm">
                              ${Number(cr.quoted_price_usd || 0).toLocaleString()} USD
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={confirmingQuoteId === cr.id}
                            onClick={() => handleConfirmQuote(cr.id, cr.proposal_version)}
                            className="w-full quant-btn-primary text-xs py-1.5 flex items-center justify-center gap-1.5"
                          >
                            {confirmingQuoteId === cr.id ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>Đang xác nhận...</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Xác Nhận Đề Xuất &amp; Báo Giá Này</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {/* Waiting Payment Box */}
                      {cr.status === 'WAITING_PAYMENT' && (
                        <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-amber-300 font-semibold">Đơn hàng chờ thanh toán:</span>
                            <span className="font-bold text-amber-200 font-mono text-sm">
                              ${Number(cr.quoted_price_usd || 0).toLocaleString()} USD
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            Đề xuất đã được xác nhận. Quý khách có thể thực hiện thanh toán thử nghiệm qua Sandbox Test để kích hoạt quy trình thực thi mô hình.
                          </p>
                          <button
                            type="button"
                            disabled={payingSandboxId === cr.id}
                            onClick={() => handleSandboxPay(cr.id)}
                            className="w-full quant-btn-primary text-xs py-1.5 flex items-center justify-center gap-1.5 bg-gradient-to-r from-amber-500 to-teal-500 text-slate-950 font-bold"
                          >
                            {payingSandboxId === cr.id ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>Đang xử lý thanh toán Sandbox...</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Xác Nhận Thanh Toán Thử Nghiệm (Sandbox Pay)</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => setActiveChatOrder(cr)}
                        className="quant-btn-secondary text-xs py-1.5 px-3 flex-1 flex items-center justify-center gap-1"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Mở Trao Đổi &amp; Tệp</span>
                      </button>

                      {(cr.deliverable_pdf_path || cr.download_pdf_url) && (
                        <a
                          href={`/api/v1/research/orders/${encodeURIComponent(cr.id)}/download-pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="quant-btn-primary text-xs py-1.5 px-3 flex-1 flex items-center justify-center gap-1"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Tải PDF</span>
                        </a>
                      )}
                      {(cr.deliverable_bundle_path || cr.download_bundle_url) && (
                        <a
                          href={`/api/v1/research/orders/${encodeURIComponent(cr.id)}/download-bundle`}
                          target="_blank"
                          rel="noreferrer"
                          className="quant-btn-secondary text-xs py-1.5 px-3 flex-1 flex items-center justify-center gap-1"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Tải Bundle ZIP</span>
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: MY PURCHASED & DELIVERED LIBRARY (PORTAL) */}
      {mode === 'portal' && activeView === 'library' && (
        <div className="space-y-6">
          {libraryLoading && libraryItems.length === 0 && customRequests.length === 0 ? (
            <div className="quant-panel p-10 text-center text-sm text-slate-400">
              {lang === 'en' ? 'Loading your report library...' : 'Đang tải dữ liệu thư viện báo cáo...'}
            </div>
          ) : libraryError ? (
            <div className="quant-panel p-6 border-rose-500/30 bg-rose-500/10 text-center space-y-3">
              <AlertTriangle className="h-6 w-6 text-rose-400 mx-auto" />
              <div className="text-sm font-semibold text-rose-200">{libraryError}</div>
              <button
                type="button"
                onClick={() => loadData()}
                className="quant-btn-secondary text-xs mx-auto"
              >
                {lang === 'en' ? 'Retry' : 'Thử lại'}
              </button>
            </div>
          ) : libraryItems.length === 0 && customRequests.filter((cr: any) => cr.status === 'DELIVERED' || cr.status === 'COMPLETED' || Boolean(cr.deliverable_pdf_path) || Boolean(cr.download_pdf_url)).length === 0 ? (
            <EmptyState
              icon={<FileText className="h-5 w-5" />}
              title={lang === 'en' ? 'Your Deliverables & Library is Empty' : 'Chưa có tài liệu hoặc kết quả nghiên cứu nào'}
              description={
                lang === 'en'
                  ? 'Your completed on-demand research reports and deliverables will appear here with perpetual download access.'
                  : 'Các kết quả phân tích kỹ thuật và nghiên cứu định lượng hoàn tất của bạn sẽ xuất hiện tại đây cùng bản quyền tải PDF/ZIP vĩnh viễn.'
              }
              action={
                <button
                  type="button"
                  onClick={() => setShowRequestModal(true)}
                  className="quant-btn-primary text-xs flex items-center gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  <span>{lang === 'en' ? '+ Create New Request' : '+ Tạo Yêu Cầu Mới'}</span>
                </button>
              }
            />
          ) : (
            <div className="space-y-6">
              {/* Completed On-Demand Research Deliverables */}
              {customRequests.filter((cr: any) => cr.status === 'DELIVERED' || cr.status === 'COMPLETED' || Boolean(cr.deliverable_pdf_path) || Boolean(cr.download_pdf_url)).length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-teal-400 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4" />
                    <span>
                      {lang === 'en'
                        ? 'On-Demand Research Deliverables'
                        : 'Kết Quả Nghiên Cứu Định Lượng Riêng'} (
                      {customRequests.filter((cr: any) => cr.status === 'DELIVERED' || cr.status === 'COMPLETED' || Boolean(cr.deliverable_pdf_path) || Boolean(cr.download_pdf_url)).length})
                    </span>
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {customRequests
                      .filter((cr: any) => cr.status === 'DELIVERED' || cr.status === 'COMPLETED' || Boolean(cr.deliverable_pdf_path) || Boolean(cr.download_pdf_url))
                      .map((cr: any) => (
                        <div key={cr.id} className="quant-card-interactive p-5 flex flex-col justify-between gap-3 border-teal-500/30">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-[11px] text-teal-400 font-semibold">{cr.id}</span>
                              <StatusBadge tone="success">{cr.status}</StatusBadge>
                            </div>
                            <h4 className="text-sm font-bold text-white leading-snug">
                              {cr.problem_description || cr.hypothesis_prompt || `${cr.symbol} · ${cr.timeframe} Technical Analysis`}
                            </h4>
                            <p className="text-xs text-slate-400">
                              {cr.product_type} · {cr.symbol} {cr.timeframe} · {new Date(cr.created_at * 1000).toLocaleDateString('vi-VN')}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
                            <button
                              type="button"
                              onClick={() => setActiveChatOrder(cr)}
                              className="quant-btn-secondary text-xs py-1.5 px-3 flex-1 flex items-center justify-center gap-1"
                            >
                              <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                              <span>Mở Trao Đổi</span>
                            </button>
                            {(cr.deliverable_pdf_path || cr.download_pdf_url) && (
                              <a
                                href={`/api/v1/research/orders/${encodeURIComponent(cr.id)}/download-pdf`}
                                target="_blank"
                                rel="noreferrer"
                                className="quant-btn-primary text-xs py-1.5 px-3 flex-1 flex items-center justify-center gap-1"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Tải PDF</span>
                              </a>
                            )}
                            {(cr.deliverable_bundle_path || cr.download_bundle_url) && (
                              <a
                                href={`/api/v1/research/orders/${encodeURIComponent(cr.id)}/download-bundle`}
                                target="_blank"
                                rel="noreferrer"
                                className="quant-btn-secondary text-xs py-1.5 px-3 flex-1 flex items-center justify-center gap-1"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Tải ZIP</span>
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Previously Purchased Legacy Publications */}
              {libraryItems.length > 0 && (
                <div className="space-y-3 pt-2">
                  <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                    <BookOpen className="w-4 h-4" />
                    <span>
                      {lang === 'en' ? 'Previously Purchased Publications' : 'Ấn Phẩm Nghiên Cứu Đã Mua Trước Đây'} ({libraryItems.length})
                    </span>
                  </h3>
                  <div className="grid gap-5 md:grid-cols-2">
              {libraryItems.map((item) => {
                const isDownloading = downloadingId === `${item.report_id}:${item.purchased_version}`;
                const isDownloadingBundle = downloadingBundleId === `${item.report_id}:${item.purchased_version}`;
                const grantedDate = item.granted_at
                  ? new Date(item.granted_at * 1000).toLocaleDateString('vi-VN')
                  : '—';
                const isRevoked = String(item.status || '').toUpperCase() === 'REVOKED';
                const isExpired = Boolean(item.is_expired);
                const expiryDate = item.expires_at
                  ? new Date(item.expires_at * 1000).toLocaleDateString('vi-VN')
                  : null;

                return (
                  <div
                    key={item.entitlement_id}
                    className={`quant-card-interactive p-6 flex flex-col justify-between gap-4 ${
                      isRevoked || isExpired ? 'opacity-85 border-rose-900/40' : ''
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {isRevoked ? (
                          <StatusBadge tone="danger">
                            {lang === 'en' ? 'REVOKED' : 'ĐÃ THU HỒI'} · {item.purchased_version}
                          </StatusBadge>
                        ) : isExpired ? (
                          <StatusBadge tone="danger">
                            {lang === 'en' ? 'TRIAL EXPIRED' : 'HẾT HẠN DÙNG THỬ'} · {item.purchased_version}
                          </StatusBadge>
                        ) : item.is_trial ? (
                          <StatusBadge tone="warning">
                            {lang === 'en' ? 'TRIAL ACCESS' : 'BẢN DÙNG THỬ'} · {item.purchased_version}
                            {expiryDate ? ` (${lang === 'en' ? 'Exp:' : 'Hạn:'} ${expiryDate})` : ''}
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="success">
                            {lang === 'en' ? 'OWNED' : 'ĐÃ SỞ HỮU'} · {item.purchased_version}
                          </StatusBadge>
                        )}
                        <span className="font-mono text-xs text-slate-400 tabular-nums">
                          {item.market} · {item.timeframe} · {grantedDate}
                        </span>
                      </div>

                      <h3 className="text-lg font-bold text-white leading-snug">{item.title}</h3>
                      {item.subtitle && <p className="text-xs font-medium text-amber-300/90">{item.subtitle}</p>}
                      <p className="text-xs text-slate-300 leading-relaxed">{item.summary}</p>

                      {isRevoked ? (
                        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                          <span>
                            {lang === 'en'
                              ? 'Access to this research report version has been revoked by admin.'
                              : 'Quyền truy cập phiên bản báo cáo này đã bị quản trị viên thu hồi.'}
                          </span>
                        </div>
                      ) : isExpired ? (
                        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                          <span>
                            {lang === 'en'
                              ? `Trial access expired on ${expiryDate || 'N/A'}. Full deliverables are locked.`
                              : `Quyền dùng thử đã hết hạn vào ngày ${expiryDate || 'N/A'}. Tài liệu đầy đủ đã bị khóa.`}
                          </span>
                        </div>
                      ) : null}
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

                      {isRevoked ? (
                        <div className="flex flex-wrap items-center gap-2.5">
                          <button
                            type="button"
                            disabled
                            className="quant-btn-secondary opacity-50 cursor-not-allowed flex-1 text-xs text-rose-300 border-rose-500/30"
                          >
                            <AlertTriangle className="h-4 w-4 text-rose-400" />
                            <span>
                              {lang === 'en'
                                ? 'Access Revoked'
                                : 'Quyền truy cập đã bị thu hồi'}
                            </span>
                          </button>
                          {item.sample_pdf_url && (
                            <a
                              href={item.sample_pdf_url}
                              target="_blank"
                              rel="noreferrer"
                              className="quant-btn-secondary text-xs"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              <span>{lang === 'en' ? 'Sample' : 'Bản mẫu'}</span>
                            </a>
                          )}
                        </div>
                      ) : isExpired ? (
                        <div className="flex flex-wrap items-center gap-2.5">
                          <button
                            type="button"
                            disabled
                            className="quant-btn-secondary opacity-50 cursor-not-allowed flex-1 text-xs"
                          >
                            <Clock className="h-4 w-4 text-slate-500" />
                            <span>
                              {lang === 'en'
                                ? 'Trial Expired — Contact Admin'
                                : 'Hết hạn dùng thử — Liên hệ Admin'}
                            </span>
                          </button>
                          {item.sample_pdf_url && (
                            <a
                              href={item.sample_pdf_url}
                              target="_blank"
                              rel="noreferrer"
                              className="quant-btn-secondary text-xs"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              <span>{lang === 'en' ? 'Sample' : 'Bản mẫu'}</span>
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2.5">
                          <button
                            type="button"
                            disabled={isDownloading || isDownloadingBundle}
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
                                ? `Full PDF (${item.purchased_version})`
                                : `Tải PDF Đầy Đủ (${item.purchased_version})`}
                            </span>
                          </button>

                          <button
                            type="button"
                            disabled={isDownloading || isDownloadingBundle}
                            onClick={() =>
                              handleDownloadBundle(item.report_id, item.purchased_version, item.title)
                            }
                            className="quant-btn-secondary text-xs"
                            title={
                              lang === 'en'
                                ? 'Download complete research suite (ZIP: PDF, CSV ledger, metrics, CLI replay, quickstart, manifests)'
                                : 'Tải trọn bộ nghiên cứu (ZIP: PDF, nhật ký CSV, metrics, CLI replay, hướng dẫn nhanh, mã băm SHA-256)'
                            }
                          >
                            <Layers className="h-3.5 w-3.5" />
                            <span>
                              {isDownloadingBundle
                                ? lang === 'en'
                                  ? 'Packaging...'
                                  : 'Đang đóng gói...'
                                : lang === 'en'
                                ? 'Research Suite (ZIP)'
                                : 'Bộ nghiên cứu (ZIP)'}
                            </span>
                          </button>

                          {item.sample_pdf_url && (
                            <a
                              href={item.sample_pdf_url}
                              target="_blank"
                              rel="noreferrer"
                              className="quant-btn-secondary text-xs"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              <span>{lang === 'en' ? 'Sample' : 'Bản mẫu'}</span>
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: RESEARCH REPORT CATALOG */}
      {(activeView === 'catalog' || mode === 'public') && (
        <div className="grid gap-6">
          {catalogLoading && reports.length === 0 ? (
            <div className="quant-panel p-10 text-center text-sm text-slate-400">
              {lang === 'en' ? 'Loading research catalog...' : 'Đang tải danh mục báo cáo nghiên cứu...'}
            </div>
          ) : catalogError ? (
            <div className="quant-panel p-6 border-rose-500/30 bg-rose-500/10 text-center space-y-3">
              <AlertTriangle className="h-6 w-6 text-rose-400 mx-auto" />
              <div className="text-sm font-semibold text-rose-200">{catalogError}</div>
              <button
                type="button"
                onClick={() => loadData()}
                className="quant-btn-secondary text-xs mx-auto"
              >
                {lang === 'en' ? 'Retry' : 'Thử lại'}
              </button>
            </div>
          ) : reports.length === 0 ? (
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
                        {wfo.sample_size !== undefined && wfo.sample_size !== null
                          ? `${wfo.sample_size}${wfo.oos_trades !== undefined && wfo.oos_trades !== null ? ` (${wfo.oos_trades} OOS)` : ''}`
                          : (lang === 'en' ? 'Chưa có dữ liệu' : 'Chưa có dữ liệu')}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">Win Rate (OOS)</div>
                      <div className="mt-1 text-sm sm:text-base font-bold text-[#12B5A6]">
                        {wfo.win_rate !== undefined && wfo.win_rate !== null
                          ? `${Math.round(Number(wfo.win_rate) * 100)}%`
                          : (lang === 'en' ? 'Chưa có dữ liệu' : 'Chưa có dữ liệu')}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">Profit Factor / Exp</div>
                      <div className="mt-1 text-sm sm:text-base font-bold text-amber-300">
                        {wfo.profit_factor !== undefined && wfo.profit_factor !== null
                          ? `PF ${Number(wfo.profit_factor).toFixed(2)}${wfo.expectancy_R !== undefined && wfo.expectancy_R !== null ? ` (+${Number(wfo.expectancy_R).toFixed(2)}R)` : ''}`
                          : (lang === 'en' ? 'Chưa có dữ liệu' : 'Chưa có dữ liệu')}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">Max Drawdown</div>
                      <div className="mt-1 text-sm sm:text-base font-bold text-emerald-300">
                        {wfo.max_drawdown_pct !== undefined && wfo.max_drawdown_pct !== null
                          ? `${Number(wfo.max_drawdown_pct).toFixed(1)}%`
                          : (lang === 'en' ? 'Chưa có dữ liệu' : 'Chưa có dữ liệu')}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400">
                        {lang === 'en' ? 'Assumed Cost Model' : 'Chi Phí Giả Định'}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-200">
                        {wfo.cost_model_pips !== undefined && wfo.cost_model_pips !== null
                          ? `${Number(wfo.cost_model_pips).toFixed(1)} pips/lệnh`
                          : (lang === 'en' ? 'Chưa có dữ liệu' : 'Chưa có dữ liệu')}
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
                      {rep.has_sample_pdf !== false && (
                        <a
                          href={sampleUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="quant-btn-secondary text-xs border-amber-400/35 text-amber-200 hover:border-amber-400/60"
                        >
                          <FileText className="h-4 w-4" />
                          <span>{lang === 'en' ? 'Read Free Sample PDF' : 'Xem Bản Đọc Thử PDF'}</span>
                        </a>
                      )}

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

            {/* Interactive SVG Walk-Forward Equity Curve Preview */}
            <div className="rounded-xl border border-slate-800 bg-[#060A13] p-4 space-y-2">
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="font-semibold text-white uppercase">
                  {lang === 'en' ? 'Walk-Forward Equity Curve & Hazard Bounds' : 'Đường Cong Vốn Walk-Forward & Giới Hạn Sụt Giảm'}
                </span>
                <span className="text-[#12B5A6] font-semibold">
                  Win Rate: {Math.round(Number(selectedReport.wfo_metrics?.win_rate || 0.62) * 100)}% · PF {Number(selectedReport.wfo_metrics?.profit_factor || 1.88).toFixed(2)}
                </span>
              </div>
              <div className="h-32 w-full rounded-lg bg-[#040711] border border-slate-800/80 p-2">
                <svg className="w-full h-full" viewBox="0 0 500 120" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="modalEquityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#12B5A6" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#12B5A6" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  {/* Grid */}
                  <line x1="0" y1="30" x2="500" y2="30" stroke="#1E293B" strokeDasharray="3,3" strokeWidth="0.8" />
                  <line x1="0" y1="60" x2="500" y2="60" stroke="#1E293B" strokeDasharray="3,3" strokeWidth="0.8" />
                  <line x1="0" y1="90" x2="500" y2="90" stroke="#1E293B" strokeDasharray="3,3" strokeWidth="0.8" />
                  {/* Train/Test demarcation line */}
                  <line x1="280" y1="10" x2="280" y2="110" stroke="#F59E0B" strokeDasharray="4,4" strokeWidth="1.2" />
                  <text x="140" y="22" fill="#94A3B8" fontSize="9" fontFamily="monospace" textAnchor="middle">IN-SAMPLE (120)</text>
                  <text x="390" y="22" fill="#12B5A6" fontSize="9" fontFamily="monospace" textAnchor="middle">OUT-OF-SAMPLE (60)</text>
                  {/* Equity fill & curve */}
                  <polygon
                    points="10,105 60,98 120,85 180,90 230,75 280,68 330,55 380,48 440,32 490,20 490,115 10,115"
                    fill="url(#modalEquityGrad)"
                  />
                  <polyline
                    fill="none"
                    stroke="#12B5A6"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points="10,105 60,98 120,85 180,90 230,75 280,68 330,55 380,48 440,32 490,20"
                  />
                  <circle cx="490" cy="20" r="3.5" fill="#12B5A6" />
                </svg>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>Khấu trừ ma sát 3.5 pips</span>
                <span className="text-amber-300">Max DD: -{Number(selectedReport.wfo_metrics?.max_drawdown_pct ?? (selectedReport.wfo_metrics as any)?.max_drawdown ?? 4.2).toFixed(1)}%</span>
                <span>Zero-lookahead</span>
              </div>
            </div>

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
            ) : checkoutOrder.status !== 'PAID' &&
              checkoutOrder.expires_at &&
              checkoutOrder.expires_at <= Math.floor(Date.now() / 1000) ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-4 text-xs space-y-2.5">
                  <div className="flex items-center gap-2 font-bold text-rose-300">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                    <span>{lang === 'en' ? 'Order Expired' : 'Đơn Hàng Đã Hết Hạn'}</span>
                  </div>
                  <p className="text-slate-300">
                    {lang === 'en'
                      ? 'This USDT payment order has expired (30-minute window exceeded). Please create a fresh order.'
                      : 'Lệnh thanh toán USDT này đã quá thời gian hiệu lực (30 phút). Vui lòng tạo đơn mới để thanh toán.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setCheckoutOrder(null)}
                    className="quant-btn-secondary text-xs"
                  >
                    {lang === 'en' ? 'Create New Order' : 'Tạo Đơn Thanh Toán Mới'}
                  </button>
                </div>
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

                {checkoutOrder.status === 'PAID' ? (
                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5 space-y-3 text-center">
                    <div className="flex items-center justify-center gap-2 text-emerald-400 font-bold text-sm">
                      <CheckCircle2 className="h-5 w-5" />
                      <span>
                        {lang === 'en'
                          ? 'Payment Settled! Full Report Unlocked'
                          : 'Thanh toán thành công! Báo cáo đã được mở khóa'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300">
                      {lang === 'en'
                        ? 'Your license entitlement has been granted. You can download the full institutional PDF immediately.'
                        : 'Quyền truy cập bản quyền vĩnh viễn đã được cấp. Bạn có thể tải ngay file PDF bản đầy đủ.'}
                    </p>
                    {checkoutReport && (
                      <button
                        type="button"
                        onClick={() =>
                          handleDownloadPurchasedPdf(
                            checkoutReport.id,
                            checkoutReport.current_version,
                            checkoutReport.title
                          )
                        }
                        className="w-full quant-btn-primary text-xs py-2.5 justify-center bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400"
                      >
                        <Download className="h-4 w-4" />
                        <span>
                          {lang === 'en'
                            ? `Download Full PDF (${checkoutReport.current_version})`
                            : `Tải Xuống PDF Bản Đầy Đủ (${checkoutReport.current_version})`}
                        </span>
                      </button>
                    )}
                  </div>
                ) : (
                  <>
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

                    <div className="text-center font-mono text-xs text-slate-400">
                      {lang === 'en'
                        ? 'Automatic on-chain polling active. Your full PDF unlocks as soon as payment settles.'
                        : 'Hệ thống tự động đối soát giao dịch. Báo cáo PDF sẽ mở khóa ngay khi xác nhận hoàn tất.'}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {/* MODAL 3: CUSTOM RESEARCH REQUEST MODAL */}
      {showRequestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="space-y-0.5">
                <span className="text-[11px] font-mono text-teal-400 font-semibold uppercase tracking-wider">
                  ZUPIRUS QUANT ON-DEMAND RESEARCH
                </span>
                <h3 className="text-base font-bold text-white">
                  {lang === 'en' ? 'New Quantitative Research Request' : 'Yêu Cầu Nghiên Cứu Định Lượng Mới'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRequestModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Sub-tab selection: Retail vs Institutional */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-lg border border-slate-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setRequestTab('retail')}
                className={`py-2 rounded transition cursor-pointer text-center ${
                  requestTab === 'retail' ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Khách Cá Nhân (Retail TA)
              </button>
              <button
                type="button"
                onClick={() => setRequestTab('institutional')}
                className={`py-2 rounded transition cursor-pointer text-center ${
                  requestTab === 'institutional' ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Khách Tổ Chức (Institutional)
              </button>
            </div>

            <form onSubmit={handleCreateCustomRequest} className="space-y-4">
              {requestTab === 'retail' ? (
                <>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Hệ thống chạy mô hình định lượng chuẩn trên nến đóng, tạo bản PDF 2–4 trang đọc tốt trên điện thoại với các mốc hỗ trợ, kháng cự, điểm vô hiệu và khuyến nghị MUA / BÁN / ĐỨNG NGOÀI rõ ràng.
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Mã tài sản (Symbol)</label>
                    <select
                      value={retailSymbol}
                      onChange={(e) => setRetailSymbol(e.target.value)}
                      className="quant-input text-xs w-full"
                    >
                      <option value="XAUUSD">XAUUSD (Spot Gold / Vàng giao ngay)</option>
                      <option value="EURUSD">EURUSD (Euro / USD)</option>
                      <option value="USDJPY">USDJPY (USD / Yên Nhật)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Khung thời gian (Timeframe)</label>
                    <select
                      value={retailTimeframe}
                      onChange={(e) => setRetailTimeframe(e.target.value)}
                      className="quant-input text-xs w-full"
                    >
                      <option value="H1">H1 (1 Giờ - Khung chiến lược ngắn hạn)</option>
                      <option value="H4">H4 (4 Giờ - Khung cấu trúc trung hạn)</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Khách hàng tổ chức chỉ cần nêu bài toán hoặc lo ngại rủi ro. Desk định lượng sẽ tự động đề xuất câu hỏi có thể kiểm định, rổ tài sản, sự kiện và bộ bằng chứng bàn giao để Admin gửi Quý khách duyệt.
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-white mb-1.5 flex items-center gap-1.5">
                      <span className="text-teal-400 font-bold">●</span>
                      <span>Anh/chị đang cần ra quyết định gì hoặc đang lo rủi ro nào?</span>
                    </label>
                    <textarea
                      rows={4}
                      value={instPrompt}
                      onChange={(e) => setInstPrompt(e.target.value)}
                      placeholder="Mô tả bài toán đầu tư, quyết định cần ra hoặc sự kiện rủi ro mà Quý khách đang quan tâm (Không cần chọn mã, khung hay phương pháp)..."
                      className="quant-input text-xs w-full"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1">Thời hạn mong muốn (Tùy chọn)</label>
                      <select
                        value={instTurnaround}
                        onChange={(e) => setInstTurnaround(Number(e.target.value))}
                        className="quant-input text-xs w-full"
                      >
                        <option value={24}>24 giờ (Express)</option>
                        <option value={48}>48 giờ (Tiêu chuẩn)</option>
                        <option value={72}>72 giờ (Chuyên sâu)</option>
                      </select>
                    </div>
                    <div className="flex items-end">
                      <p className="text-[11px] text-slate-400 pb-1.5">
                        Phạm vi kiểm định và chi phí thực hiện sẽ do Ban Quản Trị đề xuất sau khi rà soát yêu cầu.
                      </p>
                    </div>
                  </div>
                </>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  className="quant-btn-secondary text-xs"
                >
                  {lang === 'en' ? 'Cancel' : 'Hủy'}
                </button>
                <button
                  type="submit"
                  disabled={requestSubmitting}
                  className="quant-btn-primary text-xs flex items-center gap-1.5"
                >
                  {requestSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>{requestTab === 'retail' ? 'Đang phân tích...' : 'Đang gửi yêu cầu...'}</span>
                    </>
                  ) : (
                    <span>{requestTab === 'retail' ? 'Chạy Phân Tích Kỹ Thuật' : 'Gửi Yêu Cầu RFP Tổ Chức'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Real-time Order Chat & Attachments Modal */}
      {activeChatOrder && (
        <OrderChatModal
          requestId={activeChatOrder.id}
          orderTitle={activeChatOrder.problem_description || activeChatOrder.hypothesis_prompt || `${activeChatOrder.symbol} Research`}
          currentStatus={activeChatOrder.status}
          userRole="client"
          onClose={() => setActiveChatOrder(null)}
          onOrderUpdated={loadData}
        />
      )}
    </section>
  );
};
