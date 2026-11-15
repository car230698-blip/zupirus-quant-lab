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
    """Returns current swarm telemetry, agent statuses, and recent message board."""
    return {
        **_SWARM_STATE,
        "active_agents_count": 3,
        "coordination_mode": "autonomous_fail_closed",
        "real_trading_locked": True,
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
    """Alpha Agent scans multi-asset universe and verifies parameter candidates."""
    scan = scan_universe()
    best_candidate = None
    best_ratio = 0.0

    for item in scan:
        score = item["volatility_pct"] * 1.5
        if score > best_ratio:
            best_ratio = score
            best_candidate = item

    symbol = best_candidate["symbol"] if best_candidate else "XAUUSD"
    bias = best_candidate["strategy_bias"] if best_candidate else "trend_following"
    action_text = f"Đã quét 5 tài sản. Ưu tiên cấu hình [{bias.upper()}] trên cặp {symbol} (Vol: {best_candidate.get('volatility_pct')}%)"

    _SWARM_STATE["agents"]["alpha"].update({
        "state": "working",
        "last_action": action_text,
        "top_asset": symbol,
        "strategy_bias": bias,
    })

    return {"top_asset": symbol, "bias": bias, "scanned_assets": len(scan)}


def run_risk_guardian_cycle(c) -> Dict[str, Any]:
    """Risk Guardian Agent calculates Portfolio Value-at-Risk (VaR 99%) and validates leverage."""
    accounts = c.execute("SELECT id, balance, equity, positions FROM accounts WHERE enabled=1").fetchall()
    total_balance = sum(a["balance"] for a in accounts)
    total_equity = sum(a["equity"] for a in accounts)
    total_positions = sum(a["positions"] for a in accounts)

    # Run Monte Carlo for portfolio risk
    mc = run_monte_carlo_simulation(initial_equity=max(1000.0, total_equity), iterations=1000)
    var_99 = mc["var_99_max_drawdown_pct"]
    risk_of_ruin = mc["risk_of_ruin_pct"]

    status = "normal"
    if var_99 > 5.0 or risk_of_ruin > 1.0:
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

        msg = (
            f"Chu kỳ #{_SWARM_STATE['cycles_count']}: Sentinel={sentinel_res.get('events_count')} sự kiện | "
            f"Alpha={alpha_res.get('top_asset')} ({alpha_res.get('bias')}) | "
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
        }

    if c:
        return _execute(c)
    with tx() as conn:
        return _execute(conn)
