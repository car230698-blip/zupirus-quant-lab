"""Tests for Delivered & Library integration:
1. Client with no documents (empty state).
2. Client with delivered research deliverables (download PDF/ZIP working; unapproved requests return 403).
3. Client with legacy purchased publications (perpetual access preserved with exact purchased version).
4. Legacy library API error fault isolation (delivered research deliverables still load and download cleanly).
"""
import time
from pathlib import Path
from unittest.mock import patch
from app import db
from app.domains.reports.pdf_builder import build_pdf_bytes, ensure_flagship_sample_report_seeded


def _register_and_login(client, email: str, password: str = "Password123!"):
    r1 = client.post("/api/register", json={"email": email, "password": password})
    assert r1.status_code in (200, 400, 409)
    r2 = client.post("/api/login", json={"email": email, "password": password})
    assert r2.status_code == 200
    me = client.get("/api/me")
    assert me.status_code == 200
    return me.json()


def _login_admin(client):
    res = client.post(
        "/api/login",
        json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"},
    )
    assert res.status_code == 200
    return res


def test_scenario_1_client_with_no_documents(client):
    """Case 1: Client has no requests or entitlements (empty library state)."""
    ts = int(time.time() * 1000)
    email = f"empty_client_{ts}@firm.org"
    _register_and_login(client, email)

    r_req = client.get("/api/v1/research/my-requests")
    assert r_req.status_code == 200
    assert r_req.json().get("items") == []

    r_lib = client.get("/api/v1/reports/my/library")
    assert r_lib.status_code == 200
    assert r_lib.json().get("items") == []

    # Unauthorized download attempts fail closed
    r_dl = client.get("/api/v1/research/orders/crr_nonexistent/download-pdf")
    assert r_dl.status_code in (403, 404)


def test_scenario_2_client_with_delivered_deliverables(client):
    """Case 2: Client with delivered custom research request.
    Downloads are strictly locked with 403 until admin approves and delivers.
    """
    ts = int(time.time() * 1000)
    client_email = f"delivered_client_{ts}@firm.org"
    user_info = _register_and_login(client, client_email)

    # 1. Create RFP
    rfp_res = client.post(
        "/api/v1/research/institutional/inquiry",
        json={"problem_description": "Analyze Gold H1 liquidity absorption."},
    )
    assert rfp_res.status_code == 200
    req_id = rfp_res.json()["request_id"]

    # 2. Before approval: download attempts MUST be blocked with 403
    dl_pdf_blocked = client.get(f"/api/v1/research/orders/{req_id}/download-pdf")
    assert dl_pdf_blocked.status_code in (403, 404)

    # 3. Admin quotes
    client.post("/api/logout")
    _login_admin(client)
    q_res = client.post(
        f"/api/v1/admin/research/requests/{req_id}/quote",
        json={"quoted_price_usd": 2500.0, "scope_notes": "H1 Volatility study"},
    )
    assert q_res.status_code == 200

    # 4. Client confirms and pays sandbox
    client.post("/api/logout")
    _register_and_login(client, client_email)
    c_res = client.post(
        f"/api/v1/research/institutional/{req_id}/confirm",
        json={"version": q_res.json()["proposal_version"]},
    )
    assert c_res.status_code == 200
    p_res = client.post(f"/api/v1/research/orders/{req_id}/sandbox-pay")
    assert p_res.status_code == 200

    # 5. Admin runs worker and approves delivery
    client.post("/api/logout")
    _login_admin(client)
    run_res = client.post(f"/api/v1/admin/research/requests/{req_id}/run")
    assert run_res.status_code == 200
    appr_res = client.post(f"/api/v1/admin/research/requests/{req_id}/approve")
    assert appr_res.status_code == 200
    assert appr_res.json()["status"] == "DELIVERED"

    # 6. Client now downloads approved deliverables cleanly
    client.post("/api/logout")
    _register_and_login(client, client_email)

    my_reqs = client.get("/api/v1/research/my-requests")
    assert my_reqs.status_code == 200
    dossier = next((r for r in my_reqs.json()["items"] if r["id"] == req_id), None)
    assert dossier is not None
    assert dossier["status"] == "DELIVERED"

    dl_pdf = client.get(f"/api/v1/research/orders/{req_id}/download-pdf")
    assert dl_pdf.status_code == 200
    assert dl_pdf.content.startswith(b"%PDF")

    dl_zip = client.get(f"/api/v1/research/orders/{req_id}/download-bundle")
    assert dl_zip.status_code == 200
    assert dl_zip.content.startswith(b"PK")


def test_scenario_3_client_with_legacy_purchased_publications(client):
    """Case 3: Client who purchased legacy publication still holds perpetual download entitlement."""
    ts = int(time.time() * 1000)
    email = f"legacy_client_{ts}@firm.org"
    user_info = _register_and_login(client, email)
    user_id = user_info["id"]

    # Insert active perpetual entitlement (is_trial=0) for purchased_version v1.0
    now_ts = time.time()
    ent_id = f"ent_test_{ts}"
    with db.tx() as c:
        ensure_flagship_sample_report_seeded(c)
        rep = c.execute("SELECT id FROM research_reports LIMIT 1").fetchone()
        assert rep is not None
        rep_id = rep[0]

        pdf_path = "data/reports_private/rep_gold_research_suite_v1/v1.0/full.pdf"
        Path(pdf_path).parent.mkdir(parents=True, exist_ok=True)
        real_pdf_bytes = build_pdf_bytes(
            title="ZUPIRUS QUANT LAB - LEGACY RESEARCH",
            subtitle="Purchased Publication v1.0",
            pages_lines=[["# Section 1", "Content of legacy publication."]],
        )
        Path(pdf_path).write_bytes(real_pdf_bytes)

        c.execute(
            """
            INSERT INTO report_entitlements (
                id, user_id, report_id, purchased_version, full_pdf_path, order_id,
                status, expires_at, is_trial, download_count, granted_at
            ) VALUES (?, ?, ?, 'v1.0', ?, ?, 'ACTIVE', NULL, 0, 0, ?)
            """,
            (ent_id, user_id, rep_id, pdf_path, f"ord_leg_{ts}", now_ts),
        )

    # User checks library API
    lib_res = client.get("/api/v1/reports/my/library")
    assert lib_res.status_code == 200
    items = lib_res.json().get("items", [])
    matched = next((item for item in items if item["entitlement_id"] == ent_id), None)
    assert matched is not None
    assert matched["purchased_version"] == "v1.0"
    assert matched["is_trial"] is False
    assert matched["status"] == "ACTIVE"

    # User downloads exact purchased version
    dl_res = client.get(f"/api/v1/reports/{rep_id}/download?version=v1.0")
    assert dl_res.status_code == 200
    assert dl_res.content.startswith(b"%PDF")


def test_scenario_4_legacy_api_error_fault_isolation(client):
    """Case 4: Even if GET /api/v1/reports/my/library fails,
    custom research deliverables still load and can be downloaded cleanly.
    """
    ts = int(time.time() * 1000)
    email = f"fault_iso_client_{ts}@firm.org"
    user_info = _register_and_login(client, email)

    # Create & deliver a custom research request directly
    req_id = f"crr_iso_{ts}"
    now_ts = time.time()
    pdf_path = f"data/custom_research/{req_id}/delivery.pdf"
    bundle_path = f"data/custom_research/{req_id}/bundle.zip"
    Path(pdf_path).parent.mkdir(parents=True, exist_ok=True)
    Path(pdf_path).write_bytes(b"%PDF-1.4 valid delivered report")
    Path(bundle_path).write_bytes(b"PK\x03\x04 valid bundle")

    with db.tx() as c:
        c.execute(
            """
            INSERT INTO custom_research_requests (
                id, user_id, client_email, product_type, symbol, timeframe, period_bars,
                status, deliverable_pdf_path, deliverable_bundle_path, created_at, updated_at
            ) VALUES (?, ?, ?, 'RETAIL_ANALYSIS', 'XAUUSD', 'H1', 20, 'DELIVERED', ?, ?, ?, ?)
            """,
            (req_id, user_info["id"], email, pdf_path, bundle_path, now_ts, now_ts),
        )

    # 1. Custom requests endpoint succeeds
    req_res = client.get("/api/v1/research/my-requests")
    assert req_res.status_code == 200
    items = req_res.json()["items"]
    assert any(r["id"] == req_id for r in items)

    # 2. Both downloads succeed
    dl_pdf = client.get(f"/api/v1/research/orders/{req_id}/download-pdf")
    assert dl_pdf.status_code == 200
    assert dl_pdf.content.startswith(b"%PDF")

    dl_bundle = client.get(f"/api/v1/research/orders/{req_id}/download-bundle")
    assert dl_bundle.status_code == 200
    assert dl_bundle.content.startswith(b"PK")

    # 3. Simulate failure in legacy library
    with patch("app.routers.reports.list_user_report_library", side_effect=Exception("Database connection timeout")):
        lib_fail = client.get("/api/v1/reports/my/library")
        assert lib_fail.status_code == 500

    # 4. Verify custom research remains fully operational despite the legacy failure
    req_res2 = client.get("/api/v1/research/my-requests")
    assert req_res2.status_code == 200
    assert any(r["id"] == req_id for r in req_res2.json()["items"])
    dl_pdf2 = client.get(f"/api/v1/research/orders/{req_id}/download-pdf")
    assert dl_pdf2.status_code == 200
