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
            rows = c.execute(
                """
                SELECT side, entry_price, pnl, context_snapshot
                FROM signal_audit_logs
                WHERE context_snapshot IS NOT NULL AND pnl IS NOT NULL
                  AND UPPER(COALESCE(symbol, 'XAUUSD')) = ?
                  AND created_at <= ?
                  AND signal_id NOT IN (
                      SELECT signal_id FROM metaapi_trade_executions 
                      WHERE evidence_json LIKE '%"manual_closed_by_user": true%' 
                         OR evidence_json LIKE '%"manual_closed_by_user":true%'
                  )
                ORDER BY created_at DESC LIMIT 200
                """,
                (sym_u, float(max_created_at)),
            ).fetchall()
        else:
            rows = c.execute(
                """
                SELECT side, entry_price, pnl, context_snapshot
                FROM signal_audit_logs
                WHERE context_snapshot IS NOT NULL AND pnl IS NOT NULL
                  AND UPPER(COALESCE(symbol, 'XAUUSD')) = ?
                  AND signal_id NOT IN (
                      SELECT signal_id FROM metaapi_trade_executions 
                      WHERE evidence_json LIKE '%"manual_closed_by_user": true%' 
                         OR evidence_json LIKE '%"manual_closed_by_user":true%'
                  )
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

    return {
        "id": candidate_id,
        "name": candidate_name,
        "rules": rules,
        "sample_size": sample_size,
        "empirical_win_rate": win_rate,
    }


def score_candidate_on_window(prices: List[float], candidate_rules: Dict[str, Any]) -> Tuple[float, List[float]]:
    """Evaluates inductive candidate rules on a window of price series."""
    raw_sl = float(candidate_rules.get("sl_points", DEFAULT_SL_POINTS))
    raw_tp = float(candidate_rules.get("tp_points", DEFAULT_TP_POINTS))
    target_action = candidate_rules.get("action", "BUY")
    min_slope = float(candidate_rules.get("min_slope", 0.20))

    # Dynamic asset scaling to support Gold, FX, Indices, and Crypto
    ref_price = 2650.0
    if prices:
        first_bar = prices[0]
        ref_price = float(first_bar["close"]) if isinstance(first_bar, dict) else float(first_bar)

    # Configurable realistic transaction cost model (B3: Spread + Commission + Slippage)
    # Default 3.5 pips for XAUUSD (ref_price >= 300.0) and 1.5 pips for major FX (ref_price < 300.0)
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

    returns = []
    position = None

    for t in range(15, len(prices)):
        bar = prices[t]
        is_ohlc = isinstance(bar, dict)
        close_p = float(bar["close"]) if is_ohlc else float(bar)
        high_p = float(bar.get("high", close_p)) if is_ohlc else close_p
        low_p = float(bar.get("low", close_p)) if is_ohlc else close_p

        if position:
            entry, direction = position
            # Conservative dual-hit rule: check Stop Loss before Take Profit using high/low wicks (including last bar)
            if direction == 1:
                if low_p - entry <= -sl:
                    returns.append(-sl - spread_cost)
                    position = None
                    continue
                if high_p - entry >= tp:
                    returns.append(tp - spread_cost)
                    position = None
                    continue
            else:
                if entry - high_p <= -sl:
                    returns.append(-sl - spread_cost)
                    position = None
                    continue
                if entry - low_p >= tp:
                    returns.append(tp - spread_cost)
                    position = None
                    continue
            continue

        if t >= len(prices) - 1:
            continue

        # Evaluate candidate rule condition (momentum slope over 10 intervals matching engine scaling)
        p_t10 = float(prices[t - 10]["close"]) if isinstance(prices[t - 10], dict) else float(prices[t - 10])
        p_next = float(prices[t + 1]["open"]) if isinstance(prices[t + 1], dict) and "open" in prices[t + 1] else (float(prices[t + 1]["close"]) if isinstance(prices[t + 1], dict) else float(prices[t + 1]))
        slope = (close_p - p_t10) / 10.0
        price_scale = 0.001 if close_p < 10.0 else (0.1 if close_p < 300.0 else 1.0)
        slope_threshold = min_slope * price_scale
        if target_action in ("BUY", "BOTH") and slope >= slope_threshold:
            position = (p_next, 1)
        elif target_action in ("SELL", "BOTH") and slope <= -slope_threshold:
            position = (p_next, -1)

    if position:
        entry, direction = position
        last_c = float(prices[-1]["close"]) if isinstance(prices[-1], dict) else float(prices[-1])
        returns.append((last_c - entry) * direction - spread_cost)

    return sum(returns), returns


def walk_forward(prices: List[float], candidate: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Walk-Forward Optimization (WFO): Rolling 120 train / 60 Out-of-Sample verification
    for discovered inductive candidate rules."""
    if candidate is None:
        candidate = discover_candidate_from_observations()

    rules = candidate.get("rules", {
        "action": "BUY",
        "min_slope": 0.20,
        "sl_points": DEFAULT_SL_POINTS,
        "tp_points": DEFAULT_TP_POINTS,
    })

    folds = []
    all_returns = []

    for start in range(0, len(prices) - 180 + 1, 60):
        train = prices[start:start + 120]
        test = prices[start + 120:start + 180]

        # Tune slope and risk-reward ratio parameters on in-sample train
        base_sl = float(rules.get("sl_points", DEFAULT_SL_POINTS))
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
                {**rules, "min_slope": p[0], "tp_points": base_sl * p[1]}
            )[0]
        )

        tuned_rules = {**rules, "min_slope": best_slope, "tp_points": round(base_sl * best_rr, 2)}
        pnl, rets = score_candidate_on_window(test, tuned_rules)
        all_returns.extend(rets)
        folds.append({
            'train': [start, start + 119],
            'test': [start + 120, start + 179],
            'tuned_slope': best_slope,
            'tuned_rr': best_rr,
            'oos_net_price_units': round(pnl, 4),
            'trades': len(rets),
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
        rules = {
            **rules,
            "min_slope": latest_fold.get("tuned_slope", rules.get("min_slope", 0.20)),
            "tp_points": round(base_sl * latest_fold.get("tuned_rr", 2.0), 2),
        }
        # Keep all_returns as the true walk-forward concatenated OOS returns to avoid look-ahead leakage

    trades_count = len(all_returns)
    wins = sum(1 for r in all_returns if r > 0)
    win_rate = round(wins / max(trades_count, 1), 2)
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

    is_qualified = bool(
        trades_count >= 10
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

    return {
        'candidate_id': candidate.get("id"),
        'candidate_name': candidate.get("name"),
        'method': 'Tabula Rasa Rolling 120 train / 60 OOS',
        'strategy': f"Tabula Rasa Inductive Model: {candidate.get('name')}",
        'rules': rules,
        'folds': folds,
        'gross_return': gross_return,
        'net_return_after_costs': net_return_after_costs,
        'cost_model_pips': cost_model_pips,
        'oos_net_price_units': net_oos,
        'max_drawdown_price_units': max_dd,
        'max_drawdown_pct': max_dd_pct,
        'win_rate': win_rate,
        'profit_factor': profit_factor,
        'sharpe_ratio': sharpe_ratio,
        'trades': trades_count,
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
        try:
            with tx() as c:
                candle_rows = c.execute(
                    "SELECT close FROM candles WHERE symbol = 'XAUUSD' AND timeframe = 'M15' ORDER BY time DESC LIMIT 1000"
                ).fetchall()
                if not candle_rows:
                    candle_rows = c.execute(
                        "SELECT close FROM candles WHERE symbol = 'XAUUSD' ORDER BY time DESC LIMIT 1000"
                    ).fetchall()
                if candle_rows and len(candle_rows) >= 180:
                    prices = [float(row[0]) for row in reversed(candle_rows)]
        except Exception as e:
            logger.warning(f"Error loading candles from DB for WFO: {e}")

        # Fallback to historical replay dataset only if live DB candles are insufficient (<180 bars)
        if len(prices) < 180:
            replay_file = ROOT / 'data/replay.json'
            if replay_file.exists():
                try:
                    prices = [x['close'] for x in json.loads(replay_file.read_text())]
                except Exception as e:
                    logger.warning(f"Replay file read error: {e}")

        report = walk_forward(prices)
        trace_langgraph_step("walk_forward", {"data_len": len(prices)}, report, (time.perf_counter() - t0) * 1000)
        return {'report': report}

    def approval(s):
        answer = interrupt({
            'kind': 'admin_approval',
            'report': s['report'],
            'notice': 'Approval archives a research candidate only. No live promotion.'
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
                    # Enforce rigorous validation: Must be approved by admin AND verified production_qualified by WFO
                    is_prod_qualified = bool(rep.get('production_qualified', False))
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
                  AND signal_id NOT IN (
                      SELECT signal_id FROM metaapi_trade_executions 
                      WHERE evidence_json LIKE '%"manual_closed_by_user": true%' 
                         OR evidence_json LIKE '%"manual_closed_by_user":true%'
                  )
                """
            ).fetchone()
            obs_fp = f"{obs_meta[0]}:{obs_meta[1]}:{obs_meta[2]}" if obs_meta else "0:0:0"
            prev_fp_row = c.execute("SELECT value FROM kv WHERE key = 'wfo:last_promoted_obs_fp'").fetchone()
            prev_fp = str(prev_fp_row[0]) if prev_fp_row and prev_fp_row[0] else ""
            is_new_evidence = (obs_fp != prev_fp)

            cand = discover_candidate_from_observations(c, symbol="XAUUSD")
            if cand and cand.get("id"):
                candle_rows = c.execute(
                    "SELECT open, high, low, close FROM candles WHERE symbol = 'XAUUSD' AND timeframe = 'M15' ORDER BY time DESC LIMIT 1000"
                ).fetchall()
                prices = [{"open": float(r[0]), "high": float(r[1]), "low": float(r[2]), "close": float(r[3])} for r in reversed(candle_rows)] if candle_rows else []
                if len(prices) >= 180:
                    rep = walk_forward(prices, candidate=cand)
                    win_rate = float(rep.get("win_rate") or 0.0)
                    pf = float(rep.get("profit_factor") or 0.0)
                    trades_cnt = int(rep.get("trades") or 0)
                    obs_sz = int(cand.get("sample_size") or 0)
                    max_dd = float(rep.get("max_drawdown_pct") or 0.0)

                    auto_row = c.execute("SELECT value FROM kv WHERE key = 'AUTO_PROMOTE_QUALIFIED_STRATEGIES'").fetchone()
                    auto_promote = bool(auto_row and str(auto_row[0]).strip().lower() in ("1", "true", "yes"))
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
                        SELECT pnl
                        FROM signal_audit_logs
                        WHERE (strategy_id = ? OR source_name = ? OR signal_id = ? OR signal_id LIKE ? OR signal_id LIKE ?) AND created_at >= ? AND pnl IS NOT NULL
                          AND signal_id NOT IN (
                              SELECT signal_id FROM metaapi_trade_executions 
                              WHERE evidence_json LIKE '%"manual_closed_by_user": true%' 
                                 OR evidence_json LIKE '%"manual_closed_by_user":true%'
                          )
                        ORDER BY created_at ASC
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
    init()
    from app.domains.ai.signal_swarm import is_agent_paused
    from app.domains.execution.engine import is_weekend_market_closed
    from app.domains.notifications.service import run_daily_executive_digest
    while True:
        try:
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
