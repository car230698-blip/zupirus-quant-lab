import React from 'react';

interface AdminRiskCalendarTabProps {
  monitorData: any;
  newsTitle: string;
  setNewsTitle: (v: string) => void;
  newsWhen: string;
  setNewsWhen: (v: string) => void;
  handleAddNews: (e: React.FormEvent) => void;
  editingNews: any;
  setEditingNews: (v: any) => void;
  editNewsTitle: string;
  setEditNewsTitle: (v: string) => void;
  editNewsWhen: string;
  setEditNewsWhen: (v: string) => void;
  editNewsCurrency: any;
  setEditNewsCurrency: (v: any) => void;
  editNewsImpact: any;
  setEditNewsImpact: (v: any) => void;
  handleUpdateNews: (e: React.FormEvent) => void;
  handleDeleteNews: (nid: string) => void;
}

export const AdminRiskCalendarTab: React.FC<AdminRiskCalendarTabProps> = ({
  monitorData,
  newsTitle,
  setNewsTitle,
  newsWhen,
  setNewsWhen,
  handleAddNews,
  editingNews,
  setEditingNews,
  editNewsTitle,
  setEditNewsTitle,
  editNewsWhen,
  setEditNewsWhen,
  setEditNewsCurrency,
  setEditNewsImpact,
  handleUpdateNews,
  handleDeleteNews,
}) => {
  return (
    <div className="space-y-6">
      {/* Form Add Event */}
      <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
        <h3 className="font-bold text-sm text-slate-200 flex flex-wrap gap-2 items-center justify-between">
          <span>Thêm sự kiện kinh tế</span>
          <span className="text-xs font-normal text-cyan-300 font-mono">Cửa sổ chặn: ±15 phút quanh giờ tin</span>
        </h3>
        <p className="text-xs text-slate-400">
          Cơ chế bảo vệ tài khoản khách: Tự động chặn mở lệnh mới trong khoảng ±15 phút trước và sau thời điểm ra tin để tránh trượt giá dãn spread.
        </p>

        <p className="text-xs text-slate-400">Múi giờ nhập và hiển thị: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
        <form onSubmit={handleAddNews} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label htmlFor="risk-title" className="block text-[11px] font-mono text-slate-400 mb-1">Tên sự kiện *</label>
            <input
              type="text"
              required
              id="risk-title"
                value={newsTitle}
              onChange={(e) => setNewsTitle(e.target.value)}
              placeholder="Ví dụ: US Non-Farm Payrolls / CPI"
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 font-mono"
            />
          </div>

          <div>
            <label htmlFor="risk-when" className="block text-[11px] font-mono text-slate-400 mb-1">Thời điểm ra tin *</label>
            <input
              type="datetime-local"
              required
              id="risk-when"
                value={newsWhen}
              onChange={(e) => setNewsWhen(e.target.value)}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 font-mono"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2 text-xs font-mono transition-colors"
            >
              + Thêm Khung Giờ Chặn
            </button>
          </div>
        </form>
      </div>

      {/* Edit News Modal / Form */}
      {editingNews && (
        <div className="quant-panel rounded-xl border border-cyan-500/50 bg-[#0d1829] p-5 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h4 className="font-bold text-sm text-cyan-300">
              Chỉnh sửa sự kiện #{editingNews.id}
            </h4>
            <button
              onClick={() => setEditingNews(null)}
              className="text-slate-400 hover:text-slate-200 text-xs font-mono"
            >
              ✕ Đóng
            </button>
          </div>

          <form onSubmit={handleUpdateNews} className="grid grid-cols-1 sm:grid-cols-4 gap-3 font-mono text-xs">
            <div className="sm:col-span-2">
              <label htmlFor="risk-edit-title" className="block text-[11px] text-slate-400 mb-1">Tên sự kiện</label>
              <input
                type="text"
                required
                id="risk-edit-title"
                value={editNewsTitle}
                onChange={(e) => setEditNewsTitle(e.target.value)}
                className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="risk-edit-when" className="block text-[11px] text-slate-400 mb-1">Thời điểm mới</label>
              <input
                type="datetime-local"
                required
                id="risk-edit-when"
                value={editNewsWhen}
                onChange={(e) => setEditNewsWhen(e.target.value)}
                className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-slate-100"
              />
            </div>

            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="flex-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-1.5 text-xs transition-colors"
              >
                Lưu thay đổi
              </button>
              <button
                type="button"
                onClick={() => setEditingNews(null)}
                className="rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-slate-300 transition-colors"
              >
                Hủy
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Risk Calendar Table */}
      <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] overflow-hidden">
        <div className="border-b border-slate-800 px-5 py-3 flex items-center justify-between">
          <span className="font-bold text-sm text-slate-200">
            Danh Sách Sự Kiện Lịch Rủi Ro Đã Nhập
          </span>
          <span className="text-xs font-mono text-slate-400">
            {(monitorData.news || []).length} sự kiện
          </span>
        </div>

        {(monitorData.news || []).length === 0 ? (
          <div className="p-8 text-center text-slate-500 font-mono text-xs">
            Chưa có sự kiện lịch rủi ro nào được cấu hình.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="quant-data-table w-full text-left text-xs font-mono">
              <thead className="bg-slate-950/60 border-b border-slate-800 text-[11px] text-slate-400">
                <tr>
                  <th className="p-3">SỰ KIỆN</th>
                  <th className="p-3">TIỀN TỆ</th>
                  <th className="p-3">TÁC ĐỘNG</th>
                  <th className="p-3">THỜI ĐIỂM (GIỜ ĐỊA PHƯƠNG)</th>
                  <th className="p-3">CỬA SỔ CHẶN (±15 PHÚT)</th>
                  <th className="p-3">TRẠNG THÁI HIỆN TẠI</th>
                  <th className="p-3">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {(monitorData.news || []).map((item: any) => {
                  const nowTs = Date.now() / 1000;
                  const eligible = (item.currency === 'USD' || item.currency === 'ALL') && item.impact === 'high';
                  const isBlocking = eligible && Math.abs(nowTs - item.ts) < 900;
                  const isUpcoming = nowTs < item.ts - 900;

                  const windowStartStr = new Date((item.ts - 900) * 1000).toLocaleTimeString('vi-VN');
                  const windowEndStr = new Date((item.ts + 900) * 1000).toLocaleTimeString('vi-VN');
                  const eventTimeStr = new Date(item.ts * 1000).toLocaleString('vi-VN');

                  return (
                    <tr key={item.id} className="hover:bg-slate-900/40">
                      <td data-label="Sự kiện" className="p-3 font-bold text-slate-200">{item.title}</td>
                      <td data-label="Tiền tệ" className="p-3">
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-cyan-300">
                          {item.currency || 'USD'}
                        </span>
                      </td>
                      <td data-label="Tác động" className="p-3">
                        <span className="rounded bg-rose-950 text-rose-300 border border-rose-800/40 px-1.5 py-0.5 text-[10px] font-bold uppercase">
                          {item.impact || 'high'}
                        </span>
                      </td>
                      <td data-label="Thời điểm" className="p-3 text-slate-300">
                        {eventTimeStr}
                      </td>
                      <td data-label="Cửa sổ chặn" className="p-3 text-slate-400">
                        {eligible ? `${windowStartStr} – ${windowEndStr}` : '—'}
                      </td>
                      <td data-label="Trạng thái" className="p-3">
                        {!eligible ? <span className="text-slate-400">Không áp dụng chặn lệnh</span> : isBlocking ? (
                          <span className="rounded px-2 py-0.5 text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-700/50 animate-pulse">
                            ĐANG CHẶN LỆNH (±15m)
                          </span>
                        ) : isUpcoming ? (
                          <span className="rounded px-2 py-0.5 text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700/50">
                            SẮP DIỄN RA
                          </span>
                        ) : (
                          <span className="rounded px-2 py-0.5 text-[10px] font-bold bg-slate-800 text-slate-400">
                            ĐÃ QUA
                          </span>
                        )}
                      </td>
                      <td data-label="Thao tác" className="p-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setEditingNews(item);
                              setEditNewsTitle(item.title);
                              setEditNewsCurrency(item.currency || 'USD');
                              setEditNewsImpact(item.impact || 'high');
                              const dateObj = new Date(item.ts * 1000);
                              const localIso = new Date(dateObj.getTime() - dateObj.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                              setEditNewsWhen(localIso);
                            }}
                            className="rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 transition-colors"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => handleDeleteNews(item.id)}
                            className="rounded bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 px-2 py-0.5 text-[11px] text-rose-300 transition-colors"
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
