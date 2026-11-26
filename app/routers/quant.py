"""Admin endpoints for studies, methodology drafts, buyers, and PDF orders."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.domains.quant.candles import CandleValidationError
from app.domains.quant.service import (
    create_methodology_from_candles,
    list_buyers,
    list_pdf_orders,
    list_studies,
    load_candles,
)
from app.routers.deps import fail, get_current_admin

router = APIRouter(tags=["quant"])


class CandleIn(BaseModel):
    time: float
    open: float
    high: float
    low: float
    close: float
    volume: float = 0


class StudyRequest(BaseModel):
    symbol: str = "XAUUSD"
    timeframe: str = "M15"
    title_vi: str = Field(min_length=4, max_length=180)
    title_en: str = Field(min_length=4, max_length=180)
    price_usd: float = Field(gt=0, le=10000)
    price_vnd: Optional[int] = None
    version: str = "v1.0"
    round_trip_cost_r: float = 0.0
    source: str = "QUANT_IMPORT"
    candles: Optional[List[CandleIn]] = None
    use_stored_candles: bool = False


@router.post("/api/v1/admin/quant/studies")
@router.post("/api/admin/quant/studies")
def api_run_study(body: StudyRequest, admin: dict = Depends(get_current_admin)):
    """Compute a study and save a draft methodology. Does not publish it."""
    if body.use_stored_candles:
        rows = load_candles(symbol=body.symbol, timeframe=body.timeframe, source=body.source)
    else:
        rows = [item.model_dump() for item in (body.candles or [])]
    if len(rows) < 2:
        fail(400, "Cần ít nhất 2 nến OHLC để chạy nghiên cứu.")
    try:
        created = create_methodology_from_candles(
            rows,
            symbol=body.symbol,
            timeframe=body.timeframe,
            title_vi=body.title_vi,
            title_en=body.title_en,
            price_usd=body.price_usd,
            price_vnd=body.price_vnd,
            version=body.version,
            round_trip_cost_r=body.round_trip_cost_r,
            source=body.source,
            admin_id=str(admin.get("id") or "admin"),
            store_candles=not body.use_stored_candles,
        )
    except CandleValidationError as exc:
        fail(400, str(exc))
    except ValueError as exc:
        fail(400, str(exc))
    return created


@router.get("/api/v1/admin/quant/studies")
@router.get("/api/admin/quant/studies")
def api_list_studies(admin: dict = Depends(get_current_admin)):
    items = list_studies()
    return {"items": items, "count": len(items)}


@router.get("/api/v1/admin/library/buyers")
@router.get("/api/admin/library/buyers")
def api_list_buyers(admin: dict = Depends(get_current_admin)):
    items = list_buyers()
    return {"items": items, "count": len(items)}


@router.get("/api/v1/admin/library/orders")
@router.get("/api/admin/library/orders")
def api_list_orders(admin: dict = Depends(get_current_admin)):
    items = list_pdf_orders()
    return {"items": items, "count": len(items)}
