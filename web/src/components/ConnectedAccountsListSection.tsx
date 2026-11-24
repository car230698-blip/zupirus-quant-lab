import React from 'react';
import { fmtNum } from '../utils/strategyDecision';
import { formatAccountBalance, formatAccountEquity } from '../utils/currencyFormat';
import { SpotlightBento } from './ui/SpotlightBento';
import { useLanguage } from '../i18n/LanguageContext';

export interface EditAccountConfigForm {
  lot_multiplier: string;
  max_daily_dd_pct: string;
  max_lot: string;
  daily_profit_target_usd: string;
  symbol_mapping_custom: string;
  is_prop_firm_mode: boolean;
  prop_stage: 'CHALLENGE' | 'LIVE';
  allowed_strategy_ids?: string;
}

export interface ConnectedAccountsListSectionProps {
  accounts: any[];
  expandedConfigId: string | null;
  setExpandedConfigId: (id: string | null) => void;
  cloudBusy: boolean;
  cloudMsg?: string;
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
  cloudMsg,
  editConfigForm,
  setEditConfigForm,
  handleSyncAccount,
  handleOpenEditConfig,
  handleCloudDeployToggle,
  handleToggleAccount,
  handleDeleteAccount,
  handleSaveAccountConfig,
}) => {
  const { lang } = useLanguage();
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  return (
    <SpotlightBento className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-400">
            {lang === 'en' ? 'TERMINAL NODE DIRECTORY' : 'Danh Sách Trạm Đầu Cuối'}
          </span>
          <h3 className="mt-0.5 text-lg font-bold text-white">
            {lang === 'en' ? 'MT5 Account Management & Prop Firm Guard' : 'Quản Trị Tài Khoản MT5 & Lá Chắn Quỹ (Prop Firm Guard)'}
          </h3>
        </div>
        <span className="font-mono text-xs text-slate-400 tabular-nums">
          {lang === 'en' ? `Total: ${accounts.length} accounts` : `Tổng cộng: ${accounts.length} tài khoản`}
        </span>
      </div>

      {cloudMsg && (
        <div className="mb-4 rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-4 py-2.5 text-xs text-cyan-200">
          {cloudMsg}
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#040710]/50 p-8 text-center text-sm text-slate-400">
          {lang === 'en'
            ? 'No MT5 accounts yet. Fill in the form above to launch your first Cloud MT5 terminal node.'
            : 'Chưa có tài khoản MT5 nào. Hãy điền thông tin ở biểu mẫu phía trên để khởi chạy trạm Cloud MT5 đầu tiên.'}
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
                          acc.connection_status === 'DISCONNECTED'
                            ? 'bg-rose-500 animate-pulse'
                            : isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
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
                      {acc.connection_status === 'DISCONNECTED' && (
                        <span className="rounded bg-rose-500/20 border border-rose-500/40 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-300">
                          {lang === 'en' ? 'BROKER DISCONNECTED' : 'MẤT KẾT NỐI SÀN'}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-1 font-mono text-xs text-slate-300 tabular-nums">
                      <span>
                        Balance:{' '}
                        <strong className="text-white">
                          {formatAccountBalance(acc.balance, acc)}
                        </strong>
                      </span>
                      <span className="text-slate-600">·</span>
                      <span>
                        Equity:{' '}
                        <strong className="text-cyan-300">
                          {formatAccountEquity(acc.equity, acc)}
                        </strong>
                      </span>
                      <span className="text-slate-600">·</span>
                      <span>
                        {lang === 'en' ? 'Lot Multiplier: ' : 'Hệ số Lot: '}
                        <strong className="text-emerald-300">
                          x{fmtNum(acc.lot_multiplier || acc.risk_multiplier || 1, 2)}
                        </strong>
                      </span>
                      <span className="text-slate-600">·</span>
                      <span>
                        Daily DD:{' '}
                        <strong className="text-amber-300">
                          {fmtNum(
                            acc.daily_dd_pct ??
                              (Number(acc.balance) > 0 && Number(acc.equity) < Number(acc.balance)
                                ? ((Number(acc.balance) - Number(acc.equity)) / Number(acc.balance)) * 100
                                : 0),
                            2
                          )}
                          %
                        </strong>{' '}
                        / {fmtNum(acc.prop_daily_dd_limit_pct || acc.max_daily_dd_pct || acc.max_daily_drawdown_pct || 4, 1)}%
                      </span>
                    </div>

                    {acc.connection_status === 'DISCONNECTED' && (
                      <div className="mt-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5">
                        {lang === 'en'
                          ? 'Broker connection is offline (Disconnected on MetaApi). Please check your MT5 master password or server (Exness).'
                          : 'Tài khoản đang ngắt kết nối với sàn MT5 (trạng thái: Disconnected trên MetaApi). Vui lòng kiểm tra lại mật khẩu hoặc máy chủ sàn.'}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={cloudBusy}
                      onClick={() => handleSyncAccount(id)}
                      className="quant-btn-secondary px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                      title={lang === 'en' ? 'Sync Balance/Equity from MetaApi' : 'Đồng bộ Balance/Equity từ MetaApi'}
                    >
                      {lang === 'en' ? 'Sync' : 'Đồng bộ'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEditConfig(acc)}
                      className="quant-btn-secondary px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                    >
                      {isExpanded ? (lang === 'en' ? 'Close Config' : 'Đóng Cấu Hình') : (lang === 'en' ? 'Risk Config' : 'Cấu Hình Rủi Ro')}
                    </button>

                    <button
                      type="button"
                      disabled={cloudBusy}
                      onClick={() => handleCloudDeployToggle(id, isDeployed ? 'undeploy' : 'deploy')}
                      className="quant-btn-secondary px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                    >
                      {isDeployed ? (lang === 'en' ? 'Disconnect' : 'Ngắt Cloud') : (lang === 'en' ? 'Connect' : 'Bật Cloud')}
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
                      {isActive ? (lang === 'en' ? 'Pause Execution' : 'Tạm Dừng Copy') : (lang === 'en' ? 'Enable Execution' : 'Kích Hoạt Copy')}
                    </button>

                    {confirmDeleteId === id ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={cloudBusy}
                          onClick={() => {
                            setConfirmDeleteId(null);
                            handleDeleteAccount(id);
                          }}
                          className="rounded-xl px-2.5 py-1.5 text-xs font-bold transition whitespace-nowrap shrink-0 border border-rose-400 bg-rose-600 text-white hover:bg-rose-500"
                        >
                          {lang === 'en' ? 'Confirm Delete' : 'Xác nhận Xoá'}
                        </button>
                        <button
                          type="button"
                          disabled={cloudBusy}
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-xl px-2 py-1.5 text-xs font-semibold transition whitespace-nowrap shrink-0 border border-white/15 bg-slate-900 text-slate-300 hover:text-white"
                        >
                          {lang === 'en' ? 'Cancel' : 'Huỷ'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={cloudBusy}
                        onClick={() => setConfirmDeleteId(id)}
                        className="rounded-xl px-2.5 py-1.5 text-xs font-bold transition whitespace-nowrap shrink-0 border border-rose-500/40 bg-rose-950/30 text-rose-300 hover:bg-rose-900/50 hover:text-white"
                        title={lang === 'en' ? 'Delete and disconnect account' : 'Xoá và ngắt kết nối tài khoản'}
                      >
                        {lang === 'en' ? 'Delete' : 'Xoá'}
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 border-t border-white/[0.08] pt-4">
                    <div className="mb-3 text-xs font-mono uppercase tracking-wider text-cyan-300">
                      {lang === 'en'
                        ? `Risk Management Parameters & Prop Firm Guard — Account #${id}`
                        : `Tham Số Quản Trị Rủi Ro & Prop Firm Guard — Tài Khoản #${id}`}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-400">
                          {lang === 'en' ? 'Lot Multiplier (x)' : 'Hệ Số Nhân Lot (x)'}
                        </label>
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
                        <label className="mb-1 block text-[11px] text-slate-400">
                          {lang === 'en' ? 'Max Daily DD (%)' : 'Trần Lỗ Ngày (%)'}
                        </label>
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
                        <label className="mb-1 block text-[11px] text-slate-400">
                          {lang === 'en' ? 'Max Lot / Order' : 'Lot Tối Đa / Lệnh'}
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          value={editConfigForm.max_lot}
                          onChange={(e) => setEditConfigForm({ ...editConfigForm, max_lot: e.target.value })}
                          className="quant-input font-mono text-xs tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-400">
                          {lang === 'en' ? 'Daily Profit Target ($)' : 'Mục Tiêu Lãi Ngày ($)'}
                        </label>
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
                        <label className="mb-1 block text-[11px] text-slate-400">
                          {lang === 'en' ? 'Broker Symbol (Optional)' : 'Mã Symbol Sàn (Tuỳ chọn)'}
                        </label>
                        <input
                          type="text"
                          placeholder={lang === 'en' ? 'e.g. XAUUSDm' : 'VD: XAUUSDm'}
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
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-400">
                          {lang === 'en' ? 'Strategy Routing' : 'Phân Bổ Chiến Lược'}
                        </label>
                        <input
                          type="text"
                          placeholder={lang === 'en' ? 'all or smc, price_action' : 'all hoặc smc, price_action'}
                          value={editConfigForm.allowed_strategy_ids || ''}
                          onChange={(e) =>
                            setEditConfigForm({
                              ...editConfigForm,
                              allowed_strategy_ids: e.target.value,
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
                          <span>{lang === 'en' ? 'Prop Firm Mode' : 'Chế độ Quỹ (Prop Firm)'}</span>
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
                            <option value="CHALLENGE">{lang === 'en' ? 'Challenge' : 'Đang thi (Challenge)'}</option>
                            <option value="LIVE">{lang === 'en' ? 'Live Funded (1% cap)' : 'Live (Funded — Trần 1%)'}</option>
                          </select>
                        )}
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setExpandedConfigId(null)}
                          className="quant-btn-secondary px-3.5 py-1.5 text-xs"
                        >
                          {lang === 'en' ? 'Cancel' : 'Huỷ'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveAccountConfig(acc)}
                          className="quant-btn-primary px-4 py-1.5 text-xs"
                        >
                          {lang === 'en' ? 'Save Shield Parameters' : 'Lưu Tham Số Bảo Vệ'}
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
    </SpotlightBento>
  );
};
