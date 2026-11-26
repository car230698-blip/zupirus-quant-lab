"""Admin endpoints for studies, methodology drafts, buyers, and PDF orders."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, confloat

from app.domains.quant.candles import CandleValidationError, normalize_candles, parse_csv_candles
from app.domains.quant.service import (
    create_methodology_from_candles,
    get_study,
    ingest_candles,
    list_buyers,
    list_pdf_orders,
    list_studies,
    load_candles,
)
from app.domains.quant.studies import run_studies
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
    strategy_name: str = "breakout_retest"
    title_vi: str = Field(min_length=4, max_length=180)
    title_en: str = Field(min_length=4, max_length=180)
    price_usd: float = Field(gt=0, le=10000)
    price_vnd: Optional[int] = None
    version: str = "v1.0"
    round_trip_cost_r: confloat(ge=0, le=5, allow_inf_nan=False) = 0.0
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
            strategy_name=body.strategy_name,
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


class UploadCsvRequest(BaseModel):
    csv_text: str = Field(min_length=10)
    symbol: str = "XAUUSD"
    timeframe: str = "M15"
    source: str = "CSV_UPLOAD"
    save_to_db: bool = False


class RunLabStudyRequest(BaseModel):
    symbol: str = "XAUUSD"
    timeframe: str = "M15"
    strategy_name: str = "breakout_retest"
    round_trip_cost_r: confloat(ge=0, le=5, allow_inf_nan=False) = 0.0
    source: str = "QUANT_IMPORT"
    use_stored_candles: bool = False
    candles: Optional[List[CandleIn]] = None


@router.post("/api/v1/admin/quant/lab/upload-csv")
@router.post("/api/admin/quant/lab/upload-csv")
def api_upload_csv(body: UploadCsvRequest, admin: dict = Depends(get_current_admin)):
    """Parse raw CSV text (MT4/5, TradingView, Dukascopy), validate candles and return preview stats."""
    try:
        raw_rows = parse_csv_candles(body.csv_text)
        candles = normalize_candles(raw_rows)
    except CandleValidationError as exc:
        fail(400, f"Lỗi định dạng CSV: {exc}")
    except Exception as exc:
        fail(400, f"Không thể xử lý dữ liệu CSV: {exc}")

    if len(candles) < 2:
        fail(400, "Cần tối thiểu 2 nến hợp lệ.")

    cand_dicts = [
        {
            "time": c.time,
            "open": c.open,
            "high": c.high,
            "low": c.low,
            "close": c.close,
            "volume": c.volume,
        }
        for c in candles
    ]

    saved_count = 0
    if body.save_to_db:
        try:
            saved_count = ingest_candles(
                cand_dicts,
                symbol=body.symbol,
                timeframe=body.timeframe,
                source=body.source,
            )
        except Exception as exc:
            fail(400, f"Lỗi lưu trữ nến vào cơ sở dữ liệu: {exc}")

    from datetime import datetime, timezone
    start_dt = datetime.fromtimestamp(candles[0].time, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    end_dt = datetime.fromtimestamp(candles[-1].time, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    return {
        "success": True,
        "symbol": body.symbol.upper(),
        "timeframe": body.timeframe.upper(),
        "total_candles": len(candles),
        "start_time": candles[0].time,
        "end_time": candles[-1].time,
        "start_datetime": start_dt,
        "end_datetime": end_dt,
        "saved_to_db": body.save_to_db,
        "saved_count": saved_count,
        "sample_preview": cand_dicts[:10],
        "candles": cand_dicts,
    }


@router.post("/api/v1/admin/quant/lab/run")
@router.post("/api/admin/quant/lab/run")
def api_run_lab_study(body: RunLabStudyRequest, admin: dict = Depends(get_current_admin)):
    """Run full quantitative statistical analysis, Walk-Forward, Monte Carlo tail risk, and cost matrix."""
    if body.use_stored_candles:
        rows = load_candles(symbol=body.symbol, timeframe=body.timeframe, source=body.source)
    else:
        rows = [item.model_dump() for item in (body.candles or [])]
    if len(rows) < 2:
        fail(400, "Cần ít nhất 2 nến OHLC để chạy nghiên cứu.")

    try:
        bundle = run_studies(
            rows,
            symbol=body.symbol,
            timeframe=body.timeframe,
            strategy_name=body.strategy_name,
            round_trip_cost_r=body.round_trip_cost_r,
        )
    except CandleValidationError as exc:
        fail(400, str(exc))
    except Exception as exc:
        fail(500, f"Lỗi tính toán định lượng: {exc}")

    rule_study = next((s for s in bundle.get("studies", []) if str(s.get("id", "")).startswith("rule_backtest")), {})
    metrics_tbl = {row[0]: row[1] for row in rule_study.get("table", {}).get("rows", [])} if rule_study else {}

    return {
        "success": True,
        "bundle": bundle,
        "summary": {
            "candle_count": bundle.get("candle_count"),
            "range_start": bundle.get("range_start"),
            "range_end": bundle.get("range_end"),
            "symbol": bundle.get("symbol"),
            "timeframe": bundle.get("timeframe"),
            "trades_count": rule_study.get("sample_size"),
            "win_rate": metrics_tbl.get("win_rate"),
            "profit_factor": metrics_tbl.get("profit_factor"),
            "max_drawdown_r": metrics_tbl.get("max_drawdown_r"),
            "sharpe_ratio": metrics_tbl.get("sharpe_ratio"),
            "sortino_ratio": metrics_tbl.get("sortino_ratio"),
            "calmar_ratio": metrics_tbl.get("calmar_ratio"),
            "t_statistic": metrics_tbl.get("t_statistic"),
            "p_value": metrics_tbl.get("p_value"),
            "cost_stress_matrix": rule_study.get("cost_stress_matrix"),
            "monte_carlo_risk": rule_study.get("monte_carlo_risk"),
            "equity_series": rule_study.get("equity_series", []),
            "drawdown_series": rule_study.get("drawdown_series", []),
        },
    }


@router.get("/api/v1/admin/quant/studies/{study_id}")
@router.get("/api/admin/quant/studies/{study_id}")
def api_get_study(study_id: str, admin: dict = Depends(get_current_admin)):
    from app.domains.quant.service import get_study
    item = get_study(study_id)
    if not item:
        fail(404, "Không tìm thấy nghiên cứu định lượng.")
    return item


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


class DataSyncRequest(BaseModel):
    symbol: str = "XAUUSD"
    timeframe: str = "M15"
    range_str: str = "5d"


@router.post("/api/v1/admin/quant/data/sync")
@router.post("/api/admin/quant/data/sync")
def api_sync_market_data(body: DataSyncRequest, admin: dict = Depends(get_current_admin)):
    """Fetch live institutional market data from public feeds and store into TimescaleDB/SQLite."""
    from app.domains.quant.data_feed import sync_market_candles
    try:
        result = sync_market_candles(symbol=body.symbol, timeframe=body.timeframe, range_str=body.range_str)
        return {"success": True, "data": result}
    except Exception as exc:
        fail(500, f"Lỗi đồng bộ dữ liệu thị trường: {exc}")


@router.get("/api/v1/admin/quant/data/status")
@router.get("/api/admin/quant/data/status")
def api_get_data_status(admin: dict = Depends(get_current_admin)):
    """Return candle inventory and health check across tracked symbols/timeframes."""
    from app.domains.quant.data_feed import get_market_data_status
    try:
        items = get_market_data_status()
        return {"success": True, "items": items}
    except Exception as exc:
        fail(500, f"Lỗi kiểm tra trạng thái dữ liệu: {exc}")

