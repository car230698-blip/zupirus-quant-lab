import React from 'react';
import { fmtNum } from '../utils/strategyDecision';

export interface EditAccountConfigForm {
  lot_multiplier: string;
  max_daily_dd_pct: string;
  max_lot: string;
  daily_profit_target_usd: string;
  symbol_mapping_custom: string;
  is_prop_firm_mode: boolean;
  prop_stage: 'CHALLENGE' | 'LIVE';
}

export interface ConnectedAccountsListSectionProps {
  accounts: any[];
  expandedConfigId: string | null;
  setExpandedConfigId: (id: string | null) => void;
  cloudBusy: boolean;
  editConfigForm: EditAccountConfigForm;
  setEditConfigForm: React.Dispatch<React.SetStateAction<EditAccountConfigForm>>;
  handleSyncAccount: (accountId: string) => void;
  handleOpenEditConfig: (acc: any) => void;
  handleCloudDeployToggle: (accountId: string, action: 'deploy' | 'undeploy') => void;
  handleToggleAccount: (accountId: string, currentActive: boolean) => void;
  handleDeleteAccount: (accountId: string) => void;
  handleSaveAccountConfig: (acc: any) => void;
}

export const ConnectedAccountsListSection: React.FC<ConnectedAccountsListSectionProps> = ({
  accounts,
  expandedConfigId,
  setExpandedConfigId,
  cloudBusy,
  editConfigForm,
  setEditConfigForm,
  handleSyncAccount,
  handleOpenEditConfig,
  handleCloudDeployToggle,
  handleToggleAccount,
  handleDeleteAccount,
  handleSaveAccountConfig,
}) => {
  return (
    <div className="quant-panel p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
            Danh Sách Trạm Đầu Cuối
          </span>
          <h3 className="mt-0.5 text-lg font-bold text-white">
            Quản Trị Tài Khoản MT5 & Lá Chắn Quỹ (Prop Firm Guard)
          </h3>
        </div>
        <span className="font-mono text-xs text-slate-400 tabular-nums">
          Tổng cộng: {accounts.length} tài khoản
        </span>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#040710]/50 p-8 text-center text-sm text-slate-400">
          Chưa có tài khoản MT5 nào. Hãy điền thông tin ở biểu mẫu phía trên để khởi chạy trạm Cloud MT5 đầu tiên.
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((acc: any) => {
            const id = acc.account_id || acc.id || acc.login;
            const isExpanded = expandedConfigId === id;
            const isActive = Boolean(acc.auto_trade ?? acc.enabled ?? acc.is_active);
            const deployState = acc.deployment_status || acc.deployment_state || 'DEPLOYED';
            const isDeployed = deployState === 'DEPLOYED';
            const isProp = Boolean(acc.is_prop_firm_mode) || String(acc.account_type || '').toUpperCase() === 'PROP';
            const propStage = String(acc.prop_stage || 'CHALLENGE').toUpperCase();
            return (
              <div
                key={id}
                className="rounded-xl border border-white/[0.08] bg-[#040710]/85 p-4 transition hover:border-cyan-500/30"
              >
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                        }`}
                      />
                      <span className="text-base font-bold text-white">
                        {acc.account_name || acc.login || id}
                      </span>
                      {isProp && (
                        <span
                          className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-bold border ${
                            propStage === 'LIVE'
                              ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                              : 'border-amber-400/40 bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          PROP · {propStage}
                        </span>
                      )}
                      <span className="font-mono text-xs text-slate-400">
                        #{id} · {acc.broker_server || acc.mt5_server || 'MT5 Cloud'} ·{' '}
                        <strong className={isDeployed ? 'text-emerald-300' : 'text-amber-300'}>
                          {deployState}
                        </strong>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-1 font-mono text-xs text-slate-300 tabular-nums">
                      <span>
                        Balance: <strong className="text-white">${fmtNum(acc.balance, 2)}</strong>
                      </span>
                      <span className="text-slate-600">·</span>
                      <span>
                        Equity: <strong className="text-cyan-300">${fmtNum(acc.equity, 2)}</strong>
                      </span>
                      <span className="text-slate-600">·</span>
                      <span>
                        Hệ số Lot:{' '}
                        <strong className="text-emerald-300">
                          x{fmtNum(acc.lot_multiplier || acc.risk_multiplier || 1, 2)}
                        </strong>
                      </span>
                      <span className="text-slate-600">·</span>
                      <span>
                        Daily DD: <strong className="text-amber-300">{fmtNum(acc.daily_dd_pct || 0, 2)}%</strong> /{' '}
                        {fmtNum(acc.max_daily_dd_pct || acc.max_daily_drawdown_pct || 4, 1)}%
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={cloudBusy}
                      onClick={() => handleSyncAccount(id)}
                      className="quant-btn-secondary px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                      title="Đồng bộ Balance/Equity từ MetaApi"
                    >
                      Đồng bộ
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEditConfig(acc)}
                      className="quant-btn-secondary px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                    >
                      {isExpanded ? 'Đóng Cấu Hình' : 'Cấu Hình Rủi Ro'}
                    </button>

                    <button
                      type="button"
                      disabled={cloudBusy}
                      onClick={() => handleCloudDeployToggle(id, isDeployed ? 'undeploy' : 'deploy')}
                      className="quant-btn-secondary px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                    >
                      {isDeployed ? 'Ngắt Cloud' : 'Bật Cloud'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleAccount(id, isActive)}
                      className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'border border-rose-500/35 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                          : 'border border-emerald-500/35 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                      }`}
                    >
                      {isActive ? 'Tạm Dừng Copy' : 'Kích Hoạt Copy'}
                    </button>

                    <button
                      type="button"
                      disabled={cloudBusy}
                      onClick={() => handleDeleteAccount(id)}
                      className="rounded-xl px-2.5 py-1.5 text-xs font-bold transition whitespace-nowrap shrink-0 border border-rose-500/40 bg-rose-950/30 text-rose-300 hover:bg-rose-900/50 hover:text-white"
                      title="Xoá và ngắt kết nối tài khoản"
                    >
                      Xoá
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 border-t border-white/[0.08] pt-4">
                    <div className="mb-3 text-xs font-mono uppercase tracking-wider text-cyan-300">
                      Tham Số Quản Trị Rủi Ro & Prop Firm Guard — Tài Khoản #{id}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-400">Hệ Số Nhân Lot (x)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={editConfigForm.lot_multiplier}
                          onChange={(e) =>
                            setEditConfigForm({ ...editConfigForm, lot_multiplier: e.target.value })
                          }
                          className="quant-input font-mono text-xs tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-400">Trần Lỗ Ngày (%)</label>
                        <input
                          type="number"
                          step="0.5"
                          value={editConfigForm.max_daily_dd_pct}
                          onChange={(e) =>
                            setEditConfigForm({ ...editConfigForm, max_daily_dd_pct: e.target.value })
                          }
                          className="quant-input font-mono text-xs tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-400">Lot Tối Đa / Lệnh</label>
                        <input
                          type="number"
                          step="0.1"
                          value={editConfigForm.max_lot}
                          onChange={(e) => setEditConfigForm({ ...editConfigForm, max_lot: e.target.value })}
                          className="quant-input font-mono text-xs tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-400">Mục Tiêu Lãi Ngày ($)</label>
                        <input
                          type="number"
                          step="10"
                          value={editConfigForm.daily_profit_target_usd}
                          onChange={(e) =>
                            setEditConfigForm({
                              ...editConfigForm,
                              daily_profit_target_usd: e.target.value,
                            })
                          }
                          className="quant-input font-mono text-xs tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-400">Mã Symbol Sàn (Tuỳ chọn)</label>
                        <input
                          type="text"
                          placeholder="VD: XAUUSDm"
                          value={editConfigForm.symbol_mapping_custom}
                          onChange={(e) =>
                            setEditConfigForm({
                              ...editConfigForm,
                              symbol_mapping_custom: e.target.value,
                            })
                          }
                          className="quant-input font-mono text-xs"
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editConfigForm.is_prop_firm_mode}
                            onChange={(e) =>
                              setEditConfigForm({ ...editConfigForm, is_prop_firm_mode: e.target.checked })
                            }
                          />
                          <span>Chế độ Quỹ (Prop Firm)</span>
                        </label>
                        {editConfigForm.is_prop_firm_mode && (
                          <select
                            value={editConfigForm.prop_stage}
                            onChange={(e) =>
                              setEditConfigForm({
                                ...editConfigForm,
                                prop_stage: e.target.value as 'CHALLENGE' | 'LIVE',
                              })
                            }
                            className="rounded-lg border border-amber-500/40 bg-[#050914] px-2 py-1 font-mono text-[11px] text-amber-300"
                          >
                            <option value="CHALLENGE">Đang thi (Challenge)</option>
                            <option value="LIVE">Live (Funded — Trần 1%)</option>
                          </select>
                        )}
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setExpandedConfigId(null)}
                          className="quant-btn-secondary px-3.5 py-1.5 text-xs"
                        >
                          Huỷ
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveAccountConfig(acc)}
                          className="quant-btn-primary px-4 py-1.5 text-xs"
                        >
                          Lưu Tham Số Bảo Vệ
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
