import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import { fetchStrategyHistory, StrategyHistoryItem } from '../../api/client';
import { MetricCard, Panel, StatusBadge, EmptyState } from '../ui/Primitives';
import { Cpu, Layers, KeyRound, Activity, History } from 'lucide-react';

export interface AdminAiOverviewPanelProps {
  evo: any;
  geminiPool: any[];
  onRefresh: () => void;
  setMsg: (msg: string) => void;
}

function formatDateTime(rawTs: any): string {
  if (!rawTs) return '--:--:--';
  const num = Number(rawTs);
  if (isNaN(num) || num <= 0) return '--:--:--';
  const millis = num > 1e11 ? num : num * 1000;
  const d = new Date(millis);
  if (isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour12: false,
  });
}

export const AdminAiOverviewPanel: React.FC<AdminAiOverviewPanelProps> = ({
  evo,
  geminiPool,
}) => {
  const [strategyHistory, setStrategyHistory] = useState<StrategyHistoryItem[]>([]);
  const { lang } = useLanguage();

  const activeKeysCount = geminiPool.filter((k) => k.is_active && k.status !== 'error').length;
  const learnedSkillsCount = evo?.skills_learned?.length || 0;
  const builtinSkillsCount = evo?.skills_builtin?.length || 0;

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetchStrategyHistory();
      setStrategyHistory(res.strategies || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className="space-y-6">
      {/* 1. TELEMETRY SUMMARY */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label={lang === 'en' ? 'Research Mode' : 'Chế Độ Nghiên Cứu'}
          value="QUANT LAB"
          subtext="Nghiên cứu định lượng theo yêu cầu (Cá nhân & Tổ chức)"
          icon={<Cpu className="h-4 w-4" />}
          tone="cyan"
        />
        <MetricCard
          label="Engine Telemetry"
          value="ACTIVE"
          subtext="Sẵn sàng kiểm định sự kiện vĩ mô & nến thị trường"
          icon={<Activity className="h-4 w-4" />}
          tone="emerald"
        />
        <MetricCard
          label={lang === 'en' ? 'Quantitative Rules' : 'Quy Tắc Định Lượng'}
          value={`${learnedSkillsCount} + ${builtinSkillsCount}`}
          subtext="Kho quy tắc định lượng nội bộ & cốt lõi"
          icon={<Layers className="h-4 w-4" />}
          tone="amber"
        />
        <MetricCard
          label="Gemini Key Pool"
          value={`${activeKeysCount} / ${geminiPool.length}`}
          subtext={
            geminiPool.filter((k) => k.status === 'exhausted' || k.status === 'rate_limited').length > 0
              ? 'Có key đang hạ nhiệt'
              : 'Pool hoạt động ổn định'
          }
          icon={<KeyRound className="h-4 w-4" />}
          tone={activeKeysCount > 0 ? 'emerald' : 'rose'}
        />
      </div>

      {/* 2. STRATEGY VERSION HISTORY (READ-ONLY ARCHIVE) */}
      <Panel
        icon={<History className="h-4 w-4 text-cyan-300" />}
        title={lang === 'en' ? 'Historical Models & Calibration Archive' : 'Kho Lưu Trữ Mô Hình & Lịch Sử Hiệu Chỉnh'}
        subtitle={lang === 'en' ? 'Read-only archive of verified backtest iterations' : 'Lưu trữ chỉ đọc các phiên bản kiểm định đã hoàn tất'}
      >
        {strategyHistory.length === 0 ? (
          <EmptyState
            icon={<History className="h-5 w-5" />}
            title={lang === 'en' ? 'No model history stored' : 'Chưa có lịch sử mô hình'}
            description={
              lang === 'en'
                ? 'Historical quantitative model iterations appear here.'
                : 'Các phiên bản mô hình định lượng đã ghi nhận sẽ hiển thị tại đây ở chế độ lưu trữ.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="quant-table font-mono text-xs tabular-nums">
              <thead>
                <tr>
                  <th>{lang === 'en' ? 'Version & Name' : 'Phiên Bản & Tên'}</th>
                  <th>{lang === 'en' ? 'Status' : 'Trạng Thái'}</th>
                  <th>Win Rate</th>
                  <th>Profit Factor</th>
                  <th>Max DD</th>
                  <th>Mẫu</th>
                  <th>Cập Nhật</th>
                  <th className="text-right">Chế Độ</th>
                </tr>
              </thead>
              <tbody>
                {strategyHistory.map((strat) => {
                  const isLive = strat.status === 'APPROVED_FOR_PROD';
                  return (
                    <tr key={strat.id}>
                      <td>
                        <div className="font-sans font-semibold text-white">{strat.name}</div>
                        <div className="text-[11px] text-slate-500">{strat.id}</div>
                      </td>
                      <td>
                        <StatusBadge
                          tone={isLive ? 'success' : strat.status === 'ROLLED_BACK' ? 'warning' : 'neutral'}
                        >
                          {isLive ? 'ARCHIVED_ACTIVE' : strat.status}
                        </StatusBadge>
                      </td>
                      <td className="text-cyan-300 font-semibold">{strat.win_rate_pct}%</td>
                      <td className="text-emerald-400 font-semibold">{strat.profit_factor}</td>
                      <td className="text-rose-300">{strat.max_drawdown_pct}%</td>
                      <td>{strat.sample_size}</td>
                      <td className="text-slate-400 text-[11px]">
                        {formatDateTime(strat.updated_at || strat.created_at)}
                      </td>
                      <td className="text-right font-sans text-xs text-slate-400">
                        Chỉ đọc
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
};
