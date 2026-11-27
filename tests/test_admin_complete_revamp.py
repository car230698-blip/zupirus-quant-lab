import time
import pytest
from app.db import tx
from app.domains.reports.service import (
    create_admin_report_draft,
    publish_admin_report,
)
from app.domains.quant.candles import parse_csv_candles


def _login_admin(client):
    res = client.post(
        "/api/login",
        json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"},
    )
    assert res.status_code == 200
    return res


def test_preview_nonexistent_version_returns_404(client):
    """Verify that previewing a version that does not exist returns HTTP 404 with no fallback."""
    _login_admin(client)
    rep = create_admin_report_draft(
        title="Version Isolation Preview Report",
        summary="Testing 404 on nonexistent version",
        version="v1.0",
        admin_id="admin",
    )
    rep_id = rep["id"]

    # Preview non-existent version v99.0
    res = client.get(f"/api/v1/admin/reports/{rep_id}/preview-pdf?kind=full&version=v99.0")
    assert res.status_code == 404
    assert "v99.0" in res.json().get("detail", "")

    # Preview non-existent bundle version v99.0
    res_b = client.get(f"/api/v1/admin/reports/{rep_id}/preview-bundle?version=v99.0")
    assert res_b.status_code == 404


def test_publish_blocks_auto_generated_placeholder_pdf(client):
    """Verify backend rejects publishing when PDF is an auto-generated placeholder layout."""
    _login_admin(client)
    rep = create_admin_report_draft(
        title="Placeholder PDF Block Test",
        summary="Should be blocked from publishing",
        version="v1.0",
        admin_id="admin",
    )
    rep_id = rep["id"]

    # Attempt to publish the draft which currently only has auto-generated layout
    with pytest.raises(ValueError) as exc:
        publish_admin_report(report_id=rep_id, version="v1.0", admin_id="admin")
    err_msg = str(exc.value).lower()
    assert "bố cục mẫu tự động" in err_msg or "tệp nghiên cứu thực" in err_msg


def test_toggle_sale_endpoint(client):
    """Verify toggle sale endpoint updates is_for_sale independently of publish status."""
    _login_admin(client)
    rep = create_admin_report_draft(
        title="Sale Toggle Report",
        summary="Testing commercial sale toggle",
        version="v1.0",
        admin_id="admin",
    )
    rep_id = rep["id"]

    # Toggle sale on
    res = client.post(f"/api/v1/admin/reports/{rep_id}/toggle-sale")
    assert res.status_code == 200
    assert res.json()["is_for_sale"] is True

    # Toggle sale off
    res2 = client.post(f"/api/v1/admin/reports/{rep_id}/toggle-sale")
    assert res2.status_code == 200
    assert res2.json()["is_for_sale"] is False


def test_manual_approve_order_requires_tx_hash_and_rejects_trials(client):
    """Verify manual order approval requires on-chain tx_hash and strictly rejects trial orders."""
    _login_admin(client)
    now = time.time()
    order_id = f"test_ord_{int(now * 1000)}"
    trial_id = f"trial_ord_{int(now * 1000)}"

    with tx() as c:
        u = c.execute("SELECT id FROM users LIMIT 1").fetchone()
        user_id = u[0]
        # Real commercial report order
        c.execute("""
            INSERT INTO orders (
                id, user_id, amount_usd, locked_exchange_rate, amount_vnd, plan_tier,
                status, payment_status, entitlement_status, payment_gateway,
                created_at, expires_at, currency, product_type, report_id, report_version
            ) VALUES (?, ?, 32.0, 1.0, 0, 'report:rep_gold_research_suite_v1', 'PENDING', 'PENDING', 'PENDING', 'DIRECT_USDT', ?, ?, 'USDT', 'PDF_REPORT', 'rep_gold_research_suite_v1', 'v1.0')
        """, (order_id, user_id, now, now + 3600))

        # Trial order
        c.execute("""
            INSERT INTO orders (
                id, user_id, amount_usd, locked_exchange_rate, amount_vnd, plan_tier,
                status, payment_status, entitlement_status, payment_gateway,
                created_at, expires_at, currency, product_type, report_id, report_version
            ) VALUES (?, ?, 0.0, 1.0, 0, 'report:rep_gold_research_suite_v1', 'COMPLETED', 'FREE_TRIAL', 'GRANTED', 'DIRECT_USDT', ?, ?, 'USDT', 'PDF_REPORT', 'rep_gold_research_suite_v1', 'v1.0')
        """, (trial_id, user_id, now, now + 3600))

    # 1. Approving trial order must fail
    res_trial = client.post(
        f"/api/admin/billing/orders/{trial_id}/approve",
        json={"tx_hash": "0x1234567890abcdef1234"},
    )
    assert res_trial.status_code == 400
    assert "Đơn dùng thử không được duyệt" in res_trial.json().get("detail", "")

    # 2. Approving commercial order without valid tx_hash fails validation
    res_no_tx = client.post(
        f"/api/admin/billing/orders/{order_id}/approve",
        json={"tx_hash": "short"},
    )
    assert res_no_tx.status_code == 422

    # 3. Approving commercial order with valid tx_hash succeeds
    tx_hash = "0xabcdef1234567890abcdef1234567890abcdef12"
    res_ok = client.post(
        f"/api/admin/billing/orders/{order_id}/approve",
        json={"tx_hash": tx_hash},
    )
    assert res_ok.status_code == 200
    assert res_ok.json()["status"] == "SUCCESS"

    with tx() as c:
        row = c.execute("SELECT status, payment_status, tx_hash FROM orders WHERE id=?", (order_id,)).fetchone()
        assert row[0] == "PAID"
        assert row[1] == "PAID"
        assert row[2] == tx_hash


def test_trial_licenses_full_lifecycle(client):
    """Verify trial license granting, listing, extending, and revoking."""
    _login_admin(client)
    test_email = f"trial_client_{int(time.time()*1000)}@institution.org"

    # Grant trial
    res_grant = client.post(
        "/api/v1/admin/billing/trials/grant",
        json={
            "email": test_email,
            "report_id": "rep_gold_research_suite_v1",
            "version": "v1.0",
            "duration_days": 14,
            "notes": "Evaluation Pilot Agreement",
        },
    )
    assert res_grant.status_code == 200
    ent = res_grant.json()["entitlement"]
    ent_id = ent["id"]

    # List trials
    res_list = client.get("/api/v1/admin/billing/trials")
    assert res_list.status_code == 200
    trials = res_list.json()["trials"]
    found = [t for t in trials if t["id"] == ent_id]
    assert len(found) == 1
    assert found[0]["user_email"] == test_email
    assert found[0]["is_active"] is True

    # Extend trial
    res_ext = client.post(
        f"/api/v1/admin/billing/trials/{ent_id}/extend",
        json={"extra_days": 10},
    )
    assert res_ext.status_code == 200

    # Revoke trial
    res_rev = client.post(
        f"/api/v1/admin/billing/trials/{ent_id}/revoke",
        json={"reason": "Testing immediate revocation"},
    )
    assert res_rev.status_code == 200

    # Verify status changed to REVOKED
    res_list2 = client.get("/api/v1/admin/billing/trials")
    found2 = [t for t in res_list2.json()["trials"] if t["id"] == ent_id]
    assert found2[0]["is_active"] is False
    assert found2[0]["status"] == "REVOKED"


def test_csv_parser_with_comments():
    """Verify CSV parser correctly skips # and // comments commonly found in COMEX exports."""
    raw_csv = """# COMEX Gold Continuous Contract GC=F
// Timezone: UTC, M15 candles
Date,Time,Open,High,Low,Close,Volume
# Morning session open
2024.01.02,00:00,2062.50,2064.00,2061.80,2063.20,150
2024.01.02,00:15,2063.20,2065.50,2062.90,2065.00,180
// End of opening block
2024.01.02,00:30,2065.00,2066.20,2064.50,2065.80,210
"""
    candles = parse_csv_candles(raw_csv)
    assert len(candles) == 3
    assert candles[0]["open"] == 2062.50
    assert candles[2]["close"] == 2065.80


def _register_and_login(client, email: str, password: str = "CustomerPass123!"):
    client.post("/api/register", json={"email": email, "password": password})
    r2 = client.post("/api/login", json={"email": email, "password": password})
    assert r2.status_code == 200
    return r2.json()


def test_order_creation_reuses_pending_order_and_locks_amount(client, monkeypatch):
    """Verifies creating order twice for the same report/user reuses existing pending order (preventing duplicate micro-offsets)."""
    monkeypatch.setenv("COMMERCIAL_REPORTS_SALE_ENABLED", "true")
    monkeypatch.setenv("PAYMENT_USDT_ENABLED", "true")
    from app.domains.billing.crypto_direct import save_crypto_wallets_config
    save_crypto_wallets_config(
        enabled=True,
        bep20_address="0x1111111111111111111111111111111111111111",
        admin_id="test",
    )
    # Register user
    email = "reuse_buyer@example.com"
    _register_and_login(client, email)

    # Ensure report exists and is published and for sale
    now_ts = time.time()
    rep_id = "rep_test_reuse_order"
    with tx() as c:
        c.execute(
            """
            INSERT INTO research_reports (id, slug, title, summary, status, is_for_sale, price_usd, price_vnd, version, published_at, created_at, updated_at)
            VALUES (?, ?, 'Test Reuse Order', 'Summary for test reuse order', 'PUBLISHED', 1, 19.0, 480000, 'v1.0', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET status = 'PUBLISHED', is_for_sale = 1, price_usd = 19.0
            """,
            (rep_id, rep_id, now_ts, now_ts, now_ts),
        )
        c.execute(
            """
            INSERT INTO report_versions (id, report_id, version, full_pdf_path, changelog, published_at, created_at)
            VALUES ('ver_reuse', ?, 'v1.0', 'data/reports_private/test.pdf', 'init', ?, ?)
            ON CONFLICT(report_id, version) DO NOTHING
            """,
            (rep_id, now_ts, now_ts),
        )

    # 1st checkout
    res1 = client.post(f"/api/v1/reports/{rep_id}/checkout", json={"payment_method": "USDT_BEP20"})
    assert res1.status_code == 200, res1.text
    order1 = res1.json()
    ord_code1 = order1["order_code"]
    amt1 = float(order1["amount"])
    assert 19.00 <= amt1 <= 20.00

    # 2nd checkout (rapid click or reload)
    res2 = client.post(f"/api/v1/reports/{rep_id}/checkout", json={"payment_method": "USDT_BEP20"})
    assert res2.status_code == 200, res2.text
    order2 = res2.json()
    # Must reuse the same order code and amount!
    assert order2["order_code"] == ord_code1
    assert float(order2["amount"]) == amt1
    assert order2.get("already_exists") is True


def test_locked_purchase_when_commercial_sale_disabled(client, monkeypatch):
    """Verify purchase is rejected when commercial sales flag is disabled."""
    email = "locked_buyer@example.com"
    _register_and_login(client, email)

    monkeypatch.setenv("COMMERCIAL_REPORTS_SALE_ENABLED", "false")
    res = client.post("/api/v1/reports/rep_gold_breakout_retest_m15_v1/checkout", json={"payment_method": "USDT_BEP20"})
    assert res.status_code == 400
    assert "tạm tắt" in res.json().get("detail", "")

