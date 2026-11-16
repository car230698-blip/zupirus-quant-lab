import React, { useState, useEffect } from 'react';

interface AdminUser {
  id: string;
  email: string;
  role: 'customer' | 'admin';
  created_at: number;
}

interface NewsItem {
  id: string;
  currency: string;
  impact: string;
  title: string;
  ts: number;
}

export const AdminRiskShieldUsersTab: React.FC = () => {
  // Safety Kill Switch state
  const [halted, setHalted] = useState(false);
  const [killSwitchLoading, setKillSwitchLoading] = useState(false);

  // News Shield state
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [newsTitle, setNewsTitle] = useState('');
  const [newsWhen, setNewsWhen] = useState('');
  const [syncingNews, setSyncingNews] = useState(false);

  // Users state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'customer' | 'admin'>('customer');
  const [creatingUser, setCreatingUser] = useState(false);

  const [notice, setNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  async function loadData() {
    setUsersLoading(true);
    try {
      const [monRes, usrRes] = await Promise.all([
        fetch('/api/admin/monitor'),
        fetch('/api/admin/users'),
      ]);
      if (monRes.ok) {
        const monData = await monRes.json();
        setHalted(Boolean(monData.halted));
        setNewsList(monData.news || []);
      }
      if (usrRes.ok) {
        const usrData = await usrRes.json();
        setUsers(usrData.users || []);
      }
    } catch (e) {
      console.error('Error loading risk and users data:', e);
    } finally {
      setUsersLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleToggleKillSwitch() {
    const nextHalt = !halted;
    if (nextHalt && !window.confirm('CẢNH BÁO: Kích hoạt Kill-Switch sẽ ngắt ngay lập tức toàn bộ việc phát lệnh tự động xuống tất cả tài khoản MT5 của khách hàng! Bạn có chắc chắn?')) {
      return;
    }
    setKillSwitchLoading(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/safety', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ halted: nextHalt }),
      });
      if (res.ok) {
        setHalted(nextHalt);
        setNotice({
          text: nextHalt
            ? '🚨 ĐÃ NGẮT CẤP LỆNH TOÀN HỆ THỐNG (GLOBAL EMERGENCY KILL-SWITCH ACTIVE).'
            : '✓ ĐÃ MỞ KHÓA CẤP LỆNH. Hệ thống tiếp tục bắn lệnh định lượng.',
          type: nextHalt ? 'error' : 'success',
        });
      } else {
        setNotice({ text: 'Không thể thay đổi trạng thái Kill-Switch.', type: 'error' });
      }
    } catch (err: any) {
      setNotice({ text: err.message || String(err), type: 'error' });
    } finally {
      setKillSwitchLoading(false);
    }
  }

  async function handleAddNews(e: React.FormEvent) {
    e.preventDefault();
    if (!newsTitle.trim()) return;
    const ts = newsWhen ? new Date(newsWhen).getTime() / 1000 : NaN;
    if (!Number.isFinite(ts) || ts <= 0) {
      setNotice({ text: 'Hãy nhập thời điểm sự kiện tin tức hợp lệ.', type: 'error' });
      return;
    }
    try {
      const res = await fetch('/api/admin/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({
          currency: 'USD',
          impact: 'high',
          title: newsTitle.trim(),
          ts,
        }),
      });
      if (res.ok) {
        setNewsTitle('');
        setNewsWhen('');
        setNotice({ text: 'Đã thêm sự kiện tin USD Đỏ (bảo vệ tài khoản: ngắt lệnh ±15 phút).', type: 'success' });
        await loadData();
      }
    } catch (err: any) {
      setNotice({ text: err.message || String(err), type: 'error' });
    }
  }

  async function handleDeleteNews(nid: string) {
    try {
      const res = await fetch(`/api/admin/news/${nid}`, {
        method: 'DELETE',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        setNotice({ text: 'Đã xóa sự kiện tin tức.', type: 'success' });
        await loadData();
      }
    } catch (err: any) {
      setNotice({ text: err.message || String(err), type: 'error' });
    }
  }

  async function handleSyncCalendar() {
    setSyncingNews(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/news/sync', {
        method: 'POST',
        headers: { 'X-Zupirus': '1' },
      });
      const data = await res.json();
      if (res.ok) {
        setNotice({ text: `Đã đồng bộ thành công ${data.count || 0} tin đỏ USD từ lịch kinh tế!`, type: 'success' });
        await loadData();
      } else {
        setNotice({ text: data.detail || 'Không thể đồng bộ lịch.', type: 'error' });
      }
    } catch (err: any) {
      setNotice({ text: err.message || String(err), type: 'error' });
    } finally {
      setSyncingNews(false);
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreatingUser(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ email: newEmail.trim(), password: newPassword, role: newRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setNotice({ text: `Tạo tài khoản ${newEmail} thành công!`, type: 'success' });
        setNewEmail('');
        setNewPassword('');
        await loadData();
      } else {
        setNotice({ text: data.detail || 'Lỗi tạo tài khoản.', type: 'error' });
      }
    } catch (err: any) {
      setNotice({ text: err.message || String(err), type: 'error' });
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleToggleRole(uid: string, curRole: string) {
    const nextRole = curRole === 'admin' ? 'customer' : 'admin';
    try {
      const res = await fetch(`/api/admin/users/${uid}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ role: nextRole }),
      });
      if (res.ok) {
        setNotice({ text: `Đã đổi quyền người dùng thành ${nextRole}!`, type: 'success' });
        await loadData();
      }
    } catch (err: any) {
      setNotice({ text: err.message || String(err), type: 'error' });
    }
  }

  async function handleDeleteUser(uid: string) {
    if (!window.confirm('Bạn có chắc chắn muốn xóa tài khoản này khỏi hệ thống?')) return;
    try {
      const res = await fetch(`/api/admin/users/${uid}`, {
        method: 'DELETE',
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        setNotice({ text: 'Đã xóa người dùng thành công.', type: 'success' });
        await loadData();
      }
    } catch (err: any) {
      setNotice({ text: err.message || String(err), type: 'error' });
    }
  }

  return (
    <div className="space-y-8 font-sans">
      {/* Alert Notice */}
      {notice && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-mono flex items-center justify-between ${
            notice.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
              : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-bold ml-4">✕</button>
        </div>
      )}

      {/* 1. Global Emergency Kill-Switch & News Shield Header (Bento Grid) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left (1/3): Global Emergency Kill-Switch Card */}
        <div className={`rounded-2xl border p-6 shadow-2xl relative overflow-hidden flex flex-col justify-between ${
          halted
            ? 'border-rose-600 bg-rose-950/50'
            : 'border-slate-800 bg-[#0B1120]'
        }`}>
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-slate-300 uppercase tracking-wider">
                LÁ CHẮN KHẨN CẤP TOÀN HỆ THỐNG
              </span>
              <span className={`w-3 h-3 rounded-full ${halted ? 'bg-rose-500 animate-ping' : 'bg-emerald-400'}`} />
            </div>

            <h3 className="text-xl font-black font-mono mt-3 text-slate-100">
              {halted ? '🛑 ĐANG TẠM DỪNG CẤP LỆNH' : '🛡️ HỆ THỐNG ĐANG BẢO VỆ & SẴN SÀNG'}
            </h3>

            <p className="text-xs text-slate-400 font-mono mt-2 leading-relaxed">
              {halted
                ? 'Toàn bộ việc gửi lệnh xuống các tài khoản MT5 khách hàng đang bị ngắt tuyệt đối.'
                : 'Cơ chế ngắt khẩn cấp 1 chạm sẵn sàng bảo toàn vốn khi thị trường xảy ra biến cố thiên nga đen.'}
            </p>
          </div>

          <div className="pt-6">
            <button
              type="button"
              disabled={killSwitchLoading}
              onClick={handleToggleKillSwitch}
              className={`w-full py-3.5 rounded-xl font-mono font-black text-xs transition-all shadow-lg ${
                halted
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950'
                  : 'bg-gradient-to-r from-rose-600 via-red-500 to-orange-500 hover:from-rose-500 hover:to-orange-400 text-white'
              }`}
            >
              {killSwitchLoading
                ? 'Đang thực thi…'
                : halted
                ? '✓ Mở Khóa Cấp Lệnh Toàn Hệ Thống'
                : '🚨 Kích Hoạt Kill-Switch: Dừng Mọi Lệnh Ngay Lập Tức'}
            </button>
          </div>
        </div>

        {/* Right (2/3): USD High-Impact News Shield Manager */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-[#0B1120] p-6 shadow-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-100 font-mono flex items-center gap-2">
                <span>📅 LÁ CHẮN TIN TỨC USD HIGH-IMPACT (NEWS SHIELD ±15 PHÚT)</span>
              </h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Tự động ngắt mở lệnh mới 15 phút trước và sau thời điểm công bố tin Non-Farm, CPI, FOMC, Fed Rate.
              </p>
            </div>

            <button
              type="button"
              disabled={syncingNews}
              onClick={handleSyncCalendar}
              className="px-3 py-1.5 rounded-lg bg-cyan-950 text-cyan-300 border border-cyan-600/50 text-xs font-mono font-bold hover:bg-cyan-900 transition-all"
            >
              {syncingNews ? 'Đang đồng bộ…' : '↻ Đồng Bộ Lịch Kinh Tế'}
            </button>
          </div>

          {/* Form add news */}
          <form onSubmit={handleAddNews} className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
            <div className="sm:col-span-2">
              <label className="block text-slate-400 mb-1">TÊN SỰ KIỆN TIN TỨC USD *</label>
              <input
                type="text"
                required
                value={newsTitle}
                onChange={(e) => setNewsTitle(e.target.value)}
                placeholder="VD: US Non-Farm Payrolls / CPI m/m"
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">THỜI GIAN CÔNG BỐ *</label>
              <input
                type="datetime-local"
                required
                value={newsWhen}
                onChange={(e) => setNewsWhen(e.target.value)}
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
            </div>

            <div className="sm:col-span-3 flex justify-end">
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-bold text-xs"
              >
                + Thêm Lịch Chặn Tin Tức
              </button>
            </div>
          </form>

          {/* News List */}
          <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-800/80 divide-y divide-slate-800">
            {newsList.length === 0 ? (
              <div className="p-4 text-center text-slate-500 font-mono text-xs">
                Chưa có lịch tin tức đỏ nào được ghi nhận. Hệ thống an toàn để mở lệnh.
              </div>
            ) : (
              newsList.map((n) => {
                const diffMins = Math.round((n.ts - Date.now() / 1000) / 60);
                const isNear = Math.abs(diffMins) <= 15;
                return (
                  <div key={n.id} className="p-3 flex items-center justify-between gap-3 text-xs font-mono hover:bg-slate-900/40">
                    <div className="flex items-center gap-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        isNear ? 'bg-rose-950 text-rose-300 border border-rose-600 animate-pulse' : 'bg-amber-950 text-amber-300'
                      }`}>
                        {n.currency} RED
                      </span>
                      <span className="font-bold text-slate-200">{n.title}</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 text-[11px] tabular-nums">
                        {new Date(n.ts * 1000).toLocaleString('vi-VN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })} ({diffMins > 0 ? `còn ${diffMins}p` : `${Math.abs(diffMins)}p trước`})
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteNews(n.id)}
                        className="text-slate-500 hover:text-rose-400 font-bold"
                        title="Xóa tin tức"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 2. Quản Trị Người Dùng & Phân Quyền (Users Management Section) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Col (2/3): Users List */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-[#0B1120] p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-100 font-mono flex items-center gap-2">
                <span>👥 DANH SÁCH NGƯỜI DÙNG & PHÂN QUYỀN HỆ THỐNG</span>
              </h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Quản lý các tài khoản đăng ký, cấp quyền Quản trị viên (Admin) hoặc Khách hàng (Customer).
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400">
              Tổng: <strong className="text-cyan-300">{users.length}</strong> tài khoản
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800/80">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-[#111827] text-slate-400 border-b border-slate-800 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-3.5">Email Tài Khoản</th>
                  <th className="py-3 px-3.5 text-center">Vai Trò</th>
                  <th className="py-3 px-3.5 text-right">Ngày Tạo</th>
                  <th className="py-3 px-3.5 text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                {usersLoading ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      Đang tải danh sách tài khoản người dùng…
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      Chưa có tài khoản nào được đăng ký.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="py-3 px-3.5 font-bold text-slate-200">
                      {u.email}
                    </td>
                    <td className="py-3 px-3.5 text-center">
                      {u.role === 'admin' ? (
                        <span className="rounded border px-2 py-0.5 text-[10px] font-bold bg-purple-950 text-purple-300 border-purple-700/60">
                          QUẢN TRỊ VIÊN
                        </span>
                      ) : (
                        <span className="rounded border px-2 py-0.5 text-[10px] font-bold bg-slate-900 text-slate-300 border-slate-700">
                          KHÁCH HÀNG
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3.5 text-right text-slate-400 text-[11px] tabular-nums">
                      {new Date(u.created_at * 1000).toLocaleDateString('vi-VN')}
                    </td>
                    <td className="py-3 px-3.5 text-right space-x-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleRole(u.id, u.role)}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 text-[10px] font-bold"
                        title="Đổi quyền admin/customer"
                      >
                        Đổi Quyền
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(u.id)}
                        className="px-2.5 py-1 rounded bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/50 text-[10px] font-bold"
                        title="Xóa tài khoản"
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Col (1/3): Add User Form */}
        <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-6 shadow-xl space-y-4">
          <div>
            <h3 className="font-bold text-sm text-slate-100 font-mono flex items-center gap-2">
              <span>➕ TẠO TÀI KHOẢN MỚI</span>
            </h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Cấp tài khoản thủ công cho khách hàng hoặc bổ sung Admin quản trị.
            </p>
          </div>

          <form onSubmit={handleCreateUser} className="space-y-3 font-mono text-xs">
            <div>
              <label className="block text-slate-400 mb-1">EMAIL *</label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="user@zupirus.com"
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">MẬT KHẨU *</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Tối thiểu 8 ký tự"
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">VAI TRÒ (ROLE) *</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as any)}
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              >
                <option value="customer">Khách Hàng (Customer)</option>
                <option value="admin">Quản Trị Viên (Admin)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={creatingUser}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-black text-xs transition-all shadow-lg disabled:opacity-50 mt-2"
            >
              {creatingUser ? 'Đang tạo…' : '+ Tạo Tài Khoản ↗'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
