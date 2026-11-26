import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, X, Zap } from 'lucide-react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastProps {
  message: string | null;
  type?: ToastType;
  onClose: () => void;
  duration?: number;
}

export const ToastNotification: React.FC<ToastProps> = ({
  message,
  type = 'info',
  onClose,
  duration = 4000,
}) => {
  const [progress, setProgress] = useState(100);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!message) return;
    setProgress(100);
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onCloseRef.current();
      }
    }, 40);
    return () => clearInterval(interval);
  }, [message, duration]);

  if (!message || typeof document === 'undefined') return null;

  const typeConfig: Record<
    ToastType,
    { border: string; iconBg: string; text: string; icon: React.ReactNode; bar: string }
  > = {
    info: {
      border: 'border-cyan-500/35',
      iconBg: 'bg-cyan-500/15 text-cyan-300',
      text: 'text-slate-100',
      icon: <Zap className="w-4 h-4" />,
      bar: 'bg-cyan-400',
    },
    success: {
      border: 'border-emerald-500/40',
      iconBg: 'bg-emerald-500/15 text-emerald-300',
      text: 'text-slate-100',
      icon: <Check className="w-4 h-4" />,
      bar: 'bg-emerald-400',
    },
    warning: {
      border: 'border-amber-500/40',
      iconBg: 'bg-amber-500/15 text-amber-300',
      text: 'text-slate-100',
      icon: <AlertTriangle className="w-4 h-4" />,
      bar: 'bg-amber-400',
    },
    error: {
      border: 'border-rose-500/45',
      iconBg: 'bg-rose-500/15 text-rose-300',
      text: 'text-rose-100',
      icon: <X className="w-4 h-4" />,
      bar: 'bg-rose-500',
    },
  };

  const cfg = typeConfig[type] || typeConfig.info;

  const toastElement = (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 sm:top-6 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-1.5rem)] max-w-md pointer-events-auto animate-toast"
    >
      <div
        className={`relative overflow-hidden rounded-xl border bg-[#0b1120]/96 p-3.5 backdrop-blur-xl shadow-2xl text-xs ${cfg.border} ${cfg.text}`}
      >
        <div className="flex items-start gap-3">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${cfg.iconBg}`}>
            {cfg.icon}
          </span>
          <div className="flex-1 pr-1 pt-0.5 leading-relaxed break-words font-medium text-[13px]">
            {message}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng thông báo"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/[0.06]">
          <div
            className={`h-full transition-[width] duration-75 ease-linear ${cfg.bar}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );

  return createPortal(toastElement, document.body);
};
