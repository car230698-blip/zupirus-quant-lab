"""Multi-Source Curator Funnel, Shadow Signals Ledger, and EOD Evaluator.
Manages source isolation:
- ACTIVE_LIVE: maximum 2-3 verified sources executing directly to users
- SHADOW_ONLY: unlimited passive observation & agent learning sources (0 broker cost)
- DEMOTED/SUSPENDED: downgraded sources failing performance or risk discipline
"""
import time
import json
import uuid
import logging
from typing import Dict, Any, List, Optional, Tuple
from app.db import tx

logger = logging.getLogger("zupirus.curator")

MAX_ACTIVE_LIVE_SOURCES = 3
MAX_SPREAD_XAUUSD_PIPS = 4.5
MAX_SPREAD_FOREX_PIPS = 2.5

VALID_SIGNAL_MODES = ("EXTERNAL_FEED", "HYBRID_AGENT_SCORER", "ZUPIRUS_AGENT")
DEFAULT_SIGNAL_MODE = "EXTERNAL_FEED"


def get_active_signal_mode(c=None) -> str:
    """Retrieve the unified active signal mode from kv table."""
    def _read(cursor):
        row = cursor.execute("SELECT value FROM kv WHERE key = 'signal_mode'").fetchone()
        if not row:
            row = cursor.execute("SELECT value FROM kv WHERE key = 'signal_source'").fetchone()
        if row and row[0]:
            val = str(row[0]).strip().upper()
            if val == "HYBRID":
                return "HYBRID_AGENT_SCORER"
            if val in VALID_SIGNAL_MODES:
                return val
        return DEFAULT_SIGNAL_MODE

    if c is not None:
        return _read(c)
    with tx() as db_c:
        return _read(db_c)


def set_active_signal_mode(c, mode: str) -> str:
    """Set the unified signal mode in kv table (syncing both signal_mode and signal_source)."""
    norm = str(mode or "").strip().upper()
    if norm == "HYBRID":
        norm = "HYBRID_AGENT_SCORER"
    if norm not in VALID_SIGNAL_MODES:
        raise ValueError(f"Invalid signal mode '{mode}'. Expected one of {VALID_SIGNAL_MODES}")

    from app.core.db import is_postgres
    if is_postgres():
        c.execute(
            "INSERT INTO kv (key, value) VALUES ('signal_mode', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (norm,),
        )
        c.execute(
            "INSERT INTO kv (key, value) VALUES ('signal_source', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (norm,),
        )
    else:
        c.execute(
            "INSERT INTO kv (key, value) VALUES ('signal_mode', ?) ON CONFLICT (key) DO UPDATE SET value = ?",
            (norm, norm),
        )
        c.execute(
            "INSERT INTO kv (key, value) VALUES ('signal_source', ?) ON CONFLICT (key) DO UPDATE SET value = ?",
            (norm, norm),
        )
    return norm


def score_external_signal_hybrid(c, signal, context_snapshot: Optional[Dict[str, Any]] = None) -> Tuple[bool, float, str]:
    """Score external incoming signal under HYBRID_AGENT_SCORER regime:
    1. Checks if signal action is prohibited by active learned skills in current session.
    2. Queries source trust score; rejects signals with score < 50.0.
    Returns (approved, trust_score, reason).
    """
    ctx = context_snapshot or {}
    now_ts = float(ctx.get("captured_at") or time.time())
    sig_action = str(getattr(signal, "action", "") or (signal.get("action") if isinstance(signal, dict) else "")).upper()
    sig_source = str(getattr(signal, "source", "") or (signal.get("source") if isinstance(signal, dict) else ""))
    sig_symbol = str(getattr(signal, "symbol", "") or (signal.get("symbol") if isinstance(signal, dict) else "")).upper()

    # 1. Learned skills session and symbol filter
    allowed_sides = set()
    try:
        from app.skills.registry import evaluate_active_learned_skills
        eval_res = evaluate_active_learned_skills(
            db_cursor=c,
            current_time=now_ts,
            context_snapshot=ctx,
            symbol=sig_symbol,
        )
        blocked_sides = set(eval_res.get("blocked_sides") or [])
        allowed_sides = set(eval_res.get("allowed_sides") or [])
        if sig_action in blocked_sides:
            return False, 40.0, f"BLOCKED_BY_LEARNED_SKILL: {sig_action} is restricted during {eval_res.get('session')} session"
    except Exception as sk_err:
        logger.debug(f"Hybrid learned skills check note: {sk_err}")

    # 2. Source trust score check - Must meet baseline minimum quality threshold (50.0) first
    trust_score = 50.0
    try:
        s_row = c.execute(
            "SELECT trust_score FROM signal_sources WHERE id = ? OR name = ?",
            (sig_source, sig_source),
        ).fetchone()
        if s_row and s_row[0] is not None:
            trust_score = float(s_row[0])
    except Exception:
        pass

    if trust_score < 50.0:
        return False, trust_score, f"HYBRID_LOW_TRUST_SCORE: Source score {trust_score:.1f} < 50.0 threshold"

    # 3. Apply Edge Filter boost if signal aligns with active learned edge in session & symbol
    edge_boost = False
    if sig_action in allowed_sides:
        trust_score = min(100.0, trust_score + 15.0)
        edge_boost = True

    reason = "HYBRID_SCORER_APPROVED_WITH_EDGE_BOOST" if edge_boost else "HYBRID_SCORER_APPROVED"
    return True, trust_score, reason



def _enrich_source_row(r: dict) -> Dict[str, Any]:
    d = dict(r)
    sid = d.get("id") or d.get("source_id") or ""
    d["id"] = sid
    d["source_id"] = sid
    stype = d.get("source_type") or d.get("channel_type") or "WEBHOOK"
    d["source_type"] = stype
    d["channel_type"] = stype
    t_score = float(d.get("trust_score") if d.get("trust_score") is not None else (d.get("score") or 50.0))
    d["trust_score"] = round(t_score, 1)
    d["score"] = round(t_score, 1)
    wr = float(d.get("win_rate") if d.get("win_rate") is not None else 0.0)
    wr_pct = wr * 100.0 if wr <= 1.0 else wr
    d["win_rate"] = round(wr if wr <= 1.0 else wr / 100.0, 4)
    d["win_rate_pct"] = round(wr_pct, 1)
    d["profit_factor"] = round(float(d.get("profit_factor") or 1.0), 2)
    d["total_signals"] = int(d.get("total_signals") or 0)
    return d


def list_sources(status: Optional[str] = None) -> List[Dict[str, Any]]:
    """List all registered signal sources with performance metrics."""
    with tx() as c:
        # Clean up any legacy master account copy feed entry if present
        try:
            c.execute(
                "DELETE FROM signal_sources WHERE id = 'src_metaapi_feed' OR source_type = 'metaapi_feed' OR name LIKE '%MetaApi Demo Signal Feed%'"
            )
        except Exception:
            pass
        if status:
            rows = c.execute(
                "SELECT * FROM signal_sources WHERE status = ? ORDER BY trust_score DESC",
                (status,)
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM signal_sources ORDER BY trust_score DESC, total_signals DESC"
            ).fetchall()
        return [_enrich_source_row(dict(r)) for r in rows]


def get_source(source_id: str) -> Optional[Dict[str, Any]]:
    """Get single source by ID."""
    with tx() as c:
        row = c.execute("SELECT * FROM signal_sources WHERE id = ?", (source_id,)).fetchone()
        return _enrich_source_row(dict(row)) if row else None


def create_source(
    name: str,
    source_type: str,
    status: str = "SHADOW_ONLY",
    symbol_universe: str = "XAUUSD,EURUSD,GBPUSD,USDJPY",
    config_json: Optional[dict] = None,
    source_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Register a new signal source in SHADOW_ONLY or ACTIVE_LIVE status."""
    resolved_id = (source_id or "").strip() or f"src_{uuid.uuid4().hex[:8]}"
    now_ts = time.time()
    cfg_str = json.dumps(config_json or {})
    norm_status = "SHADOW_ONLY" if status.upper() in ("SANDBOX", "SHADOW", "SHADOW_ONLY") else (
        "ACTIVE_LIVE" if status.upper() in ("TRUSTED", "ACTIVE", "ACTIVE_LIVE") else status.upper()
    )

    # Check active limit if requesting ACTIVE_LIVE directly
    if norm_status == "ACTIVE_LIVE":
        active_count = count_active_sources()
        if active_count >= MAX_ACTIVE_LIVE_SOURCES:
            norm_status = "SHADOW_ONLY"

    with tx() as c:
        c.execute(
            """
            INSERT INTO signal_sources (
                id, name, source_type, status, symbol_universe,
                trust_score, profit_factor, win_rate, max_drawdown_pips,
                total_signals, evaluated_signals, config_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 50.0, 1.0, 0.5, 0.0, 0, 0, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                name = excluded.name,
                source_type = excluded.source_type,
                updated_at = excluded.updated_at
            """,
            (resolved_id, name or resolved_id, source_type, norm_status, symbol_universe, cfg_str, now_ts, now_ts)
        )
    return get_source(resolved_id) or {}


def count_active_sources() -> int:
    """Return count of currently ACTIVE_LIVE sources."""
    with tx() as c:
        row = c.execute("SELECT COUNT(*) FROM signal_sources WHERE status = 'ACTIVE_LIVE'").fetchone()
        return int(row[0] if row else 0)


def get_sources_counts() -> Dict[str, int]:
    """Return real-time counts of signal sources grouped by status."""
    with tx() as c:
        rows = c.execute("SELECT status, COUNT(*) FROM signal_sources GROUP BY status").fetchall()
        counts = {r[0]: int(r[1]) for r in rows}
        return {
            "active_live": counts.get("ACTIVE_LIVE", 0),
            "shadow_only": counts.get("SHADOW_ONLY", 0),
            "suspended": counts.get("SUSPENDED", 0),
            "demoted": counts.get("DEMOTED", 0),
            "retired": counts.get("RETIRED", 0),
        }


def promote_source_to_live(source_id: str, force: bool = False) -> Tuple[bool, str]:
    """Promote a SHADOW_ONLY source to ACTIVE_LIVE if eligible.
    Enforces maximum MAX_ACTIVE_LIVE_SOURCES (2-3) active sources.
    Requires minimum observation data unless force=True.
    """
    now_ts = time.time()
    with tx() as c:
        src = c.execute("SELECT * FROM signal_sources WHERE id = ?", (source_id,)).fetchone()
        if not src:
            return False, "Nguồn tín hiệu không tồn tại."

        src_d = dict(src)
        if src_d["status"] == "ACTIVE_LIVE":
            return True, "Nguồn tín hiệu đã ở trạng thái ACTIVE_LIVE."

        if src_d["status"] == "SUSPENDED" and not force:
            return False, "Nguồn tín hiệu đang bị TẠM ĐÌNH CHỈ (SUSPENDED). Cần gỡ đình chỉ trước khi thăng hạng."

        # Verify historical shadow performance before auto-promoting
        if not force:
            shadow_stats = c.execute(
                "SELECT COUNT(*) AS total, SUM(CASE WHEN pnl_pips > 0 THEN 1 ELSE 0 END) AS wins FROM shadow_signals WHERE source_id = ? AND eval_status != 'PENDING'",
                (source_id,)
            ).fetchone()
            if shadow_stats and shadow_stats["total"] >= 10:
                win_rate = shadow_stats["wins"] / shadow_stats["total"]
                if win_rate < 0.50:
                    return False, f"Nguồn chưa đạt chuẩn thăng hạng (Tỷ lệ thắng {win_rate*100:.1f}% < 50% qua {shadow_stats['total']} lệnh)."

        # Count current active sources
        active_rows = c.execute("SELECT id, name, trust_score FROM signal_sources WHERE status = 'ACTIVE_LIVE' ORDER BY trust_score ASC").fetchall()
        if len(active_rows) >= MAX_ACTIVE_LIVE_SOURCES:
            # Auto-demote the lowest scoring active source to maintain elite cap
            lowest = dict(active_rows[0])
            c.execute("UPDATE signal_sources SET status = 'SHADOW_ONLY', updated_at = ? WHERE id = ?", (now_ts, lowest["id"]))
            logger.info(f"Auto-demoted source {lowest['name']} to SHADOW_ONLY to make room for {src_d['name']}")

        c.execute("UPDATE signal_sources SET status = 'ACTIVE_LIVE', updated_at = ? WHERE id = ?", (now_ts, source_id))
    return True, f"Đã thăng hạng [{src_d['name']}] lên ACTIVE_LIVE thành công."


def demote_source_to_shadow(source_id: str, reason: str = "") -> Tuple[bool, str]:
    """Demote an ACTIVE_LIVE source to SHADOW_ONLY."""
    now_ts = time.time()
    with tx() as c:
        src = c.execute("SELECT * FROM signal_sources WHERE id = ?", (source_id,)).fetchone()
        if not src:
            return False, "Nguồn tín hiệu không tồn tại."
        src_d = dict(src)
        c.execute("UPDATE signal_sources SET status = 'SHADOW_ONLY', updated_at = ? WHERE id = ?", (now_ts, source_id))
    logger.info(f"Source {source_id} demoted to SHADOW_ONLY. Reason: {reason}")
    return True, f"Đã hạ cấp [{src_d['name']}] về kho theo dõi SHADOW_ONLY."


def record_shadow_signal(
    source_id: str,
    symbol: str,
    side: str = "BUY",
    entry_price: float = 0.0,
    stop_loss: Optional[float] = None,
    take_profit: Optional[float] = None,
    signal_time: Optional[float] = None,
    context_snapshot: Optional[dict] = None,
    action: Optional[str] = None,
    sl: Optional[float] = None,
    tp: Optional[float] = None,
    metadata: Optional[dict] = None,
    db_cursor: Any = None,
    **kwargs
) -> str:
    """Record passive signal to shadow_signals ledger for offline M1 evaluation and agent learning."""
    sig_id = f"shd_{uuid.uuid4().hex[:10]}"
    now_ts = signal_time or time.time()
    effective_side = (action or side or "BUY").upper()
    effective_sl = stop_loss if stop_loss is not None else sl
    effective_tp = take_profit if take_profit is not None else tp
    ctx = context_snapshot or metadata
    ctx_str = json.dumps(ctx) if ctx else None

    def _do_insert(c):
        # Ensure source_id exists in signal_sources to satisfy FK constraint on PostgreSQL
        src_row = c.execute(
            "SELECT id FROM signal_sources WHERE id = ? OR name = ?",
            (source_id, source_id)
        ).fetchone()
        resolved_source_id = src_row[0] if src_row else source_id
        if not src_row:
            c.execute(
                """
                INSERT INTO signal_sources (
                    id, name, source_type, status, symbol_universe,
                    trust_score, profit_factor, win_rate, max_drawdown_pips,
                    total_signals, evaluated_signals, config_json, created_at, updated_at
                ) VALUES (?, ?, 'webhook', 'SHADOW_ONLY', ?, 50.0, 1.0, 0.5, 0.0, 0, 0, '{}', ?, ?)
                ON CONFLICT (id) DO NOTHING
                """,
                (resolved_source_id, str(source_id), symbol.upper(), now_ts, now_ts)
            )

        c.execute(
            """
            INSERT INTO shadow_signals (
                id, source_id, symbol, side, entry_price, stop_loss, take_profit,
                signal_time, eval_status, context_snapshot, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
            """,
            (sig_id, resolved_source_id, symbol.upper(), effective_side, entry_price, effective_sl, effective_tp, now_ts, ctx_str, now_ts)
        )
        c.execute(
            "UPDATE signal_sources SET total_signals = total_signals + 1, updated_at = ? WHERE id = ?",
            (now_ts, resolved_source_id)
        )

    if db_cursor:
        _do_insert(db_cursor)
    else:
        with tx() as c:
            _do_insert(c)
    return sig_id


def _recompute_source_metrics(c, source_id: str, min_signal_time: Optional[float] = None) -> Dict[str, Any]:
    """Recompute win_rate, profit_factor, max_drawdown_pips, and trust_score from shadow_signals."""
    if min_signal_time is not None:
        rows = c.execute(
            "SELECT eval_status, pnl_pips FROM shadow_signals WHERE source_id = ? AND signal_time >= ? ORDER BY signal_time ASC",
            (source_id, min_signal_time),
        ).fetchall()
    else:
        rows = c.execute(
            "SELECT eval_status, pnl_pips FROM shadow_signals WHERE source_id = ? ORDER BY signal_time ASC",
            (source_id,),
        ).fetchall()
    total_signals = len(rows)
    eval_rows = [dict(r) for r in rows if str(r["eval_status"]) in ("WIN_TP", "LOSS_SL", "EXPIRED")]
    evaluated_signals = len(eval_rows)
    if evaluated_signals == 0:
        if min_signal_time is None:
            c.execute(
                "UPDATE signal_sources SET total_signals = ?, evaluated_signals = 0, updated_at = ? WHERE id = ?",
                (total_signals, time.time(), source_id),
            )
        return {
            "total_signals": total_signals,
            "evaluated_signals": 0,
            "win_rate": 0.0,
            "profit_factor": 1.0,
            "max_drawdown_pips": 0.0,
            "trust_score": 0.0,
        }

    wins = 0
    gross_profit = 0.0
    gross_loss = 0.0
    cum_pnl = 0.0
    peak_pnl = 0.0
    max_dd = 0.0
    for r in eval_rows:
        pnl = float(r.get("pnl_pips") or 0.0)
        if r["eval_status"] == "WIN_TP" or pnl > 0:
            wins += 1
        if pnl > 0:
            gross_profit += pnl
        elif pnl < 0:
            gross_loss += abs(pnl)
        cum_pnl += pnl
        if cum_pnl > peak_pnl:
            peak_pnl = cum_pnl
        dd = peak_pnl - cum_pnl
        if dd > max_dd:
            max_dd = dd

    win_rate = round(wins / evaluated_signals, 4)
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else (round(min(5.0, max(1.0, gross_profit / 10.0)), 2) if gross_profit > 0 else 1.0)
    # Trust score (0-100): combines win rate (45%), profit factor (40%), and drawdown discipline (15%)
    pf_score = min(1.0, profit_factor / 2.5)
    dd_penalty = min(1.0, max_dd / 200.0)
    trust_score = round(max(0.0, min(100.0, (win_rate * 45.0) + (pf_score * 40.0) + ((1.0 - dd_penalty) * 15.0))), 1)

    if min_signal_time is None:
        c.execute(
            """
            UPDATE signal_sources
            SET trust_score = ?, profit_factor = ?, win_rate = ?, max_drawdown_pips = ?,
                total_signals = ?, evaluated_signals = ?, updated_at = ?
            WHERE id = ?
            """,
            (trust_score, profit_factor, win_rate, round(max_dd, 1), total_signals, evaluated_signals, time.time(), source_id),
        )

    return {
        "total_signals": total_signals,
        "evaluated_signals": evaluated_signals,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "max_drawdown_pips": round(max_dd, 1),
        "trust_score": trust_score,
    }


def evaluate_shadow_signals_eod(source_id: Optional[str] = None) -> Dict[str, Any]:
    """End-of-Day (EOD) or periodic M1 candle grader:
    Matches all PENDING shadow signals against historical M1 candles.
    Conservative Rule: If a candle's [Low, High] range hits both Stop Loss and Take Profit,
    it is strictly classified as Stop Loss hit first.
    Calculates exact MAE, MFE, and recomputes Source Trust Score (0-100).
    """
    now_ts = time.time()
    evaluated_count = 0
    updated_sources = set()

    with tx() as c:
        symbol_subquery = "SELECT DISTINCT symbol FROM candles WHERE timeframe = 'M1'"
        if source_id:
            pending = c.execute(
                f"""
                SELECT * FROM shadow_signals
                WHERE source_id = ? AND eval_status IN ('PENDING', 'OPEN')
                ORDER BY CASE WHEN symbol IN ({symbol_subquery}) THEN 0 ELSE 1 END, signal_time ASC
                LIMIT 500
                """,
                (source_id,)
            ).fetchall()
        else:
            pending = c.execute(
                f"""
                SELECT * FROM shadow_signals
                WHERE eval_status IN ('PENDING', 'OPEN')
                ORDER BY CASE WHEN symbol IN ({symbol_subquery}) THEN 0 ELSE 1 END, signal_time ASC
                LIMIT 500
                """
            ).fetchall()
        if not pending:
            return {"evaluated": 0, "status": "no_pending_signals"}

        # Fetch recent M1 candles bounded by oldest pending signal_time (never load full table unbounded)
        from app.db import is_postgres, to_epoch_ts
        min_sig_ts = min(
            (float(dict(pr).get("signal_time") or now_ts) for pr in pending),
            default=now_ts - 86400 * 7,
        )
        time_cond = "time >= to_timestamp(?)" if is_postgres() else "time >= ?"
        candles = c.execute(
            f"SELECT symbol, time, open, high, low, close FROM candles WHERE timeframe = 'M1' AND {time_cond} ORDER BY time ASC LIMIT 10000",
            (min_sig_ts,),
        ).fetchall()
        candle_list = []
        for cd in candles:
            item = dict(cd)
            item["time"] = to_epoch_ts(item.get("time"))
            candle_list.append(item)

        for p_row in pending:
            p = dict(p_row)
            if p.get("entry_price") is None or p.get("stop_loss") is None:
                continue
            entry = float(p["entry_price"])
            sl = float(p["stop_loss"])
            tp = float(p["take_profit"]) if p["take_profit"] else None
            side = p["side"]
            sig_t = float(p["signal_time"])
            symbol = str(p["symbol"] or "XAUUSD").upper()

            # Filter candles for matching symbol that occurred after signal_time
            future_candles = [
                c_item for c_item in candle_list
                if str(c_item.get("symbol") or "XAUUSD").upper() == symbol and float(c_item["time"]) >= sig_t
            ]
            
            # If no stored M1 candles yet:
            if not future_candles:
                # Issue 13 Fix: If signal is older than 3 days and has no candle data, mark NO_CANDLE_DATA
                # to prevent permanently deadlocking the shadow evaluation queue
                if (now_ts - sig_t) > (86400 * 3):
                    c.execute(
                        "UPDATE shadow_signals SET eval_status = 'NO_CANDLE_DATA', exit_reason = 'NO_M1_CANDLES_IN_WINDOW' WHERE id = ?",
                        (p["id"],)
                    )
                continue

            outcome = _evaluate_against_candles(future_candles, entry, sl, tp, side, symbol=symbol, sig_time=sig_t)

            c.execute(
                """
                UPDATE shadow_signals SET
                    eval_status = ?,
                    exit_price = ?,
                    exit_time = ?,
                    exit_reason = ?,
                    pnl_pips = ?,
                    mae = ?,
                    mfe = ?
                WHERE id = ?
                """,
                (
                    outcome["status"],
                    outcome["exit_price"],
                    outcome["exit_time"],
                    outcome["exit_reason"],
                    outcome["pnl_pips"],
                    outcome["mae"],
                    outcome["mfe"],
                    p["id"]
                )
            )
            evaluated_count += 1
            updated_sources.add(p["source_id"])

        # Recompute Trust Scores for all touched sources
        for s_id in updated_sources:
            _recompute_source_metrics(c, s_id)

    return {
        "evaluated": evaluated_count,
        "sources_updated": len(updated_sources),
        "timestamp": now_ts
    }


def _evaluate_against_candles(
    candles: List[Dict[str, Any]],
    entry: float,
    sl: float,
    tp: Optional[float],
    side: str,
    symbol: str = "XAUUSD",
    sig_time: Optional[float] = None,
) -> Dict[str, Any]:
    """Evaluate against actual M1 high/low bars with conservative dual-touch rule."""
    from app.services.symbol_precision import pip_multiplier_for_symbol
    pip_mult = pip_multiplier_for_symbol(symbol)
    is_buy = side == "BUY"
    mae = 0.0
    mfe = 0.0
    first_time = float(sig_time) if (sig_time is not None and sig_time > 0) else (float(candles[0]["time"]) if candles else 0.0)

    for bar in candles:
        high = float(bar["high"])
        low = float(bar["low"])
        bar_time = float(bar["time"])
        if (bar_time - first_time) >= 86400.0:
            open_p = float(bar.get("open", bar["close"]))
            pnl_exp = (open_p - entry) if is_buy else (entry - open_p)
            return {
                "status": "EXPIRED",
                "exit_price": open_p,
                "exit_time": bar_time,
                "exit_reason": "SESSION_CLOSED",
                "pnl_pips": round(pnl_exp * pip_mult, 1),
                "mae": round(mae * pip_mult, 1),
                "mfe": round(mfe * pip_mult, 1),
            }

        if is_buy:
            bar_mae = max(0.0, entry - low)
            bar_mfe = max(0.0, high - entry)
            mae = max(mae, bar_mae)
            mfe = max(mfe, bar_mfe)

            hit_sl = low <= sl
            hit_tp = tp is not None and high >= tp

            # Conservative rule: if both hit in the same bar, count SL first
            if hit_sl and hit_tp:
                return {
                    "status": "LOSS_SL",
                    "exit_price": sl,
                    "exit_time": bar_time,
                    "exit_reason": "CONSERVATIVE_DUAL_HIT_SL",
                    "pnl_pips": round((sl - entry) * pip_mult, 1),
                    "mae": round(mae * pip_mult, 1),
                    "mfe": round(mfe * pip_mult, 1)
                }
            if hit_sl:
                return {
                    "status": "LOSS_SL",
                    "exit_price": sl,
                    "exit_time": bar_time,
                    "exit_reason": "SL_HIT",
                    "pnl_pips": round((sl - entry) * pip_mult, 1),
                    "mae": round(mae * pip_mult, 1),
                    "mfe": round(mfe * pip_mult, 1)
                }
            if hit_tp:
                return {
                    "status": "WIN_TP",
                    "exit_price": tp,
                    "exit_time": bar_time,
                    "exit_reason": "TP_HIT",
                    "pnl_pips": round((tp - entry) * pip_mult, 1),
                    "mae": round(mae * pip_mult, 1),
                    "mfe": round(mfe * pip_mult, 1)
                }
        else:
            # SELL
            bar_mae = max(0.0, high - entry)
            bar_mfe = max(0.0, entry - low)
            mae = max(mae, bar_mae)
            mfe = max(mfe, bar_mfe)

            hit_sl = high >= sl
            hit_tp = tp is not None and low <= tp

            if hit_sl and hit_tp:
                return {
                    "status": "LOSS_SL",
                    "exit_price": sl,
                    "exit_time": bar_time,
                    "exit_reason": "CONSERVATIVE_DUAL_HIT_SL",
                    "pnl_pips": round((entry - sl) * pip_mult, 1),
                    "mae": round(mae * pip_mult, 1),
                    "mfe": round(mfe * pip_mult, 1)
                }
            if hit_sl:
                return {
                    "status": "LOSS_SL",
                    "exit_price": sl,
                    "exit_time": bar_time,
                    "exit_reason": "SL_HIT",
                    "pnl_pips": round((entry - sl) * pip_mult, 1),
                    "mae": round(mae * pip_mult, 1),
                    "mfe": round(mfe * pip_mult, 1)
                }
            if hit_tp:
                return {
                    "status": "WIN_TP",
                    "exit_price": tp,
                    "exit_time": bar_time,
                    "exit_reason": "TP_HIT",
                    "pnl_pips": round((entry - tp) * pip_mult, 1),
                    "mae": round(mae * pip_mult, 1),
                    "mfe": round(mfe * pip_mult, 1)
                }

    # Still open within available candles (mark EXPIRED only if >= 24h elapsed from first evaluated candle)
    first_time = float(candles[0]["time"])
    last_close = float(candles[-1]["close"])
    last_time = float(candles[-1]["time"])
    pnl = (last_close - entry) if is_buy else (entry - last_close)
    status_val = "EXPIRED" if (last_time - first_time) >= 86400.0 else "OPEN"
    return {
        "status": status_val,
        "exit_price": last_close,
        "exit_time": last_time,
        "exit_reason": "SESSION_CLOSED" if status_val == "EXPIRED" else "STILL_OPEN",
        "pnl_pips": round(pnl * pip_mult, 1),
        "mae": round(mae * pip_mult, 1),
        "mfe": round(mfe * pip_mult, 1)
    }


def run_instant_historical_replay(source_id: str, days: int = 90) -> Dict[str, Any]:
    """Cold-Start Bootstrapping:
    Replays source strategy against historical M1 candles and real shadow signals.
    If Profit Factor >= 1.5, Max Drawdown <= 8%, and 100% SL -> marks SEED_ACTIVE.
    """
    now_ts = time.time()
    source = get_source(source_id)
    if not source:
        return {"ok": False, "error": "Nguồn không tồn tại."}

    with tx() as c:
        # Issue 12 Fix: Filter strictly by requested replay window (days)
        cutoff_ts = now_ts - float(days * 86400)
        signals = c.execute(
            """
            SELECT pnl_pips, eval_status, stop_loss FROM shadow_signals
            WHERE source_id = ? AND eval_status IN ('WIN_TP', 'LOSS_SL', 'EXPIRED')
              AND signal_time >= ?
            """,
            (source_id, cutoff_ts)
        ).fetchall()

        active_cnt_row = c.execute("SELECT count(*) FROM signal_sources WHERE status = 'ACTIVE_LIVE'").fetchone()
        active_count = active_cnt_row[0] if active_cnt_row else 0

        if len(signals) >= 5:
            window_metrics = _recompute_source_metrics(c, source_id, min_signal_time=cutoff_ts)
            pf = float(window_metrics.get("profit_factor", 0.0))
            mdd = float(window_metrics.get("max_drawdown_pips", 0.0))
            wr = float(window_metrics.get("win_rate", 0.0))
            ts = float(window_metrics.get("trust_score", 0.0))
            is_qualified = bool(pf >= 1.5 and mdd <= 80.0)
            # Issue 12 Fix: Keep current status, do NOT auto-promote to ACTIVE_LIVE during backtest replay
            new_status = source["status"]
            c.execute("UPDATE signal_sources SET updated_at = ? WHERE id = ?", (now_ts, source_id))
            return {
                "ok": True,
                "source_id": source_id,
                "status": new_status,
                "new_status": new_status,
                "qualified": is_qualified,
                "qualified_seed_active": is_qualified,
                "trust_score": ts,
                "profit_factor": pf,
                "win_rate": wr,
                "max_drawdown_pips": mdd,
                "sample_size": len(signals),
                "simulated_trades": len(signals),
                "days_replayed": days,
            }
        else:
            candle_count_row = c.execute("SELECT count(*) FROM candles WHERE timeframe = 'M1'").fetchone()
            candle_count = candle_count_row[0] if candle_count_row else 0

            pf = float(source.get("profit_factor", 0.0))
            wr = float(source.get("win_rate", 0.0))
            mdd = float(source.get("max_drawdown_pips", 0.0))
            trust_score = float(source.get("trust_score", 70.0))
            is_qualified = bool(pf >= 1.5 and mdd <= 80.0) if pf > 0 else False

            new_status = "ACTIVE_LIVE" if is_qualified and active_count < MAX_ACTIVE_LIVE_SOURCES else source["status"]
            c.execute("UPDATE signal_sources SET updated_at = ? WHERE id = ?", (now_ts, source_id))

            trades_sim = len(signals)
            return {
                "ok": True,
                "source_id": source_id,
                "status": new_status,
                "new_status": new_status,
                "qualified": is_qualified,
                "qualified_seed_active": is_qualified,
                "trust_score": trust_score,
                "profit_factor": pf,
                "win_rate": wr,
                "max_drawdown_pips": mdd,
                "sample_size": len(signals),
                "simulated_trades": trades_sim,
                "days_replayed": days,
                "candles_available": candle_count,
                "note": "Kiểm định dựa trên dữ liệu thực tế đã ghi nhận trong hệ thống." if len(signals) >= 5 else "Chưa đủ >= 5 tín hiệu thực tế để đánh giá thăng hạng.",
            }


def get_source_leaderboard() -> List[Dict[str, Any]]:
    """Return sources ranked by trust score and performance for Admin Leaderboard."""
    return list_sources()


def get_shadow_signals(source_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    """Retrieve recent shadow ledger signals with evaluation details."""
    with tx() as c:
        if source_id:
            rows = c.execute(
                """
                SELECT * FROM shadow_signals
                WHERE source_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (source_id, limit)
            ).fetchall()
        else:
            rows = c.execute(
                """
                SELECT s.*, src.name as source_name
                FROM shadow_signals s
                LEFT JOIN signal_sources src ON s.source_id = src.id
                ORDER BY s.created_at DESC
                LIMIT ?
                """,
                (limit,)
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["action"] = d.get("side") or d.get("action") or "BUY"
            pnl_val = float(d.get("pnl_pips") if d.get("pnl_pips") is not None else (d.get("pnl") or 0.0))
            d["simulated_pnl_pips"] = round(pnl_val, 1)
            d["outcome"] = d.get("eval_status") or d.get("outcome") or "PENDING"
            result.append(d)
        return result


def auto_rotate_signal_sources(min_samples: int = 10) -> Dict[str, Any]:
    """Autonomous Source Funnel Rotation:
    - Demotes underperforming ACTIVE_LIVE sources (evaluated >= min_samples and PF < 1.1 or trust < 45).
    - Promotes top SHADOW_ONLY sources (evaluated >= min_samples, PF >= 1.4, WR >= 52%, trust >= 65)
      into ACTIVE_LIVE (up to MAX_ACTIVE_LIVE_SOURCES, replacing weaker active sources if needed).
    """
    now_ts = time.time()
    demoted: List[str] = []
    promoted: List[str] = []

    with tx() as c:
        from app.db import audit
        rows = [dict(r) for r in c.execute("SELECT * FROM signal_sources ORDER BY trust_score DESC").fetchall()]

        # 1. Demote failing ACTIVE_LIVE sources
        for s in rows:
            if s.get("status") == "ACTIVE_LIVE" and int(s.get("evaluated_signals") or 0) >= min_samples:
                pf = float(s.get("profit_factor") or 0.0)
                ts = float(s.get("trust_score") or 0.0)
                if pf < 1.1 or ts < 45.0:
                    c.execute("UPDATE signal_sources SET status = 'DEMOTED', updated_at = ? WHERE id = ?", (now_ts, s["id"]))
                    s["status"] = "DEMOTED"
                    demoted.append(s["id"])
                    audit(c, "curator_auto_rotate", "source_demoted", {"source_id": s["id"], "pf": pf, "trust": ts})

        # 2. Promote qualified SHADOW_ONLY sources
        active_list = [s for s in rows if s.get("status") == "ACTIVE_LIVE"]
        active_list.sort(key=lambda x: float(x.get("trust_score") or 0.0))

        shadow_candidates = [
            s for s in rows
            if s.get("status") == "SHADOW_ONLY"
            and int(s.get("evaluated_signals") or 0) >= min_samples
            and float(s.get("profit_factor") or 0.0) >= 1.4
            and float(s.get("win_rate") or 0.0) >= 0.52
            and float(s.get("trust_score") or 0.0) >= 65.0
        ]

        for cand in shadow_candidates:
            if len(active_list) < MAX_ACTIVE_LIVE_SOURCES:
                c.execute("UPDATE signal_sources SET status = 'ACTIVE_LIVE', updated_at = ? WHERE id = ?", (now_ts, cand["id"]))
                active_list.append(cand)
                promoted.append(cand["id"])
                audit(c, "curator_auto_rotate", "source_promoted", {"source_id": cand["id"], "trust": cand.get("trust_score")})
            elif active_list and float(cand.get("trust_score") or 0.0) >= float(active_list[0].get("trust_score") or 0.0) + 10.0:
                weakest = active_list.pop(0)
                c.execute("UPDATE signal_sources SET status = 'SHADOW_ONLY', updated_at = ? WHERE id = ?", (now_ts, weakest["id"]))
                c.execute("UPDATE signal_sources SET status = 'ACTIVE_LIVE', updated_at = ? WHERE id = ?", (now_ts, cand["id"]))
                active_list.append(cand)
                active_list.sort(key=lambda x: float(x.get("trust_score") or 0.0))
                demoted.append(weakest["id"])
                promoted.append(cand["id"])
                audit(c, "curator_auto_rotate", "source_rotated", {"promoted": cand["id"], "replaced": weakest["id"]})

    return {"ok": True, "promoted": promoted, "demoted": demoted}



# Backwards-compatibility aliases
log_shadow_signal = record_shadow_signal
ingest_shadow_signal = record_shadow_signal
