import React from 'react';
import { Bell } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';

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
  const { lang } = useLanguage();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={
          isMobileHeader
            ? 'relative flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white transition cursor-pointer'
            : 'quant-quiet relative px-2.5 flex items-center justify-center cursor-pointer'
        }
        title={lang === 'en' ? 'Notifications' : 'Thông báo'}
        aria-label={lang === 'en' ? 'Notifications' : 'Thông báo'}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-800 bg-[#0B1220] p-3.5 shadow-2xl z-50 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-2.5">
              <span className="font-semibold text-white">
                {lang === 'en' ? 'System Notifications' : 'Thông báo hệ thống'}
              </span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="text-[11px] font-medium text-[#12B5A6] hover:underline cursor-pointer"
                >
                  {lang === 'en' ? 'Mark all read' : 'Đọc tất cả'}
                </button>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto space-y-2">
              {notifications.length === 0 ? (
                <div className="py-6 text-center text-slate-500 text-xs">
                  {lang === 'en' ? 'No notifications' : 'Không có thông báo nào'}
                </div>
              ) : (
                notifications.map((n) => {
                  const isUnread = !n.read_at;
                  const isCrit = n.severity === 'CRITICAL';
                  const isWarn = n.severity === 'WARNING';
                  return (
                    <button
                      type="button"
                      key={n.id}
                      onClick={() => isUnread && onMarkSingleRead(n.id)}
                      className={`w-full p-2.5 rounded-lg border transition cursor-pointer text-left ${
                        isCrit
                          ? 'border-rose-500/30 bg-rose-950/20 text-rose-100'
                          : isWarn
                          ? 'border-amber-500/30 bg-amber-950/20 text-amber-100'
                          : 'border-slate-800 bg-[#060A13] text-slate-200'
                      } ${isUnread ? 'ring-1 ring-[#12B5A6]/35' : 'opacity-70'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`font-semibold text-xs ${
                            isCrit ? 'text-rose-300' : isWarn ? 'text-amber-300' : 'text-cyan-300'
                          }`}
                        >
                          {n.title}
                        </span>
                        {isUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#12B5A6]" />}
                      </div>
                      <div className="mt-1 text-xs text-slate-400 leading-snug">{n.body}</div>
                    </button>
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
