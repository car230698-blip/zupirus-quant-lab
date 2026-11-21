import os
import time
import uuid
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
    from app.db import tx, getkv
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

    for acc in accounts:
        acc_id = acc["id"]
        meta_id = acc.get("metaapi_account_id") or acc_id

        # 0. Check per-account Prop Drawdown Lock (unified key check)
        with tx() as c:
            is_dd_locked = is_account_drawdown_halted(c, acc_id)
        if is_dd_locked:
            logger.warning(f"Account {acc_id} skipped: Prop drawdown circuit breaker is LOCKED.")
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
                        "SELECT bid, ask, ts FROM quotes WHERE symbol = ? AND (? - ts) < 120 ORDER BY ts DESC LIMIT 1",
                        (canon_sym, time.time())
                    ).fetchone()
                    if q_row and q_row[0] and q_row[1]:
                        from app.services.symbol_precision import pip_multiplier_for_symbol
                        broker_spread = round(abs(float(q_row[1]) - float(q_row[0])) * pip_multiplier_for_symbol(canon_sym), 1)
            except Exception as exc:
                logger.debug(f"Could not compute broker spread from quotes table for {canon_sym} (acc {acc_id}): {exc}")
        if broker_spread <= 0:
            try:
                from app.routers.telemetry import get_live_xauusd_quote
                lq = get_live_xauusd_quote()
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
        except Exception:
            pass

        if is_duplicate:
            logger.warning(f"Idempotency: Signal {signal_id} already executed for account {acc_id}. Skipping.")
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
        effective_risk_pct = risk_pct
        effective_mult = mult

        if is_prop_mode and prop_stage != "LIVE":
            # Check profit-target throttle flag (halve risk when >= 80% of prop profit target achieved in CHALLENGE)
            try:
                from app.db import tx, getkv
                with tx() as c:
                    if getkv(c, f"prop_target_throttle:{acc_id}") == "1":
                        effective_risk_pct = effective_risk_pct * 0.5
            except Exception:
                pass

        # Dynamic De-Risking check (B4):
        # When account daily drawdown exceeds 50% of daily loss limit, multiply effective_mult by 0.5
        try:
            prop_dd_limit = float(acc.get("prop_daily_dd_limit_pct") or 4.0)
            date_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
            from app.db import tx, getkv
            with tx() as c:
                day_start_str = getkv(c, f"daily_start_bal:{acc_id}:{date_str}")
                day_start_bal = float(day_start_str) if day_start_str else balance
            if day_start_bal > 0 and equity < day_start_bal:
                current_daily_dd_pct = ((day_start_bal - equity) / day_start_bal) * 100.0
                if current_daily_dd_pct >= (prop_dd_limit * 0.5):
                    effective_mult = effective_mult * 0.5
                    logger.warning(
                        f"DYNAMIC_DERISK_50PCT: Account {acc_id} daily drawdown {current_daily_dd_pct:.2f}% >= "
                        f"50% of limit ({prop_dd_limit * 0.5:.2f}%). Throttling multiplier by 0.5x -> {effective_mult:.2f}x"
                    )
        except Exception as dd_err:
            logger.debug(f"Dynamic derisk check note for {acc_id}: {dd_err}")

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

                # --- B2: Portfolio Correlation & Total Risk Cap (Max 2.0%) ---
                max_portfolio_risk_pct = float(os.getenv("PROP_LIVE_MAX_PORTFOLIO_RISK_PCT", "2.0").strip())
                total_open_portfolio_risk_pct = 0.0
                unprotected_any_position = False

                for pos in open_positions:
                    p_sym = str(pos.get("symbol") or "").upper()
                    p_type = str(pos.get("type") or "").upper()
                    p_side = "BUY" if "BUY" in p_type else ("SELL" if "SELL" in p_type else "")
                    p_open = float(pos.get("openPrice") or 0.0)
                    p_sl = float(pos.get("stopLoss") or 0.0)
                    p_vol = float(pos.get("volume") or 0.0)
                    if p_open <= 0 or p_vol <= 0:
                        continue
                    if p_sl <= 0:
                        unprotected_any_position = True
                        break

                    is_p_buy = (p_side == "BUY")
                    p_at_risk = (is_p_buy and p_sl < p_open) or (not is_p_buy and p_sl > p_open)
                    if p_at_risk:
                        p_contract = contract_size_for_symbol(p_sym, is_cent=is_cent_acc, account_contract_size=c_size)
                        p_risk_usd = abs(p_open - p_sl) * p_vol * p_contract * quote_to_usd_rate(p_sym, p_open)
                        base_cap_usd = (base_capital / 100.0) if is_cent_acc else base_capital
                        if base_cap_usd > 0:
                            total_open_portfolio_risk_pct += (p_risk_usd / base_cap_usd) * 100.0

                if unprotected_any_position:
                    logger.warning(f"Account {acc_id} (PROP LIVE) skipped fail-closed: open position on account has no SL.")
                    continue

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
        if volume <= 0:
            logger.info(f"Account {acc_id} skipped: calculated volume={volume} <= 0 (risk budget too small for min_lot).")
            continue

        # Acquire Redis + DB idempotency lock only after all guards and sizing pass
        redis_locked = False
        if redis_client:
            lock_key = f"zupirus:lock:signal:{signal_id}:{acc_id}"
            try:
                if not redis_client.set(lock_key, "1", ex=120, nx=True):
                    logger.warning(f"Idempotency: Signal {signal_id} already locked in Redis for {acc_id}. Skipping.")
                    continue
                redis_locked = True
            except Exception as e:
                logger.error(f"Redis idempotency lock error: {e}")

        try:
            from app.db import tx
            with tx() as c:
                lock_cur = c.execute(
                    "INSERT INTO signal_dispatch_locks (id, signal_fingerprint, account_id, worker_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (signal_fingerprint, account_id) DO NOTHING",
                    (f"lck_{uuid.uuid4().hex[:12]}", str(signal_id), acc_id, str(os.getpid()), time.time())
                )
                if getattr(lock_cur, "rowcount", 1) == 0:
                    logger.warning(f"Idempotency: Signal {signal_id} already locked in DB for {acc_id}. Skipping.")
                    if redis_client and redis_locked:
                        try:
                            redis_client.delete(f"zupirus:lock:signal:{signal_id}:{acc_id}")
                        except Exception:
                            pass
                    continue
        except Exception as db_lock_err:
            if not redis_locked:
                logger.error(f"Fail-Closed Idempotency: Both Redis and DB locks unavailable for {acc_id}: {db_lock_err}")
                continue

        account_metas.append({
            "account_id": acc_id,
            "metaapi_account_id": meta_id,
            "user_id": acc.get("user_id"),
            "volume": volume,
            "equity": equity,
            "is_compounding": is_comp,
            "multiplier": mult,
            "broker_symbol": broker_sym,
        })

        # 5. Schedule concurrent execution task with normalized digits to prevent broker rejection
        from app.services.symbol_precision import digits_for_symbol
        dec_places = digits_for_symbol(broker_sym)
        rounded_sl = round(sl, dec_places) if sl is not None else None
        rounded_tp = round(tp, dec_places) if tp is not None else None
        tasks.append(
            metaapi_client.execute_order(
                metaapi_account_id=meta_id,
                symbol=broker_sym,
                action=action,
                volume=volume,
                stop_loss=rounded_sl,
                take_profit=rounded_tp,
                comment=f"ZP-{signal_id[:6]}"
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
        if isinstance(res, Exception):
            failed_count += 1
            executions.append({
                "account_id": meta["account_id"],
                "metaapi_account_id": meta["metaapi_account_id"],
                "status": "FAILED",
                "volume": meta["volume"],
                "error": str(res),
                "latency_ms": 0,
                "persisted": True
            })
        else:
            lat = res.get("latency_ms", 0)
            latencies.append(lat)
            is_success = _is_metaapi_success(res)
            if is_success:
                executed_count += 1
                status = "FILLED"
            else:
                failed_count += 1
                status = "REJECTED"

            filled_vol = float(res.get("volume") or res.get("closedVolume") or meta["volume"])
            executions.append({
                "account_id": meta["account_id"],
                "metaapi_account_id": meta["metaapi_account_id"],
                "status": status,
                "volume": filled_vol,
                "order_id": res.get("orderId"),
                "position_id": res.get("positionId"),
                "latency_ms": lat,
                "message": res.get("message"),
                "persisted": True
            })

    # Persist all executions directly into metaapi_trade_executions
    try:
        with tx() as c:
            for ex in executions:
                exec_id = f"exec_{uuid.uuid4().hex[:16]}"
                acc_id_val = ex["account_id"]
                # Ensure metaapi_cloud_accounts has a row for acc_id_val so SQLite FK constraint on metaapi_trade_executions is satisfied
                is_pg_conn = bool(getattr(c, "_is_pg", False))
                if is_pg_conn:
                    c.execute("SAVEPOINT sp_metaapi_fk")
                try:
                    has_cloud = c.execute("SELECT 1 FROM metaapi_cloud_accounts WHERE id = ?", (acc_id_val,)).fetchone()
                    if not has_cloud:
                        ta_u = c.execute("SELECT user_id FROM trading_accounts WHERE id = ?", (acc_id_val,)).fetchone()
                        fallback_uid = (ta_u[0] if ta_u and ta_u[0] else None) or ex.get("user_id")
                        if not fallback_uid:
                            u_row = c.execute("SELECT id FROM users LIMIT 1").fetchone()
                            fallback_uid = u_row[0] if u_row else "system"
                        c.execute(
                            """
                            INSERT INTO metaapi_cloud_accounts(
                                id, user_id, login, server, platform, account_name,
                                metaapi_account_id, metaapi_state, auto_trade, created_at
                            ) VALUES(?, ?, ?, 'MT5-Cloud', 'mt5', ?, ?, 'DEPLOYED', 1, ?)
                            ON CONFLICT (id) DO NOTHING
                            """,
                            (acc_id_val, fallback_uid, acc_id_val, acc_id_val, ex.get("metaapi_account_id") or acc_id_val, now_ts)
                        )
                    if is_pg_conn:
                        c.execute("RELEASE SAVEPOINT sp_metaapi_fk")
                except Exception:
                    if is_pg_conn:
                        c.execute("ROLLBACK TO SAVEPOINT sp_metaapi_fk")
                c.execute("""
                    INSERT INTO metaapi_trade_executions(
                        id, signal_id, account_id, metaapi_account_id, symbol,
                        action, volume, entry_price, sl, tp, position_id,
                        order_id, status, latency_ms, error_message, executed_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    exec_id, signal_id, acc_id_val, ex.get("metaapi_account_id"),
                    symbol, action, ex["volume"], entry_price,
                    sl, tp, ex.get("position_id"), ex.get("order_id"),
                    ex["status"], ex.get("latency_ms", 0),
                    ex.get("error") or ex.get("message"), now_ts
                ))
    except Exception as persist_err:
        logger.error(f"Error persisting trade executions inside execute_fan_out_for_signal: {persist_err}")

    avg_lat = int(sum(latencies) / len(latencies)) if latencies else total_elapsed_ms

    if executed_count > 0:
        try:
            from app.services.discord_notifier import notify_discord_signal
            notify_discord_signal(
                symbol=symbol,
                action=action,
                entry_price=entry_price,
                sl=sl,
                tp=tp,
                accounts_count=executed_count,
            )
        except Exception:
            pass

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

