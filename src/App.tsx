import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  QuantSystemState,
  ReplayDatasetMetadata,
  UserRole,
} from './quant/types.ts';
import { DualCostStressComparison } from './quant/costStress.ts';
import { LearningBranchFixtureSuiteReport } from './quant/fixtures.ts';
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
  currentRole?: UserRole;
}

export interface HostnameRoutingInfo {
  isUserDomain: boolean;
  isAdminDomain: boolean;
  effectiveHostname: string;
}

export function detectHostnameRouting(): HostnameRoutingInfo {
  if (typeof window === 'undefined') {
    return { isUserDomain: false, isAdminDomain: false, effectiveHostname: '' };
  }
  const params = new URLSearchParams(window.location.search);
  const hostParam = params.get('host') || params.get('domain');
  const rawHost = (hostParam || window.location.hostname).toLowerCase();
  const isUser = rawHost === 'zupirus.com' || rawHost === 'www.zupirus.com';
  const isAdmin = rawHost === 'adm.zupirus.com' || rawHost.startsWith('adm.');
  return {
    isUserDomain: isUser,
    isAdminDomain: isAdmin,
    effectiveHostname: rawHost,
  };
}

export default function App() {
  const routing = detectHostnameRouting();
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    routing.isAdminDomain ? 'ADMIN_OPERATIONS' : 'USER_PORTFOLIO'
  );
  const [activeRole, setActiveRole] = useState<UserRole>('VIEWER');
  const [authToken, setAuthToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [adminTokenGateInput, setAdminTokenGateInput] = useState('');
  const [adminGateErrorVi, setAdminGateErrorVi] = useState<string | null>(null);
  const [data, setData] = useState<ApiStateResponse | null>(null);
  const [costComparison, setCostComparison] =
    useState<DualCostStressComparison | null>(null);
  const [learningFixturesReport, setLearningFixturesReport] =
    useState<LearningBranchFixtureSuiteReport | null>(null);
  const [hasInitialLoaded, setHasInitialLoaded] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rbacNoticeVi, setRbacNoticeVi] = useState<string | null>(null);
  const [inspectedPositionId, setInspectedPositionId] = useState<string | null>(null);
  const [uiStateOverride, setUiStateOverride] =
    useState<UiSimulationStateOverride>('NORMAL');

  const isFetchingRef = useRef(false);

  const buildHeaders = useCallback(
    (extra?: Record<string, string>): Record<string, string> => ({
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(extra || {}),
    }),
    [authToken]
  );

  const fetchSystemState = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const res = await fetch('/api/state', {
        headers: buildHeaders(),
      });
      if (res.status === 401) {
        setData(null);
        throw new Error('Nhập token Admin hoặc Người xem để truy cập.');
      }
      if (res.status === 403) {
        setData(null);
        const errJson = await res.json().catch(() => null);
        setRbacNoticeVi(
          errJson?.messageVi ||
            `Vai trò ${activeRole} chỉ được phép đẩy báo giá (/api/ingest/ticks) và kiểm tra trạng thái thu thập (/api/ingest/status), không được phép đọc sổ cái tài khoản (/api/state).`
        );
        setErrorMessage(null);
        setHasInitialLoaded(true);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        throw new Error(`Máy chủ phản hồi mã lỗi HTTP ${res.status}`);
      }
      const json = (await res.json()) as ApiStateResponse;
      setActiveRole(json.currentRole ?? 'VIEWER');
      setData(json);
      setErrorMessage(null);
      setRbacNoticeVi(null);
      setHasInitialLoaded(true);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Không thể kết nối tới máy chủ mô phỏng ZUPIRUS Quant Lab.'
      );
      setHasInitialLoaded(true);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [activeRole, buildHeaders]);

  const fetchAdminDiagnostics = useCallback(async () => {
    if (activeRole === 'COLLECTOR') return;
    try {
      const [costRes, fixRes] = await Promise.all([
        fetch('/api/cost-analysis', { headers: buildHeaders() }),
        fetch('/api/learning-fixtures', { headers: buildHeaders() }),
      ]);
      if (costRes.ok) {
        const costJson = (await costRes.json()) as DualCostStressComparison;
        setCostComparison(costJson);
      }
      if (fixRes.ok) {
        const fixJson = (await fixRes.json()) as LearningBranchFixtureSuiteReport;
        setLearningFixturesReport(fixJson);
      }
    } catch {
      // Non-blocking supplementary diagnostics
    }
  }, [activeRole, buildHeaders]);

  useEffect(() => {
    fetchSystemState();
    const interval = setInterval(fetchSystemState, 1200);
    return () => clearInterval(interval);
  }, [fetchSystemState]);

  useEffect(() => {
    if (hasInitialLoaded && activeRole !== 'COLLECTOR') {
      fetchAdminDiagnostics();
    }
  }, [hasInitialLoaded, activeTab, activeRole, fetchAdminDiagnostics]);

  const handleStepCandle = async () => {
    try {
      const res = await fetch('/api/control/step', {
        method: 'POST',
        headers: buildHeaders(),
      });
      if (res.status === 403) {
        const errJson = await res.json().catch(() => null);
        setRbacNoticeVi(
          errJson?.messageVi ||
            `Vai trò ${activeRole} không có quyền điều khiển mô phỏng (Yêu cầu: ADMIN).`
        );
        return;
      }
      if (res.ok) {
        await fetchSystemState();
        await fetchAdminDiagnostics();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleLoop = async () => {
    try {
      const res = await fetch('/api/control/toggle-loop', {
        method: 'POST',
        headers: buildHeaders(),
      });
      if (res.status === 403) {
        const errJson = await res.json().catch(() => null);
        setRbacNoticeVi(
          errJson?.messageVi ||
            `Vai trò ${activeRole} không có quyền tạm dừng/tiếp tục vòng lặp (Yêu cầu: ADMIN).`
        );
        return;
      }
      if (res.ok) {
        await fetchSystemState();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleResetSimulation = async () => {
    try {
      const res = await fetch('/api/control/reset', {
        method: 'POST',
        headers: buildHeaders(),
      });
      if (res.status === 403) {
        const errJson = await res.json().catch(() => null);
        setRbacNoticeVi(
          errJson?.messageVi ||
            `Vai trò ${activeRole} không có quyền khởi tạo lại mô phỏng (Yêu cầu: ADMIN).`
        );
        return;
      }
      if (res.ok) {
        await fetchSystemState();
        await fetchAdminDiagnostics();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleInspectPositionInAdmin = (positionId: string) => {
    if (routing.isUserDomain) {
      window.open('https://adm.zupirus.com', '_blank');
      return;
    }
    setInspectedPositionId(positionId);
    setActiveTab('ADMIN_OPERATIONS');
  };

  const isEffectiveLoading =
    !hasInitialLoaded || loading || uiStateOverride === 'LOADING';
  const isEffectiveError =
    !isEffectiveLoading &&
    (Boolean(errorMessage) || uiStateOverride === 'ERROR');

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
    Boolean(
      effectiveState?.isLoopRunning &&
        Date.now() - Date.parse(effectiveState.lastUpdatedSystemTime) > 15000
    );

  const mustLockAdminGate = routing.isAdminDomain && activeRole !== 'ADMIN';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col overflow-x-hidden">
      {/* Top Navigation Bar */}
      <header className="flex items-center justify-between gap-2 sm:gap-8 px-3 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 bg-slate-950/95 sticky top-0 z-20">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            if (!routing.isAdminDomain) {
              setActiveTab('USER_PORTFOLIO');
            }
          }}
          className="text-sm sm:text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 font-display flex items-center gap-2"
        >
          <span>ZUPIRUS Quant Lab</span>
          {routing.isAdminDomain && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Admin Portal
            </span>
          )}
          {routing.isUserDomain && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
              User Portal
            </span>
          )}
        </a>

        {/* Zone 2: Navigation links based on hostname */}
        <nav
          aria-label="Điều hướng chính"
          className="flex items-center gap-3 sm:gap-6 text-xs sm:text-sm font-medium text-slate-400 min-w-0 overflow-x-auto"
        >
          {!routing.isAdminDomain && (
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
          )}

          {routing.isUserDomain ? (
            <a
              href="https://adm.zupirus.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-amber-300 transition-colors whitespace-nowrap shrink-0 pb-0.5 flex items-center gap-1"
            >
              <span>Vận hành Admin ↗</span>
            </a>
          ) : (
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
          )}

          {routing.isAdminDomain && (
            <a
              href="https://zupirus.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-blue-300 transition-colors whitespace-nowrap shrink-0 pb-0.5 flex items-center gap-1"
            >
              <span>Về Trang Người Dùng ↗</span>
            </a>
          )}
        </nav>

        {/* Zone 3: Đồng bộ action */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setUiStateOverride('NORMAL');
              fetchSystemState();
              fetchAdminDiagnostics();
            }}
            className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs font-medium text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Đồng bộ
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Workspace Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 border-b border-slate-800/80 text-xs text-slate-400">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-amber-300 font-semibold">
              Chế độ: SIMULATION_ONLY
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Nguồn:{' '}
              <strong className="text-slate-200 font-mono">
                {effectiveState?.dataSourceTelemetry?.sourceMode === 'MT5_DEMO_LIVE'
                  ? 'MT5_DEMO_LIVE (Đồng bộ SQLite → VPS)'
                  : 'REPLAY_DATASET (Kiểm định Xác định)'}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Tự vận hành trọn vòng: Báo giá/Nến đóng → Trạng thái → Chiến lược → Rủi ro (15/15 & P95 SL) → Khớp & Đối soát → Học Walk-Forward
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <form className="flex items-center gap-2" onSubmit={(event) => {
              event.preventDefault();
              setData(null);
              setActiveRole('VIEWER');
              setAuthToken(tokenInput.trim());
            }}>
              <label htmlFor="dashboard-token" className="text-slate-400">Token truy cập</label>
              <input id="dashboard-token" type="password" autoComplete="off" value={tokenInput}
                onChange={event => setTokenInput(event.target.value)}
                className="w-32 rounded border border-slate-800 bg-slate-900 px-2 py-1 text-slate-100" />
              <button className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800">Đăng nhập</button>
            </form>

            <div className="flex items-center gap-1.5">
              <label htmlFor="ui-state-select" className="text-slate-400 whitespace-nowrap">
                Trạng thái UI:
              </label>
              <select
                id="ui-state-select"
                value={uiStateOverride}
                onChange={(e) =>
                  setUiStateOverride(e.target.value as UiSimulationStateOverride)
                }
                className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
              >
                <option value="NORMAL">Dữ liệu thực từ máy chủ</option>
                <option value="LOADING">Trạng thái Đang tải (Loading)</option>
                <option value="EMPTY">Trạng thái Dữ liệu trống (Empty)</option>
                <option value="STALE">Trạng thái Dữ liệu cũ (Stale)</option>
                <option value="ERROR">Trạng thái Lỗi kết nối (Error)</option>
              </select>
            </div>
          </div>
        </div>

        {/* RBAC Notice Banner */}
        {rbacNoticeVi && (
          <div
            role="alert"
            className="border border-amber-700/70 bg-amber-950/30 px-4 py-3 rounded-lg text-xs text-amber-200 flex items-center justify-between gap-4"
          >
            <div>
              <strong className="font-semibold text-amber-300">
                Kiểm soát Phân quyền (RBAC — Vai trò {activeRole}):{' '}
              </strong>
              {rbacNoticeVi}
            </div>
          </div>
        )}

        {/* ADMIN GATE FOR adm.zupirus.com */}
        {mustLockAdminGate && (
          <div className="max-w-xl mx-auto my-12 p-6 sm:p-8 rounded-xl border border-amber-600/40 bg-slate-900/95 shadow-2xl space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-xl">
                🛡️
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-100">
                  Cổng Quản Trị Hệ Thống ZUPIRUS Quant Lab
                </h2>
                <p className="text-xs text-amber-300 font-mono">adm.zupirus.com — Yêu cầu quyền ADMIN</p>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Trang quản trị vận hành yêu cầu <strong>Token Quản trị (Admin Auth Token)</strong> hợp lệ để mở khóa bảng điều khiển mô phỏng, can thiệp chu kỳ, điều chỉnh lịch phiên và thực thi kiểm định.
            </p>

            {adminGateErrorVi && (
              <div role="alert" className="p-3 rounded-lg border border-rose-800 bg-rose-950/50 text-xs text-rose-300">
                {adminGateErrorVi}
              </div>
            )}

            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const token = adminTokenGateInput.trim();
                if (!token) {
                  setAdminGateErrorVi('Vui lòng nhập Admin Auth Token.');
                  return;
                }
                setAdminGateErrorVi(null);
                setLoading(true);
                try {
                  const res = await fetch('/api/state', {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  if (!res.ok) {
                    throw new Error('Mã token không hợp lệ hoặc máy chủ từ chối.');
                  }
                  const json = (await res.json()) as ApiStateResponse;
                  if (json.currentRole !== 'ADMIN') {
                    throw new Error(`Token được cung cấp chỉ có quyền ${json.currentRole}, không đủ quyền Quản trị (ADMIN).`);
                  }
                  setAuthToken(token);
                  setTokenInput(token);
                  setActiveRole('ADMIN');
                  setData(json);
                  setHasInitialLoaded(true);
                  setErrorMessage(null);
                } catch (err: any) {
                  setAdminGateErrorVi(err.message || 'Lỗi xác thực quyền Quản trị.');
                } finally {
                  setLoading(false);
                }
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor="admin-gate-token" className="block text-xs font-medium text-slate-300">
                  Mã Token Quản Trị (ADMIN_AUTH_TOKEN)
                </label>
                <input
                  id="admin-gate-token"
                  type="password"
                  autoComplete="off"
                  value={adminTokenGateInput}
                  onChange={(e) => setAdminTokenGateInput(e.target.value)}
                  placeholder="Nhập mã token Admin tại đây..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold transition-colors shadow-lg cursor-pointer"
              >
                Xác thực quyền Quản trị (ADMIN)
              </button>
            </form>
          </div>
        )}

        {/* 1. Loading State */}
        {!mustLockAdminGate && isEffectiveLoading && (
          <div
            role="status"
            aria-label="Đang tải dữ liệu mô phỏng"
            className="border border-slate-800 bg-slate-900/50 p-8 rounded-lg space-y-4"
          >
            <div className="text-sm font-medium text-slate-200">
              Đang đồng bộ trạng thái hệ thống mô phỏng XAUUSD M15 và sổ cái đối soát...
            </div>
            <p className="text-xs text-slate-400">
              Hệ thống chờ phản hồi xác thực từ máy chủ trước khi hiển thị số liệu tài khoản để ngăn hiển thị số 0 hoặc báo lỗi kết nối giả.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="h-24 bg-slate-800/50 rounded border border-slate-800 animate-pulse"
                />
              ))}
            </div>
          </div>
        )}

        {/* 2. Error State */}
        {!mustLockAdminGate && !isEffectiveLoading && isEffectiveError && (
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

        {/* 3. Main Views */}
        {!mustLockAdminGate &&
          !isEffectiveLoading &&
          !isEffectiveError &&
          activeRole !== 'COLLECTOR' &&
          effectiveState &&
          data && (
            <>
              {activeTab === 'USER_PORTFOLIO' || routing.isUserDomain ? (
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
                  activeRole={activeRole}
                  costComparison={costComparison}
                  learningFixturesReport={learningFixturesReport}
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
          Chế độ: SIMULATION_ONLY · Nguồn: MT5 Demo Quote Sync & Deterministic Replay · Khớp lệnh: SimBroker nội bộ
        </div>
      </footer>
    </div>
  );
}