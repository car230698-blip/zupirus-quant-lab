"""Runtime Position Watcher & Real-Time Risk Protection Engine.
Monitors all open positions across user MetaApi terminals (including accounts with auto_trade=0):
1. Auto Break-Even & Partial TP (50% TP1) at 1R profit milestone for Growth & Alpha accounts.
2. Prop Firm Pass Guard:
   - Real-time Daily Drawdown circuit breaker (auto-close all & lock at configured drawdown limit).
   - Friday 21:00 UTC weekend holding closure (strictly avoids gap risk on prop accounts).
"""
import json
import logging
import datetime
import time
from typing import Dict, Any, List, Optional
from app.db import tx, audit, setkv, getkv
from app.metaapi import MetaApiClient

logger = logging.getLogger("zupirus.watcher")

SUCCESS_NUMERIC_CODES = {0, 200, 201, 10008, 10009}
SUCCESS_STRING_CODES = {
    "TRADE_RETCODE_PLACED",
    "TRADE_RETCODE_DONE",
    "TRADE_RETCODE_DONE_PARTIAL",
    "ERR_NO_ERROR",
    "OK",
}


def _is_metaapi_success(res: Optional[Dict[str, Any]]) -> bool:
    """Validate whether a MetaApi trade/modify response succeeded."""
    if not res or not isinstance(res, dict):
        return False
    if res.get("error"):
        return False

    has_num = "numericCode" in res and res["numericCode"] is not None
    has_str = "stringCode" in res and res["stringCode"] is not None

    if has_num or has_str:
        num_ok = (not has_num) or (int(res["numericCode"]) in SUCCESS_NUMERIC_CODES)
        str_ok = (not has_str) or (str(res["stringCode"]).upper() in SUCCESS_STRING_CODES)
        return num_ok and str_ok

    status_val = str(res.get("status", "")).upper()
    if status_val in ("FAILED", "ERROR", "REJECTED"):
        return False
    return True


def get_drawdown_halt_key(account_id: str, date_str: Optional[str] = None) -> str:
    """Return canonical daily drawdown halt key for an account."""
    if not date_str:
        date_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    return f"prop_dd_halt:{account_id}:{date_str}"


def is_account_drawdown_halted(c, account_id: str, date_str: Optional[str] = None) -> bool:
    """Check whether an account is locked by the Daily Drawdown Circuit Breaker."""
    halt_key = get_drawdown_halt_key(account_id, date_str)
    if getkv(c, halt_key):
        return True
    if getkv(c, f"drawdown_locked:{account_id}"):
        return True
    return False


MAX_PROP_DAILY_DRAWDOWN_PCT = 4.5
WEEKEND_CLOSE_FRIDAY_HOUR_UTC = 21


class PositionWatcher:
    """Active runtime position monitor for all deployed trading terminals."""

    def __init__(self, metaapi_client: Optional[MetaApiClient] = None):
        self.client = metaapi_client or MetaApiClient()

    async def run_cycle(self, now_dt: Optional[datetime.datetime] = None) -> Dict[str, Any]:
        """Execute one complete monitoring and protection pass across all deployed accounts."""
        now_utc = now_dt or datetime.datetime.now(datetime.timezone.utc)
        date_str = now_utc.strftime("%Y-%m-%d")
        is_friday_weekend = (now_utc.weekday() == 4 and now_utc.hour >= WEEKEND_CLOSE_FRIDAY_HOUR_UTC)

        with tx() as c:
            # Monitor ALL deployed accounts (even if auto_trade=0 so existing open positions stay protected)
            accounts = c.execute(
                """
                SELECT t.id, t.user_id, t.metaapi_account_id, t.auto_trade,
                       t.balance, t.equity, t.risk_config, t.auto_be_partial_tp,
                       t.is_prop_firm_mode, t.prop_stage, t.prop_daily_dd_limit_pct, t.prop_profit_target_pct,
                       t.account_type, t.contract_size,
                       COALESCE(s.plan_tier, 'starter') AS plan_tier
                FROM trading_accounts t
                LEFT JOIN subscriptions s ON t.user_id = s.user_id
                WHERE t.metaapi_account_id IS NOT NULL
                  AND COALESCE(t.deployment_state, 'DEPLOYED') != 'UNDEPLOYED'
                """
            ).fetchall()

        results = {
            "timestamp": now_utc.isoformat(),
            "accounts_checked": len(accounts),
            "partial_tp_executed": 0,
            "be_sl_moved": 0,
            "prop_breakers_triggered": 0,
            "weekend_closes_triggered": 0,
            "details": []
        }

        for raw_acc in accounts:
            acc = dict(raw_acc)
            acc_id = acc["id"]
            meta_id = acc["metaapi_account_id"]
            plan_tier = (acc.get("plan_tier") or "starter").lower()
            is_prop = bool(acc.get("is_prop_firm_mode"))
            prop_dd_limit = float(acc.get("prop_daily_dd_limit_pct") or MAX_PROP_DAILY_DRAWDOWN_PCT)

            try:
                # 1. Fetch live account info
                acc_info = await self.client.get_account_information(meta_id)
                raw_eq = acc_info.get("equity") if isinstance(acc_info, dict) else None
                raw_bal = acc_info.get("balance") if isinstance(acc_info, dict) else None
                current_equity = float(raw_eq if raw_eq is not None else (acc.get("equity") or 0.0))
                current_balance = float(raw_bal if raw_bal is not None else (acc.get("balance") or 0.0))
                if current_equity <= 0 or current_balance <= 0:
                    logger.debug(f"PositionWatcher skipping {acc_id}: invalid/unavailable equity={current_equity}, balance={current_balance}")
                    continue

                # Track start-of-day balance
                day_start_balance = current_balance
                with tx() as c:
                    day_key = f"daily_start_bal:{acc_id}:{date_str}"
                    val = getkv(c, day_key)
                    if val:
                        try:
                            day_start_balance = float(val)
                        except Exception:
                            day_start_balance = current_balance
                    else:
                        setkv(c, day_key, str(current_balance))

                # 2. Universal Daily Drawdown Check (Circuit Breaker for all accounts)
                if day_start_balance > 0 and prop_dd_limit > 0:
                    drawdown_pct = ((day_start_balance - current_equity) / day_start_balance) * 100.0
                    if drawdown_pct >= prop_dd_limit:
                        logger.warning(
                            f"PROP FIRM BREACH: Account {acc_id} daily DD reached {drawdown_pct:.2f}% >= {prop_dd_limit:.2f}%. "
                            f"Emergency closing all positions."
                        )
                        close_res = await self.client.close_all_positions(meta_id) or {}
                        close_ok = (
                            close_res.get("status") in ("ALL_POSITIONS_CLOSED", "NO_OPEN_POSITIONS")
                            or (("closed_count" in close_res or "closed" in close_res) and close_res.get("status") is None and int(close_res.get("failed_count", 0)) == 0)
                        )
                        halt_key = get_drawdown_halt_key(acc_id, date_str)
                        with tx() as c:
                            c.execute("UPDATE trading_accounts SET auto_trade = 0 WHERE id = ?", (acc_id,))
                            if close_ok:
                                setkv(c, halt_key, f"DRAWDOWN_LIMIT_{drawdown_pct:.2f}")
                                setkv(c, f"drawdown_locked:{acc_id}", f"DRAWDOWN_LIMIT_{drawdown_pct:.2f}")
                            audit(c, "prop_guard", "circuit_breaker_triggered", {
                                "account_id": acc_id,
                                "drawdown_pct": round(drawdown_pct, 2),
                                "day_start_balance": day_start_balance,
                                "equity": current_equity,
                                "close_result": close_res
                            })
                        if not close_ok:
                            logger.error(f"PROP FIRM BREACH close incomplete for {acc_id}: {close_res} — will retry next cycle.")
                        results["prop_breakers_triggered"] += 1
                        results["details"].append({
                            "account_id": acc_id,
                            "action": "PROP_CIRCUIT_BREAKER_LOCKED" if close_ok else "PROP_CIRCUIT_BREAKER_CLOSE_INCOMPLETE",
                        })
                        try:
                            from app.mailer import send_admin_alert_email
                            if close_ok:
                                send_admin_alert_email(
                                    f"Ngắt mạch Prop DD tài khoản {acc_id}",
                                    f"Tài khoản {acc_id} chạm drawdown ngày {drawdown_pct:.2f}% >= {prop_dd_limit:.2f}%. Hệ thống đã tự động đóng toàn bộ vị thế và khóa giao dịch.",
                                )
                            else:
                                send_admin_alert_email(
                                    f"KHẨN: Ngắt mạch Prop DD {acc_id} chưa đóng hết lệnh",
                                    f"Tài khoản {acc_id} chạm drawdown ngày {drawdown_pct:.2f}%. Đã tắt auto_trade và sẽ thử đóng lại ở chu kỳ sau. Chi tiết: {close_res}",
                                )
                        except Exception:
                            pass
                        continue

                # 2B. Prop Firm Exclusive Protections (only when is_prop_firm_mode is explicitly enabled; personal accounts unaffected)
                if bool(acc.get("is_prop_firm_mode")):
                    prop_stage_u = str(acc.get("prop_stage") or "CHALLENGE").upper()
                    init_bal = current_balance
                    with tx() as c:
                        init_key = f"prop_initial_bal:{acc_id}"
                        init_val = getkv(c, init_key)
                        if init_val:
                            try:
                                init_bal = float(init_val)
                            except Exception:
                                init_bal = current_balance
                        else:
                            setkv(c, init_key, str(current_balance))

                        hwm_key = f"prop_hwm_equity:{acc_id}"
                        hwm_val = getkv(c, hwm_key)
                        prev_hwm = float(hwm_val) if hwm_val else 0.0
                        hwm_equity = max(init_bal, current_equity, prev_hwm)
                        if not hwm_val or hwm_equity > prev_hwm:
                            setkv(c, hwm_key, str(hwm_equity))

                        # Profit Target >= 80% -> halve new order risk on CHALLENGE only; auto-reset if equity drops < 70%
                        target_pct = float(acc.get("prop_profit_target_pct") or 0.0)
                        if prop_stage_u == "CHALLENGE" and target_pct > 0 and init_bal > 0:
                            gain_pct = ((current_equity - init_bal) / init_bal) * 100.0
                            if gain_pct >= 0.8 * target_pct:
                                setkv(c, f"prop_target_throttle:{acc_id}", "1")
                            elif gain_pct < 0.7 * target_pct:
                                setkv(c, f"prop_target_throttle:{acc_id}", "0")
                        elif prop_stage_u == "LIVE":
                            setkv(c, f"prop_target_throttle:{acc_id}", "0")

                    # Max Overall / Trailing Drawdown >= 8.0% from HWM
                    if hwm_equity > 0:
                        trailing_dd_pct = ((hwm_equity - current_equity) / hwm_equity) * 100.0
                        if trailing_dd_pct >= 8.0:
                            logger.warning(
                                f"PROP HWM BREACH: Account {acc_id} trailing DD {trailing_dd_pct:.2f}% >= 8.0% (HWM={hwm_equity:.2f}). Closing all."
                            )
                            close_res = await self.client.close_all_positions(meta_id) or {}
                            close_ok = (
                                close_res.get("status") in ("ALL_POSITIONS_CLOSED", "NO_OPEN_POSITIONS")
                                or (("closed_count" in close_res or "closed" in close_res) and close_res.get("status") is None and int(close_res.get("failed_count", 0)) == 0)
                            )
                            with tx() as c:
                                c.execute("UPDATE trading_accounts SET auto_trade = 0 WHERE id = ?", (acc_id,))
                                if close_ok:
                                    setkv(c, f"drawdown_locked:{acc_id}", f"HWM_TRAILING_DD_{trailing_dd_pct:.2f}")
                                audit(c, "prop_guard", "hwm_trailing_dd_triggered", {
                                    "account_id": acc_id,
                                    "trailing_dd_pct": round(trailing_dd_pct, 2),
                                    "hwm_equity": hwm_equity,
                                    "equity": current_equity,
                                    "close_result": close_res,
                                })
                            if not close_ok:
                                logger.error(f"PROP HWM BREACH close incomplete for {acc_id}: {close_res} — will retry next cycle.")
                            results["prop_breakers_triggered"] += 1
                            results["details"].append({
                                "account_id": acc_id,
                                "action": "PROP_HWM_TRAILING_LOCKED" if close_ok else "PROP_HWM_CLOSE_INCOMPLETE",
                            })
                            try:
                                from app.mailer import send_admin_alert_email
                                if close_ok:
                                    send_admin_alert_email(
                                        f"Ngắt mạch HWM Trailing DD 8% tài khoản {acc_id}",
                                        f"Tài khoản Quỹ {acc_id} sụt {trailing_dd_pct:.2f}% từ đỉnh vốn ${hwm_equity:,.2f}. Đã đóng toàn bộ lệnh và khóa giao dịch.",
                                    )
                                else:
                                    send_admin_alert_email(
                                        f"KHẨN: Ngắt mạch HWM 8% {acc_id} chưa đóng hết lệnh",
                                        f"Tài khoản Quỹ {acc_id} sụt {trailing_dd_pct:.2f}% từ đỉnh vốn ${hwm_equity:,.2f}. Đã tắt auto_trade và sẽ thử đóng lại ở chu kỳ sau. Chi tiết: {close_res}",
                                    )
                            except Exception:
                                pass
                            continue

                # 3. Friday 21:00 UTC Weekend Risk Close
                if is_prop and is_friday_weekend:
                    positions = await self.client.get_open_positions(meta_id, raise_on_error=True)
                    if positions:
                        logger.info(f"WEEKEND CLOSE: Account {acc_id} closing {len(positions)} positions before Friday close.")
                        close_res = await self.client.close_all_positions(meta_id) or {}
                        close_ok = (
                            close_res.get("status") in ("ALL_POSITIONS_CLOSED", "NO_OPEN_POSITIONS")
                            or (("closed_count" in close_res or "closed" in close_res) and close_res.get("status") is None and int(close_res.get("failed_count", 0)) == 0)
                        )
                        with tx() as c:
                            audit(c, "weekend_guard", "friday_weekend_close", {
                                "account_id": acc_id,
                                "positions_closed": len(positions),
                                "time_utc": now_utc.isoformat(),
                                "close_result": close_res,
                                "close_ok": close_ok,
                            })
                        if close_ok:
                            results["weekend_closes_triggered"] += 1
                            results["details"].append({"account_id": acc_id, "action": "FRIDAY_WEEKEND_POSITIONS_CLOSED"})
                        else:
                            logger.error(f"WEEKEND CLOSE incomplete for {acc_id}: {close_res}")
                            results["details"].append({"account_id": acc_id, "action": "FRIDAY_WEEKEND_CLOSE_INCOMPLETE"})
                        continue

                # 4. Auto Break-Even & Partial TP (50% TP1) at 1R for Growth, Alpha, or explicit auto_be_partial_tp
                allow_auto_be = bool(acc.get("auto_be_partial_tp")) or plan_tier in ("growth", "alpha", "pro")
                if allow_auto_be:
                    positions = await self.client.get_open_positions(meta_id, raise_on_error=True)
                    for pos in positions:
                        pos_id = str(pos.get("id", ""))
                        if not pos_id:
                            continue

                        # Check origin: only manage ZUPIRUS automated orders
                        pos_comment = str(pos.get("comment") or "").upper()
                        with tx() as c:
                            is_zupirus_trade = c.execute(
                                "SELECT id FROM metaapi_trade_executions WHERE account_id = ? AND (position_id = ? OR order_id = ? OR id = ?)",
                                (acc_id, pos_id, pos_id, pos_id)
                            ).fetchone()
                        if not is_zupirus_trade and "ZUPIRUS" not in pos_comment and "ZP-" not in pos_comment:
                            continue

                        be_sl_key = f"be_sl_moved:{acc_id}:{pos_id}"
                        tp1_key = f"partial_tp1_executed:{acc_id}:{pos_id}"
                        legacy_be_key = f"be_executed:{acc_id}:{pos_id}"

                        with tx() as c:
                            be_sl_done = bool(getkv(c, be_sl_key) or getkv(c, legacy_be_key))
                            tp1_done = bool(getkv(c, tp1_key) or getkv(c, legacy_be_key))

                        pos_type = pos.get("type", "POSITION_TYPE_BUY")
                        volume = float(pos.get("volume", 0.01))
                        open_price = float(pos.get("openPrice") or 0.0)
                        current_price = float(pos.get("currentPrice") or open_price)
                        sl = float(pos.get("stopLoss") or 0.0)

                        if open_price <= 0 or sl <= 0:
                            continue

                        is_buy = "BUY" in pos_type.upper()
                        # Check if SL on broker is already at or better than open_price
                        sl_already_at_be = (is_buy and sl >= open_price) or (not is_buy and sl > 0 and sl <= open_price)
                        if sl_already_at_be and not be_sl_done:
                            with tx() as c:
                                setkv(c, be_sl_key, "1")
                            be_sl_done = True

                        if be_sl_done and (tp1_done or volume < 0.02):
                            continue

                        risk_distance = abs(open_price - sl)
                        if risk_distance <= 0 and not be_sl_done:
                            continue

                        profit_distance = (current_price - open_price) if is_buy else (open_price - current_price)

                        # Trigger only when reached >= 1R profit
                        if risk_distance > 0 and profit_distance >= risk_distance:
                            from app.services.symbol_precision import digits_for_symbol, pip_size_for_symbol, quote_to_usd_rate
                            pos_sym = str(pos.get("symbol") or "XAUUSD").upper()
                            buffer = pip_size_for_symbol(pos_sym)
                            pos_dec = digits_for_symbol(pos_sym)
                            new_sl = round(open_price + buffer if is_buy else open_price - buffer, pos_dec)
                            modify_ok = be_sl_done
                            partial_ok = tp1_done
                            modify_res = None
                            partial_res = None

                            # Step 1 (Safe Order): Move SL to Break-Even FIRST
                            if not be_sl_done:
                                modify_res = await self.client.modify_position_sl(meta_id, pos_id, new_sl, symbol=pos_sym)
                                modify_ok = _is_metaapi_success(modify_res)
                                if modify_ok:
                                    with tx() as c:
                                        setkv(c, be_sl_key, "1")
                                    results["be_sl_moved"] += 1

                            # Step 2: Only after SL is safe at BE, close 50% partial volume if volume >= 0.02
                            if modify_ok and not tp1_done:
                                if volume >= 0.02:
                                    half_volume = round(volume / 2.0, 2)
                                    partial_res = await self.client.close_partial_position(meta_id, pos_id, half_volume)
                                    partial_ok = _is_metaapi_success(partial_res)
                                    if partial_ok:
                                        with tx() as c:
                                            setkv(c, tp1_key, "1")
                                            setkv(c, legacy_be_key, "1")
                                            try:
                                                from app.hindsight import reflect_on_signal_outcome
                                                ex_row = c.execute(
                                                    "SELECT signal_id FROM metaapi_trade_executions WHERE account_id = ? AND (position_id = ? OR order_id = ?) ORDER BY executed_at DESC LIMIT 1",
                                                    (acc_id, pos_id, pos_id),
                                                ).fetchone()
                                                if ex_row and ex_row[0]:
                                                    from app.services.symbol_precision import contract_size_for_symbol
                                                    is_cent = str(acc.get("account_type") or "").upper() == "CENT"
                                                    contract_mult = contract_size_for_symbol(
                                                        pos_sym,
                                                        is_cent=is_cent,
                                                        account_contract_size=float(acc.get("contract_size") or 100.0),
                                                    )
                                                    usd_conv = quote_to_usd_rate(pos_sym, current_price)
                                                    realized_usd = abs(current_price - open_price) * half_volume * contract_mult * usd_conv
                                                    reflect_on_signal_outcome(c, signal_id=ex_row[0], pnl=round(realized_usd, 2), exit_price=current_price, exit_reason="PARTIAL_TP1")
                                            except Exception:
                                                pass
                                        results["partial_tp_executed"] += 1
                                else:
                                    # Volume < 0.02 cannot be split; mark complete once BE SL is moved
                                    partial_ok = True
                                    with tx() as c:
                                        setkv(c, tp1_key, "SKIPPED_MIN_VOL")
                                        setkv(c, legacy_be_key, "1")

                            if modify_ok or partial_ok:
                                with tx() as c:
                                    audit(c, "watcher", "auto_be_partial_tp", {
                                        "account_id": acc_id,
                                        "position_id": pos_id,
                                        "symbol": pos.get("symbol", "XAUUSD"),
                                        "open_price": open_price,
                                        "new_sl": new_sl,
                                        "partial_success": partial_ok,
                                        "modify_success": modify_ok,
                                        "partial_res": partial_res,
                                        "modify_res": modify_res
                                    })
                                results["details"].append({
                                    "account_id": acc_id,
                                    "position_id": pos_id,
                                    "action": "AUTO_BE_PARTIAL_TP_1R",
                                    "partial_ok": partial_ok,
                                    "modify_ok": modify_ok
                                })

                # 5. Periodic Closed Deal History Sync (every 60s per account) for real PnL reflection
                try:
                    with tx() as c:
                        last_ds = getkv(c, f"deals_sync_ts:{acc_id}")
                        should_sync_deals = not last_ds or (time.time() - float(last_ds)) >= 60.0
                    if should_sync_deals and hasattr(self.client, "get_closed_deals"):
                        deals = await self.client.get_closed_deals(meta_id, hours=24)
                        with tx() as c:
                            setkv(c, f"deals_sync_ts:{acc_id}", str(time.time()))
                            for dl in deals or []:
                                if str(dl.get("entryType") or "").upper() not in ("DEAL_ENTRY_OUT", "DEAL_ENTRY_OUT_BY", ""):
                                    continue
                                dl_id = str(dl.get("id") or "")
                                if not dl_id or getkv(c, f"deal_synced:{dl_id}"):
                                    continue
                                profit = float(dl.get("profit") or 0.0) + float(dl.get("swap") or 0.0) + float(dl.get("commission") or 0.0)
                                pos_ref = str(dl.get("positionId") or dl.get("orderId") or "")
                                if pos_ref:
                                    ex_row = c.execute(
                                        "SELECT signal_id FROM metaapi_trade_executions WHERE account_id = ? AND (position_id = ? OR order_id = ?) ORDER BY executed_at DESC LIMIT 1",
                                        (acc_id, pos_ref, pos_ref),
                                    ).fetchone()
                                    if ex_row and ex_row[0]:
                                        from app.hindsight import reflect_on_signal_outcome
                                        reflect_on_signal_outcome(
                                            c,
                                            signal_id=ex_row[0],
                                            pnl=round(profit, 2),
                                            exit_price=float(dl.get("price") or 0.0),
                                            exit_reason="BROKER_DEAL_CLOSED",
                                        )
                                        setkv(c, f"deal_synced:{dl_id}", "1")
                except Exception as ds_err:
                    logger.debug(f"Deal history sync note for {acc_id}: {ds_err}")

            except Exception as e:
                logger.error(f"Error watching positions for account {acc_id}: {e}")

        return results


# Global singleton instance
_watcher_instance: Optional[PositionWatcher] = None


def get_position_watcher() -> PositionWatcher:
    global _watcher_instance
    if _watcher_instance is None:
        _watcher_instance = PositionWatcher()
    return _watcher_instance
