import os
import time
import uuid
import json
import asyncio
import logging
import datetime
from typing import Dict, Any, List
from app.domains.execution.metaapi_client import MetaApiClient

logger = logging.getLogger("zupirus.metaapi")

async def execute_fan_out_for_signal(
    signal: Dict[str, Any],
    accounts: List[Dict[str, Any]],
    metaapi_client: MetaApiClient,
    redis_client=None
) -> Dict[str, Any]:
    """
    Fan-out signal execution concurrently to all connected accounts using asyncio.gather.
    Includes Redis idempotency lock per (signal_id, account_id).
    """
    signal_id = signal.get("id") or str(uuid.uuid4())
    symbol = signal.get("symbol", "XAUUSD")
    action = signal.get("action", "BUY").upper()

    # Global Kill Switch Check (Fail-Closed)
    from app.db import tx, getkv, setkv
    with tx() as c:
        halt_row = c.execute("SELECT value FROM kv WHERE key = 'halted'").fetchone()
        is_halted = bool(halt_row and str(halt_row[0]).strip() in ("1", "true", "True"))
    if is_halted:
        logger.warning(f"execute_fan_out_for_signal aborted: Global Kill Switch is ACTIVE (halted=1). Signal: {signal_id}")
        return {
            "signal_id": signal_id,
            "total_accounts": len(accounts),
            "executed": 0,
            "failed": len(accounts),
            "skipped": len(accounts),
            "executions": [],
            "error": "KILL_SWITCH_ACTIVE"
        }
    try:
        entry_price = float(signal.get("entry_price") or signal.get("price") or 0.0)
    except (ValueError, TypeError):
        entry_price = 0.0
    if entry_price <= 0:
        logger.warning(f"execute_fan_out_for_signal aborted: invalid/missing entry_price for {symbol} ({signal_id})")
        return {
            "signal_id": signal_id,
            "total_accounts": len(accounts),
            "executed": 0,
            "failed": len(accounts),
            "skipped": len(accounts),
            "executions": [],
            "error": "INVALID_ENTRY_PRICE",
        }
    raw_sl = signal.get("sl") if signal.get("sl") is not None else signal.get("stop_loss")
    sl = float(raw_sl) if raw_sl is not None and float(raw_sl) > 0 else None
    raw_tp = signal.get("tp") if signal.get("tp") is not None else signal.get("take_profit")
    tp = float(raw_tp) if raw_tp is not None and float(raw_tp) > 0 else None

    # Calculate SL distance in broker points consistently via point_size_for_symbol
    from app.services.symbol_precision import point_size_for_symbol, pip_size_for_symbol
    sym_u = str(symbol or "XAUUSD").upper()
    if not sl:
        # Mandatory Stop Loss enforcement: never fire naked orders to customer accounts
        def_sl_pips = 35.0 if "XAU" in sym_u else 25.0
        p_size = pip_size_for_symbol(sym_u)
        sl = round(entry_price - (def_sl_pips * p_size) if action == "BUY" else entry_price + (def_sl_pips * p_size), 5)
        logger.info(f"Signal {signal_id} missing SL: Auto-attached mandatory shield SL={sl}")

    sl_dist = abs(entry_price - sl)
    sl_points = max(1.0, sl_dist / point_size_for_symbol(sym_u))

    tasks = []
    account_metas = []

    from app.services.symbol_mapper import resolve_broker_symbol
    from app.services.account_classifier import calculate_normalized_lot_size
    from app.services.signal_ingestion.sanitizer import check_live_spread_guard
    from app.services.execution.watcher import is_account_drawdown_halted
    from app.domains.execution.regime_strategies import RegimeMetaRouter, is_market_open_gap_cooldown
    from app.domains.ai.macro_station import evaluate_macro_filter

    now_init = time.time()
    if is_market_open_gap_cooldown(now_init):
        logger.warning(f"execute_fan_out_for_signal skipped: Sunday market open gap cooldown active.")
        return {
            "signal_id": signal_id,
            "total_accounts": len(accounts),
            "executed": 0,
            "failed": 0,
            "skipped": len(accounts),
            "executions": [],
            "error": "MARKET_OPEN_GAP_COOLDOWN",
        }

    strat_name = str(signal.get("strategy_id") or signal.get("source") or "strat_trend_breakout")
    macro_eval = evaluate_macro_filter(symbol=symbol, side=action, now_ts=now_init)
    if not macro_eval.get("permitted", True) or macro_eval.get("shock") == "DANGER_FREEZE":
        logger.warning(f"execute_fan_out_for_signal blocked by Macro Shield: {macro_eval.get('reason', 'DANGER_FREEZE')}")
        return {
            "signal_id": signal_id,
            "total_accounts": len(accounts),
            "executed": 0,
            "failed": 0,
            "skipped": len(accounts),
            "executions": [],
            "error": "MACRO_SHOCK_FREEZE",
        }

    macro_scale = float(macro_eval.get("final_scale", 1.0))
    if macro_scale <= 0.0:
        logger.warning(f"execute_fan_out_for_signal skipped: Macro scale is 0.0 ({macro_eval.get('reason')}).")
        return {
            "signal_id": signal_id,
            "total_accounts": len(accounts),
            "executed": 0,
            "failed": 0,
            "skipped": len(accounts),
            "executions": [],
            "error": "MACRO_SCALE_ZERO",
        }

    curr_regime = macro_eval.get("regime", "RANGING")
    meta_router = RegimeMetaRouter()
    meta_scale = meta_router.get_strategy_scale(strat_name, curr_regime)
    if meta_scale <= 0.0:
        logger.warning(f"execute_fan_out_for_signal skipped: Strategy {strat_name} in SHADOW/STAND-ASIDE for {curr_regime} (scale=0.0).")
        return {
            "signal_id": signal_id,
            "total_accounts": len(accounts),
            "executed": 0,
            "failed": 0,
            "skipped": len(accounts),
            "executions": [],
            "error": f"STRATEGY_STAND_ASIDE_{curr_regime}",
        }

    for acc in accounts:
        now_ts = time.time()
        acc_id = acc["id"]
        meta_id = acc.get("metaapi_account_id") or acc_id
        broker_srv = str(acc.get("broker_server") or acc.get("server") or meta_id)

        # 0. Check per-account Prop Drawdown Lock and Account Lock (unverified executions pending)
        with tx() as c:
            is_dd_locked = is_account_drawdown_halted(c, acc_id)
            acc_locked = getkv(c, f"account_locked:{acc_id}")
            from app.domains.execution.compliance import check_broker_circuit_breaker, record_broker_execution_error, reset_broker_circuit_breaker
            cb_res = check_broker_circuit_breaker(server=broker_srv, db_cursor=c, now_ts=now_ts)
        if is_dd_locked:
            logger.warning(f"Account {acc_id} skipped: Prop drawdown circuit breaker is LOCKED.")
            continue
        if acc_locked:
            logger.warning(f"Account {acc_id} skipped: Account locked from risk-increasing actions ({acc_locked}).")
            continue
        if cb_res.get("tripped"):
            logger.warning(f"Account {acc_id} skipped: Broker Circuit Breaker tripped ({cb_res.get('remaining_seconds')}s remaining after {cb_res.get('consecutive_errors')} errors).")
            continue

        # 1. Broker Symbol Auto-Discovery & Mapping check
        broker_sym = resolve_broker_symbol(acc_id, symbol)
        if not broker_sym:
            logger.info(f"Account {acc_id} does not support {symbol} (SKIPPED_UNSUPPORTED_SYMBOL).")
            continue

        # 2. Broker Live Spread Guard (Lớp 2: Kiểm tra riêng theo sàn của khách)
        try:
            broker_spread = float(acc.get("live_spread_pips") or 0.0)
        except (ValueError, TypeError):
            broker_spread = 0.0
        if broker_spread <= 0:
            try:
                from app.db import tx
                from app.services.symbol_mapper import canonical_symbol
                canon_sym = canonical_symbol(symbol)
                with tx() as c:
                    q_row = c.execute(
                        "SELECT bid, ask, ts FROM quotes WHERE symbol = ? AND source NOT IN ('YAHOO', 'YAHOO_REFERENCE', 'SIMULATED') AND (? - ts) < 120 ORDER BY ts DESC LIMIT 1",
                        (canon_sym, time.time())
                    ).fetchone()
                    if q_row and q_row[0] and q_row[1]:
                        from app.services.symbol_precision import pip_multiplier_for_symbol
                        broker_spread = round(abs(float(q_row[1]) - float(q_row[0])) * pip_multiplier_for_symbol(canon_sym), 1)
            except Exception as exc:
                logger.debug(f"Could not compute broker spread from quotes table for {canon_sym} (acc {acc_id}): {exc}")
        if broker_spread <= 0 and canonical_symbol(symbol) == "XAUUSD":
            try:
                from app.routers.telemetry import get_live_xauusd_quote
                lq = get_live_xauusd_quote(require_broker_feed=True)
                if lq.get("spread_pips"):
                    broker_spread = float(lq["spread_pips"])
            except Exception as exc:
                logger.debug(f"Could not retrieve live quote spread for {symbol} (acc {acc_id}): {exc}")
        if broker_spread <= 0 and metaapi_client and getattr(metaapi_client, "is_mock", False):
            broker_spread = 1.5
        if broker_spread <= 0:
            logger.warning(f"Account {acc_id} rejected: No live broker spread quote available (Fail-Closed).")
            continue

        ok_spread, spread_err = check_live_spread_guard(symbol, broker_spread)
        if not ok_spread:
            logger.warning(f"Account {acc_id} rejected due to high spread: {spread_err}")
            continue

        # 3. Fast read-only duplicate check before network/sizing checks
        is_duplicate = False
        try:
            from app.db import tx
            with tx() as c:
                existing = c.execute(
                    "SELECT id FROM metaapi_trade_executions WHERE account_id = ? AND (signal_id = ? OR order_id = ? OR position_id = ?)",
                    (acc_id, signal_id, signal_id, signal_id)
                ).fetchone()
                if existing:
                    is_duplicate = True
        except Exception as exc:
            logger.debug("Fast duplicate check failed for account %s: %s", acc_id, exc)

        if is_duplicate:
            logger.warning(f"Idempotency: Signal {signal_id} already executed for account {acc_id}. Skipping.")
            continue

        # Multi-Strategy Allocation Check (Stage 4)
        allowed_strats_raw = acc.get("allowed_strategy_ids")
        if allowed_strats_raw and str(allowed_strats_raw).strip():
            allowed_list = [s.strip().lower() for s in str(allowed_strats_raw).split(",") if s.strip()]
            sig_strat = str(signal.get("strategy") or signal.get("source") or "").strip().lower()
            if allowed_list and sig_strat and (sig_strat not in allowed_list and "all" not in allowed_list):
                logger.info(
                    f"Account {acc_id} skipped: STRATEGY_NOT_SUBSCRIBED (strategy '{sig_strat}' not in {allowed_list})."
                )
                continue

        # 4. Calculate dynamic proportional lot (Cent vs Standard vs Prop Firm)
        is_comp = bool(acc.get("is_compounding", False))
        try:
            balance = float(acc.get("balance") or 0.0)
        except (ValueError, TypeError):
            balance = 0.0
        raw_eq = acc.get("equity")
        try:
            equity = float(raw_eq) if raw_eq is not None and str(raw_eq).strip() != "" else balance
        except (ValueError, TypeError):
            equity = balance
        if equity <= 0:
            try:
                with tx() as c_acc:
                    brow = c_acc.execute("SELECT balance, equity FROM trading_accounts WHERE id = ?", (acc_id,)).fetchone()
                    if brow:
                        b_val = float(brow[0] or 0.0)
                        eq_val = float(brow[1] or 0.0)
                        if eq_val > 0:
                            equity = eq_val
                            balance = b_val
            except Exception:
                pass
        if equity <= 0:
            logger.warning(f"Account {acc_id} skipped: zero or negative equity ({equity}).")
            continue

        # Never size on inflated balance if account is in drawdown (equity < balance)
        base_capital = min(balance, equity) if (not is_comp and balance > 0) else equity

        try:
            risk_pct = float(acc.get("risk_percent") if acc.get("risk_percent") is not None else 1.0)
        except (ValueError, TypeError):
            risk_pct = 1.0
        try:
            max_lot = float(acc.get("max_lot") if acc.get("max_lot") is not None else 5.0)
        except (ValueError, TypeError):
            max_lot = 5.0
        try:
            mult = float(acc.get("risk_multiplier") or acc.get("multiplier") or 1.0)
        except (ValueError, TypeError):
            mult = 1.0
        try:
            c_size = float(acc.get("contract_size") or 100.0)
        except (ValueError, TypeError):
            c_size = 100.0
        try:
            t_val = float(acc.get("tick_value") or 1.0)
        except (ValueError, TypeError):
            t_val = 1.0
        is_gold_sym = "XAU" in symbol.upper() or "GOLD" in symbol.upper()
        is_cent_acc = (
            str(acc.get("account_type") or "").upper() == "CENT"
            or str(acc.get("currency") or "").upper() in ("USC", "EUC")
            or (is_gold_sym and c_size <= 1.0)
        )

        is_prop_mode = bool(acc.get("is_prop_firm_mode"))
        prop_stage = str(acc.get("prop_stage") or "CHALLENGE").upper()
        if meta_scale <= 0 or macro_scale <= 0:
            effective_risk_pct = 0.0
        else:
            effective_risk_pct = risk_pct * min(meta_scale, macro_scale)
        if effective_risk_pct <= 0:
            logger.info(f"Account {acc_id} skipped: effective risk scale <= 0 (meta_scale={meta_scale}, macro_scale={macro_scale}).")
            continue
        effective_mult = mult
        total_open_portfolio_risk_pct = 0.0
        max_portfolio_risk_pct = float(os.getenv("PROP_LIVE_MAX_PORTFOLIO_RISK_PCT", "2.0").strip())

        from app.domains.execution.compliance import (
            get_prop_rule_profile,
            is_daily_profit_locked,
            calculate_compliant_sl_tp,
            apply_execution_jitter_and_micro_variance,
        )
        prop_profile_id = acc.get("prop_rule_profile") or acc.get("prop_profile") or (
            "PERSONAL_CENT" if is_cent_acc else ("FTMO_STANDARD" if is_prop_mode else "PERSONAL_STANDARD")
        )
        prop_rule_cfg = get_prop_rule_profile(prop_profile_id)
        profit_lock_pct = float(prop_rule_cfg.get("daily_profit_lock_pct") or 0.0)

        if is_prop_mode and prop_stage != "LIVE":
            # Check profit-target throttle flag (halve risk when >= 80% of prop profit target achieved in CHALLENGE)
            try:
                from app.db import tx, getkv
                with tx() as c:
                    if getkv(c, f"prop_target_throttle:{acc_id}") == "1":
                        effective_risk_pct = effective_risk_pct * 0.5
            except Exception as exc:
                logger.debug("Prop throttle check failed for account %s: %s", acc_id, exc)

        # Dynamic De-Risking & Daily Profit Lock check:
        try:
            prop_dd_limit = float(acc.get("prop_daily_dd_limit_pct") or 4.0)
            date_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
            from app.db import tx, getkv
            with tx() as c:
                day_start_str = getkv(c, f"daily_start_bal:{acc_id}:{date_str}")
                day_start_bal = float(day_start_str) if day_start_str else balance
            if day_start_bal > 0:
                if equity > day_start_bal and profit_lock_pct > 0:
                    current_daily_profit_pct = ((equity - day_start_bal) / day_start_bal) * 100.0
                    if is_daily_profit_locked(acc_id, current_daily_profit_pct, profit_lock_pct):
                        logger.warning(
                            f"DAILY_PROFIT_LOCKED: Account {acc_id} daily profit {current_daily_profit_pct:.2f}% >= "
                            f"{profit_lock_pct:.2f}%. Locking trades for the day."
                        )
                        continue
                elif equity < day_start_bal:
                    current_daily_dd_pct = ((day_start_bal - equity) / day_start_bal) * 100.0
                    if current_daily_dd_pct >= (prop_dd_limit * 0.5):
                        effective_mult = effective_mult * 0.5
                        logger.warning(
                            f"DYNAMIC_DERISK_50PCT: Account {acc_id} daily drawdown {current_daily_dd_pct:.2f}% >= "
                            f"50% of limit ({prop_dd_limit * 0.5:.2f}%). Throttling multiplier by 0.5x -> {effective_mult:.2f}x"
                        )
        except Exception as dd_err:
            logger.debug(f"Dynamic derisk/profit check note for {acc_id}: {dd_err}")

        open_positions_cache = None
        if metaapi_client:
            try:
                from app.config import MAX_CONCURRENT_TRADES_PER_ACCOUNT
                import inspect
                if "raise_on_error" in inspect.signature(metaapi_client.get_open_positions).parameters:
                    open_positions_cache = await metaapi_client.get_open_positions(meta_id, raise_on_error=True) or []
                else:
                    open_positions_cache = await metaapi_client.get_open_positions(meta_id) or []
                if len(open_positions_cache) >= MAX_CONCURRENT_TRADES_PER_ACCOUNT:
                    logger.info(
                        f"Account {acc_id} skipped: MAX_CONCURRENT_TRADES_REACHED "
                        f"({len(open_positions_cache)} >= {MAX_CONCURRENT_TRADES_PER_ACCOUNT})."
                    )
                    continue
            except Exception as pos_err:
                logger.warning(f"Account {acc_id} skipped fail-closed on position check error: {pos_err}")
                continue

        # --- B0: Compute total open portfolio risk on MT5 across all accounts ---
        if open_positions_cache:
            try:
                from app.services.symbol_precision import contract_size_for_symbol, quote_to_usd_rate
                unprotected_any_pos = False
                for pos in open_positions_cache:
                    p_sym = str(pos.get("symbol") or "").upper()
                    p_type = str(pos.get("type") or "").upper()
                    p_side = "BUY" if "BUY" in p_type else ("SELL" if "SELL" in p_type else "")
                    p_open = float(pos.get("openPrice") or 0.0)
                    p_sl = float(pos.get("stopLoss") or 0.0)
                    p_vol = float(pos.get("volume") or 0.0)
                    if p_open <= 0 or p_vol <= 0:
                        continue
                    if p_sl <= 0:
                        unprotected_any_pos = True
                        break

                    is_p_buy = (p_side == "BUY")
                    p_at_risk = (is_p_buy and p_sl < p_open) or (not is_p_buy and p_sl > p_open)
                    if p_at_risk:
                        p_contract = contract_size_for_symbol(p_sym, is_cent=is_cent_acc, account_contract_size=c_size)
                        p_risk_usd = abs(p_open - p_sl) * p_vol * p_contract * quote_to_usd_rate(p_sym, p_open)
                        base_cap_usd = (base_capital / 100.0) if is_cent_acc else base_capital
                        if base_cap_usd > 0:
                            total_open_portfolio_risk_pct += (p_risk_usd / base_cap_usd) * 100.0

                if unprotected_any_pos and is_prop_mode and prop_stage == "LIVE":
                    logger.warning(f"Account {acc_id} (PROP LIVE) skipped fail-closed: open position on account has no SL.")
                    continue
            except Exception as pos_calc_err:
                logger.warning(f"Account {acc_id} open portfolio risk calculation error: {pos_calc_err}")

        if is_prop_mode and prop_stage == "LIVE" and metaapi_client:
            try:
                from app.services.symbol_precision import contract_size_for_symbol, quote_to_usd_rate
                open_positions = open_positions_cache if open_positions_cache is not None else []
                eff_contract = contract_size_for_symbol(symbol, is_cent=is_cent_acc, account_contract_size=c_size)
                open_idea_risk_pct = 0.0
                broker_upper = broker_sym.upper()
                unprotected_same_idea = False

                from app.services.symbol_mapper import canonical_symbol
                canon_target = canonical_symbol(symbol)
                for pos in open_positions:
                    pos_sym = str(pos.get("symbol") or "").upper()
                    if pos_sym != broker_upper and canonical_symbol(pos_sym) != canon_target:
                        continue
                    pos_type = str(pos.get("type") or "").upper()
                    pos_side = "BUY" if "BUY" in pos_type else ("SELL" if "SELL" in pos_type else "")
                    if pos_side != action:
                        continue
                    pos_open = float(pos.get("openPrice") or 0.0)
                    pos_sl = float(pos.get("stopLoss") or 0.0)
                    pos_vol = float(pos.get("volume") or 0.0)
                    if pos_open <= 0 or pos_vol <= 0:
                        continue
                    if pos_sl <= 0:
                        unprotected_same_idea = True
                        break
                    is_pos_buy = (pos_side == "BUY")
                    still_at_risk = (is_pos_buy and pos_sl < pos_open) or (not is_pos_buy and pos_sl > pos_open)
                    if still_at_risk:
                        pos_risk_usd = abs(pos_open - pos_sl) * pos_vol * eff_contract * quote_to_usd_rate(symbol, pos_open)
                        base_capital_usd = (base_capital / 100.0) if is_cent_acc else base_capital
                        if base_capital_usd > 0:
                            open_idea_risk_pct += (pos_risk_usd / base_capital_usd) * 100.0

                if unprotected_same_idea:
                    logger.warning(f"Account {acc_id} (PROP LIVE) skipped fail-closed: open {symbol} {action} position has no SL.")
                    continue

                remaining_idea_risk_pct = max(0.0, 1.0 - open_idea_risk_pct)
                if remaining_idea_risk_pct <= 0.05:
                    logger.info(
                        f"Account {acc_id} (PROP LIVE) skipped: PROP_LIVE_IDEA_RISK_CAP_1PCT "
                        f"(open={open_idea_risk_pct:.2f}%, remaining={remaining_idea_risk_pct:.2f}%)."
                    )
                    continue
                capped_risk = min(effective_risk_pct * effective_mult, remaining_idea_risk_pct)
                effective_risk_pct = capped_risk
                effective_mult = 1.0

                # --- B2: Portfolio Correlation & Total Risk Cap for Prop LIVE ---
                remaining_portfolio_risk_pct = max(0.0, max_portfolio_risk_pct - total_open_portfolio_risk_pct)
                if remaining_portfolio_risk_pct <= 0.05:
                    logger.info(
                        f"Account {acc_id} (PROP LIVE) skipped: PROP_LIVE_PORTFOLIO_RISK_CAP_2PCT "
                        f"(open={total_open_portfolio_risk_pct:.2f}%, max={max_portfolio_risk_pct:.2f}%, remaining={remaining_portfolio_risk_pct:.2f}%)."
                    )
                    continue

                effective_risk_pct = min(effective_risk_pct, remaining_portfolio_risk_pct)
            except Exception as prop_err:
                logger.warning(f"Account {acc_id} (PROP LIVE) fail-closed on position check error: {prop_err}")
                continue

        volume = calculate_normalized_lot_size(
            equity=base_capital,
            risk_pct=effective_risk_pct,
            sl_distance_points=sl_points,
            contract_size=c_size,
            tick_value=t_val,
            risk_multiplier=effective_mult,
            max_lot=max_lot,
            is_cent=is_cent_acc,
            symbol=symbol,
            entry_price=entry_price,
        )

        broker_spec = {}
        raw_spec = acc.get("broker_spec_json")
        if raw_spec:
            try:
                broker_spec = json.loads(raw_spec) if isinstance(raw_spec, str) else raw_spec
            except Exception:
                pass

        if is_prop_mode and volume > 0:
            min_vol = float(broker_spec.get("minVolume") or 0.01)
            vol_step = float(broker_spec.get("volumeStep") or 0.01)
            volume, _jitter_delay = apply_execution_jitter_and_micro_variance(
                volume=volume,
                min_vol=min_vol,
                vol_step=vol_step,
            )
            if max_lot > 0:
                volume = min(volume, max_lot)
            volume = round(volume, 2)

        if volume <= 0:
            logger.info(f"Account {acc_id} skipped: calculated volume={volume} <= 0 (risk budget too small for min_lot).")
            continue

        # Acquire DB atomic risk reservation and idempotency lock
        from app.services.symbol_precision import digits_for_symbol
        dec_places = digits_for_symbol(broker_sym)
        if sl is not None and tp is not None:
            c_sl, c_tp = calculate_compliant_sl_tp(
                symbol=broker_sym,
                side=action,
                entry_price=entry_price,
                raw_sl=sl,
                raw_tp=tp,
                spec=broker_spec,
                live_bid=float(acc.get("bid") or 0.0) or None,
                live_ask=float(acc.get("ask") or 0.0) or None,
            )
            rounded_sl = round(c_sl, dec_places)
            rounded_tp = round(c_tp, dec_places)
        else:
            rounded_sl = round(sl, dec_places) if sl is not None else None
            rounded_tp = round(tp, dec_places) if tp is not None else None

        client_order_id = f"ZV2_{uuid.uuid4().hex[:8]}"
        exec_id = f"exec_{uuid.uuid4().hex[:16]}"
        now_ts = time.time()

        # Helper for USD direction
        def _get_usd_dir(s: str, act: str) -> str:
            su = str(s).upper()
            au = str(act).upper()
            if any(k in su for k in ("XAU", "EUR", "GBP", "AUD", "NZD")):
                return "USD_SHORT" if "BUY" in au else "USD_LONG"
            elif any(k in su for k in ("JPY", "CAD", "CHF")):
                return "USD_LONG" if "BUY" in au else "USD_SHORT"
            return "NEUTRAL"

        target_usd_dir = _get_usd_dir(symbol, action)

        # Atomic reservation transaction on shared DB
        reservation_ok = False
        try:
            from app.db import tx
            with tx() as c:
                # Row lock if Postgres
                is_pg_conn = bool(getattr(c, "_is_pg", False))
                if is_pg_conn:
                    c.execute("SELECT 1 FROM trading_accounts WHERE id = ? FOR UPDATE", (acc_id,))

                # Check account drawdown or safety halt
                if is_account_drawdown_halted(c, acc_id):
                    logger.warning(f"Account {acc_id} skipped: Account is halted/locked.")
                    continue

                # Query all active / unverified executions on this account
                active_rows = c.execute(
                    """
                    SELECT symbol, action, reserved_risk_pct, status, position_id, ticket
                    FROM metaapi_trade_executions
                    WHERE account_id = ? AND status IN ('PENDING_SUBMIT', 'UNKNOWN_EXECUTION', 'AMBIGUOUS_LOCKED', 'FILLED')
                    """,
                    (acc_id,)
                ).fetchall()

                # 1. USD Correlation Cap check (Max 2 in same USD direction)
                if target_usd_dir != "NEUTRAL":
                    same_usd_count = 0
                    for ar in active_rows:
                        ar_row = dict(ar) if hasattr(ar, "keys") else {}
                        ar_sym = ar_row.get("symbol") or ar[0]
                        ar_act = ar_row.get("action") or ar[1]
                        if _get_usd_dir(ar_sym, ar_act) == target_usd_dir:
                            same_usd_count += 1
                    if same_usd_count >= 2:
                        logger.warning(f"Account {acc_id} skipped: USD Correlation Cap <= 2 reached ({same_usd_count} active in direction {target_usd_dir}).")
                        continue

                # 2. Atomic 2.0% Total Risk Cap calculation
                # Unreflected risks in DB:
                live_tickets = set()
                if open_positions_cache:
                    for p in open_positions_cache:
                        p_t = str(p.get("id") or "")
                        if p_t:
                            live_tickets.add(p_t)

                unreflected_risk_pct = 0.0
                for ar in active_rows:
                    ar_row = dict(ar) if hasattr(ar, "keys") else {}
                    st = ar_row.get("status") or ar[3]
                    p_id = str(ar_row.get("position_id") or ar[4] or "")
                    t_id = str(ar_row.get("ticket") or (ar[5] if len(ar) > 5 else "") or "")
                    r_pct = float(ar_row.get("reserved_risk_pct") or ar[2] or 0.0)

                    if st in ('PENDING_SUBMIT', 'UNKNOWN_EXECUTION', 'AMBIGUOUS_LOCKED'):
                        unreflected_risk_pct += r_pct
                    elif st == 'FILLED' and p_id not in live_tickets and t_id not in live_tickets:
                        unreflected_risk_pct += r_pct

                risk_cfg = {}
                try:
                    raw_cfg = acc.get("risk_config")
                    if isinstance(raw_cfg, str):
                        risk_cfg = json.loads(raw_cfg)
                    elif isinstance(raw_cfg, dict):
                        risk_cfg = raw_cfg
                except Exception:
                    risk_cfg = {}

                total_in_flight_risk = total_open_portfolio_risk_pct + unreflected_risk_pct
                max_allowed_cap = max_portfolio_risk_pct if (is_prop_mode and prop_stage == "LIVE") else float(risk_cfg.get("max_portfolio_risk_pct") or 2.0)
                if total_in_flight_risk + effective_risk_pct > max_allowed_cap + 0.001:
                    logger.warning(
                        f"Account {acc_id} skipped: Atomic {max_allowed_cap}% risk cap exceeded "
                        f"(in_flight={total_in_flight_risk:.2f}%, new={effective_risk_pct:.2f}%)."
                    )
                    continue

                # Ensure metaapi_cloud_accounts row exists for FK
                if is_pg_conn:
                    c.execute("SAVEPOINT sp_metaapi_fk")
                try:
                    has_cloud = c.execute("SELECT 1 FROM metaapi_cloud_accounts WHERE id = ?", (acc_id,)).fetchone()
                    if not has_cloud:
                        ta_u = c.execute("SELECT user_id FROM trading_accounts WHERE id = ?", (acc_id,)).fetchone()
                        fallback_uid = (ta_u[0] if ta_u and ta_u[0] else None) or acc.get("user_id")
                        if fallback_uid:
                            has_u = c.execute("SELECT 1 FROM users WHERE id = ?", (fallback_uid,)).fetchone()
                            if not has_u:
                                fallback_uid = None
                        c.execute(
                            """
                            INSERT INTO metaapi_cloud_accounts(
                                id, user_id, login, server, platform, account_name,
                                metaapi_account_id, metaapi_state, auto_trade, created_at
                            ) VALUES(?, ?, ?, 'MT5-Cloud', 'mt5', ?, ?, 'DEPLOYED', 1, ?)
                            ON CONFLICT (id) DO NOTHING
                            """,
                            (acc_id, fallback_uid, acc_id, acc_id, meta_id, now_ts)
                        )
                    if is_pg_conn:
                        c.execute("RELEASE SAVEPOINT sp_metaapi_fk")
                except Exception as fk_err:
                    logger.debug(f"metaapi_cloud_accounts insert failed: {fk_err}")

                # Insert durable PENDING_SUBMIT record BEFORE network call
                c.execute(
                    """
                    INSERT INTO metaapi_trade_executions(
                        id, signal_id, account_id, metaapi_account_id, symbol, action, volume,
                        entry_price, sl, tp, status, origin, client_order_id, reserved_risk_pct,
                        sl_confirmed, executed_at, evidence_json
                    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_SUBMIT', 'BOT', ?, ?, 0, ?, ?)
                    """,
                    (
                        exec_id, signal_id, acc_id, meta_id, broker_sym, action, volume,
                        entry_price, rounded_sl, rounded_tp, client_order_id, effective_risk_pct,
                        now_ts, json.dumps({"state": "PENDING_SUBMIT", "ts": now_ts})
                    )
                )
                reservation_ok = True
        except Exception as res_err:
            logger.error(f"Failed atomic reservation for account {acc_id}: {res_err}")
            continue

        if not reservation_ok:
            continue

        account_metas.append({
            "exec_id": exec_id,
            "account_id": acc_id,
            "metaapi_account_id": meta_id,
            "user_id": acc.get("user_id"),
            "volume": volume,
            "equity": equity,
            "is_compounding": is_comp,
            "multiplier": mult,
            "broker_symbol": broker_sym,
            "broker_server": broker_srv,
            "client_order_id": client_order_id,
            "rounded_sl": rounded_sl,
            "rounded_tp": rounded_tp,
        })

        # 5. Schedule concurrent execution task
        tasks.append(
            metaapi_client.execute_order(
                metaapi_account_id=meta_id,
                symbol=broker_sym,
                action=action,
                volume=volume,
                stop_loss=rounded_sl,
                take_profit=rounded_tp,
                comment=client_order_id,
                client_order_id=client_order_id
            )
        )

    if not tasks:
        return {
            "signal_id": signal_id,
            "symbol": symbol,
            "action": action,
            "total_accounts": len(accounts),
            "executed": 0,
            "failed": 0,
            "skipped": len(accounts),
            "executions": [],
            "results": [],
            "avg_latency_ms": 0,
            "total_fanout_elapsed_ms": 0
        }

    # Parallel microsecond fan-out dispatch
    start_all = time.time()
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)
    total_elapsed_ms = int((time.time() - start_all) * 1000)

    from app.domains.execution.watcher import _is_metaapi_success

    executions = []
    latencies = []
    executed_count = 0
    failed_count = 0
    now_ts = time.time()

    for meta, res in zip(account_metas, raw_results):
        exec_id = meta["exec_id"]
        acc_id_val = meta["account_id"]
        meta_id_val = meta["metaapi_account_id"]
        srv_target = str(meta.get("broker_server") or meta_id_val)
        c_order_id = meta["client_order_id"]

        if isinstance(res, Exception):
            failed_count += 1
            # Network exception -> UNKNOWN_EXECUTION + account lock
            with tx() as c:
                c.execute(
                    """
                    UPDATE metaapi_trade_executions
                    SET status = 'UNKNOWN_EXECUTION', error_message = ?
                    WHERE id = ?
                    """,
                    (str(res), exec_id)
                )
                setkv(c, f"account_locked:{acc_id_val}", "UNKNOWN_EXECUTION")
                from app.domains.execution.compliance import record_broker_execution_error
                record_broker_execution_error(server=srv_target, error_type="NETWORK_EXCEPTION", db_cursor=c, now_ts=now_ts)
            executions.append({
                "exec_id": exec_id,
                "account_id": acc_id_val,
                "metaapi_account_id": meta_id_val,
                "status": "UNKNOWN_EXECUTION",
                "volume": meta["volume"],
                "error": str(res),
                "latency_ms": 0,
                "persisted": True
            })
        else:
            lat = res.get("latency_ms", 0)
            latencies.append(lat)
            is_success = _is_metaapi_success(res)
            msg = str(res.get("message") or "")
            str_code = str(res.get("stringCode") or "")

            if "NETWORK_TIMEOUT" in str_code or "TIMEOUT" in msg.upper() or res.get("numericCode") == 504:
                # Network timeout -> UNKNOWN_EXECUTION + lock account
                failed_count += 1
                with tx() as c:
                    c.execute(
                        """
                        UPDATE metaapi_trade_executions
                        SET status = 'UNKNOWN_EXECUTION', error_message = ?, latency_ms = ?
                        WHERE id = ?
                        """,
                        (msg or str_code, lat, exec_id)
                    )
                    setkv(c, f"account_locked:{acc_id_val}", "UNKNOWN_EXECUTION")
                executions.append({
                    "exec_id": exec_id,
                    "account_id": acc_id_val,
                    "metaapi_account_id": meta_id_val,
                    "status": "UNKNOWN_EXECUTION",
                    "volume": meta["volume"],
                    "error": msg,
                    "latency_ms": lat,
                    "persisted": True
                })
            elif is_success:
                executed_count += 1
                pos_id = str(res.get("positionId") or res.get("orderId") or "")
                ord_id = str(res.get("orderId") or pos_id)
                filled_vol = float(res.get("volume") or meta["volume"])
                # SL confirmation: always starts at 0 at submit time; PositionWatcher verifies on MT5
                sl_confirmed = 0

                with tx() as c:
                    c.execute(
                        """
                        UPDATE metaapi_trade_executions
                        SET status = 'FILLED', position_id = ?, ticket = ?, order_id = ?,
                            volume = ?, latency_ms = ?, sl_confirmed = ?, executed_at = ?
                        WHERE id = ?
                        """,
                        (pos_id, pos_id, ord_id, filled_vol, lat, sl_confirmed, now_ts, exec_id)
                    )
                    from app.domains.execution.compliance import reset_broker_circuit_breaker
                    reset_broker_circuit_breaker(server=srv_target, db_cursor=c)
                executions.append({
                    "exec_id": exec_id,
                    "account_id": acc_id_val,
                    "metaapi_account_id": meta_id_val,
                    "status": "FILLED",
                    "volume": filled_vol,
                    "order_id": ord_id,
                    "position_id": pos_id,
                    "latency_ms": lat,
                    "message": msg,
                    "persisted": True
                })
            else:
                # Sàn từ chối rõ ràng -> REJECTED, giải phóng reserved_risk_pct = 0.0
                failed_count += 1
                with tx() as c:
                    c.execute(
                        """
                        UPDATE metaapi_trade_executions
                        SET status = 'REJECTED', reserved_risk_pct = 0.0, error_message = ?, latency_ms = ?, last_verified_at = ?
                        WHERE id = ?
                        """,
                        (msg or str_code, lat, now_ts, exec_id)
                    )
                    from app.domains.execution.compliance import record_broker_execution_error
                    record_broker_execution_error(server=srv_target, error_type=msg or str_code, db_cursor=c, now_ts=now_ts)
                executions.append({
                    "exec_id": exec_id,
                    "account_id": acc_id_val,
                    "metaapi_account_id": meta_id_val,
                    "status": "REJECTED",
                    "volume": meta["volume"],
                    "latency_ms": lat,
                    "message": msg,
                    "persisted": True
                })

    avg_lat = int(sum(latencies) / len(latencies)) if latencies else total_elapsed_ms

    if len(accounts) > 0 and failed_count >= 2:
        fail_rate = (failed_count / len(accounts)) * 100.0
        if fail_rate > 20.0:
            try:
                from app.db import tx
                from app.domains.notifications.service import emit_notification
                with tx() as conn:
                    emit_notification(
                        conn,
                        role="admin",
                        severity="WARNING",
                        title="Cảnh Báo Quạt Lệnh Đa Sàn",
                        body=f"Tín hiệu {signal_id} ({action} {symbol}): Tỷ lệ lỗi fan-out {fail_rate:.1f}% ({failed_count}/{len(accounts)} tài khoản lỗi).",
                        send_email=False,
                    )
            except Exception as e:
                logger.warning(f"Failed to emit fanout alert: {e}")

    return {
        "signal_id": signal_id,
        "symbol": symbol,
        "action": action,
        "total_accounts": len(accounts),
        "executed": executed_count,
        "failed": failed_count,
        "skipped": len(accounts) - len(tasks),
        "total_fanout_elapsed_ms": total_elapsed_ms,
        "avg_latency_ms": avg_lat,
        "executions": executions
    }

