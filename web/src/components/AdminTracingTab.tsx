import React from 'react';

interface AdminTracingTabProps {
  tracingData: any;
}

export const AdminTracingTab: React.FC<AdminTracingTabProps> = ({ tracingData }) => {
  if (!tracingData) return <div className="quant-status" role="status">Chưa nhận được dữ liệu truy vết.</div>;
  return (
    <div className="space-y-6">
      <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-200">
              {tracingData.tracing_tool || 'LangSmith Tracing Telemetry'}
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
              Dự án: {tracingData.project}
            </span>
          </div>

          <span
            className={`rounded px-2 py-0.5 text-[10px] font-mono ${
              tracingData.langsmith_connected
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50'
                : 'bg-slate-800 text-slate-300 border border-slate-700'
            }`}
          >
            {tracingData.langsmith_connected ? 'ĐÃ KẾT NỐI CLOUD' : 'BẬT (BUFFER CỤC BỘ)'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
          <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800">
            <span className="text-slate-500 block text-[10px]">CÔNG CỤ TRUY VẾT</span>
            <span className="text-sm font-bold text-slate-100 mt-1 truncate block">
              {tracingData.tracing_tool || 'Local Buffer'}
            </span>
          </div>
          <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800">
            <span className="text-slate-500 block text-[10px]">TỔNG TRACES ĐÃ GHI</span>
            <span className="text-lg font-bold text-cyan-300 mt-1">{tracingData.total_traces_recorded}</span>
          </div>
          <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800">
            <span className="text-slate-500 block text-[10px]">LẦN CẬP NHẬT</span>
            <span className="text-xs font-bold text-amber-300 mt-1">
              {tracingData.last_updated ? new Date(tracingData.last_updated * 1000).toLocaleTimeString('vi-VN') : 'Chưa ghi nhận'}
            </span>
          </div>
          <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800">
            <span className="text-slate-500 block text-[10px]">TÌNH TRẠNG KHẢ DỤNG</span>
            <span className="text-xs font-bold text-emerald-400 mt-1 truncate block">
              {tracingData.availability_info || 'Chưa xác định'}
            </span>
          </div>
        </div>

        {/* Recent trace events */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-300">Các vết suy luận thực tế gần nhất:</h4>
          {!tracingData.recent_traces?.length ? (
            <div className="p-4 text-center text-slate-500 font-mono text-xs">
              Chưa có trace event nào được ghi. Khi AI Assistant hoặc LangGraph chạy, vết sự kiện sẽ hiển thị ở đây.
            </div>
          ) : (
            <div className="space-y-2">
              {tracingData.recent_traces.map((t: any, idx: number) => (
                <div
                  key={idx}
                  className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded bg-slate-950/60 border border-slate-800/80 font-mono text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">{t.run_type || 'llm'}</span>
                    <span className="text-slate-300">{t.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-400 text-[11px]">
                    <span>Độ trễ: {Number(t.latency_ms || 0).toFixed(1)}ms</span>
                    <span>Tokens: {t.tokens?.total_tokens ?? ((t.prompt_tokens || 0) + (t.completion_tokens || 0))}</span>
                    <span className={t.status === 'success' ? 'text-emerald-400' : 'text-rose-400'}>
                      {t.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
