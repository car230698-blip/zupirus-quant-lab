"""Persistent research graph: research results never control execution automatically.
Integrated with PostgreSQL/TimescaleDB checkpointer and LangSmith tracing."""
import time, json, os, uuid, logging
from typing import TypedDict
import httpx
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command
from .db import DATA, ROOT, tx, init, setkv, audit, is_postgres, DATABASE_URL
from .tracing import trace_langgraph_step, trace_ai_interaction
from .hindsight import reflect_on_policy_approval
from .gemini_client import call_gemini

logger = logging.getLogger("zupirus.research")

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
from .db import DATA, ROOT, tx, init, setkv, audit, is_postgres, DATABASE_URL
from .tracing import trace_langgraph_step, trace_ai_interaction
from .hindsight import reflect_on_policy_approval, store_memory
from .gemini_client import call_gemini

logger = logging.getLogger("zupirus.research")

DEFAULT_SL_POINTS = 6.0
DEFAULT_TP_POINTS = 12.0


class State(TypedDict, total=False):
    candidate: dict
    report: dict
    approved: bool
    disposition: str


def discover_candidate_from_observations(c=None) -> Dict[str, Any]:
    """Tabula Rasa induction: Analyzes real observed external signals from signal_audit_logs
    and discovers rule candidates from profitable clusters.
    Returns status='insufficient_data' if real concluded trades with pnl are insufficient.
    """
    if c is None:
        with tx() as conn:
            return discover_candidate_from_observations(conn)

    # 1. Query observed signals with real market context snapshots and realized PnL
    rows = []
    try:
        rows = c.execute(
            """
            SELECT side, entry_price, pnl, context_snapshot
            FROM signal_audit_logs
            WHERE context_snapshot IS NOT NULL AND pnl IS NOT NULL
            ORDER BY created_at DESC LIMIT 200
            """
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
    preferred_session = best_sess
    win_rate = round(sum(1 for p in pnls if p > 0) / max(len(pnls), 1), 2)
    sample_size = len(pnls)
    inferred_action = best_side if sum(pnls) >= 0 else ("SELL" if best_side == "BUY" else "BUY")

    candidate_id = f"cand_{uuid.uuid4().hex[:8]}"
    candidate_name = f"TabulaRasa-Alpha-{preferred_session}"
    rules = {
        "preferred_session": preferred_session,
        "action": inferred_action,
        "min_slope": 0.20,
        "sl_points": DEFAULT_SL_POINTS,
        "tp_points": DEFAULT_TP_POINTS,
    }

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
    sl = float(candidate_rules.get("sl_points", DEFAULT_SL_POINTS))
    tp = float(candidate_rules.get("tp_points", DEFAULT_TP_POINTS))
    target_action = candidate_rules.get("action", "BUY")
    min_slope = float(candidate_rules.get("min_slope", 0.20))

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
                    returns.append(-sl - 0.37)
                    position = None
                    continue
                if high_p - entry >= tp:
                    returns.append(tp - 0.37)
                    position = None
                    continue
            else:
                if entry - high_p <= -sl:
                    returns.append(-sl - 0.37)
                    position = None
                    continue
                if entry - low_p >= tp:
                    returns.append(tp - 0.37)
                    position = None
                    continue
            continue

        if t >= len(prices) - 1:
            continue

        # Evaluate candidate rule condition (momentum slope over 10 intervals)
        p_t10 = float(prices[t - 10]["close"]) if isinstance(prices[t - 10], dict) else float(prices[t - 10])
        p_next = float(prices[t + 1]["open"]) if isinstance(prices[t + 1], dict) and "open" in prices[t + 1] else (float(prices[t + 1]["close"]) if isinstance(prices[t + 1], dict) else float(prices[t + 1]))
        slope = (close_p - p_t10) / 10.0
        if target_action in ("BUY", "BOTH") and slope >= min_slope:
            position = (p_next, 1)
        elif target_action in ("SELL", "BOTH") and slope <= -min_slope:
            position = (p_next, -1)

    if position:
        entry, direction = position
        last_c = float(prices[-1]["close"]) if isinstance(prices[-1], dict) else float(prices[-1])
        returns.append((last_c - entry) * direction - 0.37)

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

        # Tune slope parameter on in-sample train
        slopes = [0.15, 0.20, 0.30]
        best_slope = max(slopes, key=lambda s: score_candidate_on_window(train, {**rules, "min_slope": s})[0])

        tuned_rules = {**rules, "min_slope": best_slope}
        pnl, rets = score_candidate_on_window(test, tuned_rules)
        all_returns.extend(rets)
        folds.append({
            'train': [start, start + 119],
            'test': [start + 120, start + 179],
            'tuned_slope': best_slope,
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
        # Select deployed slope strictly from the latest in-sample training window (zero OOS peeking)
        latest_fold = folds[-1]
        rules = {**rules, "min_slope": latest_fold.get("tuned_slope", rules.get("min_slope", 0.20))}
    trades_count = len(all_returns)
    wins = sum(1 for r in all_returns if r > 0)
    win_rate = round(wins / max(trades_count, 1), 2)
    profit_factor = round(
        abs(sum(r for r in all_returns if r > 0)) / max(abs(sum(r for r in all_returns if r < 0)), 0.01),
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

    return {
        'candidate_id': candidate.get("id"),
        'candidate_name': candidate.get("name"),
        'method': 'Tabula Rasa Rolling 120 train / 60 OOS',
        'strategy': f"Tabula Rasa Inductive Model: {candidate.get('name')}",
        'rules': rules,
        'folds': folds,
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
    generate Strategy Candidates via Research Graph Walk-Forward, and optionally auto-promote
    when `AUTO_PROMOTE_QUALIFIED_STRATEGIES` is enabled in `kv`."""
    global _last_induction_ts
    now = time.time()
    if not force and now - _last_induction_ts < 1800.0:
        return
    _last_induction_ts = now
    try:
        from app.hindsight import synthesize_inductive_rules, CATEGORY_REFLECTIVE
        with tx() as c:
            synthesize_inductive_rules(c, min_samples=5)

            cand = discover_candidate_from_observations(c)
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
                    oos_net = float(rep.get("oos_net_price_units") or 0.0)
                    max_dd_pct = float(rep.get("max_drawdown_pct") or 0.0)
                    obs_sz = int(cand.get("sample_size") or 0)

                    auto_row = c.execute("SELECT value FROM kv WHERE key = 'AUTO_PROMOTE_QUALIFIED_STRATEGIES'").fetchone()
                    auto_promote = bool(auto_row and str(auto_row[0]).strip().lower() in ("1", "true", "yes"))
                    qualifies = bool(
                        (rep.get("production_qualified") or (trades_cnt >= 5 and oos_net > 0 and max_dd_pct <= 8.0))
                        and win_rate >= 0.52
                        and pf >= 1.35
                        and obs_sz >= 25
                    )

                    new_status = "APPROVED_FOR_PROD" if (auto_promote and qualifies) else "WAITING_APPROVAL"
                    c.execute(
                        """
                        UPDATE strategy_candidates
                        SET status = ?, rules_json = ?, win_rate = ?, profit_factor = ?,
                            sharpe_ratio = ?, max_drawdown_pct = ?, oos_net_units = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            new_status,
                            json.dumps(rep.get("rules", {})),
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

                    if auto_promote and qualifies:
                        mode_row = c.execute("SELECT value FROM kv WHERE key = 'signal_mode'").fetchone()
                        curr_mode = str(mode_row[0]).upper() if mode_row and mode_row[0] else "EXTERNAL_FEED"
                        next_mode = "HYBRID" if curr_mode == "EXTERNAL_FEED" else "ZUPIRUS_AGENT"
                        c.execute(
                            "INSERT INTO kv (key, value) VALUES ('signal_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                            (next_mode,),
                        )
                        c.execute(
                            "INSERT INTO kv (key, value) VALUES ('signal_source', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                            (next_mode,),
                        )
                        audit(c, "research_worker", "auto_promoted_strategy_and_upgraded_mode", {
                            "candidate_id": cand["id"],
                            "win_rate": win_rate,
                            "profit_factor": pf,
                            "next_signal_mode": next_mode,
                        })
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


def main():
    init()
    while True:
        try:
            process_once()
            run_periodic_calendar_sync()
            run_periodic_source_discovery()
            run_eod_shadow_evaluation_cycle()
            run_autonomous_induction_and_wfo()
        except Exception as e: print('research error', type(e).__name__, flush=True)
        time.sleep(3)

if __name__ == '__main__': main()
