import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Đã xảy ra lỗi hiển thị không mong muốn.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ZUPIRUS UI ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B1220] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-rose-500/35 bg-[#060c1d] p-6 space-y-4 shadow-2xl">
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-rose-400">
              ZUPIRUS FAIL-SAFE RECOVERY
            </div>
            <h1 className="text-xl font-extrabold text-white">
              Giao diện tạm thời gặp sự cố
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              Dữ liệu tài khoản và hệ thống bảo vệ lệnh trên máy chủ vẫn hoạt động bình thường.
              Bạn có thể tải lại giao diện ngay bây giờ.
            </p>
            {this.state.errorMessage && (
              <pre className="rounded-xl border border-white/10 bg-[#030712] p-3 text-[11px] font-mono text-rose-300 overflow-x-auto">
                {this.state.errorMessage}
              </pre>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-300 transition cursor-pointer"
            >
              Tải lại giao diện →
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
