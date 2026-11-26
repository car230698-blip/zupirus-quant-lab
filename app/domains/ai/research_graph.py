"""Tabula Rasa Inductive Research Graph.
Learns strategy candidates inductively from external signal observations and market context snapshots.
Integrated with TimescaleDB, PostgreSQL checkpointer, Hindsight memory, and LangSmith tracing.
Research results never control live execution automatically without verification.
"""
import time, json, os, uuid, logging, math
from typing import TypedDict, Dict, Any, List, Optional, Tuple
import httpx
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command
from app.db import DATA, ROOT, tx, init, setkv, audit, is_postgres, DATABASE_URL
from app.tracing import trace_langgraph_step, trace_ai_interaction
from app.domains.ai.hindsight import reflect_on_policy_approval, store_memory
from app.domains.ai.gemini_client import call_gemini

logger = logging.getLogger("zupirus.research")

DEFAULT_SL_POINTS = 6.0
DEFAULT_TP_POINTS = 12.0


class State(TypedDict, total=False):
    candidate: dict
    report: dict
    approved: bool
    disposition: str


def discover_candidate_from_observations(
    c=None,
    symbol: str = "XAUUSD",
    max_created_at: Optional[float] = None,
) -> Dict[str, Any]:
    """Tabula Rasa induction: Analyzes real observed external signals from signal_audit_logs
    and discovers rule candidates from profitable clusters (isolated by symbol and cutoff timestamp).
    Returns status='insufficient_data' if real concluded trades with pnl are insufficient.
    """
    if c is None:
        with tx() as conn:
            return discover_candidate_from_observations(conn, symbol=symbol, max_created_at=max_created_at)

    sym_u = str(symbol or "XAUUSD").strip().upper()
    # 1. Query observed signals with real market context snapshots and realized PnL for target symbol
    rows = []
    try:
        if max_created_at is not None:
            cutoff_val = float(max_created_at)
            rows = c.execute(
                """
                SELECT side, entry_price, pnl, context_snapshot, created_at, processed_at
                FROM signal_audit_logs
                WHERE context_snapshot IS NOT NULL AND pnl IS NOT NULL
                  AND UPPER(COALESCE(symbol, 'XAUUSD')) = ?
                  AND created_at <= ?
                  AND COALESCE(processed_at, created_at) <= ?
                ORDER BY created_at DESC LIMIT 200
                """,
                (sym_u, cutoff_val, cutoff_val),
            ).fetchall()
        else:
            rows = c.execute(
                """
                SELECT side, entry_price, pnl, context_snapshot, created_at, processed_at
                FROM signal_audit_logs
                WHERE context_snapshot IS NOT NULL AND pnl IS NOT NULL
                  AND UPPER(COALESCE(symbol, 'XAUUSD')) = ?
                ORDER BY created_at DESC LIMIT 200
                """,
                (sym_u,),
            ).fetchall()
    except Exception as e:
        logger.debug(f"Query signal_audit_logs error: {e}")

    # Require at least 5 realized trades to induce candidate rules
    if not rows or len(rows) < 5:
        return {
            "status": "insufficient_data",
            "name": "TabulaRasa-Alpha-Observing",
            "sample_size": len(rows),
            "empirical_win_rate": None,
            "message": "Chưa đủ dữ liệu tín hiệu đã đóng có PnL để tổng hợp chiến lược Tabula Rasa.",
            "rules": {
                "preferred_session": "London",
                "action": "STAND_ASIDE",
                "min_slope": 0.20,
                "sl_points": DEFAULT_SL_POINTS,
                "tp_points": DEFAULT_TP_POINTS,
            }
        }

    # Extract winning patterns from real trades grouped by (session, side)
    session_side_wins: Dict[Tuple[str, str], List[float]] = {}
    for r in rows:
        raw_side = str((r["side"] if hasattr(r, "keys") else r[0]) or "BUY").upper()
        side = "SELL" if raw_side == "SELL" else "BUY"
        pnl = float(r["pnl"] if hasattr(r, 'keys') else r[2])
        ctx_str = r["context_snapshot"] if hasattr(r, 'keys') else r[3]
        sess = "London"
        if ctx_str:
            try:
                sess = json.loads(ctx_str).get("session", "London")
            except Exception:
                pass
        session_side_wins.setdefault((sess, side), []).append(pnl)

    # Pick (session, side) cluster with highest positive expectancy
    best_sess, best_side = max(session_side_wins.keys(), key=lambda k: sum(session_side_wins[k]))
    pnls = session_side_wins[(best_sess, best_side)]
    if sum(pnls) <= 0:
        return {
            "status": "insufficient_data",
            "name": "TabulaRasa-Alpha-NegativeExpectancy",
            "sample_size": len(pnls),
            "empirical_win_rate": round(sum(1 for p in pnls if p > 0) / max(len(pnls), 1), 2),
            "message": "Cụm quan sát có kỳ vọng lợi nhuận âm (Expectancy <= 0). AI giữ trạng thái STAND_ASIDE, không tự đảo ngược lệnh.",
            "rules": {
                "preferred_session": best_sess,
                "action": "STAND_ASIDE",
                "min_slope": 0.20,
                "sl_points": DEFAULT_SL_POINTS,
                "tp_points": DEFAULT_TP_POINTS,
            }
        }
    preferred_session = best_sess
    win_rate = round(sum(1 for p in pnls if p > 0) / max(len(pnls), 1), 2)
    sample_size = len(pnls)
    inferred_action = best_side

    candidate_id = f"cand_{uuid.uuid4().hex[:8]}"
    candidate_name = f"TabulaRasa-Alpha-{preferred_session}"
    rules = {
        "symbol": sym_u,
        "preferred_session": preferred_session,
        "action": inferred_action,
        "min_slope": 0.20,
        "sl_points": DEFAULT_SL_POINTS,
        "tp_points": DEFAULT_TP_POINTS,
    }

    # Stage 2: Semantic RAG rule grounding
    try:
        from app.domains.ai.ingest_swarm import retrieve_relevant_knowledge
        rag_chunks = retrieve_relevant_knowledge(c, query=f"{sym_u} {preferred_session} breakout order block", top_k=2)
        if rag_chunks:
            rules["institutional_rag_basis"] = [
                {"id": chk["id"], "school": chk["school"], "similarity": chk["similarity"]}
                for chk in rag_chunks
            ]
    except Exception as exc:
        logger.debug(f"Semantic RAG enrichment skipped: {exc}")

    # Record candidate in strategy_candidates table with unmeasured WFO metrics (NULL)
    now_ts = time.time()
    try:
        c.execute(
            """
            INSERT INTO strategy_candidates (
                id, name, status, rules_json, sample_size, win_rate,
                profit_factor, sharpe_ratio, max_drawdown_pct, oos_net_units,
                created_at, updated_at
            ) VALUES (?, ?, 'DISCOVERED', ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
            ON CONFLICT(id) DO UPDATE SET updated_at = ?
            """,
            (
                candidate_id, candidate_name, json.dumps(rules),
                sample_size, win_rate, now_ts, now_ts, now_ts
            )
        )
    except Exception as e:
        logger.warning(f"Could not persist strategy candidate: {e}")

    max_obs_ts = 0.0
    for r in rows:
        c_ts = float((r["created_at"] if hasattr(r, "keys") and "created_at" in r else (r[4] if len(r) > 4 else 0.0)) or 0.0)
        p_ts = float((r["processed_at"] if hasattr(r, "keys") and "processed_at" in r else (r[5] if len(r) > 5 else 0.0)) or c_ts)
        max_obs_ts = max(max_obs_ts, c_ts, p_ts)

    return {
        "id": candidate_id,
        "name": candidate_name,
        "rules": rules,
        "sample_size": sample_size,
        "empirical_win_rate": win_rate,
        "max_observation_ts": max_obs_ts,
        "discovery_cutoff_ts": float(max_created_at) if max_created_at is not None else None,
    }


def _normalize_session_label(val: Optional[str]) -> str:
    if not val:
        return ""
    s = str(val).strip().lower()
    if s in ("london", "ldn", "eu"):
        return "london"
    if s in ("new york", "ny", "new_york", "us"):
        return "new york"
    if s in ("asia", "asian", "tokyo"):
        return "asia"
    if "overlap" in s or ("london" in s and "new york" in s):
        return "london/new york overlap"
    return s


def _compute_causal_h1_trend(prices: List[Any], idx: int) -> str:
    """Compute causal H1 trend from 16 M15 bars ending at idx (inclusive).
    Never returns NEUTRAL when fewer than 16 bars are available; returns UNKNOWN."""
    if idx < 15 or len(prices) < 16 or idx >= len(prices):
        return "UNKNOWN"
    window = prices[idx - 15 : idx + 1]
    if len(window) < 16:
        return "UNKNOWN"
    closes: List[float] = []
    for b in window:
        if isinstance(b, dict):
            if b.get("close") is None:
                return "UNKNOWN"
            closes.append(float(b["close"]))
        elif isinstance(b, (int, float)):
            closes.append(float(b))
        else:
            return "UNKNOWN"
    sma_short = sum(closes[-4:]) / 4.0
    sma_long = sum(closes) / 16.0
    if sma_short > sma_long * 1.0006:
        return "BULLISH"
    if sma_short < sma_long * 0.9994:
        return "BEARISH"
    return "NEUTRAL"


def _compute_causal_liquidity_sweep(prices: List[Any], idx: int, lookback: int = 15) -> Optional[bool]:
    """Verify if bar at idx swept prior swing high/low and closed back inside.
    Returns None if insufficient OHLC bars are available."""
    if idx < lookback or idx >= len(prices):
        return None
    cur = prices[idx]
    if not isinstance(cur, dict):
        return None
    if " swept_liquidity" in cur or "swept_liquidity" in cur:
        if cur.get("swept_liquidity") is not None:
            return bool(cur.get("swept_liquidity"))
    if "high" not in cur or "low" not in cur or "close" not in cur:
        return None
    prev_slice = prices[max(0, idx - 20) : idx]
    if len(prev_slice) < lookback:
        return None
    highs: List[float] = []
    lows: List[float] = []
    for b in prev_slice:
        if not isinstance(b, dict) or "high" not in b or "low" not in b:
            return None
        highs.append(float(b["high"]))
        lows.append(float(b["low"]))
    swing_high = max(highs)
    swing_low = min(lows)
    cur_h = float(cur["high"])
    cur_l = float(cur["low"])
    cur_c = float(cur["close"])
    return bool((cur_h > swing_high and cur_c < swing_high) or (cur_l < swing_low and cur_c > swing_low))


def evaluate_candidate_window_detailed(prices: List[Any], candidate_rules: Dict[str, Any]) -> Dict[str, Any]:
    """Detailed causal OOS window evaluator enforcing preferred_session, h1_trend, and swept_liquidity.
    Never defaults missing H1 trend to NEUTRAL; returns insufficient_evidence if declared conditions lack verifiable bars."""
    raw_sl = float(candidate_rules.get("sl_points", DEFAULT_SL_POINTS))
    raw_tp = float(candidate_rules.get("tp_points", DEFAULT_TP_POINTS))
    target_action = str(candidate_rules.get("action", "BUY") or "BUY").upper()
    min_slope = float(candidate_rules.get("min_slope", 0.20))

    pref_sess_raw = candidate_rules.get("preferred_session") or candidate_rules.get("session")
    pref_sess = _normalize_session_label(pref_sess_raw) if pref_sess_raw else ""
    require_session = bool(pref_sess and pref_sess.upper() not in ("ALL", "ANY"))

    req_h1_raw = candidate_rules.get("h1_trend")
    req_h1 = str(req_h1_raw).strip().upper() if req_h1_raw is not None else ""
    require_h1 = bool(req_h1 and req_h1 not in ("ALL", "ANY"))

    req_swept = (
        candidate_rules.get("swept_liquidity")
        if "swept_liquidity" in candidate_rules
        else (
            candidate_rules.get("liquidity_sweep")
            if "liquidity_sweep" in candidate_rules
            else candidate_rules.get("require_swept_liquidity")
        )
    )
    require_swept = req_swept is not None

    ref_price = 2650.0
    if prices:
        first_bar = prices[0]
        ref_price = float(first_bar["close"]) if isinstance(first_bar, dict) and "close" in first_bar else (float(first_bar) if isinstance(first_bar, (int, float)) else 2650.0)

    if ref_price < 10.0:
        asset_scale = 0.001
        cost_pips = float(os.getenv("WFO_ROUNDTRIP_COST_PIPS_FX", os.getenv("WFO_ROUNDTRIP_COST_PIPS", "1.5")).strip())
        spread_cost = cost_pips * 0.0001
    elif ref_price < 300.0:
        asset_scale = 0.1
        cost_pips = float(os.getenv("WFO_ROUNDTRIP_COST_PIPS_FX", os.getenv("WFO_ROUNDTRIP_COST_PIPS", "1.5")).strip())
        spread_cost = cost_pips * 0.01
    else:
        asset_scale = 1.0
        cost_pips = float(os.getenv("WFO_ROUNDTRIP_COST_PIPS_GOLD", os.getenv("WFO_ROUNDTRIP_COST_PIPS", "3.5")).strip())
        spread_cost = cost_pips * 0.10

    sl = (raw_sl * asset_scale) if raw_sl >= 1.0 and asset_scale < 1.0 else raw_sl
    tp = (raw_tp * asset_scale) if raw_tp >= 1.0 and asset_scale < 1.0 else raw_tp

    if len(prices) < 16:
        return {
            "net_pnl": 0.0,
            "returns": [],
            "session_breakdown": {},
            "insufficient_evidence": True,
            "insufficient_reason": "insufficient_bars_for_h1_trend",
            "h1_trend_state": "UNKNOWN",
            "cost_model_pips": cost_pips,
            "spread_cost_units": spread_cost,
        }

    if require_h1 and req_h1 == "UNKNOWN":
        return {
            "net_pnl": 0.0,
            "returns": [],
            "session_breakdown": {},
            "insufficient_evidence": True,
            "insufficient_reason": "declared_h1_trend_is_unknown",
            "h1_trend_state": "UNKNOWN",
            "cost_model_pips": cost_pips,
            "spread_cost_units": spread_cost,
        }

    returns: List[float] = []
    session_returns: Dict[str, List[float]] = {}
    position: Optional[Tuple[float, int, str]] = None

    verifiable_session_bars = 0
    verifiable_h1_bars = 0
    verifiable_swept_bars = 0
    last_h1_state = "UNKNOWN"

    from app.db import to_epoch_ts
    from app.services.signal_ingestion.context import get_trading_session

    for t in range(15, len(prices)):
        bar = prices[t]
        is_ohlc = isinstance(bar, dict)
        close_p = float(bar["close"]) if is_ohlc else float(bar)
        high_p = float(bar.get("high", close_p)) if is_ohlc else close_p
        low_p = float(bar.get("low", close_p)) if is_ohlc else close_p

        if position:
            entry, direction, entry_sess = position
            if direction == 1:
                if low_p - entry <= -sl:
                    ret_val = -sl - spread_cost
                    returns.append(ret_val)
                    session_returns.setdefault(entry_sess, []).append(ret_val)
                    position = None
                    continue
                if high_p - entry >= tp:
                    ret_val = tp - spread_cost
                    returns.append(ret_val)
                    session_returns.setdefault(entry_sess, []).append(ret_val)
                    position = None
                    continue
            else:
                if entry - high_p <= -sl:
                    ret_val = -sl - spread_cost
                    returns.append(ret_val)
                    session_returns.setdefault(entry_sess, []).append(ret_val)
                    position = None
                    continue
                if entry - low_p >= tp:
                    ret_val = tp - spread_cost
                    returns.append(ret_val)
                    session_returns.setdefault(entry_sess, []).append(ret_val)
                    position = None
                    continue
            continue

        if t >= len(prices) - 1:
            continue

        # 1. Resolve and enforce session condition
        bar_time = bar.get("time") if is_ohlc else None
        bar_sess_raw = bar.get("session") if is_ohlc else None
        if not bar_sess_raw and bar_time is not None:
            try:
                ep = to_epoch_ts(bar_time)
                if ep and ep > 0:
                    bar_sess_raw = get_trading_session(float(ep))
            except Exception:
                bar_sess_raw = None
        bar_sess_norm = _normalize_session_label(bar_sess_raw) if bar_sess_raw else ""
        if bar_sess_norm:
            verifiable_session_bars += 1

        if require_session:
            if not bar_sess_norm or bar_sess_norm != pref_sess:
                continue

        # 2. Resolve and enforce H1 trend condition (never defaulting <16 bars or missing to NEUTRAL)
        if is_ohlc and bar.get("h1_trend") is not None:
            bar_h1 = str(bar.get("h1_trend")).strip().upper()
        else:
            bar_h1 = _compute_causal_h1_trend(prices, t)
        if bar_h1 != "UNKNOWN":
            verifiable_h1_bars += 1
            last_h1_state = bar_h1
        if require_h1:
            if bar_h1 == "UNKNOWN" or bar_h1 != req_h1:
                continue

        # 3. Resolve and enforce liquidity sweep condition
        if require_swept:
            bar_swept = _compute_causal_liquidity_sweep(prices, t)
            if bar_swept is not None:
                verifiable_swept_bars += 1
            if bar_swept is None or bool(bar_swept) != bool(req_swept):
                continue

        # 4. Evaluate momentum slope over 10 intervals
        p_t10 = float(prices[t - 10]["close"]) if isinstance(prices[t - 10], dict) else float(prices[t - 10])
        p_next = (
            float(prices[t + 1]["open"])
            if isinstance(prices[t + 1], dict) and "open" in prices[t + 1]
            else (float(prices[t + 1]["close"]) if isinstance(prices[t + 1], dict) else float(prices[t + 1]))
        )
        slope = (close_p - p_t10) / 10.0
        price_scale = 0.001 if close_p < 10.0 else (0.1 if close_p < 300.0 else 1.0)
        slope_threshold = min_slope * price_scale
        sess_label = str(bar_sess_raw or (pref_sess_raw if require_session else "Unspecified"))
        if target_action in ("BUY", "BOTH") and slope >= slope_threshold:
            position = (p_next, 1, sess_label)
        elif target_action in ("SELL", "BOTH") and slope <= -slope_threshold:
            position = (p_next, -1, sess_label)

    if position:
        entry, direction, entry_sess = position
        last_c = float(prices[-1]["close"]) if isinstance(prices[-1], dict) else float(prices[-1])
        ret_val = (last_c - entry) * direction - spread_cost
        returns.append(ret_val)
        session_returns.setdefault(entry_sess, []).append(ret_val)

    insufficient_evidence = False
    insufficient_reason = None
    if require_session and verifiable_session_bars == 0:
        insufficient_evidence = True
        insufficient_reason = "missing_session_timestamps"
    elif require_h1 and verifiable_h1_bars == 0:
        insufficient_evidence = True
        insufficient_reason = "insufficient_bars_for_h1_trend"
    elif require_swept and verifiable_swept_bars == 0:
        insufficient_evidence = True
        insufficient_reason = "insufficient_ohlc_bars_for_liquidity_sweep"

    session_breakdown: Dict[str, Dict[str, Any]] = {}
    for s_name, s_rets in session_returns.items():
        s_cnt = len(s_rets)
        s_wins = sum(1 for r in s_rets if r > 0)
        s_net = round(sum(s_rets), 4)
        session_breakdown[s_name] = {
            "trades": s_cnt,
            "wins": s_wins,
            "win_rate": round(s_wins / max(s_cnt, 1), 2),
            "net_return": s_net,
            "expectancy": round(s_net / max(s_cnt, 1), 4),
        }

    return {
        "net_pnl": sum(returns),
        "returns": returns,
        "session_breakdown": session_breakdown,
        "insufficient_evidence": insufficient_evidence,
        "insufficient_reason": insufficient_reason,
        "h1_trend_state": last_h1_state,
        "cost_model_pips": cost_pips,
        "spread_cost_units": spread_cost,
    }


def score_candidate_on_window(prices: List[float], candidate_rules: Dict[str, Any]) -> Tuple[float, List[float]]:
    """Evaluates inductive candidate rules on a window of price series."""
    res = evaluate_candidate_window_detailed(prices, candidate_rules)
    return res["net_pnl"], res["returns"]


def walk_forward(prices: List[float], candidate: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Walk-Forward Optimization (WFO): Rolling 120 train / 60 Out-of-Sample verification
    for discovered inductive candidate rules. Prevents cross-fold lookahead leakage."""
    from app.db import to_epoch_ts

    def _bar_ts(bar: Any) -> Optional[float]:
        if isinstance(bar, dict) and bar.get("time") is not None:
            try:
                ts_val = to_epoch_ts(bar.get("time"))
                return float(ts_val) if ts_val and ts_val > 0 else None
            except Exception:
                return None
        return None

    now_wfo_ts = time.time()
    first_fold_cutoff_ts = _bar_ts(prices[119]) if len(prices) >= 120 else None
    first_bar_ts = _bar_ts(prices[0]) if len(prices) >= 180 else None
    last_bar_ts = _bar_ts(prices[-1]) if len(prices) >= 180 else None
    has_untrusted_source = any(
        isinstance(b, dict) and str(b.get("source") or "").strip().upper().startswith("YAHOO")
        for b in prices
    )
    has_future_or_unclosed_bars = bool(
        last_bar_ts is not None and (last_bar_ts + 900.0) > (now_wfo_ts + 60.0)
    )
    is_strictly_chronological = True
    if len(prices) >= 180 and first_bar_ts is not None and last_bar_ts is not None:
        prev_t = first_bar_ts
        for b in prices[1:]:
            bt = _bar_ts(b)
            if bt is None or bt <= prev_t:
                is_strictly_chronological = False
                break
            prev_t = bt
    else:
        is_strictly_chronological = False

    has_verified_timestamps = bool(
        len(prices) >= 180
        and first_fold_cutoff_ts is not None
        and first_bar_ts is not None
        and last_bar_ts is not None
        and not has_untrusted_source
        and not has_future_or_unclosed_bars
        and is_strictly_chronological
    )
    if candidate is None:
        candidate = discover_candidate_from_observations(max_created_at=first_fold_cutoff_ts)

    default_rules = {
        "action": "BUY",
        "min_slope": 0.20,
        "sl_points": DEFAULT_SL_POINTS,
        "tp_points": DEFAULT_TP_POINTS,
    }
    base_rules = candidate.get("rules", default_rules)
    rules = dict(base_rules)
    cand_max_obs_ts = float(candidate.get("max_observation_ts") or 0.0)

    folds = []
    all_returns = []
    agg_session_returns: Dict[str, List[float]] = {}
    any_fold_insufficient = False
    insufficient_reason: Optional[str] = None
    last_h1_state = _compute_causal_h1_trend(prices, len(prices) - 1) if len(prices) >= 16 else "UNKNOWN"

    # Pre-check window conditions when < 180 bars are passed
    if len(prices) < 180:
        pre_eval = evaluate_candidate_window_detailed(prices, base_rules)
        any_fold_insufficient = True
        insufficient_reason = pre_eval.get("insufficient_reason") or (
            "insufficient_bars_for_h1_trend" if len(prices) < 16 else "insufficient_bars_for_wfo_180"
        )
        last_h1_state = pre_eval.get("h1_trend_state", last_h1_state)

    for start in range(0, len(prices) - 180 + 1, 60):
        train = prices[start:start + 120]
        test = prices[start + 120:start + 180]

        fold_cutoff_ts = _bar_ts(train[-1]) if train else None
        fold_rules = base_rules
        if fold_cutoff_ts is not None and cand_max_obs_ts > fold_cutoff_ts:
            # Candidate includes observations newer than this fold's training window:
            # Re-discover candidate strictly using observations available up to fold_cutoff_ts
            fold_cand = discover_candidate_from_observations(max_created_at=fold_cutoff_ts)
            if not fold_cand or fold_cand.get("status") == "insufficient_data" or not fold_cand.get("id"):
                continue
            fold_rules = fold_cand.get("rules", default_rules)

        # Tune slope and risk-reward ratio parameters on in-sample train
        base_sl = float(fold_rules.get("sl_points", DEFAULT_SL_POINTS))
        param_grid = [
            (0.15, 1.5),
            (0.20, 2.0),
            (0.25, 2.0),
            (0.30, 2.5),
        ]
        best_slope, best_rr = max(
            param_grid,
            key=lambda p: score_candidate_on_window(
                train,
                {**fold_rules, "min_slope": p[0], "tp_points": base_sl * p[1]}
            )[0]
        )

        tuned_rules = {**fold_rules, "min_slope": best_slope, "tp_points": round(base_sl * best_rr, 2)}
        oos_detail = evaluate_candidate_window_detailed(test, tuned_rules)
        pnl = oos_detail["net_pnl"]
        rets = oos_detail["returns"]
        if oos_detail.get("insufficient_evidence"):
            any_fold_insufficient = True
            insufficient_reason = oos_detail.get("insufficient_reason")
        if oos_detail.get("h1_trend_state") and oos_detail.get("h1_trend_state") != "UNKNOWN":
            last_h1_state = oos_detail["h1_trend_state"]
        for s_name, s_info in (oos_detail.get("session_breakdown") or {}).items():
            # Rebuild session returns aggregation
            agg_session_returns.setdefault(s_name, [])
        # Also collect raw returns by session from oos_detail
        for s_name, s_info in (oos_detail.get("session_breakdown") or {}).items():
            s_cnt = int(s_info.get("trades") or 0)
            s_wins = int(s_info.get("wins") or 0)
            s_net = float(s_info.get("net_return") or 0.0)
            prev_info = agg_session_returns.get(s_name)
            if not isinstance(prev_info, dict):
                agg_session_returns[s_name] = {"trades": 0, "wins": 0, "net_return": 0.0}  # type: ignore[assignment]
            agg_session_returns[s_name]["trades"] += s_cnt  # type: ignore[index]
            agg_session_returns[s_name]["wins"] += s_wins  # type: ignore[index]
            agg_session_returns[s_name]["net_return"] = round(agg_session_returns[s_name]["net_return"] + s_net, 4)  # type: ignore[index]

        all_returns.extend(rets)
        folds.append({
            'train': [start, start + 119],
            'test': [start + 120, start + 179],
            'tuned_slope': best_slope,
            'tuned_rr': best_rr,
            'oos_net_price_units': round(pnl, 4),
            'trades': len(rets),
            'insufficient_evidence': bool(oos_detail.get("insufficient_evidence")),
        })

    equity = peak = dd = 0.0
    for value in all_returns:
        equity += value
        peak = max(peak, equity)
        dd = max(dd, peak - equity)

    net_oos = round(sum(all_returns), 4)
    max_dd = round(dd, 4)
    base_price = float(prices[0]["close"]) if prices and isinstance(prices[0], dict) else (float(prices[0]) if prices and float(prices[0]) > 0 else 2650.0)
    max_dd_pct = round((dd / max(base_price, 1.0)) * 100.0, 2)
    if folds:
        # Select deployed slope and RR strictly from the latest in-sample training window (zero OOS peeking)
        latest_fold = folds[-1]
        base_sl_latest = float(rules.get("sl_points", DEFAULT_SL_POINTS))
        rules = {
            **rules,
            "min_slope": latest_fold.get("tuned_slope", rules.get("min_slope", 0.20)),
            "tp_points": round(base_sl_latest * latest_fold.get("tuned_rr", 2.0), 2),
        }
        # Keep all_returns as the true walk-forward concatenated OOS returns to avoid look-ahead leakage

    trades_count = len(all_returns)
    wins = sum(1 for r in all_returns if r > 0)
    win_rate = round(wins / max(trades_count, 1), 2)
    expectancy_units = round(net_oos / max(trades_count, 1), 4) if trades_count > 0 else 0.0
    gross_win = abs(sum(r for r in all_returns if r > 0))
    gross_loss = abs(sum(r for r in all_returns if r < 0))
    profit_factor = round(
        (gross_win / gross_loss) if gross_loss > 0 else (min(gross_win, 9.99) if gross_win > 0 else 0.0),
        2
    )

    # Calculate Sharpe ratio if trades exist
    if trades_count > 1:
        mean_ret = sum(all_returns) / trades_count
        var_ret = sum((r - mean_ret) ** 2 for r in all_returns) / (trades_count - 1)
        std_ret = math.sqrt(var_ret) if var_ret > 0 else 0.001
        sharpe_ratio = round((mean_ret / std_ret) * math.sqrt(252), 2)
    else:
        sharpe_ratio = 0.0

    cand_is_insufficient = bool(
        candidate.get("status") in ("insufficient_data", "insufficient_evidence")
        or str(rules.get("action") or "").upper() == "STAND_ASIDE"
    )
    is_insufficient_evidence = bool(any_fold_insufficient or cand_is_insufficient or not folds)
    if is_insufficient_evidence and not insufficient_reason:
        insufficient_reason = "candidate_or_window_insufficient_evidence"

    is_qualified = bool(
        not is_insufficient_evidence
        and has_verified_timestamps
        and trades_count >= 10
        and net_oos > 0
        and max_dd_pct <= 8.0
        and win_rate >= 0.52
        and profit_factor >= 1.2
        and sharpe_ratio >= 1.2
    )

    # Institutional Cost Model metrics (B3)
    cost_model_pips = 3.5 if base_price >= 300.0 else 1.5
    try:
        if base_price >= 300.0:
            cost_model_pips = float(os.getenv("WFO_ROUNDTRIP_COST_PIPS_GOLD", os.getenv("WFO_ROUNDTRIP_COST_PIPS", "3.5")).strip())
        else:
            cost_model_pips = float(os.getenv("WFO_ROUNDTRIP_COST_PIPS_FX", os.getenv("WFO_ROUNDTRIP_COST_PIPS", "1.5")).strip())
    except Exception:
        pass

    spread_unit = (cost_model_pips * 0.10) if base_price >= 300.0 else (cost_model_pips * (0.01 if base_price >= 10.0 else 0.0001))
    gross_return = round(net_oos + (trades_count * spread_unit), 4)
    net_return_after_costs = round(net_oos, 4)

    session_breakdown_out: Dict[str, Dict[str, Any]] = {}
    for s_name, s_agg in agg_session_returns.items():
        if isinstance(s_agg, dict):
            s_t = int(s_agg.get("trades") or 0)
            s_w = int(s_agg.get("wins") or 0)
            s_n = round(float(s_agg.get("net_return") or 0.0), 4)
            session_breakdown_out[s_name] = {
                "trades": s_t,
                "wins": s_w,
                "win_rate": round(s_w / max(s_t, 1), 2),
                "net_return": s_n,
                "expectancy": round(s_n / max(s_t, 1), 4),
            }

    obs_sample_size = int(candidate.get("sample_size") or trades_count)

    return {
        'status': 'insufficient_evidence' if is_insufficient_evidence else 'completed',
        'insufficient_evidence': is_insufficient_evidence,
        'insufficient_reason': insufficient_reason,
        'h1_trend_state': last_h1_state,
        'candidate_id': candidate.get("id"),
        'candidate_name': candidate.get("name"),
        'method': 'Tabula Rasa Rolling 120 train / 60 OOS',
        'strategy': f"Tabula Rasa Inductive Model: {candidate.get('name')}",
        'rules': rules,
        'folds': folds,
        'sample_size': obs_sample_size,
        'gross_return': gross_return,
        'net_return_after_costs': net_return_after_costs,
        'cost_model_pips': cost_model_pips,
        'cost_model_is_assumed': True,
        'cost_model_note': f"Giả định chi phí giao dịch khứ hồi (spread + trượt giá): {cost_model_pips} pips/lệnh",
        'oos_net_price_units': net_oos,
        'expectancy_price_units': expectancy_units,
        'expectancy': expectancy_units,
        'max_drawdown_price_units': max_dd,
        'max_drawdown_pct': max_dd_pct,
        'win_rate': win_rate,
        'profit_factor': profit_factor,
        'sharpe_ratio': sharpe_ratio,
        'trades': trades_count,
        'session_breakdown': session_breakdown_out,
        'evidence_breakdown': {
            'backtest_oos': {
                'trades': trades_count,
                'win_rate': win_rate,
                'expectancy': expectancy_units,
                'profit_factor': profit_factor,
                'net_return_after_costs': net_return_after_costs,
                'max_drawdown_pct': max_dd_pct,
                'cost_model_pips': cost_model_pips,
                'cost_model_is_assumed': True,
            },
            'shadow_paper': {
                'sample_size': int(candidate.get("sample_size") or 0),
                'empirical_win_rate': candidate.get("empirical_win_rate"),
            },
            'demo_canary': {
                'trades': 0,
                'status': 'NOT_STARTED',
            },
        },
        'has_verified_timestamps': has_verified_timestamps,
        'production_qualified': is_qualified,
    }

def get_checkpointer():
    """Factory creating PostgresSaver when in PostgreSQL mode or SqliteSaver when in SQLite mode."""
    if is_postgres():
        try:
            from langgraph.checkpoint.postgres import PostgresSaver
            # Setup PostgreSQL checkpointer connection
            conn_str = DATABASE_URL
            if conn_str.startswith("postgres://"):
                conn_str = "postgresql://" + conn_str[11:]
            return PostgresSaver.from_conn_string(conn_str)
        except Exception as e:
            logger.warning("PostgresSaver initialization error (%s); falling back to sqlite checkpointer.", e)
    from langgraph.checkpoint.sqlite import SqliteSaver
    return SqliteSaver.from_conn_string(str(DATA / 'research.sqlite3'))

def graph(saver):
    def evaluate(s):
        t0 = time.perf_counter()
        prices = []
        cand = None
        try:
            from app.db import to_epoch_ts
            now_eval_ts = time.time()
            with tx() as c:
                candle_rows = c.execute(
                    """
                    SELECT open, high, low, close, time, source
                    FROM candles
                    WHERE symbol = 'XAUUSD' AND timeframe = 'M15'
                      AND (source IS NULL OR UPPER(source) NOT LIKE 'YAHOO%')
                    ORDER BY time DESC LIMIT 1000
                    """
                ).fetchall()
                if not candle_rows:
                    candle_rows = c.execute(
                        """
                        SELECT open, high, low, close, time, source
                        FROM candles
                        WHERE symbol = 'XAUUSD'
                          AND (source IS NULL OR UPPER(source) NOT LIKE 'YAHOO%')
                        ORDER BY time DESC LIMIT 1000
                        """
                    ).fetchall()
                if candle_rows:
                    raw_bars = [
                        {
                            "open": float(row[0]),
                            "high": float(row[1]),
                            "low": float(row[2]),
                            "close": float(row[3]),
                            "time": row[4],
                            "source": row[5] if len(row) > 5 else None,
                        }
                        for row in reversed(candle_rows)
                    ]
                    # Keep only closed historical M15 candles (bar_start + 900 <= now)
                    closed_bars = [
                        b for b in raw_bars
                        if to_epoch_ts(b.get("time")) > 0 and (to_epoch_ts(b.get("time")) + 900.0) <= now_eval_ts
                    ]
                    if len(closed_bars) >= 180:
                        prices = closed_bars
                        first_train_end_ts = to_epoch_ts(prices[119].get("time"))
                        if first_train_end_ts and first_train_end_ts > 0:
                            cand = discover_candidate_from_observations(c, symbol="XAUUSD", max_created_at=first_train_end_ts)
        except Exception as e:
            logger.warning(f"Error loading candles from DB for WFO: {e}")

        # Fallback to historical replay dataset only if live DB candles are insufficient (<180 bars)
        if len(prices) < 180:
            replay_file = ROOT / 'data/replay.json'
            if replay_file.exists():
                try:
                    raw_rep = json.loads(replay_file.read_text())
                    prices = [
                        x if isinstance(x, dict) and "close" in x else {"close": float(x)}
                        for x in raw_rep
                    ]
                except Exception as e:
                    logger.warning(f"Replay file read error: {e}")

        report = walk_forward(prices, candidate=cand)
        trace_langgraph_step("walk_forward", {"data_len": len(prices)}, report, (time.perf_counter() - t0) * 1000)
        return {'report': report}

    def approval(s):
        rep = s.get('report', {})
        is_prod_qualified = bool(rep.get('production_qualified', False))
        notice_text = (
            "Approval promotes strategy to APPROVED_FOR_PROD for live trading."
            if is_prod_qualified
            else "Approval archives a research candidate for demo review only. No live promotion."
        )
        answer = interrupt({
            'kind': 'admin_approval',
            'report': s['report'],
            'notice': notice_text
        })
        is_app = bool(answer.get('approved', False))
        trace_langgraph_step("admin_review", {"report_summary": s['report']['oos_net_price_units']}, {"approved": is_app})
        return {'approved': is_app}

    def finish(s):
        rep = s.get('report', {})
        cand_id = rep.get('candidate_id')
        approved = s.get('approved', False)
        disp = 'approved_for_demo_review' if approved else 'rejected'
        trace_langgraph_step("archive", {"approved": approved}, {"disposition": disp})
        try:
            with tx() as c:
                if cand_id:
                    # Enforce rigorous validation: Must be approved by admin AND verified production_qualified by WFO with timestamped candles
                    is_prod_qualified = bool(
                        rep.get('production_qualified', False)
                        and rep.get('has_verified_timestamps', False)
                    )
                    if approved:
                        new_status = 'APPROVED_FOR_PROD' if is_prod_qualified else 'APPROVED_FOR_DEMO'
                    else:
                        new_status = 'REJECTED'
                    c.execute(
                        """
                        UPDATE strategy_candidates
                        SET status = ?, rules_json = ?, win_rate = ?, profit_factor = ?,
                            sharpe_ratio = ?, max_drawdown_pct = ?,
                            oos_net_units = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            new_status,
                            json.dumps(rep.get('rules', {})),
                            rep.get('win_rate'),
                            rep.get('profit_factor'),
                            rep.get('sharpe_ratio'),
                            rep.get('max_drawdown_pct', rep.get('max_drawdown_price_units')),
                            rep.get('oos_net_price_units'),
                            time.time(),
                            cand_id
                        )
                    )
                reflect_on_policy_approval(c, cand_id or s.get('job_id', 'wfo_candidate'), approved, rep)
        except Exception as e:
            logger.warning(f"Error archiving strategy candidate decision: {e}")
        return {'disposition': disp}

    g = StateGraph(State)
    g.add_node('walk_forward', evaluate)
    g.add_node('admin_review', approval)
    g.add_node('archive', finish)
    g.add_edge(START, 'walk_forward')
    g.add_edge('walk_forward', 'admin_review')
    g.add_edge('admin_review', 'archive')
    g.add_edge('archive', END)
    return g.compile(checkpointer=saver)

def process_once():
    with tx() as c:
        jobs = [dict(r) for r in c.execute("SELECT * FROM jobs WHERE state IN ('queued','running','resume') ORDER BY created")]

    with get_checkpointer() as saver:
        # PostgresSaver requires setup() on first run
        if hasattr(saver, "setup"):
            try:
                saver.setup()
            except Exception:
                pass
        g = graph(saver)
        for job in jobs:
            config = {'configurable': {'thread_id': job['id']}}
            try:
                snap = g.get_state(config)
                if job['state'] == 'resume':
                    if snap.next: g.invoke(Command(resume={'approved': bool(job['decision'])}), config)
                elif not snap.values: g.invoke({}, config)
                elif snap.next and not any(t.interrupts for t in snap.tasks): g.invoke(None, config)
                snap = g.get_state(config)
                state = 'waiting_approval' if snap.next else 'completed'
                with tx() as c:
                    c.execute('UPDATE jobs SET state=?,result=?,error=NULL WHERE id=?', (state, json.dumps(snap.values), job['id']))
            except Exception as e:
                with tx() as c:
                    c.execute("UPDATE jobs SET state='failed',error=? WHERE id=?", (str(e)[:400], job['id']))

    with tx() as c:
        setkv(c, 'research_heartbeat', time.time())

def ai_text(prompt, image=None):
    t0 = time.perf_counter()
    provider = "AUTO"
    key = os.getenv('AI_API_KEY', '')
    base_url = os.getenv('AI_BASE_URL', 'https://api.openai.com/v1')
    model = os.getenv('AI_MODEL', 'gpt-4o-mini')

    try:
        with tx() as c:
            row = c.execute("SELECT value FROM kv WHERE key = 'ai:settings'").fetchone()
            if row:
                cfg = json.loads(row[0])
                provider = cfg.get("provider", "AUTO").upper()
                if cfg.get("api_key"):
                    raw_k = str(cfg["api_key"]).strip()
                    try:
                        from app.security import decrypt_secret
                        dec_k = decrypt_secret(raw_k)
                        key = dec_k if dec_k else ("" if raw_k.startswith("enc:") else raw_k)
                    except Exception:
                        key = "" if raw_k.startswith("enc:") else raw_k
                if cfg.get("base_url"):
                    base_url = cfg["base_url"]
                if cfg.get("model"):
                    model = cfg["model"]
    except Exception:
        pass

    # 1. Try Gemini API pool if provider is GEMINI, HYBRID or AUTO
    if provider in ("GEMINI", "HYBRID", "AUTO"):
        try:
            with tx() as c:
                gemini_ans, used_key = call_gemini(
                    prompt,
                    system_instruction="Bạn là trợ lý AI định lượng ZUPIRUS Quant Lab. Phân tích thận trọng, bảo vệ an toàn tài khoản, trả lời súc tích bằng tiếng Việt.",
                    c=c,
                    image=image,
                    caller_agent="research_wfo",
                )
                if gemini_ans:
                    used_model = used_key.split("·")[-1].strip() if (used_key and "·" in str(used_key)) else "gemini-3-flash-preview"
                    latency = (time.perf_counter() - t0) * 1000
                    trace_ai_interaction(prompt, gemini_ans, used_model, len(prompt) // 4, len(gemini_ans) // 4, latency)
                    return {'available': True, 'text': gemini_ans, 'provider': 'gemini', 'key_used': used_key}
        except Exception as e:
            logger.debug(f"Gemini call attempt: {e}")

    # 2. Try OpenAI / OpenRouter key if configured (never send Google AIza/AQ keys or unsafe SSRF base_url)
    from app.skills.mcp_bridge import _is_safe_external_url
    if key and not key.startswith("AIza") and not key.startswith("AQ.") and _is_safe_external_url(base_url):
        content = [{'type': 'text', 'text': prompt}]
        if image:
            content.append({'type': 'image_url', 'image_url': {'url': image}})
        try:
            r = httpx.post(
                base_url.rstrip('/') + '/chat/completions',
                headers={'Authorization': 'Bearer ' + key},
                json={
                    'model': model,
                    'messages': [
                        {'role': 'system', 'content': 'Bạn là trợ lý AI định lượng ZUPIRUS Quant Lab. Phân tích thận trọng, bảo vệ an toàn tài khoản, trả lời súc tích bằng tiếng Việt.'},
                        {'role': 'user', 'content': content}
                    ],
                    'max_tokens': 700
                },
                timeout=20
            )
            r.raise_for_status()
            data = r.json()
            ans_text = str((data.get('choices') or [{}])[0].get('message', {}).get('content') or '')
            usage = data.get('usage') or {}
            p_tok = int(usage.get('prompt_tokens') or (len(prompt) // 4))
            c_tok = int(usage.get('completion_tokens') or (len(ans_text) // 4))
            latency = (time.perf_counter() - t0) * 1000
            trace_ai_interaction(prompt, ans_text, model, p_tok, c_tok, latency)
            return {'available': True, 'text': ans_text, 'provider': 'openai', 'model': model}
        except Exception as e:
            latency = (time.perf_counter() - t0) * 1000
            trace_ai_interaction(prompt, "", model, 0, 0, latency, error=str(e))

    return {'available': False, 'text': None}

_last_eod_eval_ts = 0.0
_last_eod_utc_date = ""
_last_calendar_sync_ts = 0.0
_last_induction_ts = 0.0


def run_periodic_calendar_sync():
    """Automatically sync USD High-Impact economic calendar every 6 hours (or immediately if empty)."""
    global _last_calendar_sync_ts
    now = time.time()
    if now - _last_calendar_sync_ts < 21600.0:
        return
    _last_calendar_sync_ts = now
    try:
        from app.calendar_sync import sync_economic_calendar
        with tx() as c:
            added, existing = sync_economic_calendar(c)
            if added > 0:
                audit(c, "research_worker", "auto_calendar_synced", {"added": added, "existing": existing})
    except Exception as e:
        logger.warning(f"Periodic calendar sync error: {e}")


def run_autonomous_induction_and_wfo(force: bool = False):
    """Synthesize inductive rules from Hindsight Memory (PENDING_APPROVAL skills),
    generate Strategy Candidates via Research Graph Walk-Forward, and safely promote
    via 7-day CANARY_DEMO trial when `AUTO_PROMOTE_QUALIFIED_STRATEGIES` is enabled."""
    global _last_induction_ts
    now = time.time()
    if not force and now - _last_induction_ts < 1800.0:
        return
    _last_induction_ts = now
    t_start_wfo = time.perf_counter()
    summary_wfo = "Chu kỳ tự học Hindsight & Walk-Forward hoàn tất"
    try:
        from app.hindsight import synthesize_inductive_rules, CATEGORY_REFLECTIVE
        from app.domains.notifications.service import emit_notification
        from app.domains.ai.signal_swarm import record_agent_heartbeat
        with tx() as c:
            min_inductive_samples = int(os.getenv("MIN_INDUCTIVE_SAMPLES", "30").strip())
            synthesize_inductive_rules(c, min_samples=min_inductive_samples)

            # Compute observation fingerprint for XAUUSD so identical evidence cannot trigger duplicate auto-promotions
            obs_meta = c.execute(
                """
                SELECT COUNT(*), COALESCE(MAX(created_at), 0), COALESCE(ROUND(CAST(SUM(pnl) AS numeric), 2), 0)
                FROM signal_audit_logs
                WHERE context_snapshot IS NOT NULL AND pnl IS NOT NULL
                  AND UPPER(COALESCE(symbol, 'XAUUSD')) = 'XAUUSD'
                """
            ).fetchone()
            obs_fp = f"{obs_meta[0]}:{obs_meta[1]}:{obs_meta[2]}" if obs_meta else "0:0:0"
            prev_fp_row = c.execute("SELECT value FROM kv WHERE key = 'wfo:last_promoted_obs_fp'").fetchone()
            prev_fp = str(prev_fp_row[0]) if prev_fp_row and prev_fp_row[0] else ""
            is_new_evidence = (obs_fp != prev_fp)

            # 1. Fetch historical candles first to isolate out-of-sample window (last 60 bars = 15 hours on M15)
            candle_rows = c.execute(
                """
                SELECT open, high, low, close, time, source
                FROM candles
                WHERE symbol = 'XAUUSD' AND timeframe = 'M15'
                  AND (source IS NULL OR UPPER(source) NOT LIKE 'YAHOO%')
                ORDER BY time DESC LIMIT 1000
                """
            ).fetchall()
            from app.db import to_epoch_ts
            raw_prices = [
                {
                    "open": float(r[0]),
                    "high": float(r[1]),
                    "low": float(r[2]),
                    "close": float(r[3]),
                    "time": r[4],
                    "source": r[5] if len(r) > 5 else None,
                }
                for r in reversed(candle_rows)
            ] if candle_rows else []
            prices = [
                b for b in raw_prices
                if to_epoch_ts(b.get("time")) > 0 and (to_epoch_ts(b.get("time")) + 900.0) <= now
            ]

            cutoff_ts = None
            if prices and len(prices) >= 180:
                try:
                    # First fold train is prices[0:120], first fold OOS test starts at prices[120]
                    # Shared candidate discovery must strictly cut off at the end of the first train window (prices[119])
                    first_train_end_ts = to_epoch_ts(prices[119].get("time"))
                    last_oos_start_ts = to_epoch_ts(prices[-60].get("time"))
                    if first_train_end_ts and first_train_end_ts > 0 and last_oos_start_ts and last_oos_start_ts > 0:
                        cutoff_ts = min(first_train_end_ts, last_oos_start_ts)
                    else:
                        cutoff_ts = first_train_end_ts or last_oos_start_ts
                except Exception:
                    cutoff_ts = None
            elif candle_rows and len(candle_rows) >= 60:
                try:
                    oos_cand = candle_rows[59]  # 60th candle from most recent
                    t_val = oos_cand[4]
                    cutoff_ts = to_epoch_ts(t_val)
                except Exception:
                    cutoff_ts = None
            else:
                cutoff_ts = time.time() - (60 * 15 * 60)

            # Issue 11 Fix: Validate that cutoff_ts is a valid positive timestamp
            # Never run walk-forward lookahead bias check with invalid/None cutoff
            cand = None
            if cutoff_ts is not None and cutoff_ts > 0:
                # 2. Discover inductive candidate strictly before out-of-sample window to avoid lookahead bias
                cand = discover_candidate_from_observations(c, symbol="XAUUSD", max_created_at=cutoff_ts)
            else:
                logger.warning("WFO discovery skipped: Invalid or missing candle cutoff timestamp.")
            if cand and cand.get("id"):
                if len(prices) >= 180:
                    rep = walk_forward(prices, candidate=cand)
                    win_rate = float(rep.get("win_rate") or 0.0)
                    pf = float(rep.get("profit_factor") or 0.0)
                    trades_cnt = int(rep.get("trades") or 0)
                    obs_sz = int(cand.get("sample_size") or 0)
                    max_dd = float(rep.get("max_drawdown_pct") or 0.0)

                    from app.core.config import is_customer_auto_trading_enabled
                    auto_row = c.execute("SELECT value FROM kv WHERE key = 'AUTO_PROMOTE_QUALIFIED_STRATEGIES'").fetchone()
                    auto_promote = bool(
                        is_customer_auto_trading_enabled(c)
                        and auto_row
                        and str(auto_row[0]).strip().lower() in ("1", "true", "yes")
                    )
                    qualifies = bool(
                        rep.get("production_qualified")
                        and is_new_evidence
                        and win_rate >= 0.55
                        and pf >= 1.45
                        and obs_sz >= 30
                        and max_dd <= 10.0
                    )

                    rules_dict = dict(rep.get("rules", {}))
                    if auto_promote and qualifies:
                        new_status = "CANARY_DEMO"
                        rules_dict["canary_started_at"] = now
                        c.execute(
                            "INSERT INTO kv (key, value) VALUES ('wfo:last_promoted_obs_fp', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                            (obs_fp,),
                        )
                        c.execute(
                            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                            (f"canary_strat:{cand['id']}:started_at", str(now)),
                        )
                        emit_notification(
                            c,
                            role="admin",
                            severity="INFO",
                            title="Chiến Lược Vào Giai Đoạn Thử Việc",
                            body=f"Chiến lược {cand['name']} (#{cand['id'][:8]}) đã vào giai đoạn thử việc CANARY_DEMO 7 ngày.",
                            meta={"candidate_id": cand["id"], "canary_started_at": now},
                        )
                        summary_wfo = f"Chiến lược {cand['name']} đủ chuẩn và đã vào CANARY_DEMO 7 ngày"
                    else:
                        new_status = "WAITING_APPROVAL"
                        summary_wfo = f"Chiến lược {cand['name']} WFO xong: {new_status}"

                    c.execute(
                        """
                        UPDATE strategy_candidates
                        SET status = ?, rules_json = ?, win_rate = ?, profit_factor = ?,
                            sharpe_ratio = ?, max_drawdown_pct = ?, oos_net_units = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            new_status,
                            json.dumps(rules_dict),
                            win_rate,
                            pf,
                            rep.get("sharpe_ratio"),
                            rep.get("max_drawdown_pct"),
                            rep.get("oos_net_price_units"),
                            now,
                            cand["id"],
                        ),
                    )
                    store_memory(
                        c,
                        category=CATEGORY_REFLECTIVE,
                        title=f"WFO Evaluation: {cand['name']} ({new_status})",
                        content=f"WinRate={win_rate*100:.1f}%, PF={pf}, Trades={trades_cnt}, NetOOS={rep.get('oos_net_price_units')}",
                        entity_id=cand["id"],
                        tags=["wfo", new_status.lower()],
                        scope="system",
                    )

            # Evaluate existing CANARY_DEMO candidates that have completed 7 days trial
            canary_rows = c.execute(
                "SELECT id, name, rules_json, updated_at FROM strategy_candidates WHERE status = 'CANARY_DEMO'"
            ).fetchall()
            for c_row in canary_rows:
                c_id, c_name, c_rules_raw, c_upd = c_row[0], c_row[1], c_row[2], c_row[3]
                c_rules = json.loads(c_rules_raw) if c_rules_raw else {}
                c_start_row = c.execute("SELECT value FROM kv WHERE key = ?", (f"canary_strat:{c_id}:started_at",)).fetchone()
                if c_start_row and c_start_row[0]:
                    try:
                        c_started_at = float(c_start_row[0])
                    except Exception:
                        c_started_at = float(c_upd or now)
                else:
                    c_started_at = float(c_rules.get("canary_started_at") or c_upd or now)

                canary_age = now - c_started_at
                # Only evaluate after 7 days trial
                if canary_age >= 7 * 86400:
                    log_rows = c.execute(
                        """
                        SELECT l.pnl
                        FROM signal_audit_logs l
                        WHERE (l.strategy_id = ? OR l.source_name = ? OR l.signal_id = ? OR l.signal_id LIKE ? OR l.signal_id LIKE ?)
                          AND l.created_at >= ?
                          AND l.pnl IS NOT NULL
                          AND UPPER(COALESCE(l.status, '')) != 'REJECTED'
                          AND UPPER(COALESCE(l.reject_reason, '')) != 'BROKER_PARTIAL_CLOSED'
                        ORDER BY l.created_at ASC
                        """,
                        (c_id, c_id, c_id, f"{c_id}:%", f"%{c_id}%", c_started_at),
                    ).fetchall()
                    pnls = [float(r[0]) for r in log_rows]
                    closed_cnt = len(pnls)
                    expectancy = (sum(pnls) / max(closed_cnt, 1)) if closed_cnt > 0 else 0.0

                    # Peak-to-Trough Drawdown with peak[t] as denominator
                    base_equity = 100.0
                    eq = base_equity
                    peak = base_equity
                    max_dd_pct = 0.0
                    for pnl in pnls:
                        eq += pnl
                        if eq > peak:
                            peak = eq
                        if peak > 0:
                            dd = ((peak - eq) / peak) * 100.0
                            if dd > max_dd_pct:
                                max_dd_pct = dd
                    max_dd_pct = round(max_dd_pct, 2)

                    passed_canary = False
                    # Strictly no fallback to historical candles; requires 10+ actual canary trades
                    if closed_cnt >= 10 and expectancy > 0 and max_dd_pct <= 8.0:
                        passed_canary = True

                    if passed_canary:
                        c.execute("UPDATE strategy_candidates SET status = 'ARCHIVED_PROD', updated_at = ? WHERE status = 'APPROVED_FOR_PROD'", (now,))
                        c.execute("UPDATE strategy_candidates SET status = 'APPROVED_FOR_PROD', updated_at = ? WHERE id = ?", (now, c_id))
                        from app.domains.signals.sources.curator import get_active_signal_mode, set_active_signal_mode
                        curr_mode = get_active_signal_mode(c)
                        next_mode = "HYBRID_AGENT_SCORER" if curr_mode == "EXTERNAL_FEED" else "ZUPIRUS_AGENT"
                        set_active_signal_mode(c, next_mode)
                        audit(c, "research_worker", "canary_promoted_to_approved_prod", {
                            "candidate_id": c_id,
                            "name": c_name,
                            "canary_duration_days": round(canary_age / 86400, 1),
                            "closed_trades": closed_cnt,
                            "expectancy": expectancy,
                            "next_signal_mode": next_mode,
                        })
                        try:
                            from app.core.mailer import send_admin_alert_email
                            send_admin_alert_email(
                                f"[ZUPIRUS] Chiến lược {c_name} đã hoàn tất 7 ngày thử việc Canary và được nâng lên LIVE",
                                (
                                    f"Chiến lược {c_name} (#{c_id[:8]}) đã hoàn tất 7 ngày thử việc CANARY_DEMO "
                                    f"(Số lệnh: {closed_cnt}, Expectancy: {expectancy:+.2f}).\n"
                                    f"Hệ thống đã tự động nâng chiến lược lên chạy LIVE chính thức.\n"
                                    f"Nhắc nhở: Quản trị viên luôn có nút Rollback 1-Click trên Admin Portal "
                                    f"và cơ chế Auto-Rollback (tự hoàn tác nếu thua 4 lệnh liên tiếp) để bảo toàn vốn."
                                ),
                            )
                        except Exception as mail_err:
                            logger.debug(f"Canary promotion email note: {mail_err}")
                        emit_notification(
                            c,
                            role="admin",
                            severity="INFO",
                            title=f"Chiến Lược {c_name} Thăng Hạng LIVE",
                            body=f"Chiến lược {c_name} hoàn tất 7 ngày thử việc Canary và đã được kích hoạt chạy LIVE.",
                        )
                    else:
                        c.execute("UPDATE strategy_candidates SET status = 'CANARY_REJECTED', updated_at = ? WHERE id = ?", (now, c_id))
                        store_memory(
                            c,
                            category=CATEGORY_REFLECTIVE,
                            title=f"Canary Evaluation: {c_name} (CANARY_REJECTED)",
                            content=f"Thử nghiệm 7 ngày không đạt chuẩn: trades={closed_cnt}, expectancy={expectancy:.2f}.",
                            entity_id=c_id,
                            tags=["canary", "canary_rejected"],
                            scope="system",
                        )
                        emit_notification(
                            c,
                            role="admin",
                            severity="WARNING",
                            title=f"Chiến Lược Thử Việc {c_name} Bị Từ Chối",
                            body=f"Chiến lược {c_name} không đạt chuẩn thực nghiệm sau 7 ngày thử việc và đã chuyển sang CANARY_REJECTED.",
                        )

            # Record heartbeat
            dur_wfo = round((time.perf_counter() - t_start_wfo) * 1000.0, 1)
            record_agent_heartbeat(c, "research_wfo", dur_wfo, summary_wfo)
    except Exception as e:
        logger.debug(f"Autonomous induction/WFO cycle note: {e}")


def run_eod_shadow_evaluation_cycle(force: bool = False):
    """Periodic & End-of-Day Shadow Signal Grader Scheduler.
    Runs every 4 hours and at 00:05 UTC daily, evaluates pending shadow signals against M1 candles,
    updating Trust Scores, storing lessons in Hindsight, and triggering Strategy Candidate induction.
    """
    global _last_eod_eval_ts, _last_eod_utc_date
    import datetime as _dt
    now = time.time()
    now_utc = _dt.datetime.now(_dt.timezone.utc)
    today_str = now_utc.strftime("%Y-%m-%d")
    is_daily_eod_window = (now_utc.hour == 0 and now_utc.minute >= 5 and _last_eod_utc_date != today_str)

    if not force and not is_daily_eod_window and (now - _last_eod_eval_ts < 14400.0):
        return

    _last_eod_eval_ts = now
    if is_daily_eod_window:
        _last_eod_utc_date = today_str

    try:
        from app.services.sources.curator import evaluate_shadow_signals_eod, auto_rotate_signal_sources
        eval_res = evaluate_shadow_signals_eod()
        logger.info(f"EOD Shadow Evaluation completed: {eval_res}")

        rot_res = auto_rotate_signal_sources(min_samples=10)
        if rot_res.get("promoted") or rot_res.get("demoted"):
            logger.info(f"Auto-Rotation updated sources: {rot_res}")

        if int(eval_res.get("evaluated", 0)) > 0:
            run_autonomous_induction_and_wfo(force=True)
    except Exception as e:
        logger.warning(f"EOD shadow evaluation error: {e}")


_last_discovery_ts = 0.0
_last_macro_station_ts = 0.0


def run_periodic_source_discovery():
    """Autonomously discover & ingest external cross-asset / feed shadow signals every 30 minutes."""
    global _last_discovery_ts
    now = time.time()
    if now - _last_discovery_ts < 900.0:
        return
    _last_discovery_ts = now
    try:
        from app.services.sources.discovery import discover_and_ingest_external_signals
        discover_and_ingest_external_signals()
    except Exception as e:
        logger.debug(f"Periodic source discovery note: {e}")


def run_periodic_macro_bias():
    """Autonomously update real-time macro bias, yields & news shocks every 30 minutes."""
    global _last_macro_station_ts
    now = time.time()
    if now - _last_macro_station_ts < 1800.0:
        return
    _last_macro_station_ts = now
    try:
        import asyncio
        from app.domains.ai.macro_station import fetch_macro_bias
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(fetch_macro_bias(now_ts=now))
            else:
                loop.run_until_complete(fetch_macro_bias(now_ts=now))
        except RuntimeError:
            asyncio.run(fetch_macro_bias(now_ts=now))
    except Exception as e:
        logger.debug(f"Periodic macro station note: {e}")


def main():
    if os.getenv("ENABLE_LEGACY_RESEARCH_LOOP", "").strip().lower() not in ("1", "true", "yes"):
        from app.domains.quant.worker import main as librarian_main
        librarian_main()
        return
    init()
    from app.domains.ai.signal_swarm import is_agent_paused
    from app.domains.execution.engine import is_weekend_market_closed
    from app.domains.notifications.service import run_daily_executive_digest
    while True:
        try:
            # 1. Background live market quote & candle streamer
            try:
                from app.services.sources.streamer import fetch_next_supported_market_data
                fetch_next_supported_market_data()
            except Exception as stream_err:
                logger.debug(f"Periodic market data streaming note: {stream_err}")

            # 2. Background blockchain scanner for PENDING USDT Direct Orders
            try:
                from app.domains.billing.crypto_direct import scan_and_reconcile_pending_crypto_orders
                import asyncio
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        asyncio.create_task(scan_and_reconcile_pending_crypto_orders())
                    else:
                        loop.run_until_complete(scan_and_reconcile_pending_crypto_orders())
                except RuntimeError:
                    asyncio.run(scan_and_reconcile_pending_crypto_orders())
            except Exception as crypto_err:
                logger.debug(f"Periodic crypto reconciliation note: {crypto_err}")

            process_once()
            run_periodic_calendar_sync()
            run_periodic_source_discovery()
            run_periodic_macro_bias()
            run_eod_shadow_evaluation_cycle()
            try:
                run_daily_executive_digest()
            except Exception as e:
                logger.debug(f"Daily executive digest note: {e}")

            paused = False
            try:
                with tx() as c:
                    paused = is_agent_paused(c, "research_wfo")
            except Exception:
                pass
            if not paused:
                run_autonomous_induction_and_wfo()
        except Exception as e:
            print('research error', type(e).__name__, flush=True)

        sleep_sec = 20 if is_weekend_market_closed() else 3
        time.sleep(sleep_sec)

if __name__ == '__main__': main()
