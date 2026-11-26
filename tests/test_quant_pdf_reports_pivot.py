"""End-to-end verification suite for the ZUPIRUS Quant Lab pivot:
XAU/USD Quantitative Research & Per-Report PDF Platform (with Customer Auto-Trading Disabled).
"""
import json
import time
from unittest.mock import AsyncMock, patch

from app import db
from app.domains.ai.research_graph import (
    evaluate_candidate_window_detailed,
    score_candidate_on_window,
    walk_forward,
)
from app.domains.billing.service import process_successful_payment
from app.domains.reports.pdf_builder import build_pdf_bytes


def _login_admin(client):
    res = client.post(
        "/api/login",
        json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"},
    )
    assert res.status_code == 200
    return res


def _register_and_login(client, email: str, password: str = "CustomerPass123!"):
    r1 = client.post("/api/register", json={"email": email, "password": password})
    assert r1.status_code in (200, 400, 409)
    r2 = client.post("/api/login", json={"email": email, "password": password})
    assert r2.status_code == 200
    return r2.json()


def test_1_admin_report_lifecycle_and_public_catalog_visibility(client, monkeypatch):
    """1. Admin creates draft report, uploads PDF, attaches research result, and publishes.
    Unauthenticated visitor sees only PUBLISHED reports, report details, and sample PDF (DRAFT hidden)."""
    monkeypatch.delenv("ENABLE_LEGACY_CUSTOMER_EXECUTION", raising=False)

    # Unauthenticated visitor checks default seeded catalog
    pub_list = client.get("/api/v1/reports")
    assert pub_list.status_code == 200
    initial_items = pub_list.json()["items"]
    assert any(r["id"] == "rep_xauusd_london_ny_v1" for r in initial_items)

    # Seed a WFO strategy candidate to attach
    now_ts = time.time()
    with db.tx() as c:
        c.execute(
            """
            INSERT INTO strategy_candidates (
                id, name, status, rules_json, sample_size, win_rate,
                profit_factor, sharpe_ratio, max_drawdown_pct, oos_net_units,
                created_at, updated_at
            ) VALUES (?, ?, 'WAITING_APPROVAL', ?, 85, 0.64, 1.82, 1.95, 3.8, 42.5, ?, ?)
            """,
            (
                "cand_xau_ldn_01",
                "TabulaRasa-XAU-London-Sweep",
                json.dumps({"symbol": "XAUUSD", "preferred_session": "London", "action": "BUY", "h1_trend": "BULLISH"}),
                now_ts,
                now_ts,
            ),
        )

    # Login as Admin and create a DRAFT report attached to cand_xau_ldn_01
    _login_admin(client)
    create_res = client.post(
        "/api/v1/admin/reports",
        json={
            "title": "Báo Cáo Định Lượng XAU/USD Quý 4: Quét Thanh Khoản Phiên London",
            "subtitle": "Kiểm định Walk-Forward 120/60 với bộ lọc H1 Bullish",
            "summary": "Nghiên cứu thực nghiệm 85 mẫu tín hiệu XAU/USD khung M15/H1.",
            "market": "XAUUSD",
            "timeframe": "M15 / H1",
            "version": "v1.0",
            "price_vnd": 890000,
            "price_usd": 36.0,
            "page_count": 22,
            "research_candidate_id": "cand_xau_ldn_01",
            "highlights_json": ["Win rate OOS 64%", "Profit Factor 1.82"],
        },
    )
    assert create_res.status_code == 200, create_res.text
    draft_rep = create_res.json()
    rep_id = draft_rep["id"]
    assert draft_rep["status"] == "DRAFT"
    assert draft_rep["wfo_metrics"]["win_rate"] == 0.64

    # Upload custom full_pdf and sample_pdf via multipart form
    custom_full_pdf = build_pdf_bytes(
        title="FULL PRIVATE QUANT REPORT V1.0",
        subtitle="Authorized Buyer Copy | XAUUSD (M15 / H1)",
        pages_lines=[["# 1. Full Analysis", "Confidential full research body."]],
    )
    custom_sample_pdf = build_pdf_bytes(
        title="SAMPLE PREVIEW QUANT REPORT V1.0",
        subtitle="Public Sample Preview | XAUUSD (M15 / H1)",
        pages_lines=[["# 1. Sample Introduction", "Public sample preview body."]],
    )
    up_res = client.post(
        f"/api/v1/admin/reports/{rep_id}/upload-pdf",
        data={"version": "v1.0", "changelog": "Initial release"},
        files={
            "full_pdf": ("full-v1.pdf", custom_full_pdf, "application/pdf"),
            "sample_pdf": ("sample-v1.pdf", custom_sample_pdf, "application/pdf"),
        },
    )
    assert up_res.status_code == 200, up_res.text

    # Logout to become an unauthenticated visitor: DRAFT must NOT be visible in catalog or detail
    client.post("/api/logout")
    anon_catalog = client.get("/api/v1/reports").json()["items"]
    assert not any(r["id"] == rep_id for r in anon_catalog)
    assert client.get(f"/api/v1/reports/{rep_id}").status_code == 404
    assert client.get(f"/api/v1/reports/{rep_id}/sample-pdf").status_code == 404

    # Admin logs back in and publishes the report
    _login_admin(client)
    pub_res = client.post(
        f"/api/v1/admin/reports/{rep_id}/publish",
        json={"version": "v1.0", "changelog": "Approved & published"},
    )
    assert pub_res.status_code == 200, pub_res.text
    assert pub_res.json()["status"] == "PUBLISHED"

    # Unauthenticated visitor now sees the published report, its detail, and its sample PDF
    client.post("/api/logout")
    anon_catalog_after = client.get("/api/v1/reports").json()["items"]
    assert any(r["id"] == rep_id for r in anon_catalog_after)

    detail_res = client.get(f"/api/v1/reports/{rep_id}")
    assert detail_res.status_code == 200
    assert detail_res.json()["title"].startswith("Báo Cáo Định Lượng XAU/USD Quý 4")

    sample_dl = client.get(f"/api/v1/reports/{rep_id}/sample-pdf")
    assert sample_dl.status_code == 200
    assert sample_dl.headers["content-type"].startswith("application/pdf")
    assert sample_dl.content.startswith(b"%PDF-1.4")


def test_2_and_3_purchase_idempotent_webhook_library_download_and_access_control(client, monkeypatch):
    """2. Customer buys report -> payment confirmed -> report appears in My Library -> downloads valid PDF.
    Duplicate webhook does not create duplicate order or entitlement.
    3. Another account cannot download using buyer's URL, ID, or signed token.
    Discontinued report blocks new purchase while preserving existing buyer's download.
    Version v2.0 publication keeps v1.0 buyer locked to v1.0 PDF.
    Refund revokes download access. Legacy signal subscription does not grant PDF download access."""
    monkeypatch.delenv("ENABLE_LEGACY_CUSTOMER_EXECUTION", raising=False)
    rep_id = "rep_xauusd_london_ny_v1"

    # Register Buyer A
    _register_and_login(client, "buyer_a@example.com")

    # Verify legacy signal subscription does NOT grant PDF report download access
    with db.tx() as c:
        u_a = c.execute("SELECT id FROM users WHERE email = 'buyer_a@example.com'").fetchone()
        uid_a = str(u_a[0])
        now_s = time.time()
        c.execute(
            """
            INSERT INTO subscriptions (id, user_id, plan_tier, service_expires_at, max_mt5_accounts, created_at, updated_at)
            VALUES (?, ?, 'ALPHA', ?, 5, ?, ?)
            """,
            ("sub_legacy_a1", uid_a, now_s + 86400 * 30, now_s, now_s),
        )
    unbought_dl = client.get(f"/api/v1/reports/{rep_id}/download")
    assert unbought_dl.status_code == 403

    # Verify checkout is strictly blocked when commercial reports sale is not enabled
    monkeypatch.setenv("COMMERCIAL_REPORTS_SALE_ENABLED", "false")
    blocked_co = client.post(
        f"/api/v1/reports/{rep_id}/checkout",
        json={"payment_method": "USDT"},
    )
    assert blocked_co.status_code == 400
    assert "tạm tắt" in blocked_co.text

    # Enable commercial sale to test full purchase, idempotent webhook, and library fulfillment
    monkeypatch.setenv("COMMERCIAL_REPORTS_SALE_ENABLED", "true")
    from app.domains.billing.crypto_direct import save_crypto_wallets_config
    save_crypto_wallets_config(
        enabled=True,
        bep20_address="0x1111111111111111111111111111111111111111",
        admin_id="test",
    )

    # Buyer A creates checkout order for rep_xauusd_london_ny_v1 (v1.0)
    co_res = client.post(
        f"/api/v1/reports/{rep_id}/checkout",
        json={"payment_method": "USDT"},
    )
    assert co_res.status_code == 200, co_res.text
    order_info = co_res.json()
    order_id = order_info["order_id"]
    order_code = order_info["order_code"]
    amount_usd = float(order_info.get("amount_usd", 29.0))
    assert order_info["product_type"] == "PDF_REPORT"
    assert order_info["report_version"] == "v1.0"
    assert "USDT" in order_info.get("payment_gateway", "")

    # Before payment, library is empty (only pending_orders has the order)
    lib_before = client.get("/api/v1/reports/my/library").json()
    assert lib_before["count"] == 0
    assert len(lib_before["pending_orders"]) == 1

    # Simulate payment confirmation twice (duplicate webhook / retry idempotency test)
    import asyncio
    res_pay_1 = asyncio.run(
        process_successful_payment(
            order_id=order_id,
            sepay_trans_id="USDT_TX_9001",
            amount_received_vnd=750000,
        )
    )
    assert res_pay_1 is True

    res_pay_2 = asyncio.run(
        process_successful_payment(
            order_id=order_id,
            sepay_trans_id="USDT_TX_9001_DUP",
            amount_received_vnd=750000,
        )
    )
    assert res_pay_2 is True

    # Verify exactly 1 entitlement row exists in DB for Buyer A
    with db.tx() as c:
        ent_cnt = c.execute(
            "SELECT COUNT(*) FROM report_entitlements WHERE user_id = ? AND report_id = ?",
            (uid_a, rep_id),
        ).fetchone()[0]
        assert ent_cnt == 1

    # Buyer A sees report in My Library and downloads full PDF via signed token and direct session
    lib_after = client.get("/api/v1/reports/my/library").json()
    assert lib_after["count"] == 1
    assert lib_after["items"][0]["report_id"] == rep_id
    assert lib_after["items"][0]["purchased_version"] == "v1.0"

    tok_res = client.post(f"/api/v1/reports/{rep_id}/download-token?version=v1.0")
    assert tok_res.status_code == 200
    buyer_a_token = tok_res.json()["token"]
    buyer_a_dl_url = tok_res.json()["download_url"]

    dl_res = client.get(buyer_a_dl_url)
    assert dl_res.status_code == 200
    assert dl_res.headers["content-type"].startswith("application/pdf")
    assert dl_res.headers.get("x-report-version") == "v1.0"
    assert dl_res.content.startswith(b"%PDF-1.4")
    v1_pdf_bytes = dl_res.content

    # Register User B (unauthorized account) and attempt to download using Buyer A's URL, report ID, and signed token
    client.post("/api/logout")
    _register_and_login(client, "intruder_b@example.com")

    assert client.get(f"/api/v1/reports/{rep_id}/download").status_code == 403
    assert client.get(f"/api/v1/reports/{rep_id}/download?version=v1.0").status_code == 403
    assert client.get(f"/api/v1/reports/{rep_id}/download?version=v1.0&token={buyer_a_token}").status_code == 403
    assert client.get(buyer_a_dl_url).status_code == 403
    assert client.post(f"/api/v1/reports/{rep_id}/download-token?version=v1.0").status_code == 403

    # Admin publishes a new version v2.0 of the same report with different PDF bytes
    client.post("/api/logout")
    _login_admin(client)
    v2_full_pdf = build_pdf_bytes(
        title="UPDATED V2.0 FULL REPORT",
        subtitle="Second Edition | XAUUSD (M15 / H1)",
        pages_lines=[["# V2 Section", "Completely updated V2 content."]],
    )
    up_v2 = client.post(
        f"/api/v1/admin/reports/{rep_id}/upload-pdf",
        data={"version": "v2.0", "changelog": "Major v2.0 update"},
        files={"full_pdf": ("full-v2.pdf", v2_full_pdf, "application/pdf")},
    )
    assert up_v2.status_code == 200
    pub_v2 = client.post(f"/api/v1/admin/reports/{rep_id}/publish", json={"version": "v2.0"})
    assert pub_v2.status_code == 200

    # Admin discontinues the report (stops new sales)
    disc_res = client.post(f"/api/v1/admin/reports/{rep_id}/discontinue")
    assert disc_res.status_code == 200
    assert disc_res.json()["status"] == "DISCONTINUED"

    # User B tries to purchase the discontinued report -> blocked with HTTP 400
    client.post("/api/logout")
    _register_and_login(client, "intruder_b@example.com")
    co_disc = client.post(f"/api/v1/reports/{rep_id}/checkout", json={"payment_method": "USDT"})
    assert co_disc.status_code == 400

    # Buyer A logs back in: even though report is DISCONTINUED and current_version is v2.0,
    # Buyer A can still download their purchased v1.0 PDF, and cannot download v2.0 without buying v2.0
    client.post("/api/logout")
    _register_and_login(client, "buyer_a@example.com")
    dl_v1_still_works = client.get(f"/api/v1/reports/{rep_id}/download")
    assert dl_v1_still_works.status_code == 200
    assert dl_v1_still_works.headers.get("x-report-version") == "v1.0"
    assert dl_v1_still_works.content == v1_pdf_bytes

    dl_v2_blocked = client.get(f"/api/v1/reports/{rep_id}/download?version=v2.0")
    assert dl_v2_blocked.status_code == 403

    # Admin refunds Buyer A's order -> download entitlement is revoked immediately
    client.post("/api/logout")
    _login_admin(client)
    ref_res = client.post(f"/api/v1/admin/orders/{order_id}/refund")
    assert ref_res.status_code == 200
    assert ref_res.json()["entitlement_revoked"] is True

    client.post("/api/logout")
    _register_and_login(client, "buyer_a@example.com")
    dl_after_refund = client.get(f"/api/v1/reports/{rep_id}/download")
    assert dl_after_refund.status_code == 403


def test_4_customer_auto_trading_and_background_dispatch_strictly_disabled(client, monkeypatch):
    """4. Customer cannot connect new MetaApi accounts, enable auto_trade, deploy/undeploy,
    or dispatch signals. Background workers (fanout, watcher, subscription lifecycle) never
    send new orders or close/modify existing positions when customer auto-trading is disabled."""
    monkeypatch.delenv("ENABLE_LEGACY_CUSTOMER_EXECUTION", raising=False)

    _register_and_login(client, "legacy_trader@example.com")

    # 1. Customer cannot connect a new MT5 account (route removed or forbidden)
    conn_res = client.post(
        "/api/v1/accounts",
        json={
            "mt5_login": "99887766",
            "mt5_password": "SecretPassword123!",
            "mt5_server": "ICMarketsSC-Demo",
        },
    )
    assert conn_res.status_code in (403, 404)

    # 2. Customer cannot turn on auto_trade via toggle or PATCH
    tog_on = client.post("/api/v1/accounts/acc_legacy_1/toggle", json={"is_active": True})
    assert tog_on.status_code in (403, 404)

    patch_on = client.patch("/api/v1/accounts/acc_legacy_1", json={"auto_trade": True})
    assert patch_on.status_code in (403, 404)

    # 3. Customer cannot deploy/undeploy or update broker credentials
    dep_res = client.post("/api/v1/accounts/cloud/acc_legacy_1/deploy", json={})
    assert dep_res.status_code in (403, 404)

    cred_res = client.post(
        "/api/v1/accounts/acc_legacy_1/update-credentials",
        json={"password": "NewPassword123!", "server": "Exness-MT5Real"},
    )
    assert cred_res.status_code in (403, 404)

    # 4. Direct signal dispatch endpoint rejects with 403 or 404
    disp_res = client.post(
        "/api/metaapi/dispatch-signal",
        json={
            "account_id": "meta_acc_legacy_1",
            "symbol": "XAUUSD",
            "action": "BUY",
            "volume": 0.1,
            "stop_loss": 2640.0,
            "take_profit": 2665.0,
        },
    )
    assert disp_res.status_code in (403, 404)

    # 5. Legacy routes return 404 (completely pruned from router tree)
    r_accs = client.get("/api/accounts")
    assert r_accs.status_code in (404, 405)

    r_ea = client.get("/api/ea/dispatches")
    assert r_ea.status_code in (404, 405)

    # 6. Legacy broker execution modules are completely purged from codebase
    import pytest
    with pytest.raises(ImportError):
        import app.domains.execution.fanout  # noqa: F401
    with pytest.raises(ImportError):
        import app.domains.execution.watcher  # noqa: F401
    with pytest.raises(ImportError):
        import app.domains.billing.subscription  # noqa: F401
    with pytest.raises(ImportError):
        import app.routers.accounts  # noqa: F401


def test_5_wfo_out_of_sample_session_h1_liquidity_and_insufficient_evidence():
    """5. Regression test for WFO out-of-sample verification:
    - Enforces preferred_session strictly (only scoring bars in London when preferred_session='London').
    - Enforces declared h1_trend and swept_liquidity conditions.
    - Returns insufficient_evidence (never defaulting H1 trend to NEUTRAL) when < 16 bars or timestamps missing."""
    # Case A: Fewer than 16 bars -> cannot determine H1 trend -> must return UNKNOWN & insufficient_evidence
    short_bars = [
        {"open": 2650.0 + i, "high": 2652.0 + i, "low": 2649.0 + i, "close": 2651.0 + i, "time": 1700000000 + i * 900}
        for i in range(12)
    ]
    short_eval = evaluate_candidate_window_detailed(
        short_bars,
        {"action": "BUY", "preferred_session": "London", "h1_trend": "NEUTRAL"},
    )
    assert short_eval["insufficient_evidence"] is True
    assert short_eval["h1_trend_state"] == "UNKNOWN"
    assert short_eval["returns"] == []

    wfo_short = walk_forward(
        short_bars,
        candidate={"id": "cand_short", "name": "ShortCand", "rules": {"action": "BUY", "h1_trend": "BULLISH"}},
    )
    assert wfo_short["status"] == "insufficient_evidence"
    assert wfo_short["insufficient_evidence"] is True
    assert wfo_short["h1_trend_state"] == "UNKNOWN"
    assert wfo_short["production_qualified"] is False

    # Case B: Construct a 60-bar series with strong upward slope in BOTH Asia (02:00 UTC) and London (09:00 UTC)
    # 1700013600 = 2023-11-15 02:00:00 UTC (Asia session)
    # 1700038800 = 2023-11-15 09:00:00 UTC (London session)
    asia_bars = []
    for i in range(40):
        # All timestamps in Asia session (01:00 - 06:00 UTC)
        ts = 1700010000 + (i % 20) * 900
        p = 2600.0 + i * 1.5
        asia_bars.append({"open": p, "high": p + 4.0, "low": p - 1.0, "close": p + 1.2, "time": ts, "session": "Asia"})

    # Evaluating a London-only candidate on Asia-only bars must produce 0 trades!
    pnl_ldn_on_asia, rets_ldn_on_asia = score_candidate_on_window(
        asia_bars,
        {"action": "BUY", "preferred_session": "London", "min_slope": 0.15, "sl_points": 5.0, "tp_points": 10.0},
    )
    assert len(rets_ldn_on_asia) == 0
    assert pnl_ldn_on_asia == 0.0

    # Evaluating an Asia-preferred candidate on the exact same Asia bars produces trades!
    det_asia = evaluate_candidate_window_detailed(
        asia_bars,
        {
            "action": "BUY",
            "preferred_session": "Asia",
            "h1_trend": "BULLISH",
            "min_slope": 0.15,
            "sl_points": 5.0,
            "tp_points": 10.0,
        },
    )
    assert det_asia["insufficient_evidence"] is False
    assert len(det_asia["returns"]) > 0
    assert "Asia" in det_asia["session_breakdown"]
    assert det_asia["session_breakdown"]["Asia"]["trades"] == len(det_asia["returns"])

    # Evaluating with mismatched H1 trend (requiring BEARISH on a strictly BULLISH series) produces 0 trades
    det_wrong_h1 = evaluate_candidate_window_detailed(
        asia_bars,
        {
            "action": "BUY",
            "preferred_session": "Asia",
            "h1_trend": "BEARISH",
            "min_slope": 0.15,
            "sl_points": 5.0,
            "tp_points": 10.0,
        },
    )
    assert len(det_wrong_h1["returns"]) == 0

    # In asia_bars, cur_h (p+4.0) pierces prior swing_high (p+2.5) and closes inside (p+1.2), so swept_liquidity is True:
    det_req_sweep_true = evaluate_candidate_window_detailed(
        asia_bars,
        {
            "action": "BUY",
            "preferred_session": "Asia",
            "swept_liquidity": True,
            "min_slope": 0.15,
            "sl_points": 5.0,
            "tp_points": 10.0,
        },
    )
    assert len(det_req_sweep_true["returns"]) > 0

    # Requiring swept_liquidity=False on those sweep bars produces 0 trades:
    det_req_sweep_false = evaluate_candidate_window_detailed(
        asia_bars,
        {
            "action": "BUY",
            "preferred_session": "Asia",
            "swept_liquidity": False,
            "min_slope": 0.15,
            "sl_points": 5.0,
            "tp_points": 10.0,
        },
    )
    assert len(det_req_sweep_false["returns"]) == 0

    # And requiring swept_liquidity=True on close-only bars without OHLC high/low returns insufficient_evidence:
    close_only_bars = [2600.0 + i * 1.5 for i in range(40)]
    det_missing_ohlc = evaluate_candidate_window_detailed(
        close_only_bars,
        {
            "action": "BUY",
            "swept_liquidity": True,
            "min_slope": 0.15,
            "sl_points": 5.0,
            "tp_points": 10.0,
        },
    )
    assert det_missing_ohlc["insufficient_evidence"] is True
    assert len(det_missing_ohlc["returns"]) == 0
