"""
ZUPIRUS Quant Lab - SePay Banking Webhook Integration Engine
Receives real-time bank transfer notifications from SePay (sepay.vn),
verifies HMAC-SHA256 signature, matches user payment memos,
records transactions, and dispatches confirmation emails via Resend.
"""
import os
import hmac
import html as html_mod
import json
import hashlib
import logging
from typing import Optional

logger = logging.getLogger("zupirus.sepay")

def get_sepay_secret() -> str:
    """Load SePay Webhook Secret strictly from dynamic DB settings or env var.
    Fails closed (returns empty string) if unconfigured — never defaults to hardcoded fallback."""
    try:
        from app.db import tx
        with tx() as c:
            row = c.execute("SELECT value FROM kv WHERE key IN ('billing:settings', 'billing_settings')").fetchone()
            if row and row[0]:
                d = json.loads(row[0])
                enc_sec = d.get("sepay_webhook_secret_encrypted")
                if enc_sec:
                    from app.security import decrypt_secret
                    dec = decrypt_secret(str(enc_sec))
                    if dec:
                        return dec.strip()
                sec = d.get("webhook_secret") or d.get("sepay_webhook_secret")
                if sec:
                    return str(sec).strip()
    except Exception:
        pass

    return os.getenv("SEPAY_WEBHOOK_SECRET", "").strip()

def verify_sepay_signature(raw_body: bytes, signature_header: Optional[str], secret: str = None) -> bool:
    """
    Verify HMAC-SHA256 signature from SePay header 'x-sepay-signature'.
    Supports raw hex digest or standard 't=...,v1=...' format.
    """
    secret = secret or get_sepay_secret()
    if not secret:
        logger.warning("SEPAY_WEBHOOK_SECRET not configured. Rejecting webhook.")
        return False
    if not signature_header:
        return False

    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    sig = signature_header.strip()

    # 1. Direct match
    if hmac.compare_digest(expected.lower(), sig.lower()):
        return True

    # 2. Key-value formatted headers
    for part in sig.split(","):
        part = part.strip()
        if "=" in part:
            k, v = part.split("=", 1)
            k = k.strip()
            v = v.strip()
            if k in ("v1", "sha256", "signature") and hmac.compare_digest(expected.lower(), v.lower()):
                return True

    return False

def extract_user_identifier(content: str) -> Optional[str]:
    """
    Extract email, user ID, or payment code from bank transfer memo.
    Example memos: 'ZP 10001 PRO', 'ZUPIRUS car230698@gmail.com', 'THANH TOAN GOI PRO ZP-9821'
    """
    if not content:
        return None
    tokens = content.split()
    for t in tokens:
        clean = t.strip(".,;:/-_")
        if "@" in clean and "." in clean:
            return clean.lower()
        if clean.upper().startswith("ZP") and len(clean) > 2:
            return clean.upper()
    return None

def build_payment_success_email(
    user_email: str,
    amount_vnd: float,
    gateway: str,
    ref_code: str,
    content: str
) -> str:
    """Cybernetic HTML email confirming SePay payment receipt."""
    formatted_amount = f"{int(amount_vnd):,} VNĐ"
    return f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background-color:#050811;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
        <tr>
          <td align="center">
            <table width="100%" style="max-width:540px;background:#0d1527;border:1px solid #10b981;border-radius:16px;overflow:hidden;box-shadow:0 0 40px rgba(16,185,129,0.2);">
              <tr>
                <td style="padding:32px 32px 20px;text-align:center;background:rgba(16,185,129,0.08);border-bottom:1px solid rgba(16,185,129,0.3);">
                  <div style="display:inline-block;padding:6px 14px;background:rgba(16,185,129,0.2);border:1px solid #10b981;border-radius:9999px;color:#10b981;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
                    ✓ GIAO DỊCH ĐÃ XÁC THỰC
                  </div>
                  <h1 style="color:#f8fafc;font-size:22px;font-weight:800;letter-spacing:1px;margin:16px 0 4px;">ZUPIRUS QUANT LAB</h1>
                  <p style="color:#94a3b8;font-size:13px;margin:0;">Xác Nhận Thanh Toán & Kích Hoạt Tự Động</p>
                </td>
              </tr>
              <tr>
                <td style="padding:32px;">
                  <p style="color:#cbd5e1;font-size:14px;margin:0 0 16px;">Xin chào nhà giao dịch,</p>
                  <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0 0 24px;">
                    Hệ thống SePay vừa xác thực thành công giao dịch chuyển khoản ngân hàng của bạn vào hệ thống ZUPIRUS Quant Lab:
                  </p>
                  <table width="100%" style="background:#090d1a;border:1px solid #1e293b;border-radius:12px;padding:20px;margin-bottom:24px;">
                    <tr>
                      <td style="color:#64748b;font-size:12px;padding:6px 0;">Số tiền nhận:</td>
                      <td style="color:#10b981;font-weight:800;font-size:18px;font-family:monospace;padding:6px 0;">{formatted_amount}</td>
                    </tr>
                    <tr>
                      <td style="color:#64748b;font-size:12px;padding:6px 0;">Ngân hàng:</td>
                      <td style="color:#f8fafc;font-weight:600;font-size:13px;padding:6px 0;">{html_mod.escape(str(gateway or 'VietQR'))}</td>
                    </tr>
                    <tr>
                      <td style="color:#64748b;font-size:12px;padding:6px 0;">Mã tham chiếu:</td>
                      <td style="color:#38bdf8;font-family:monospace;font-size:12px;padding:6px 0;">{html_mod.escape(str(ref_code or 'N/A'))}</td>
                    </tr>
                    <tr>
                      <td style="color:#64748b;font-size:12px;padding:6px 0;">Nội dung:</td>
                      <td style="color:#cbd5e1;font-size:12px;padding:6px 0;">{html_mod.escape(str(content or 'N/A'))}</td>
                    </tr>
                    <tr>
                      <td style="color:#64748b;font-size:12px;padding:6px 0;">Trạng thái:</td>
                      <td style="color:#10b981;font-weight:700;font-size:12px;padding:6px 0;">ĐÃ HOÀN TẤT & KÍCH HOẠT</td>
                    </tr>
                  </table>
                  <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0;">
                    Tài khoản của bạn đã được cập nhật quyền hạn và các tính năng định lượng cao cấp trên hệ thống <a href="https://app.zupirus.com" style="color:#38bdf8;text-decoration:none;">app.zupirus.com</a>.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 32px;background:#090d1a;border-top:1px solid #1e293b;text-align:center;">
                  <p style="color:#475569;font-size:11px;margin:0;">
                    © 2026 ZUPIRUS Quant Lab • SePay Automated Gateway • Resend Verified
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

