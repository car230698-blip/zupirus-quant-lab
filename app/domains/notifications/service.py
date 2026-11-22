"""In-App and Multi-Channel Notification Service.
Publishes notifications to in-app database table, SSE stream channel, and Resend email (with cooldown).
"""
import time
import json
import uuid
import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger("zupirus.domains.notifications")


def emit_notification(
    c,
    user_id: Optional[str] = None,
    role: str = "user",
    severity: str = "INFO",
    title: str = "",
    body: str = "",
    meta: Optional[Dict[str, Any]] = None,
    send_email: bool = False,
    cooldown_key: Optional[str] = None,
    cooldown_sec: int = 1800,
) -> str:
    """Emits an in-app and multi-channel notification.
    - Persists record into `notifications` table.
    - Dispatches real-time SSE event via `publish_realtime_event`.
    - If `send_email=True`, enforces cooldown window and sends email via Resend mailer.
    """
    now = time.time()
    notif_id = f"notif_{uuid.uuid4().hex[:12]}"
    meta_json = json.dumps(meta or {}, ensure_ascii=False)

    # 1. Persist notification in DB
    try:
        c.execute(
            """
            INSERT INTO notifications (id, user_id, role, severity, title, body, meta_json, read_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
            """,
            (notif_id, user_id, role, severity, title, body, meta_json, now),
        )
    except Exception as e:
        logger.warning(f"Failed to persist notification {notif_id}: {e}")

    # 2. Dispatch real-time SSE event
    try:
        from app.core.redis_client import publish_realtime_event
        event_payload = {
            "id": notif_id,
            "user_id": user_id,
            "role": role,
            "severity": severity,
            "title": title,
            "body": body,
            "meta": meta or {},
            "created_at": now,
        }
        if role == "admin":
            publish_realtime_event("admin", "notification", event_payload)
        if user_id:
            publish_realtime_event(f"user:{user_id}", "notification", event_payload)
        publish_realtime_event("user", "notification", event_payload)
    except Exception as e:
        logger.debug(f"Failed to publish notification SSE: {e}")

    # 3. Optional Email Alert with cooldown check
    if send_email:
        should_send = True
        if cooldown_key:
            try:
                row = c.execute("SELECT value FROM kv WHERE key = ?", (f"cd_{cooldown_key}",)).fetchone()
                if row:
                    last_sent = float(row["value"] if hasattr(row, "keys") else row[0])
                    if (now - last_sent) < cooldown_sec:
                        should_send = False
                if should_send:
                    c.execute(
                        "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        (f"cd_{cooldown_key}", str(now)),
                    )
            except Exception as e:
                logger.debug(f"Cooldown check error: {e}")

        if should_send:
            try:
                if role == "admin":
                    from app.core.mailer import send_admin_alert_email
                    send_admin_alert_email(title, body)
                elif user_id:
                    row = c.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
                    if row:
                        u_email = (row["email"] if hasattr(row, "keys") else row[0]) or ""
                        if "@" in u_email and not u_email.endswith(("@example.com", "@zupirus.local")):
                            from app.core.mailer import send_resend_email
                            html = f"""
                            <div style="background:#050811;color:#f8fafc;padding:24px;font-family:Arial,sans-serif;">
                              <div style="max-width:540px;margin:0 auto;background:#0d1527;border:1px solid #f59e0b;border-radius:12px;padding:24px;">
                                <h2 style="color:#f59e0b;margin:0 0 12px;">[{severity}] {title}</h2>
                                <p style="color:#cbd5e1;font-size:13px;line-height:1.6;">{body}</p>
                              </div>
                            </div>
                            """
                            send_resend_email(to=u_email, subject=f"[ZUPIRUS CẢNH BÁO] {title}", html=html)
            except Exception as e:
                logger.debug(f"Notification email dispatch error: {e}")

    return notif_id


def run_daily_executive_digest(c=None, force: bool = False) -> Dict[str, Any]:
    """Runs the Daily Executive Digest at 22:00 GMT+7 (15:00 UTC) every day.
    Guarded by idempotency key daily_digest_last_date in kv table.
    Dispatches a 5-bullet summary email to all real Admin users via Resend.
    """
    from datetime import datetime, timezone
    now_ts = time.time()
    now_utc = datetime.fromtimestamp(now_ts, tz=timezone.utc)
    today_str = now_utc.strftime("%Y-%m-%d")

    def _execute(cursor):
        # 1. Idempotency Check: if already sent today, skip safely
        row = cursor.execute("SELECT value FROM kv WHERE key = 'daily_digest_last_date'").fetchone()
        last_date = str(row[0]) if row and row[0] else ""
        if last_date == today_str and not force:
            return {"ok": True, "skipped": True, "status": "already_sent", "reason": "ALREADY_SENT_TODAY", "date": today_str}

        # 2. Only run at or after 15:00 UTC (22:00 GMT+7) unless forced
        if not force and now_utc.hour < 15:
            return {"ok": False, "reason": "BEFORE_SCHEDULED_HOUR_15_UTC", "current_utc_hour": now_utc.hour}

        # 3. Metric 1: System Status & Active Strategies
        from app.domains.signals.sources.curator import get_active_signal_mode
        sig_mode = get_active_signal_mode(cursor)
        err_row = cursor.execute(
            "SELECT count(*) FROM audit WHERE ts >= ? AND (event LIKE '%error%' OR event LIKE '%fail%' OR event LIKE '%halt%')",
            (now_ts - 7200,),
        ).fetchone()
        recent_errs = int(err_row[0] or 0)
        sys_status = "OK" if recent_errs == 0 else "WARN"

        live_strat_row = cursor.execute(
            "SELECT name FROM strategy_candidates WHERE status = 'APPROVED_FOR_PROD' ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
        live_strat = live_strat_row[0] if live_strat_row and live_strat_row[0] else "Alpha Quant XAU M15 (Core Heuristic)"

        canary_strat_row = cursor.execute(
            "SELECT name FROM strategy_candidates WHERE status = 'CANARY_DEMO' ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
        canary_strat = canary_strat_row[0] if canary_strat_row and canary_strat_row[0] else "0 chiến lược (Không có)"

        # 3. Metric 2: 24h Orders & PnL
        ord_row = cursor.execute(
            "SELECT count(*), coalesce(sum(pnl), 0.0) FROM signal_audit_logs WHERE created_at >= ? AND status = 'APPROVED'",
            (now_ts - 86400,),
        ).fetchone()
        orders_24h = int(ord_row[0] or 0)
        pnl_24h = round(float(ord_row[1] or 0.0), 2)

        # 4. Metric 3: SePay 24h Revenue & Orders
        sepay_paid_row = cursor.execute(
            "SELECT count(*), coalesce(sum(amount_vnd), 0) FROM orders WHERE created_at >= ? AND status = 'PAID'",
            (now_ts - 86400,),
        ).fetchone()
        sepay_paid_cnt = int(sepay_paid_row[0] or 0)
        sepay_rev_vnd = int(sepay_paid_row[1] or 0)

        sepay_err_row = cursor.execute(
            "SELECT count(*) FROM orders WHERE created_at >= ? AND status IN ('PENDING', 'EXPIRED', 'FAILED')",
            (now_ts - 86400,),
        ).fetchone()
        sepay_err_cnt = int(sepay_err_row[0] or 0)

        # 5. Metric 4: Gemini Quota
        from app.domains.ai.gemini_client import get_daily_quota_stats
        q_stats = get_daily_quota_stats(c=cursor)
        quota_str = f"{q_stats.get('calls_today', 0)} / {q_stats.get('daily_cap', 90)} ({q_stats.get('usage_pct', 0.0)}%)"

        # 6. Metric 5: Anomalies / Alerts
        warn_rows = cursor.execute(
            "SELECT event FROM audit WHERE ts >= ? AND (event LIKE '%warn%' OR event LIKE '%error%' OR event LIKE '%halt%') ORDER BY ts DESC LIMIT 3",
            (now_ts - 86400,),
        ).fetchall()
        if not warn_rows:
            anomalies_text = "Hệ thống tự vận hành ổn định — không cần thao tác."
        else:
            anomalies_text = f"Ghi nhận {len(warn_rows)} cảnh báo: " + ", ".join(r[0] for r in warn_rows)

        # Format HTML Email
        status_color = "#10b981" if sys_status == "OK" else "#f59e0b"
        pnl_color = "#10b981" if pnl_24h >= 0 else "#ef4444"
        html_content = f"""
        <!DOCTYPE html>
        <html><body style="margin:0;padding:24px;background:#050811;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#f8fafc;">
          <div style="max-width:580px;margin:0 auto;background:#0d1527;border:1px solid #1e293b;border-radius:16px;padding:28px;box-shadow:0 20px 40px rgba(0,0,0,0.5);">
            <div style="border-bottom:1px solid #1e293b;padding-bottom:16px;margin-bottom:20px;">
              <span style="font-size:10px;font-family:monospace;letter-spacing:2px;text-transform:uppercase;color:#38bdf8;">AUTOPILOT EXECUTIVE DIGEST</span>
              <h2 style="margin:6px 0 0;font-size:20px;color:#f8fafc;">Báo Cáo Điều Hành Cuối Ngày — {today_str}</h2>
            </div>
            
            <div style="font-size:13px;line-height:1.8;color:#cbd5e1;">
              <div style="margin-bottom:12px;padding:10px 14px;background:#060b17;border-radius:10px;border-left:4px solid {status_color};">
                <strong>1. Trạng Thái &amp; Chiến Lược:</strong> Trạng thái <span style="color:{status_color};font-weight:700;">{sys_status}</span> | Chế độ: <code style="color:#38bdf8;">{sig_mode}</code><br/>
                &bull; LIVE: <strong style="color:#f8fafc;">{live_strat}</strong><br/>
                &bull; Canary (Thử việc): <strong style="color:#f59e0b;">{canary_strat}</strong>
              </div>
              
              <div style="margin-bottom:12px;padding:10px 14px;background:#060b17;border-radius:10px;">
                <strong>2. Giao Dịch 24h:</strong> <span style="font-family:monospace;color:#f8fafc;">{orders_24h}</span> lệnh khớp &bull; PnL ròng: <strong style="color:{pnl_color};font-family:monospace;">{pnl_24h:+.2f} USD</strong>
              </div>
              
              <div style="margin-bottom:12px;padding:10px 14px;background:#060b17;border-radius:10px;">
                <strong>3. Cổng Thanh Toán SePay:</strong> <strong style="color:#10b981;font-family:monospace;">{sepay_rev_vnd:,} VND</strong> ({sepay_paid_cnt} đơn thành công)<br/>
                &bull; Đơn chờ / lỗi: <span style="color:{'#10b981' if sepay_err_cnt == 0 else '#f59e0b'};font-family:monospace;">{sepay_err_cnt} đơn</span>
              </div>
              
              <div style="margin-bottom:12px;padding:10px 14px;background:#060b17;border-radius:10px;">
                <strong>4. Quota AI Gemini Hôm Nay:</strong> <span style="font-family:monospace;color:#38bdf8;">{quota_str}</span>
              </div>
              
              <div style="margin-bottom:6px;padding:10px 14px;background:#060b17;border-radius:10px;">
                <strong>5. Cảnh Báo Bất Thường:</strong> <span style="color:{status_color};">{anomalies_text}</span>
              </div>
            </div>
            
            <div style="margin-top:24px;border-top:1px solid #1e293b;padding-top:14px;text-align:center;font-size:11px;color:#64748b;">
              ZUPIRUS Quant Lab &bull; Autopilot Control Plane v1.3 &bull; London G2 Region
            </div>
          </div>
        </body></html>
        """

        # Dispatch Email
        from app.core.mailer import send_admin_alert_email
        send_admin_alert_email(f"[ZUPIRUS] Báo Cáo Điều Hành Cuối Ngày - {today_str}", html_content)

        # Mark sent in kv
        cursor.execute(
            "INSERT INTO kv (key, value) VALUES ('daily_digest_last_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (today_str,),
        )
        return {
            "ok": True,
            "status": "sent",
            "date": today_str,
            "sys_status": sys_status,
            "orders_24h": orders_24h,
            "pnl_24h": pnl_24h,
            "sepay_rev_vnd": sepay_rev_vnd,
            "quota": quota_str,
        }

    if c:
        return _execute(c)
    else:
        from app.db import tx
        with tx() as conn:
            return _execute(conn)

