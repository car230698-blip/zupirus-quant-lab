import React, { useState } from 'react';
import { AdminAuthGate } from './components/admin/AdminAuthGateModal.tsx';
import { AdminOperationsView } from './components/AdminOperationsView.tsx';
import {
  DashboardSkeleton,
  EmptyDataNotice,
} from './components/shared/UiPrimitives.tsx';
import { UserPortfolioView } from './components/UserPortfolioView.tsx';
import { useQuantSystemData } from './hooks/useQuantSystemData.ts';
import type { WorkspaceTabId } from './utils/hostnameRouting.ts';

export function App() {
  const {
    authToken,
    setAuthToken,
    simulatedHost,
    clientHostContext,
    sessionInfo,
    payload,
    agentActivity,
    costComparison,
    fixturesReport,
    initialLoading,
    errorMessageVi,
    authErrorMessageVi,
    actionBusy,
    actionFeedbackVi,
    recentEventIds,
    refreshAll,
    stepNextCandle,
    toggleAutoLoop,
    resetSimulation,
  } = useQuantSystemData();

  const [activeTab, setActiveTab] = useState<WorkspaceTabId>(() =>
    clientHostContext.isAdminDomainOnly ? 'ADMIN_OPERATIONS' : 'USER_PORTFOLIO'
  );
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);

  const isUserDomainOnly = clientHostContext.isUserDomainOnly;
  const isAdminDomainOnly = clientHostContext.isAdminDomainOnly;

  // Determine effective workspace tab based on hostname routing contract
  const resolvedTab: WorkspaceTabId = isUserDomainOnly
    ? 'USER_PORTFOLIO'
    : isAdminDomainOnly
    ? 'ADMIN_OPERATIONS'
    : activeTab;

  const currentRole = payload?.currentRole ?? sessionInfo?.role ?? null;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/20 selection:text-cyan-300">
      {/* Top Institutional Navigation Bar */}
      <header className="sticky top-0 z-30 bg-[#0c1322]/95 backdrop-blur-md border-b border-[#1e293b]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 min-h-14 py-2.5 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          {/* Brand Wordmark & Tag */}
          <div className="flex items-center gap-3 shrink-0">
            <a
              href="#top"
              className="flex items-center gap-2 text-base sm:text-lg font-display font-bold tracking-tight text-slate-100 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-lg group"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-slate-950 font-black text-sm shadow-[0_0_12px_rgba(6,182,212,0.4)]">
                Z
              </span>
              <span className="group-hover:text-cyan-300 transition-colors">
                ZUPIRUS <span className="text-cyan-400 font-medium">Quant Lab</span>
              </span>
            </a>
            <span className="hidden md:inline-flex text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
              XAUUSD M15
            </span>
          </div>

          {/* Navigation Links (governed by hostname surface) */}
          <nav
            className="order-last sm:order-none w-full sm:w-auto flex items-center gap-2 overflow-x-auto text-xs font-semibold text-slate-400"
            aria-label="Điều hướng chính"
          >
            {!isAdminDomainOnly && (
              <button
                type="button"
                onClick={() => {
                  setShowAuthModal(false);
                  setActiveTab('USER_PORTFOLIO');
                }}
                className={`px-3.5 py-1.5 rounded-lg transition-all whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  resolvedTab === 'USER_PORTFOLIO' && !showAuthModal
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 shadow-sm font-bold'
                    : 'border border-transparent hover:text-slate-100 hover:bg-slate-900'
                }`}
              >
                Tổng quan
              </button>
            )}

            {!isUserDomainOnly && !isAdminDomainOnly && (
              <button
                type="button"
                aria-current={resolvedTab === 'ADMIN_OPERATIONS' ? 'page' : undefined}
                onClick={() => {
                  setShowAuthModal(false);
                  setActiveTab('ADMIN_OPERATIONS');
                }}
                className={`px-3.5 py-1.5 rounded-lg transition-all whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  resolvedTab === 'ADMIN_OPERATIONS' && !showAuthModal
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 shadow-sm font-bold'
                    : 'border border-transparent hover:text-slate-100 hover:bg-slate-900'
                }`}
              >
                Quản trị
              </button>
            )}
          </nav>

          {/* Role Status & Auth Button */}
          <div className="flex items-center gap-3 shrink-0">
            {currentRole && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-md bg-[#080d1a] border border-slate-800 text-slate-300">
                <span
                  className={`h-2 w-2 rounded-full ${
                    currentRole === 'ADMIN' ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-cyan-400 shadow-[0_0_6px_#22d3ee]'
                  }`}
                />
                Vai trò: <strong className="text-slate-100 font-bold">{currentRole}</strong>
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowAuthModal((v) => !v)}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#111a2e] hover:bg-[#16223b] text-cyan-300 border border-[#1e2e4a] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0 shadow-sm"
            >
              {showAuthModal
                ? 'Đóng'
                : authToken
                ? 'Quản lý Token'
                : 'Đăng nhập'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main id="top" className="flex-1 min-w-0 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {initialLoading ? (
          <DashboardSkeleton />
        ) : authErrorMessageVi || showAuthModal ? (
          <AdminAuthGate
            currentToken={authToken}
            currentRole={payload?.currentRole ?? sessionInfo?.role ?? null}
            hostSurface={clientHostContext.hostSurface}
            effectiveHostname={clientHostContext.effectiveHostname}
            localDevTokensEnabled={Boolean(sessionInfo?.localDevTokensEnabled)}
            errorMessageVi={authErrorMessageVi}
            onSubmitToken={(token) => {
              setAuthToken(token);
              setShowAuthModal(false);
            }}
          />
        ) : errorMessageVi || !payload || !agentActivity ? (
          <EmptyDataNotice
            title="Không thể đồng bộ dữ liệu từ máy chủ"
            reasonVi={
              errorMessageVi ||
              'Máy chủ chưa phản hồi trạng thái mô phỏng. Vui lòng thử tải lại.'
            }
            actionSlot={
              <button
                type="button"
                onClick={() => refreshAll(true)}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors shadow-sm"
              >
                Đồng bộ lại ngay
              </button>
            }
          />
        ) : resolvedTab === 'USER_PORTFOLIO' ? (
          <UserPortfolioView
            state={payload.state}
            datasetMetadata={payload.datasetMetadata}
          />
        ) : (
          <AdminOperationsView
            state={payload.state}
            currentRole={payload.currentRole}
            agentActivity={agentActivity}
            costComparison={costComparison}
            fixturesReport={fixturesReport}
            recentEventIds={recentEventIds}
            authToken={authToken}
            simulatedHost={simulatedHost}
            onRefreshReports={() => {
              void refreshAll(true);
            }}
            actionBusy={actionBusy}
            actionFeedbackVi={actionFeedbackVi}
            onStepNextCandle={stepNextCandle}
            onToggleAutoLoop={toggleAutoLoop}
            onResetSimulation={resetSimulation}
          />
        )}
      </main>

      {/* Institutional Financial Footer */}
      <footer className="border-t border-[#1e293b] py-5 px-4 sm:px-6 text-xs text-slate-400 bg-[#080d1a]">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-300">ZUPIRUS Quant Lab</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>Nền tảng giao dịch định lượng XAUUSD M15 tự vận hành</span>
          </div>
          <div className="font-mono tabular-nums text-slate-400 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
            <span>Chế độ mô phỏng (SIMULATION_ONLY)</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
