import React, { useState } from 'react';
import { useQuantChat } from './useQuantChat';
import { fmtNum, fmtPnL } from '../utils/strategyDecision';
import { translateOrderStatus } from '../utils/stateMapping';
import type { PortfolioCardProps, RecentOrdersCardProps } from '../types/ai';

export interface CustomerAssistantProps {
  onNavigate?: (tab: 'overview' | 'accounts' | 'orders') => void;
}

const PortfolioGenerativeUI: React.FC<{
  data: PortfolioCardProps;
  onNavigate?: (tab: 'overview' | 'accounts' | 'orders') => void;
}> = ({ data, onNavigate }) => {
  const openPnl = (data.totalEquity ?? 0) - (data.totalBalance ?? 0);
  return (
    <div className="mt-3 rounded-xl border border-cyan-500/30 bg-[#040710]/90 p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-2 text-xs font-mono text-cyan-300">
        <span className="font-bold uppercase tracking-wider">Tóm Tắt Danh Mục & Rủi Ro</span>
        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate('accounts')}
            className="text-cyan-400 hover:text-cyan-200 underline"
          >
            Quản lý ({data.accountsCount ?? 0} TK) →
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 font-mono text-xs tabular-nums">
        <div className="rounded-lg border border-white/[0.06] bg-slate-950/80 p-2.5">
          <div className="text-[10px] text-slate-500">TỔNG BALANCE</div>
          <div className="mt-1 text-sm font-bold text-white">${fmtNum(data.totalBalance, 2)}</div>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-slate-950/80 p-2.5">
          <div className="text-[10px] text-slate-500">TỔNG EQUITY</div>
          <div className="mt-1 text-sm font-bold text-cyan-300">${fmtNum(data.totalEquity, 2)}</div>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-slate-950/80 p-2.5 col-span-2 sm:col-span-1">
          <div className="text-[10px] text-slate-500">FLOATING PNL</div>
          <div className={`mt-1 text-sm font-bold ${openPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {fmtPnL(openPnl)}
          </div>
        </div>
      </div>
    </div>
  );
};

const RecentOrdersGenerativeUI: React.FC<{
  data: RecentOrdersCardProps;
  onNavigate?: (tab: 'overview' | 'accounts' | 'orders') => void;
}> = ({ data, onNavigate }) => (
  <div className="mt-3 rounded-xl border border-emerald-500/30 bg-[#040710]/90 p-4 shadow-lg">
    <div className="mb-2 flex items-center justify-between text-xs font-mono text-emerald-300">
      <span className="font-bold uppercase tracking-wider">Sổ Lệnh Gần Nhất</span>
      {onNavigate && (
        <button
          type="button"
          onClick={() => onNavigate('orders')}
          className="text-emerald-300 hover:text-emerald-200 underline"
        >
          Mở sổ lệnh ({(data.orders || []).length}) →
        </button>
      )}
    </div>
    <div className="space-y-1.5 font-mono text-xs tabular-nums">
      {(data.orders || []).slice(0, 5).map((o) => (
        <div
          key={o.id}
          className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-slate-950/70 px-3 py-2"
        >
          <span className="font-semibold text-white">
            <strong className={String(o.side).toUpperCase() === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>
              {o.side}
            </strong>{' '}
            · #{o.id}
          </span>
          <span className="text-slate-400">@ {fmtNum(o.price, 2)}</span>
          <span className="text-cyan-300">{translateOrderStatus(o.state)}</span>
        </div>
      ))}
    </div>
  </div>
);

const QUICK_PROMPTS = [
  'Kiểm tra trạng thái rủi ro và Daily Drawdown danh mục hiện tại',
  'Phân tích chế độ thị trường XAU/USD khung M15 hôm nay',
  'Liệt kê 5 lệnh khớp gần nhất trên tài khoản MT5',
];

export const CustomerAssistant: React.FC<CustomerAssistantProps> = ({ onNavigate }) => {
  const { messages, status, error, sendMessage, regenerate, stop } = useQuantChat('customer');
  const [input, setInput] = useState('');
  const isStreaming = status === 'submitted' || status === 'streaming';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput('');
    await sendMessage({ text: trimmed });
  };

  return (
    <div className="quant-panel p-6 space-y-5" data-testid="customer-assistant">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
            Trợ Lý Định Lượng Thời Gian Thực
          </span>
          <h3 className="mt-0.5 text-lg font-bold text-white">
            Phân Tích Danh Mục MT5 & Giải Thích Tín Hiệu XAU/USD
          </h3>
        </div>
        <span className="inline-flex items-center gap-2 font-mono text-xs text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          AI Quant Stream Sẵn Sàng
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUICK_PROMPTS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={isStreaming}
            onClick={() => setInput(q)}
            className="rounded-xl border border-white/[0.08] bg-[#040710]/80 px-3 py-1.5 text-xs text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-200"
          >
            {q}
          </button>
        ))}
      </div>

      <div className="max-h-[420px] min-h-[260px] space-y-3 overflow-y-auto rounded-xl border border-white/[0.07] bg-[#040710]/90 p-4">
        {messages.length === 0 ? (
          <div className="flex h-52 flex-col items-center justify-center text-center">
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-cyan-400">
              ZUPIRUS QUANT COPILOT
            </div>
            <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-400">
              Đặt câu hỏi về mức sụt giảm tài khoản (Daily Drawdown), giải thích lý do vào lệnh XAU/USD M15 hoặc tra cứu nhanh sổ lệnh khớp gần nhất.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl p-4 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'ml-auto max-w-[85%] border border-cyan-500/30 bg-cyan-950/30 text-cyan-50'
                  : 'mr-auto max-w-[92%] border border-white/[0.07] bg-slate-900/75 text-slate-100'
              }`}
            >
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                {m.role === 'user' ? 'Nhà Giao Dịch' : 'Trợ Lý Định Lượng ZUPIRUS'}
              </div>
              {m.parts.map((part: any, idx: number) => {
                if (part.type === 'text') {
                  return (
                    <p key={idx} className="whitespace-pre-wrap">
                      {part.text}
                    </p>
                  );
                }
                if (part.type === 'data-portfolio' && part.data) {
                  return <PortfolioGenerativeUI key={idx} data={part.data} onNavigate={onNavigate} />;
                }
                if (part.type === 'data-orders' && part.data) {
                  return <RecentOrdersGenerativeUI key={idx} data={part.data} onNavigate={onNavigate} />;
                }
                return null;
              })}
            </div>
          ))
        )}
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-xl border border-rose-500/35 bg-rose-950/30 px-4 py-2.5 text-xs text-rose-200">
          <span>Không thể kết nối luồng phân tích trực tiếp. Vui lòng thử lại.</span>
          <button
            type="button"
            onClick={() => regenerate()}
            className="rounded-lg bg-rose-500/20 px-3 py-1 font-semibold hover:bg-rose-500/30"
          >
            Thử lại
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Nhập yêu cầu kiểm tra danh mục, ngưỡng cắt lỗ hoặc tín hiệu XAU/USD..."
          className="quant-input flex-1 text-sm"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={() => stop()}
            className="rounded-xl border border-amber-500/40 bg-amber-500/20 px-5 py-2.5 text-xs font-bold text-amber-300 whitespace-nowrap shrink-0"
          >
            Dừng
          </button>
        ) : (
          <button
            type="submit"
            className="quant-btn-primary px-6 py-2.5 text-xs whitespace-nowrap shrink-0"
          >
            Gửi Truy Vấn
          </button>
        )}
      </form>
    </div>
  );
};
