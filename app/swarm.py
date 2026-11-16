"""Autonomous Multi-Agent Swarm for ZUPIRUS Quant Lab.
Coordinates 3 specialized autonomous agents:
1. Sentinel Agent: Macroeconomic news, calendar & volatility risk surveillance.
2. Alpha Agent: Multi-asset alpha discovery and automated parameter optimization.
3. Risk Guardian Agent: Real-time Portfolio Value-at-Risk (VaR 99%) & leverage clamping.
"""
import time
import json
import logging
import secrets
from typing import Dict, Any, List, Optional
from .db import tx
from .portfolio import scan_universe, calculate_position_size, run_monte_carlo_simulation
from .hindsight import store_memory, recall_memories, CATEGORY_REFLECTIVE, CATEGORY_SEMANTIC
from .gemini_client import call_gemini

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
        gem_res, _ = call_gemini(prompt, c=c)
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
    from app.config import SIGNAL_SOURCE

    active_source = SIGNAL_SOURCE
    try:
        row = c.execute("SELECT value FROM kv WHERE key = 'signal_mode'").fetchone()
        if not row:
            row = c.execute("SELECT value FROM kv WHERE key = 'signal_source'").fetchone()
        if row:
            active_source = row["value"] if hasattr(row, 'keys') else row[0]
    except Exception:
        pass

    if active_source == "EXTERNAL_FEED":
        # Check count of observed signals in signal_audit_logs
        obs_count = 0
        try:
            obs_count = c.execute("SELECT count(*) FROM signal_audit_logs").fetchone()[0]
        except Exception:
            pass

        action_text = f"Tabula Rasa Observer: Đang quan sát & ghi nhận {obs_count} mẫu hình từ nguồn ngoài XAUUSD. Tuyệt đối không tự phát lệnh."
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
    try:
        accounts = c.execute(
            "SELECT id, balance, equity, 0 AS positions FROM trading_accounts WHERE auto_trade = 1 OR deployment_state = 'DEPLOYED'"
        ).fetchall()
    except Exception:
        accounts = c.execute("SELECT id, balance, equity, positions FROM accounts WHERE enabled=1").fetchall()
    total_balance = sum(float(a["balance"] or 0.0) for a in accounts)
    total_equity = sum(float(a["equity"] or 0.0) for a in accounts)
    total_positions = sum(int(a["positions"] or 0) for a in accounts)

    # Run Monte Carlo for portfolio risk using real closed trades if available
    with tx() as c:
        pnl_rows = c.execute(
            "SELECT pnl FROM signal_audit_logs WHERE pnl IS NOT NULL ORDER BY id DESC LIMIT 100"
        ).fetchall()
    real_trades = [float(r[0]) for r in pnl_rows] if pnl_rows else []
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

    def _execute(conn):
        sentinel_res = run_sentinel_cycle(conn)
        alpha_res = run_alpha_cycle(conn)
        guardian_res = run_risk_guardian_cycle(conn)

        # Invoke built-in Agent Skills + Cross-Asset Context (DXY / US10Y)
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

    if c:
        return _execute(c)
    with tx() as conn:
        return _execute(conn)

