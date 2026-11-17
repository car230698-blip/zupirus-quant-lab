"""Tests for Multi-Source Curator, Admin Billing Settings, and Top Telemetry Endpoints."""
import pytest
from starlette.testclient import TestClient


def test_topbar_telemetry_endpoint(client: TestClient):
    """Verify live topbar telemetry returns XAUUSD quote, USD/VND rate, and news shield."""
    r = client.get("/api/v1/telemetry/topbar")
    assert r.status_code == 200, r.text
    d = r.json()
    assert "xauusd" in d
    assert d["xauusd"]["symbol"] == "XAUUSD"
    assert "bid" in d["xauusd"]
    assert "ask" in d["xauusd"]
    assert "spread_pips" in d["xauusd"]
    assert "usd_vnd" in d
    assert d["usd_vnd"]["rate"] >= 1000.0
    assert "news_shield" in d
    assert d["news_shield"]["status"] in ("CLEAR", "WARNING", "BLACKOUT")
    assert d["metaapi_latency_ms"] >= 0
    assert "shields" in d and len(d["shields"]) == 4


def test_sources_curator_and_leaderboard_endpoints(client: TestClient):
    """Verify admin sources listing, creation, promote/demote, and replay endpoints."""
    # 1. Login as admin
    login_res = client.post("/api/login", json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"})
    assert login_res.status_code == 200, login_res.text
    csrf = {"x-zupirus": "1"}

    # 2. List sources
    r_list = client.get("/api/admin/sources", headers=csrf)
    assert r_list.status_code == 200
    sources = r_list.json()["sources"]
    assert len(sources) >= 4  # Seeded sources

    # 3. Get Leaderboard
    r_lb = client.get("/api/admin/sources/leaderboard", headers=csrf)
    assert r_lb.status_code == 200
    assert len(r_lb.json()["leaderboard"]) >= 4

    # 4. Create new shadow source
    r_create = client.post(
        "/api/admin/sources",
        json={
            "name": "Alpha Breakout Scalper",
            "source_type": "TRADINGVIEW",
            "status": "SHADOW_ONLY",
            "symbol_universe": "XAUUSD,EURUSD"
        },
        headers=csrf
    )
    assert r_create.status_code == 200
    new_src = r_create.json()["source"]
    assert new_src["name"] == "Alpha Breakout Scalper"
    assert new_src["status"] == "SHADOW_ONLY"
    new_id = new_src["id"]

    # 5. Instant Replay on new source
    r_replay = client.post(f"/api/admin/sources/{new_id}/replay?days=90", headers=csrf)
    assert r_replay.status_code == 200
    replay_data = r_replay.json()["result"]
    assert replay_data["ok"] is True
    assert replay_data["simulated_trades"] >= 0
    assert replay_data["qualified"] is False

    # 6. Demote an active source
    r_demote = client.post(f"/api/admin/sources/src_tv_primary/demote", headers=csrf)
    assert r_demote.status_code == 200
    assert r_demote.json()["source"]["status"] == "SHADOW_ONLY"

    # 7. Promote new source to active
    r_promote = client.post(f"/api/admin/sources/{new_id}/promote", headers=csrf)
    assert r_promote.status_code == 200
    assert r_promote.json()["source"]["status"] == "ACTIVE_LIVE"

    # 8. Re-promote src_tv_primary
    r_re_promote = client.post("/api/admin/sources/src_tv_primary/promote", headers=csrf)
    assert r_re_promote.status_code == 200


def test_admin_billing_settings_and_qr_preview(client: TestClient):
    """Verify admin billing settings configuration and VietQR generation."""
    login_res = client.post("/api/login", json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"})
    assert login_res.status_code == 200, login_res.text
    csrf = {"x-zupirus": "1"}

    # 1. Get settings
    r_get = client.get("/api/admin/billing/settings", headers=csrf)
    assert r_get.status_code == 200
    settings = r_get.json()
    assert "bank_name" in settings
    assert "supported_banks" in settings
    assert len(settings["supported_banks"]) >= 5

    # 2. Update settings to VietinBank 105887054819 LE NGUYEN NHU THUY
    r_post = client.post(
        "/api/admin/billing/settings",
        json={
            "bank_name": "VietinBank",
            "account_number": "105887054819",
            "account_holder": "LE NGUYEN NHU THUY",
            "content_prefix": "ZP",
            "fx_mode": "AUTO",
            "manual_fx_rate": 25700.0
        },
        headers=csrf
    )
    assert r_post.status_code == 200
    assert r_post.json()["settings"]["bank_name"] == "VietinBank"
    assert r_post.json()["settings"]["account_number"] == "105887054819"

    # 3. Preview QR code
    r_qr = client.post(
        "/api/admin/billing/preview-qr",
        json={
            "bank_name": "VietinBank",
            "account_number": "105887054819",
            "account_holder": "LE NGUYEN NHU THUY",
            "amount_vnd": 772000,
            "content_memo": "ZP TESTQR"
        },
        headers=csrf
    )
    assert r_qr.status_code == 200
    qr_data = r_qr.json()
    assert "sepay_qr_url" in qr_data
    assert "105887054819" in qr_data["sepay_qr_url"]
    assert "VietinBank" in qr_data["sepay_qr_url"]
    assert "ZP%20TESTQR" in qr_data["sepay_qr_url"]
