import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AuthSessionResponse,
  fetchQuantSession,
  fetchQuantState,
  fetchSupplementalQuantReports,
  postAdminControlAction,
  QuantApiStatePayload,
} from '../api/quantApi.ts';
import {
  AgentActivitySnapshot,
  buildAgentActivitySnapshot,
} from '../quant/agentActivityTracker.ts';
import type { DualCostStressComparison } from '../quant/costStress.ts';
import type { LearningBranchFixtureSuiteReport } from '../quant/fixtures.ts';
import { resolveClientHostRouting } from '../utils/hostnameRouting.ts';

const TOKEN_STORAGE_KEY = 'zupirus_auth_token';
const HOST_PREVIEW_STORAGE_KEY = 'zupirus_preview_hostname';

export function useQuantSystemData() {
  const [authToken, setAuthTokenState] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  });

  const [simulatedHost, setSimulatedHostState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const queryHost = new URLSearchParams(window.location.search).get('host');
    if (queryHost) return queryHost;
    return window.localStorage.getItem(HOST_PREVIEW_STORAGE_KEY) || null;
  });

  const [sessionInfo, setSessionInfo] = useState<AuthSessionResponse | null>(null);
  const [payload, setPayload] = useState<QuantApiStatePayload | null>(null);
  const [costComparison, setCostComparison] = useState<DualCostStressComparison | null>(null);
  const [fixturesReport, setFixturesReport] = useState<LearningBranchFixtureSuiteReport | null>(
    null
  );
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [errorMessageVi, setErrorMessageVi] = useState<string | null>(null);
  const [authErrorMessageVi, setAuthErrorMessageVi] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionFeedbackVi, setActionFeedbackVi] = useState<string | null>(null);
  const [recentEventIds, setRecentEventIds] = useState<Set<string>>(new Set());

  const knownEventIdsRef = useRef<Set<string>>(new Set());
  const isFirstFetchRef = useRef<boolean>(true);
  const lastSupplementalCursorRef = useRef<number>(-1);

  const clientHostContext = resolveClientHostRouting(simulatedHost);

  const setAuthToken = useCallback((token: string) => {
    const clean = token.trim();
    setAuthTokenState(clean);
    if (typeof window !== 'undefined') {
      if (clean) {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, clean);
      } else {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    }
  }, []);

  const setSimulatedHost = useCallback((host: string | null) => {
    const clean = host && host.trim() ? host.trim().toLowerCase() : null;
    setSimulatedHostState(clean);
    if (typeof window !== 'undefined') {
      if (clean) {
        window.localStorage.setItem(HOST_PREVIEW_STORAGE_KEY, clean);
      } else {
        window.localStorage.removeItem(HOST_PREVIEW_STORAGE_KEY);
      }
    }
  }, []);

  const refreshAll = useCallback(
    async (forceSupplemental = false) => {
      try {
        const [sessionRes, stateRes] = await Promise.all([
          fetchQuantSession(authToken, simulatedHost).catch(() => null),
          fetchQuantState(authToken, simulatedHost),
        ]);

        if (sessionRes) {
          setSessionInfo(sessionRes);
        }

        if (stateRes.status === 401 || stateRes.status === 403) {
          setAuthErrorMessageVi(
            stateRes.messageVi ||
              'Yêu cầu xác thực Bearer Token hợp lệ để truy cập dữ liệu máy chủ.'
          );
          setInitialLoading(false);
          return;
        }

        if (!stateRes.data) {
          setErrorMessageVi(stateRes.messageVi || 'Không thể tải dữ liệu từ máy chủ.');
          setInitialLoading(false);
          return;
        }

        setAuthErrorMessageVi(null);
        setErrorMessageVi(null);

        const nextData = stateRes.data;
        const incomingJournal = nextData.state.journal;

        if (isFirstFetchRef.current) {
          knownEventIdsRef.current = new Set(incomingJournal.map((j) => j.entryId));
          isFirstFetchRef.current = false;
        } else {
          const newlyAdded = new Set<string>();
          for (const item of incomingJournal) {
            if (!knownEventIdsRef.current.has(item.entryId)) {
              newlyAdded.add(item.entryId);
              knownEventIdsRef.current.add(item.entryId);
            }
          }
          if (newlyAdded.size > 0) {
            setRecentEventIds(newlyAdded);
          }
        }

        setPayload(nextData);
        setInitialLoading(false);

        const cursor = nextData.state.replayCursorIndex;
        if (
          forceSupplemental ||
          lastSupplementalCursorRef.current === -1 ||
          cursor !== lastSupplementalCursorRef.current
        ) {
          lastSupplementalCursorRef.current = cursor;
          const supp = await fetchSupplementalQuantReports(authToken, simulatedHost);
          if (supp.costComparison) setCostComparison(supp.costComparison);
          if (supp.fixturesReport) setFixturesReport(supp.fixturesReport);
        }
      } catch (err) {
        setErrorMessageVi(
          err instanceof Error ? err.message : 'Mất kết nối tạm thời tới máy chủ ZUPIRUS.'
        );
        setInitialLoading(false);
      }
    },
    [authToken, simulatedHost]
  );

  useEffect(() => {
    refreshAll(true);
    const timer = setInterval(() => {
      refreshAll(false);
    }, 1000);
    return () => clearInterval(timer);
  }, [refreshAll]);

  const executeControlAction = useCallback(
    async (
      endpoint: '/api/control/step' | '/api/control/toggle-loop' | '/api/control/reset',
      labelVi: string
    ) => {
      setActionBusy(true);
      setActionFeedbackVi(null);
      try {
        const res = await postAdminControlAction(endpoint, authToken, simulatedHost);
        if (!res.ok) {
          setActionFeedbackVi(
            res.messageVi || `Thao tác "${labelVi}" bị từ chối (HTTP ${res.status}).`
          );
        } else {
          setActionFeedbackVi(`Đã thực hiện: ${labelVi}`);
          await refreshAll(true);
        }
      } finally {
        setActionBusy(false);
      }
    },
    [authToken, simulatedHost, refreshAll]
  );

  const agentActivity: AgentActivitySnapshot | null = payload
    ? payload.agentActivity ?? buildAgentActivitySnapshot(payload.state, false)
    : null;

  return {
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
    stepNextCandle: () => executeControlAction('/api/control/step', 'Chạy 1 nến M15 kế tiếp'),
    toggleAutoLoop: () =>
      executeControlAction('/api/control/toggle-loop', 'Chuyển trạng thái vòng lặp tự động'),
    resetSimulation: () =>
      executeControlAction('/api/control/reset', 'Đặt lại & tự chạy lại từ đầu'),
  };
}
