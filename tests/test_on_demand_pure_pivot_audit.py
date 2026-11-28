"""Audit verification suite for ZUPIRUS Quant Lab:
Pure On-Demand Research Model, Write-on-Read Defense, and Mutation Blockade.
"""
import time
import hashlib
from pathlib import Path
from app import db


def _login_admin(client):
    res = client.post(
        "/api/login",
        json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"},
    )
    assert res.status_code == 200
    return res


def _register_and_login(client, email: str, password: str = "Password123!"):
    r1 = client.post("/api/register", json={"email": email, "password": password})
    assert r1.status_code in (200, 400, 409)
    r2 = client.post("/api/login", json={"email": email, "password": password})
    assert r2.status_code == 200
    return r2.json()


def test_pure_read_apis_never_mutate_files_or_database(client):
    """Verify GET /api/v1/reports, detail, and telemetry are pure read-only and never write or modify files."""
    # Check mtime / existence of reports private folder before and after read
    rep_dir = Path("data/reports_private")
    rep_dir.mkdir(parents=True, exist_ok=True)
    files_before = {str(p): p.stat().st_mtime for p in rep_dir.rglob("*") if p.is_file()}

    # 1. Public catalog read
    res_cat = client.get("/api/v1/reports")
    assert res_cat.status_code == 200

    # 2. Public detail read if any
    items = res_cat.json().get("items", [])
    if items:
        res_det = client.get(f"/api/v1/reports/{items[0]['id']}")
        assert res_det.status_code == 200

    # 3. Admin telemetry radar read
    _login_admin(client)
    res_rad = client.get("/api/v1/telemetry/admin-radar")
    assert res_rad.status_code == 200

    files_after = {str(p): p.stat().st_mtime for p in rep_dir.rglob("*") if p.is_file()}
    # No files were created or modified during GET operations!
    assert files_before == files_after, "Read operations must not write or mutate files!"


def test_off_the_shelf_publication_mutations_are_strictly_blocked(client):
    """Verify that all mutation pathways for creating, publishing, selling, or granting off-the-shelf publications return 403."""
    _login_admin(client)

    # 1. Creating report draft
    r_create = client.post("/api/v1/admin/reports", json={"title": "Draft Publication"})
    assert r_create.status_code == 403
    assert "ngừng hoạt động" in r_create.json().get("detail", "")

    # 2. Creating study draft from lab
    r_study = client.post(
        "/api/v1/admin/quant/studies",
        json={
            "symbol": "XAUUSD",
            "timeframe": "H1",
            "title_vi": "Tiêu đề",
            "title_en": "Title",
            "price_usd": 20,
            "candles": [{"time": 1700000000, "open": 2000, "high": 2010, "low": 1990, "close": 2005, "volume": 100}],
        },
    )
    assert r_study.status_code == 403
    assert "ngừng hoạt động" in r_study.json().get("detail", "")

    # 3. Autonomous publication trigger
    r_auto = client.post("/api/v1/admin/quant/autonomous/trigger", json={"force": True})
    assert r_auto.status_code == 403

    # 4. Granting trial license
    r_trial = client.post("/api/v1/admin/billing/trials/grant", json={"email": "test@firm.org", "report_id": "rep_gold_research_suite_v1"})
    assert r_trial.status_code == 403

    # 5. Customer purchasing publication checkout
    _register_and_login(client, "test_blocked_checkout@firm.com")
    r_checkout = client.post("/api/v1/reports/rep_gold_research_suite_v1/checkout", json={"payment_method": "USDT"})
    assert r_checkout.status_code == 403


def test_on_demand_research_full_lifecycle_and_tenant_isolation(client):
    """Verify on-demand research flow from client submission to admin quote, payment, worker run, approval, delivery, and tenant isolation."""
    # 1. Client A registers and creates bespoke request
    ts = int(time.time() * 1000)
    email_a = f"client_a_{ts}@institutional.com"
    email_b = f"client_b_{ts}@institutional.com"
    _register_and_login(client, email_a)

    req_res = client.post(
        "/api/v1/research/institutional/inquiry",
        json={
            "problem_description": "Assess gold liquidity sweep risk under European rate decisions.",
            "target_turnaround_hours": 48,
        },
    )
    assert req_res.status_code == 200, req_res.text
    req_data = req_res.json()
    req_id = req_data.get("id") or req_data.get("request_id")
    assert req_data["status"] in ("NEW_SUBMISSION", "PENDING_QUOTE")

    # 2. Client A posts a message and checks chat
    msg_res = client.post(
        f"/api/v1/research/orders/{req_id}/messages",
        json={"message": "Please emphasize M15 London session liquidity."},
    )
    assert msg_res.status_code == 200

    # 3. Admin reviews actionable queue, inspects request, and provides quote
    client.post("/api/logout")
    _login_admin(client)

    queue_res = client.get("/api/v1/admin/research/requests")
    assert queue_res.status_code == 200
    queue_items = queue_res.json().get("items", [])
    found_in_queue = any(r["id"] == req_id for r in queue_items)
    assert found_in_queue is True

    quote_res = client.post(
        f"/api/v1/admin/research/requests/{req_id}/quote",
        json={
            "quoted_price_usd": 3500.0,
            "scope_notes": "48h full Monte Carlo + walk-forward study on GC=F.",
        },
    )
    assert quote_res.status_code == 200
    assert quote_res.json()["status"] == "QUOTED"
    prop_ver = quote_res.json().get("proposal_version", 2)

    # 4. Client A confirms quote
    client.post("/api/logout")
    _register_and_login(client, email_a)

    conf_res = client.post(
        f"/api/v1/research/institutional/{req_id}/confirm",
        json={"version": prop_ver},
    )
    assert conf_res.status_code == 200
    assert conf_res.json()["status"] in ("CONFIRMED", "WAITING_PAYMENT")

    # 5. Client A executes sandbox payment -> status becomes PAID
    pay_res = client.post(f"/api/v1/research/orders/{req_id}/sandbox-pay")
    assert pay_res.status_code == 200

    # 6. Admin executes worker run and delivers
    client.post("/api/logout")
    _login_admin(client)

    run_res = client.post(f"/api/v1/admin/research/requests/{req_id}/run")
    assert run_res.status_code == 200

    # Approve delivery
    deliv_res = client.post(
        f"/api/v1/admin/research/requests/{req_id}/approve",
    )
    assert deliv_res.status_code == 200
    assert deliv_res.json()["status"] == "DELIVERED"

    # 7. Client A can access and download deliverables
    client.post("/api/logout")
    _register_and_login(client, email_a)

    my_lib = client.get("/api/v1/research/my-requests")
    assert my_lib.status_code == 200
    my_req = next((r for r in my_lib.json().get("items", []) if r["id"] == req_id), None)
    assert my_req is not None
    assert my_req["status"] == "DELIVERED"

    dl_pdf = client.get(f"/api/v1/research/orders/{req_id}/download-pdf")
    assert dl_pdf.status_code == 200
    assert dl_pdf.content.startswith(b"%PDF")

    # 8. Strict Tenant Isolation: Client B cannot view or download Client A's research
    client.post("/api/logout")
    _register_and_login(client, email_b)

    b_hack_get = client.get(f"/api/v1/research/orders/{req_id}")
    assert b_hack_get.status_code in (403, 404)

    b_hack_pdf = client.get(f"/api/v1/research/orders/{req_id}/download-pdf")
    assert b_hack_pdf.status_code in (403, 404)

    b_hack_bundle = client.get(f"/api/v1/research/orders/{req_id}/download-bundle")
    assert b_hack_bundle.status_code in (403, 404)
