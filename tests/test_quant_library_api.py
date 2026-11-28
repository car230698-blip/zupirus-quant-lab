"""Admin study run, draft catalog hiding, and a watermarked buyer download."""
import asyncio

from app.domains.billing.crypto_direct import save_crypto_wallets_config
from app.domains.billing.service import process_successful_payment
from app.domains.quant.studies import run_studies
from tests.test_quant_studies import _sample_day


def _login_admin(client):
    res = client.post(
        "/api/login",
        json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"},
    )
    assert res.status_code == 200
    return res


def test_admin_study_becomes_a_hidden_draft_until_published(client, monkeypatch):
    monkeypatch.setenv("COMMERCIAL_REPORTS_SALE_ENABLED", "true")
    save_crypto_wallets_config(
        enabled=True,
        bep20_address="0x2222222222222222222222222222222222222222",
        admin_id="test",
    )
    _login_admin(client)
    created = client.post(
        "/api/v1/admin/quant/studies",
        json={
            "symbol": "XAUUSD",
            "timeframe": "H1",
            "title_vi": "Phiên Á và biên độ London",
            "title_en": "Asia range and the London session",
            "price_usd": 29,
            "version": "v1.0",
            "round_trip_cost_r": 0,
            "candles": _sample_day(),
        },
    )
    # Commercial draft creation from lab is strictly discontinued
    assert created.status_code == 403, created.text
    assert "ngừng hoạt động" in created.json()["detail"]


def test_migration_does_not_drop_a_historical_trading_table(client):
    from app.db import tx
    from app.migrations.seed_and_fixes import apply_migration_028

    with tx() as c:
        before = c.execute("SELECT COUNT(*) FROM trading_accounts").fetchone()[0]
        apply_migration_028(c, False)
        after = c.execute("SELECT COUNT(*) FROM trading_accounts").fetchone()[0]
        assert after == before
        flag = c.execute("SELECT value FROM kv WHERE key = 'legacy_customer_execution'").fetchone()
        assert str(flag[0]) == "retired"


def test_checkout_refuses_to_invent_a_receiving_wallet(client, monkeypatch):
    monkeypatch.setenv("COMMERCIAL_REPORTS_SALE_ENABLED", "true")
    monkeypatch.setenv("PAYMENT_USDT_ENABLED", "true")
    from app.db import tx
    with tx() as c:
        c.execute("DELETE FROM kv WHERE key = 'billing:crypto_wallets'")
    reg = client.post("/api/register", json={"email": "nowallet@example.com", "password": "CustomerPass123!"})
    assert reg.status_code in (200, 400, 409)
    assert client.post("/api/login", json={"email": "nowallet@example.com", "password": "CustomerPass123!"}).status_code == 200
    missing = client.post("/api/v1/reports/rep_xauusd_london_ny_v1/checkout", json={"payment_method": "USDT"})
    assert missing.status_code == 403


def test_rule_study_used_by_the_api_matches_the_library():
    bundle = run_studies(_sample_day(), symbol="XAUUSD", timeframe="H1")
    assert bundle["studies"][-1]["sample_size"] == 1
