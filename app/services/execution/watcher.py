"""Runtime Position Watcher & Real-Time Risk Protection Engine.
Monitors all open positions across user MetaApi terminals:
1. Auto Break-Even & Partial TP (50% TP1) at 1R profit milestone for Growth & Alpha accounts.
2. Prop Firm Pass Guard:
   - Real-time Daily Drawdown circuit breaker (auto-close all & lock at 4.5% drawdown).
   - Friday 21:00 UTC weekend holding closure (strictly avoids gap risk on prop accounts).
"""
import time
import json
import logging
import datetime
from typing import Dict, Any, List, Optional
from app.db import tx, audit, setkv, getkv
from app.metaapi import MetaApiClient

logger = logging.getLogger("zupirus.watcher")

def _is_metaapi_success(res: Optional[Dict[str, Any]]) -> bool:
    if not res or not isinstance(res, dict):
        return False
    if "error" in res or "numericCode" in res or "stringCode" in res:
        return False
    return True

MAX_PROP_DAILY_DRAWDOWN_PCT = 4.5
WEEKEND_CLOSE_FRIDAY_HOUR_UTC = 21


class PositionWatcher:
    """Active runtime position monitor for all deployed trading terminals."""

    def __init__(self, metaapi_client: Optional[MetaApiClient] = None):
        self.client = metaapi_client or MetaApiClient()

    async def run_cycle(self, now_dt: Optional[datetime.datetime] = None) -> Dict[str, Any]:
        """Execute one complete monitoring and protection pass across all active accounts."""
        now_utc = now_dt or datetime.datetime.now(datetime.timezone.utc)
        date_str = now_utc.strftime("%Y-%m-%d")
        is_friday_weekend = (now_utc.weekday() == 4 and now_utc.hour >= WEEKEND_CLOSE_FRIDAY_HOUR_UTC)

        with tx() as c:
            # Query deployed accounts with auto_trade enabled and associated plan tier
            accounts = c.execute(
                """
                SELECT t.id, t.user_id, t.metaapi_account_id, t.auto_trade,
                       t.balance, t.equity, t.risk_config,
                       t.is_prop_firm_mode, t.prop_daily_dd_limit_pct, t.prop_profit_target_pct,
                       COALESCE(s.plan_tier, 'starter') AS plan_tier
                FROM trading_accounts t
                LEFT JOIN subscriptions s ON t.user_id = s.user_id
                WHERE t.auto_trade = 1 AND t.metaapi_account_id IS NOT NULL
                """
            ).fetchall()

        results = {
            "timestamp": now_utc.isoformat(),
            "accounts_checked": len(accounts),
            "partial_tp_executed": 0,
            "prop_breakers_triggered": 0,
            "weekend_closes_triggered": 0,
            "details": []
        }

        for raw_acc in accounts:
            acc = dict(raw_acc)
            acc_id = acc["id"]
            meta_id = acc["metaapi_account_id"]
            plan_tier = (acc.get("plan_tier") or "starter").lower()
            is_prop = bool(acc.get("is_prop_firm_mode")) or plan_tier in ("alpha", "prop")
            prop_dd_limit = float(acc.get("prop_daily_dd_limit_pct") or MAX_PROP_DAILY_DRAWDOWN_PCT)

            try:
                # 1. Fetch live account info
                acc_info = await self.client.get_account_information(meta_id)
                current_equity = float(acc_info.get("equity") if acc_info.get("equity") is not None else (acc.get("equity") or 0.0))
                current_balance = float(acc_info.get("balance") if acc_info.get("balance") is not None else (acc.get("balance") or 0.0))

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

                # 2. Prop Firm Daily Drawdown Check (Circuit Breaker)
                if is_prop and day_start_balance > 0:
                    drawdown_pct = ((day_start_balance - current_equity) / day_start_balance) * 100.0
                    if drawdown_pct >= prop_dd_limit:
                        logger.warning(
                            f"PROP FIRM BREACH: Account {acc_id} daily DD reached {drawdown_pct:.2f}% >= {prop_dd_limit:.2f}%. "
                            f"Emergency closing all positions."
                        )
                        close_res = await self.client.close_all_positions(meta_id)
                        with tx() as c:
                            c.execute("UPDATE trading_accounts SET auto_trade = 0 WHERE id = ?", (acc_id,))
                            setkv(c, f"prop_dd_halt:{acc_id}:{date_str}", f"DRAWDOWN_LIMIT_{drawdown_pct:.2f}")
                            audit(c, "prop_guard", "circuit_breaker_triggered", {
                                "account_id": acc_id,
                                "drawdown_pct": round(drawdown_pct, 2),
                                "day_start_balance": day_start_balance,
                                "equity": current_equity,
                                "close_result": close_res
                            })
                        results["prop_breakers_triggered"] += 1
                        results["details"].append({"account_id": acc_id, "action": "PROP_CIRCUIT_BREAKER_LOCKED"})
                        continue

                # 3. Friday 21:00 UTC Weekend Risk Close (Avoid holding over weekend for prop accounts)
                if is_prop and is_friday_weekend:
                    positions = await self.client.get_open_positions(meta_id)
                    if positions:
                        logger.info(f"WEEKEND CLOSE: Account {acc_id} closing {len(positions)} positions before Friday close.")
                        close_res = await self.client.close_all_positions(meta_id)
                        with tx() as c:
                            audit(c, "weekend_guard", "friday_weekend_close", {
                                "account_id": acc_id,
                                "positions_closed": len(positions),
                                "time_utc": now_utc.isoformat(),
                                "close_result": close_res
                            })
                        results["weekend_closes_triggered"] += 1
                        results["details"].append({"account_id": acc_id, "action": "FRIDAY_WEEKEND_POSITIONS_CLOSED"})
                        continue

                # 4. Auto Break-Even & Partial TP (50% TP1) at 1R for Growth and Alpha
                allow_auto_be = plan_tier in ("growth", "alpha")
                if allow_auto_be:
                    positions = await self.client.get_open_positions(meta_id)
                    for pos in positions:
                        pos_id = str(pos.get("id", ""))
                        if not pos_id:
                            continue

                        # Check origin: only touch ZUPIRUS automated orders
                        pos_comment = str(pos.get("comment") or "").upper()
                        with tx() as c:
                            is_zupirus_trade = c.execute(
                                "SELECT id FROM metaapi_trade_executions WHERE account_id = ? AND (position_id = ? OR order_id = ? OR id = ?)",
                                (acc_id, pos_id, pos_id, pos_id)
                            ).fetchone()
                        if not is_zupirus_trade and "ZUPIRUS" not in pos_comment and "ZP-" not in pos_comment:
                            continue

                        # Check if BE already executed for this position
                        be_key = f"be_executed:{acc_id}:{pos_id}"
                        with tx() as c:
                            already_done = getkv(c, be_key)
                        if already_done:
                            continue

                        pos_type = pos.get("type", "POSITION_TYPE_BUY")
                        volume = float(pos.get("volume", 0.01))
                        open_price = float(pos.get("openPrice") or 0.0)
                        current_price = float(pos.get("currentPrice") or open_price)
                        sl = float(pos.get("stopLoss") or 0.0)

                        if open_price <= 0 or sl <= 0 or volume < 0.02:
                            continue

                        # 1R milestone calculation
                        is_buy = "BUY" in pos_type.upper()
                        risk_distance = abs(open_price - sl)
                        if risk_distance <= 0:
                            continue

                        profit_distance = (current_price - open_price) if is_buy else (open_price - current_price)

                        # Trigger if reached 1R
                        if profit_distance >= risk_distance:
                            half_volume = round(volume / 2.0, 2)
                            buffer = 0.10  # 1 pip spread buffer
                            new_sl = round(open_price + buffer if is_buy else open_price - buffer, 2)

                            logger.info(
                                f"1R REACHED: Position {pos_id} on Account {acc_id} (+{profit_distance:.2f} >= {risk_distance:.2f}). "
                                f"Closing 50% ({half_volume} lots) and moving SL to BE ({new_sl})."
                            )

                            # Partial close 50%
                            partial_res = await self.client.close_partial_position(meta_id, pos_id, half_volume)
                            # Move SL of remaining to BE
                            modify_res = await self.client.modify_position_sl(meta_id, pos_id, new_sl)

                            # Verify operations with robust MetaApi error checking
                            partial_ok = _is_metaapi_success(partial_res)
                            modify_ok = _is_metaapi_success(modify_res)

                            # Only mark BE as completed if the Stop-Loss modification was successful
                            # If partial close succeeded but modify failed, don't lock BE yet so next cycle can retry modify SL
                            if modify_ok:
                                with tx() as c:
                                    setkv(c, be_key, "1")
                                    audit(c, "watcher", "auto_be_partial_tp", {
                                        "account_id": acc_id,
                                        "position_id": pos_id,
                                        "symbol": pos.get("symbol", "XAUUSD"),
                                        "open_price": open_price,
                                        "closed_volume": half_volume,
                                        "new_sl": new_sl,
                                        "partial_success": partial_ok,
                                        "modify_success": modify_ok,
                                        "partial_res": partial_res,
                                        "modify_res": modify_res
                                    })

                                results["partial_tp_executed"] += 1
                                results["details"].append({
                                    "account_id": acc_id,
                                    "position_id": pos_id,
                                    "action": "AUTO_BE_PARTIAL_TP_1R",
                                    "partial_ok": partial_ok,
                                    "modify_ok": modify_ok
                                })
                            else:
                                logger.warning(
                                    f"Failed Auto-BE/Partial TP on position {pos_id}: partial={partial_res}, modify={modify_res}"
                                )

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
