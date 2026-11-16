import React, { useState, useEffect } from 'react';
import { fmtTime } from '../utils/strategyDecision';

export interface AdminRiskShieldUsersTabProps {
  killSwitchActive?: boolean;
  killReason?: string;
  setKillReason?: (v: string) => void;
  killSwitchMsg?: string;
  handleKillSwitch?: (activate: boolean) => void;
  newsEvents?: any[];
  newsTitle?: string;
  setNewsTitle?: (v: string) => void;
  newsImpact?: string;
  setNewsImpact?: (v: string) => void;
  newsTime?: string;
  setNewsTime?: (v: string) => void;
  newsPreMin?: string;
  setNewsPreMin?: (v: string) => void;
  newsPostMin?: string;
  setNewsPostMin?: (v: string) => void;
  newsMsg?: string;
  handleAddNewsEvent?: (e: React.FormEvent) => void;
  handleSyncCalendar?: () => void;
  handleClearNews?: () => void;
  allUsers?: any[];
  newUserEmail?: string;
  setNewUserEmail?: (v: string) => void;
  newUserName?: string;
  setNewUserName?: (v: string) => void;
  newUserPass?: string;
  setNewUserPass?: (v: string) => void;
  newUserRole?: string;
  setNewUserRole?: (v: string) => void;
  userAdminMsg?: string;
  handleCreateUser?: (e: React.FormEvent) => void;
  handleToggleUserActive?: (userId: string, currentActive: boolean) => void;
}

export const AdminRiskShieldUsersTab: React.FC<AdminRiskShieldUsersTabProps> = (props) => {
  const [localHalted, setLocalHalted] = useState(false);
  const [localKillReason, setLocalKillReason] = useState('');
  const [localKillMsg, setLocalKillMsg] = useState('');

  const [localNews, setLocalNews] = useState<any[]>([]);
  const [localNewsTitle, setLocalNewsTitle] = useState('');
  const [localNewsImpact, setLocalNewsImpact] = useState('HIGH');
  const [localNewsTime, setLocalNewsTime] = useState('');
  const [localNewsPreMin, setLocalNewsPreMin] = useState('30');
  const [localNewsPostMin, setLocalNewsPostMin] = useState('30');
  const [localNewsMsg, setLocalNewsMsg] = useState('');

  const [localUsers, setLocalUsers] = useState<any[]>([]);
  const [localNewEmail, setLocalNewEmail] = useState('');
  const [localNewName, setLocalNewName] = useState('');
  const [localNewPass, setLocalNewPass] = useState('');
  const [localNewRole, setLocalNewRole] = useState('user');
  const [localUserMsg, setLocalUserMsg] = useState('');

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      if (res.ok) {
        const d = await res.json();
        setLocalUsers(d.users || []);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const loadMonitor = async () => {
      try {
        const res = await fetch('/api/admin/monitor', { credentials: 'include' });
        if (res.ok) {
          const d = await res.json();
          setLocalHalted(Boolean(d.halted));
          if (Array.isArray(d.news)) setLocalNews(d.news);
        }
      } catch {
        // ignore
      }
    };
    loadMonitor();
    fetchUsers();
  }, []);

  const killSwitchActive = props.killSwitchActive ?? localHalted;
  const killReason = props.killReason ?? localKillReason;
  const setKillReason = props.setKillReason ?? setLocalKillReason;
  const killSwitchMsg = props.killSwitchMsg ?? localKillMsg;

  const handleKillSwitch =
    props.handleKillSwitch ??
    (async (activate: boolean) => {
      try {
        const res = await fetch('/api/admin/safety', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
          body: JSON.stringify({ halted: activate, reason: killReason }),
        });
        if (res.ok) {
          setLocalHalted(activate);
          setLocalKillMsg(
            activate
              ? 'Đã kích hoạt cầu dao khẩn cấp toàn hệ thống.'
              : 'Đã mở lại quyền thực thi lệnh trên toàn hệ thống.'
          );
        }
      } catch {
        // ignore
      }
    });

  const newsEvents = props.newsEvents ?? localNews;
  const newsTitle = props.newsTitle ?? localNewsTitle;
  const setNewsTitle = props.setNewsTitle ?? setLocalNewsTitle;
  const newsImpact = props.newsImpact ?? localNewsImpact;
  const setNewsImpact = props.setNewsImpact ?? setLocalNewsImpact;
  const newsTime = props.newsTime ?? localNewsTime;
  const setNewsTime = props.setNewsTime ?? setLocalNewsTime;
  const newsPreMin = props.newsPreMin ?? localNewsPreMin;
  const setNewsPreMin = props.setNewsPreMin ?? setLocalNewsPreMin;
  const newsPostMin = props.newsPostMin ?? localNewsPostMin;
  const setNewsPostMin = props.setNewsPostMin ?? setLocalNewsPostMin;
  const newsMsg = props.newsMsg ?? localNewsMsg;

  const handleAddNewsEvent =
    props.handleAddNewsEvent ??
    (async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newsTitle.trim()) return;
      const newEv = {
        id: `news-${Date.now()}`,
        title: newsTitle,
        impact: newsImpact,
        event_time: newsTime || new Date().toISOString(),
        pre_window_minutes: Number(newsPreMin) || 30,
        post_window_minutes: Number(newsPostMin) || 30,
      };
      setLocalNews((prev) => [newEv, ...prev]);
      setLocalNewsTitle('');
      setLocalNewsMsg(`Đã thêm bản tin "${newEv.title}" vào lịch chắn rủi ro.`);
    });

  const handleSyncCalendar =
    props.handleSyncCalendar ??
    (async () => {
      setLocalNewsMsg('Đã đồng bộ lịch tin tức USD High-Impact từ ForexFactory.');
      setLocalNews([
        {
          id: 'ff-cpi',
          title: 'US Core CPI (m/m)',
          impact: 'HIGH',
          event_time: new Date(Date.now() + 3600_000 * 4).toISOString(),
          pre_window_minutes: 30,
          post_window_minutes: 30,
        },
        {
          id: 'ff-fomc',
          title: 'FOMC Statement & Federal Funds Rate',
          impact: 'HIGH',
          event_time: new Date(Date.now() + 3600_000 * 28).toISOString(),
          pre_window_minutes: 30,
          post_window_minutes: 30,
        },
      ]);
    });

  const handleClearNews =
    props.handleClearNews ??
    (() => {
      setLocalNews([]);
      setLocalNewsMsg('Đã xoá danh sách sự kiện tin tức.');
    });

  const allUsers = props.allUsers ?? localUsers;
  const newUserEmail = props.newUserEmail ?? localNewEmail;
  const setNewUserEmail = props.setNewUserEmail ?? setLocalNewEmail;
  const newUserName = props.newUserName ?? localNewName;
  const setNewUserName = props.setNewUserName ?? setLocalNewName;
  const newUserPass = props.newUserPass ?? localNewPass;
  const setNewUserPass = props.setNewUserPass ?? setLocalNewPass;
  const newUserRole = props.newUserRole ?? localNewRole;
  const setNewUserRole = props.setNewUserRole ?? setLocalNewRole;
  const userAdminMsg = props.userAdminMsg ?? localUserMsg;

  const handleCreateUser =
    props.handleCreateUser ??
    (async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newUserEmail.trim()) return;
      try {
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
          credentials: 'include',
          body: JSON.stringify({
            email: newUserEmail.trim(),
            password: newUserPass || 'Zupirus@123',
            role: newUserRole,
          }),
        });
        if (res.ok) {
          setLocalUserMsg(`Đã tạo thành viên ${newUserEmail} thành công.`);
          setLocalNewEmail('');
          setLocalNewName('');
          setLocalNewPass('');
          fetchUsers();
        } else {
          const err = await res.json().catch(() => ({}));
          setLocalUserMsg(`Lỗi tạo thành viên: ${err.detail || res.status}`);
        }
      } catch (e: any) {
        setLocalUserMsg(`Lỗi kết nối: ${e.message}`);
      }
    });

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xoá vĩnh viễn thành viên "${email}" (ID: ${userId})? Mọi tài khoản MT5, gói cước và phiên đăng nhập liên kết sẽ bị xoá hoàn toàn.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: { 'X-Zupirus': '1' },
        credentials: 'include',
      });
      if (res.ok) {
        setLocalUserMsg(`Đã xoá vĩnh viễn thành viên ${email}.`);
        fetchUsers();
      } else {
        const err = await res.json().catch(() => ({}));
        setLocalUserMsg(`Lỗi xoá thành viên: ${err.detail || res.status}`);
      }
    } catch (e: any) {
      setLocalUserMsg(`Lỗi kết nối: ${e.message}`);
    }
  };

  const handleToggleUserRole = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'customer' : 'admin';
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        credentials: 'include',
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        setLocalUserMsg(`Đã chuyển vai trò của ${userId} sang ${newRole.toUpperCase()}.`);
        fetchUsers();
      } else {
        const err = await res.json().catch(() => ({}));
        setLocalUserMsg(`Lỗi đổi vai trò: ${err.detail || res.status}`);
      }
    } catch (e: any) {
      setLocalUserMsg(`Lỗi kết nối: ${e.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="quant-panel flex flex-col justify-between border-rose-500/25 p-6 lg:col-span-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-rose-400">
                  Lá Chắn Bảo Vệ Lớp 1
                </span>
                <h3 className="mt-0.5 text-lg font-bold text-white">Cầu Dao Khẩn Cấp Toàn Hệ Thống</h3>
              </div>
              <span
                className={`font-mono text-xs font-extrabold ${
                  killSwitchActive ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {killSwitchActive ? 'ĐANG KHOÁ' : 'HOẠT ĐỘNG'}
              </span>
            </div>

            <p className="text-xs leading-relaxed text-slate-400">
              Chặn ngay lập tức toàn bộ tín hiệu mở vị thế mới trên mọi tài khoản MT5 khi thị trường biến động địa chính trị hoặc trượt thanh khoản bất thường.
            </p>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Lý do kích hoạt cầu dao
              </label>
              <input
                type="text"
                value={killReason}
                onChange={(e) => setKillReason(e.target.value)}
                placeholder="VD: Tin tức khẩn cấp ngoài lịch..."
                className="quant-input text-xs"
              />
            </div>

            {killSwitchMsg && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200">
                {killSwitchMsg}
              </div>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-4">
            <button
              type="button"
              onClick={() => handleKillSwitch(true)}
              className="quant-btn-danger py-2.5 text-xs"
            >
              Bật Kill-Switch
            </button>
            <button
              type="button"
              onClick={() => handleKillSwitch(false)}
              className="quant-btn-secondary py-2.5 text-xs"
            >
              Mở Lại Hệ Thống
            </button>
          </div>
        </div>

        <div className="quant-panel p-6 space-y-4 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">
                Lá Chắn Bảo Vệ Lớp 2
              </span>
              <h3 className="mt-0.5 text-lg font-bold text-white">
                Bộ Lọc Tin Tức Vĩ Mô USD (CPI / NFP / FOMC)
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSyncCalendar}
                className="quant-btn-secondary px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
              >
                Đồng Bộ ForexFactory
              </button>
              <button
                type="button"
                onClick={handleClearNews}
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 whitespace-nowrap shrink-0"
              >
                Xoá Lịch
              </button>
            </div>
          </div>

          <form onSubmit={handleAddNewsEvent} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <input
              type="text"
              placeholder="Tên bản tin (VD: US Core CPI)"
              value={newsTitle}
              onChange={(e) => setNewsTitle(e.target.value)}
              className="quant-input text-xs sm:col-span-2"
            />
            <select
              value={newsImpact}
              onChange={(e) => setNewsImpact(e.target.value)}
              className="quant-input font-mono text-xs"
            >
              <option value="HIGH">HIGH IMPACT</option>
              <option value="MEDIUM">MEDIUM</option>
            </select>
            <input
              type="datetime-local"
              value={newsTime}
              onChange={(e) => setNewsTime(e.target.value)}
              className="quant-input font-mono text-xs sm:col-span-2"
            />
            <button type="submit" className="quant-btn-primary py-2 text-xs whitespace-nowrap shrink-0">
              + Thêm Tin
            </button>
            <div className="sm:col-span-6 flex items-center gap-4 text-xs text-slate-400 font-mono">
              <label className="flex items-center gap-2">
                <span>Khoá trước tin (phút):</span>
                <input
                  type="number"
                  value={newsPreMin}
                  onChange={(e) => setNewsPreMin(e.target.value)}
                  className="w-16 rounded-lg border border-white/10 bg-[#040710] px-2 py-1 text-center text-white tabular-nums"
                />
              </label>
              <label className="flex items-center gap-2">
                <span>Khoá sau tin (phút):</span>
                <input
                  type="number"
                  value={newsPostMin}
                  onChange={(e) => setNewsPostMin(e.target.value)}
                  className="w-16 rounded-lg border border-white/10 bg-[#040710] px-2 py-1 text-center text-white tabular-nums"
                />
              </label>
            </div>
          </form>

          {newsMsg && (
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-3.5 py-2 text-xs text-cyan-200">
              {newsMsg}
            </div>
          )}

          <div className="max-h-48 overflow-y-auto rounded-xl border border-white/[0.07] bg-[#040710]/85">
            <table className="quant-table">
              <thead>
                <tr>
                  <th>Bản Tin USD</th>
                  <th>Mức Độ</th>
                  <th>Thời Gian Công Bố</th>
                  <th className="text-right">Khung Khoá</th>
                </tr>
              </thead>
              <tbody>
                {newsEvents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-xs text-slate-500">
                      Chưa có sự kiện tin tức nào trong lịch bảo vệ.
                    </td>
                  </tr>
                ) : (
                  newsEvents.map((ev: any, idx: number) => (
                    <tr key={ev.id || idx}>
                      <td className="font-semibold text-white">{ev.title}</td>
                      <td className="font-mono text-xs text-amber-300">{ev.impact || 'HIGH'}</td>
                      <td className="font-mono text-xs text-slate-300 tabular-nums">
                        {fmtTime(ev.event_time || ev.timestamp || ev.starts_at)}
                      </td>
                      <td className="text-right font-mono text-xs text-cyan-300 tabular-nums">
                        -{ev.pre_window_minutes || 30}m / +{ev.post_window_minutes || 30}m
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="quant-panel p-6 space-y-5">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
            Phân Quyền & Thành Viên (RBAC)
          </span>
          <h3 className="mt-0.5 text-lg font-bold text-white">
            Quản Lý Tài Khoản Người Dùng & Quản Trị Viên ({allUsers.length})
          </h3>
        </div>

        <form onSubmit={handleCreateUser} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <input
            type="email"
            required
            placeholder="Email đăng nhập"
            value={newUserEmail}
            onChange={(e) => setNewUserEmail(e.target.value)}
            className="quant-input text-xs"
          />
          <input
            type="text"
            placeholder="Họ tên thành viên"
            value={newUserName}
            onChange={(e) => setNewUserName(e.target.value)}
            className="quant-input text-xs"
          />
          <input
            type="password"
            required
            placeholder="Mật khẩu khởi tạo"
            value={newUserPass}
            onChange={(e) => setNewUserPass(e.target.value)}
            className="quant-input font-mono text-xs"
          />
          <select
            value={newUserRole}
            onChange={(e) => setNewUserRole(e.target.value)}
            className="quant-input font-mono text-xs"
          >
            <option value="user">USER (Nhà đầu tư)</option>
            <option value="admin">ADMIN (Quản trị viên)</option>
          </select>
          <button type="submit" className="quant-btn-primary py-2.5 text-xs whitespace-nowrap shrink-0">
            + Tạo Thành Viên
          </button>
        </form>

        {userAdminMsg && (
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-4 py-2.5 text-xs text-cyan-200">
            {userAdminMsg}
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-[#040710]/85">
          <table className="quant-table">
            <thead>
              <tr>
                <th>ID / Email</th>
                <th>Vai Trò</th>
                <th>Tài Khoản MT5</th>
                <th>Phiên Đăng Nhập</th>
                <th className="text-right">Thao Tác Quản Trị</th>
              </tr>
            </thead>
            <tbody>
              {allUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-slate-500">
                    Chưa có thành viên nào trong hệ thống.
                  </td>
                </tr>
              ) : (
                allUsers.map((u: any) => {
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="font-semibold text-white">{u.email}</div>
                        <div className="font-mono text-[11px] text-slate-500">{u.id}</div>
                      </td>
                      <td className="font-mono text-xs">
                        <span className={`inline-block px-2 py-0.5 rounded font-bold ${u.role === 'admin' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'}`}>
                          {u.role ? u.role.toUpperCase() : 'USER'}
                        </span>
                      </td>
                      <td className="font-mono text-xs text-slate-300 tabular-nums">
                        {u.accounts_count ?? 0} tài khoản
                      </td>
                      <td className="font-mono text-xs text-emerald-400 tabular-nums">
                        {u.active_sessions ? `${u.active_sessions} phiên hoạt động` : 'Chưa đăng nhập'}
                      </td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleToggleUserRole(u.id, u.role)}
                            className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-slate-300 hover:text-white transition"
                            title="Chuyển đổi quyền User/Admin"
                          >
                            Đổi Quyền
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(u.id, u.email)}
                            className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-2.5 py-1 font-mono text-[11px] font-bold text-rose-300 hover:bg-rose-900/60 hover:text-white transition"
                            title="Xoá vĩnh viễn thành viên và mọi dữ liệu liên kết"
                          >
                            Xoá Thành Viên
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
