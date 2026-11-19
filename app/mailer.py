"""
ZUPIRUS Quant Lab - Resend Email Integration Engine
Dispatches transaction OTPs, Sentinel macro blackout alerts, Risk Guardian margin calls,
and daily quant performance digests via Resend REST API (https://api.resend.com).
"""
import os
import html as html_mod
import json
import logging
import urllib.request
import urllib.error
from typing import Dict, Any, List, Union

logger = logging.getLogger("zupirus.mailer")

RESEND_API_URL = "https://api.resend.com/emails"


def get_resend_api_key() -> str:
    """Load Resend API Key strictly from environment."""
    return os.getenv("RESEND_API_KEY", "").strip()

def get_email_from() -> str:
    """Sender identity with verified domain zupirus.com."""
    return os.getenv("EMAIL_FROM", "ZUPIRUS Quant Lab <system@zupirus.com>").strip()

def send_resend_email(
    to: Union[str, List[str]],
    subject: str,
    html: str,
    sender: str = None
) -> Dict[str, Any]:
    """
    Send an email via Resend REST API.
    Does not require external dependencies beyond Python standard library.
    """
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("MOCK_MAILER") == "1":
        logger.info(f"Mock email suppressed for testing: To={to}, Subject='{subject}'")
        return {"ok": True, "id": "mock_email_test_id", "mocked": True}

    api_key = get_resend_api_key()
    if not api_key:
        logger.warning("Resend API key not configured. Email suppressed.")
        return {"ok": False, "error": "RESEND_API_KEY_MISSING"}

    recipients = [to] if isinstance(to, str) else list(to)
    payload = {
        "from": sender or get_email_from(),
        "to": recipients,
        "subject": subject,
        "html": html,
    }

    req = urllib.request.Request(
        RESEND_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "ZupirusQuantLab/0.2.0 (ResendEngine)",
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            email_id = data.get("id")
            logger.info("Successfully dispatched email to %s (id: %s)", recipients, email_id)
            return {"ok": True, "id": email_id, "recipients": recipients}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        logger.error("Resend API HTTP error %d: %s", e.code, err_body)
        return {"ok": False, "status_code": e.code, "error": err_body}
    except Exception as e:
        logger.error("Failed to dispatch Resend email: %s", e)
        return {"ok": False, "error": str(e)}

def send_otp_code(email: str, code: str, purpose: str = "Đăng Ký & Xác Thực") -> Dict[str, Any]:
    """Send a cybernetic OTP verification email."""
    subject = f"[{code}] Mã xác thực tài khoản - ZUPIRUS Quant Lab"
    html = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background-color:#050811;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
        <tr>
          <td align="center">
            <table width="100%" style="max-width:540px;background:#0d1527;border:1px solid #1e293b;border-radius:16px;overflow:hidden;box-shadow:0 20px 40px rgba(0,0,0,0.5);">
              <tr>
                <td style="padding:32px 32px 20px;text-align:center;border-bottom:1px solid #1e293b;">
                  <div style="display:inline-block;padding:8px 16px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.3);border-radius:9999px;color:#38bdf8;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
                    CYBERNETIC QUANT TERMINAL
                  </div>
                  <h1 style="color:#f8fafc;font-size:24px;font-weight:800;letter-spacing:1px;margin:16px 0 4px;">ZUPIRUS QUANT LAB</h1>
                  <p style="color:#94a3b8;font-size:13px;margin:0;">Xác Thực Bảo Mật & Danh Tính Giao Dịch</p>
                </td>
              </tr>
              <tr>
                <td style="padding:32px;">
                  <p style="color:#cbd5e1;font-size:14px;margin:0 0 16px;">Xin chào nhà giao dịch,</p>
                  <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0 0 24px;">
                    Bạn đang thực hiện thao tác <strong style="color:#38bdf8;">{__import__('html').escape(str(purpose))}</strong> trên hệ thống ZUPIRUS Quant Lab. Vui lòng nhập mã OTP bên dưới để hoàn tất:
                  </p>
                  <div style="background:#090d1a;border:1px solid #334155;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
                    <div style="font-size:38px;font-weight:900;letter-spacing:10px;color:#10b981;font-family:monospace;text-shadow:0 0 20px rgba(16,185,129,0.4);">
                      {__import__('html').escape(str(code))}
                    </div>
                    <p style="color:#64748b;font-size:11px;margin:12px 0 0;text-transform:uppercase;letter-spacing:1px;">Hiệu lực trong vòng 10 phút</p>
                  </div>
                  <p style="color:#64748b;font-size:12px;line-height:1.5;margin:0;">
                    ⚠️ Tuyệt đối không chia sẻ mã này với bất kỳ ai, bao gồm cả hỗ trợ viên Zupirus. Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 32px;background:#090d1a;border-top:1px solid #1e293b;text-align:center;">
                  <p style="color:#475569;font-size:11px;margin:0;">
                    © 2026 ZUPIRUS Quant Lab • London G2 Server Region • Autonomous Multi-Agent Swarm
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    """
    return send_resend_email(to=email, subject=subject, html=html)

def send_payment_receipt_email(
    email: str,
    order_id: str,
    plan_tier: str,
    amount_vnd: int,
    cloud_slots: int,
    expires_at: float,
) -> Dict[str, Any]:
    """Send automated SePay payment confirmation receipt & Cloud activation notice."""
    from datetime import datetime, timezone
    exp_str = datetime.fromtimestamp(float(expires_at), tz=timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    subject = f"[ZUPIRUS] Xác nhận thanh toán đơn {order_id} - Kích hoạt gói {plan_tier.upper()}"
    html = f"""
    <!DOCTYPE html>
    <html><body style="background:#050811;color:#f8fafc;font-family:Arial,sans-serif;padding:32px;">
      <div style="max-width:560px;margin:0 auto;background:#0d1527;border:1px solid #1e293b;border-radius:14px;padding:28px;">
        <h2 style="color:#10b981;margin:0 0 12px;">Thanh Toán Thành Công &amp; Đã Kích Hoạt Cloud MT5</h2>
        <p style="color:#cbd5e1;font-size:14px;">Hệ thống ZUPIRUS Quant Lab đã đối soát giao dịch VietQR tự động và mở khóa gói cước của bạn:</p>
        <table width="100%" style="background:#090d1a;border-radius:10px;padding:16px;margin:16px 0;font-size:13px;">
          <tr><td style="color:#94a3b8;padding:6px 0;">Mã đơn hàng:</td><td style="color:#38bdf8;font-weight:700;">{order_id}</td></tr>
          <tr><td style="color:#94a3b8;padding:6px 0;">Gói dịch vụ:</td><td style="color:#f8fafc;font-weight:700;">{plan_tier.upper()} ({cloud_slots} MT5 Slots)</td></tr>
          <tr><td style="color:#94a3b8;padding:6px 0;">Số tiền đã nhận:</td><td style="color:#10b981;font-weight:700;">{int(amount_vnd):,} VND</td></tr>
          <tr><td style="color:#94a3b8;padding:6px 0;">Hiệu lực đến:</td><td style="color:#f8fafc;">{exp_str}</td></tr>
        </table>
        <p style="color:#94a3b8;font-size:12px;">Bạn có thể truy cập <a href="https://app.zupirus.com" style="color:#38bdf8;">app.zupirus.com</a> để kết nối tài khoản MT5 và nhận tín hiệu tự động 24/5.</p>
      </div>
    </body></html>
    """
    return send_resend_email(to=email, subject=subject, html=html)


def send_subscription_expiry_reminder(
    email: str,
    plan_tier: str,
    days_left: int,
    expires_at: float,
) -> Dict[str, Any]:
    """Send automated renewal reminder 3 days or 1 day prior to subscription expiry."""
    from datetime import datetime, timezone
    exp_str = datetime.fromtimestamp(float(expires_at), tz=timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    subject = f"[ZUPIRUS] Gói {plan_tier.upper()} sắp hết hạn trong {days_left} ngày"
    html = f"""
    <!DOCTYPE html>
    <html><body style="background:#050811;color:#f8fafc;font-family:Arial,sans-serif;padding:32px;">
      <div style="max-width:560px;margin:0 auto;background:#0d1527;border:1px solid #f59e0b;border-radius:14px;padding:28px;">
        <h2 style="color:#f59e0b;margin:0 0 12px;">Nhắc Gia Hạn Gói Cloud MT5 ({days_left} ngày còn lại)</h2>
        <p style="color:#cbd5e1;font-size:14px;">Gói <strong>{plan_tier.upper()}</strong> của bạn sẽ hết hạn vào <strong>{exp_str}</strong>.</p>
        <p style="color:#94a3b8;font-size:13px;">Khi hết hạn, hệ thống sẽ tự động tạm ngưng mở lệnh mới và thu hồi kết nối Cloud (PositionWatcher vẫn bảo vệ các lệnh đang mở cho tới khi đóng). Gia hạn ngay tại <a href="https://app.zupirus.com" style="color:#38bdf8;">app.zupirus.com</a> để không gián đoạn giao dịch.</p>
      </div>
    </body></html>
    """
    return send_resend_email(to=email, subject=subject, html=html)


def send_admin_alert_email(title: str, detail: str) -> Dict[str, Any]:
    """Send proactive operational/risk alert email to all real Admin users and mirror to Discord."""
    try:
        from app.services.discord_notifier import notify_discord_alert
        notify_discord_alert(str(title), str(detail))
    except Exception:
        pass
    try:
        from app.db import tx
        with tx() as c:
            rows = c.execute("SELECT email FROM users WHERE role = 'admin'").fetchall()
        admin_emails = [
            r[0] for r in rows
            if r[0] and "@" in str(r[0]) and not str(r[0]).endswith(("@example.com", "@zupirus.local"))
        ]
        if not admin_emails:
            return {"ok": False, "error": "NO_REAL_ADMIN_EMAIL"}
        html = f"""
        <div style="background:#050811;color:#f8fafc;padding:24px;font-family:Arial,sans-serif;">
          <div style="max-width:540px;margin:0 auto;background:#0d1527;border:1px solid #ef4444;border-radius:12px;padding:24px;">
            <h2 style="color:#ef4444;margin:0 0 12px;">[ZUPIRUS ALERT] {html_mod.escape(str(title))}</h2>
            <p style="color:#cbd5e1;font-size:13px;line-height:1.6;">{html_mod.escape(str(detail))}</p>
          </div>
        </div>
        """
        return send_resend_email(to=admin_emails, subject=f"[ZUPIRUS ALERT] {title}", html=html)
    except Exception as e:
        logger.debug(f"Admin alert email skipped: {e}")
        return {"ok": False, "error": str(e)}
