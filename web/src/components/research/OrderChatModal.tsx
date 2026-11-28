import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../../api/client';
import {
  MessageSquare,
  Send,
  Paperclip,
  X,
  Download,
  FileText,
  Image as ImageIcon,
  RefreshCw,
  AlertCircle,
  FileSpreadsheet,
} from 'lucide-react';

export interface OrderChatModalProps {
  requestId: string;
  orderTitle?: string;
  currentStatus?: string;
  userRole?: 'client' | 'admin';
  embedded?: boolean;
  onClose: () => void;
  onOrderUpdated?: () => void;
}

export const OrderChatModal: React.FC<OrderChatModalProps> = ({
  requestId,
  orderTitle,
  currentStatus,
  userRole = 'client',
  embedded = false,
  onClose,
  onOrderUpdated,
}) => {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [connStatus, setConnStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadMessages = useCallback(async () => {
    try {
      setLoading(true);
      const res: any = await api.get(`/api/v1/research/orders/${encodeURIComponent(requestId)}/messages`);
      if (res?.messages && Array.isArray(res.messages)) {
        setMessages(res.messages);
      }
    } catch {
      // ignore message load error
    } finally {
      setLoading(false);
      setTimeout(scrollToBottom, 100);
    }
  }, [requestId]);

  // Connect SSE real-time stream
  useEffect(() => {
    loadMessages();

    const connectSSE = () => {
      try {
        const es = new EventSource(`/api/v1/research/orders/${encodeURIComponent(requestId)}/messages/events`);
        eventSourceRef.current = es;

        es.onopen = () => {
          setConnStatus('connected');
        };

        es.addEventListener('message', (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data?.event === 'new_message' && data.message) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === data.message.id)) return prev;
                return [...prev, data.message];
              });
              setTimeout(scrollToBottom, 50);
            } else if (data?.event === 'status_changed') {
              onOrderUpdated?.();
            }
          } catch {
            // ignore parse error
          }
        });

        es.onerror = () => {
          setConnStatus('disconnected');
          es.close();
          // Attempt auto reconnect after 5s
          if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = setTimeout(connectSSE, 5000);
        };
      } catch {
        setConnStatus('disconnected');
      }
    };

    connectSSE();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [loadMessages, onOrderUpdated, requestId]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);


  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      const res: any = await api.post(`/api/v1/research/orders/${encodeURIComponent(requestId)}/messages`, {
        message: text,
      });
      if (res?.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.message.id)) return prev;
          return [...prev, res.message];
        });
      }
      setInputText('');
      setTimeout(scrollToBottom, 50);
    } catch (err: any) {
      setUploadError(err?.message || 'Không thể gửi tin nhắn.');
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      await api.post(`/api/v1/research/orders/${encodeURIComponent(requestId)}/attachments`, formData);
      await loadMessages();
    } catch (err: any) {
      setUploadError(err?.message || 'Không thể tải tệp lên.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSetRunInput = async (attId: string) => {
    try {
      await api.post(`/api/v1/admin/research/requests/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(attId)}/set-run-input`, {});
      alert('Đã thiết lập tệp này làm đầu vào dữ liệu cho lượt chạy nghiên cứu.');
      onOrderUpdated?.();
    } catch (err: any) {
      alert(err?.message || 'Lỗi khi gán tệp đầu vào.');
    }
  };

  const chatContent = (
    <div
      className={`w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden ${
        embedded ? 'h-[560px]' : 'max-w-2xl h-[85vh] max-h-[700px]'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">Trao Đổi Nghiên Cứu &amp; Hồ Sơ</h3>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-cyan-300">
              {requestId}
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                connStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              }`}
              title={`Kết nối: ${connStatus}`}
            />
          </div>
          <p className="text-xs text-slate-400 truncate max-w-md">
            {orderTitle || 'Yêu cầu nghiên cứu định lượng'} {currentStatus ? `· [${currentStatus}]` : ''}
          </p>
        </div>
        {!embedded ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            title="Đóng (Esc)"
            aria-label="Đóng cửa sổ trao đổi"
            data-testid="close-chat-modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0 z-10"
          >
            <X className="w-5 h-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            title="Về Tổng quan hồ sơ"
            aria-label="Về Tổng quan hồ sơ"
            data-testid="close-chat-embedded"
            className="text-xs px-2.5 py-1 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition cursor-pointer flex items-center gap-1 border border-slate-800 shrink-0 z-10"
          >
            <span>Về Đề Xuất & Báo Giá →</span>
          </button>
        )}
      </div>

        {/* Message Thread Body */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-950/30">
          {loading && messages.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
              <span>Đang tải lịch sử trao đổi...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 space-y-1">
              <MessageSquare className="w-6 h-6 mx-auto opacity-40 text-slate-400 mb-2" />
              <p>Chưa có tin nhắn nào trong cuộc trao đổi này.</p>
              <p className="text-[11px] text-slate-600">
                Bạn có thể gửi câu hỏi, yêu cầu làm rõ phạm vi hoặc đính kèm tài liệu phía dưới.
              </p>
            </div>
          ) : (
            messages.map((m: any) => {
              const isAI = m.sender_role === 'ai_assistant';
              const isAdmin = m.sender_role === 'admin';
              const isMe = userRole === m.sender_role;

              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${
                    isMe ? 'items-end' : 'items-start'
                  } space-y-1 max-w-[85%] ${isMe ? 'ml-auto' : 'mr-auto'}`}
                >
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono px-1">
                    <span className={isAdmin ? 'text-cyan-400 font-semibold' : isAI ? 'text-teal-400 font-semibold' : 'text-slate-300'}>
                      {m.sender_name || (isAdmin ? 'Ban Quản Trị' : isAI ? 'ZUPIRUS AI Desk' : 'Khách Hàng')}
                    </span>
                    <span>{new Date(m.created_at * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  <div
                    className={`p-3 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap break-words ${
                      isAI
                        ? 'bg-slate-900 border border-teal-500/30 text-teal-100'
                        : isMe
                        ? 'bg-cyan-600 text-white rounded-br-none'
                        : isAdmin
                        ? 'bg-slate-800 border border-cyan-500/30 text-slate-200 rounded-bl-none'
                        : 'bg-slate-800/90 text-slate-200 rounded-bl-none border border-slate-700/60'
                    }`}
                  >
                    {m.message}

                    {/* Attachment preview / download link */}
                    {m.attachment_name && (
                      <div className="mt-2.5 pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-1.5 font-mono">
                          {m.attachment_type?.startsWith('image') ? (
                            <ImageIcon className="w-3.5 h-3.5 text-cyan-300" />
                          ) : m.attachment_type?.includes('csv') ? (
                            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-300" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-amber-300" />
                          )}
                          <span className="truncate max-w-[180px]">{m.attachment_name}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <a
                            href={`/api/v1/research/orders/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(m.attachment_id || m.id)}/download`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-200 hover:text-white underline underline-offset-2"
                          >
                            <Download className="w-3 h-3" />
                            <span>Tải về</span>
                          </a>

                          {userRole === 'admin' && (
                            <button
                              type="button"
                              onClick={() => handleSetRunInput(m.attachment_id || m.id)}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 hover:bg-cyan-900 transition"
                              title="Sử dụng tệp này làm đầu vào dữ liệu cho mô hình định lượng"
                            >
                              Gán Run Input
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Error notification banner */}
        {uploadError && (
          <div className="px-4 py-2 bg-rose-950/60 border-t border-rose-800/40 text-xs text-rose-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{uploadError}</span>
            </span>
            <button type="button" onClick={() => setUploadError(null)} className="text-rose-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Message Input Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/80">
          <form onSubmit={handleSendMessage} className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".png,.jpg,.jpeg,.webp,.pdf,.csv"
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition shrink-0"
              title="Đính kèm tệp (Ảnh PNG/JPG, PDF, CSV)"
            >
              <Paperclip className={`w-4 h-4 ${uploading ? 'animate-spin text-cyan-400' : ''}`} />
            </button>

            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Nhập nội dung trao đổi, làm rõ yêu cầu hoặc bổ sung ghi chú..."
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition"
              disabled={sending}
            />

            <button
              type="submit"
              disabled={!inputText.trim() || sending}
              className="p-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white transition shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500 px-1">
            <span>Hỗ trợ tệp: PNG, JPEG, WebP, PDF, CSV (Tối đa 20MB)</span>
            <span>Bảo mật cách ly 100%</span>
          </div>
        </div>
      </div>
    );

  if (embedded) {
    return chatContent;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Trao Đổi Nghiên Cứu & Hồ Sơ"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {chatContent}
    </div>
  );
};
