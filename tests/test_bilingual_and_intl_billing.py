"""
Comprehensive tests for Bilingual VI/EN and Direct On-Chain USDT international gateway.
Tests:
1. Migration 024 schema additions.
2. Language update endpoint PATCH /api/v1/auth/language and /api/me response.
3. Bilingual emails (OTP, receipt, expiry reminder, 24h handover).
4. Gateways listing endpoint GET /api/v1/billing/gateways honors enabled toggle.
"""
import hmac
import hashlib
import json
import os
import time
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db import tx, is_postgres
from app.core.mailer import (
    send_otp_code,
    send_payment_receipt_email,
    send_subscription_expiry_reminder,
)


@pytest.fixture
def client():
    from app.core.db import init
    init()
    c = TestClient(app)
    c.headers.update({"X-Zupirus": "1"})
    return c


@pytest.fixture
def test_user(client):
    """Create a clean unique test user and return credentials & auth token/cookie."""
    import secrets
    from app.core.db import init
    init()
    uid = f"u_test_{secrets.token_hex(6)}"
    email = f"bilingual_{secrets.token_hex(4)}@zupirus.test"
    password = "quant-password-123"

    from app.core.security import password_hash
    with tx() as c:
        try:
            c.execute(
                "INSERT INTO users (id, email, password, role, preferred_language) VALUES (?, ?, ?, 'customer', 'vi')",
                (uid, email, password_hash(password)),
            )
        except Exception:
            c.execute(
                "INSERT INTO users (id, email, password, role) VALUES (?, ?, ?, 'customer')",
                (uid, email, password_hash(password)),
            )

    login_res = client.post("/api/login", json={"email": email, "password": password})
    assert login_res.status_code == 200, f"Login failed: {login_res.text}"
    token = login_res.cookies.get("token") or login_res.json().get("token")

    return {
        "id": uid,
        "email": email,
        "password": password,
        "token": token,
        "client": client,
    }


def test_migration_024_columns():
    """Test that migration 024 successfully added required columns to users, orders, and payment_transactions."""
    with tx() as c:
        if is_postgres():
            u_cols = [r[0] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'").fetchall()]
            o_cols = [r[0] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'orders'").fetchall()]
            p_cols = [r[0] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_transactions'").fetchall()]
        else:
            u_cols = [r[1] for r in c.execute("PRAGMA table_info(users)").fetchall()]
            o_cols = [r[1] for r in c.execute("PRAGMA table_info(orders)").fetchall()]
            p_cols = [r[1] for r in c.execute("PRAGMA table_info(payment_transactions)").fetchall()]

        assert "preferred_language" in u_cols
        assert "currency" in o_cols
        assert "external_payment_id" in o_cols
        assert "invoice_url" in o_cols
        assert "external_payment_id" in p_cols


def test_auth_language_endpoint(test_user):
    """Test PATCH /api/v1/auth/language updates preferred_language and /api/me returns it."""
    client = test_user["client"]

    # 1. Initial language is default 'vi'
    me_res = client.get("/api/v1/auth/me")
    assert me_res.status_code == 200
    assert me_res.json().get("preferred_language") == "vi"

    # 2. Switch to 'en'
    patch_res = client.patch("/api/v1/auth/language", json={"language": "en"})
    assert patch_res.status_code == 200
    assert patch_res.json().get("preferred_language") == "en"

    # 3. Verify /api/me now returns 'en'
    me_res2 = client.get("/api/me")
    assert me_res2.status_code == 200
    assert me_res2.json().get("preferred_language") == "en"

    # 4. Reject invalid language (only 'vi' or 'en' allowed)
    bad_res = client.patch("/api/v1/auth/language", json={"language": "fr"})
    assert bad_res.status_code == 400


def test_bilingual_emails():
    """Test bilingual email templates for OTP, payment receipt, and subscription expiry."""
    # 1. English OTP
    otp_en = send_otp_code("trader@test.com", "889900", lang="en")
    assert otp_en.get("ok") is True

    # 2. Vietnamese OTP
    otp_vi = send_otp_code("trader@test.com", "889900", lang="vi")
    assert otp_vi.get("ok") is True

    # 3. English Payment Receipt
    receipt_en = send_payment_receipt_email(
        email="trader@test.com",
        order_id="ord_test123",
        plan_tier="growth",
        amount_vnd=990000,
        cloud_slots=3,
        expires_at=time.time() + 86400 * 30,
        lang="en",
        amount_usd=39.0,
        currency="USD",
    )
    assert receipt_en.get("ok") is True

    # 4. English Expiry Reminder
    exp_en = send_subscription_expiry_reminder(
        email="trader@test.com",
        plan_tier="alpha",
        days_left=3,
        expires_at=time.time() + 86400 * 3,
        lang="en",
    )
    assert exp_en.get("ok") is True


def test_gateways_endpoint(client):
    """Test GET /api/v1/billing/gateways returns truthful status and respects enabled toggle."""
    from app.domains.billing.crypto_direct import save_crypto_wallets_config
    # 1. When enabled with valid wallets
    save_crypto_wallets_config(
        enabled=True,
        trc20_address="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        bep20_address="0x55d398326f99059fF775485246999027B3197955",
        admin_id="adm-test"
    )
    res1 = client.get("/api/v1/billing/gateways")
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["sepay"] is False
    assert data1["usdt"] is True
    assert data1["usdt_trc20"] is True
    assert data1["usdt_bep20"] is True

    # 2. When disabled by admin (enabled=False), all USDT gateways must be False even if addresses are stored
    save_crypto_wallets_config(
        enabled=False,
        trc20_address="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        bep20_address="0x55d398326f99059fF775485246999027B3197955",
        admin_id="adm-test"
    )
    res2 = client.get("/api/v1/billing/gateways")
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["usdt"] is False
    assert data2["usdt_trc20"] is False
    assert data2["usdt_bep20"] is False


def test_geoip_language_detection(client, monkeypatch):
    """Test IP and GeoIP based language detection for foreign visitors."""
    # 1. Cloudflare header for foreign country
    r_cf_nl = client.get("/api/v1/auth/geo", headers={"cf-ipcountry": "NL"})
    assert r_cf_nl.status_code == 200
    assert r_cf_nl.json()["country"] == "NL"
    assert r_cf_nl.json()["is_foreign"] is True
    assert r_cf_nl.json()["language"] == "en"

    # 2. Cloudflare header for Vietnam
    r_cf_vn = client.get("/api/v1/auth/geo", headers={"cf-ipcountry": "VN"})
    assert r_cf_vn.status_code == 200
    assert r_cf_vn.json()["country"] == "VN"
    assert r_cf_vn.json()["is_foreign"] is False
    assert r_cf_vn.json()["language"] == "vi"

    # 3. Direct IP lookup for foreign IP (Netherlands IP 51.158.254.166)
    # Even if browser Accept-Language is Vietnamese!
    r_ip_nl = client.get(
        "/api/v1/auth/geo",
        headers={
            "X-Forwarded-For": "51.158.254.166",
            "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
        }
    )
    assert r_ip_nl.status_code == 200
    assert r_ip_nl.json()["country"] == "NL"
    assert r_ip_nl.json()["is_foreign"] is True
    assert r_ip_nl.json()["language"] == "en"
    assert "zupirus_geo_lang=en" in r_ip_nl.headers.get("set-cookie", "")

    # 4. Local loopback fallback to Accept-Language
    r_local_vi = client.get(
        "/api/v1/auth/geo",
        headers={
            "X-Forwarded-For": "127.0.0.1",
            "Accept-Language": "vi-VN,vi;q=0.9",
        }
    )
    assert r_local_vi.status_code == 200
    assert r_local_vi.json()["language"] == "vi"
    assert r_local_vi.json()["is_foreign"] is False


def test_english_seo_pages(client):
    """Test English international SEO SSR endpoints and hreflang metadata."""
    # 1. English overview landing page
    r_en = client.get("/en")
    assert r_en.status_code == 200
    assert 'lang="en"' in r_en.text
    assert 'hreflang="en"' in r_en.text
    assert "ZUPIRUS — Institutional Gold" in r_en.text
    assert "Walk-Forward OOS Verification" in r_en.text

    # 2. English guides list
    r_guides = client.get("/en/guides")
    assert r_guides.status_code == 200
    assert 'lang="en"' in r_guides.text
    assert "Quantitative Research &amp; Methodology Guides" in r_guides.text

    # 3. English guide detail
    r_detail = client.get("/en/guides/xauusd-m15-breakout-retest-quantitative-research")
    assert r_detail.status_code == 200
    assert 'lang="en"' in r_detail.text
    assert "Quantitative Research: Does Breakout &amp; Retest" in r_detail.text
    assert "Article" in r_detail.text


