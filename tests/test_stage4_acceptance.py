"""Stage 4: Institutional Acceptance, Determinism, and Access Control Verification.

Validates:
1. Determinism Proof: Two research runs on identical inputs yield bit-for-bit identical ledger, metrics, and dataset hashes.
2. End-to-End Lifecycle: Agent generates DRAFT -> Admin reviews & publishes -> Client A granted trial -> Downloads v1.0 -> Hash matches manifest.
3. Access Isolation: Unauthorized Client B is rejected (403/Forbidden).
4. Version Immutability: When v2.0 is published, Client A retains exact v1.0 files and manifest hash without modification.
5. Verification of Replay on Sample & Alternative Data.
"""
import hashlib
import json
import time
from pathlib import Path
import pytest
from app import db
from app.domains.quant.studies import run_studies, generate_ledger_csv, rule_backtest
from app.domains.quant.data_feed import compute_candles_sha256, build_dataset_identity
from app.domains.reports.service import (
    create_admin_report_draft,
    publish_admin_report,
    verify_user_report_download_access,
    grant_report_entitlement_tx,
)
from app.domains.reports.pdf_builder import build_pdf_bytes
from cli.replay import parse_candle_file, run_standalone_replay


def _login_admin(client):
    res = client.post(
        "/api/login",
        json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"},
    )
    assert res.status_code == 200
    return res


def test_stage4_1_determinism_proof():
    """Verify bit-for-bit determinism across two independent runs on the same candles, config, and seed."""
    sample_path = Path("data/samples/comex_gold_m15_sample.csv")
    candles, meta = parse_candle_file(sample_path)
    assert len(candles) >= 100

    # Run 1
    ds1 = build_dataset_identity("GC=F", "M15", candles)
    bundle1 = run_studies(candles, symbol="GC=F", timeframe="M15")
    csv1 = bundle1["ledger_csv"]

    # Run 2
    ds2 = build_dataset_identity("GC=F", "M15", candles)
    bundle2 = run_studies(candles, symbol="GC=F", timeframe="M15")
    csv2 = bundle2["ledger_csv"]

    # Identical dataset SHA-256 and identity
    assert ds1.data_sha256 == ds2.data_sha256
    assert ds1.data_version_id == ds2.data_version_id

    # Identical transaction ledgers
    assert csv1 == csv2
    assert hashlib.sha256(csv1.encode("utf-8")).hexdigest() == hashlib.sha256(csv2.encode("utf-8")).hexdigest()

    # Identical top-level and split metrics
    assert bundle1["monte_carlo"] == bundle2["monte_carlo"]
    assert bundle1["cost_stress_matrix"] == bundle2["cost_stress_matrix"]
    assert bundle1["studies"] == bundle2["studies"]


def test_stage4_2_lifecycle_access_isolation_and_version_immutability(client, tmp_path):
    """End-to-End: Admin publishes v1.0 -> Client A granted trial -> Client B unauthorized -> v2.0 published -> Client A keeps v1.0 intact."""
    _login_admin(client)

    # 1. Create Report Draft
    now_ts = time.time()
    rep = create_admin_report_draft(
        title="Acceptance Suite Gold M15",
        summary="Gold Breakout Acceptance Test Report",
        description="Point-in-time Asia Range Breakout & Retest",
        market="COMEX Gold Futures (GC=F)",
        price_usd=10000.0,
    )
    rep_id = rep["id"]

    # Generate Dummy PDF files for v1.0
    pdf_v1_full = tmp_path / "v1_full.pdf"
    pdf_v1_sample = tmp_path / "v1_sample.pdf"
    pdf_v1_full.write_bytes(b"%PDF-1.4 Acceptance Test v1.0 Full Content")
    pdf_v1_sample.write_bytes(b"%PDF-1.4 Acceptance Test v1.0 Sample Content")
    v1_full_hash = hashlib.sha256(pdf_v1_full.read_bytes()).hexdigest()

    with db.tx() as c:
        c.execute(
            "UPDATE research_reports SET full_pdf_path = ?, sample_pdf_path = ?, version = 'v1.0' WHERE id = ?",
            (str(pdf_v1_full), str(pdf_v1_sample), rep_id),
        )

    # 2. Human Admin officially publishes v1.0
    pub_v1 = publish_admin_report(
        rep_id,
        version="v1.0",
        changelog="v1.0 initial institutional release",
        is_human_admin=True,
    )
    assert pub_v1["status"] == "PUBLISHED"
    assert pub_v1["version"] == "v1.0"

    # Verify manifest hashes in DB for v1.0
    with db.tx() as c:
        v1_row = c.execute("SELECT manifest_json, file_hashes_json FROM report_versions WHERE report_id = ? AND version = 'v1.0'", (rep_id,)).fetchone()
        assert v1_row is not None
        v1_hashes = json.loads(v1_row[1])
        assert v1_hashes.get("full_pdf") == v1_full_hash

    # 3. Register Client A and Client B
    email_a = f"client_a_{int(now_ts)}@inst.com"
    email_b = f"client_b_{int(now_ts)}@inst.com"
    r_reg_a = client.post("/api/register", json={"email": email_a, "password": "SecurePassword123!"})
    r_reg_b = client.post("/api/register", json={"email": email_b, "password": "SecurePassword123!"})
    assert r_reg_a.status_code == 200
    assert r_reg_b.status_code == 200

    with db.tx() as c:
        uid_a = str(c.execute("SELECT id FROM users WHERE email = ?", (email_a,)).fetchone()[0])
        uid_b = str(c.execute("SELECT id FROM users WHERE email = ?", (email_b,)).fetchone()[0])

    # 4. Admin grants trial entitlement strictly to Client A
    _login_admin(client)
    res_grant = client.post(
        f"/api/v1/admin/reports/{rep_id}/entitlements/grant-trial",
        json={"email": email_a, "version": "v1.0", "notes": "Approved Institutional Trial for Team A"},
    )
    assert res_grant.status_code == 200
    assert res_grant.json()["ok"] is True

    # 5. Verify Client A has access to v1.0
    dl_path, dl_name, dl_ver = verify_user_report_download_access(
        user_id=uid_a,
        user_role="customer",
        report_id=rep_id,
        version="v1.0",
    )
    assert dl_ver == "v1.0"
    assert dl_path.is_file()
    assert hashlib.sha256(dl_path.read_bytes()).hexdigest() == v1_full_hash

    # 6. Verify Client B is strictly rejected (Access Isolation)
    with pytest.raises(PermissionError) as exc_b:
        verify_user_report_download_access(
            user_id=uid_b,
            user_role="customer",
            report_id=rep_id,
            version="v1.0",
        )
    assert "chưa có quyền tải" in str(exc_b.value)

    # 7. Admin updates and publishes v2.0 with new PDF content
    pdf_v2_full = tmp_path / "v2_full.pdf"
    pdf_v2_sample = tmp_path / "v2_sample.pdf"
    pdf_v2_full.write_bytes(b"%PDF-1.4 Acceptance Test v2.0 Full Content -- Modified Strategy")
    pdf_v2_sample.write_bytes(b"%PDF-1.4 Acceptance Test v2.0 Sample Content -- Modified Strategy")
    v2_full_hash = hashlib.sha256(pdf_v2_full.read_bytes()).hexdigest()

    with db.tx() as c:
        c.execute(
            "UPDATE research_reports SET full_pdf_path = ?, sample_pdf_path = ?, version = 'v2.0' WHERE id = ?",
            (str(pdf_v2_full), str(pdf_v2_sample), rep_id),
        )

    pub_v2 = publish_admin_report(
        rep_id,
        version="v2.0",
        changelog="v2.0 upgraded parameter set",
        is_human_admin=True,
    )
    assert pub_v2["version"] == "v2.0"

    # 8. Immutability Lock Verification: Client A (licensed for v1.0) still downloads exact v1.0 files
    dl_path_after, _, ver_after = verify_user_report_download_access(
        user_id=uid_a,
        user_role="customer",
        report_id=rep_id,
        version="v1.0",
    )
    assert ver_after == "v1.0"
    assert hashlib.sha256(dl_path_after.read_bytes()).hexdigest() == v1_full_hash

    # Verify report_versions still stores unmodified v1.0 hash
    with db.tx() as c:
        v1_row_check = c.execute("SELECT file_hashes_json FROM report_versions WHERE report_id = ? AND version = 'v1.0'", (rep_id,)).fetchone()
        assert json.loads(v1_row_check[0])["full_pdf"] == v1_full_hash
        v2_row_check = c.execute("SELECT file_hashes_json FROM report_versions WHERE report_id = ? AND version = 'v2.0'", (rep_id,)).fetchone()
        assert json.loads(v2_row_check[0])["full_pdf"] == v2_full_hash


def test_stage4_3_replay_on_sample_and_alternative_datasets(tmp_path):
    """Verify that replay works on sample data and on a distinct alternative dataset."""
    sample_path = Path("data/samples/comex_gold_m15_sample.csv")
    candles_1, _ = parse_candle_file(sample_path)
    res_sample = run_standalone_replay(candles_1)
    assert res_sample["total_candles"] >= 100
    out_ledger_1 = tmp_path / "sample_ledger.csv"
    out_ledger_1.write_text(res_sample["ledger_csv"], encoding="utf-8")
    assert out_ledger_1.is_file()

    # Create alternative dataset (slice of 200 candles with different price scaling)
    candles = candles_1[:200]
    alt_file = tmp_path / "alt_dataset.csv"
    with open(alt_file, "w", encoding="utf-8") as f:
        f.write("time,open,high,low,close,volume\n")
        for c in candles:
            # Shift prices by +50.0
            f.write(f"{c.time},{c.open+50.0},{c.high+50.0},{c.low+50.0},{c.close+50.0},{c.volume}\n")

    candles_2, _ = parse_candle_file(alt_file)
    res_alt = run_standalone_replay(candles_2)
    assert res_alt["total_candles"] == 200
    out_ledger_2 = tmp_path / "alt_ledger.csv"
    out_ledger_2.write_text(res_alt["ledger_csv"], encoding="utf-8")
    assert out_ledger_2.is_file()

    # Both produced valid, verifiable ledger files
    with open(out_ledger_1, "r", encoding="utf-8") as f1, open(out_ledger_2, "r", encoding="utf-8") as f2:
        content1 = f1.read()
        content2 = f2.read()
        assert "trade_id,day,split_set,side,session,entry_time_utc" in content1
        assert "trade_id,day,split_set,side,session,entry_time_utc" in content2
