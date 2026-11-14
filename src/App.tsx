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
  const resolvedTab: WorkspaceTabId = isUserDomainOnly ? 'USER_PORTFOLIO'
    : isAdminDomainOnly ? 'ADMIN_OPERATIONS' : activeTab;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 min-h-14 py-2 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          {/* Zone 1: Brand Wordmark */}
          <a
            href="#top"
            className="text-base sm:text-lg font-display font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded"
          >
            ZUPIRUS Quant Lab
          </a>

          {/* Zone 2: Navigation Links (governed by hostname surface) */}
          <nav
            className="order-last sm:order-none w-full sm:w-auto flex items-center gap-4 overflow-x-auto text-sm font-medium text-slate-400"
            aria-label="Điều hướng chính"
          >
            {!isAdminDomainOnly && (
              <button
                type="button"
                onClick={() => {
                  setShowAuthModal(false);
                  setActiveTab('USER_PORTFOLIO');
                }}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  resolvedTab === 'USER_PORTFOLIO' && !showAuthModal
                    ? 'border-cyan-400 text-cyan-300 font-semibold'
                    : 'border-transparent hover:text-slate-100'
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
                className={`py-1 border-b-2 transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  resolvedTab === 'ADMIN_OPERATIONS'
                    ? 'border-cyan-400 text-cyan-300'
                    : 'border-transparent hover:text-slate-100'
                }`}
              >
                Quản trị
              </button>
            )}
          </nav>

          {/* Zone 3: Primary Action (Access / Token Auth) */}
          <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setShowAuthModal((v) => !v)}
                className="px-3.5 py-1.5 text-xs font-medium rounded-md bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0"
              >
                {showAuthModal
                  ? 'Đóng'
                  : authToken ? 'Tài khoản' : 'Đăng nhập'}
              </button>

          </div>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main id="top" className="flex-1 min-w-0 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6">
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
                className="px-4 py-2 text-xs font-medium rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold transition-colors"
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
            onRefreshReports={() => { void refreshAll(true); }}
            actionBusy={actionBusy}
            actionFeedbackVi={actionFeedbackVi}
            onStepNextCandle={stepNextCandle}
            onToggleAutoLoop={toggleAutoLoop}
            onResetSimulation={resetSimulation}
          />
        )}
      </main>

      {/* Quiet Institutional Footer */}
      <footer className="border-t border-slate-800/80 py-4 px-4 sm:px-6 text-xs text-slate-400">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            ZUPIRUS Quant Lab — Hệ thống Mô phỏng Giao dịch Định lượng XAUUSD M15
          </div>
          <div className="font-mono tabular-nums">
            Chế độ mô phỏng
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
