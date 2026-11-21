import React, { useState } from 'react';
import { apiPost } from '../api/client';

export interface AdminAiManualOverrideDrawerProps {
  onRefresh: () => void;
  setMsg: (msg: string) => void;
}

export const AdminAiManualOverrideDrawer: React.FC<AdminAiManualOverrideDrawerProps> = ({
  onRefresh,
  setMsg,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSyncingNews, setIsSyncingNews] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  const [isPingingAll, setIsPingingAll] = useState(false);
  const [isReclassifying, setIsReclassifying] = useState(false);
  const [isSwarmCycling, setIsSwarmCycling] = useState(false);

  const handleRunResearch = async () => {
    setIsResearching(true);
    try {
      const res = await apiPost('/api/admin/research');
      setMsg(`✓ Đã gửi lệnh kích hoạt WFO Research (Job #${res?.id?.slice(0, 8) || 'OK'}).`);
      onRefresh();
    } catch (e: any) {
      setMsg(`Lỗi kích hoạt Research: ${e.message || ''}`);
    } finally {
      setIsResearching(false);
    }
  };

  const handleSyncNews = async () => {
    setIsSyncingNews(true);
    try {
      const res = await apiPost('/api/admin/news/sync');
      setMsg(`✓ Đã đồng bộ News Shield (${res?.added ?? 0} tin mới, ${res?.existing ?? 0} tin cũ).`);
      onRefresh();
    } catch (e: any) {
      setMsg(`Lỗi đồng bộ lịch tin: ${e.message || ''}`);
    } finally {
      setIsSyncingNews(false);
    }
  };

  const handleReclassifyAll = async () => {
    if (!window.confirm('Tái phân loại toàn bộ tài liệu đã nạp theo chuẩn: Kiến thức thị trường vs Phương pháp kỹ thuật?')) return;
    setIsReclassifying(true);
    try {
      const res = await apiPost('/api/admin/skills/reclassify-all');
      setMsg(`✓ Tái phân loại thành công ${res?.reclassified_count || 0} tài liệu.`);
      onRefresh();
    } catch (e: any) {
      setMsg(`Lỗi tái phân loại: ${e.message || ''}`);
    } finally {
      setIsReclassifying(false);
    }
  };

  const handlePingAllKeys = async () => {
    setIsPingingAll(true);
    setMsg('Đang gửi tín hiệu kiểm tra (Ping Live) tới toàn bộ API Key...');
    try {
      const res = await apiPost('/api/admin/gemini/keys/ping-all');
      setMsg(`✓ ${res?.message || 'Đã kiểm tra xong toàn bộ key.'}`);
      onRefresh();
    } catch (e: any) {
      setMsg(`Lỗi kiểm tra key: ${e.message || ''}`);
    } finally {
      setIsPingingAll(false);
    }
  };

  const handleTriggerSwarmCycle = async () => {
    setIsSwarmCycling(true);
    try {
      const res = await apiPost('/api/admin/swarm/cycle');
      setMsg(`✓ Đã kích hoạt chu kỳ 3-Agent Swarm (${res?.sentinel?.blackout ? 'Blackout: ON' : 'Blackout: OFF'}).`);
      onRefresh();
    } catch (e: any) {
      setMsg(`Lỗi chạy Swarm: ${e.message || ''}`);
    } finally {
      setIsSwarmCycling(false);
    }
  };

  return (
    <div className="quant-panel border border-white/10 rounded-2xl bg-[#030612] overflow-hidden">
      {/* Header bar toggles the drawer */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.02] transition cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">⚙️</span>
          <div>
            <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">
              Công cụ kỹ thuật (Manual Override)
            </h4>
            <p className="text-[11px] text-slate-500">
              Các nút can thiệp vi mô chỉ dùng khi gỡ lỗi hoặc bảo trì. Bình thường hệ thống tự động 100%.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-slate-400">
            {isOpen ? 'Thu gọn ▲' : 'Mở rộng ▼'}
          </span>
        </div>
      </button>

      {/* Collapsible content (default closed) */}
      {isOpen && (
        <div className="p-5 border-t border-white/5 space-y-4 bg-[#02040b]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Chạy tay WFO Research */}
            <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-2">
              <div className="font-mono text-xs font-bold text-white">Chạy Walk-Forward Research</div>
              <p className="text-[11px] text-slate-400">Kích hoạt tác vụ WFO kiểm thử dữ liệu OOS ngay lập tức.</p>
              <button
                type="button"
                disabled={isResearching}
                onClick={handleRunResearch}
                className="w-full py-1.5 px-3 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 font-mono text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isResearching ? 'Đang chạy...' : '▶ Chạy WFO Research'}
              </button>
            </div>

            {/* Đồng bộ tay Lịch Tin News Shield */}
            <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-2">
              <div className="font-mono text-xs font-bold text-white">Đồng Bộ News Shield</div>
              <p className="text-[11px] text-slate-400">Tải các sự kiện kinh tế đỏ từ ForexFactory / Investing.</p>
              <button
                type="button"
                disabled={isSyncingNews}
                onClick={handleSyncNews}
                className="w-full py-1.5 px-3 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-mono text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isSyncingNews ? 'Đang đồng bộ...' : '↻ Đồng Bộ Lịch Tin'}
              </button>
            </div>

            {/* Phân loại lại toàn bộ PDF */}
            <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-2">
              <div className="font-mono text-xs font-bold text-white">Tái Phân Loại Tri Thức</div>
              <p className="text-[11px] text-slate-400">Chuẩn hóa danh mục Vĩ mô vs Kỹ thuật cho toàn bộ PDF.</p>
              <button
                type="button"
                disabled={isReclassifying}
                onClick={handleReclassifyAll}
                className="w-full py-1.5 px-3 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-mono text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isReclassifying ? 'Đang xử lý...' : '⚡ Phân Loại Lại PDF'}
              </button>
            </div>

            {/* Ping toàn bộ Gemini Keys */}
            <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-2">
              <div className="font-mono text-xs font-bold text-white">Ping Kiểm Tra Key Pool</div>
              <p className="text-[11px] text-slate-400">Gửi request live kiểm tra độ trễ và hạn ngạch toàn bộ key.</p>
              <button
                type="button"
                disabled={isPingingAll}
                onClick={handlePingAllKeys}
                className="w-full py-1.5 px-3 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 font-mono text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isPingingAll ? 'Đang ping...' : '📡 Ping Toàn Bộ Key'}
              </button>
            </div>

            {/* Trigger Swarm Cycle */}
            <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-2">
              <div className="font-mono text-xs font-bold text-white">Quét Chu Kỳ 3-Agent Swarm</div>
              <p className="text-[11px] text-slate-400">Ép tiến trình Sentinel, Alpha, Risk Guardian đồng bộ trạng thái.</p>
              <button
                type="button"
                disabled={isSwarmCycling}
                onClick={handleTriggerSwarmCycle}
                className="w-full py-1.5 px-3 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-300 font-mono text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isSwarmCycling ? 'Đang quét...' : '⚡ Chạy Chu Kỳ Swarm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
