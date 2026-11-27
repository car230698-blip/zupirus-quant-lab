import json
import time
from pathlib import Path
import pytest
from app import db
from app.domains.reports.service import (
    list_admin_reports,
    get_public_report_detail,
    verify_user_report_download_access,
)
from cli.replay import parse_candle_file, run_standalone_replay


def _login_admin(client):
    res = client.post(
        "/api/login",
        json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"},
    )
    assert res.status_code == 200
    return res


def test_stage3_1_gold_research_suite_draft_package_seeded():
    """Stage 3.1: Gold Research Suite v1 is seeded as DRAFT with full/sample PDFs on disk and $10k advisory price."""
    reports = list_admin_reports()
    gold_rep = next((r for r in reports if r["id"] == "rep_gold_research_suite_v1"), None)
    assert gold_rep is not None
    assert gold_rep["status"] == "DRAFT"
    assert gold_rep["price_usd"] == 10000.0
    assert "COMEX Gold Futures" in gold_rep["market"]
    assert gold_rep["has_full_pdf"] is True
    assert gold_rep["has_sample_pdf"] is True

    # Check files on disk
    full_path = Path(gold_rep["full_pdf_path"])
    sample_path = Path(gold_rep["sample_pdf_path"])
    assert full_path.is_file()
    assert sample_path.is_file()
    assert full_path.read_bytes().startswith(b"%PDF-")


def test_stage3_2_standalone_replay_tool_execution():
    """Stage 3.2: Replay engine executes deterministically on sample candles and produces ledger CSV."""
    sample_csv = Path("data/samples/comex_gold_m15_sample.csv")
    assert sample_csv.is_file()

    candles, meta = parse_candle_file(sample_csv)
    assert len(candles) == 500
    assert meta["duplicate_timestamps_dropped"] == 0

    replay_res = run_standalone_replay(
        candles=candles,
        symbol="GC=F",
        timeframe="M15",
        spread_pips=3.5,
        slippage_pips=1.0,
    )
    assert replay_res["dataset_identity"]["asset_class"] == "COMEX_GOLD_FUTURES"
    assert replay_res["parameters"]["spread_pips"] == 3.5
    assert replay_res["parameters"]["slippage_pips"] == 1.0
    assert replay_res["summary"]["trades"] > 0
    assert len(replay_res["trades"]) == replay_res["summary"]["trades"]
    assert "tr_001" in replay_res["ledger_csv"]


def test_stage3_3_admin_grant_trial_and_user_access(client):
    """Stage 3.3: Admin can grant a trial license to a client account and client can access full PDF."""
    # Register trial customer first
    trial_email = f"trial_client_{int(time.time()*1000)}@firm.com"
    r_reg = client.post("/api/register", json={"email": trial_email, "password": "TrialPassword123!"})
    assert r_reg.status_code == 200, f"Registration failed: {r_reg.text}"

    # Login as admin to grant trial
    _login_admin(client)

    # Admin grants trial
    res_grant = client.post(
        "/api/v1/admin/reports/rep_gold_research_suite_v1/entitlements/grant-trial",
        json={"email": trial_email, "version": "v1.0", "notes": "Institutional Trial License"},
    )
    assert res_grant.status_code == 200, f"Grant failed: {res_grant.text}"
    grant_body = res_grant.json()
    assert grant_body["ok"] is True
    assert "trial_order_id" in grant_body

    # Client logs in and verifies access
    r_login = client.post("/api/login", json={"email": trial_email, "password": "TrialPassword123!"})
    assert r_login.status_code == 200
    with db.tx() as c:
        u_row = c.execute("SELECT id FROM users WHERE email = ?", (trial_email,)).fetchone()
        u_id = str(u_row[0])

    # Download access must succeed for this user on v1.0
    dl_res = verify_user_report_download_access(
        user_id=u_id,
        user_role="customer",
        report_id="rep_gold_research_suite_v1",
        version="v1.0",
    )
    pdf_path, filename, ver = dl_res
    assert ver == "v1.0"
    assert pdf_path.is_file()


def test_stage3_4_web_sandbox_replay_api(client):
    """Stage 3.4: Web sandbox replay endpoint POST /api/v1/admin/quant/replay returns valid report."""
    _login_admin(client)

    resp = client.post(
        "/api/v1/admin/quant/replay",
        json={
            "symbol": "GC=F",
            "timeframe": "M15",
            "spread_pips": 3.5,
            "slippage_pips": 1.0,
            "use_sample_candles": True,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "dataset_identity" in body
    assert body["dataset_identity"]["symbol"] == "GC=F"
    assert "summary" in body
    assert body["summary"]["trades"] > 0
    assert "ledger_csv" in body
