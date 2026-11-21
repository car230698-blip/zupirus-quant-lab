import React from 'react';
import { IconBell } from './Icons';

export interface NotificationItem {
  id: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | string;
  title: string;
  body: string;
  read_at?: number | null;
  created_at?: number;
}

export interface NotificationBellMenuProps {
  notifications: NotificationItem[];
  unreadCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onMarkAllRead: () => void | Promise<void>;
  onMarkSingleRead: (id: string) => void | Promise<void>;
  isMobileHeader?: boolean;
}

export const NotificationBellMenu: React.FC<NotificationBellMenuProps> = ({
  notifications,
  unreadCount,
  isOpen,
  onToggle,
  onClose,
  onMarkAllRead,
  onMarkSingleRead,
  isMobileHeader = false,
}) => {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={
          isMobileHeader
            ? 'relative flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white transition cursor-pointer'
            : 'quant-quiet relative p-1.5 flex items-center justify-center cursor-pointer'
        }
        title="Thông báo hệ thống"
        aria-label="Thông báo hệ thống"
      >
        <IconBell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span
            className={
              isMobileHeader
                ? 'absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white shadow-sm'
                : 'absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm'
            }
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-800 bg-[#070c18] p-3 shadow-2xl z-50 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
              <span className="font-bold text-slate-200">Thông Báo Hệ Thống</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="text-[11px] text-amber-300 hover:underline cursor-pointer"
                >
                  Đọc tất cả
                </button>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto space-y-2">
              {notifications.length === 0 ? (
                <div className="py-6 text-center text-slate-500 text-xs">
                  Không có thông báo nào
                </div>
              ) : (
                notifications.map((n) => {
                  const isUnread = !n.read_at;
                  const isCrit = n.severity === 'CRITICAL';
                  const isWarn = n.severity === 'WARNING';
                  return (
                    <div
                      key={n.id}
                      onClick={() => isUnread && onMarkSingleRead(n.id)}
                      className={`p-2.5 rounded-lg border transition cursor-pointer text-left ${
                        isCrit
                          ? 'border-rose-500/30 bg-rose-950/20 text-rose-200'
                          : isWarn
                          ? 'border-amber-500/30 bg-amber-950/20 text-amber-200'
                          : 'border-slate-800 bg-[#040813] text-slate-300'
                      } ${isUnread ? 'ring-1 ring-amber-400/30' : 'opacity-70'}`}
                    >
                      <div className="flex items-center justify-between text-[10px]">
                        <span
                          className={`font-bold ${
                            isCrit ? 'text-rose-400' : isWarn ? 'text-amber-400' : 'text-cyan-400'
                          }`}
                        >
                          [{n.severity}] {n.title}
                        </span>
                        {isUnread && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
                      </div>
                      <div className="mt-1 text-xs text-slate-300 leading-snug">{n.body}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
