import React, { useState, useEffect } from 'react';

export interface AdminPaymentTx {
  id: string;
  sepay_id?: string | null;
  user_id?: string | null;
  user_email?: string | null;
  amount: number;
  currency: string;
  gateway: string;
  content: string;
  reference_code: string;
  status: string;
  created_at: string | number;
}

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

  // Resend Email Gateway State
  const [testEmail, setTestEmail] = useState('car230698@gmail.com');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatusMsg, setEmailStatusMsg] = useState<string | null>(null);

  // Payment Management & Manual Approval State
  const [payments, setPayments] = useState<AdminPaymentTx[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [showManualPayModal, setShowManualPayModal] = useState(false);
  const [manualEmail, setManualEmail] = useState('');
  const [manualAmount, setManualAmount] = useState('500000');
  const [manualGateway, setManualGateway] = useState('MBBank');
  const [manualRef, setManualRef] = useState('');
  const [manualNote, setManualNote] = useState('Duyệt nạp tiền trực tiếp bởi Admin');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualMsg, setManualMsg] = useState<string | null>(null);

  async function loadPayments() {
    setPaymentsLoading(true);
    try {
      const res = await fetch('/api/admin/payments', {
        headers: { 'X-Zupirus': '1' },
      });
      if (res.ok) {
        const data = await res.json();
        setPayments(data.transactions || []);
        setTotalRevenue(data.total_revenue_vnd || 0);
      }
    } catch {
      // ignore
    } finally {
      setPaymentsLoading(false);
    }
  }

  useEffect(() => {
    void loadPayments();
  }, []);

  async function handleManualApproveSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualEmail || !manualAmount || manualSubmitting) return;
    setManualSubmitting(true);
    setManualMsg(null);
    try {
      const res = await fetch('/api/admin/payments/manual-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({
          user_email: manualEmail,
          amount_vnd: parseFloat(manualAmount),
          gateway: manualGateway,
          reference_code: manualRef || `MANUAL-${Date.now().toString().slice(-6)}`,
          note: manualNote,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setManualMsg(`✓ ${data.message || 'Duyệt nạp tiền thành công!'}`);
        await loadPayments();
        setTimeout(() => {
          setShowManualPayModal(false);
          setManualMsg(null);
        }, 1500);
      } else {
        setManualMsg(`❌ ${data.detail || 'Không thể duyệt nạp tiền. Vui lòng kiểm tra lại.'}`);
      }
    } catch (err: any) {
      setManualMsg(`❌ Lỗi kết nối: ${err.message || String(err)}`);
    } finally {
      setManualSubmitting(false);
    }
  }

  async function handleSendTestEmail() {
    if (!testEmail || sendingEmail) return;
    setSendingEmail(true);
    setEmailStatusMsg(null);
    try {
      const res = await fetch('/api/admin/mailer/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
        body: JSON.stringify({ to: testEmail }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setEmailStatusMsg(`✓ Đã gửi email thành công qua Resend (ID: ${data.id}) tới ${testEmail}!`);
      } else {
        setEmailStatusMsg(`❌ Gửi thất bại: ${data.detail || data.error || 'Lỗi không xác định'}`);
      }
    } catch (err: any) {
      setEmailStatusMsg(`❌ Lỗi kết nối: ${err.message || String(err)}`);
    } finally {
      setSendingEmail(false);
    }
  }

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
      {/* Resend Enterprise Mail Gateway */}
      <div className="quant-panel rounded-xl border border-emerald-500/30 bg-[#071318] p-5 shadow-lg relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <h3 className="font-bold text-sm text-emerald-400 font-mono tracking-wide">
                📧 RESEND EMAIL GATEWAY (TOKYO REGION)
              </h3>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded px-2 py-0.5 font-mono">
                Verified: zupirus.com
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Người gửi mặc định: <code className="text-cyan-300 font-mono">system@zupirus.com</code> • Hỗ trợ gửi mã OTP đăng ký, khôi phục mật khẩu & cảnh báo vĩ mô Sentinel.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="Nhập email nhận test..."
              className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 font-mono w-56"
            />
            <button
              onClick={handleSendTestEmail}
              disabled={sendingEmail}
              className="rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold px-3 py-1.5 text-xs font-mono transition-colors shadow flex items-center gap-1.5"
            >
              {sendingEmail ? 'Đang gửi...' : '⚡ Gửi Test Resend'}
            </button>
          </div>
        </div>
        {emailStatusMsg && (
          <div className={`mt-3 p-2.5 rounded-lg text-xs font-mono ${emailStatusMsg.startsWith('✓') ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-300' : 'bg-rose-950/60 border border-rose-500/40 text-rose-300'}`}>
            {emailStatusMsg}
          </div>
        )}
      </div>

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

      {/* Payments Management & Manual Approval */}
      <div className="quant-panel rounded-xl border border-cyan-500/30 bg-[#07131e] p-5 shadow-lg relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse"></span>
              <h3 className="font-bold text-sm text-cyan-400 font-mono tracking-wide">
                💳 QUẢN LÝ THANH TOÁN & DUYỆT TAY (SEPAY / CHUYỂN KHOẢN)
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Dòng tiền nạp tự động qua SePay Webhook. Admin có thể can thiệp duyệt thủ công và kích hoạt ngay cho khách nếu chuyển nhầm nội dung.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-1.5 text-right font-mono">
              <div className="text-[10px] text-slate-400">TỔNG DOANH THU</div>
              <div className="text-sm font-bold text-emerald-400">{totalRevenue.toLocaleString('vi-VN')} ₫</div>
            </div>
            <button
              onClick={() => void loadPayments()}
              disabled={paymentsLoading}
              className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-2 text-xs font-mono text-slate-200 transition-colors"
              title="Làm mới danh sách giao dịch"
            >
              {paymentsLoading ? 'Đang tải…' : '🔄 Làm mới'}
            </button>
            <button
              onClick={() => {
                setShowManualPayModal(true);
                setManualMsg(null);
              }}
              className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold px-3.5 py-2 text-xs font-mono transition-all shadow-lg"
            >
              + Duyệt Nạp Tiền Thủ Công
            </button>
          </div>
        </div>

        {/* Transactions Table */}
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800/80 bg-slate-950/60">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-3">Mã GD / SePay</th>
                <th className="p-3">Khách Hàng (Email)</th>
                <th className="p-3">Số Tiền (VND)</th>
                <th className="p-3">Cổng / Ngân Hàng</th>
                <th className="p-3">Nội Dung / Ref</th>
                <th className="p-3">Trạng Thái</th>
                <th className="p-3 text-right">Thời Gian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {paymentsLoading ? (
                <tr>
                  <td colSpan={7} className="p-5 text-center text-slate-500">
                    Đang tải dữ liệu giao dịch SePay…
                  </td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-5 text-center text-slate-500">
                    Chưa có giao dịch thanh toán nào được ghi nhận.
                  </td>
                </tr>
              ) : (
                payments.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="p-3">
                      <div className="font-bold text-cyan-300">{tx.id}</div>
                      <div className="text-[10px] text-slate-500">{tx.sepay_id || 'Thủ công'}</div>
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-slate-200">{tx.user_email || '—'}</div>
                      <div className="text-[10px] text-slate-500">{tx.user_id ? `UID: ${tx.user_id.slice(0, 10)}…` : 'Chưa liên kết'}</div>
                    </td>
                    <td className="p-3">
                      <span className="font-bold text-emerald-400 text-sm">
                        +{Number(tx.amount || 0).toLocaleString('vi-VN')} ₫
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="inline-block bg-slate-800 px-2 py-0.5 rounded text-[11px] text-slate-300 border border-slate-700">
                        {tx.gateway}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="text-slate-300 max-w-[220px] truncate" title={tx.content}>{tx.content}</div>
                      <div className="text-[10px] text-slate-500">{tx.reference_code}</div>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          tx.status === 'completed'
                            ? 'bg-emerald-950/70 border border-emerald-600 text-emerald-300'
                            : tx.status === 'manual_approved'
                            ? 'bg-cyan-950/70 border border-cyan-500 text-cyan-300'
                            : 'bg-amber-950/70 border border-amber-600 text-amber-300'
                        }`}
                      >
                        {tx.status === 'completed' ? 'Tự Động' : tx.status === 'manual_approved' ? 'Duyệt Thủ Công' : tx.status}
                      </span>
                    </td>
                    <td className="p-3 text-right text-slate-400 text-[11px]">
                      {typeof tx.created_at === 'number'
                        ? new Date(tx.created_at * 1000).toLocaleString('vi-VN')
                        : tx.created_at}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Manual Approve Payment */}
      {showManualPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-cyan-500/50 bg-[#0d1424] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-cyan-400 font-bold">⚡</span>
                <h4 className="font-bold text-sm text-slate-100 font-mono">Duyệt Nạp Tiền Thủ Công</h4>
              </div>
              <button
                onClick={() => setShowManualPayModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-mono"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 font-mono">
              Chế độ dành riêng cho Admin khi khách hàng chuyển khoản sai cú pháp, ngân hàng xử lý chậm hoặc SePay chưa gửi webhook. Hệ thống sẽ ghi nhận giao dịch và tự động gửi hóa đơn kích hoạt qua email Resend.
            </p>

            {manualMsg && (
              <div className={`p-3 rounded-lg text-xs font-mono ${manualMsg.startsWith('✓') ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-300' : 'bg-rose-950/60 border border-rose-500/40 text-rose-300'}`}>
                {manualMsg}
              </div>
            )}

            <form onSubmit={handleManualApproveSubmit} className="space-y-4 font-mono text-xs">
              <div>
                <label className="block text-[11px] text-slate-300 mb-1">Email Người Dùng Cần Kích Hoạt *</label>
                <input
                  type="email"
                  required
                  list="users-email-list"
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-100 placeholder-slate-500"
                />
                <datalist id="users-email-list">
                  {users.map((u) => (
                    <option key={u.id} value={u.email} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">Số Tiền Nạp (VND) *</label>
                  <input
                    type="number"
                    required
                    min={10000}
                    step={10000}
                    value={manualAmount}
                    onChange={(e) => setManualAmount(e.target.value)}
                    placeholder="500000"
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-100 font-bold text-emerald-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">Ngân Hàng / Kênh *</label>
                  <select
                    value={manualGateway}
                    onChange={(e) => setManualGateway(e.target.value)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-100"
                  >
                    <option value="MBBank">MBBank (Quân Đội)</option>
                    <option value="Vietcombank">Vietcombank</option>
                    <option value="Techcombank">Techcombank</option>
                    <option value="VPBank">VPBank</option>
                    <option value="ACB">ACB</option>
                    <option value="MOMO">Ví MoMo</option>
                    <option value="Chuyển Khoản Trực Tiếp">Chuyển Khoản Trực Tiếp</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-300 mb-1">Mã Giao Dịch Ngân Hàng / Mã Bill</label>
                <input
                  type="text"
                  value={manualRef}
                  onChange={(e) => setManualRef(e.target.value)}
                  placeholder="Ví dụ: FT24111589104, MBB928401..."
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-100 placeholder-slate-500"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-300 mb-1">Ghi Chú Phê Duyệt</label>
                <input
                  type="text"
                  value={manualNote}
                  onChange={(e) => setManualNote(e.target.value)}
                  placeholder="Lý do duyệt: Khách chuyển đúng bill, memo sai cú pháp..."
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-100 placeholder-slate-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowManualPayModal(false)}
                  className="rounded-lg bg-slate-800 hover:bg-slate-700 px-4 py-2 text-slate-300 transition-colors"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={manualSubmitting}
                  className="rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 px-4 py-2 text-slate-950 font-bold transition-colors shadow-lg flex items-center gap-1.5"
                >
                  {manualSubmitting ? 'Đang duyệt & Gửi email...' : '✓ Xác Nhận Duyệt & Gửi Email'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

