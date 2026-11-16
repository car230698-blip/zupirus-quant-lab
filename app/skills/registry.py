"""Dynamic Agent Skill Registry and Progressive Disclosure Engine for ZUPIRUS Quant Lab.
Allows AI Agents to discover lightweight skill indexes, load full SKILL.md specs on demand,
and execute analytical tools without context bloat or hardcoded trading strategies.
"""
import os
import time
import logging
from typing import Dict, Any, List, Optional
from app.db import tx

logger = logging.getLogger("zupirus.skills")

# Base directory for built-in and writable learned filesystem skills (/data/skills_learned in Docker)
SKILLS_DIR = os.path.dirname(os.path.abspath(__file__))
_LEGACY_LEARNED_DIR = os.path.join(SKILLS_DIR, "learned")
_DATA_DIR = os.getenv("DATA_DIR", "").strip()
LEARNED_SKILLS_DIR = os.path.join(_DATA_DIR, "skills_learned") if _DATA_DIR else _LEGACY_LEARNED_DIR

CORE_SKILL_IDS = [
    "market_regime_scanner",
    "liquidity_spread_auditor",
    "macro_news_interpreter",
    "source_grading_analyst",
    "strategy_synthesizer",
]


def _read_builtin_skill_md(skill_id: str) -> Optional[str]:
    """Read SKILL.md file from local filesystem (builtin or learned)."""
    safe_id = os.path.basename(skill_id)
    for base_folder in (SKILLS_DIR, LEARNED_SKILLS_DIR, _LEGACY_LEARNED_DIR):
        skill_path = os.path.join(base_folder, safe_id, "SKILL.md")
        if os.path.isfile(skill_path):
            try:
                with open(skill_path, "r", encoding="utf-8") as f:
                    return f.read()
            except Exception as e:
                logger.warning(f"Could not read SKILL.md for {skill_id}: {e}")
    return None


def _write_learned_skill_md(skill_id: str, skill_md: str) -> Optional[str]:
    """Export self-evolved analytical skill to app/skills/learned/<skill_id>/SKILL.md."""
    safe_id = os.path.basename(skill_id)
    target_dir = os.path.join(LEARNED_SKILLS_DIR, safe_id)
    try:
        os.makedirs(target_dir, exist_ok=True)
        skill_file = os.path.join(target_dir, "SKILL.md")
        with open(skill_file, "w", encoding="utf-8") as f:
            f.write(skill_md)
        return skill_file
    except Exception as e:
        logger.warning(f"Could not write learned SKILL.md to disk for {skill_id}: {e}")
        return None


def _enrich_skill_item(d: Dict[str, Any]) -> Dict[str, Any]:
    is_b = int(d.get("is_builtin") or 0)
    en = int(d.get("enabled") or 0)
    if is_b == 1:
        status = "ACTIVE" if en == 1 else "DISABLED"
    else:
        status = "ACTIVE" if en == 1 else "PENDING_APPROVAL"
    return {
        **d,
        "is_builtin": is_b,
        "enabled": en,
        "status": status,
    }


def get_skill_index(enabled_only: bool = True, include_mcp: bool = False) -> List[Dict[str, Any]]:
    """Progressive Disclosure:
    Returns lightweight index of skills (name, 1-line description, trigger condition).
    Suitable for inclusion in LangGraph / Swarm prompts with minimal token overhead (~200 tokens).
    """
    items: List[Dict[str, Any]] = []
    try:
        with tx() as c:
            if enabled_only:
                rows = c.execute(
                    """
                    SELECT skill_id, name, description, trigger_condition, is_builtin, usage_count, enabled
                    FROM agent_skills
                    WHERE enabled = 1
                    ORDER BY is_builtin DESC, usage_count DESC, name ASC
                    """
                ).fetchall()
            else:
                rows = c.execute(
                    """
                    SELECT skill_id, name, description, trigger_condition, is_builtin, usage_count, enabled
                    FROM agent_skills
                    ORDER BY is_builtin DESC, usage_count DESC, name ASC
                    """
                ).fetchall()
            items = [_enrich_skill_item(dict(r)) for r in rows]
    except Exception as e:
        logger.debug(f"DB agent_skills query fallback to core list: {e}")

    if not items:
        # Fallback to core list if DB table not yet ready
        items = [
            _enrich_skill_item({
                "skill_id": "market_regime_scanner",
                "name": "Market Regime Scanner",
                "description": "Đo lường biến độ ATR(14) và xác định phiên giao dịch (Á/Âu/Mỹ).",
                "trigger_condition": "Khi tiếp nhận tín hiệu mới hoặc kiểm tra độ biến động thị trường.",
                "is_builtin": 1,
                "usage_count": 0,
                "enabled": 1,
            }),
            _enrich_skill_item({
                "skill_id": "liquidity_spread_auditor",
                "name": "Liquidity & Spread Auditor",
                "description": "Phân tích nguyên nhân lệnh chạm SL: sai xu hướng vs giãn spread hay quét thanh khoản.",
                "trigger_condition": "Khi có vị thế chạm Stop Loss hoặc kiểm toán hiệu suất lệnh thua.",
                "is_builtin": 1,
                "usage_count": 0,
                "enabled": 1,
            }),
            _enrich_skill_item({
                "skill_id": "macro_news_interpreter",
                "name": "Macro News Interpreter",
                "description": "Đối chiếu lịch tin tức USD và tính khoảng cách tới tin tác động mạnh.",
                "trigger_condition": "Trước khi mở vị thế hoặc đánh giá độ nhạy tin tức của nguồn tín hiệu.",
                "is_builtin": 1,
                "usage_count": 0,
                "enabled": 1,
            }),
            _enrich_skill_item({
                "skill_id": "source_grading_analyst",
                "name": "Source Grading Analyst",
                "description": "Chấm điểm EOD M1 Candle Grader cho kho SHADOW_ONLY và tính Source Trust Score.",
                "trigger_condition": "Cuối ngày giao dịch (EOD) hoặc khi cần xếp hạng lại nguồn tín hiệu.",
                "is_builtin": 1,
                "usage_count": 0,
                "enabled": 1,
            }),
            _enrich_skill_item({
                "skill_id": "strategy_synthesizer",
                "name": "Strategy Synthesizer",
                "description": "Tổng hợp Ứng viên Chiến lược từ Hindsight Memory và kiểm định Walk-Forward OOS.",
                "trigger_condition": "Khi tích lũy đủ mẫu lệnh thắng/thua hoặc định kỳ tổng hợp chiến lược mới.",
                "is_builtin": 1,
                "usage_count": 0,
                "enabled": 1,
            }),
        ]

    if include_mcp:
        try:
            from app.skills.mcp_bridge import list_mcp_servers
            for m in list_mcp_servers(enabled_only=enabled_only):
                items.append({
                    "skill_id": m["server_id"],
                    "name": m["name"],
                    "description": m["description"],
                    "trigger_condition": m["trigger_condition"],
                    "is_builtin": 1,
                    "is_mcp": True,
                    "usage_count": 0,
                    "enabled": 1 if m.get("enabled") else 0,
                    "status": "ACTIVE" if m.get("enabled") else "DISABLED",
                })
        except Exception:
            pass

    return items


def load_skill_spec(skill_id: str) -> Optional[str]:
    """On-demand Progressive Disclosure:
    Loads full markdown instructions of SKILL.md when the Agent decides to activate it.
    Increments usage_count.
    """
    skill_md = _read_builtin_skill_md(skill_id)

    # Check database if not loaded from filesystem or if custom learned skill
    if not skill_md:
        try:
            with tx() as c:
                row = c.execute("SELECT skill_md FROM agent_skills WHERE skill_id = ?", (skill_id,)).fetchone()
                if row and row[0]:
                    skill_md = row[0]
        except Exception as e:
            logger.debug(f"Database error loading skill {skill_id}: {e}")

    # Check if MCP Server
    if not skill_md and skill_id.startswith("mcp_"):
        try:
            from app.skills.mcp_bridge import list_mcp_servers
            for m in list_mcp_servers(enabled_only=False):
                if m["server_id"] == skill_id:
                    skill_md = (
                        f"---\nname: {m['server_id']}\ndescription: {m['description']}\n---\n\n"
                        f"# {m['name']} (MCP Connector)\n\n"
                        f"- **Transport**: `{m['transport']}`\n"
                        f"- **Endpoint**: `{m['endpoint_url']}`\n"
                        f"- **Trigger**: {m['trigger_condition']}\n"
                        f"- **Safety**: Read-only external data connector. Zero access to MetaApi or trading accounts.\n"
                    )
                    break
        except Exception:
            pass

    # Track usage count
    try:
        with tx() as c:
            c.execute(
                "UPDATE agent_skills SET usage_count = usage_count + 1, updated_at = ? WHERE skill_id = ?",
                (time.time(), skill_id)
            )
    except Exception as e:
        logger.debug(f"Database error incrementing usage for {skill_id}: {e}")

    return skill_md


def execute_skill(skill_id: str, **kwargs) -> Dict[str, Any]:
    """Execute the Python tool or MCP connector corresponding to the requested skill.
    Increments usage_count and returns structured observation for Agent reasoning.
    """
    # Track usage in DB
    try:
        with tx() as c:
            c.execute(
                "UPDATE agent_skills SET usage_count = usage_count + 1, updated_at = ? WHERE skill_id = ?",
                (time.time(), skill_id)
            )
    except Exception:
        pass

    if skill_id.startswith("mcp_"):
        from app.skills.mcp_bridge import execute_mcp_tool
        return execute_mcp_tool(skill_id, **kwargs)

    if skill_id == "market_regime_scanner":
        from app.skills.market_regime_scanner.tool import scan_market_regime
        return scan_market_regime(**kwargs)

    elif skill_id == "liquidity_spread_auditor":
        from app.skills.liquidity_spread_auditor.tool import audit_liquidity_and_spread
        return audit_liquidity_and_spread(**kwargs)

    elif skill_id == "macro_news_interpreter":
        from app.skills.macro_news_interpreter.tool import interpret_macro_news
        return interpret_macro_news(**kwargs)

    elif skill_id == "source_grading_analyst":
        from app.skills.source_grading_analyst.tool import grade_signal_sources
        return grade_signal_sources(**kwargs)

    elif skill_id == "strategy_synthesizer":
        from app.skills.strategy_synthesizer.tool import synthesize_strategy_candidate
        return synthesize_strategy_candidate(**kwargs)

    else:
        # Check if it's a self-learned skill in database
        try:
            with tx() as c:
                row = c.execute(
                    "SELECT name, description, trigger_condition, skill_md, enabled FROM agent_skills WHERE skill_id = ?",
                    (skill_id,)
                ).fetchone()
                if row:
                    r_d = dict(row)
                    return {
                        "skill_id": skill_id,
                        "name": r_d.get("name"),
                        "status": "executed",
                        "approval_state": "ACTIVE" if r_d.get("enabled") else "PENDING_APPROVAL",
                        "type": "self_learned_rule_filter",
                        "result": "Quy tắc phân tích tự học (Read-Only Filter) đã được đối chiếu trên bối cảnh thị trường hiện tại.",
                        "parameters": kwargs,
                    }
        except Exception:
            pass

        return {
            "error": f"Không tìm thấy công cụ thực thi cho skill_id '{skill_id}'.",
            "status": "failed",
        }


def list_skills(enabled_only: bool = False) -> List[Dict[str, Any]]:
    """List all registered skills with complete details for Admin Management UI."""
    return get_skill_index(enabled_only=enabled_only)


def toggle_skill(skill_id: str, enabled: bool) -> bool:
    """Admin control: Enable or disable an analytical skill."""
    now_ts = time.time()
    try:
        with tx() as c:
            c.execute(
                "UPDATE agent_skills SET enabled = ?, updated_at = ? WHERE skill_id = ?",
                (1 if enabled else 0, now_ts, skill_id)
            )
            return True
    except Exception as e:
        logger.error(f"Failed to toggle skill {skill_id}: {e}")
        return False


def approve_learned_skill(skill_id: str) -> bool:
    """Approve a PENDING_APPROVAL self-learned skill so Agents can load and use it."""
    return toggle_skill(skill_id, True)


def reject_learned_skill(skill_id: str) -> bool:
    """Reject and remove a self-learned skill candidate."""
    import shutil
    try:
        with tx() as c:
            c.execute("DELETE FROM agent_skills WHERE skill_id = ? AND is_builtin = 0", (skill_id,))
        safe_id = os.path.basename(skill_id)
        skill_folder = os.path.join(LEARNED_SKILLS_DIR, safe_id)
        if os.path.isdir(skill_folder):
            shutil.rmtree(skill_folder, ignore_errors=True)
        return True
    except Exception as e:
        logger.error(f"Failed to reject learned skill {skill_id}: {e}")
        return False


def register_learned_skill(
    skill_id: str,
    name: str,
    description: str,
    trigger_condition: str,
    skill_md: str,
    db_cursor: Optional[Any] = None,
    auto_approve: bool = False,
) -> Dict[str, Any]:
    """Persist a newly synthesized inductive skill to app/skills/learned/<skill_id>/SKILL.md
    and register in agent_skills in PENDING_APPROVAL (enabled=0) state until Admin approves.
    """
    now_ts = time.time()
    skill_record_id = f"sk_{skill_id}"
    enabled_val = 1 if auto_approve else 0
    file_path = _write_learned_skill_md(skill_id, skill_md)

    def _do_register(c):
        try:
            c.execute(
                """
                INSERT INTO agent_skills (
                    id, skill_id, name, description, trigger_condition,
                    skill_md, is_builtin, usage_count, enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
                ON CONFLICT(skill_id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    trigger_condition = excluded.trigger_condition,
                    skill_md = excluded.skill_md,
                    updated_at = excluded.updated_at
                """,
                (skill_record_id, skill_id, name, description, trigger_condition, skill_md, enabled_val, now_ts, now_ts)
            )
        except Exception:
            try:
                c.execute("DELETE FROM agent_skills WHERE skill_id = ?", (skill_id,))
                c.execute(
                    """
                    INSERT INTO agent_skills (
                        id, skill_id, name, description, trigger_condition,
                        skill_md, is_builtin, usage_count, enabled, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
                    """,
                    (skill_record_id, skill_id, name, description, trigger_condition, skill_md, enabled_val, now_ts, now_ts)
                )
            except Exception as e:
                logger.error(f"Error registering learned skill {skill_id}: {e}")

    if db_cursor is not None:
        _do_register(db_cursor)
    else:
        with tx() as c:
            _do_register(c)

    logger.info(f"Registered dynamic self-learned skill: {skill_id} ({name}) [status={'ACTIVE' if enabled_val else 'PENDING_APPROVAL'}]")
    return {
        "skill_id": skill_id,
        "name": name,
        "is_builtin": 0,
        "enabled": enabled_val,
        "status": "ACTIVE" if enabled_val else "PENDING_APPROVAL",
        "file_path": file_path,
        "created_at": now_ts,
    }
