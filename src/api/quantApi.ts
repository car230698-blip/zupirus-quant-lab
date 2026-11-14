import type {
  AgentActivitySnapshot,
  TimelineEventInspectionDetail,
} from '../quant/agentActivityTracker.ts';
import type { DualCostStressComparison } from '../quant/costStress.ts';
import type { LearningBranchFixtureSuiteReport } from '../quant/fixtures.ts';
import type {
  CycleTraceRecord,
  LearningRunRecord,
  PolicyVersionRecord,
  QuantSystemState,
  ReconciliationRecord,
  ReplayDatasetMetadata,
  ShadowCandidateOutcome,
  SimulatedPosition,
  UserRole,
} from '../quant/types.ts';
import type { HostSurfaceMode } from '../server/authMiddleware.ts';

export interface QuantApiStatePayload {
  state: QuantSystemState;
  datasetMetadata: ReplayDatasetMetadata;
  storagePaths: {
    stateFilePath: string;
    journalFilePath: string;
    tickBatchLogPath?: string;
  };
  currentRole: UserRole;
  hostSurface?: HostSurfaceMode;
  agentActivity?: AgentActivitySnapshot;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  role: UserRole | null;
  hostSurface: HostSurfaceMode;
  hostname: string;
  strictAuth: boolean;
  localDevTokensEnabled: boolean;
}

export interface PositionTraceResponse {
  position: SimulatedPosition;
  entryCycleTrace?: CycleTraceRecord;
  closeCycleTrace?: CycleTraceRecord;
  reconciliation?: ReconciliationRecord;
  policyAtEntry?: PolicyVersionRecord;
}

export interface LearningTraceResponse {
  learningRun: LearningRunRecord;
  reconciledPositionsUsed: SimulatedPosition[];
  reconciliationsUsed: ReconciliationRecord[];
  shadowOutcomesUsed: ShadowCandidateOutcome[];
  resultingPolicy?: PolicyVersionRecord;
  previousPolicy?: PolicyVersionRecord;
}

export function buildAuthHeaders(
  authToken: string,
  simulatedHostname?: string | null
): Record<string, string> {
  const headers: Record<string, string> = {};
  const trimmed = authToken.trim();
  if (trimmed) {
    headers['Authorization'] = `Bearer ${trimmed}`;
  }
  if (simulatedHostname && simulatedHostname.trim()) {
    headers['x-zupirus-host'] = simulatedHostname.trim();
  }
  return headers;
}

export async function fetchQuantSession(
  authToken: string,
  simulatedHostname?: string | null
): Promise<AuthSessionResponse> {
  const res = await fetch('/api/auth/session', {
    headers: buildAuthHeaders(authToken, simulatedHostname),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchQuantState(
  authToken: string,
  simulatedHostname?: string | null
): Promise<{ status: number; data?: QuantApiStatePayload; messageVi?: string }> {
  const res = await fetch('/api/state', {
    headers: buildAuthHeaders(authToken, simulatedHostname),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      status: res.status,
      messageVi: body?.messageVi || `Lỗi xác thực hoặc tải trạng thái (HTTP ${res.status}).`,
    };
  }
  return { status: 200, data: body as QuantApiStatePayload };
}

export async function fetchSupplementalQuantReports(
  authToken: string,
  simulatedHostname?: string | null
): Promise<{
  costComparison: DualCostStressComparison | null;
  fixturesReport: LearningBranchFixtureSuiteReport | null;
}> {
  const headers = buildAuthHeaders(authToken, simulatedHostname);
  const [costRes, fixRes] = await Promise.all([
    fetch('/api/cost-analysis', { headers }).catch(() => null),
    fetch('/api/learning-fixtures', { headers }).catch(() => null),
  ]);

  const costComparison = costRes && costRes.ok ? await costRes.json() : null;
  const fixturesReport = fixRes && fixRes.ok ? await fixRes.json() : null;
  return { costComparison, fixturesReport };
}

export async function fetchPositionTraceById(
  positionId: string,
  authToken: string,
  simulatedHostname?: string | null
): Promise<PositionTraceResponse | null> {
  const res = await fetch(`/api/trace/position/${encodeURIComponent(positionId)}`, {
    headers: buildAuthHeaders(authToken, simulatedHostname),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchLearningTraceById(
  runId: string,
  authToken: string,
  simulatedHostname?: string | null
): Promise<LearningTraceResponse | null> {
  const res = await fetch(`/api/trace/learning/${encodeURIComponent(runId)}`, {
    headers: buildAuthHeaders(authToken, simulatedHostname),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchTimelineEventDetail(
  entryId: string,
  authToken: string,
  simulatedHostname?: string | null
): Promise<TimelineEventInspectionDetail | null> {
  const res = await fetch(`/api/agent-activity/events/${encodeURIComponent(entryId)}`, {
    headers: buildAuthHeaders(authToken, simulatedHostname),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function postAdminControlAction(
  endpoint: '/api/control/step' | '/api/control/toggle-loop' | '/api/control/reset',
  authToken: string,
  simulatedHostname?: string | null
): Promise<{ ok: boolean; status: number; messageVi?: string }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(authToken, simulatedHostname),
    },
  });
  const body = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    status: res.status,
    messageVi: body?.messageVi,
  };
}
