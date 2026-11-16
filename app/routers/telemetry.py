"""Global Top Telemetry Bar API Endpoint for app.zupirus.com and adm.zupirus.com."""
import time
import logging
from typing import Dict, Any, Optional, List
import os
import json
from fastapi import APIRouter, Depends

from app.db import tx, getkv
from app.routers.deps import get_current_admin
from app.services.fx_rate import get_usd_vnd_rate
from app.services.signal_ingestion.context import get_nearest_news_info
from app.services.sources.curator import count_active_sources, get_sources_counts

logger = logging.getLogger("zupirus.telemetry")

router = APIRouter(prefix="/api/v1/telemetry", tags=["Telemetry"])


def get_live_xauusd_quote() -> Dict[str, Any]:
    """Retrieve real-time XAUUSD quote strictly from authentic market sources:
    1. Redis live quote cache (updated by MetaApi streamer)
    2. TimescaleDB/Postgres latest quote tick
    3. TimescaleDB/Postgres latest M1/M15 candle
    Returns data_available=False if no authentic market data is reachable (no synthetic PAXG or fake constants).
    """
    now_ts = time.time()

    # 1. Redis live stream quote check
    try:
        from app.redis_client import get_redis_client
        rc = get_redis_client()
        cached = rc.get("quote:XAUUSD:live")
        if cached:
            val_str = cached.decode("utf-8") if isinstance(cached, bytes) else str(cached)
            parts = val_str.split(":")
            if len(parts) >= 2:
                bid, ask = float(parts[0]), float(parts[1])
                spread_pips = round(max(abs(ask - bid), 0.10) * 10, 1)
                return {
                    "bid": bid,
                    "ask": ask,
                    "mid": round((bid + ask) / 2, 2),
                    "spread_pips": spread_pips,
                    "live": True,
                    "data_available": True,
                    "stale": False,
                    "source": "REDIS_STREAM",
                }
    except Exception:
        pass

    # 2. Database quotes check (from MetaApi real quotes stream)
    try:
        with tx() as c:
            q_row = c.execute(
                "SELECT bid, ask, ts FROM quotes WHERE symbol = 'XAUUSD' ORDER BY ts DESC LIMIT 1"
            ).fetchone()
            if q_row and q_row[0] and q_row[1]:
                bid = float(q_row[0])
                ask = float(q_row[1])
                quote_ts = float(q_row[2]) if q_row[2] else 0.0
                age_seconds = now_ts - quote_ts
                is_stale = age_seconds > 180.0  # Older than 3 minutes
                spread_pips = round(max(abs(ask - bid), 0.10) * 10, 1)
                return {
                    "bid": bid,
                    "ask": ask,
                    "mid": round((bid + ask) / 2, 2),
                    "spread_pips": spread_pips,
                    "live": not is_stale,
                    "data_available": True,
                    "stale": is_stale,
                    "source": "DB_QUOTES",
                    "age_seconds": round(age_seconds, 1),
                }

            # 3. Fallback to latest closed candle
            c_row = c.execute(
                "SELECT close, time FROM candles WHERE symbol = 'XAUUSD' ORDER BY time DESC LIMIT 1"
            ).fetchone()
            if c_row and c_row[0]:
                close_p = float(c_row[0])
                candle_ts = float(c_row[1]) if c_row[1] else 0.0
                age_seconds = now_ts - candle_ts
                bid = close_p
                ask = close_p
                return {
                    "bid": bid,
                    "ask": ask,
                    "mid": close_p,
                    "spread_pips": 0.0,
                    "live": False,
                    "data_available": True,
                    "stale": True,
                    "source": "DB_CANDLE_FALLBACK",
                    "age_seconds": round(age_seconds, 1),
                }
    except Exception as e:
        logger.debug(f"DB quote read error: {e}")

    # No authentic quote available
    return {
        "bid": None,
        "ask": None,
        "mid": None,
        "spread_pips": None,
        "live": False,
        "data_available": False,
        "stale": True,
        "source": "NONE",
    }


@router.get("/topbar")
def get_topbar_telemetry():
    """Retrieve unified telemetry for the live header bar:
    - Live XAUUSD price and spread from TimescaleDB / MetaApi / Market Stream
    - USD/VND rate
    - High-impact USD News Shield countdown & state (aligned with 15m blackout)
    - MetaApi London G2 terminal latency
    - Active live and shadow signal sources count
    """
    now_ts = time.time()

    # 1. USD/VND Rate
    rate, source, _ = get_usd_vnd_rate()

    # 2. XAUUSD Live Market Quote
    quote = get_live_xauusd_quote()

    # 3. News Shield info (Blackout threshold 15 minutes, Warning 60 minutes)
    news_dist_mins, nearest_title = 999.0, None
    try:
        with tx() as c:
            news_dist_mins, nearest_title = get_nearest_news_info(c, now_ts)
    except Exception as e:
        logger.debug(f"Telemetry News Shield error: {e}")

    # Determine News Shield state
    news_status = "CLEAR"
    if news_dist_mins <= 15.0:
        news_status = "BLACKOUT"
    elif news_dist_mins <= 60.0:
        news_status = "WARNING"

    # Signal sources counts
    sources_counts = {"active_live": 0, "shadow_only": 0}
    try:
        sources_counts = get_sources_counts()
    except Exception:
        try:
            sources_counts["active_live"] = count_active_sources()
        except Exception:
            pass

    # 4. Measure real Redis & DB latency and query average MetaApi execution latency
    redis_ok = False
    redis_ping_ms = 0.0
    try:
        from app.redis_client import get_redis_client
        t_r = time.perf_counter()
        rc = get_redis_client()
        redis_ok = bool(rc.ping())
        redis_ping_ms = round((time.perf_counter() - t_r) * 1000.0, 2)
    except Exception:
        pass

    db_ping_ms = 0.0
    avg_exec_lat_ms = 0
    is_halted = False
    try:
        t_db = time.perf_counter()
        with tx() as c:
            c.execute("SELECT 1").fetchone()
            db_ping_ms = round((time.perf_counter() - t_db) * 1000.0, 2)
            lat_row = c.execute(
                "SELECT AVG(latency_ms) FROM metaapi_trade_executions WHERE latency_ms > 0"
            ).fetchone()
            if lat_row and lat_row[0]:
                avg_exec_lat_ms = int(round(float(lat_row[0])))
            h_row = c.execute("SELECT value FROM kv WHERE key='halted'").fetchone()
            if h_row and str(h_row[0]).strip() in ("1", "true", "True"):
                is_halted = True
    except Exception:
        pass

    spread_val = quote.get("spread_pips")
    spread_ok = spread_val is not None and float(spread_val) <= 4.5
    shields = [
        {
            "layer": "L1",
            "name": "Chống Lặp Tín Hiệu (Idempotency Lock)",
            "detail": f"Redis + DB Lock ({redis_ping_ms}ms)" if redis_ok else "DB Atomic Lock Fallback",
            "status": "ACTIVE" if not is_halted else "HALTED",
            "latency_ms": redis_ping_ms,
        },
        {
            "layer": "L2",
            "name": "Bắt Buộc SL & Kiểm Soát Spread",
            "detail": f"ATR(14) Auto-SL · Spread {spread_val}p" if spread_val is not None else "ATR(14) Auto-SL · Chờ giá live",
            "status": "ACTIVE" if spread_ok else ("WARNING" if spread_val is not None else "IDLE"),
            "latency_ms": db_ping_ms,
        },
        {
            "layer": "L3",
            "name": "Lá Chắn Tin Đỏ USD (News Shield)",
            "detail": (
                f"ĐANG CHẶN ({nearest_title})" if news_status == "BLACKOUT"
                else (f"Cảnh báo sau {round(news_dist_mins)}p ({nearest_title})" if news_status == "WARNING" else "Không có tin đỏ ±15p")
            ),
            "status": "BLOCKED" if news_status == "BLACKOUT" else ("WARNING" if news_status == "WARNING" else "ACTIVE"),
            "latency_ms": db_ping_ms,
        },
        {
            "layer": "L4",
            "name": "Kiểm Soát Trượt Giá (Slippage Guard)",
            "detail": "Biên độ khớp tối đa ≤ 20 pips ($2.00)",
            "status": "ACTIVE" if quote.get("live") else "STANDBY",
            "latency_ms": avg_exec_lat_ms or int(round(db_ping_ms + redis_ping_ms)),
        },
    ]

    return {
        "xauusd": {
            "symbol": "XAUUSD",
            "bid": quote["bid"],
            "ask": quote["ask"],
            "mid": quote["mid"],
            "spread_pips": quote["spread_pips"],
            "live": quote.get("live", False),
            "data_available": quote.get("data_available", False),
            "stale": quote.get("stale", True),
            "source": quote.get("source", "NONE"),
        },
        "usd_vnd": {
            "rate": rate,
            "source": source,
        },
        "news_shield": {
            "status": news_status,
            "distance_mins": round(news_dist_mins, 1),
            "nearest_title": nearest_title,
        },
        "shields": shields,
        "redis_ping_ms": redis_ping_ms,
        "db_ping_ms": db_ping_ms,
        "metaapi_latency_ms": avg_exec_lat_ms if avg_exec_lat_ms > 0 else int(round(db_ping_ms + redis_ping_ms)),
        "region": "London G2",
        "active_sources_count": sources_counts.get("active_live", 0),
        "shadow_sources_count": sources_counts.get("shadow_only", 0),
        "system_status": "HALTED" if is_halted else "OPERATIONAL",
        "server_time": now_ts,
    }


def _humanize_audit_event(event: str, detail_str: str) -> str:
    try:
        d = json.loads(detail_str) if detail_str else {}
    except Exception:
        d = {}
    ev = str(event or "")
    if ev == "auto_calendar_synced":
        return f"Đồng bộ lịch tin kinh tế USD tự động (+{d.get('added', 0)} tin mới)."
    if ev == "trading_account_cloud_connected":
        return f"Khách hàng kết nối mới MT5 #{d.get('login', '')} ({d.get('server', '')}) và tự động bật Cloud."
    if ev == "expired_account_undeployed":
        return f"Tự động thu hồi Cloud MT5 tài khoản hết hạn ({d.get('account_id', '')}) để tiết kiệm chi phí."
    if ev == "circuit_breaker_triggered":
        return f"Lá chắn Prop Firm ngắt mạch khẩn cấp tài khoản {d.get('account_id', '')} (DD {d.get('drawdown_pct', '')}%)."
    if ev == "kill_switch_toggled":
        return "Admin thay đổi trạng thái Cầu Dao Khẩn Cấp (Kill-Switch)."
    return f"Hệ thống ghi nhận: {ev}"


@router.get("/admin-radar")
def get_admin_command_radar(_admin=Depends(get_current_admin)):
    """Simplified 3-block Command Radar for adm.zupirus.com Tab 1:
    1. 4-lamp System Health Radar
    2. Natural-language Live AI Decision Feed
    3. Error & Exception Alert Center
    """
    now_ts = time.time()
    quote = get_live_xauusd_quote()
    alerts: List[Dict[str, Any]] = []
    timeline: List[Dict[str, Any]] = []

    with tx() as c:
        halt_row = c.execute("SELECT value FROM kv WHERE key='halted'").fetchone()
        is_halted = bool(halt_row and str(halt_row[0]).strip() in ("1", "true", "True"))

        exec_hb = getkv(c, "execution_heartbeat")
        res_hb = getkv(c, "research_heartbeat")
        exec_ok = bool(exec_hb and (now_ts - float(exec_hb)) < 60)
        res_ok = bool(res_hb and (now_ts - float(res_hb)) < 120)

        # Gemini Pool & AI key health
        active_gemini = 0
        rate_limited_gemini = 0
        try:
            g_rows = c.execute("SELECT status FROM gemini_api_keys").fetchall()
            for gr in g_rows:
                st = str(gr[0] or "").lower()
                if st == "active":
                    active_gemini += 1
                elif "limit" in st or "exhaust" in st:
                    rate_limited_gemini += 1
        except Exception:
            pass
        ai_cfg_row = c.execute("SELECT value FROM kv WHERE key='ai_provider_config'").fetchone()
        has_custom_ai = False
        if ai_cfg_row and ai_cfg_row[0]:
            try:
                cfg = json.loads(ai_cfg_row[0])
                has_custom_ai = bool(cfg.get("api_key_encrypted") or cfg.get("api_key"))
            except Exception:
                pass
        ai_ready = (active_gemini > 0 or has_custom_ai) and res_ok

        # MetaApi & MT5 accounts
        meta_token = os.getenv("METAAPI_TOKEN", "").strip()
        meta_token_ok = bool(meta_token and meta_token.lower() not in ("mock", "test", "demo", "none"))
        acc_rows = c.execute("SELECT id, mt5_login, deployment_state FROM trading_accounts").fetchall()
        deployed_cnt = sum(1 for a in acc_rows if str(a[2] or "").upper() == "DEPLOYED")
        pending_cnt = sum(1 for a in acc_rows if str(a[2] or "").upper() in ("DEPLOY_PENDING", "FAILED"))

        # SePay config & underpaid/pending orders
        sepay_secret_ok = bool(os.getenv("SEPAY_WEBHOOK_SECRET", "").strip())
        sepay_bank = getkv(c, "sepay_bank_account") or getkv(c, "sepay_account_number")
        sepay_ready = sepay_secret_ok or bool(sepay_bank)
        underpaid_orders = c.execute(
            "SELECT id, amount_vnd, paid_amount_vnd, status, created_at FROM orders WHERE status IN ('UNDERPAID', 'FAILED') ORDER BY created_at DESC LIMIT 5"
        ).fetchall()

        # Recent AI Signal Audits -> Natural-language timeline
        sig_logs = c.execute(
            "SELECT * FROM signal_audit_logs ORDER BY created_at DESC LIMIT 12"
        ).fetchall()
        for sl_row in sig_logs:
            sl = dict(sl_row)
            ts_val = float(sl.get("created_at") or now_ts)
            sym = sl.get("symbol") or "XAUUSD"
            side = sl.get("side") or "BUY"
            st = str(sl.get("status") or "").upper()
            src_name = sl.get("source_name") or "AI"
            reason_txt = sl.get("reason") or sl.get("rejection_reason") or st
            if st == "APPROVED":
                msg = f"Nhận tín hiệu {side} {sym} ({src_name}) -> Đã qua 4 lớp an toàn -> Phân phối tới {deployed_cnt} tài khoản."
                kind = "success"
            else:
                msg = f"Tín hiệu {side} {sym} ({src_name}) bị Lá chắn từ chối: {reason_txt}."
                kind = "warning"
            timeline.append({"ts": ts_val, "text": msg, "kind": kind})

        # Latest AI Stand-Aside decision
        last_dec_str = getkv(c, "strategy_last_decision")
        if last_dec_str:
            try:
                dec = json.loads(last_dec_str)
                timeline.append({
                    "ts": float(dec.get("ts") or now_ts),
                    "text": f"AI quét nến M15 XAUUSD: {dec.get('reason', 'Không có điểm vào đẹp -> Đứng ngoài bảo toàn vốn')}.",
                    "kind": "info",
                })
            except Exception:
                pass

        # Recent Audit Events
        aud_rows = c.execute("SELECT ts, event, detail FROM audit ORDER BY ts DESC LIMIT 10").fetchall()
        for ar in aud_rows:
            timeline.append({
                "ts": float(ar[0] or now_ts),
                "text": _humanize_audit_event(ar[1], ar[2]),
                "kind": "info",
            })

        timeline.sort(key=lambda x: x["ts"], reverse=True)
        timeline = timeline[:20]

        # Build Error & Alert Center
        if not meta_token_ok:
            alerts.append({
                "id": "missing_metaapi_token",
                "severity": "error",
                "title": "Chưa cấu hình METAAPI_TOKEN thật trên máy chủ",
                "detail": "Hệ thống chưa thể kết nối sàn MT5 thật cho khách hàng. Cần điền METAAPI_TOKEN vào file .env trên VPS.",
                "action_label": "Kiểm tra Khách hàng & MT5",
                "action_tab": "business",
            })
        if active_gemini == 0 and not has_custom_ai:
            alerts.append({
                "id": "no_active_ai_key",
                "severity": "error",
                "title": "Bộ não AI chưa có API Key hoạt động",
                "detail": f"Hiện có {active_gemini} Gemini Key đang sống ({rate_limited_gemini} key hết hạn mức). Hãy nạp thêm key mới để AI Swarm hoạt động.",
                "action_label": "Nạp API Key AI",
                "action_tab": "ai",
            })
        elif rate_limited_gemini > 0:
            alerts.append({
                "id": "gemini_rate_limited",
                "severity": "warning",
                "title": f"Có {rate_limited_gemini} Gemini API Key bị chạm hạn mức",
                "detail": f"Còn {active_gemini} key đang hoạt động dự phòng. Nên bổ sung thêm key để tránh gián đoạn.",
                "action_label": "Quản lý Gemini Pool",
                "action_tab": "ai",
            })
        if pending_cnt > 0:
            alerts.append({
                "id": "pending_mt5_deploy",
                "severity": "warning",
                "title": f"{pending_cnt} tài khoản MT5 đang chờ triển khai Cloud (DEPLOY_PENDING)",
                "detail": "MetaApi gặp lỗi tạm thời khi mở kết nối. Bạn có thể bấm thử lại ngay hoặc chờ chu kỳ tự động.",
                "action_label": "Thử lại Deploy ngay",
                "action_type": "retry_deploy",
            })
        for uo in underpaid_orders:
            alerts.append({
                "id": f"order_{uo[0]}",
                "severity": "warning",
                "title": f"Đơn hàng {uo[0]} bị {uo[3]}",
                "detail": f"Khách đã chuyển {int(uo[2] or 0):,} / {int(uo[1] or 0):,} VND. Cần kiểm tra đối soát hoặc duyệt bù.",
                "action_label": "Xử lý đơn hàng",
                "action_tab": "business",
            })
        if not exec_ok:
            alerts.append({
                "id": "exec_worker_slow",
                "severity": "error",
                "title": "Tiến trình thực thi (Execution Worker) bị chậm nhịp",
                "detail": "Không nhận được nhịp tim trong 60 giây qua. Kiểm tra container zupirus-prod-execution-1.",
                "action_label": "Làm mới",
                "action_type": "refresh",
            })
        if not sepay_secret_ok:
            alerts.append({
                "id": "sepay_secret_missing",
                "severity": "warning",
                "title": "Chưa cấu hình SEPAY_WEBHOOK_SECRET",
                "detail": "Webhook thanh toán SePay chưa có khóa bảo mật Production trong .env.",
                "action_label": "Cài đặt SePay",
                "action_tab": "business",
            })

    health_cards = [
        {
            "key": "market_data",
            "title": "Dữ liệu thị trường XAU/USD",
            "ok": bool(quote.get("live")),
            "status_text": f"Đang cập nhật ({quote.get('mid', 0)})" if quote.get("live") else "Mất kết nối / Dữ liệu cũ",
        },
        {
            "key": "ai_swarm",
            "title": "Bộ não AI Swarm",
            "ok": ai_ready,
            "status_text": f"Đang hoạt động ({active_gemini} Key)" if ai_ready else "Lỗi API Key / Worker",
        },
        {
            "key": "metaapi",
            "title": "Kết nối sàn MT5 (MetaApi)",
            "ok": meta_token_ok,
            "status_text": f"Sẵn sàng ({deployed_cnt} trạm)" if meta_token_ok else "Chưa cấu hình Token",
        },
        {
            "key": "sepay",
            "title": "Cổng thanh toán SePay",
            "ok": sepay_ready,
            "status_text": "Hoạt động tự động" if sepay_ready else "Chưa cấu hình",
        },
    ]

    return {
        "halted": is_halted,
        "health_cards": health_cards,
        "timeline": timeline,
        "alerts": alerts,
        "server_time": now_ts,
    }


@router.post("/admin-radar/retry-pending")
async def retry_pending_cloud_deploys(_admin=Depends(get_current_admin)):
    """Trigger immediate retry for any DEPLOY_PENDING MT5 accounts."""
    from app.services.subscription_lifecycle import run_subscription_lifecycle_cycle
    res = await run_subscription_lifecycle_cycle()
    return {"ok": True, "redeployed": res.get("pending_redeployed", 0), "message": f"Đã thử lại kích hoạt {res.get('pending_redeployed', 0)} tài khoản MT5."}


