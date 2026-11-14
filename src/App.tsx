import React, { useState } from 'react';
import { AdminAuthGate } from './components/admin/AdminAuthGateModal.tsx';
import { AgentActivitySection } from './components/admin/AgentActivitySection.tsx';
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
    setSimulatedHost,
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
    clientHostContext.isAdminDomainOnly ? 'AGENT_ACTIVITY' : 'USER_PORTFOLIO'
  );
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);

  const effectiveRole = payload?.currentRole ?? sessionInfo?.role ?? 'VIEWER';
  const isUserDomainOnly = clientHostContext.isUserDomainOnly;
  const isAdminDomainOnly = clientHostContext.isAdminDomainOnly;
  const isLocalMultiSurface = clientHostContext.isLocalMultiSurface;

  // Determine effective workspace tab based on hostname routing contract
  const resolvedTab: WorkspaceTabId = isUserDomainOnly
    ? 'USER_PORTFOLIO'
    : isAdminDomainOnly && activeTab === 'USER_PORTFOLIO'
    ? 'AGENT_ACTIVITY'
    : activeTab;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <a
            href="#top"
            className="text-base sm:text-lg font-display font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded"
          >
            ZUPIRUS Quant Lab
          </a>

          {/* Zone 2: Navigation Links (governed by hostname surface) */}
          <nav
            className="flex items-center gap-5 overflow-x-auto text-xs sm:text-sm font-medium text-slate-400"
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
                Tổng quan Danh mục
              </button>
            )}

            {!isUserDomainOnly && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setShowAuthModal(false);
                    setActiveTab('AGENT_ACTIVITY');
                  }}
                  className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                    resolvedTab === 'AGENT_ACTIVITY' && !showAuthModal
                      ? 'border-cyan-400 text-cyan-300 font-semibold'
                      : 'border-transparent hover:text-slate-100'
                  }`}
                >
                  Hoạt động Agent
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowAuthModal(false);
                    setActiveTab('ADMIN_OPERATIONS');
                  }}
                  className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                    resolvedTab === 'ADMIN_OPERATIONS' && !showAuthModal
                      ? 'border-cyan-400 text-cyan-300 font-semibold'
                      : 'border-transparent hover:text-slate-100'
                  }`}
                >
                  Bảng Quản trị &amp; Kiểm định
                </button>
              </>
            )}
          </nav>

          {/* Zone 3: Primary Action (Access / Token Auth) */}
          <div className="flex items-center gap-3 shrink-0">
            {!isUserDomainOnly ? (
              <button
                type="button"
                onClick={() => setShowAuthModal((v) => !v)}
                className="px-3.5 py-1.5 text-xs font-medium rounded-md bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0"
              >
                {showAuthModal
                  ? 'Đóng Xác thực'
                  : `Quyền: ${effectiveRole}`}
              </button>
            ) : (
              <span className="text-xs font-mono text-cyan-300 whitespace-nowrap shrink-0">
                SIMULATION_ONLY
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Localhost Acceptance Toolbar (only shown on localhost / preview to test hostname routing & permissions easily) */}
      {isLocalMultiSurface && (
        <div className="bg-slate-900/60 border-b border-slate-800/80">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-400">
              <span>Chế độ nghiệm thu Localhost:</span>
              <div className="inline-flex rounded-md bg-slate-950 p-0.5 border border-slate-800">
                {[
                  { host: null, label: 'localhost (Đầy đủ)' },
                  { host: 'zupirus.com', label: 'zupirus.com (Người dùng)' },
                  { host: 'adm.zupirus.com', label: 'adm.zupirus.com (Quản trị)' },
                ].map((item) => {
                  const active = (simulatedHost || null) === item.host;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => setSimulatedHost(item.host)}
                      className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {sessionInfo?.localDevTokensEnabled && !isUserDomainOnly && (
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Phân quyền Backend:</span>
                <button
                  type="button"
                  onClick={() => setAuthToken('local-viewer-token')}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono border transition-colors whitespace-nowrap shrink-0 ${
                    effectiveRole === 'VIEWER'
                      ? 'border-cyan-500/50 bg-cyan-950/50 text-cyan-200'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  VIEWER
                </button>
                <button
                  type="button"
                  onClick={() => setAuthToken('local-admin-token')}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono border transition-colors whitespace-nowrap shrink-0 ${
                    effectiveRole === 'ADMIN'
                      ? 'border-emerald-500/50 bg-emerald-950/50 text-emerald-200'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ADMIN
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <main id="top" className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6">
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
        ) : resolvedTab === 'AGENT_ACTIVITY' ? (
          <AgentActivitySection
            state={payload.state}
            activity={agentActivity}
            recentEventIds={recentEventIds}
          />
        ) : (
          <AdminOperationsView
            state={payload.state}
            datasetMetadata={payload.datasetMetadata}
            storagePaths={payload.storagePaths}
            currentRole={payload.currentRole}
            agentActivity={agentActivity}
            costComparison={costComparison}
            fixturesReport={fixturesReport}
            recentEventIds={recentEventIds}
            authToken={authToken}
            simulatedHost={simulatedHost}
            initialSubTab="WALK_FORWARD"
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
            Chế độ: SIMULATION_ONLY · Đối soát độc lập 100%
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
