import React, { useState } from 'react';

export interface GeminiKeyItem {
  id: string;
  name: string;
  key_masked: string;
  is_active: boolean;
  requests_count: number;
  last_used?: string | null;
  last_error?: string | null;
  created?: string;
}

export interface HindsightMemoryItem {
  id: string;
  category: 'episodic' | 'semantic' | 'reflective';
  content: string;
  metadata?: any;
  created: string;
}

interface AdminAITabProps {
  keys: GeminiKeyItem[];
  memories: HindsightMemoryItem[];
  loadingKeys: boolean;
  loadingMemories: boolean;
  onAddKey: (key: string, name?: string) => Promise<void>;
  onToggleKey: (kid: string) => Promise<void>;
  onDeleteKey: (kid: string) => Promise<void>;
  onTestGemini: (prompt: string) => Promise<{ success: boolean; key_used?: string; response?: string; error?: string }>;
  onAddMemory: (category: 'episodic' | 'semantic' | 'reflective', content: string) => Promise<void>;
  onDeleteMemory: (mid: string) => Promise<void>;
}

export const AdminAITab: React.FC<AdminAITabProps> = ({
  keys,
  memories,
  loadingKeys,
  loadingMemories,
  onAddKey,
  onToggleKey,
  onDeleteKey,
  onTestGemini,
  onAddMemory,
  onDeleteMemory,
}) => {
  const [subTab, setSubTab] = useState<'gemini' | 'hindsight'>('gemini');

  // Gemini state
  const [newKeyInput, setNewKeyInput] = useState('');
  const [newKeyName, setNewKeyName] = useState('');
  const [testPrompt, setTestPrompt] = useState('Đánh giá các điều kiện rủi ro cho chiến lược giao dịch XAUUSD.');
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);

  // Hindsight state
  const [memoryFilter, setMemoryFilter] = useState<'all' | 'episodic' | 'semantic' | 'reflective'>('all');
  const [memorySearch, setMemorySearch] = useState('');
  const [newMemCategory, setNewMemCategory] = useState<'episodic' | 'semantic' | 'reflective'>('semantic');
  const [newMemContent, setNewMemContent] = useState('');

  async function handleAddKeySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyInput) return;
    await onAddKey(newKeyInput, newKeyName || undefined);
    setNewKeyInput('');
    setNewKeyName('');
  }

  async function handleRunTest() {
    if (!testPrompt) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await onTestGemini(testPrompt);
      setTestResult(res);
    } finally {
      setTesting(false);
    }
  }

  async function handleAddMemorySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newMemContent) return;
    await onAddMemory(newMemCategory, newMemContent);
    setNewMemContent('');
  }

  const filteredMemories = memories.filter((m) => {
    if (memoryFilter !== 'all' && m.category !== memoryFilter) return false;
    if (memorySearch && !m.content.toLowerCase().includes(memorySearch.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Subtab Navigation */}
      <div className="flex items-center gap-3 border-b border-slate-800 pb-3 font-mono text-xs">
        <button
          onClick={() => setSubTab('gemini')}
          className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
            subTab === 'gemini'
              ? 'bg-cyan-500 text-slate-950 shadow'
              : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
          }`}
        >
          🔑 Gemini API Keys Pool ({keys.length})
        </button>
        <button
          onClick={() => setSubTab('hindsight')}
          className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
            subTab === 'hindsight'
              ? 'bg-purple-500 text-slate-950 shadow'
              : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
          }`}
        >
          🧠 Hindsight Memory Engine ({memories.length})
        </button>
      </div>

      {subTab === 'gemini' && (
        <div className="space-y-6">
          {/* Key Pool Status & Add form */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-slate-200">Bể Khóa API Gemini (Multi-Key Failover)</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Cơ chế xoay vòng thông minh: Tự động phân phối yêu cầu và tự động chuyển khóa dự phòng khi gặp hạn mức (HTTP 429).
                  </p>
                </div>
                <span className="text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800 px-2 py-0.5 rounded">
                  {keys.filter((k) => k.is_active).length} / {keys.length} Đang hoạt động
                </span>
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-2.5">Tên / Nhãn</th>
                      <th className="p-2.5">Mã Khóa (Masked)</th>
                      <th className="p-2.5">Trạng Thái</th>
                      <th className="p-2.5">Số Lượt Gọi</th>
                      <th className="p-2.5">Lần Dùng Gần Nhất</th>
                      <th className="p-2.5 text-right">Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-200">
                    {loadingKeys ? (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate-500">Đang tải danh sách khóa...</td>
                      </tr>
                    ) : keys.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate-500">Chưa có khóa nào trong hệ thống.</td>
                      </tr>
                    ) : (
                      keys.map((k) => (
                        <tr key={k.id} className="hover:bg-slate-900/40">
                          <td className="p-2.5 font-bold text-slate-100">{k.name}</td>
                          <td className="p-2.5 text-cyan-300 font-mono">{k.key_masked}</td>
                          <td className="p-2.5">
                            {k.is_active ? (
                              <span className="text-emerald-400 font-bold">● Active</span>
                            ) : (
                              <span className="text-slate-500">○ Tắt</span>
                            )}
                          </td>
                          <td className="p-2.5 text-slate-300">{k.requests_count}</td>
                          <td className="p-2.5 text-slate-400 text-[11px]">
                            {k.last_used ? new Date(k.last_used).toLocaleTimeString('vi-VN') : 'Chưa dùng'}
                          </td>
                          <td className="p-2.5 text-right space-x-1.5">
                            <button
                              onClick={() => void onToggleKey(k.id)}
                              className="rounded bg-slate-800 hover:bg-slate-700 px-2 py-0.5 text-[11px] text-cyan-300 border border-slate-700"
                            >
                              {k.is_active ? 'Tạm dừng' : 'Bật'}
                            </button>
                            <button
                              onClick={() => void onDeleteKey(k.id)}
                              className="rounded bg-red-950/40 hover:bg-red-900/60 px-2 py-0.5 text-[11px] text-red-400 border border-red-800"
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

            {/* Add Key Form */}
            <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4 font-mono text-xs">
              <h3 className="font-bold text-sm text-slate-200">Thêm API Key Gemini</h3>
              <p className="text-slate-400 text-[11px]">
                Khóa được lưu mã hóa và chỉ hiển thị dạng rút gọn trên giao diện nhằm đảm bảo an toàn.
              </p>
              <form onSubmit={handleAddKeySubmit} className="space-y-3">
                <div>
                  <label className="block text-slate-400 mb-1 text-[11px]">Tên / Nhãn khóa</label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="Ví dụ: Gemini Pro Reserve #6"
                    className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 text-[11px]">Gemini API Key *</label>
                  <input
                    type="password"
                    required
                    value={newKeyInput}
                    onChange={(e) => setNewKeyInput(e.target.value)}
                    placeholder="AQ.Ab8..."
                    className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-slate-100"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2 text-xs transition-colors"
                >
                  + Thêm Vào Bể Xoay Vòng
                </button>
              </form>
            </div>
          </div>

          {/* Test Runner */}
          <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-3 font-mono text-xs">
            <h3 className="font-bold text-sm text-slate-200">Kiểm Thử Kết Nối Bể Khóa Gemini</h3>
            <p className="text-slate-400 text-[11px]">
              Gửi một prompt kiểm thử qua hệ thống xoay vòng để xác nhận API key hoạt động và kiểm tra tính năng failover.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                className="flex-1 rounded bg-slate-900 border border-slate-700 px-3 py-2 text-slate-100"
              />
              <button
                type="button"
                onClick={handleRunTest}
                disabled={testing}
                className="rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 transition-colors"
              >
                {testing ? 'Đang gọi AI...' : 'Chạy Thử Nghiệm'}
              </button>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-lg border text-xs ${
                  testResult.success
                    ? 'bg-emerald-950/20 border-emerald-800 text-slate-200'
                    : 'bg-red-950/20 border-red-800 text-red-200'
                }`}
              >
                <div className="flex items-center justify-between font-bold mb-1">
                  <span>Kết quả: {testResult.success ? '✅ Thành công' : '❌ Lỗi'}</span>
                  {testResult.key_used && (
                    <span className="text-cyan-400 font-mono">Khóa sử dụng: {testResult.key_used}</span>
                  )}
                </div>
                {testResult.response && (
                  <div className="text-slate-300 whitespace-pre-wrap mt-2 p-2 bg-slate-900/60 rounded border border-slate-800">
                    {testResult.response}
                  </div>
                )}
                {testResult.error && (
                  <div className="text-red-300 font-mono mt-1">{testResult.error}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'hindsight' && (
        <div className="space-y-6">
          {/* Hindsight Overview & Add Memory */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-sm text-slate-200">
                    Hindsight Memory Engine (vectorize-io/hindsight)
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Bộ nhớ 3 cấp độ (Episodic - Sự kiện, Semantic - Kiến thức/Quy chuẩn, Reflective - Đúc kết kinh nghiệm) giúp AI Agent duy trì nhận thức dài hạn qua các phiên giao dịch.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={memoryFilter}
                    onChange={(e) => setMemoryFilter(e.target.value as any)}
                    className="rounded bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-slate-100 font-mono"
                  >
                    <option value="all">Tất cả phân loại</option>
                    <option value="episodic">Episodic (Sự kiện)</option>
                    <option value="semantic">Semantic (Quy chuẩn)</option>
                    <option value="reflective">Reflective (Đúc kết)</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Tìm ký ức..."
                    value={memorySearch}
                    onChange={(e) => setMemorySearch(e.target.value)}
                    className="rounded bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-slate-100 placeholder-slate-500 font-mono"
                  />
                </div>
              </div>

              {/* Memory Cards List */}
              <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                {loadingMemories ? (
                  <div className="p-6 text-center text-slate-500 font-mono text-xs">Đang tải bộ nhớ Hindsight...</div>
                ) : filteredMemories.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 font-mono text-xs">Không tìm thấy bản ghi ký ức nào.</div>
                ) : (
                  filteredMemories.map((m) => (
                    <div
                      key={m.id}
                      className="p-3.5 rounded-lg border border-slate-800 bg-[#090f1d] hover:border-slate-700 transition-colors space-y-2 font-mono text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              m.category === 'reflective'
                                ? 'bg-purple-950/70 border border-purple-600 text-purple-300'
                                : m.category === 'semantic'
                                ? 'bg-cyan-950/70 border border-cyan-600 text-cyan-300'
                                : 'bg-amber-950/70 border border-amber-600 text-amber-300'
                            }`}
                          >
                            {m.category.toUpperCase()}
                          </span>
                          <span className="text-[10px] text-slate-500">{m.id}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500">
                            {new Date(m.created).toLocaleString('vi-VN')}
                          </span>
                          <button
                            onClick={() => void onDeleteMemory(m.id)}
                            className="text-red-400 hover:text-red-300 text-[11px]"
                            title="Xoá bản ghi ký ức"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <p className="text-slate-200 text-xs leading-relaxed font-sans">{m.content}</p>
                      {m.metadata && Object.keys(m.metadata).length > 0 && (
                        <div className="text-[10px] text-slate-500 bg-slate-900/60 p-1.5 rounded border border-slate-800/80">
                          {JSON.stringify(m.metadata)}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Add Memory Form */}
            <div className="quant-panel rounded-xl border border-slate-800 bg-[#0d1424] p-5 space-y-4 font-mono text-xs">
              <h3 className="font-bold text-sm text-slate-200">Ghi Nhớ Mới Cho AI Agent</h3>
              <p className="text-slate-400 text-[11px]">
                Nạp trực tiếp quy tắc, hướng dẫn rủi ro hoặc bài học kiểm định vào trí nhớ dài hạn của toàn bộ hệ thống Agent.
              </p>
              <form onSubmit={handleAddMemorySubmit} className="space-y-3">
                <div>
                  <label className="block text-slate-400 mb-1 text-[11px]">Phân loại ký ức</label>
                  <select
                    value={newMemCategory}
                    onChange={(e) => setNewMemCategory(e.target.value as any)}
                    className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-slate-100"
                  >
                    <option value="semantic">Semantic (Quy tắc & Tiêu chuẩn rủi ro)</option>
                    <option value="reflective">Reflective (Đúc kết kinh nghiệm & Backtest)</option>
                    <option value="episodic">Episodic (Sự kiện giao dịch & Thực thi)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 text-[11px]">Nội dung kiến thức / kinh nghiệm *</label>
                  <textarea
                    required
                    rows={6}
                    value={newMemContent}
                    onChange={(e) => setNewMemContent(e.target.value)}
                    placeholder="Ví dụ: Khi XAUUSD biến động mạnh quanh phiên Mỹ, ngưỡng drawdown tối đa cho phép là 3.5%..."
                    className="w-full rounded bg-slate-900 border border-slate-700 p-2 text-slate-100 text-xs font-sans leading-relaxed"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 text-xs transition-colors"
                >
                  + Khắc Sâu Vào Bộ Nhớ Agent
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

