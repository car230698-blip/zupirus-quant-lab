"""Signal Sources, Leaderboard, and Curator Administration Endpoints."""
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException

from app.routers.deps import get_current_admin, fail
from app.services.sources.curator import (
    list_sources,
    get_source,
    create_source,
    promote_source_to_live,
    demote_source_to_shadow,
    evaluate_shadow_signals_eod,
    run_instant_historical_replay,
    get_source_leaderboard,
    get_shadow_signals,
    MAX_ACTIVE_LIVE_SOURCES,
)

router = APIRouter(prefix="/api/admin/sources", tags=["Signal Sources & Curator"])


class CreateSourceRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    source_type: str = Field(..., description="TRADINGVIEW, METAAPI_FEED, TELEGRAM_SCRAPER, AGENT_INDUCTIVE")
    status: str = Field("SHADOW_ONLY", description="SHADOW_ONLY or ACTIVE_LIVE")
    symbol_universe: str = Field("XAUUSD,EURUSD,GBPUSD,USDJPY")
    config_json: Optional[Dict[str, Any]] = None


@router.get("")
def get_sources(status: Optional[str] = None, _admin=Depends(get_current_admin)):
    """List all registered signal sources and their metrics."""
    sources = list_sources(status=status)
    return {
        "sources": sources,
        "max_active_limit": MAX_ACTIVE_LIVE_SOURCES,
        "active_count": sum(1 for s in sources if s.get("status") == "ACTIVE_LIVE"),
    }


@router.post("")
def add_source(req: CreateSourceRequest, _admin=Depends(get_current_admin)):
    """Create a new signal source."""
    src = create_source(
        name=req.name,
        source_type=req.source_type,
        status=req.status,
        symbol_universe=req.symbol_universe,
        config_json=req.config_json,
    )
    return {"message": "Tạo nguồn tín hiệu thành công.", "source": src}


@router.get("/leaderboard")
def get_leaderboard(_admin=Depends(get_current_admin)):
    """Get sources ranked by trust score."""
    ranked = get_source_leaderboard()
    return {"leaderboard": ranked}


@router.get("/shadow-signals")
def get_shadow_ledger(
    source_id: Optional[str] = None,
    limit: int = 50,
    _admin=Depends(get_current_admin),
):
    """Retrieve recent shadow signal audit entries."""
    signals = get_shadow_signals(source_id=source_id, limit=limit)
    return {"signals": signals}


@router.post("/{source_id}/promote")
def promote_source(source_id: str, _admin=Depends(get_current_admin)):
    """Promote a shadow source to ACTIVE_LIVE."""
    ok, msg = promote_source_to_live(source_id)
    if not ok:
        fail(400, msg)
    return {"message": msg, "source": get_source(source_id)}


@router.post("/{source_id}/demote")
def demote_source(source_id: str, _admin=Depends(get_current_admin)):
    """Demote an active source to SHADOW_ONLY."""
    ok, msg = demote_source_to_shadow(source_id, reason="Admin manual demotion")
    if not ok:
        fail(400, msg)
    return {"message": msg, "source": get_source(source_id)}


@router.post("/{source_id}/replay")
def trigger_historical_replay(
    source_id: str,
    days: int = 90,
    _admin=Depends(get_current_admin),
):
    """Run instant 90-day M1 candle replay evaluation."""
    result = run_instant_historical_replay(source_id=source_id, days=days)
    return {"message": "Kiểm định lịch sử tức thì hoàn tất.", "result": result}


@router.post("/evaluate-eod")
def trigger_eod_evaluation(
    source_id: Optional[str] = None,
    _admin=Depends(get_current_admin),
):
    """Trigger End-of-Day dual-touch M1 candle grading."""
    res = evaluate_shadow_signals_eod(source_id=source_id)
    return {"message": "Chấm điểm EOD hoàn tất.", "evaluated_count": res.get("evaluated_count", 0), "details": res}

