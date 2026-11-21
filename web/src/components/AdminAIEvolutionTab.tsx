import React, { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../api/client';
import { ToastNotification } from './ToastNotification';
import { AdminAiOverviewPanel } from './AdminAiOverviewPanel';
import { AdminAiKnowledgePanel } from './AdminAiKnowledgePanel';
import { AdminAiManualOverrideDrawer } from './AdminAiManualOverrideDrawer';
import { AdminErrorBanner, AdminErrorInfo } from './AdminErrorBanner';

export const AdminAIEvolutionTab: React.FC = () => {
  const [evo, setEvo] = useState<any>({});
  const [geminiPool, setGeminiPool] = useState<any[]>([]);
  const [ingestedList, setIngestedList] = useState<any[]>([]);
  const [msg, setMsg] = useState<string>('');
  const [activeSection, setActiveSection] = useState<'overview' | 'knowledge'>('overview');
  const [errorBanner, setErrorBanner] = useState<AdminErrorInfo | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [eData, gData, iData] = await Promise.all([
        apiGet('/api/v1/telemetry/ai-evolution'),
        apiGet('/api/admin/gemini/keys'),
        apiGet('/api/admin/skills/ingested'),
      ]);
      if (eData) setEvo(eData);
      if (gData) setGeminiPool(gData.keys || []);
      if (iData) setIngestedList(iData.skills || iData.ingested_skills || []);
      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner({
        status: err?.status,
        message: err?.message || 'Không thể đồng bộ dữ liệu tiến hóa AI & kho tri thức.',
      });
    }
  }, []);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 12000);
    return () => clearInterval(timer);
  }, [loadAll]);

  return (
    <div className="space-y-6">
      <ToastNotification message={msg || null} type="info" onClose={() => setMsg('')} />

      {/* ERROR BANNER */}
      <AdminErrorBanner
        error={errorBanner}
        onRetry={loadAll}
        onDismiss={() => setErrorBanner(null)}
      />

      {/* TOP HEADER & UNDERLINE SUB-TABS */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-1">
        <div className="flex items-center gap-8">
          <button
            type="button"
            onClick={() => setActiveSection('overview')}
            className={`pb-3 text-sm font-semibold transition cursor-pointer relative ${
              activeSection === 'overview'
                ? 'text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Tổng Quan &amp; Duyệt Chiến Lược</span>
            {(evo?.wfo_candidates?.length || 0) > 0 && (
              <span className="ml-2 rounded-full bg-[#12B5A6]/20 px-2 py-0.5 font-mono text-[10px] text-[#12B5A6]">
                {evo.wfo_candidates.length} chờ duyệt
              </span>
            )}
            {activeSection === 'overview' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#12B5A6]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('knowledge')}
            className={`pb-3 text-sm font-semibold transition cursor-pointer relative ${
              activeSection === 'knowledge'
                ? 'text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Kho Tri Thức &amp; API Keys</span>
            {ingestedList.length > 0 && (
              <span className="ml-2 rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                {ingestedList.length} tài liệu
              </span>
            )}
            {activeSection === 'knowledge' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#12B5A6]" />
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={loadAll}
          className="rounded-xl border border-slate-800 bg-[#080E1A] px-3.5 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer font-mono flex items-center gap-1.5 transition"
        >
          <span>↺</span>
          <span>Làm mới</span>
        </button>
      </div>

      {/* SECTION CONTENT */}
      {activeSection === 'overview' ? (
        <AdminAiOverviewPanel
          evo={evo}
          geminiPool={geminiPool}
          onRefresh={loadAll}
          setMsg={setMsg}
        />
      ) : (
        <AdminAiKnowledgePanel
          geminiPool={geminiPool}
          ingestedList={ingestedList}
          onRefresh={loadAll}
          setMsg={setMsg}
        />
      )}

      {/* KHUNG THU GỌN CAN THIỆP THỦ CÔNG (MANUAL OVERRIDE DRAWER) */}
      <AdminAiManualOverrideDrawer onRefresh={loadAll} setMsg={setMsg} />
    </div>
  );
};
