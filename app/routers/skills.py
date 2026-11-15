"""Agent Skill Registry and Management API Endpoints."""
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException

from app.routers.deps import get_current_admin, get_current_user, fail
from app.skills.registry import (
    get_skill_index,
    load_skill_spec,
    execute_skill,
    list_skills,
    toggle_skill,
)

router = APIRouter(prefix="/api/admin/skills", tags=["Agent Skill Registry"])


class ToggleSkillRequest(BaseModel):
    enabled: bool


class TestSkillRequest(BaseModel):
    parameters: Optional[Dict[str, Any]] = None


@router.get("")
def get_all_skills(_admin=Depends(get_current_admin)):
    """Retrieve full list of registered skills (builtin & self-learned) for Admin UI."""
    skills = list_skills(enabled_only=False)
    return {
        "skills": skills,
        "total_skills": len(skills),
        "builtin_count": sum(1 for s in skills if s.get("is_builtin") == 1),
        "learned_count": sum(1 for s in skills if s.get("is_builtin") == 0),
        "enabled_count": sum(1 for s in skills if s.get("enabled") == 1),
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


@router.post("/{skill_id}/test")
def test_execute_skill(
    skill_id: str,
    req: Optional[TestSkillRequest] = None,
    _admin=Depends(get_current_admin),
):
    """Run an on-demand test execution of the analytical skill."""
    params = req.parameters if req and req.parameters else {}
    result = execute_skill(skill_id, **params)
    return {
        "message": f"Thực thi kỹ năng '{skill_id}' hoàn tất.",
        "skill_id": skill_id,
        "result": result,
    }
