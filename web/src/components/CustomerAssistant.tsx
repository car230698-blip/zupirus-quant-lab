import React, { useState } from 'react';
import type { Message, PortfolioCardProps } from '../types/ai.ts';

export const PortfolioGenerativeUI: React.FC<PortfolioCardProps> = ({
  accountsCount,
  accounts,
  totalBalance,
  totalEquity,
}) => {
  const pnl = totalEquity - totalBalance;
  return (
    <div className="rounded-xl border border-cyan-500/30 bg-[#080d1a] p-4 text-xs shadow-md">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
        <span className="font-semibold text-cyan-400">📊 Tổng Quan Danh Mục Khách Hàng (Generative UI)</span>
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
          <div key={acc.id} className="flex items-center justify-between rounded bg-slate-950/40 px-2 py-1.5 font-mono text-[11px]">
            <span className="text-slate-300">{acc.server} #{acc.login}</span>
            <span className="text-slate-400">Vốn: <b className="text-slate-200">${acc.equity.toLocaleString()}</b> ({acc.positions} vị thế)</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const CustomerAssistant: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init_1',
      role: 'assistant',
      content: 'Xin chào! Tôi là Trợ lý Định lượng ZUPIRUS hỗ trợ bởi Vercel AI SDK 6. Bạn có thể hỏi về số dư, lãi/lỗ hoặc tình trạng các vị thế sao chép.',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { id: `user_${Date.now()}`, role: 'user', content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat/assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Zupirus': '1',
        },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        throw new Error(`Mã lỗi máy chủ: ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMsg: Message = { id: `assist_${Date.now()}`, role: 'assistant', content: '', toolCalls: [] };
      setMessages((prev) => [...prev, assistantMsg]);

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('0:')) {
              // Text stream
              const textPiece = JSON.parse(line.slice(2));
              assistantMsg.content += textPiece;
              setMessages((prev) => prev.map((m) => (m.id === assistantMsg.id ? { ...assistantMsg } : m)));
            } else if (line.startsWith('9:')) {
              // Tool call initiation
              const toolCall = JSON.parse(line.slice(2));
              assistantMsg.toolCalls = assistantMsg.toolCalls || [];
              assistantMsg.toolCalls.push(toolCall);
              setMessages((prev) => prev.map((m) => (m.id === assistantMsg.id ? { ...assistantMsg } : m)));
            } else if (line.startsWith('a:')) {
              // Tool call result
              const toolResult = JSON.parse(line.slice(2));
              if (assistantMsg.toolCalls) {
                const target = assistantMsg.toolCalls.find((t) => t.toolCallId === toolResult.toolCallId);
                if (target) {
                  target.result = toolResult.result;
                }
              }
              setMessages((prev) => prev.map((m) => (m.id === assistantMsg.id ? { ...assistantMsg } : m)));
            }
          }
        }
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { id: `err_${Date.now()}`, role: 'assistant', content: `Lỗi kết nối: ${err.message}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[520px] rounded-xl border border-slate-800 bg-[#0c1322] shadow-xl overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3 bg-[#080d1a]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-xs font-semibold text-slate-200">Trợ Lý Vercel AI SDK 6 (Data Stream Protocol)</span>
        </div>
        <span className="text-[10px] text-cyan-400/80 font-mono">Generative UI Ready</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                m.role === 'user'
                  ? 'bg-cyan-600 text-slate-950 font-medium'
                  : 'bg-slate-900 border border-slate-800 text-slate-200'
              }`}
            >
              {m.content}
            </div>

            {/* Generative UI Tool Invocations */}
            {m.toolCalls && m.toolCalls.map((tc) => {
              if (tc.toolName === 'renderPortfolioCard' && tc.result) {
                return (
                  <div key={tc.toolCallId} className="w-full max-w-[85%] mt-2">
                    <PortfolioGenerativeUI {...tc.result} />
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}
        {isLoading && (
          <div className="text-xs text-slate-500 font-mono italic animate-pulse">
            Đang suy luận và tạo giao diện...
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-slate-800 p-3 bg-[#080d1a] flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Hỏi về danh mục, số dư hoặc lệnh mở..."
          className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 transition-colors"
        >
          Gửi
        </button>
      </form>
    </div>
  );
};

