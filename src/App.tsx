import React, { useCallback, useEffect, useState } from 'react';
import {
  QuantSystemState,
  ReplayDatasetMetadata,
} from './quant/types.ts';
import { UserPortfolioView } from './components/UserPortfolioView.tsx';
import { AdminOperationsView } from './components/AdminOperationsView.tsx';

type ActiveTab = 'USER_PORTFOLIO' | 'ADMIN_OPERATIONS';
type UiSimulationStateOverride = 'NORMAL' | 'LOADING' | 'EMPTY' | 'STALE' | 'ERROR';

interface ApiStateResponse {
  state: QuantSystemState;
  datasetMetadata: ReplayDatasetMetadata;
  storagePaths: {
    dataDir: string;
    stateFilePath: string;
    journalFilePath: string;
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('USER_PORTFOLIO');
  const [data, setData] = useState<ApiStateResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inspectedPositionId, setInspectedPositionId] = useState<string | null>(null);
  const [uiStateOverride, setUiStateOverride] =
    useState<UiSimulationStateOverride>('NORMAL');

  const fetchSystemState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) {
        throw new Error(`Máy chủ phản hồi mã lỗi HTTP ${res.status}`);
      }
      const json = (await res.json()) as ApiStateResponse;
      setData(json);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Không thể kết nối tới máy chủ mô phỏng ZUPIRUS Quant Lab.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSystemState();
    const interval = setInterval(fetchSystemState, 1200);
    return () => clearInterval(interval);
  }, [fetchSystemState]);

  const handleStepCandle = async () => {
    try {
      const res = await fetch('/api/control/step', { method: 'POST' });
      if (res.ok) {
        await fetchSystemState();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleLoop = async () => {
    try {
      const res = await fetch('/api/control/toggle-loop', { method: 'POST' });
      if (res.ok) {
        await fetchSystemState();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleResetSimulation = async () => {
    try {
      const res = await fetch('/api/control/reset', { method: 'POST' });
      if (res.ok) {
        await fetchSystemState();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleInspectPositionInAdmin = (positionId: string) => {
    setInspectedPositionId(positionId);
    setActiveTab('ADMIN_OPERATIONS');
  };

  const isEffectiveLoading = loading || uiStateOverride === 'LOADING';
  const isEffectiveError =
    Boolean(errorMessage) || uiStateOverride === 'ERROR';

  const effectiveState: QuantSystemState | null =
    data && uiStateOverride === 'EMPTY'
      ? {
          ...data.state,
          openPositions: [],
          closedPositions: [],
          cycleTraces: [],
          learningRuns: [],
          equityCurve: [],
          replayCursorIndex: 0,
        }
      : data?.state || null;

  const isStaleData =
    uiStateOverride === 'STALE' ||
    Boolean(effectiveState?.isLoopRunning &&
      Date.now() - Date.parse(effectiveState.lastUpdatedSystemTime) > 15000);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col overflow-x-hidden">
      {/* Top Navigation Bar (Strict 3-Zone Top Bar Contract) */}
      <header className="flex items-center justify-between gap-2 sm:gap-8 px-3 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 bg-slate-950/95 sticky top-0 z-20">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('USER_PORTFOLIO');
          }}
          className="text-sm sm:text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 font-display"
        >
          ZUPIRUS Quant Lab
        </a>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="Điều hướng chính"
          className="flex items-center gap-3 sm:gap-6 text-xs sm:text-sm font-medium text-slate-400 min-w-0 overflow-x-auto"
        >
          <button
            type="button"
            onClick={() => setActiveTab('USER_PORTFOLIO')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
              activeTab === 'USER_PORTFOLIO'
                ? 'text-amber-300 border-b border-amber-400'
                : ''
            }`}
          >
            Tổng quan
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ADMIN_OPERATIONS')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
              activeTab === 'ADMIN_OPERATIONS'
                ? 'text-amber-300 border-b border-amber-400'
                : ''
            }`}
          >
            Vận hành Admin
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setUiStateOverride('NORMAL');
              fetchSystemState();
            }}
            className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs font-medium text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Đồng bộ
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Workspace Toolbar: Mode Indicator & UI State Diagnostic Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-800/80 text-xs text-slate-400">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-amber-300 font-semibold">
              Chế độ: Mô phỏng (Simulation Mode)
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Tự động vận hành trọn vòng: Nến đóng → Trạng thái → Chiến lược → Rủi ro → Khớp & Đối soát → Học Walk-Forward
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="ui-state-select" className="text-slate-400 whitespace-nowrap">
              Kiểm tra trạng thái giao diện:
            </label>
            <select
              id="ui-state-select"
              value={uiStateOverride}
              onChange={(e) =>
                setUiStateOverride(e.target.value as UiSimulationStateOverride)
              }
              className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
            >
              <option value="NORMAL">Dữ liệu mô phỏng từ máy chủ</option>
              <option value="LOADING">Trạng thái Đang tải (Loading)</option>
              <option value="EMPTY">Trạng thái Dữ liệu trống (Empty)</option>
              <option value="STALE">Trạng thái Dữ liệu cũ (Stale)</option>
              <option value="ERROR">Trạng thái Lỗi kết nối (Error)</option>
            </select>
          </div>
        </div>

        {/* 1. Loading State */}
        {isEffectiveLoading && (
          <div
            role="status"
            aria-label="Đang tải dữ liệu mô phỏng"
            className="border border-slate-800 bg-slate-900/50 p-8 rounded-lg space-y-4"
          >
            <div className="text-sm font-medium text-slate-200">
              Đang tải trạng thái hệ thống mô phỏng XAUUSD M15 và sổ cái đối soát...
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="h-24 bg-slate-800/50 rounded border border-slate-800"
                />
              ))}
            </div>
          </div>
        )}

        {/* 2. Error State */}
        {!isEffectiveLoading && isEffectiveError && (
          <div
            role="alert"
            className="border border-rose-800 bg-rose-950/30 p-6 rounded-lg space-y-3"
          >
            <h2 className="text-base font-semibold text-rose-300">
              Lỗi kết nối hoặc truy xuất trạng thái mô phỏng
            </h2>
            <p className="text-xs text-rose-200">
              {errorMessage ||
                'Mô phỏng trạng thái lỗi giao diện: Không nhận được phản hồi từ API máy chủ (/api/state).'}
            </p>
            <button
              type="button"
              onClick={() => {
                setUiStateOverride('NORMAL');
                fetchSystemState();
              }}
              className="px-4 py-2 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Thử kết nối lại ngay
            </button>
          </div>
        )}

        {/* 3. Main Views (User Portfolio vs Admin Operations) */}
        {!isEffectiveLoading && !isEffectiveError && effectiveState && data && (
          <>
            {activeTab === 'USER_PORTFOLIO' ? (
              <UserPortfolioView
                state={effectiveState}
                datasetMetadata={data.datasetMetadata}
                isStaleData={isStaleData}
                onInspectPositionInAdmin={handleInspectPositionInAdmin}
              />
            ) : (
              <AdminOperationsView
                state={effectiveState}
                datasetMetadata={data.datasetMetadata}
                isStaleData={isStaleData}
                initialInspectedPositionId={inspectedPositionId}
                onStepSingleCandle={handleStepCandle}
                onToggleLoop={handleToggleLoop}
                onResetSimulation={handleResetSimulation}
              />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-slate-900 py-5 px-6 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 max-w-7xl w-full mx-auto">
        <div>
          ZUPIRUS Quant Lab — Hệ thống Mô phỏng Định lượng XAUUSD M15 Tự vận hành (Bản nghiệm thu).
        </div>
        <div className="font-mono tabular-nums">
          Chế độ: SIMULATION_ONLY · Dữ liệu phát lại xác định · Không kết nối MT5/Live Broker
        </div>
      </footer>
    </div>
  );
}
