import os
import time
import json
import logging
from typing import Any, Dict, List
from fastapi import APIRouter, Depends

from app.db import tx, getkv
from app.routers.deps import get_current_admin
from app.routers.telemetry import get_live_xauusd_quote

logger = logging.getLogger("zupirus.telemetry")
router = APIRouter(prefix="/api/v1/telemetry", tags=["telemetry"])

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
            g_rows = c.execute("SELECT status FROM gemini_keys WHERE is_active = 1").fetchall()
            for gr in g_rows:
                st = str(gr[0] or "").lower()
                if st == "active":
                    active_gemini += 1
                elif "limit" in st or "exhaust" in st:
                    rate_limited_gemini += 1
        except Exception:
            pass
        ai_cfg_row = c.execute("SELECT value FROM kv WHERE key='ai:settings'").fetchone()
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
        billing_cfg_row = getkv(c, "billing:settings")
        billing_cfg = {}
        if billing_cfg_row:
            try:
                billing_cfg = json.loads(billing_cfg_row)
            except Exception:
                billing_cfg = {}
        sepay_secret_ok = bool(os.getenv("SEPAY_WEBHOOK_SECRET", "").strip() or billing_cfg.get("sepay_webhook_secret_encrypted") or billing_cfg.get("sepay_webhook_secret"))
        sepay_bank = billing_cfg.get("account_number") or getkv(c, "sepay_bank_account") or getkv(c, "sepay_account_number")
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
            reason_txt = sl.get("reject_reason") or sl.get("reason") or sl.get("rejection_reason") or st
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


@router.post("/admin-radar/dry-run")
def run_system_dry_run_test(_admin=Depends(get_current_admin)):
    """Run an end-to-end Dry-Run Test (Data -> AI Swarm -> 4-Layer Shield -> MetaApi Readiness)
    without placing any real money order."""
    now_ts = time.time()
    steps = []

    # 1. Market Data check
    quote = get_live_xauusd_quote()
    mid = float(quote.get("mid") or 2950.0)
    steps.append({
        "step": "1. Dữ liệu thị trường XAU/USD",
        "ok": bool(quote.get("live")),
        "detail": f"Giá live {mid} (spread {quote.get('spread_pips', 0)} pips, nguồn {quote.get('source')})"
        if quote.get("live")
        else f"Chưa có tick live mới nhất (tạm dùng tham chiếu {mid}).",
    })

    # 2. AI Swarm check
    swarm_ok = False
    swarm_detail = ""
    try:
        from app.swarm import trigger_swarm_cycle
        sw = trigger_swarm_cycle()
        swarm_ok = bool(sw)
        blackout = sw.get("sentinel", {}).get("blackout")
        swarm_detail = f"Sentinel blackout={blackout} | Cycle hoàn tất an toàn."
    except Exception as e:
        swarm_detail = f"Lỗi AI Swarm: {e}"
    steps.append({"step": "2. Bộ não AI Swarm", "ok": swarm_ok, "detail": swarm_detail})

    # 3. 4-Layer Safety Sanitizer Dry-Run
    shield_ok = False
    shield_detail = ""
    try:
        from app.schemas.signals import NormalizedSignalSchema
        from app.services.signal_ingestion.sanitizer import sanitize_and_audit_signal
        test_sig = NormalizedSignalSchema(
            id=f"dryrun_{int(now_ts)}",
            source="src_dryrun_test",
            strategy_tier="ALPHA",
            symbol="XAUUSD",
            action="BUY",
            entry_price=mid,
            stop_loss=round(mid - 5.0, 2),
            take_profit=round(mid + 10.0, 2),
            raw_payload={"dry_run": True},
            created_at=now_ts,
        )
        ok_s, reason_s, _ = sanitize_and_audit_signal(test_sig, live_price=mid, current_time=now_ts)
        # Clean up synthetic dry-run records so they never pollute production learning metrics or Hindsight lessons
        try:
            with tx() as c:
                c.execute("DELETE FROM signal_audit_logs WHERE signal_id = ? OR source_name = 'src_dryrun_test'", (test_sig.id,))
                c.execute("DELETE FROM hindsight_memories WHERE content LIKE ?", (f"%{test_sig.id}%",))
        except Exception:
            pass
        shield_ok = True  # Sanitizer executed properly regardless of whether news/spread blocked
        shield_detail = "4 lớp màng lọc hoạt động chuẩn (Cho phép qua)." if ok_s else f"4 lớp màng lọc hoạt động chuẩn (Đã chặn an toàn: {reason_s})."
    except Exception as e:
        shield_detail = f"Lỗi 4 lớp màng lọc: {e}"
    steps.append({"step": "3. Kiểm tra 4 lớp màng lọc an toàn", "ok": shield_ok, "detail": shield_detail})

    # 4. MetaApi Cloud Readiness (no real trade placed)
    meta_token = os.getenv("METAAPI_TOKEN", "").strip()
    meta_ok = bool(meta_token and meta_token.lower() not in ("mock", "test", "demo", "none"))
    with tx() as c:
        dep_cnt = c.execute("SELECT COUNT(*) FROM trading_accounts WHERE deployment_state = 'DEPLOYED'").fetchone()[0]
    steps.append({
        "step": "4. Kết nối sàn MetaApi (Dry-Run)",
        "ok": meta_ok,
        "detail": f"Token sẵn sàng • {dep_cnt} tài khoản MT5 đang kết nối (Không vào tiền thật)."
        if meta_ok
        else f"Chưa điền METAAPI_TOKEN thật trong .env ({dep_cnt} tài khoản trong DB).",
    })

    return {"ok": all(s["ok"] for s in steps[:3]), "steps": steps, "timestamp": now_ts}


@router.get("/ai-evolution")
def get_ai_evolution_monitor(_admin=Depends(get_current_admin)):
    """Read-only visual telemetry for Tab 2: 3-Stage Evolution, Shadow M1 Learning,
    Hindsight Lessons, Walk-Forward Results, and Built-in vs Self-Learned Skills."""
    with tx() as c:
        mode_row = c.execute("SELECT value FROM kv WHERE key = 'signal_mode'").fetchone()
        active_mode = str(mode_row[0]).upper() if mode_row and mode_row[0] else "EXTERNAL_FEED"
        auto_row = c.execute("SELECT value FROM kv WHERE key = 'AUTO_PROMOTE_QUALIFIED_STRATEGIES'").fetchone()
        auto_promote = bool(auto_row and str(auto_row[0]).strip().lower() in ("1", "true", "yes"))

        try:
            shadow_eval_cnt = c.execute(
                "SELECT COUNT(*) FROM shadow_signals WHERE eval_status IN ('WIN_TP', 'LOSS_SL', 'EXPIRED')"
            ).fetchone()[0]
            shadow_open_cnt = c.execute(
                "SELECT COUNT(*) FROM shadow_signals WHERE eval_status = 'OPEN'"
            ).fetchone()[0]
            shadow_wins = c.execute(
                "SELECT COUNT(*) FROM shadow_signals WHERE eval_status IN ('WIN_TP', 'LOSS_SL', 'EXPIRED') AND (eval_status = 'WIN_TP' OR pnl_pips > 0)"
            ).fetchone()[0]
            per_src_rows = c.execute(
                """
                SELECT
                    source_id,
                    SUM(CASE WHEN eval_status IN ('WIN_TP', 'LOSS_SL', 'EXPIRED') THEN 1 ELSE 0 END) AS eval_cnt,
                    SUM(CASE WHEN eval_status = 'OPEN' THEN 1 ELSE 0 END) AS open_cnt,
                    SUM(CASE WHEN eval_status IN ('WIN_TP', 'LOSS_SL', 'EXPIRED') AND (eval_status = 'WIN_TP' OR pnl_pips > 0) THEN 1 ELSE 0 END) AS win_cnt
                FROM shadow_signals
                GROUP BY source_id
                """
            ).fetchall()
            per_src_stats = {
                str(r[0]): (int(r[1] or 0), int(r[2] or 0), int(r[3] or 0))
                for r in per_src_rows
            }
        except Exception:
            shadow_eval_cnt, shadow_open_cnt, shadow_wins = 0, 0, 0
            per_src_stats = {}

        try:
            audit_cnt = c.execute(
                "SELECT COUNT(*) FROM signal_audit_logs WHERE COALESCE(source_name, '') NOT IN ('src_dryrun_test', 'ADMIN_BENCH') AND pnl IS NOT NULL"
            ).fetchone()[0]
        except Exception:
            audit_cnt = 0

        samples_learned = int(shadow_eval_cnt) + int(audit_cnt)
        overall_wr = round((shadow_wins / shadow_eval_cnt) * 100.0, 1) if shadow_eval_cnt > 0 else 0.0

        sources = []
        try:
            s_rows = c.execute(
                "SELECT id, name, source_type, status, trust_score, win_rate, profit_factor, evaluated_signals FROM signal_sources"
            ).fetchall()
            for sr in s_rows:
                sid = str(sr[0])
                real_eval, real_open, real_wins = per_src_stats.get(sid, (0, 0, 0))
                real_wr = round((real_wins / real_eval) * 100.0, 1) if real_eval > 0 else 0.0
                sources.append({
                    "id": sid,
                    "name": sr[1],
                    "source_type": sr[2],
                    "status": sr[3],
                    "trust_score": round(float(sr[4] or 0.0), 1) if real_eval > 0 else 0.0,
                    "win_rate_pct": real_wr,
                    "profit_factor": round(float(sr[6] or 0.0), 2) if real_eval > 0 else 0.0,
                    "evaluated_signals": real_eval,
                    "open_signals": real_open,
                })
            sources.sort(key=lambda x: (x["evaluated_signals"], x["open_signals"], x["trust_score"]), reverse=True)
        except Exception:
            pass

        hindsight_lessons = []
        try:
            h_rows = c.execute(
                """
                SELECT id, category, content, relevance_score, created
                FROM hindsight_memories
                WHERE COALESCE(content, '') NOT LIKE '%src_dryrun_test%'
                  AND COALESCE(content, '') NOT LIKE '%ADMIN_BENCH%'
                  AND COALESCE(content, '') NOT LIKE 'User chat:%'
                ORDER BY created DESC LIMIT 10
                """
            ).fetchall()
            for hr in h_rows:
                raw_content = str(hr[2] or "")
                clean_content = raw_content.split(" | meta:")[0].strip()
                hindsight_lessons.append({
                    "id": hr[0],
                    "category": hr[1],
                    "content": clean_content,
                    "confidence": round(float(hr[3] or 0.0), 2),
                    "created_at": hr[4],
                })
        except Exception:
            pass

        wfo_candidates = []
        try:
            w_rows = c.execute(
                "SELECT id, name, status, win_rate, profit_factor, sharpe_ratio, max_drawdown_pct, sample_size, updated_at FROM strategy_candidates ORDER BY updated_at DESC LIMIT 8"
            ).fetchall()
            for wr_row in w_rows:
                w_rate = float(wr_row[3] or 0.0)
                wfo_candidates.append({
                    "id": wr_row[0],
                    "name": wr_row[1],
                    "status": wr_row[2],
                    "win_rate_pct": round(w_rate * 100.0 if w_rate <= 1.0 else w_rate, 1),
                    "profit_factor": round(float(wr_row[4] or 0.0), 2),
                    "sharpe_ratio": round(float(wr_row[5] or 0.0), 2),
                    "max_drawdown_pct": round(float(wr_row[6] or 0.0), 2),
                    "sample_size": int(wr_row[7] or 0),
                })
        except Exception:
            pass

        skills_builtin = []
        skills_learned = []
        try:
            sk_rows = c.execute(
                "SELECT skill_id, name, description, trigger_condition, is_builtin, enabled, usage_count, created_at FROM agent_skills ORDER BY is_builtin DESC, usage_count DESC"
            ).fetchall()
            for sk in sk_rows:
                item = {
                    "skill_id": sk[0],
                    "name": sk[1],
                    "description": sk[2],
                    "trigger_condition": sk[3] or "Tự động kích hoạt theo bối cảnh thị trường",
                    "is_builtin": bool(sk[4]),
                    "enabled": bool(sk[5]),
                    "usage_count": int(sk[6] or 0),
                }
                if item["is_builtin"]:
                    skills_builtin.append(item)
                else:
                    skills_learned.append(item)
        except Exception:
            pass

    return {
        "stage": {
            "active_mode": active_mode,
            "auto_promote": auto_promote,
            "samples_learned": samples_learned,
            "target_samples": 500,
            "readiness_pct": round(min(100.0, (samples_learned / 500.0) * 100.0), 1),
        },
        "shadow_summary": {
            "total_evaluated": int(shadow_eval_cnt),
            "total_open": int(shadow_open_cnt),
            "overall_win_rate_pct": overall_wr,
            "sources": sources,
        },
        "hindsight_lessons": hindsight_lessons,
        "wfo_candidates": wfo_candidates,
        "skills_builtin": skills_builtin,
        "skills_learned": skills_learned,
    }


@router.get("/code-map")
def get_admin_code_map(_admin=Depends(get_current_admin)):
    """Return Understand-Anything Codebase Knowledge Graph (Scan -> Map -> Teach)."""
    from app.services.code_map import get_code_knowledge_graph
    return get_code_knowledge_graph(force_rescan=False)


@router.post("/code-map/rescan")
def rescan_admin_code_map(_admin=Depends(get_current_admin)):
    """Re-scan the live repository AST/imports and refresh the knowledge graph."""
    from app.services.code_map import get_code_knowledge_graph
    return get_code_knowledge_graph(force_rescan=True)



