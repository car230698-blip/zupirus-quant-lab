import React, { useState } from 'react';
import { CustomerAssistant } from './components/CustomerAssistant.tsx';
import { AdminApprovalQueue } from './components/AdminApprovalQueue.tsx';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'assistant' | 'admin_approvals'>('overview');

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 bg-[#0c1322] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="font-bold tracking-tight text-lg text-cyan-400 font-mono">
            Z◈ ZUPIRUS QUANT LAB
          </div>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-300">
            v0.2.0 · TimescaleDB + Redis + LangSmith + Vercel AI SDK 6
          </span>
        </div>
        <nav className="flex gap-2 text-xs">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === 'overview' ? 'bg-cyan-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Tổng Quan
          </button>
          <button
            onClick={() => setActiveTab('assistant')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === 'assistant' ? 'bg-cyan-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Trợ Lý AI (Vercel SDK 6)
          </button>
          <button
            onClick={() => setActiveTab('admin_approvals')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === 'admin_approvals' ? 'bg-cyan-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Admin Phê Duyệt Chiến Lược
          </button>
        </nav>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-6 space-y-6">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-[#0c1322] p-6">
              <h2 className="text-base font-bold text-slate-100">Kiến Trúc Định Lượng Nâng Cấp Hoàn Tất</h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Hệ thống đã nâng cấp toàn diện lên PostgreSQL + TimescaleDB (Hypertables), Redis Streams/PubSub/Distributed Lock,
                Vercel AI SDK 6 (ToolLoopAgent + Generative UI) và LangSmith Full Tracing.
              </p>
            </div>
            <AdminApprovalQueue />
          </div>
        )}

        {activeTab === 'assistant' && (
          <div className="space-y-4">
            <CustomerAssistant />
          </div>
        )}

        {activeTab === 'admin_approvals' && (
          <div className="space-y-4">
            <AdminApprovalQueue />
          </div>
        )}
      </main>

      <footer className="border-t border-slate-900 py-3 text-center text-[11px] text-slate-500 font-mono">
        ZUPIRUS QUANT LAB · SYSTEMATIC THINKING · MEASURED EXECUTION
      </footer>
    </div>
  );
};

