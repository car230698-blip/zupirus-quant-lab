"""Regression & security hardening tests for auth OTP, password reset, XFF rate limits, and HTML escaping."""
import time
import uuid

from app.db import tx


def test_register_otp_lockout_deletes_otp_and_rejects(client):
    email = f"otp-lock-{uuid.uuid4().hex[:8]}@example.com"
    with tx() as c:
        c.execute(
            "INSERT INTO otp_codes (email, code, expires_at, attempts) VALUES (?, ?, ?, 0) "
            "ON CONFLICT(email) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at, attempts=0",
            (email, "654321", time.time() + 300),
        )

    for idx in range(4):
        resp = client.post(
            "/api/register",
            json={"email": email, "password": "StrongPassword!123", "otp_code": "000000"},
        )
        assert resp.status_code == 400, f"attempt {idx+1} expected 400, got {resp.status_code}"

    # 5th wrong attempt triggers 429 and deletes the OTP record
    resp5 = client.post(
        "/api/register",
        json={"email": email, "password": "StrongPassword!123", "otp_code": "000000"},
    )
    assert resp5.status_code == 429
    with tx() as c:
        row = c.execute("SELECT 1 FROM otp_codes WHERE email=?", (email,)).fetchone()
        assert row is None


def test_forgot_reset_and_change_password_flow(client, monkeypatch):
    email = f"reset-flow-{uuid.uuid4().hex[:8]}@example.com"

    assert client.post("/api/register", json={"email": email, "password": "InitialPass!1234"}).status_code == 200

    sent_codes = []
    monkeypatch.setattr(
        "app.mailer.send_otp_code",
        lambda email, code, purpose="": sent_codes.append(code) or {"ok": True},
    )

    fp_res = client.post("/api/auth/forgot-password", json={"email": email})
    assert fp_res.status_code == 200
    assert len(sent_codes) == 1

    # Reset password with the issued OTP (and verify OTP cannot be replayed)
    rp_res = client.post(
        "/api/auth/reset-password",
        json={"email": email, "otp_code": sent_codes[0], "new_password": "ResetPassword!567"},
    )
    assert rp_res.status_code == 200

    replay = client.post(
        "/api/auth/reset-password",
        json={"email": email, "otp_code": sent_codes[0], "new_password": "AnotherPass!7890"},
    )
    assert replay.status_code == 400

    # Login with new password, then change password
    login_res = client.post("/api/login", json={"email": email, "password": "ResetPassword!567"})
    assert login_res.status_code == 200

    ch_res = client.post(
        "/api/auth/change-password",
        json={"current_password": "ResetPassword!567", "new_password": "FinalPassword!890"},
        headers={"x-zupirus": "1"},
    )
    assert ch_res.status_code == 200

    assert client.post(
        "/api/login",
        json={"email": email, "password": "FinalPassword!890"},
        headers={"x-zupirus": "1"},
    ).status_code == 200


def test_admin_mailer_test_escapes_html(client, monkeypatch):
    assert client.post(
        "/api/login",
        json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"},
    ).status_code == 200

    captured = {}

    def fake_send(to, subject, html):
        captured["html"] = html
        return {"ok": True}

    monkeypatch.setattr("app.mailer.send_resend_email", fake_send)
    res = client.post(
        "/api/admin/mailer/test",
        json={"to": "<script>alert(1)</script>@example.com"},
        headers={"x-zupirus": "1"},
    )
    assert res.status_code == 200
    assert "<script>" not in captured["html"]
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in captured["html"]
