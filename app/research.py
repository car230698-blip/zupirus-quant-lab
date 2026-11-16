"""Persistent research graph: research results never control execution automatically.
Integrated with PostgreSQL/TimescaleDB checkpointer and LangSmith tracing."""
import sqlite3, time, json, os, uuid, base64, logging
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
import sqlite3, time, json, os, uuid, base64, logging, math
from typing import TypedDict, Dict, Any, List, Optional, Tuple
import httpx
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command
from .db import DATA, ROOT, tx, init, setkv, audit, is_postgres, DATABASE_URL
from .tracing import trace_langgraph_step, trace_ai_interaction
from .hindsight import reflect_on_policy_approval, store_memory, CATEGORY_SEMANTIC
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

    # Extract winning patterns from real trades
    session_wins: Dict[str, List[float]] = {}
    for r in rows:
        side = r["side"] if hasattr(r, 'keys') else r[0]
        pnl = float(r["pnl"] if hasattr(r, 'keys') else r[2])
        ctx_str = r["context_snapshot"] if hasattr(r, 'keys') else r[3]
        sess = "London"
        if ctx_str:
            try:
                sess = json.loads(ctx_str).get("session", "London")
            except Exception:
                pass
        session_wins.setdefault(sess, []).append(pnl)

    # Pick session with highest positive expectancy
    best_sess = max(session_wins.keys(), key=lambda k: sum(session_wins[k]))
    pnls = session_wins[best_sess]
    preferred_session = best_sess
    win_rate = round(sum(1 for p in pnls if p > 0) / max(len(pnls), 1), 2)
    sample_size = len(pnls)

    candidate_id = f"cand_{uuid.uuid4().hex[:8]}"
    candidate_name = f"TabulaRasa-Alpha-{preferred_session}"
    rules = {
        "preferred_session": preferred_session,
        "action": "BUY" if sum(pnls) > 0 else "SELL",
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

    for t in range(15, len(prices) - 1):
        if position:
            entry, direction = position
            pnl = (prices[t] - entry) * direction
            if pnl <= -sl or pnl >= tp:
                returns.append(pnl - 0.37)  # 0.37 cost of trading
                position = None
            continue

        # Evaluate candidate rule condition (momentum slope)
        slope = (prices[t] - prices[t - 10]) / 10.0
        if target_action == "BUY" and slope >= min_slope:
            position = (prices[t + 1], 1)
        elif target_action == "SELL" and slope <= -min_slope:
            position = (prices[t + 1], -1)

    if position:
        entry, direction = position
        returns.append((prices[-1] - entry) * direction - 0.37)

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
        and max_dd <= 10.0
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
            saver = PostgresSaver.from_conn_string(conn_str)
            try:
                saver.setup()
            except Exception:
                pass
            return saver
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
                        SET status = ?, win_rate = ?, profit_factor = ?,
                            sharpe_ratio = ?, max_drawdown_pct = ?,
                            oos_net_units = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            new_status,
                            rep.get('win_rate'),
                            rep.get('profit_factor'),
                            rep.get('sharpe_ratio'),
                            rep.get('max_drawdown_price_units'),
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
                    key = cfg["api_key"]
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
                    c=c
                )
                if gemini_ans:
                    latency = (time.perf_counter() - t0) * 1000
                    trace_ai_interaction(prompt, gemini_ans, "gemini-flash-latest", len(prompt) // 4, len(gemini_ans) // 4, latency)
                    return {'available': True, 'text': gemini_ans, 'provider': 'gemini', 'key_used': used_key}
        except Exception as e:
            logger.debug(f"Gemini call attempt: {e}")

    # 2. Try OpenAI / OpenRouter key if configured
    if key:
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
            ans_text = data['choices'][0]['message']['content']
            usage = data.get('usage', {})
            p_tok = usage.get('prompt_tokens', len(prompt) // 4)
            c_tok = usage.get('completion_tokens', len(ans_text) // 4)
            latency = (time.perf_counter() - t0) * 1000
            trace_ai_interaction(prompt, ans_text, model, p_tok, c_tok, latency)
            return {'available': True, 'text': ans_text, 'provider': 'openai', 'model': model}
        except Exception as e:
            latency = (time.perf_counter() - t0) * 1000
            trace_ai_interaction(prompt, "", model, 0, 0, latency, error=str(e))

    return {'available': False, 'text': None}

    return {
        'available': False,
        'text': None,
    }

_last_eod_eval_ts = 0.0

def run_eod_shadow_evaluation_cycle():
    """Periodic & End-of-Day Shadow Signal Grader Scheduler.
    Runs every 4 hours and evaluates pending shadow signals against M1 candles,
    updating Trust Scores and recommending promotion when shadow signals >= 30.
    """
    global _last_eod_eval_ts
    now = time.time()
    # Check every 4 hours
    if now - _last_eod_eval_ts < 14400.0:
        return

    _last_eod_eval_ts = now
    try:
        from app.services.sources.curator import evaluate_shadow_signals_eod, list_sources
        eval_res = evaluate_shadow_signals_eod()
        logger.info(f"EOD Shadow Evaluation completed: {eval_res}")

        # Check if any SHADOW_ONLY source qualifies to surpass live sources
        sources = list_sources()
        live_sources = [s for s in sources if s.get("status") == "ACTIVE_LIVE"]
        min_live_score = min([float(s.get("trust_score") or 50.0) for s in live_sources]) if live_sources else 0.0

        for s in sources:
            if s.get("status") == "SHADOW_ONLY" and int(s.get("total_signals") or 0) >= 30:
                score = float(s.get("trust_score") or 0.0)
                pf = float(s.get("profit_factor") or 0.0)
                if score > min_live_score and pf > 1.3:
                    with tx() as c:
                        audit(c, "curator", "shadow_promotion_recommended", {
                            "source_id": s["id"],
                            "name": s["name"],
                            "trust_score": score,
                            "profit_factor": pf,
                            "total_signals": s["total_signals"],
                            "message": f"Nguồn ẩn '{s['name']}' đã đạt {s['total_signals']} tín hiệu và Trust Score ({score:.1f}) vượt nguồn live. Sẵn sàng phê duyệt sang ACTIVE_LIVE."
                        })
    except Exception as e:
        logger.warning(f"EOD shadow evaluation error: {e}")

def main():
    init()
    while True:
        try:
            process_once()
            run_eod_shadow_evaluation_cycle()
        except Exception as e: print('research error', type(e).__name__, flush=True)
        time.sleep(3)

if __name__ == '__main__': main()
