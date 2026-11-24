export interface BackendStateInfo {
  label: string;
  badge: string;
}

export function mapBackendState(state: string, lang: 'vi' | 'en' = 'vi'): BackendStateInfo {
  const s = String(state || '').toLowerCase();
  if (lang === 'en') {
    switch (s) {
      case 'queued':
        return { label: 'Queued', badge: 'bg-amber-950 text-amber-300 border border-amber-700/50' };
      case 'resume':
        return { label: 'Resume', badge: 'bg-blue-950 text-blue-300 border border-blue-700/50' };
      case 'waiting_approval':
        return { label: 'Pending Approval', badge: 'bg-amber-950 text-amber-300 border border-amber-700/50' };
      case 'filled':
      case 'executed':
        return { label: 'Filled', badge: 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' };
      case 'completed':
        return { label: 'Completed', badge: 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' };
      case 'closed':
        return { label: 'Closed', badge: 'bg-slate-800 text-slate-300 border border-slate-700' };
      case 'cancelled':
        return { label: 'Cancelled', badge: 'bg-slate-800 text-slate-300 border border-slate-700' };
      case 'expired':
        return { label: 'Expired', badge: 'bg-slate-800 text-slate-400 border border-slate-700' };
      case 'rejected':
        return { label: 'Rejected', badge: 'bg-rose-950 text-rose-300 border border-rose-700/50' };
      case 'skipped':
        return { label: 'Skipped', badge: 'bg-slate-800 text-slate-400 border border-slate-700' };
      case 'intent':
        return { label: 'Executing', badge: 'bg-cyan-950 text-cyan-300 border border-cyan-700/50' };
      case 'unknown':
        return { label: 'Unreconciled', badge: 'bg-purple-950 text-purple-300 border border-purple-700/50' };
      case 'running':
        return { label: 'Running', badge: 'bg-cyan-950 text-cyan-300 border border-cyan-700/50' };
      case 'failed':
      case 'error':
        return { label: 'Error', badge: 'bg-rose-950 text-rose-300 border border-rose-700/50' };
      default:
        return { label: state || '—', badge: 'bg-slate-800 text-slate-300 border border-slate-700' };
    }
  }

  switch (s) {
    case 'queued':
      return { label: 'Đang chờ', badge: 'bg-amber-950 text-amber-300 border border-amber-700/50' };
    case 'resume':
      return { label: 'Chờ tiếp tục', badge: 'bg-blue-950 text-blue-300 border border-blue-700/50' };
    case 'waiting_approval':
      return { label: 'Chờ duyệt', badge: 'bg-amber-950 text-amber-300 border border-amber-700/50' };
    case 'filled':
    case 'executed':
      return { label: 'Đã khớp', badge: 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' };
    case 'completed':
      return { label: 'Hoàn tất', badge: 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' };
    case 'closed':
      return { label: 'Đã đóng', badge: 'bg-slate-800 text-slate-300 border border-slate-700' };
    case 'cancelled':
      return { label: 'Đã hủy', badge: 'bg-slate-800 text-slate-300 border border-slate-700' };
    case 'expired':
      return { label: 'Hết hạn', badge: 'bg-slate-800 text-slate-400 border border-slate-700' };
    case 'rejected':
      return { label: 'Bị từ chối', badge: 'bg-rose-950 text-rose-300 border border-rose-700/50' };
    case 'skipped':
      return { label: 'Bỏ qua', badge: 'bg-slate-800 text-slate-400 border border-slate-700' };
    case 'intent':
      return { label: 'Đang thực thi', badge: 'bg-cyan-950 text-cyan-300 border border-cyan-700/50' };
    case 'unknown':
      return { label: 'Chưa đối soát', badge: 'bg-purple-950 text-purple-300 border border-purple-700/50' };
    case 'running':
      return { label: 'Đang chạy', badge: 'bg-cyan-950 text-cyan-300 border border-cyan-700/50' };
    case 'failed':
    case 'error':
      return { label: 'Lỗi', badge: 'bg-rose-950 text-rose-300 border border-rose-700/50' };
    default:
      return { label: state || '—', badge: 'bg-slate-800 text-slate-300 border border-slate-700' };
  }
}

export function translateOrderStatus(status: unknown, lang: 'vi' | 'en' = 'vi'): string {
  return mapBackendState(String(status || 'unknown'), lang).label;
}

export function translateAction(action: unknown, lang: 'vi' | 'en' = 'vi'): string {
  const upper = String(action || '').toUpperCase();
  if (lang === 'en') {
    if (upper === 'BUY' || upper === 'LONG') return 'BUY';
    if (upper === 'SELL' || upper === 'SHORT') return 'SELL';
    if (upper === 'HOLD' || upper === 'WAIT') return 'HOLD';
    return upper || 'HOLD';
  }
  if (upper === 'BUY' || upper === 'LONG') return 'MUA (BUY)';
  if (upper === 'SELL' || upper === 'SHORT') return 'BÁN (SELL)';
  if (upper === 'HOLD' || upper === 'WAIT') return 'QUAN SÁT (HOLD)';
  return upper || 'QUAN SÁT';
}

export function translateRegime(regime: unknown, lang: 'vi' | 'en' = 'vi'): string {
  const upper = String(regime || '').toUpperCase();
  if (lang === 'en') {
    if (upper.includes('TREND')) return 'Trending Market';
    if (upper.includes('RANG') || upper.includes('MEAN')) return 'Ranging Market';
    if (upper.includes('VOLATIL')) return 'High Volatility';
    return regime ? String(regime) : 'Balanced Quant Regime';
  }
  if (upper.includes('TREND')) return 'Xu Hướng Mạnh (Trending)';
  if (upper.includes('RANG') || upper.includes('MEAN')) return 'Tích Luỹ Biên Độ (Ranging)';
  if (upper.includes('VOLATIL')) return 'Biến Động Cao (High Volatility)';
  return regime ? String(regime) : 'Cân Bằng Định Lượng';
}

export const orderStates = ['queued', 'intent', 'unknown', 'filled', 'closed', 'rejected', 'skipped', 'cancelled', 'expired'] as const;
