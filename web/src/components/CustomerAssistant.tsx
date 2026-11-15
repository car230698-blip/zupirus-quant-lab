import React, { useState } from 'react';
import { useQuantChat } from './useQuantChat.ts';
import type { PortfolioCardProps, RecentOrdersCardProps } from '../types/ai.ts';

export const PortfolioGenerativeUI: React.FC<PortfolioCardProps> = ({
  accountsCount,
  accounts,
  totalBalance,
  totalEquity,
  onNavigate,
}) => {
  const pnl = totalEquity - totalBalance;
  return (
    <div className="rounded-xl border border-cyan-500/30 bg-[#080d1a] p-4 text-xs shadow-md">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
        <span className="font-semibold text-cyan-400">Danh mục</span>
        <span className="text-slate-400 font-mono">{accountsCount} tài khoản</span>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3 text-center font-mono">
        <div className="rounded-lg bg-slate-900/60 p-2">
          <div className="text-[10px] text-slate-500">TỔNG SỐ DƯ</div>
          <div className="text-sm font-bold text-slate-200">${totalBalance.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-slate-900/60 p-2">
          <div className="text-[10px] text-slate-500">VỐN HIỆN TẠI</div>
          <div className="text-sm font-bold text-cyan-300">${totalEquity.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-slate-900/60 p-2">
          <div className="text-[10px] text-slate-500">LÃI/LỖ THẢ NỔI</div>
          <div className={`text-sm font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`}
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        {accounts.map((acc) => (
          <div key={acc.id} className="flex items-center justify-between rounded bg-slate-950/40 px-2.5 py-1.5 font-mono text-[11px]">
            <span className="text-slate-300">
              {acc.mode ? <span className="text-cyan-400 mr-1.5">[{acc.mode}]</span> : null}
              {acc.server} #{acc.login}
            </span>
            <span className="text-slate-400">
              Vốn: <b className="text-slate-200">${acc.equity.toLocaleString()}</b> ({acc.positions} vị thế)
            </span>
          </div>
        ))}
      </div>
      {onNavigate && (
        <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-end">
          <button
            type="button"
            onClick={() => onNavigate('overview')}
            className="text-cyan-400 hover:text-cyan-300 font-mono text-[11px] flex items-center gap-1 transition-colors"
          >
            <span>Xem chi tiết danh mục</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}
    </div>
  );
};

export const RecentOrdersGenerativeUI: React.FC<RecentOrdersCardProps> = ({ orders, onNavigate }) => {
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-[#080d1a] p-4 text-xs shadow-md">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
        <span className="font-semibold text-emerald-400">Lệnh gần đây</span>
        <span className="text-slate-400 font-mono">{orders.length} lệnh</span>
      </div>
      {orders.length === 0 ? (
        <div className="text-slate-500 font-mono text-center py-3">Chưa có lệnh thực thi.</div>
      ) : (
        <div className="space-y-1.5 font-mono text-[11px]">
          {orders.map((o) => (
            <div
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-950/50 border border-slate-800/70 px-2.5 py-1.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-slate-400">#{o.id}</span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-cyan-300">{o.source}</span>
                <span className={o.side === 'BUY' ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {o.side}
                </span>
                <span className="text-slate-200">@ ${Number(o.price).toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Ticket: {o.ticket || '—'}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase font-bold ${
                    o.state === 'filled'
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/40'
                      : o.state === 'queued'
                      ? 'bg-amber-950/80 text-amber-300 border border-amber-700/40'
                      : 'bg-rose-950/80 text-rose-300 border border-rose-700/40'
                  }`}
                >
                  {o.state}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {onNavigate && (
        <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-end">
          <button
            type="button"
            onClick={() => onNavigate('orders')}
            className="text-emerald-400 hover:text-emerald-300 font-mono text-[11px] flex items-center gap-1 transition-colors"
          >
            <span>Xem toàn bộ lịch sử lệnh</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}
    </div>
  );
};

export function CustomerAssistant({ onNavigate }: { onNavigate?: (tab: 'overview' | 'accounts' | 'orders') => void } = {}) {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status, stop, error, regenerate } = useQuantChat('customer');
  const busy = status === 'submitted' || status === 'streaming';

  function send(question: string) {
    const text = question.trim();
    if (text && !busy) {
      setInput('');
      void sendMessage({ text });
    }
  }

  return (
    <section className="quant-chat quant-panel" aria-label="Trợ lý danh mục">
      <div className="quant-suggestions">
        {['Xem số dư và vốn danh mục', 'Xem các lệnh gần đây'].map((question) => (
          <button className="quant-quiet" key={question} type="button" disabled={busy} onClick={() => send(question)}>{question}</button>
        ))}
      </div>
      <div className="quant-chat-messages" role="log" aria-label="Hội thoại" aria-busy={busy}>
        {messages.length === 0 && <p className="text-sm text-slate-400">Hỏi về danh mục hoặc lịch sử lệnh của bạn.</p>}
        {messages.map((message) => (
          <div className="quant-chat-message" data-role={message.role} key={message.id}>
            {message.parts.map((part, index) => {
              if (part.type === 'text') return <p key={index}>{part.text}</p>;
              if (part.type === 'data-portfolio') return <PortfolioGenerativeUI key={index} {...part.data} onNavigate={onNavigate} />;
              if (part.type === 'data-orders') return <RecentOrdersGenerativeUI key={index} {...part.data} onNavigate={onNavigate} />;
              return null;
            })}
          </div>
        ))}
      </div>
      {error && <div className="quant-alert" role="alert">Không thể tải phản hồi. <button className="quant-quiet" type="button" onClick={() => void regenerate()}>Thử lại</button></div>}
      <form onSubmit={(event) => { event.preventDefault(); send(input); }}>
        <input aria-label="Câu hỏi" value={input} maxLength={2000} onChange={(event) => setInput(event.target.value)} placeholder="Hỏi về danh mục của bạn…" />
        {busy ? <button className="quant-quiet" type="button" onClick={() => void stop()}>Dừng</button> :
          <button className="quant-primary" disabled={!input.trim()}>Gửi ↗</button>}
      </form>
    </section>
  );
}
