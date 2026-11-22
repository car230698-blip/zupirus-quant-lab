/**
 * ZUPIRUS Quant Lab — Unified API Client
 * Wraps native fetch with automatic credentials: 'include', CSRF/perimeter header 'X-Zupirus': '1',
 * and centralized JSON / error handling.
 */

export interface ApiRequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    let normalizedMsg = message;
    if (status === 401 && (!message || message.includes('HTTP 401'))) {
      normalizedMsg = 'Phiên làm việc hết hạn hoặc chưa đăng nhập. Vui lòng đăng nhập lại.';
    } else if (status === 403 && (!message || message.includes('HTTP 403'))) {
      normalizedMsg = 'Bạn không có quyền truy cập tính năng quản trị này.';
    }
    super(normalizedMsg);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const { params, headers: customHeaders, ...restOptions } = options;

  let url = endpoint;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== null) {
        searchParams.append(key, String(val));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
  }

  const headers: Record<string, string> = {
    'X-Zupirus': '1',
    ...(customHeaders as Record<string, string>),
  };

  if (
    restOptions.body &&
    typeof restOptions.body === 'string' &&
    !headers['Content-Type']
  ) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    credentials: 'include',
    ...restOptions,
    headers,
  });

  if (!response.ok) {
    const rawText = await response.text();
    let errData: any;
    try {
      errData = rawText ? JSON.parse(rawText) : null;
    } catch {
      errData = rawText;
    }
    const message =
      (typeof errData === 'object' && (errData?.detail || errData?.message)) ||
      (typeof errData === 'string' && errData.trim().length > 0
        ? errData
        : `HTTP ${response.status}: ${response.statusText}`);
    throw new ApiError(message, response.status, errData);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const rawText = await response.text();
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return (rawText ? JSON.parse(rawText) : null) as T;
    } catch {
      return rawText as unknown as T;
    }
  }
  return rawText as unknown as T;
}

export const api = {
  get: <T = any>(url: string, options?: ApiRequestOptions) =>
    apiRequest<T>(url, { ...options, method: 'GET' }),
  post: <T = any>(url: string, body?: any, options?: ApiRequestOptions) =>
    apiRequest<T>(url, {
      ...options,
      method: 'POST',
      body: body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body),
    }),
  put: <T = any>(url: string, body?: any, options?: ApiRequestOptions) =>
    apiRequest<T>(url, {
      ...options,
      method: 'PUT',
      body: body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body),
    }),
  patch: <T = any>(url: string, body?: any, options?: ApiRequestOptions) =>
    apiRequest<T>(url, {
      ...options,
      method: 'PATCH',
      body: body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body),
    }),
  delete: <T = any>(url: string, options?: ApiRequestOptions) =>
    apiRequest<T>(url, { ...options, method: 'DELETE' }),
  downloadBlob: async (url: string, filename: string) => {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'X-Zupirus': '1' },
    });
    if (!res.ok) throw new Error(`Download failed with HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(blobUrl);
  },
};

export const apiGet = api.get;
export const apiPost = api.post;
export const apiPut = api.put;
export const apiPatch = api.patch;
export const apiDelete = api.delete;

// ---------------------------------------------------------------------------
// Admin Control Plane v1.2 — Centralized Admin Client Methods
// ---------------------------------------------------------------------------

export interface AdminAgentHeartbeat {
  id: string;
  name: string;
  role: string;
  status: 'IDLE' | 'RUNNING' | 'PAUSED' | 'QUOTA_CAPPED';
  trigger_mode: string;
  last_run_at: number | null;
  last_duration_ms: number;
  last_summary: string;
  calls_today: number;
  is_paused: boolean;
}

export interface AdminAiQuota {
  calls_today: number;
  daily_cap: number;
  usage_pct: number;
  status: 'OK' | 'WARNING_80' | 'CAPPED_100';
  is_overridden: boolean;
  override_until: number;
  breakdown: Record<string, number>;
}

export interface StrategyCandidateItem {
  id: string;
  name: string;
  win_rate: number;
  profit_factor: number;
  max_drawdown_pct: number;
  sample_size: number;
  rules: Record<string, any>;
}

export interface StrategyReviewQueueItem {
  candidate: StrategyCandidateItem;
  current_live: StrategyCandidateItem | null;
  delta: {
    win_rate_diff: number;
    pf_diff: number;
    dd_diff: number;
  };
}

export interface StrategyHistoryItem {
  id: string;
  name: string;
  status: 'APPROVED_FOR_PROD' | 'ARCHIVED_PROD' | 'PAUSED_DRAWDOWN_GUARD' | 'ROLLED_BACK' | 'REJECTED';
  win_rate_pct: number;
  profit_factor: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  sample_size: number;
  rules: Record<string, any>;
  created_at: number;
  updated_at: number;
}

export async function fetchAdminAgentsHeartbeat(): Promise<{ total: number; agents: AdminAgentHeartbeat[] }> {
  return api.get<{ total: number; agents: AdminAgentHeartbeat[] }>('/api/admin/agents/heartbeat');
}

export async function wakeAdminAgent(agentId: string): Promise<{ ok: boolean; message: string; data?: any }> {
  return api.post<{ ok: boolean; message: string; data?: any }>(`/api/admin/agents/${encodeURIComponent(agentId)}/wake`);
}

export async function togglePauseAdminAgent(agentId: string): Promise<{ ok: boolean; agent_id: string; is_paused: boolean; status: string; message: string }> {
  return api.post<{ ok: boolean; agent_id: string; is_paused: boolean; status: string; message: string }>(`/api/admin/agents/${encodeURIComponent(agentId)}/toggle-pause`);
}

export async function fetchAdminAiQuota(): Promise<AdminAiQuota> {
  return api.get<AdminAiQuota>('/api/admin/ai/quota');
}

export async function updateAdminAiQuota(payload: { daily_cap?: number; reset_today?: boolean; override_minutes?: number }): Promise<AdminAiQuota> {
  return api.put<AdminAiQuota>('/api/admin/ai/quota', payload);
}

export async function fetchStrategyReviewQueue(): Promise<{ total: number; queue: StrategyReviewQueueItem[] }> {
  return api.get<{ total: number; queue: StrategyReviewQueueItem[] }>('/api/admin/strategies/review-queue');
}

export async function approveStrategy(candidateId: string): Promise<{ ok: boolean; message: string }> {
  return api.post<{ ok: boolean; message: string }>(`/api/admin/strategies/${encodeURIComponent(candidateId)}/approve`);
}

export async function rejectStrategy(candidateId: string): Promise<{ ok: boolean; message: string }> {
  return api.post<{ ok: boolean; message: string }>(`/api/admin/strategies/${encodeURIComponent(candidateId)}/reject`);
}

export async function fetchStrategyHistory(): Promise<{ total: number; strategies: StrategyHistoryItem[] }> {
  return api.get<{ total: number; strategies: StrategyHistoryItem[] }>('/api/admin/strategies/history');
}

export async function rollbackStrategy(candidateId: string): Promise<{ ok: boolean; message: string }> {
  return api.post<{ ok: boolean; message: string }>(`/api/admin/strategies/${encodeURIComponent(candidateId)}/rollback`);
}

export async function updateUserLanguage(language: 'vi' | 'en'): Promise<{ ok: boolean; preferred_language: string }> {
  return api.patch<{ ok: boolean; preferred_language: string }>('/api/v1/auth/language', { language });
}

export async function fetchPaymentGateways(): Promise<{ sepay: boolean; usdt: boolean; supported_currencies: string[] }> {
  return api.get<{ sepay: boolean; usdt: boolean; supported_currencies: string[] }>('/api/v1/billing/gateways');
}


