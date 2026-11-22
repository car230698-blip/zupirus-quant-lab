"""Autonomous Multi-Agent Swarm for ZUPIRUS Quant Lab.
Coordinates 3 specialized autonomous agents:
1. Sentinel Agent: Macroeconomic news, calendar & volatility risk surveillance.
2. Alpha Agent: Multi-asset alpha discovery and automated parameter optimization.
3. Risk Guardian Agent: Real-time Portfolio Value-at-Risk (VaR 99%) & leverage clamping.
"""
import time
import logging
from typing import Dict, Any, List, Optional, Tuple
from app.db import tx
from app.portfolio import run_monte_carlo_simulation
from app.hindsight import store_memory, CATEGORY_REFLECTIVE
from app.domains.ai.gemini_client import call_gemini

logger = logging.getLogger("zupirus.swarm")

# Swarm in-memory state tracker
_SWARM_STATE = {
    "last_cycle_ts": 0.0,
    "cycles_count": 0,
    "agents": {
        "sentinel": {
            "name": "Sentinel Agent",
            "role": "Macro Surveillance & News Blackout",
            "state": "idle",
            "last_action": "Khởi động và sẵn sàng quét lịch tin",
            "risk_score": 0.15,
            "status": "active",
        },
        "alpha": {
            "name": "Alpha Agent",
            "role": "Multi-Asset Strategy Discovery",
            "state": "idle",
            "last_action": "Chờ chu kỳ quét Sharpe",
            "active_candidates": 1,
            "status": "active",
        },
        "risk_guardian": {
            "name": "Risk Guardian Agent",
            "role": "Portfolio VaR 99% & Leverage Guardian",
            "state": "idle",
            "last_action": "Bảo vệ vốn & đòn bẩy danh mục an toàn",
            "var_99_pct": 2.8,
            "status": "active",
        },
        "research_wfo": {
            "name": "Research WFO Worker",
            "role": "Hindsight Induction & Out-of-Sample Walk-Forward",
            "state": "idle",
            "last_action": "Tự học quy tắc phản tư & kiểm định Walk-Forward OOS",
            "status": "active",
        },
    },
    "recent_messages": [
        {
            "ts": time.time(),
            "from": "coordinator",
            "agent": "Swarm Coordinator",
            "message": "Hệ thống Swarm tự hành khởi động thành công. 3 Agent đã kết nối đồng bộ.",
            "type": "info",
        }
    ],
}


def get_swarm_status() -> Dict[str, Any]:
    """Returns current swarm telemetry, agent statuses, dynamic skills index, and recent message board."""
    from app.skills.registry import get_skill_index
    skills_index = get_skill_index(enabled_only=True)

    return {
        **_SWARM_STATE,
        "active_agents_count": 3,
        "coordination_mode": "autonomous_fail_closed",
        "real_trading_locked": True,
        "available_skills_count": len(skills_index),
        "skills_index": skills_index,
    }


def run_sentinel_cycle(c) -> Dict[str, Any]:
    """Sentinel Agent scans upcoming economic news and evaluates macro market sentiment."""
    now = time.time()
    upcoming_events = c.execute(
        "SELECT id, title, currency, impact, ts FROM news WHERE ts >= ? AND ts <= ? ORDER BY ts ASC LIMIT 3",
        (now - 900, now + 14400)
    ).fetchall()

    blackout = False
    for ev in upcoming_events:
        ts = ev["ts"]
        if abs(now - ts) <= 900:  # within +/- 15 min
            blackout = True
            break

    risk_score = 0.85 if blackout else (0.45 if upcoming_events else 0.15)
    action_text = (
        "CẢNH BÁO: Kích hoạt chế độ Blackout tin tức ±15 phút. Toàn bộ lệnh mở mới bị khóa."
        if blackout
        else f"Thị trường an toàn. Ghi nhận {len(upcoming_events)} sự kiện kinh tế trong 4 giờ tới."
    )

    # Optional Gemini sentiment analysis if upcoming events exist
    macro_notes = ""
    if upcoming_events:
        event_names = ", ".join(e["title"] for e in upcoming_events)
        prompt = f"Phân tích nhanh rủi ro biến động cho vàng XAUUSD trước các tin tức: {event_names}. Đưa ra khuyến nghị 1 câu ngắn gọn."
        gem_res, _ = call_gemini(prompt, c=c, caller_agent="sentinel")
        if gem_res:
            macro_notes = gem_res[:160]

    _SWARM_STATE["agents"]["sentinel"].update({
        "state": "alert" if blackout else "working",
        "last_action": action_text,
        "risk_score": risk_score,
        "macro_notes": macro_notes,
    })

    return {"blackout": blackout, "risk_score": risk_score, "events_count": len(upcoming_events)}


def run_alpha_cycle(c) -> Dict[str, Any]:
    """Alpha Agent: Tabula Rasa mode in Phase 1 (observing external feed),
    Autonomous strategy execution in Phase 2."""
    from app.domains.signals.sources.curator import get_active_signal_mode

    active_source = get_active_signal_mode(c)

    if active_source == "EXTERNAL_FEED":
        # Check count of observed signals in signal_audit_logs
        obs_count = 0
        try:
            obs_count = c.execute("SELECT count(*) FROM signal_audit_logs").fetchone()[0]
        except Exception:
            pass

        # Stage 2: RAG Context Retrieval for Tabula Rasa Alpha Agent
        active_rag_summary = ""
        try:
            from app.domains.ai.ingest_swarm import retrieve_relevant_knowledge
            rel_chunks = retrieve_relevant_knowledge(c, query="XAUUSD market structure risk ATR Stop Loss", top_k=2)
            if rel_chunks:
                active_rag_summary = f" [RAG: {len(rel_chunks)} quy tắc kích hoạt]"
        except Exception as e:
            logger.debug(f"retrieve_relevant_knowledge error: {e}")

        action_text = f"Tabula Rasa Observer: Đang quan sát & ghi nhận {obs_count} mẫu hình từ nguồn ngoài XAUUSD.{active_rag_summary} Tuyệt đối không tự phát lệnh."
        bias = "tabula_rasa_observing"
        _SWARM_STATE["agents"]["alpha"].update({
            "state": "working",
            "last_action": action_text,
            "top_asset": "XAUUSD",
            "strategy_bias": bias,
        })
        return {"top_asset": "XAUUSD", "bias": bias, "observed_count": obs_count}

    # Autonomous Mode (ZUPIRUS_AGENT)
    cand_name = "TabulaRasa-Alpha-Production"
    try:
        row = c.execute("SELECT name FROM strategy_candidates WHERE status = 'APPROVED_FOR_PROD' ORDER BY updated_at DESC LIMIT 1").fetchone()
        if row:
            cand_name = row["name"] if hasattr(row, 'keys') else row[0]
    except Exception:
        pass

    action_text = f"Autonomous Mode: Vận hành tự động theo Chiến lược tự học [{cand_name}] đã được Admin phê duyệt."
    bias = "autonomous_learned"
    _SWARM_STATE["agents"]["alpha"].update({
        "state": "working",
        "last_action": action_text,
        "top_asset": "XAUUSD",
        "strategy_bias": bias,
    })
    return {"top_asset": "XAUUSD", "bias": bias, "candidate": cand_name}


def run_risk_guardian_cycle(c) -> Dict[str, Any]:
    """Risk Guardian Agent calculates Portfolio Value-at-Risk (VaR 99%) and validates leverage."""
    is_pg = bool(getattr(c, "_is_pg", False))
    if is_pg:
        c.execute("SAVEPOINT sp_swarm_risk_acc")
    try:
        accounts = c.execute(
            "SELECT id, balance, equity, 0 AS positions FROM trading_accounts WHERE auto_trade = 1 OR deployment_state = 'DEPLOYED'"
        ).fetchall()
        if is_pg:
            c.execute("RELEASE SAVEPOINT sp_swarm_risk_acc")
    except Exception:
        if is_pg:
            c.execute("ROLLBACK TO SAVEPOINT sp_swarm_risk_acc")
        accounts = c.execute("SELECT id, balance, equity, positions FROM accounts WHERE enabled=1").fetchall()
    total_equity = sum(float(a["equity"] or 0.0) for a in accounts)
    total_positions = sum(int(a["positions"] or 0) for a in accounts)

    # Run Monte Carlo for portfolio risk using real closed trades if available
    pnl_rows = c.execute(
        "SELECT pnl FROM signal_audit_logs WHERE pnl IS NOT NULL ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    real_trades = [float(r["pnl"] if hasattr(r, "keys") else r[0]) for r in pnl_rows] if pnl_rows else []
    mc = run_monte_carlo_simulation(trades=real_trades, initial_equity=max(1000.0, total_equity), iterations=1000)
    var_99 = mc["var_99_max_drawdown_pct"]
    risk_of_ruin = mc["risk_of_ruin_pct"]

    status = "normal"
    if mc.get("insufficient_data"):
        action_text = f"Danh mục ổn định ({len(accounts)} tài khoản, {total_positions} vị thế). Chưa đủ >=5 lệnh đóng để chạy Monte Carlo."
    elif var_99 > 5.0 or risk_of_ruin > 1.0:
        status = "warning"
        action_text = f"Cảnh báo rủi ro: VaR 99% đạt {var_99}%. Khuyến nghị siết chặt SL/TP."
    else:
        action_text = f"Danh mục an toàn. Tổng {len(accounts)} tài khoản, {total_positions} vị thế. VaR 99% = {var_99}%."

    _SWARM_STATE["agents"]["risk_guardian"].update({
        "state": "alert" if status == "warning" else "working",
        "last_action": action_text,
        "var_99_pct": var_99,
        "risk_of_ruin_pct": risk_of_ruin,
    })

    return {"var_99": var_99, "risk_of_ruin": risk_of_ruin, "status": status}


def trigger_swarm_cycle(c=None) -> Dict[str, Any]:
    """Coordinates a full autonomous cycle across all 3 agents."""
    now = time.time()
    _SWARM_STATE["cycles_count"] += 1
    _SWARM_STATE["last_cycle_ts"] = now

    def _execute_db(conn):
        # 1. Sentinel
        t_sentinel = time.perf_counter()
        if is_agent_paused(conn, "sentinel"):
            _SWARM_STATE["agents"]["sentinel"].update({"state": "paused", "last_action": "Tạm dừng theo cấu hình quản trị viên"})
            sentinel_res = {"status": "PAUSED", "paused": True}
            record_agent_heartbeat(conn, "sentinel", (time.perf_counter() - t_sentinel) * 1000.0, "Tạm dừng theo cấu hình quản trị viên")
        else:
            sentinel_res = run_sentinel_cycle(conn)
            dur_sentinel = (time.perf_counter() - t_sentinel) * 1000.0
            sum_sentinel = _SWARM_STATE["agents"]["sentinel"].get("last_action", "Hoàn tất quét Sentinel macro")
            record_agent_heartbeat(conn, "sentinel", dur_sentinel, sum_sentinel)

        # 2. Alpha
        t_alpha = time.perf_counter()
        if is_agent_paused(conn, "alpha"):
            _SWARM_STATE["agents"]["alpha"].update({"state": "paused", "last_action": "Tạm dừng theo cấu hình quản trị viên"})
            alpha_res = {"status": "PAUSED", "paused": True}
            record_agent_heartbeat(conn, "alpha", (time.perf_counter() - t_alpha) * 1000.0, "Tạm dừng theo cấu hình quản trị viên")
        else:
            alpha_res = run_alpha_cycle(conn)
            dur_alpha = (time.perf_counter() - t_alpha) * 1000.0
            sum_alpha = _SWARM_STATE["agents"]["alpha"].get("last_action", "Hoàn tất chu kỳ Alpha định lượng")
            record_agent_heartbeat(conn, "alpha", dur_alpha, sum_alpha)

        # 3. Risk Guardian
        t_guardian = time.perf_counter()
        if is_agent_paused(conn, "risk_guardian"):
            _SWARM_STATE["agents"]["risk_guardian"].update({"state": "paused", "last_action": "Tạm dừng theo cấu hình quản trị viên"})
            guardian_res = {"status": "PAUSED", "paused": True}
            record_agent_heartbeat(conn, "risk_guardian", (time.perf_counter() - t_guardian) * 1000.0, "Tạm dừng theo cấu hình quản trị viên")
        else:
            guardian_res = run_risk_guardian_cycle(conn)
            dur_guardian = (time.perf_counter() - t_guardian) * 1000.0
            sum_guardian = _SWARM_STATE["agents"]["risk_guardian"].get("last_action", "Hoàn tất kiểm soát rủi ro VaR")
            record_agent_heartbeat(conn, "risk_guardian", dur_guardian, sum_guardian)

        return sentinel_res, alpha_res, guardian_res

    if c:
        sentinel_res, alpha_res, guardian_res = _execute_db(c)
    else:
        with tx() as conn:
            sentinel_res, alpha_res, guardian_res = _execute_db(conn)

    # Invoke built-in Agent Skills + Cross-Asset Context (DXY / US10Y) outside DB lock
    skills_telemetry = {}
    try:
        from app.skills.registry import execute_skill
        skills_telemetry["macro"] = execute_skill("macro_news_interpreter")
        skills_telemetry["regime"] = execute_skill("market_regime_scanner")
        skills_telemetry["liquidity"] = execute_skill("liquidity_spread_auditor")
    except Exception as sk_err:
        logger.debug(f"Swarm skill invocation note: {sk_err}")

    cross_asset = {}
    try:
        from app.services.sources.discovery import fetch_cross_asset_context
        cross_asset = fetch_cross_asset_context()
    except Exception as ca_err:
        logger.debug(f"Cross-asset context note: {ca_err}")

    msg = (
        f"Chu kỳ #{_SWARM_STATE['cycles_count']}: Sentinel={sentinel_res.get('events_count')} sự kiện | "
        f"Alpha={alpha_res.get('top_asset')} ({alpha_res.get('bias')}) | "
        f"Macro={cross_asset.get('gold_macro_bias', 'NEUTRAL')} | "
        f"Risk VaR 99%={guardian_res.get('var_99')}%"
    )

    _SWARM_STATE["recent_messages"].insert(0, {
        "ts": now,
        "from": "swarm_coordinator",
        "agent": "Swarm Coordinator",
        "message": msg,
        "type": "cycle",
    })
    _SWARM_STATE["recent_messages"] = _SWARM_STATE["recent_messages"][:20]

    # Save reflective memory every 10 cycles
    if _SWARM_STATE["cycles_count"] % 10 == 0:
        try:
            if c:
                store_memory(
                    c,
                    category=CATEGORY_REFLECTIVE,
                    title=f"Đúc kết chu kỳ Swarm #{_SWARM_STATE['cycles_count']}",
                    content=msg,
                    tags=["swarm_cycle", "autonomous_reflection"],
                )
            else:
                with tx() as conn:
                    store_memory(
                        conn,
                        category=CATEGORY_REFLECTIVE,
                        title=f"Đúc kết chu kỳ Swarm #{_SWARM_STATE['cycles_count']}",
                        content=msg,
                        tags=["swarm_cycle", "autonomous_reflection"],
                    )
        except Exception:
            pass

    return {
        "ok": True,
        "cycle": _SWARM_STATE["cycles_count"],
        "sentinel": sentinel_res,
        "alpha": alpha_res,
        "risk_guardian": guardian_res,
        "skills_telemetry": skills_telemetry,
        "cross_asset": cross_asset,
    }


# ---------------------------------------------------------------------------
# Admin Control Plane v1.2 — 4-Agent Heartbeat, Toggle-Pause & Atomic Wake
# ---------------------------------------------------------------------------

OPERATIONAL_AGENTS = {
    "sentinel": {
        "id": "sentinel",
        "name": "Sentinel Agent",
        "role": "Giám sát tin vĩ mô & News Shield",
        "default_summary": "Giám sát lịch tin kinh tế vĩ mô & bảo vệ cửa sổ tin ±30 phút",
    },
    "alpha": {
        "id": "alpha",
        "name": "Alpha Agent",
        "role": "Đánh giá cấu trúc M15/H1 & Regime",
        "default_summary": "Đánh giá cấu trúc giá M15, nhận diện Regime & kiểm chứng tín hiệu",
    },
    "risk_guardian": {
        "id": "risk_guardian",
        "name": "Risk Guardian",
        "role": "Giám sát Drawdown & Auto-Rollback",
        "default_summary": "Giám sát rủi ro VaR 99%, lá chắn sụt giảm & đòn bẩy danh mục",
    },
    "research_wfo": {
        "id": "research_wfo",
        "name": "Research WFO Worker",
        "role": "Tự học Hindsight & Kiểm định Out-of-Sample",
        "default_summary": "Tự học bài học Hindsight & kiểm định Walk-Forward OOS",
    },
}

_AGENT_EXEC_STATE: Dict[str, Dict[str, Any]] = {}
_IN_MEMORY_LOCKS: Dict[str, float] = {}


def mark_agent_quota_capped(agent_id: str):
    """Flags an agent as quota-capped when daily LLM budget is exhausted."""
    aid = (agent_id or "system").strip().lower()
    _AGENT_EXEC_STATE.setdefault(aid, {})["is_quota_capped"] = True


def acquire_agent_wake_lock(agent_id: str, ttl: int = 60) -> bool:
    """Acquires an atomic lock for agent execution with TTL 60s.
    Uses Redis lock when available; falls back to monotonic in-memory lock."""
    lock_key = f"lock:agent_wake:{agent_id}"
    try:
        from app.redis_client import get_redis_client
        rc = get_redis_client()
        if rc:
            acquired = rc.set(lock_key, "1", nx=True, ex=ttl)
            if acquired:
                return True
            return False
    except Exception as e:
        logger.debug(f"Redis agent wake lock check note: {e}")

    now = time.time()
    exp = _IN_MEMORY_LOCKS.get(lock_key, 0.0)
    if exp > now:
        return False
    _IN_MEMORY_LOCKS[lock_key] = now + float(ttl)
    return True


def is_agent_paused(c, agent_id: str) -> bool:
    """Checks whether an agent is explicitly paused via kv table key agent_paused:{agent_id}."""
    aid = (agent_id or "").strip().lower()
    try:
        p_row = c.execute("SELECT value FROM kv WHERE key = ?", (f"agent_paused:{aid}",)).fetchone()
        return bool(p_row and str(p_row["value"] if hasattr(p_row, "keys") else p_row[0]).strip() in ("1", "true", "True"))
    except Exception:
        return False


def record_agent_heartbeat(c, agent_id: str, duration_ms: float, summary: str):
    """Persists agent heartbeat timestamp, duration, and summary to kv table and local memory."""
    now_ts = time.time()
    aid = (agent_id or "system").strip().lower()
    dur_ms = round(float(duration_ms), 1)
    sum_str = str(summary or "")[:255]

    if aid in _AGENT_EXEC_STATE:
        _AGENT_EXEC_STATE[aid].update({
            "last_run_at": now_ts,
            "last_duration_ms": dur_ms,
            "last_summary": sum_str,
            "is_running": False,
        })

    def _persist(cursor):
        cursor.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (f"agent_hb:{aid}:last_run_at", str(now_ts)),
        )
        cursor.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (f"agent_hb:{aid}:last_dur", str(dur_ms)),
        )
        cursor.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (f"agent_hb:{aid}:last_sum", sum_str),
        )

    if c:
        _persist(c)
    else:
        try:
            from app.db import tx
            with tx() as conn:
                _persist(conn)
        except Exception:
            pass


def release_agent_wake_lock(agent_id: str):
    """Releases an agent wake lock early if needed."""
    lock_key = f"lock:agent_wake:{agent_id}"
    try:
        from app.redis_client import get_redis_client
        rc = get_redis_client()
        if rc:
            rc.delete(lock_key)
    except Exception:
        pass
    _IN_MEMORY_LOCKS.pop(lock_key, None)


def get_agents_heartbeat(c=None) -> List[Dict[str, Any]]:
    """Returns standardized heartbeat telemetry for all 4 operational agents."""
    from app.domains.ai.gemini_client import get_daily_quota_stats
    quota = get_daily_quota_stats(c=c)
    quota_capped = (quota.get("status") == "CAPPED_100")
    breakdown = quota.get("breakdown", {})

    def _read_kv(cursor):
        res = []
        for aid, meta in OPERATIONAL_AGENTS.items():
            # 1. Check paused state
            p_row = cursor.execute("SELECT value FROM kv WHERE key = ?", (f"agent_paused:{aid}",)).fetchone()
            is_paused = bool(p_row and str(p_row["value"] if hasattr(p_row, "keys") else p_row[0]).strip() in ("1", "true", "True"))

            # 2. Check execution status
            st_mem = _AGENT_EXEC_STATE.get(aid, {})
            is_running = bool(st_mem.get("is_running", False))

            if is_paused:
                status = "PAUSED"
            elif is_running:
                status = "RUNNING"
            elif quota_capped or st_mem.get("is_quota_capped", False):
                status = "QUOTA_CAPPED"
            else:
                status = "IDLE"

            # 3. Read last run info (memory first, fallback to kv)
            last_run_at = st_mem.get("last_run_at")
            if last_run_at is None:
                lr_row = cursor.execute("SELECT value FROM kv WHERE key = ?", (f"agent_hb:{aid}:last_run_at",)).fetchone()
                if lr_row and lr_row[0]:
                    try:
                        last_run_at = float(lr_row["value"] if hasattr(lr_row, "keys") else lr_row[0])
                    except Exception:
                        pass

            last_dur = st_mem.get("last_duration_ms")
            if last_dur is None:
                ld_row = cursor.execute("SELECT value FROM kv WHERE key = ?", (f"agent_hb:{aid}:last_dur",)).fetchone()
                if ld_row and ld_row[0]:
                    try:
                        last_dur = float(ld_row["value"] if hasattr(ld_row, "keys") else ld_row[0])
                    except Exception:
                        pass
                else:
                    last_dur = 0.0

            last_sum = st_mem.get("last_summary")
            if not last_sum:
                ls_row = cursor.execute("SELECT value FROM kv WHERE key = ?", (f"agent_hb:{aid}:last_sum",)).fetchone()
                if ls_row and ls_row[0]:
                    last_sum = str(ls_row["value"] if hasattr(ls_row, "keys") else ls_row[0])
                else:
                    last_sum = meta["default_summary"]

            # Quota calls today for this agent
            calls_today = int(breakdown.get(aid, 0))

            res.append({
                "id": aid,
                "name": meta["name"],
                "role": meta["role"],
                "status": status,
                "trigger_mode": "EVENT_DRIVEN",
                "last_run_at": last_run_at,
                "last_duration_ms": last_dur or 0.0,
                "last_summary": last_sum,
                "calls_today": calls_today,
                "is_paused": is_paused,
            })
        return res

    if c:
        return _read_kv(c)
    else:
        try:
            from app.db import tx
            with tx() as conn:
                return _read_kv(conn)
        except Exception as e:
            logger.debug(f"get_agents_heartbeat error: {e}")
            return [
                {
                    "id": aid,
                    "name": meta["name"],
                    "role": meta["role"],
                    "status": "IDLE",
                    "trigger_mode": "EVENT_DRIVEN",
                    "last_run_at": None,
                    "last_duration_ms": 0.0,
                    "last_summary": meta["default_summary"],
                    "calls_today": 0,
                    "is_paused": False,
                }
                for aid, meta in OPERATIONAL_AGENTS.items()
            ]


def toggle_pause_agent(agent_id: str, c=None) -> Dict[str, Any]:
    """Toggles pause status for a specific operational agent."""
    aid = (agent_id or "").strip().lower()
    if aid not in OPERATIONAL_AGENTS:
        return {"ok": False, "message": f"Agent không hợp lệ: {aid}"}

    def _apply(cursor):
        p_row = cursor.execute("SELECT value FROM kv WHERE key = ?", (f"agent_paused:{aid}",)).fetchone()
        current = bool(p_row and str(p_row["value"] if hasattr(p_row, "keys") else p_row[0]).strip() in ("1", "true", "True"))
        next_val = not current
        val_str = "1" if next_val else "0"
        cursor.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (f"agent_paused:{aid}", val_str),
        )
        return next_val

    if c:
        is_paused = _apply(c)
    else:
        from app.db import tx
        with tx() as conn:
            is_paused = _apply(conn)

    status = "PAUSED" if is_paused else "IDLE"
    _AGENT_EXEC_STATE.setdefault(aid, {})["is_paused"] = is_paused
    return {
        "ok": True,
        "agent_id": aid,
        "name": OPERATIONAL_AGENTS[aid]["name"],
        "is_paused": is_paused,
        "status": status,
        "message": f"Agent {OPERATIONAL_AGENTS[aid]['name']} đã {'tạm dừng' if is_paused else 'kích hoạt lại'}.",
    }


def wake_agent(agent_id: str, c=None) -> Tuple[bool, str, Dict[str, Any]]:
    """Wakes an agent for one immediate cycle protected by Atomic 60s Redis Lock.
    Returns (success, message, result_dict). If lock held, returns False with 409 conflict message."""
    aid = (agent_id or "").strip().lower()
    if aid not in OPERATIONAL_AGENTS:
        return False, f"Agent không hợp lệ: {aid}", {}

    # 1. Acquire atomic 60s lock
    if not acquire_agent_wake_lock(aid, ttl=60):
        return False, "Agent đang chạy chu kỳ hiện tại, chống chạy trùng", {}

    # 2. Execute cycle
    _AGENT_EXEC_STATE.setdefault(aid, {})["is_running"] = True
    t0 = time.perf_counter()
    summary = ""
    try:
        if aid == "sentinel":
            def _run_s(conn):
                return run_sentinel_cycle(conn)
            if c:
                _run_s(c)
            else:
                with tx() as conn:
                    _run_s(conn)
            summary = _SWARM_STATE["agents"]["sentinel"].get("last_action", "Quét lịch tin hoàn tất")

        elif aid == "alpha":
            def _run_a(conn):
                return run_alpha_cycle(conn)
            if c:
                _run_a(c)
            else:
                with tx() as conn:
                    _run_a(conn)
            summary = _SWARM_STATE["agents"]["alpha"].get("last_action", "Quét cấu trúc Alpha hoàn tất")

        elif aid == "risk_guardian":
            def _run_r(conn):
                return run_risk_guardian_cycle(conn)
            if c:
                _run_r(c)
            else:
                with tx() as conn:
                    _run_r(conn)
            summary = _SWARM_STATE["agents"]["risk_guardian"].get("last_action", "Giám sát rủi ro hoàn tất")

        elif aid == "research_wfo":
            from app.domains.ai.research_graph import run_autonomous_induction_and_wfo
            run_autonomous_induction_and_wfo(force=True)
            summary = "Chu kỳ tự học Hindsight & Walk-Forward hoàn tất thành công"

        dur_ms = round((time.perf_counter() - t0) * 1000.0, 1)
        now_ts = time.time()
        record_agent_heartbeat(c, aid, dur_ms, summary)

        return True, "Chu kỳ Agent đã được kích hoạt thành công", {
            "agent_id": aid,
            "name": OPERATIONAL_AGENTS[aid]["name"],
            "last_run_at": now_ts,
            "last_duration_ms": dur_ms,
            "last_summary": summary,
        }

    except Exception as exc:
        dur_ms = round((time.perf_counter() - t0) * 1000.0, 1)
        logger.warning(f"Error waking agent {aid}: {exc}")
        return False, f"Lỗi chạy chu kỳ Agent: {str(exc)}", {}
    finally:
        _AGENT_EXEC_STATE.setdefault(aid, {})["is_running"] = False

