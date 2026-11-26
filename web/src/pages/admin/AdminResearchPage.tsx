import React, { useState, useEffect, useCallback } from 'react';
import {
  apiGet,
  fetchStrategyReviewQueue,
  approveStrategy,
  rejectStrategy,
  StrategyReviewQueueItem,
} from '../../api/client';
import { ToastNotification } from '../../components/ToastNotification';
import { AdminAiOverviewPanel } from '../../components/admin/AdminAiOverviewPanel';
import { AdminAiKnowledgePanel } from '../../components/admin/AdminAiKnowledgePanel';
import { AdminAiManualOverrideDrawer } from '../../components/admin/AdminAiManualOverrideDrawer';
import { AdminErrorBanner, AdminErrorInfo } from '../../components/AdminErrorBanner';
import { Panel, StatusBadge } from '../../components/ui/Primitives';
import { useLanguage } from '../../i18n/LanguageContext';
import { Check, FlaskConical, RefreshCw, X } from 'lucide-react';

export const AdminResearchPage: React.FC = () => {
  const { lang } = useLanguage();
  const [evo, setEvo] = useState<any>({});
  const [geminiPool, setGeminiPool] = useState<any[]>([]);
  const [ingestedList, setIngestedList] = useState<any[]>([]);
  const [reviewQueue, setReviewQueue] = useState<StrategyReviewQueueItem[]>([]);
  const [msg, setMsg] = useState<string>('');
  const [busyCandId, setBusyCandId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'overview' | 'knowledge'>('overview');
  const [errorBanner, setErrorBanner] = useState<AdminErrorInfo | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [eData, gData, iData, qData] = await Promise.all([
        apiGet('/api/v1/telemetry/ai-evolution'),
        apiGet('/api/admin/gemini/keys'),
        apiGet('/api/admin/skills/ingested'),
        fetchStrategyReviewQueue().catch(() => ({ total: 0, queue: [] })),
      ]);
      if (eData) setEvo(eData);
      if (gData) setGeminiPool(gData.keys || []);
      if (iData) setIngestedList(iData.skills || iData.ingested_skills || []);
      if (qData?.queue) setReviewQueue(qData.queue);
      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner({
        status: err?.status,
        message: err?.message || 'Không thể đồng bộ dữ liệu nghiên cứu & kho tri thức.',
      });
    }
  }, []);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 20000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const handleDecision = async (candId: string, action: 'approve' | 'reject') => {
    setBusyCandId(candId);
    try {
      const res = action === 'approve' ? await approveStrategy(candId) : await rejectStrategy(candId);
      setMsg(res.message || `Đã ${action === 'approve' ? 'phê duyệt' : 'từ chối'} ứng viên #${candId}.`);
      await loadAll();
    } catch (err: any) {
      setMsg(`Lỗi xử lý: ${err?.message || ''}`);
    } finally {
      setBusyCandId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="quant-heading">
        <div className="space-y-1">
          <div className="font-mono text-xs uppercase tracking-wider text-cyan-400">
            {lang === 'en' ? 'ADMIN CONSOLE · WFO RESEARCH & AI' : 'TRẠM QUẢN TRỊ · NGHIÊN CỨU WFO & AI'}
          </div>
          <h1>
            {lang === 'en'
              ? 'Walk-Forward Validation & Knowledge Lab'
              : 'Kiểm Định Walk-Forward & Kho Tri Thức'}
          </h1>
          <p className="text-sm text-slate-400 m-0">
            {lang === 'en'
              ? 'Review out-of-sample candidates, manage research documents, and control AI quota limits.'
              : 'Phê duyệt ứng viên chiến lược WFO, nạp tài liệu tri thức và quản trị hạn mức API.'}
          </p>
        </div>

        <button type="button" onClick={loadAll} className="quant-quiet text-xs">
          <RefreshCw className="h-3.5 w-3.5" />
          <span>{lang === 'en' ? 'Refresh' : 'Làm mới'}</span>
        </button>
      </div>

      <ToastNotification message={msg || null} type="info" onClose={() => setMsg('')} />
      <AdminErrorBanner error={errorBanner} onRetry={loadAll} onDismiss={() => setErrorBanner(null)} />

      {/* WFO REVIEW QUEUE (Directly integrated on Research page) */}
      {reviewQueue.length > 0 && (
        <Panel
          icon={<FlaskConical className="h-4 w-4 text-amber-300" />}
          title={`Hàng Đợi Phê Duyệt WFO (${reviewQueue.length})`}
          subtitle="So sánh chỉ số ngoài mẫu của ứng viên mới trước khi đưa vào xuất bản"
        >
          <div className="space-y-3">
            {reviewQueue.map((item) => {
              const c = item.candidate;
              const isBusy = busyCandId === c.id;
              return (
                <div
                  key={c.id}
                  className="rounded-xl border border-amber-500/30 bg-[#060A13] p-4 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusBadge tone="warning">WAITING_APPROVAL</StatusBadge>
                      <span className="font-semibold text-white text-sm">{c.name}</span>
                    </div>
                    <div className="font-mono text-xs text-slate-300 tabular-nums">
                      Win Rate: <strong className="text-[#12B5A6]">{Math.round((c.win_rate || 0) * 100)}%</strong> · PF:{' '}
                      <strong className="text-amber-300">{c.profit_factor}</strong> · Max DD:{' '}
                      <strong className="text-rose-300">{c.max_drawdown_pct}%</strong> · Samples: {c.sample_size}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDecision(c.id, 'reject')}
                      className="quant-btn-danger min-h-[34px] px-3 py-1.5 text-xs"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Từ chối</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDecision(c.id, 'approve')}
                      className="quant-btn-primary min-h-[34px] px-3.5 py-1.5 text-xs"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>Phê duyệt</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* UNDERLINE SUB-TABS */}
      <div className="border-b border-slate-800 flex items-center gap-8">
        <button
          type="button"
          onClick={() => setActiveSection('overview')}
          className={`pb-3 text-sm font-semibold transition cursor-pointer relative ${
            activeSection === 'overview' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>Tổng Quan &amp; Lịch Sử Phiên Bản</span>
          {activeSection === 'overview' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('knowledge')}
          className={`pb-3 text-sm font-semibold transition cursor-pointer relative ${
            activeSection === 'knowledge' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>Kho Tri Thức &amp; API Keys ({ingestedList.length})</span>
          {activeSection === 'knowledge' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400" />
          )}
        </button>
      </div>

      {activeSection === 'overview' ? (
        <AdminAiOverviewPanel evo={evo} geminiPool={geminiPool} onRefresh={loadAll} setMsg={setMsg} />
      ) : (
        <AdminAiKnowledgePanel
          geminiPool={geminiPool}
          ingestedList={ingestedList}
          onRefresh={loadAll}
          setMsg={setMsg}
        />
      )}

      <AdminAiManualOverrideDrawer onRefresh={loadAll} setMsg={setMsg} />
    </div>
  );
};
