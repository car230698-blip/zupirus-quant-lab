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
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["status"] == "DRAFT"
    assert body["price_usd"] == 29
    report_id = body["report_id"]

    client.post("/api/logout")
    hidden = client.get("/api/v1/reports")
    assert hidden.status_code == 200
    assert all(item["id"] != report_id for item in hidden.json()["items"])

    _login_admin(client)
    published = client.post(f"/api/v1/admin/reports/{report_id}/publish", json={"version": "v1.0"})
    assert published.status_code == 200, published.text

    client.post("/api/logout")
    visible = client.get(f"/api/v1/reports/{report_id}")
    assert visible.status_code == 200
    sample = client.get(f"/api/v1/reports/{report_id}/sample-pdf")
    assert sample.status_code == 200
    assert sample.content.startswith(b"%PDF")

    reg = client.post("/api/register", json={"email": "buyer.study@example.com", "password": "CustomerPass123!"})
    assert reg.status_code in (200, 400, 409)
    login = client.post("/api/login", json={"email": "buyer.study@example.com", "password": "CustomerPass123!"})
    assert login.status_code == 200
    order = client.post(f"/api/v1/reports/{report_id}/checkout", json={"payment_method": "USDT", "network": "BEP20"})
    assert order.status_code == 200, order.text
    order_id = order.json()["order_id"]
    assert order.json()["wallet_address"].startswith("0x2222")
    assert asyncio.run(process_successful_payment(order_id=order_id, sepay_trans_id="USDT_STUDY_1", amount_received_vnd=900000))

    downloaded = client.get(f"/api/v1/reports/{report_id}/download")
    assert downloaded.status_code == 200
    assert downloaded.headers.get("x-buyer-watermark") == "applied"
    assert b"buyer.study@example.com" in downloaded.content

    buyers = None
    client.post("/api/logout")
    _login_admin(client)
    buyers = client.get("/api/v1/admin/library/buyers")
    assert buyers.status_code == 200
    assert any(item["email"] == "buyer.study@example.com" for item in buyers.json()["items"])
    orders = client.get("/api/v1/admin/library/orders")
    assert orders.status_code == 200
    assert any(item["id"] == order_id for item in orders.json()["items"])


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
    assert missing.status_code == 400
    assert "ví" in missing.text


def test_rule_study_used_by_the_api_matches_the_library():
    bundle = run_studies(_sample_day(), symbol="XAUUSD", timeframe="H1")
    assert bundle["studies"][-1]["sample_size"] == 1
