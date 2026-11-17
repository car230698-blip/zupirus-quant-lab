import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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

  const typeConfig: Record<ToastType, { border: string; bg: string; text: string; glow: string; icon: string; bar: string }> = {
    info: {
      border: 'border-cyan-400/50',
      bg: 'bg-[#04091a]/95',
      text: 'text-cyan-200',
      glow: 'shadow-[0_16px_40px_rgba(0,0,0,0.85),0_0_24px_rgba(6,182,212,0.25)]',
      icon: '⚡',
      bar: 'bg-cyan-400',
    },
    success: {
      border: 'border-emerald-400/50',
      bg: 'bg-[#031014]/95',
      text: 'text-emerald-200',
      glow: 'shadow-[0_16px_40px_rgba(0,0,0,0.85),0_0_24px_rgba(16,185,129,0.25)]',
      icon: '✓',
      bar: 'bg-emerald-400',
    },
    warning: {
      border: 'border-amber-400/50',
      bg: 'bg-[#140b03]/95',
      text: 'text-amber-200',
      glow: 'shadow-[0_16px_40px_rgba(0,0,0,0.85),0_0_24px_rgba(245,158,11,0.25)]',
      icon: '⚠',
      bar: 'bg-amber-400',
    },
    error: {
      border: 'border-rose-400/50',
      bg: 'bg-[#160408]/95',
      text: 'text-rose-200',
      glow: 'shadow-[0_16px_40px_rgba(0,0,0,0.85),0_0_24px_rgba(244,63,94,0.25)]',
      icon: '✕',
      bar: 'bg-rose-400',
    },
  };

  const cfg = typeConfig[type] || typeConfig.info;

  const toastElement = (
    <div
      role="alert"
      className="fixed top-4 sm:top-6 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-1.5rem)] max-w-md pointer-events-auto animate-toast"
    >
      <div
        className={`relative overflow-hidden rounded-2xl border p-3.5 sm:p-4 backdrop-blur-2xl font-mono text-xs ${cfg.border} ${cfg.bg} ${cfg.text} ${cfg.glow}`}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/10 font-bold text-sm">
            {cfg.icon}
          </span>
          <div className="flex-1 pr-1 pt-0.5 leading-relaxed break-words font-medium">
            {message}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng thông báo"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition cursor-pointer"
          >
            ✕
          </button>
        </div>
        {/* Subtle timer progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
          <div
            className={`h-full transition-all duration-75 ${cfg.bar}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );

  return createPortal(toastElement, document.body);
};
