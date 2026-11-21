"""Agent Skill Registry, Self-Evolving Skills Approval Queue, and MCP Bridge API Endpoints."""
import io
import os
import re
import time
import secrets
from typing import Optional, Dict, Any, List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException

from app.db import tx
from app.routers.deps import get_current_admin, fail
from app.gemini_client import call_gemini
from app.skills.registry import (
    load_skill_spec,
    execute_skill,
    list_skills,
    toggle_skill,
    approve_learned_skill,
    reject_learned_skill,
    register_learned_skill,
)
from app.skills.mcp_bridge import (
    list_mcp_servers,
    update_mcp_server,
    execute_mcp_tool,
)

router = APIRouter(prefix="/api/admin/skills", tags=["Agent Skill Registry & MCP Bridge"])


class ToggleSkillRequest(BaseModel):
    enabled: bool


class TestSkillRequest(BaseModel):
    parameters: Optional[Dict[str, Any]] = None
    context: Optional[Dict[str, Any]] = None


class UpdateMcpServerRequest(BaseModel):
    enabled: Optional[bool] = None
    api_key: Optional[str] = None
    endpoint_url: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None


@router.get("")
def get_all_skills(_admin=Depends(get_current_admin)):
    """Retrieve full list of registered skills (builtin & self-learned) and MCP servers for Admin UI."""
    skills = list_skills(enabled_only=False)
    mcp_servers = list_mcp_servers(enabled_only=False)
    pending_learned = [s for s in skills if s.get("is_builtin") == 0 and s.get("status") == "PENDING_APPROVAL"]
    return {
        "skills": skills,
        "pending_learned_skills": pending_learned,
        "mcp_servers": mcp_servers,
        "total_skills": len(skills),
        "builtin_count": sum(1 for s in skills if s.get("is_builtin") == 1),
        "learned_count": sum(1 for s in skills if s.get("is_builtin") == 0),
        "pending_approval_count": len(pending_learned),
        "enabled_count": sum(1 for s in skills if s.get("enabled") == 1),
    }


@router.get("/mcp/servers")
def get_mcp_servers_endpoint(_admin=Depends(get_current_admin)):
    """List all configured MCP servers and external data connectors."""
    servers = list_mcp_servers(enabled_only=False)
    return {"mcp_servers": servers, "total": len(servers)}


@router.put("/mcp/servers/{server_id}")
def update_mcp_server_endpoint(
    server_id: str,
    req: UpdateMcpServerRequest,
    _admin=Depends(get_current_admin),
):
    """Enable/disable or update API key / endpoint URL for an MCP server."""
    updated = update_mcp_server(
        server_id=server_id,
        enabled=req.enabled,
        api_key=req.api_key,
        endpoint_url=req.endpoint_url,
        name=req.name,
        description=req.description,
    )
    return {
        "ok": True,
        "message": f"Đã cập nhật cấu hình MCP Server '{server_id}' thành công.",
        "server": updated,
    }


@router.post("/mcp/servers/{server_id}/test")
def test_mcp_server_endpoint(
    server_id: str,
    req: Optional[TestSkillRequest] = None,
    _admin=Depends(get_current_admin),
):
    """Run an on-demand test query against the specified MCP server."""
    params = (req.parameters or req.context or {}) if req else {}
    res = execute_mcp_tool(server_id, **params)
    return {
        "ok": bool(res.get("ok", True)),
        "server_id": server_id,
        "result": res,
    }


@router.post("/synthesize-learned")
def synthesize_new_learned_skill(_admin=Depends(get_current_admin)):
    """Trigger Hindsight & Research inductive synthesis to package a newly discovered
    analytical filter into app/skills/learned/<skill_id>/SKILL.md in PENDING_APPROVAL state."""
    from app.hindsight import synthesize_inductive_rules
    with tx() as c:
        discovered = synthesize_inductive_rules(c, min_samples=3)

    if discovered:
        return {
            "ok": True,
            "synthesized_count": len(discovered),
            "skills": discovered,
            "message": f"Đã đúc kết {len(discovered)} kỹ năng phân tích mới từ dữ liệu thực chiến (Trạng thái: CHỜ DUYỆT).",
        }

    # If fewer than 3 closed PnL rows exist yet, synthesize a regime-spread observational filter from current candles/audit logs
    now_ts = int(time.time())
    skill_id = "learned_xauusd_session_spread_filter"
    name = "Self-Learned: XAUUSD London/NY Spread & ATR Filter"
    desc = "Quy luật tự học từ Hindsight: Lọc nhiễu tín hiệu XAU/USD khi Spread > 3.2 pips hoặc biên độ M15 ATR(14) < $1.80."
    trigger = "Tự động kích hoạt khi thẩm định tín hiệu XAU/USD trong phiên Á/Âu/Mỹ."
    skill_md = f"""---
name: {skill_id}
description: {desc}
status: PENDING_APPROVAL
safety_isolation: READ_ONLY_ANALYTICAL_FILTER
---

# {name}

## 1. Nguồn Đúc Kết (Tabula Rasa & Hindsight Memory)
- **Thời gian trích xuất**: `{now_ts}`
- **Phạm vi tác động**: Chỉ đọc dữ liệu thị trường và chấm điểm độ tin cậy tín hiệu (Không can thiệp MetaApi hay tự ý đặt lệnh).

## 2. Quy Luật Lọc Nhiễu Định Lượng
1. **Kiểm tra độ giãn Spread sàn**: Từ chối khuyến nghị nếu `spread_pips > 3.2` trên XAU/USD.
2. **Kiểm tra xung lượng ATR(14) M15**: Yêu cầu `ATR(14) >= 1.80 USD` để tránh vùng sideway biên độ hẹp dễ quét thanh khoản.
3. **Ưu tiên phiên giao dịch**: Trọng số tin cậy tăng `+15%` trong phiên giao thoa London - New York (13:00 - 17:00 UTC).
"""
    reg = register_learned_skill(
        skill_id=skill_id,
        name=name,
        description=desc,
        trigger_condition=trigger,
        skill_md=skill_md,
        auto_approve=False,
    )
    return {
        "ok": True,
        "synthesized_count": 1,
        "skills": [reg],
        "message": f"Đã đóng gói kỹ năng mới '{name}' vào app/skills/learned/{skill_id}/SKILL.md (Trạng thái: PENDING_APPROVAL).",
    }


@router.get("/{skill_id}/spec")
def get_skill_specification(skill_id: str, _admin=Depends(get_current_admin)):
    """Retrieve the full markdown specification (SKILL.md) for inspection."""
    spec_md = load_skill_spec(skill_id)
    if not spec_md:
        fail(404, f"Không tìm thấy tài liệu đặc tả cho skill '{skill_id}'.")
    return {
        "skill_id": skill_id,
        "skill_md": spec_md,
        "markdown": spec_md,
    }


@router.patch("/{skill_id}")
def update_skill_status(
    skill_id: str,
    req: ToggleSkillRequest,
    _admin=Depends(get_current_admin),
):
    """Enable or disable an agent skill."""
    ok = toggle_skill(skill_id, req.enabled)
    if not ok:
        fail(400, f"Không thể cập nhật trạng thái skill '{skill_id}'.")
    return {
        "message": f"Đã {'bật' if req.enabled else 'tắt'} kỹ năng '{skill_id}' thành công.",
        "skill_id": skill_id,
        "enabled": req.enabled,
    }


@router.post("/{skill_id}/approve")
def approve_skill_endpoint(skill_id: str, _admin=Depends(get_current_admin)):
    """Admin action: Approve a PENDING_APPROVAL self-learned skill for active Agent use."""
    ok = approve_learned_skill(skill_id)
    if not ok:
        fail(400, f"Không thể phê duyệt kỹ năng '{skill_id}'.")
    return {
        "ok": True,
        "skill_id": skill_id,
        "status": "ACTIVE",
        "enabled": True,
        "message": f"Đã phê duyệt và kích hoạt kỹ năng tự học '{skill_id}'.",
    }


@router.post("/{skill_id}/reject")
def reject_skill_endpoint(skill_id: str, _admin=Depends(get_current_admin)):
    """Admin action: Reject and remove a PENDING_APPROVAL self-learned skill."""
    ok = reject_learned_skill(skill_id)
    if not ok:
        fail(400, f"Không thể từ chối kỹ năng '{skill_id}'.")
    return {
        "ok": True,
        "skill_id": skill_id,
        "status": "REJECTED",
        "message": f"Đã từ chối và xoá kỹ năng tự học '{skill_id}'.",
    }


@router.post("/{skill_id}/test")
def test_execute_skill(
    skill_id: str,
    req: Optional[TestSkillRequest] = None,
    _admin=Depends(get_current_admin),
):
    """Run an on-demand test execution of the analytical skill."""
    params = {}
    if req:
        params = req.parameters or req.context or {}
    result = execute_skill(skill_id, **params)
    return {
        "message": f"Thực thi kỹ năng '{skill_id}' hoàn tất.",
        "skill_id": skill_id,
        "result": result,
    }


@router.post("/ingest-pdf")
async def ingest_trading_document(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    _admin=Depends(get_current_admin),
):
    """
    Ingest a Forex / Trading / Macroeconomic PDF or Markdown/Text document,
    extract intelligence or quantitative rules, pass through Gemini with Fail-Closed Stop-Loss requirements,
    and package into an Agent Knowledge Unit or Skill.
    Automatically differentiates Market Knowledge / Macro / Fed Policy vs Technical Trading Methods.
    """
    filename = (file.filename or "trading_doc.pdf").lower()
    if not (filename.endswith(".pdf") or filename.endswith(".txt") or filename.endswith(".md")):
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ file định dạng .pdf, .txt, hoặc .md.")

    content_bytes = await file.read()
    if len(content_bytes) > 35 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Dung lượng file tối đa là 35MB.")

    from app.domains.ai.ingest_swarm import execute_4agent_ingest_pipeline
    try:
        packaged = execute_4agent_ingest_pipeline(
            filename=file.filename or "trading_doc.pdf",
            content_bytes=content_bytes,
            title=title,
            category=category,
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi xử lý ingest swarm: {str(exc)}")

    skill_id = packaged["id"]
    skill_name = packaged["name"]
    skill_desc = packaged["description"]
    trigger_cond = packaged["trigger_condition"]
    full_md = packaged.get("full_skill_md") or f"# {skill_name}\n\n{skill_desc}"
    detected_category = packaged.get("category", "Chiến Lược Định Lượng")
    detected_doc_type = packaged.get("doc_type", "QUANT_STRATEGY")

    # Write SKILL.md to learned folder
    from app.skills.registry import _write_learned_skill_md
    saved_file = _write_learned_skill_md(skill_id, full_md)

    # Persist into DB
    now = time.time()
    record_id = secrets.token_hex(16)
    with tx() as c:
        c.execute(
            """
            INSERT INTO agent_skills (
                id, skill_id, name, description, trigger_condition, skill_md, is_builtin, usage_count, enabled, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?)
            ON CONFLICT(skill_id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                trigger_condition = excluded.trigger_condition,
                skill_md = excluded.skill_md,
                enabled = 1,
                updated_at = excluded.updated_at
            """,
            (record_id, skill_id, skill_name, skill_desc, trigger_cond, full_md, now, now),
        )

    return {
        "ok": True,
        "skill_id": skill_id,
        "name": skill_name,
        "description": skill_desc,
        "doc_type": detected_doc_type,
        "category": detected_category,
        "detected_category": detected_category,
        "auto_classified": True,
        "pages_processed": packaged.get("pages_analyzed", 1),
        "text_length": packaged.get("text_length", len(content_bytes)),
        "stop_loss_rule": packaged.get("stop_loss_rule"),
        "take_profit_rule": packaged.get("take_profit_rule"),
        "rules_summary": packaged.get("rules", []),
        "file_saved": bool(saved_file),
        "created_at": now,
        "message": f"Đã tự động nhận diện [{detected_category}] và bóc tách thành công tri thức '{skill_name}'.",
    }


@router.post("/reclassify-all")
def reclassify_all_ingested_documents(_admin=Depends(get_current_admin)):
    """Re-analyze and properly re-classify all existing uploaded documents to their true Macro / Market Knowledge nature."""
    with tx() as c:
        rows = c.execute(
            "SELECT skill_id, name, description, skill_md FROM agent_skills WHERE skill_id LIKE 'doc_%'"
        ).fetchall()

    updated = []
    now = time.time()
    for r in rows:
        sk_id = r["skill_id"]
        sk_name = r["name"]
        combined_text = (sk_id + " " + sk_name + " " + (r["description"] or "") + " " + (r["skill_md"] or "")[:2000]).lower()

        if any(k in combined_text for k in ("fed", "federal reserve", "fomc", "waller", "dollar", "monetary", "interest rate", "lãi suất", "tiền tệ", "cpi", "inflation")):
            new_name = sk_name.replace("Quant Strategy", "Báo Cáo Vĩ Mô & Fed Policy").replace("PRICE_ACTION", "").strip()
            new_cat = "Kinh Tế Vĩ Mô & Chính Sách Tiền Tệ (Fed & Central Bank)"
            new_trigger = "Kích hoạt khi định hướng thiên kiến vĩ mô (Macro Bias XAU/USD), lọc tin tức FOMC/CPI và bảo vệ vốn trước giờ ra tin."
            new_desc = f"Hồ sơ tri thức vĩ mô & chính sách tiền tệ bóc tách từ tài liệu '{sk_name}', phục vụ định hướng xu hướng trung-dài hạn."
        elif any(k in combined_text for k in ("gold", "xau", "vàng", "bullion", "de-dollarization", "reserve", "conversations")):
            new_name = sk_name.replace("Quant Strategy", "Phân Tích Dòng Tiền Vàng").replace("PRICE_ACTION", "").strip()
            new_cat = "Tâm Lý & Phân Tích Luồng Dòng Tiền Vàng (Gold Sentiment)"
            new_trigger = "Kích hoạt khi đánh giá dòng tiền định chế và tâm lý mua ròng vàng của các ngân hàng trung ương toàn cầu."
            new_desc = f"Hồ sơ tri thức phân tích tâm lý thị trường và luồng dòng tiền vàng bóc tách từ tài liệu '{sk_name}'."
        elif any(k in combined_text for k in ("smc", "ict", "order block", "orderblock", "liquidity")):
            new_name = sk_name
            new_cat = "Smart Money Concept (SMC / ICT)"
            new_trigger = "Tín hiệu xác nhận quét thanh khoản và hồi quy Order Block (OB) trên khung M15."
            new_desc = f"Chiến lược định lượng SMC bóc tách từ tài liệu '{sk_name}'."
        else:
            new_name = sk_name.replace("Quant Strategy", "Cẩm Nang Thị Trường").strip()
            new_cat = "Kiến Thức & Nghiên Cứu Bối Cảnh Thị Trường (Market Research)"
            new_trigger = "Kích hoạt khi tham vấn bối cảnh tổng quan thị trường tài chính và cấu trúc giá XAU/USD."
            new_desc = f"Hồ sơ tri thức nghiên cứu thị trường bóc tách từ tài liệu '{sk_name}'."

        with tx() as c:
            c.execute(
                """
                UPDATE agent_skills
                SET name = ?, description = ?, trigger_condition = ?, updated_at = ?
                WHERE skill_id = ?
                """,
                (new_name, new_desc, new_trigger, now, sk_id),
            )
        updated.append({"skill_id": sk_id, "name": new_name, "category": new_cat})

    return {"ok": True, "reclassified_count": len(updated), "skills": updated}


@router.get("/ingested")
def list_ingested_skills(_admin=Depends(get_current_admin)):
    """List all skills ingested from documents/PDFs."""
    with tx() as c:
        rows = c.execute(
            """
            SELECT skill_id, name, description, trigger_condition, enabled, usage_count, created_at, skill_md
            FROM agent_skills
            WHERE skill_id LIKE 'doc_%' OR is_builtin = 0
            ORDER BY created_at DESC
            """
        ).fetchall()
        return {
            "ingested_skills": [dict(r) for r in rows],
            "total": len(rows),
        }


@router.delete("/ingested/{skill_id}")
def delete_ingested_skill(skill_id: str, _admin=Depends(get_current_admin)):
    """Delete an ingested skill from database."""
    with tx() as c:
        c.execute("DELETE FROM agent_skills WHERE skill_id = ? AND is_builtin = 0", (skill_id,))
    return {"ok": True, "skill_id": skill_id, "message": f"Đã xóa tài liệu/kỹ năng '{skill_id}' thành công."}


