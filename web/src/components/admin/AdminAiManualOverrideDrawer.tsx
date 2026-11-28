import React, { useState } from 'react';
import { apiPost } from '../../api/client';
import { Settings, ChevronDown, ChevronUp } from 'lucide-react';

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
  const [isSyncingCandles, setIsSyncingCandles] = useState(false);
  const [isPingingAll, setIsPingingAll] = useState(false);
  const [isReclassifying, setIsReclassifying] = useState(false);
  const [confirmReclassify, setConfirmReclassify] = useState(false);

  const handleSyncCandles = async () => {
    setIsSyncingCandles(true);
    try {
      const res = await apiPost('/api/admin/candles/sync', { symbol: 'XAUUSD', timeframe: 'M15' });
      setMsg(`Đã đồng bộ nến thị trường (${res?.message || 'Thành công'}).`);
      onRefresh();
    } catch (e: any) {
      setMsg(`Lỗi đồng bộ nến: ${e.message || ''}`);
    } finally {
      setIsSyncingCandles(false);
    }
  };

  const handleSyncNews = async () => {
    setIsSyncingNews(true);
    try {
      const res = await apiPost('/api/admin/news/sync');
      setMsg(`Đã đồng bộ lịch tin (${res?.added ?? 0} tin mới, ${res?.existing ?? 0} tin cũ).`);
      onRefresh();
    } catch (e: any) {
      setMsg(`Lỗi đồng bộ lịch tin: ${e.message || ''}`);
    } finally {
      setIsSyncingNews(false);
    }
  };

  const handleReclassifyAll = async () => {
    setConfirmReclassify(false);
    setIsReclassifying(true);
    try {
      const res = await apiPost('/api/admin/skills/reclassify-all');
      setMsg(`Tái phân loại thành công ${res?.reclassified_count || 0} tài liệu.`);
      onRefresh();
    } catch (e: any) {
      setMsg(`Lỗi tái phân loại: ${e.message || ''}`);
    } finally {
      setIsReclassifying(false);
    }
  };

  const handlePingAllKeys = async () => {
    setIsPingingAll(true);
    setMsg('Đang kiểm tra toàn bộ API Key...');
    try {
      const res = await apiPost('/api/admin/gemini/keys/ping-all');
      setMsg(res?.message || 'Đã kiểm tra xong toàn bộ key.');
      onRefresh();
    } catch (e: any) {
      setMsg(`Lỗi kiểm tra key: ${e.message || ''}`);
    } finally {
      setIsPingingAll(false);
    }
  };

  return (
    <div className="quant-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.02] transition cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-cyan-300">
            <Settings className="h-4 w-4" />
          </span>
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
              Công cụ bảo trì & Can thiệp hạ tầng
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">
              Đồng bộ dữ liệu nến, tin tức vĩ mô và kiểm tra hạ tầng API keys.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-mono text-slate-400">
          {isOpen ? (
            <>
              <span>Thu gọn</span>
              <ChevronUp className="h-4 w-4" />
            </>
          ) : (
            <>
              <span>Mở rộng</span>
              <ChevronDown className="h-4 w-4" />
            </>
          )}
        </span>
      </button>

      {isOpen && (
        <div className="p-4 pt-0 border-t border-slate-800 grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
          <div className="p-3.5 bg-[#0B1220] border border-slate-800 rounded-xl space-y-2">
            <div className="font-mono text-xs font-bold text-white">Đồng Bộ Nến Thị Trường</div>
            <p className="text-xs text-slate-400">Tải nến M15/H1 mới nhất cho Vàng và Forex.</p>
            <button
              type="button"
              disabled={isSyncingCandles}
              onClick={handleSyncCandles}
              className="quant-btn-secondary w-full min-h-[34px] text-xs"
            >
              {isSyncingCandles ? 'Đang đồng bộ...' : 'Đồng Bộ Nến'}
            </button>
          </div>

          <div className="p-3.5 bg-[#0B1220] border border-slate-800 rounded-xl space-y-2">
            <div className="font-mono text-xs font-bold text-white">Đồng Bộ Lịch Tin Vĩ Mô</div>
            <p className="text-xs text-slate-400">Cập nhật các sự kiện kinh tế USD trọng yếu.</p>
            <button
              type="button"
              disabled={isSyncingNews}
              onClick={handleSyncNews}
              className="quant-btn-secondary w-full min-h-[34px] text-xs"
            >
              {isSyncingNews ? 'Đang đồng bộ...' : 'Đồng Bộ Lịch Tin'}
            </button>
          </div>

          <div className="p-3.5 bg-[#0B1220] border border-slate-800 rounded-xl space-y-2">
            <div className="font-mono text-xs font-bold text-white">Tái Phân Loại Tri Thức</div>
            <p className="text-xs text-slate-400">Chuẩn hóa danh mục Vĩ mô và Kỹ thuật cho toàn bộ PDF.</p>
            {confirmReclassify ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isReclassifying}
                  onClick={handleReclassifyAll}
                  className="quant-btn-primary flex-1 min-h-[34px] text-xs"
                >
                  Xác nhận
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReclassify(false)}
                  className="quant-quiet min-h-[34px] text-xs"
                >
                  Hủy
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isReclassifying}
                onClick={() => setConfirmReclassify(true)}
                className="quant-btn-secondary w-full min-h-[34px] text-xs"
              >
                {isReclassifying ? 'Đang xử lý...' : 'Phân Loại Lại PDF'}
              </button>
            )}
          </div>

          <div className="p-3.5 bg-[#0B1220] border border-slate-800 rounded-xl space-y-2">
            <div className="font-mono text-xs font-bold text-white">Ping Kiểm Tra Key Pool</div>
            <p className="text-xs text-slate-400">Kiểm tra độ trễ và hạn ngạch toàn bộ Gemini keys.</p>
            <button
              type="button"
              disabled={isPingingAll}
              onClick={handlePingAllKeys}
              className="quant-btn-secondary w-full min-h-[34px] text-xs"
            >
              {isPingingAll ? 'Đang ping...' : 'Ping Toàn Bộ Key'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
