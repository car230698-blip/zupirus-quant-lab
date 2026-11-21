import React, { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../api/client';
import { ToastNotification } from './ToastNotification';
import { AdminAiOverviewPanel } from './AdminAiOverviewPanel';
import { AdminAiKnowledgePanel } from './AdminAiKnowledgePanel';
import { AdminAiManualOverrideDrawer } from './AdminAiManualOverrideDrawer';

export const AdminAIEvolutionTab: React.FC = () => {
  const [evo, setEvo] = useState<any>({});
  const [geminiPool, setGeminiPool] = useState<any[]>([]);
  const [ingestedList, setIngestedList] = useState<any[]>([]);
  const [msg, setMsg] = useState<string>('');
  const [activeSection, setActiveSection] = useState<'overview' | 'knowledge'>('overview');

  const loadAll = useCallback(async () => {
    try {
      const [eData, gData, iData] = await Promise.all([
        apiGet('/api/v1/telemetry/ai-evolution').catch(() => null),
        apiGet('/api/admin/gemini/keys').catch(() => null),
        apiGet('/api/admin/skills/ingested').catch(() => null),
      ]);
      if (eData) setEvo(eData);
      if (gData) setGeminiPool(gData.keys || []);
      if (iData) setIngestedList(iData.skills || iData.ingested_skills || []);
    } catch {
      // keep existing state
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

      {/* TOP HEADER & SECTION SWITCHER */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSection('overview')}
            className={`px-4 py-2.5 rounded-xl font-mono text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              activeSection === 'overview'
                ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-400 text-cyan-200 shadow-lg shadow-cyan-500/20'
                : 'bg-[#040816] border border-white/10 text-slate-400 hover:text-white hover:border-white/20'
            }`}
          >
            <span>🎯</span>
            <span>GIÁM SÁT TỰ HỌC &amp; DUYỆT CHIẾN LƯỢC</span>
            <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] text-cyan-300">
              {evo?.wfo_candidates?.length || 0} Chờ duyệt
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('knowledge')}
            className={`px-4 py-2.5 rounded-xl font-mono text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              activeSection === 'knowledge'
                ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-400 text-amber-200 shadow-lg shadow-amber-500/20'
                : 'bg-[#040816] border border-white/10 text-slate-400 hover:text-white hover:border-white/20'
            }`}
          >
            <span>📚</span>
            <span>NẠP TRI THỨC &amp; GEMINI KEY POOL</span>
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">
              {ingestedList.length} Tài liệu
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={loadAll}
          className="rounded-xl border border-white/10 bg-[#040814] px-3.5 py-2 text-xs text-slate-300 hover:bg-white/10 cursor-pointer font-mono flex items-center gap-1.5"
        >
          <span>↻</span>
          <span>Làm Mới</span>
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
