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
    let errData: any;
    try {
      errData = await response.json();
    } catch {
      errData = await response.text();
    }
    const message =
      (typeof errData === 'object' && (errData?.detail || errData?.message)) ||
      `HTTP ${response.status}: ${response.statusText}`;
    throw new ApiError(message, response.status, errData);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
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
