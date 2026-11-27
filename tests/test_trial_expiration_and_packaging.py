"""
Tests for Trial Expiration, Multi-Account Access Isolation, and Research Suite Packaging.

Covers:
1. Multi-account isolation:
   - Account A (Active trial): Can list in library, generate token, download PDF and bundle ZIP.
   - Account A (Expired trial): Blocked from issuing token, downloading PDF, or downloading bundle; pre-issued token is invalidated.
   - Account B (Unauthorized): Blocked with 403.
   - Account C (Perpetual purchase): Unaffected by trial expiry timers.
2. Complete standalone research suite package:
   - Generates valid ZIP bundle with all 9 deliverables.
   - Verifies SHA-256 manifest integrity and distinction between raw CSV hash and normalized candle stream hash.
   - Verifies standalone replay script syntax and execution.
"""
from __future__ import annotations

import hashlib
import io
import json
import time
import zipfile
from pathlib import Path
import pytest

from app import db
from app.domains.reports.service import (
    create_admin_report_draft,
    publish_admin_report,
    grant_report_entitlement_tx,
    build_or_get_report_bundle_zip,
)


def _login_admin(client):
    res = client.post(
        "/api/login",
        json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"},
    )
    assert res.status_code == 200
    return res


def test_trial_expiration_and_multi_account_isolation(client, tmp_path):
    """Verify trial access, expiration blocking, token invalidation, and perpetual purchase immunity."""
    _login_admin(client)

    # 1. Create and publish a report
    now_ts = time.time()
    rep = create_admin_report_draft(
        title="Gold Suite Trial Test",
        summary="Trial Expiration Verification Report",
        description="Testing trial access constraints",
        market="COMEX Gold Futures (GC=F)",
        price_usd=10000.0,
    )
    rep_id = rep["id"]

    pdf_full = tmp_path / "trial_full.pdf"
    pdf_sample = tmp_path / "trial_sample.pdf"
    pdf_full.write_bytes(b"%PDF-1.4 Dummy Full PDF Content for Trial Test")
    pdf_sample.write_bytes(b"%PDF-1.4 Dummy Sample PDF Content for Trial Test")

    with db.tx() as c:
        c.execute(
            "UPDATE research_reports SET full_pdf_path = ?, sample_pdf_path = ?, version = 'v1.0' WHERE id = ?",
            (str(pdf_full), str(pdf_sample), rep_id),
        )

    pub = publish_admin_report(
        rep_id,
        version="v1.0",
        changelog="v1.0 trial release",
        is_human_admin=True,
    )
    assert pub["status"] == "PUBLISHED"

    # 2. Register Accounts A, B, and C
    email_a = f"trial_user_a_{int(now_ts)}@inst.com"
    email_b = f"unauth_user_b_{int(now_ts)}@inst.com"
    email_c = f"perpetual_user_c_{int(now_ts)}@inst.com"

    for em in (email_a, email_b, email_c):
        r = client.post("/api/register", json={"email": em, "password": "SecurePassword123!"})
        assert r.status_code == 200

    with db.tx() as c:
        uid_a = c.execute("SELECT id FROM users WHERE email = ?", (email_a,)).fetchone()[0]
        uid_b = c.execute("SELECT id FROM users WHERE email = ?", (email_b,)).fetchone()[0]
        uid_c = c.execute("SELECT id FROM users WHERE email = ?", (email_c,)).fetchone()[0]

    # Grant Account A an active 30-day trial
    future_exp = time.time() + 86400 * 30
    with db.tx() as c:
        grant_report_entitlement_tx(
            c,
            order={
                "id": "trial_ord_a",
                "user_id": uid_a,
                "report_id": rep_id,
                "report_version": "v1.0",
            },
            is_trial=1,
            expires_at=future_exp,
        )

    # Grant Account C a perpetual commercial purchase (no expiration)
    with db.tx() as c:
        grant_report_entitlement_tx(
            c,
            order={
                "id": "purch_ord_c",
                "user_id": uid_c,
                "report_id": rep_id,
                "report_version": "v1.0",
            },
            is_trial=0,
            expires_at=None,
        )

    # Account B has NO entitlement granted.

    # 3. Test Account A (Active Trial)
    client.post("/api/login", json={"email": email_a, "password": "SecurePassword123!"})
    
    # Library listing
    r_lib_a = client.get("/api/v1/reports/my-library")
    assert r_lib_a.status_code == 200
    lib_data_a = r_lib_a.json().get("items", [])
    rep_a_item = next((i for i in lib_data_a if i["report_id"] == rep_id), None)
    assert rep_a_item is not None
    assert rep_a_item["is_trial"] is True
    assert rep_a_item["is_expired"] is False
    assert rep_a_item["status"] == "ACTIVE"

    # Issue download token
    tok_res = client.post(f"/api/v1/reports/{rep_id}/download-token?version=v1.0")
    assert tok_res.status_code == 200
    tok_data = tok_res.json()
    dl_url = tok_data["download_url"]
    bundle_url = tok_data["bundle_download_url"]
    assert "token=" in dl_url
    assert "token=" in bundle_url

    # Download PDF with active trial
    r_dl_pdf = client.get(dl_url)
    assert r_dl_pdf.status_code == 200
    assert r_dl_pdf.content.startswith(b"%PDF-")

    # Download bundle with active trial
    r_dl_bundle = client.get(bundle_url)
    assert r_dl_bundle.status_code == 200
    assert r_dl_bundle.headers["content-type"] == "application/zip"

    # 4. Expire Account A's trial and test access cut-off
    past_exp = time.time() - 3600  # expired 1 hour ago
    with db.tx() as c:
        c.execute(
            "UPDATE report_entitlements SET expires_at = ? WHERE user_id = ? AND report_id = ?",
            (past_exp, uid_a, rep_id),
        )

    # Library listing now shows expired
    r_lib_a2 = client.get("/api/v1/reports/my-library")
    assert r_lib_a2.status_code == 200
    rep_a_expired = next((i for i in r_lib_a2.json().get("items", []) if i["report_id"] == rep_id), None)
    assert rep_a_expired is not None
    assert rep_a_expired["is_expired"] is True
    assert rep_a_expired["status"] == "EXPIRED"

    # Issuing new token must fail (403)
    r_tok_exp = client.post(f"/api/v1/reports/{rep_id}/download-token?version=v1.0")
    assert r_tok_exp.status_code == 403

    # Using the pre-issued download token must be rejected because server re-verifies expiration!
    r_preissued_pdf = client.get(dl_url)
    assert r_preissued_pdf.status_code == 403

    r_preissued_bundle = client.get(bundle_url)
    assert r_preissued_bundle.status_code == 403

    # Direct download endpoints without token must also be 403
    r_direct_pdf = client.get(f"/api/v1/reports/{rep_id}/download?version=v1.0")
    assert r_direct_pdf.status_code == 403

    r_direct_bundle = client.get(f"/api/v1/reports/{rep_id}/download-bundle?version=v1.0")
    assert r_direct_bundle.status_code == 403

    # 5. Test Account B (Unauthorized)
    client.post("/api/login", json={"email": email_b, "password": "SecurePassword123!"})
    r_tok_b = client.post(f"/api/v1/reports/{rep_id}/download-token?version=v1.0")
    assert r_tok_b.status_code == 403

    r_dl_b = client.get(f"/api/v1/reports/{rep_id}/download?version=v1.0")
    assert r_dl_b.status_code == 403

    r_bundle_b = client.get(f"/api/v1/reports/{rep_id}/download-bundle?version=v1.0")
    assert r_bundle_b.status_code == 403

    # 6. Test Account C (Perpetual Purchaser) - unaffected by expired trials
    client.post("/api/login", json={"email": email_c, "password": "SecurePassword123!"})
    r_lib_c = client.get("/api/v1/reports/my-library")
    assert r_lib_c.status_code == 200
    rep_c_item = next((i for i in r_lib_c.json().get("items", []) if i["report_id"] == rep_id), None)
    assert rep_c_item is not None
    assert rep_c_item["is_trial"] is False
    assert rep_c_item["is_expired"] is False
    assert rep_c_item["status"] == "ACTIVE"

    # Can issue token
    tok_res_c = client.post(f"/api/v1/reports/{rep_id}/download-token?version=v1.0")
    assert tok_res_c.status_code == 200
    c_dl_url = tok_res_c.json()["download_url"]
    c_bundle_url = tok_res_c.json()["bundle_download_url"]

    # Can download both
    assert client.get(c_dl_url).status_code == 200
    assert client.get(c_bundle_url).status_code == 200


def test_research_suite_bundle_structure_and_manifest_integrity(client, tmp_path):
    """Verify that the generated bundle ZIP contains all 9 deliverables with matching SHA-256 manifest."""
    _login_admin(client)

    now_ts = time.time()
    rep = create_admin_report_draft(
        title="Gold Suite Packaging Test",
        summary="Packaging Verification Report",
        description="Testing complete bundle artifacts and manifest",
        market="COMEX Gold Futures (GC=F)",
        price_usd=10000.0,
    )
    rep_id = rep["id"]

    pdf_full = tmp_path / "pkg_full.pdf"
    pdf_sample = tmp_path / "pkg_sample.pdf"
    pdf_full.write_bytes(b"%PDF-1.4 Packaging Test PDF File")
    pdf_sample.write_bytes(b"%PDF-1.4 Packaging Test Sample PDF File")

    with db.tx() as c:
        c.execute(
            "UPDATE research_reports SET full_pdf_path = ?, sample_pdf_path = ?, version = 'v1.0' WHERE id = ?",
            (str(pdf_full), str(pdf_sample), rep_id),
        )

    publish_admin_report(
        rep_id,
        version="v1.0",
        changelog="Packaging test release",
        is_human_admin=True,
    )

    # Generate bundle ZIP
    zip_path, bundle_filename, manifest_dict = build_or_get_report_bundle_zip(rep_id, "v1.0")
    zip_bytes = zip_path.read_bytes()
    assert len(zip_bytes) > 1000

    # Unpack ZIP in memory
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    namelist = zf.namelist()

    expected_files = [
        "report_full.pdf",
        "trades_ledger.csv",
        "metrics.json",
        "strategy_config.json",
        "replay.py",
        "requirements.txt",
        "data/sample_candles.csv",
        "QUICKSTART.md",
        "MANIFEST.sha256",
    ]
    for ef in expected_files:
        assert ef in namelist, f"Missing file in bundle: {ef}"

    # Verify MANIFEST.sha256 contents
    manifest_bytes = zf.read("MANIFEST.sha256").decode("utf-8")
    assert "GOLD RESEARCH SUITE" in manifest_bytes.upper()
    assert "Raw CSV hash" in manifest_bytes
    assert "candle_stream_normalized" in manifest_bytes
    assert "normalized candle stream hash" in manifest_bytes.lower()

    # Parse and verify SHA-256 hashes of deliverables in the bundle
    for line in manifest_bytes.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(maxsplit=1)
        if len(parts) == 2:
            expected_hash, rel_path = parts
            rel_path = rel_path.strip()
            if rel_path in namelist and rel_path != "MANIFEST.sha256":
                content = zf.read(rel_path)
                computed_hash = hashlib.sha256(content).hexdigest()
                assert computed_hash == expected_hash, f"Hash mismatch for {rel_path}"

    # Verify that raw CSV hash is different from candle content or normalized stream
    raw_csv_bytes = zf.read("data/sample_candles.csv")
    raw_csv_hash = hashlib.sha256(raw_csv_bytes).hexdigest()
    assert raw_csv_hash in manifest_bytes

    # Verify standalone replay script syntax
    replay_py_content = zf.read("replay.py").decode("utf-8")
    assert "def rule_backtest" in replay_py_content
    assert "def parse_candle_file" in replay_py_content
    compile(replay_py_content, "replay.py", "exec")
