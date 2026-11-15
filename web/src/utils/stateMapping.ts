export interface BackendStateInfo {
  label: string;
  badge: string;
}

export function mapBackendState(state: string): BackendStateInfo {
  switch (state) {
    case 'queued':
      return { label: 'Đang chờ', badge: 'bg-amber-950 text-amber-300 border border-amber-700/50' };
    case 'resume':
      return { label: 'Chờ tiếp tục', badge: 'bg-blue-950 text-blue-300 border border-blue-700/50' };
    case 'waiting_approval':
      return { label: 'Chờ duyệt', badge: 'bg-amber-950 text-amber-300 border border-amber-700/50' };
    case 'filled':
      return { label: 'Đã khớp', badge: 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' };
    case 'completed':
      return { label: 'Hoàn tất', badge: 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' };
    case 'cancelled':
      return { label: 'Đã hủy', badge: 'bg-slate-800 text-slate-300 border border-slate-700' };
    case 'expired':
      return { label: 'Hết hạn', badge: 'bg-slate-800 text-slate-400 border border-slate-700' };
    case 'rejected':
      return { label: 'Bị từ chối', badge: 'bg-rose-950 text-rose-300 border border-rose-700/50' };
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
      return { label: state, badge: 'bg-slate-800 text-slate-300 border border-slate-700' };
  }
}

export const orderStates = ['queued', 'intent', 'unknown', 'filled', 'rejected', 'cancelled', 'expired'] as const;
export const activityStates = ['queued', 'resume', 'waiting_approval', 'running', 'completed', 'failed'] as const;
