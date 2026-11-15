import React, { useState } from 'react';

export interface AdminUser {
  id: string;
  email: string;
  role: 'customer' | 'admin';
  active: boolean;
  created: string;
  last_login?: string | null;
}

interface AdminUsersTabProps {
  users: AdminUser[];
  loading: boolean;
  onCreateUser: (email: string, pass: string, role: string) => Promise<void>;
  onToggleRole: (uid: string, newRole: string) => Promise<void>;
  onResetPassword: (uid: string, newPass: string) => Promise<void>;
  onDeleteUser: (uid: string) => Promise<void>;
}

export const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
  users,
  loading,
  onCreateUser,
  onToggleRole,
  onResetPassword,
  onDeleteUser,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'customer' | 'admin'>('customer');
  const [search, setSearch] = useState('');

  const [resetUid, setResetUid] = useState<string | null>(null);
  const [resetPassInput, setResetPassInput] = useState('');

  const filteredUsers = users.filter((u) =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail || !newPassword) return;
    await onCreateUser(newEmail, newPassword, newRole);
    setNewEmail('');
    setNewPassword('');
    setShowCreateModal(false);
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetUid || !resetPassInput) return;
    await onResetPassword(resetUid, resetPassInput);
    setResetUid(null);
    setResetPassInput('');
  }

  return (
    <div className="space-y-6">
      {/* Top Bar / Actions */}
      <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-sm text-slate-200">Quản Trị Người Dùng & Phân Quyền</h3>
            <p className="text-xs text-slate-400 mt-1">
              Quản lý tài khoản truy cập hệ thống, cấp quyền quản trị viên (Admin) hoặc khách hàng (Customer).
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Tìm theo email, vai trò..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 font-mono"
            />
            <button
              onClick={() => setShowCreateModal(true)}
              className="rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-3 py-1.5 text-xs font-mono transition-colors shadow"
            >
              + Tạo Tài Khoản Mới
            </button>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-3">ID / Email</th>
                <th className="p-3">Vai Trò</th>
                <th className="p-3">Trạng Thái</th>
                <th className="p-3">Ngày Tạo</th>
                <th className="p-3 text-right">Thao Tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-500">
                    Đang tải danh sách người dùng...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-500">
                    Không tìm thấy người dùng nào.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="p-3">
                      <div className="font-bold text-slate-100">{u.email}</div>
                      <div className="text-[10px] text-slate-500">{u.id}</div>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          u.role === 'admin'
                            ? 'bg-purple-950/70 border border-purple-600 text-purple-300'
                            : 'bg-blue-950/70 border border-blue-600 text-blue-300'
                        }`}
                      >
                        {u.role.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="text-emerald-400 text-xs">● Hoạt động</span>
                    </td>
                    <td className="p-3 text-slate-400 text-[11px]">
                      {u.created ? new Date(u.created).toLocaleString('vi-VN') : '—'}
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <button
                        onClick={() => void onToggleRole(u.id, u.role === 'admin' ? 'customer' : 'admin')}
                        className="rounded bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] text-cyan-300 border border-slate-700 transition-colors"
                        title="Đổi vai trò giữa Admin và Customer"
                      >
                        Đổi sang {u.role === 'admin' ? 'Customer' : 'Admin'}
                      </button>
                      <button
                        onClick={() => {
                          setResetUid(u.id);
                          setResetPassInput('');
                        }}
                        className="rounded bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] text-amber-300 border border-slate-700 transition-colors"
                      >
                        Đổi mật khẩu
                      </button>
                      <button
                        onClick={() => void onDeleteUser(u.id)}
                        className="rounded bg-red-950/40 hover:bg-red-900/60 px-2.5 py-1 text-[11px] text-red-400 border border-red-800 transition-colors"
                      >
                        Xoá
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Create User */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#0d1424] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="font-bold text-sm text-slate-200">Thêm Người Dùng Mới</h4>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-200 text-xs font-mono"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Mật khẩu ban đầu *</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Ít nhất 8 ký tự"
                  className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Vai trò</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'customer' | 'admin')}
                  className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-slate-100"
                >
                  <option value="customer">Customer (Khách hàng)</option>
                  <option value="admin">Admin (Quản trị viên)</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-slate-300"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  className="rounded bg-cyan-500 hover:bg-cyan-400 px-3 py-1.5 text-slate-950 font-bold"
                >
                  Tạo tài khoản
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Reset Password */}
      {resetUid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-[#0d1424] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="font-bold text-sm text-slate-200">Đặt Lại Mật Khẩu</h4>
              <button
                onClick={() => setResetUid(null)}
                className="text-slate-400 hover:text-slate-200 text-xs font-mono"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleReset} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Mật khẩu mới *</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={resetPassInput}
                  onChange={(e) => setResetPassInput(e.target.value)}
                  placeholder="Mật khẩu mới (tối thiểu 8 ký tự)"
                  className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetUid(null)}
                  className="rounded bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-slate-300"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  className="rounded bg-amber-500 hover:bg-amber-400 px-3 py-1.5 text-slate-950 font-bold"
                >
                  Cập nhật
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

