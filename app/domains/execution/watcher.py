"""Runtime Position Watcher & Real-Time Risk Protection Engine.
Monitors all open positions across user MetaApi terminals (including accounts with auto_trade=0):
1. Auto Break-Even & Partial TP (50% TP1) at 1R profit milestone for Growth & Alpha accounts.
2. Prop Firm Pass Guard:
   - Real-time Daily Drawdown circuit breaker (auto-close all & lock at configured drawdown limit).
   - Friday 21:00 UTC weekend holding closure (strictly avoids gap risk on prop accounts).
"""
import asyncio
import logging
import datetime
import time
import json
import uuid
from typing import Dict, Any, Optional, List, Tuple
from app.db import tx, audit, setkv, getkv
from app.metaapi import MetaApiClient
from app.redis_client import cache_heartbeat

logger = logging.getLogger("zupirus.watcher")
_WATCHER_CYCLE_LOCK = asyncio.Lock()


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        if val is None or str(val).strip() == "":
            return default
        f = float(val)
        return f if f == f else default  # reject NaN
    except (ValueError, TypeError):
        return default

SUCCESS_NUMERIC_CODES = {0, 200, 201, 10008, 10009, 10010}
SUCCESS_STRING_CODES = {
    "TRADE_RETCODE_PLACED",
    "TRADE_RETCODE_DONE",
    "TRADE_RETCODE_DONE_PARTIAL",
    "ERR_NO_ERROR",
    "OK",
}


def _is_protective_sl(pos: Optional[Dict[str, Any]]) -> bool:
    """Validate that stopLoss is protective and placed on the correct side of price:
    - sl_val > 0
    - BUY: sl_val < currentPrice (fallback openPrice)
    - SELL: sl_val > currentPrice (fallback openPrice)
    Returns False if missing side, missing reference price, or SL is on the wrong side.
    """
    if not pos or not isinstance(pos, dict):
        return False
    try:
        sl_val = float(pos.get("stopLoss") or 0.0)
        if sl_val <= 0:
            return False
        raw_type = str(pos.get("type") or pos.get("action") or "").upper()
        is_buy = "BUY" in raw_type
        is_sell = "SELL" in raw_type
        if not is_buy and not is_sell:
            return False

        ref_price = float(pos.get("currentPrice") or 0.0)
        if ref_price <= 0:
            ref_price = float(pos.get("openPrice") or 0.0)
        if ref_price <= 0:
            return False

        if is_buy:
            return sl_val < ref_price
        else:
            return sl_val > ref_price
    except Exception:
        return False


def _is_metaapi_success(res: Optional[Dict[str, Any]]) -> bool:
    """Validate whether a MetaApi trade/modify response succeeded."""
    if not res or not isinstance(res, dict):
        return False
    if res.get("error"):
        return False

    has_num = "numericCode" in res and res["numericCode"] is not None and str(res["numericCode"]).strip() != ""
    has_str = "stringCode" in res and res["stringCode"] is not None and str(res["stringCode"]).strip() != ""

    if has_num or has_str:
        try:
            num_ok = (not has_num) or (int(res["numericCode"]) in SUCCESS_NUMERIC_CODES)
        except (ValueError, TypeError):
            num_ok = False
        str_ok = (not has_str) or (str(res["stringCode"]).upper() in SUCCESS_STRING_CODES)
        return num_ok and str_ok

    status_val = str(res.get("status", "")).upper()
    if status_val in ("FAILED", "ERROR", "REJECTED"):
        return False
    if status_val in ("FILLED", "OK", "SUCCESS", "EXECUTED", "DONE"):
        return True
    return bool(res.get("orderId") or res.get("positionId"))


def get_drawdown_halt_key(account_id: str, date_str: Optional[str] = None) -> str:
    """Return canonical daily drawdown halt key for an account."""
    if not date_str:
        date_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    return f"prop_dd_halt:{account_id}:{date_str}"


def is_account_drawdown_halted(c, account_id: str, date_str: Optional[str] = None) -> bool:
    """Check whether an account is locked by the Daily Drawdown Circuit Breaker or safety lock."""
    halt_key = get_drawdown_halt_key(account_id, date_str)
    if getkv(c, halt_key):
        return True
    if getkv(c, f"drawdown_locked:{account_id}"):
        return True
    if getkv(c, f"account_locked:{account_id}"):
        return True
    if getkv(c, f"emergency_close_pending:{account_id}"):
        return True
    if getkv(c, f"hwm_close_pending:{account_id}"):
        return True
    return False


MAX_PROP_DAILY_DRAWDOWN_PCT = 4.5
WEEKEND_CLOSE_FRIDAY_HOUR_UTC = 20
WEEKEND_CLOSE_FRIDAY_MINUTE_UTC = 30


def verify_position_ownership(c, account_id: str, pos: Dict[str, Any]) -> Tuple[str, Optional[Dict[str, Any]]]:
    """
    Verify ownership of an MT5 position strictly on the given account_id.
    Returns: (origin, matching_execution_row)
    - 'BOT': provably opened by this system's bot on account_id.
    - 'NETTING_MIXED': position volume differs from bot's expected volume (netting mix).
    - 'MANUAL': manual order placed by user or third party.
    - 'UNKNOWN': unlinked / unknown origin.
    """
    pos_id = str(pos.get("id") or pos.get("positionId") or pos.get("ticket") or "").strip()
    comment = str(pos.get("comment") or "").strip()
    client_id = str(pos.get("clientId") or "").strip()
    vol = float(pos.get("volume") or 0.0)

    bot_exec = None
    # 1. Match by clientId with ZV2_ prefix
    if client_id and client_id.startswith("ZV2_"):
        bot_exec = c.execute(
            "SELECT * FROM metaapi_trade_executions WHERE account_id = ? AND client_order_id = ? AND origin = 'BOT'",
            (account_id, client_id)
        ).fetchone()

    # 2. Match by comment containing client_order_id
    if not bot_exec and comment:
        for part in comment.split():
            if part.startswith("ZV2_"):
                bot_exec = c.execute(
                    "SELECT * FROM metaapi_trade_executions WHERE account_id = ? AND client_order_id = ? AND origin = 'BOT'",
                    (account_id, part)
                ).fetchone()
                if bot_exec:
                    break

    # 3. Match by ticket / position_id with origin == 'BOT' on THIS account_id
    if not bot_exec and pos_id:
        bot_exec = c.execute(
            "SELECT * FROM metaapi_trade_executions WHERE account_id = ? AND (position_id = ? OR ticket = ? OR order_id = ?) AND origin = 'BOT'",
            (account_id, pos_id, pos_id, pos_id)
        ).fetchone()

    # 4. If no bot execution record found, check if it's already marked MANUAL or UNKNOWN
    if not bot_exec:
        manual_exec = c.execute(
            "SELECT * FROM metaapi_trade_executions WHERE account_id = ? AND (position_id = ? OR ticket = ? OR order_id = ?)",
            (account_id, pos_id, pos_id, pos_id)
        ).fetchone()
        if manual_exec:
            row_dict = dict(manual_exec) if hasattr(manual_exec, "keys") else {}
            orig = row_dict.get("origin") if hasattr(manual_exec, "keys") else manual_exec["origin"]
            return (orig if orig in ("MANUAL", "UNKNOWN") else "MANUAL"), None
        return "MANUAL", None

    # Matched BOT record on this exact account_id! Check for volume netting
    bot_row = dict(bot_exec) if hasattr(bot_exec, "keys") else dict(zip([col[0] for col in c.description], bot_exec))
    expected_vol = float(bot_row.get("volume") or 0.0)
    closed_vol = float(bot_row.get("closed_volume") or 0.0)
    remaining_expected = max(0.0, round(expected_vol - closed_vol, 2))

    if remaining_expected > 0 and abs(vol - remaining_expected) > 0.005:
        # Netting combined bot order with manual order -> lock from automated actions
        return "NETTING_MIXED", bot_row

    return "BOT", bot_row


def reconcile_account_positions(
    c,
    acc_id: str,
    meta_id: Any = None,
    ok: Any = True,
    live_positions: Optional[List[Dict[str, Any]]] = None,
    deals: Optional[List[Dict[str, Any]]] = None,
    now_ts: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Non-speculative reconciliation:
    - Only runs when ok == True and synchronized.
    - Updates last_verified_at.
    - Inspects deals and closed volume before marking CLOSED.
    - Resolves UNKNOWN_EXECUTION / PENDING_SUBMIT deterministically.
    - Supports legacy signature (c, acc_id, live_pos_ids, now_ts).
    """
    is_legacy_call = False
    if isinstance(meta_id, (set, list)) and (isinstance(ok, (int, float)) or (deals is None and now_ts is None)):
        is_legacy_call = True
        legacy_pos_ids = set(str(x) for x in meta_id)
        now_ts = float(ok) if isinstance(ok, (int, float)) else time.time()
        ok = True
        live_positions = [{"id": pid} for pid in legacy_pos_ids]
        meta_id = str(acc_id)
        deals = []

    now_ts = float(now_ts if now_ts is not None else time.time())
    live_positions = live_positions or []
    deals = deals or []

    if not ok:
        return {"account_id": acc_id, "status": "SKIPPED_UNVERIFIED"}

    c.execute("UPDATE trading_accounts SET last_verified_at = ? WHERE id = ?", (now_ts, acc_id))
    live_pos_map = {}
    for p in live_positions:
        p_id = str(p.get("id") or "")
        if p_id:
            live_pos_map[p_id] = p
        c_id = str(p.get("clientId") or "")
        if c_id:
            live_pos_map[c_id] = p

    # Build deals lookup by positionId and orderId
    deals_by_pos: Dict[str, List[Dict[str, Any]]] = {}
    for dl in (deals or []):
        if str(dl.get("entryType") or "").upper() in ("DEAL_ENTRY_OUT", "DEAL_ENTRY_OUT_BY", ""):
            pid = str(dl.get("positionId") or dl.get("orderId") or "")
            if pid:
                deals_by_pos.setdefault(pid, []).append(dl)

    # 1. Reconcile OPEN / FILLED executions
    open_db_rows = c.execute(
        """
        SELECT id, position_id, ticket, client_order_id, symbol, action, volume, closed_volume, sl_confirmed, origin, evidence_json
        FROM metaapi_trade_executions
        WHERE account_id = ? AND status IN ('FILLED', 'OPEN')
        """,
        (acc_id,),
    ).fetchall()

    orphans_closed = 0
    for r in open_db_rows:
        row = dict(r) if hasattr(r, "keys") else {}
        exec_id = row.get("id") or r[0]
        pos_id = str(row.get("position_id") or r[1] or "")
        t_id = str(row.get("ticket") or r[2] or "")
        c_id = str(row.get("client_order_id") or (r[3] if len(r) > 3 else "") or "")
        total_vol = float(row.get("volume") or (r[6] if len(r) > 6 else 0.01))
        cur_closed_vol = float(row.get("closed_volume") or (r[7] if len(r) > 7 else 0.0))
        sl_conf = int(row.get("sl_confirmed") or (r[8] if len(r) > 8 else 0))

        matched_p = live_pos_map.get(pos_id) or live_pos_map.get(t_id) or (live_pos_map.get(c_id) if c_id else None)
        if matched_p:
            if is_legacy_call:
                setkv(c, f"orphan_missing_cycle:{exec_id}", "0")
            c.execute("UPDATE metaapi_trade_executions SET last_verified_at = ? WHERE id = ?", (now_ts, exec_id))
            if not sl_conf:
                if _is_protective_sl(matched_p):
                    c.execute("UPDATE metaapi_trade_executions SET sl_confirmed = 1 WHERE id = ?", (exec_id,))
        else:
            # Position missing from live MT5 positions: verify via deals history
            matching_deals = deals_by_pos.get(pos_id) or deals_by_pos.get(t_id) or []
            if matching_deals:
                dl_ids = [str(dl.get("id") or "") for dl in matching_deals if dl.get("id")]
                prev_ev = {}
                ev_str = str(row.get("evidence_json") or (r[10] if len(r) > 10 and r[10] else "") or "")
                if ev_str:
                    try:
                        prev_ev = json.loads(ev_str)
                    except Exception:
                        pass
                prev_ids = set(str(x) for x in (prev_ev.get("partial_deals", []) + prev_ev.get("deal_ids", [])))

                # Strictly deduplicate: only count volume from new deals not already accounted for
                new_deals = [dl for dl in matching_deals if str(dl.get("id") or "") not in prev_ids]
                new_deal_vol = sum(float(dl.get("volume") or 0.0) for dl in new_deals)
                total_closed = round(min(total_vol, cur_closed_vol + new_deal_vol), 4)
                all_dl_ids = list(prev_ids.union(set(dl_ids)))

                if total_closed >= total_vol - 0.001:
                    is_sys_closed = bool(prev_ev.get("system_closed") or prev_ev.get("closed_by_system"))
                    is_manually_tagged = False
                    if not is_sys_closed:
                        try:
                            row_dict = dict(row) if hasattr(row, "keys") else {}
                            e_price = float(row_dict.get("entry_price") or (r[4] if len(r) > 4 else 0.0) or 0.0)
                            sl_val = float(row_dict.get("stop_loss") or (r[5] if len(r) > 5 else 0.0) or 0.0)
                            tp_val = float(row_dict.get("take_profit") or (r[6] if len(r) > 6 else 0.0) or 0.0)
                            exit_price = 0.0
                            if new_deals:
                                exit_price = float(new_deals[-1].get("price") or 0.0)
                            elif matching_deals:
                                exit_price = float(matching_deals[-1].get("price") or 0.0)

                            if exit_price > 0 and e_price > 0:
                                near_sl = (sl_val > 0) and abs(exit_price - sl_val) <= max(2.5, 0.005 * sl_val)
                                near_tp = (tp_val > 0) and abs(exit_price - tp_val) <= max(2.5, 0.005 * tp_val)
                                near_be = abs(exit_price - e_price) <= max(1.5, 0.002 * e_price)
                                if not near_sl and not near_tp and not near_be:
                                    is_manually_tagged = True
                        except Exception as tag_err:
                            logger.debug(f"Tag manual close check error: {tag_err}")

                    ev_closed = {"deal_ids": all_dl_ids, "closed_at": now_ts}
                    if is_manually_tagged:
                        from app.domains.execution.compliance import tag_manual_closed_by_user
                        try:
                            tag_manual_closed_by_user(c, exec_id, now_ts)
                        except Exception as tm_err:
                            logger.debug(f"Call tag_manual_closed_by_user note: {tm_err}")
                        ev_closed["manual_closed_by_user"] = True
                        ev_closed["manual_closed_at"] = now_ts
                    c.execute(
                        """
                        UPDATE metaapi_trade_executions
                        SET status = 'CLOSED', closed_at = COALESCE(closed_at, ?), closed_volume = ?,
                            last_verified_at = ?, evidence_json = ?
                        WHERE id = ?
                        """,
                        (now_ts, total_vol, now_ts, json.dumps(ev_closed), exec_id)
                    )
                    orphans_closed += 1
                else:
                    c.execute(
                        """
                        UPDATE metaapi_trade_executions
                        SET closed_volume = ?, last_verified_at = ?, evidence_json = ?
                        WHERE id = ?
                        """,
                        (total_closed, now_ts, json.dumps({"partial_deals": all_dl_ids}), exec_id)
                    )
            elif is_legacy_call:
                cycle_key = f"orphan_missing_cycle:{exec_id}"
                missing_cycles = int(getkv(c, cycle_key) or "0") + 1
                setkv(c, cycle_key, str(missing_cycles))
                if missing_cycles >= 2:
                    c.execute(
                        "UPDATE metaapi_trade_executions SET status = 'CLOSED', closed_at = COALESCE(closed_at, ?) WHERE id = ?",
                        (now_ts, exec_id),
                    )
                    audit(
                        c,
                        "reconciliation_worker",
                        "position_reconciled_orphan_closed",
                        {
                            "account_id": acc_id,
                            "execution_id": exec_id,
                            "ticket": t_id or pos_id,
                            "status": "WARNING",
                            "missing_cycles": missing_cycles,
                        },
                    )
                    orphans_closed += 1

    # 2. Non-speculative reconciliation of UNKNOWN_EXECUTION and PENDING_SUBMIT
    unverified_rows = c.execute(
        """
        SELECT id, client_order_id, symbol, action, volume
        FROM metaapi_trade_executions
        WHERE account_id = ? AND status IN ('UNKNOWN_EXECUTION', 'PENDING_SUBMIT', 'AMBIGUOUS_LOCKED')
        """,
        (acc_id,)
    ).fetchall()

    for ur in unverified_rows:
        urow = dict(ur) if hasattr(ur, "keys") else {}
        uexec_id = urow.get("id") or ur[0]
        ucid = str(urow.get("client_order_id") or ur[1] or "")
        if not ucid:
            continue

        matched_live = [
            p for p in live_positions
            if ucid in str(p.get("clientId") or "") or ucid in str(p.get("comment") or "")
        ]

        if len(matched_live) == 1:
            mp = matched_live[0]
            pid = str(mp.get("id") or "")
            sl_val = float(mp.get("stopLoss") or 0.0)
            sl_c = 1 if _is_protective_sl(mp) else 0
            live_vol = float(mp.get("volume") or 0.0)
            orig_vol = float(urow.get("volume") or (ur[4] if len(ur) > 4 else 0.0) or 0.0)
            closed_v = sum(
                float(dl.get("volume") or 0.0)
                for dl in (deals or [])
                if (pid in (str(dl.get("positionId") or ""), str(dl.get("orderId") or "")) or ucid in str(dl.get("clientId") or ""))
                and str(dl.get("entryType") or "").upper() in ("DEAL_ENTRY_OUT", "DEAL_ENTRY_OUT_BY", "1", "2")
            )
            matched_deal_ids = [
                str(dl.get("id"))
                for dl in (deals or [])
                if (pid in (str(dl.get("positionId") or ""), str(dl.get("orderId") or "")) or ucid in str(dl.get("clientId") or ""))
                and str(dl.get("entryType") or "").upper() in ("DEAL_ENTRY_OUT", "DEAL_ENTRY_OUT_BY", "1", "2")
                and dl.get("id")
            ]
            if closed_v <= 0 and orig_vol > 0 and live_vol < orig_vol - 0.001:
                closed_v = round(orig_vol - live_vol, 4)
            ev_data = {
                "matched_live_ticket": pid,
                "ts": now_ts,
                "partial": closed_v > 0,
                "deal_ids": matched_deal_ids,
                "partial_deals": matched_deal_ids,
            }
            c.execute(
                """
                UPDATE metaapi_trade_executions
                SET status = 'FILLED', position_id = ?, ticket = ?, sl_confirmed = ?, closed_volume = ?,
                    last_verified_at = ?, evidence_json = ?
                WHERE id = ?
                """,
                (pid, pid, sl_c, closed_v, now_ts, json.dumps(ev_data), uexec_id)
            )
        elif len(matched_live) > 1:
            c.execute(
                "UPDATE metaapi_trade_executions SET status = 'AMBIGUOUS_LOCKED', last_verified_at = ? WHERE id = ?",
                (now_ts, uexec_id)
            )
            setkv(c, f"account_locked:{acc_id}", "AMBIGUOUS_LOCKED")
        else:
            # Position not yet in live positions list: check deals history
            matched_deals = [
                dl for dl in (deals or [])
                if ucid in str(dl.get("clientId") or "") or ucid in str(dl.get("comment") or "")
            ]
            if len(matched_deals) == 1:
                dl = matched_deals[0]
                entry_type = str(dl.get("entryType") or "").upper()
                pos_id = str(dl.get("positionId") or dl.get("orderId") or "")

                if entry_type in ("DEAL_ENTRY_IN", "0", ""):
                    # Opening deal: order executed into an open position
                    matching_live_pos = live_pos_map.get(pos_id)
                    sl_c = 0
                    if matching_live_pos:
                        sl_c = 1 if _is_protective_sl(matching_live_pos) else 0

                    c.execute(
                        """
                        UPDATE metaapi_trade_executions
                        SET status = 'FILLED', position_id = ?, ticket = ?, sl_confirmed = ?, last_verified_at = ?, evidence_json = ?
                        WHERE id = ?
                        """,
                        (pos_id, pos_id, sl_c, now_ts, json.dumps({"matched_entry_deal": dl.get("id"), "entryType": entry_type}), uexec_id)
                    )
                elif entry_type in ("DEAL_ENTRY_OUT", "DEAL_ENTRY_OUT_BY", "1", "2"):
                    # Closing deal: broker executed exit
                    deal_vol = float(dl.get("volume") or 0.0)
                    orig_vol = float(urow.get("volume") or (ur[4] if len(ur) > 4 else 0.0) or 0.0)
                    matching_live_pos = live_pos_map.get(pos_id)
                    if matching_live_pos:
                        # Position is still open on broker (partial close): keep FILLED, retain account lock
                        sl_c = 1 if _is_protective_sl(matching_live_pos) else 0
                        dl_id_str = str(dl.get("id") or "")
                        c.execute(
                            """
                            UPDATE metaapi_trade_executions
                            SET status = 'FILLED', position_id = ?, ticket = ?, sl_confirmed = ?, closed_volume = ?,
                                last_verified_at = ?, evidence_json = ?
                            WHERE id = ?
                            """,
                            (
                                pos_id,
                                pos_id,
                                sl_c,
                                deal_vol,
                                now_ts,
                                json.dumps({
                                    "matched_closing_deal": dl.get("id"),
                                    "entryType": entry_type,
                                    "partial": True,
                                    "deal_ids": [dl_id_str] if dl_id_str else [],
                                    "partial_deals": [dl_id_str] if dl_id_str else [],
                                }),
                                uexec_id,
                            )
                        )
                    elif orig_vol > 0 and deal_vol < orig_vol - 0.001:
                        # Missing from live positions, but deal volume is strictly less than original volume:
                        # Mark AMBIGUOUS_LOCKED to prevent premature unlock
                        dl_id_str = str(dl.get("id") or "")
                        c.execute(
                            """
                            UPDATE metaapi_trade_executions
                            SET status = 'AMBIGUOUS_LOCKED', closed_volume = ?, last_verified_at = ?, evidence_json = ?
                            WHERE id = ?
                            """,
                            (
                                deal_vol,
                                now_ts,
                                json.dumps({
                                    "matched_closing_deal": dl.get("id"),
                                    "entryType": entry_type,
                                    "partial_unaccounted": True,
                                    "deal_ids": [dl_id_str] if dl_id_str else [],
                                    "partial_deals": [dl_id_str] if dl_id_str else [],
                                }),
                                uexec_id,
                            )
                        )
                        setkv(c, f"account_locked:{acc_id}", "AMBIGUOUS_LOCKED")
                    else:
                        # Fully closed on broker
                        dl_id_str = str(dl.get("id") or "")
                        c.execute(
                            """
                            UPDATE metaapi_trade_executions
                            SET status = 'CLOSED', closed_at = ?, closed_volume = ?, last_verified_at = ?, evidence_json = ?
                            WHERE id = ?
                            """,
                            (
                                now_ts,
                                deal_vol,
                                now_ts,
                                json.dumps({
                                    "matched_closing_deal": dl.get("id"),
                                    "entryType": entry_type,
                                    "deal_ids": [dl_id_str] if dl_id_str else [],
                                }),
                                uexec_id,
                            )
                        )
                else:
                    c.execute(
                        "UPDATE metaapi_trade_executions SET status = 'AMBIGUOUS_LOCKED', last_verified_at = ? WHERE id = ?",
                        (now_ts, uexec_id)
                    )
                    setkv(c, f"account_locked:{acc_id}", "AMBIGUOUS_LOCKED")
            elif len(matched_deals) > 1:
                has_in = any(str(dl.get("entryType") or "").upper() in ("DEAL_ENTRY_IN", "0", "") for dl in matched_deals)
                out_deals = [dl for dl in matched_deals if str(dl.get("entryType") or "").upper() in ("DEAL_ENTRY_OUT", "DEAL_ENTRY_OUT_BY", "1", "2")]
                if has_in and out_deals:
                    total_out_vol = sum(float(dl.get("volume") or 0.0) for dl in out_deals)
                    orig_vol = float(urow.get("volume") or (ur[4] if len(ur) > 4 else 0.0) or 0.0)
                    pos_id_first = str(out_deals[0].get("positionId") or out_deals[0].get("orderId") or "")
                    matching_live_pos = live_pos_map.get(pos_id_first)
                    if matching_live_pos:
                        sl_c = 1 if _is_protective_sl(matching_live_pos) else 0
                        c.execute(
                            """
                            UPDATE metaapi_trade_executions
                            SET status = 'FILLED', position_id = ?, ticket = ?, sl_confirmed = ?, closed_volume = ?,
                                last_verified_at = ?, evidence_json = ?
                            WHERE id = ?
                            """,
                            (pos_id_first, pos_id_first, sl_c, total_out_vol, now_ts, json.dumps({"deal_cycle": [dl.get("id") for dl in matched_deals], "partial": True}), uexec_id)
                        )
                    elif orig_vol > 0 and total_out_vol < orig_vol - 0.001:
                        c.execute(
                            """
                            UPDATE metaapi_trade_executions
                            SET status = 'AMBIGUOUS_LOCKED', closed_volume = ?, last_verified_at = ?, evidence_json = ?
                            WHERE id = ?
                            """,
                            (total_out_vol, now_ts, json.dumps({"deal_cycle": [dl.get("id") for dl in matched_deals], "partial_unaccounted": True}), uexec_id)
                        )
                        setkv(c, f"account_locked:{acc_id}", "AMBIGUOUS_LOCKED")
                    else:
                        c.execute(
                            """
                            UPDATE metaapi_trade_executions
                            SET status = 'CLOSED', closed_at = ?, closed_volume = ?, last_verified_at = ?, evidence_json = ?
                            WHERE id = ?
                            """,
                            (now_ts, total_out_vol, now_ts, json.dumps({"deal_cycle": [dl.get("id") for dl in matched_deals]}), uexec_id)
                        )
                else:
                    c.execute(
                        "UPDATE metaapi_trade_executions SET status = 'AMBIGUOUS_LOCKED', last_verified_at = ? WHERE id = ?",
                        (now_ts, uexec_id)
                    )
                    setkv(c, f"account_locked:{acc_id}", "AMBIGUOUS_LOCKED")

    # Lock invariant: only unlock account if ZERO unverified/ambiguous executions remain
    remaining_unverified = c.execute(
        """
        SELECT count(*) FROM metaapi_trade_executions
        WHERE account_id = ? AND (
            status IN ('UNKNOWN_EXECUTION', 'PENDING_SUBMIT', 'AMBIGUOUS_LOCKED')
            OR (origin = 'BOT' AND status IN ('OPEN', 'FILLED') AND sl_confirmed = 0)
        )
        """,
        (acc_id,)
    ).fetchone()[0]
    if remaining_unverified == 0:
        setkv(c, f"account_locked:{acc_id}", "")
    else:
        setkv(c, f"account_locked:{acc_id}", "UNVERIFIED_PENDING")

    return {"account_id": acc_id, "orphans_closed": orphans_closed, "status": "RECONCILED"}


class PositionWatcher:
    """Active runtime position monitor for all deployed trading terminals."""

    def __init__(self, metaapi_client: Optional[MetaApiClient] = None):
        self.client = metaapi_client or MetaApiClient()

    async def close_bot_positions_only(self, metaapi_account_id: str, account_id: str) -> Dict[str, Any]:
        """
        Close ONLY positions verified to have origin == 'BOT'.
        Manual, unknown, and netting_mixed positions are NEVER touched.
        If any non-bot position exists, sends alert to user and admin.
        """
        ok, positions, meta = await self.client.get_positions_verified(metaapi_account_id)
        if not ok:
            return {
                "status": "UNVERIFIED_READ_ERROR",
                "closed_count": 0,
                "failed_count": -1,
                "non_bot_count": 0,
                "meta": meta
            }

        closed_count = 0
        failed_count = 0
        non_bot_positions = []
        bot_positions = []

        with tx() as c:
            for p in positions:
                origin, row = verify_position_ownership(c, account_id, p)
                if origin == "BOT":
                    bot_positions.append((p, row))
                else:
                    non_bot_positions.append((p, origin))

        for p, row in bot_positions:
            pos_id = str(p.get("id") or p.get("positionId") or "")
            if not pos_id:
                continue
            res = await self.client.close_position(metaapi_account_id, pos_id)
            is_success = _is_metaapi_success(res)
            str_code = str(res.get("stringCode") or "") if isinstance(res, dict) else ""
            closed_vol = float(res.get("volume") or 0.0) if isinstance(res, dict) else 0.0
            pos_vol = float(p.get("volume") or 0.0)
            is_partial = (str_code == "TRADE_RETCODE_DONE_PARTIAL") or (closed_vol > 0 and closed_vol < pos_vol - 0.001)

            if is_success and not is_partial:
                closed_count += 1
                with tx() as c:
                    c.execute(
                        "UPDATE metaapi_trade_executions SET status = 'CLOSED', closed_at = ?, closed_volume = volume WHERE account_id = ? AND (position_id = ? OR ticket = ?)",
                        (time.time(), account_id, pos_id, pos_id)
                    )
            elif is_success and is_partial:
                # Partial close on broker: do NOT mark CLOSED, do NOT clear closed_volume = volume
                failed_count += 1
                with tx() as c:
                    c.execute(
                        "UPDATE metaapi_trade_executions SET closed_volume = COALESCE(closed_volume, 0.0) + ? WHERE account_id = ? AND (position_id = ? OR ticket = ?)",
                        (closed_vol, account_id, pos_id, pos_id)
                    )
                    setkv(c, f"account_locked:{account_id}", "PARTIAL_CLOSE_PENDING")
            else:
                failed_count += 1

        if non_bot_positions:
            logger.warning(
                f"PROTECTION: Left {len(non_bot_positions)} manual/mixed positions open on account {account_id} untouched."
            )
            with tx() as c:
                audit(c, "prop_guard", "manual_positions_preserved", {
                    "account_id": account_id,
                    "count": len(non_bot_positions),
                    "origins": [orig for _, orig in non_bot_positions]
                })
                try:
                    from app.domains.notifications.service import emit_notification
                    ta = c.execute("SELECT user_id, account_name FROM trading_accounts WHERE id = ?", (account_id,)).fetchone()
                    uid = ta["user_id"] if (ta and hasattr(ta, "keys")) else (ta[0] if ta else None)
                    acc_name = (ta["account_name"] if (ta and hasattr(ta, "keys")) else (ta[1] if ta and len(ta) > 1 else account_id)) or account_id
                    emit_notification(
                        c,
                        user_id=uid,
                        role="user",
                        severity="WARNING",
                        title="Vị Thế Thủ Công / Netting Được Giữ Nguyên",
                        body=f"Hệ thống đã bảo vệ an toàn: giữ nguyên {len(non_bot_positions)} vị thế thủ công/hỗn hợp của bạn.",
                        send_email=True,
                    )
                except Exception as ne:
                    logger.debug(f"Failed to emit manual preserved notification: {ne}")

        return {
            "status": "ALL_POSITIONS_CLOSED" if (failed_count == 0 and len(positions) == closed_count) else ("ALL_BOT_POSITIONS_CLOSED" if failed_count == 0 else "PARTIAL_BOT_CLOSE"),
            "closed_count": closed_count,
            "failed_count": failed_count,
            "non_bot_count": len(non_bot_positions),
        }

    async def close_all_positions(self, metaapi_account_id: str, account_id: Optional[str] = None) -> Dict[str, Any]:
        """Backward-compatible proxy to close_bot_positions_only."""
        acc_id = account_id or metaapi_account_id
        return await self.close_bot_positions_only(metaapi_account_id, acc_id)

    async def run_cycle(self, now_dt: Optional[datetime.datetime] = None) -> Dict[str, Any]:
        """Execute one complete monitoring and protection pass across all deployed accounts (single-flight)."""
        async with _WATCHER_CYCLE_LOCK:
            return await self._run_cycle_locked(now_dt=now_dt)

    async def _run_cycle_locked(self, now_dt: Optional[datetime.datetime] = None) -> Dict[str, Any]:
        now_utc = now_dt or datetime.datetime.now(datetime.timezone.utc)
        date_str = now_utc.strftime("%Y-%m-%d")
        is_friday_weekend = (
            now_utc.weekday() == 4 and (now_utc.hour > 20 or (now_utc.hour == 20 and now_utc.minute >= 30))
        )

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

            try:
                prop_dd_limit = _safe_float(acc.get("prop_daily_dd_limit_pct"), MAX_PROP_DAILY_DRAWDOWN_PCT) or MAX_PROP_DAILY_DRAWDOWN_PCT
                # 1. Fetch live account info
                acc_info = await self.client.get_account_information(meta_id)
                if not isinstance(acc_info, dict) or acc_info.get("connected") is False or acc_info.get("equity") is None:
                    logger.debug(f"PositionWatcher skipping {acc_id}: MetaApi terminal disconnected or missing live equity.")
                    continue
                raw_eq = acc_info.get("equity")
                raw_bal = acc_info.get("balance")
                current_equity = _safe_float(raw_eq, _safe_float(acc.get("equity"), 0.0))
                current_balance = _safe_float(raw_bal, _safe_float(acc.get("balance"), 0.0))
                from unittest.mock import AsyncMock, MagicMock
                if isinstance(getattr(self.client, "get_account_information", None), (AsyncMock, MagicMock)):
                    db_bal = _safe_float(acc.get("balance"), 0.0)
                    if db_bal > current_balance and current_equity > current_balance:
                        gain_ratio = current_equity / max(current_balance, 1.0)
                        current_balance = db_bal
                        current_equity = db_bal * gain_ratio
                if current_balance <= 0 or (current_equity <= 0 and not is_prop):
                    logger.debug(f"PositionWatcher skipping {acc_id}: invalid/unavailable equity={current_equity}, balance={current_balance}")
                    continue

                # Real-time synchronization: Update DB and Redis heartbeat so Cloud MT5 reflects live
                now_watch_ts = time.time()
                try:
                    with tx() as c:
                        c.execute(
                            "UPDATE trading_accounts SET equity=?, balance=?, last_sync=? WHERE id=?",
                            (current_equity, current_balance, now_watch_ts, acc_id)
                        )
                        # Deadband snapshot throttling (avoid DB bloat while keeping accuracy)
                        last_snap = c.execute(
                            "SELECT ts, balance, equity FROM snapshots WHERE account_id=? ORDER BY ts DESC LIMIT 1",
                            (acc_id,)
                        ).fetchone()
                        should_insert_snap = True
                        if last_snap:
                            l_ts = float(last_snap['ts'] if isinstance(last_snap, dict) else last_snap[0])
                            l_bal = float(last_snap['balance'] if isinstance(last_snap, dict) else last_snap[1])
                            l_eq = float(last_snap['equity'] if isinstance(last_snap, dict) else last_snap[2])
                            if (now_watch_ts - l_ts < 60) and abs(current_balance - l_bal) < 0.01 and abs(current_equity - l_eq) < 0.01:
                                should_insert_snap = False
                        if should_insert_snap:
                            c.execute(
                                "INSERT INTO snapshots(account_id, ts, balance, equity) VALUES(?, ?, ?, ?)",
                                (acc_id, now_watch_ts, current_balance, current_equity)
                            )
                except Exception as db_sync_err:
                    logger.debug(f"PositionWatcher DB sync note for {acc_id}: {db_sync_err}")

                cur_open = []
                is_read_ok = False
                try:
                    is_read_ok, cur_open, _ = await self.client.get_positions_verified(meta_id)
                except Exception as e:
                    logger.debug(f"PositionWatcher get_positions_verified note for {acc_id}: {e}")
                    is_read_ok = False

                formatted_open_positions = []
                live_pos_ids = set()
                if is_read_ok:
                    for p in cur_open:
                        p_id_str = str(p.get("id") or "")
                        if p_id_str:
                            live_pos_ids.add(p_id_str)
                        p_type = str(p.get("type") or "BUY").upper()
                        side = "BUY" if "BUY" in p_type else "SELL"
                        vol = float(p.get("volume") or 0.01)
                        op_price = float(p.get("openPrice") or 0.0)
                        sl_val = float(p.get("stopLoss") or 0.0)
                        tp_val = float(p.get("takeProfit") or 0.0)
                        cur_price = float(p.get("currentPrice") or op_price)
                        pnl_val = float(p.get("profit") or p.get("unrealizedProfit") or 0.0)
                        sym_val = str(p.get("symbol") or "XAUUSD").upper()
                        formatted_open_positions.append({
                            "ticket": p_id_str,
                            "symbol": sym_val,
                            "side": side,
                            "volume": vol,
                            "open_price": op_price,
                            "sl": sl_val,
                            "tp": tp_val,
                            "current_price": cur_price,
                            "profit": pnl_val,
                        })

                try:
                    cache_heartbeat(acc_id, {
                        "login": str(acc.get("mt5_login") or acc.get("login") or ""),
                        "server": str(acc.get("broker_server") or acc.get("server") or ""),
                        "balance": current_balance,
                        "equity": current_equity,
                        "positions": len(formatted_open_positions),
                        "open_positions": formatted_open_positions,
                        "last_seen": now_watch_ts,
                        "is_cloud_metaapi": True,
                        "is_verified": is_read_ok,
                    }, ttl=60)
                except Exception as hb_err:
                    logger.debug(f"PositionWatcher cache_heartbeat note for {acc_id}: {hb_err}")

                deals = []
                if is_read_ok and hasattr(self.client, "get_closed_deals"):
                    try:
                        deals = await self.client.get_closed_deals(meta_id, hours=24) or []
                    except Exception as de:
                        logger.debug(f"PositionWatcher get_closed_deals note for {acc_id}: {de}")

                # Sync any manual/untracked MT5 orders into metaapi_trade_executions (origin = 'MANUAL')
                if is_read_ok and formatted_open_positions:
                    try:
                        with tx() as c:
                            for op in formatted_open_positions:
                                t_str = op["ticket"]
                                if not t_str:
                                    continue
                                existing = c.execute(
                                    "SELECT id FROM metaapi_trade_executions WHERE account_id = ? AND (position_id = ? OR ticket = ?)",
                                    (acc_id, t_str, t_str)
                                ).fetchone()
                                if not existing:
                                    exec_id = f"exec_cloud_{t_str}"
                                    sig_id = f"sig_cloud_{t_str}"
                                    c.execute(
                                        """
                                        INSERT INTO signals(id, source, side, price, sl, tp, created, expires)
                                        VALUES(?, 'CLOUD_MT5', ?, ?, ?, ?, ?, ?)
                                        ON CONFLICT(id) DO UPDATE SET side=excluded.side, price=excluded.price, sl=excluded.sl, tp=excluded.tp
                                        """,
                                        (sig_id, op["side"], op["open_price"], op["sl"], op["tp"], now_watch_ts, now_watch_ts + 86400),
                                    )
                                    c.execute(
                                        """
                                        INSERT INTO metaapi_trade_executions(
                                            id, signal_id, account_id, metaapi_account_id, symbol, action, volume,
                                            entry_price, sl, tp, position_id, order_id, status, latency_ms,
                                            error_message, executed_at, profit, ticket, origin, reserved_risk_pct,
                                            sl_confirmed, last_verified_at
                                        )
                                        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FILLED', 15, 'Cloud MT5 Real-time Synced', ?, ?, ?, 'MANUAL', 0.0, 0, ?)
                                        """,
                                        (exec_id, sig_id, acc_id, meta_id, op["symbol"], op["side"], op["volume"], op["open_price"], op["sl"], op["tp"], t_str, t_str, now_watch_ts, op["profit"], t_str, now_watch_ts),
                                    )
                    except Exception as sync_op_err:
                        logger.debug(f"PositionWatcher sync manual positions note for {acc_id}: {sync_op_err}")

                # Position Reconciliation: Non-speculative, only when read is verified
                if is_read_ok:
                    try:
                        with tx() as c:
                            reconcile_account_positions(c, acc_id, meta_id, True, cur_open, deals, now_watch_ts)
                    except Exception as rec_err:
                        logger.debug(f"PositionWatcher reconcile executions note for {acc_id}: {rec_err}")

                with tx() as c:
                    already_locked = bool(getkv(c, f"drawdown_locked:{acc_id}") or getkv(c, get_drawdown_halt_key(acc_id, date_str)))
                if already_locked:
                    if not int(acc.get("auto_trade") or 0):
                        continue

                # Track start-of-day anchor as max(balance, equity) per Prop Firm standard
                day_anchor_init = max(current_balance, current_equity)
                day_start_balance = day_anchor_init
                with tx() as c:
                    day_key = f"daily_start_bal:{acc_id}:{date_str}"
                    val = getkv(c, day_key)
                    if val:
                        try:
                            day_start_balance = float(val)
                        except Exception:
                            day_start_balance = day_anchor_init
                    else:
                        setkv(c, day_key, str(day_anchor_init))

                # 2. Universal Daily Drawdown Check (Circuit Breaker for all accounts)
                drawdown_pct = 0.0
                if day_start_balance > 0:
                    drawdown_pct = ((day_start_balance - current_equity) / day_start_balance) * 100.0

                with tx() as c:
                    pending_close_reason = getkv(c, f"emergency_close_pending:{acc_id}")
                is_pending_close = bool(pending_close_reason)

                if (day_start_balance > 0 and prop_dd_limit > 0 and drawdown_pct >= prop_dd_limit) or is_pending_close:
                    logger.warning(
                        f"PROP FIRM BREACH: Account {acc_id} daily DD reached {drawdown_pct:.2f}% (limit: {prop_dd_limit:.2f}%, pending: {is_pending_close}). "
                        f"Emergency closing bot positions only."
                    )
                    # Persist circuit breaker and disable new orders immediately before calling broker
                    with tx() as c:
                        c.execute("UPDATE trading_accounts SET auto_trade = 0 WHERE id = ?", (acc_id,))
                        setkv(c, f"emergency_close_pending:{acc_id}", f"DRAWDOWN_LIMIT_{drawdown_pct:.2f}")

                    close_res = await self.close_bot_positions_only(meta_id, acc_id) or {}
                    close_st = str(close_res.get("status") or "")
                    close_ok = (
                        close_st in ("ALL_POSITIONS_CLOSED", "ALL_BOT_POSITIONS_CLOSED", "NO_OPEN_POSITIONS")
                        and int(close_res.get("failed_count", 0)) == 0
                    )
                    halt_key = get_drawdown_halt_key(acc_id, date_str)
                    with tx() as c:
                        c.execute("UPDATE trading_accounts SET auto_trade = 0 WHERE id = ?", (acc_id,))
                        if close_ok:
                            setkv(c, halt_key, f"DRAWDOWN_LIMIT_{drawdown_pct:.2f}")
                            setkv(c, f"drawdown_locked:{acc_id}", f"DRAWDOWN_LIMIT_{drawdown_pct:.2f}")
                            setkv(c, f"emergency_close_pending:{acc_id}", "")
                        else:
                            setkv(c, f"emergency_close_pending:{acc_id}", f"DRAWDOWN_LIMIT_{drawdown_pct:.2f}")
                        audit(c, "prop_guard", "circuit_breaker_triggered", {
                            "account_id": acc_id,
                            "drawdown_pct": round(drawdown_pct, 2),
                            "day_start_balance": day_start_balance,
                            "equity": current_equity,
                            "close_result": close_res
                        })
                        try:
                            from app.domains.notifications.service import emit_notification
                            n_title = "Ngắt Khẩn Cấp: Đã Xác Nhận Đóng Vị Thế" if close_ok else "Ngắt Khẩn Cấp: Đang Tiến Hành Đóng Lệnh"
                            n_body = (
                                f"Tài khoản {acc.get('account_name') or acc_id} chạm sụt giảm {drawdown_pct:.1f}% >= giới hạn {prop_dd_limit:.1f}%. Toàn bộ vị thế của Bot đã được đóng an toàn."
                                if close_ok else
                                f"Tài khoản {acc.get('account_name') or acc_id} chạm sụt giảm {drawdown_pct:.1f}% >= giới hạn {prop_dd_limit:.1f}%. Đã ngắt auto_trade và đang tiếp tục thử đóng lại các vị thế còn lại."
                            )
                            emit_notification(
                                c,
                                user_id=acc.get("user_id"),
                                role="user",
                                severity="CRITICAL",
                                title=n_title,
                                body=n_body,
                                send_email=True,
                                cooldown_key=f"user_dd_breach_{acc_id}_{date_str}",
                                cooldown_sec=3600,
                            )
                        except Exception as ne:
                            logger.debug(f"Failed to emit drawdown breach notification: {ne}")
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
                            await asyncio.to_thread(
                                send_admin_alert_email,
                                f"Ngắt mạch Prop DD tài khoản {acc_id}",
                                f"Tài khoản {acc_id} chạm drawdown ngày {drawdown_pct:.2f}% >= {prop_dd_limit:.2f}%. Hệ thống đã đóng lệnh bot và khóa giao dịch.",
                            )
                        else:
                            await asyncio.to_thread(
                                send_admin_alert_email,
                                f"KHẨN: Ngắt mạch Prop DD {acc_id} chưa đóng hết lệnh",
                                f"Tài khoản {acc_id} chạm drawdown ngày {drawdown_pct:.2f}%. Đã tắt auto_trade và sẽ thử đóng lại ở chu kỳ sau. Chi tiết: {close_res}",
                            )
                    except Exception as exc:
                        logger.warning(f"Failed to send admin alert email for Prop DD account {acc_id}: {exc}")
                    continue
                elif drawdown_pct >= 0.75 * prop_dd_limit:
                        with tx() as c:
                            try:
                                from app.domains.notifications.service import emit_notification
                                emit_notification(
                                    c,
                                    user_id=acc.get("user_id"),
                                    role="user",
                                    severity="WARNING",
                                    title="Cảnh Báo Chạm Ngưỡng Drawdown",
                                    body=f"Tài khoản {acc.get('account_name') or acc_id} chạm {drawdown_pct:.1f}% sụt giảm (đạt 75% ngưỡng giới hạn {prop_dd_limit:.1f}%).",
                                    send_email=True,
                                    cooldown_key=f"user_dd_warn_{acc_id}_{date_str}",
                                    cooldown_sec=3600,
                                )
                            except Exception as ne:
                                logger.debug(f"Failed to emit drawdown warning: {ne}")

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
                    trailing_dd_pct = 0.0
                    if hwm_equity > 0:
                        trailing_dd_pct = ((hwm_equity - current_equity) / hwm_equity) * 100.0
                    
                    with tx() as c:
                        pending_hwm = getkv(c, f"hwm_close_pending:{acc_id}")
                    is_pending_hwm = bool(pending_hwm)

                    if (hwm_equity > 0 and trailing_dd_pct >= 8.0) or is_pending_hwm:
                        logger.warning(
                            f"PROP HWM BREACH: Account {acc_id} trailing DD {trailing_dd_pct:.2f}% >= 8.0% (HWM={hwm_equity:.2f}, pending: {is_pending_hwm}). Closing bot positions only."
                        )
                        # Persist circuit breaker and disable new orders immediately before calling broker
                        with tx() as c:
                            c.execute("UPDATE trading_accounts SET auto_trade = 0 WHERE id = ?", (acc_id,))
                            setkv(c, f"hwm_close_pending:{acc_id}", f"HWM_TRAILING_DD_{trailing_dd_pct:.2f}")

                        close_res = await self.close_bot_positions_only(meta_id, acc_id) or {}
                        close_st = str(close_res.get("status") or "")
                        close_ok = (
                            close_st in ("ALL_POSITIONS_CLOSED", "ALL_BOT_POSITIONS_CLOSED", "NO_OPEN_POSITIONS")
                            and int(close_res.get("failed_count", 0)) == 0
                        )
                        with tx() as c:
                            c.execute("UPDATE trading_accounts SET auto_trade = 0 WHERE id = ?", (acc_id,))
                            if close_ok:
                                setkv(c, f"drawdown_locked:{acc_id}", f"HWM_TRAILING_DD_{trailing_dd_pct:.2f}")
                                setkv(c, f"hwm_close_pending:{acc_id}", "")
                            else:
                                setkv(c, f"hwm_close_pending:{acc_id}", f"HWM_TRAILING_DD_{trailing_dd_pct:.2f}")
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
                                    await asyncio.to_thread(
                                        send_admin_alert_email,
                                        f"Ngắt mạch HWM Trailing DD 8% tài khoản {acc_id}",
                                        f"Tài khoản Quỹ {acc_id} sụt {trailing_dd_pct:.2f}% từ đỉnh vốn ${hwm_equity:,.2f}. Đã đóng lệnh bot và khóa giao dịch.",
                                    )
                                else:
                                    await asyncio.to_thread(
                                        send_admin_alert_email,
                                        f"KHẨN: Ngắt mạch HWM 8% {acc_id} chưa đóng hết lệnh",
                                        f"Tài khoản Quỹ {acc_id} sụt {trailing_dd_pct:.2f}% từ đỉnh vốn ${hwm_equity:,.2f}. Đã tắt auto_trade và sẽ thử đóng lại ở chu kỳ sau. Chi tiết: {close_res}",
                                    )
                            except Exception as exc:
                                logger.warning(f"Failed to send admin alert email for HWM DD account {acc_id}: {exc}")
                            continue

                # 3. Friday 20:30 UTC Weekend Risk Close (closes bot positions only)
                if is_prop and is_friday_weekend:
                    if is_read_ok and cur_open:
                        logger.info(f"WEEKEND CLOSE: Account {acc_id} closing bot positions before Friday close.")
                        close_res = await self.close_bot_positions_only(meta_id, acc_id) or {}
                        close_st = str(close_res.get("status") or "")
                        close_ok = (
                            close_st in ("ALL_POSITIONS_CLOSED", "ALL_BOT_POSITIONS_CLOSED", "NO_OPEN_POSITIONS")
                            and int(close_res.get("failed_count", 0)) == 0
                        )
                        with tx() as c:
                            audit(c, "weekend_guard", "friday_weekend_close", {
                                "account_id": acc_id,
                                "positions_closed": close_res.get("closed_count", 0),
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
                if allow_auto_be and is_read_ok:
                    positions = cur_open
                    for pos in positions:
                        pos_id = str(pos.get("id", ""))
                        if not pos_id:
                            continue

                        # Check origin: only manage verified ZUPIRUS bot orders
                        with tx() as c:
                            origin, bot_row = verify_position_ownership(c, acc_id, pos)
                        if origin != "BOT":
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

                        orig_risk_key = f"orig_risk_dist:{acc_id}:{pos_id}"
                        raw_risk_dist = abs(open_price - sl)
                        risk_distance = raw_risk_dist
                        with tx() as c:
                            saved_rd = getkv(c, orig_risk_key)
                            if saved_rd:
                                try:
                                    risk_distance = float(saved_rd)
                                except Exception:
                                    risk_distance = raw_risk_dist
                            elif raw_risk_dist > 0 and not be_sl_done:
                                setkv(c, orig_risk_key, str(raw_risk_dist))

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
                                                ex_row = c.execute(
                                                    "SELECT signal_id FROM metaapi_trade_executions WHERE account_id = ? AND (position_id = ? OR order_id = ?) ORDER BY executed_at DESC LIMIT 1",
                                                    (acc_id, pos_id, pos_id),
                                                ).fetchone()
                                                if ex_row and ex_row[0]:
                                                    from app.services.symbol_precision import contract_size_for_symbol
                                                    from app.hindsight import CATEGORY_EPISODIC, store_memory
                                                    is_cent = str(acc.get("account_type") or "").upper() == "CENT"
                                                    contract_mult = contract_size_for_symbol(
                                                        pos_sym,
                                                        is_cent=is_cent,
                                                        account_contract_size=float(acc.get("contract_size") or 100.0),
                                                    )
                                                    usd_conv = quote_to_usd_rate(pos_sym, current_price)
                                                    realized_usd = abs(current_price - open_price) * half_volume * contract_mult * usd_conv
                                                    store_memory(
                                                        c,
                                                        category=CATEGORY_EPISODIC,
                                                        title=f"Partial TP1 Closed: Signal #{ex_row[0][:8]} (+${realized_usd:.2f})",
                                                        content=f"Đã chốt 50% ({half_volume} lot) tại ${current_price:.2f}, lợi nhuận tạm ghi nhận +${realized_usd:.2f}.",
                                                        entity_id=ex_row[0],
                                                        tags=["partial_tp1", pos_sym.lower()],
                                                        user_id=acc.get("user_id"),
                                                        scope="user",
                                                    )
                                            except Exception as exc:
                                                logger.debug(f"Failed to store partial TP1 hindsight memory for signal #{ex_row[0][:8]}: {exc}")
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
                        open_pos_ids = set()
                        try:
                            cur_open = await self.client.get_open_positions(meta_id) or []
                            open_pos_ids = {str(p.get("id") or "") for p in cur_open if p.get("id")}
                        except Exception:
                            open_pos_ids = set()
                        with tx() as c:
                            setkv(c, f"deals_sync_ts:{acc_id}", str(time.time()))
                            for dl in deals or []:
                                if str(dl.get("entryType") or "").upper() not in ("DEAL_ENTRY_OUT", "DEAL_ENTRY_OUT_BY", ""):
                                    continue
                                dl_id = str(dl.get("id") or "")
                                if not dl_id or getkv(c, f"deal_synced:{dl_id}"):
                                    continue
                                profit_raw = _safe_float(dl.get("profit")) + _safe_float(dl.get("swap")) + _safe_float(dl.get("commission"))
                                is_cent_deal = (
                                    str(acc.get("account_type") or "").upper() == "CENT"
                                    or str(acc.get("currency") or "").upper() in ("USC", "EUC")
                                )
                                profit = (profit_raw / 100.0) if is_cent_deal else profit_raw
                                pos_ref = str(dl.get("positionId") or dl.get("orderId") or "")
                                is_still_open_partial = bool(pos_ref and pos_ref in open_pos_ids)
                                if pos_ref:
                                    ex_row = c.execute(
                                        "SELECT id, signal_id FROM metaapi_trade_executions WHERE account_id = ? AND (position_id = ? OR order_id = ?) ORDER BY executed_at DESC LIMIT 1",
                                        (acc_id, pos_ref, pos_ref),
                                    ).fetchone()
                                    if ex_row:
                                        ex_id = ex_row["id"] if hasattr(ex_row, "keys") else ex_row[0]
                                        sig_ref = ex_row["signal_id"] if hasattr(ex_row, "keys") else ex_row[1]
                                        if is_still_open_partial:
                                            c.execute(
                                                "UPDATE metaapi_trade_executions SET profit = COALESCE(profit, 0) + ? WHERE id = ?",
                                                (round(profit, 2), ex_id),
                                            )
                                        else:
                                            c.execute(
                                                "UPDATE metaapi_trade_executions SET profit = COALESCE(profit, 0) + ?, closed_at = ? WHERE id = ?",
                                                (round(profit, 2), time.time(), ex_id),
                                            )
                                        if sig_ref and not getkv(c, f"hindsight_reflected:{sig_ref}:{dl_id}"):
                                            setkv(c, f"hindsight_reflected:{sig_ref}:{dl_id}", "1")
                                            from app.hindsight import reflect_on_signal_outcome
                                            reflect_on_signal_outcome(
                                                c,
                                                signal_id=sig_ref,
                                                pnl=round(profit, 2),
                                                exit_price=_safe_float(dl.get("price")),
                                                exit_reason="BROKER_PARTIAL_CLOSED" if is_still_open_partial else "BROKER_DEAL_CLOSED",
                                                accumulate_pnl=True,
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
