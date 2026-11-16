/**
 * Safe error message formatter for API responses.
 * Prevents displaying raw "[object Object]" when FastAPI returns Pydantic validation error lists.
 */
export function formatApiError(data: any, fallbackStatus?: number | string): string {
  if (!data) return `Lỗi ${fallbackStatus || 'không xác định'}`;
  
  if (typeof data === 'string') return data;

  // FastAPI HTTPException detail string
  if (typeof data.detail === 'string') return data.detail;

  // FastAPI / Pydantic validation error list: [{ loc: [...], msg: "...", type: "..." }]
  if (Array.isArray(data.detail)) {
    const messages = data.detail.map((err: any) => {
      if (typeof err === 'string') return err;
      if (err && typeof err === 'object') {
        const loc = Array.isArray(err.loc) ? err.loc.filter((x: any) => x !== 'body').join('.') : '';
        const msg = err.msg || 'Không hợp lệ';
        return loc ? `${loc}: ${msg}` : msg;
      }
      return String(err);
    });
    return messages.filter(Boolean).join('; ') || `Lỗi dữ liệu (${fallbackStatus || 422})`;
  }

  // Nested error object
  if (data.detail && typeof data.detail === 'object') {
    return data.detail.message || data.detail.msg || JSON.stringify(data.detail);
  }

  if (typeof data.message === 'string') return data.message;
  if (typeof data.error === 'string') return data.error;

  return `Lỗi hệ thống (${fallbackStatus || '500'})`;
}
