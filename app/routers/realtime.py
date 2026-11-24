"""Server-Sent Events (SSE) real-time streaming endpoints for Topbar, User, and Admin portals."""
import asyncio
import json
import time
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from app.redis_client import poll_realtime_events
from app.routers.deps import get_current_admin, get_current_user
from app.routers.telemetry import get_topbar_telemetry
from app.routers.telemetry_admin import get_admin_command_radar

router = APIRouter(prefix="/api/v1/stream", tags=["realtime"])

_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _sse_frame(event_name: str, data: dict) -> str:
    return f"event: {event_name}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


_TOPBAR_CACHE: dict = {"ts": 0.0, "data": None}


def _get_cached_topbar_telemetry() -> dict:
    now = time.time()
    if _TOPBAR_CACHE["data"] is not None and (now - _TOPBAR_CACHE["ts"]) < 1.2:
        return _TOPBAR_CACHE["data"]
    snap = get_topbar_telemetry()
    _TOPBAR_CACHE["ts"] = now
    _TOPBAR_CACHE["data"] = snap
    return snap


@router.get("/topbar")
async def stream_topbar(request: Request, oneshot: bool = Query(default=False)):
    """Real-time SSE stream for XAU/USD spot price, spread, and 4-layer shield status."""

    async def gen() -> AsyncGenerator[str, None]:
        last_sig = None
        last_ping = time.time()
        while True:
            if await request.is_disconnected():
                break
            try:
                snap = await asyncio.to_thread(get_topbar_telemetry if oneshot else _get_cached_topbar_telemetry)
                xau = snap.get("xauusd") or {}
                sig = (
                    xau.get("bid"),
                    xau.get("ask"),
                    xau.get("mid"),
                    xau.get("spread_pips"),
                    snap.get("system_status"),
                    json.dumps(snap.get("shield") or {}, sort_keys=True),
                    snap.get("usd_vnd_rate"),
                    snap.get("exchange_rate"),
                )
                if sig != last_sig or oneshot:
                    last_sig = sig
                    yield _sse_frame("topbar", snap)
                    last_ping = time.time()
                elif time.time() - last_ping >= 15.0:
                    yield ": ping\n\n"
                    last_ping = time.time()
            except Exception:
                yield ": ping\n\n"
            if oneshot:
                break
            await asyncio.sleep(1.5)

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/admin")
async def stream_admin(
    request: Request,
    oneshot: bool = Query(default=False),
    admin_user: dict = Depends(get_current_admin),
):
    """Real-time SSE stream for Admin Command Radar & AI Evolution updates."""

    async def gen() -> AsyncGenerator[str, None]:
        last_hash = None
        last_event_ts = time.time()
        last_ping = time.time()
        while True:
            if await request.is_disconnected():
                break
            try:
                rt_events = await asyncio.to_thread(poll_realtime_events, "admin", last_event_ts)
                for ev in rt_events:
                    last_event_ts = max(last_event_ts, float(ev.get("ts") or last_event_ts))
                    yield _sse_frame(str(ev.get("event") or "admin_event"), ev.get("data") or {})

                radar = await asyncio.to_thread(get_admin_command_radar, admin_user)
                sig = json.dumps(
                    {
                        "halted": radar.get("halted"),
                        "cards": [(c.get("key"), c.get("ok"), c.get("status_text")) for c in radar.get("health_cards", [])],
                        "alerts": len(radar.get("alerts", [])),
                        "tl": ((radar.get("timeline") or [{}])[0].get("ts") or (radar.get("timeline") or [{}])[0].get("time")) if radar.get("timeline") else None,
                    },
                    sort_keys=True,
                )
                if sig != last_hash or oneshot:
                    last_hash = sig
                    yield _sse_frame("radar", radar)
                    last_ping = time.time()
                elif time.time() - last_ping >= 15.0:
                    yield ": ping\n\n"
                    last_ping = time.time()
            except Exception:
                yield ": ping\n\n"
            if oneshot:
                break
            await asyncio.sleep(2.5)

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/user")
async def stream_user(
    request: Request,
    oneshot: bool = Query(default=False),
    u: dict = Depends(get_current_user),
):
    """Real-time SSE stream scoped strictly to the authenticated user (payments, fills, accounts)."""
    user_id = str(u["id"])

    async def gen() -> AsyncGenerator[str, None]:
        yield _sse_frame("connected", {"user_id": user_id, "ts": time.time()})
        if oneshot:
            return
        last_event_ts = time.time()
        last_ping = time.time()
        while True:
            if await request.is_disconnected():
                break
            try:
                rt_events = await asyncio.to_thread(poll_realtime_events, f"user:{user_id}", last_event_ts)
                if rt_events:
                    for ev in rt_events:
                        last_event_ts = max(last_event_ts, float(ev.get("ts") or last_event_ts))
                        yield _sse_frame(str(ev.get("event") or "user_event"), ev.get("data") or {})
                    last_ping = time.time()
                elif time.time() - last_ping >= 15.0:
                    yield ": ping\n\n"
                    last_ping = time.time()
            except Exception:
                yield ": ping\n\n"
            await asyncio.sleep(1.5)

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)
