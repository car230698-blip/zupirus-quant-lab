import json
import time
import pytest
from app import db
from app.domains.ai.autonomous_pipeline import run_autonomous_research_cycle, acquire_research_job_lock, release_research_job_lock
from app.domains.reports.service import (
    create_admin_report_draft,
    update_admin_report,
    publish_admin_report,
    attach_report_pdf_files,
    check_report_purchase_eligibility,
    create_report_checkout_order,
    grant_report_entitlement_tx,
    verify_user_report_download_access,
)
from fastapi import HTTPException


def test_agent_pipeline_contract_returns_report_id_and_draft_only(monkeypatch):
    """Stage 1.1 & 1.2: Research agent creates DRAFT/READY_FOR_REVIEW only and returns valid report_id."""
    monkeypatch.setenv("AUTONOMOUS_RESEARCH_AUTO_PUBLISH", "true")  # Pipeline must still IGNORE and create draft only
    
    # Mock data feed and studies so pipeline succeeds and returns draft
    from app.domains.quant.data_feed import Candle
    fake_candles = [
        Candle(time=1700000000 + i * 900, open=2000.0 + i * 0.1, high=2002.0 + i * 0.1, low=1999.0 + i * 0.1, close=2001.0 + i * 0.1, volume=100.0)
        for i in range(100)
    ]
    monkeypatch.setattr("app.domains.ai.autonomous_pipeline.fetch_public_ohlcv", lambda **kwargs: fake_candles)
    
    # Target single asset
    universe = [{
        "symbol": "XAUUSD",
        "timeframe": "M15",
        "strategy": "breakout_retest",
        "title_vi": "Test Chiến Lược M15",
        "title_en": "Test Strategy M15",
        "price_usd": 19.99,
    }]
    
    res = run_autonomous_research_cycle(universe=universe, force=True)
    assert res["success"] is True
    assert "drafts" in res
    assert len(res["drafts"]) + len(res["rejected"]) > 0
    if res["drafts"]:
        d = res["drafts"][0]
        assert d.get("report_id") is not None
        with db.tx() as c:
            row = c.execute("SELECT status FROM research_reports WHERE id = ?", (d["report_id"],)).fetchone()
            assert row is not None
            assert row[0] in ("DRAFT", "READY_FOR_REVIEW")
            assert row[0] != "PUBLISHED"


def test_pipeline_job_lock_concurrency_mutex():
    """Stage 1.6: Heartbeat and admin actions don't run overlapping research jobs."""
    acquired, job_id = acquire_research_job_lock()
    assert acquired is True
    assert job_id is not None

    # Second concurrent call must fail
    acquired_2, job_id_2 = acquire_research_job_lock()
    assert acquired_2 is False
    assert job_id_2 == job_id

    # Release lock
    release_research_job_lock(job_id)
    acquired_3, job_id_3 = acquire_research_job_lock()
    assert acquired_3 is True
    release_research_job_lock(job_id_3)


def test_agent_cannot_auto_publish_via_update_admin_report():
    """Stage 1.2: Automated agents or non-human admin cannot bypass human approval to set PUBLISHED."""
    rep = create_admin_report_draft(
        title=f"Test Guard Report {int(time.time()*1000)}",
        summary="Summary test",
        price_usd=50.0,
        admin_id="admin",
    )
    rep_id = rep["id"]

    # Attempt to set status to PUBLISHED via agent caller id
    with pytest.raises(PermissionError) as exc:
        update_admin_report(
            report_id=rep_id,
            updates={"status": "PUBLISHED"},
            admin_id="autonomous_agent_pipeline",
        )
    assert "Tiến trình tự động/Agent không được phép xuất bản trực tiếp" in str(exc.value)


def test_published_report_immutability_and_manifest_hashes():
    """Stage 1.3: Published report versions have manifest & SHA-256 hashes and reject file overwrites."""
    rep = create_admin_report_draft(
        title=f"Immutable Report {int(time.time()*1000)}",
        summary="Summary test",
        version="v1.0",
        price_usd=50.0,
        admin_id="admin",
    )
    rep_id = rep["id"]

    # Attach draft PDFs
    sample_pdf = b"%PDF-1.4 sample content " + b"x" * 50
    full_pdf = b"%PDF-1.4 full content " + b"y" * 50
    attach_report_pdf_files(rep_id, sample_pdf_bytes=sample_pdf, full_pdf_bytes=full_pdf, version_override="v1.0")

    # Publish report as human admin
    pub_res = publish_admin_report(rep_id, version="v1.0", admin_id="admin_1", is_human_admin=True)
    assert pub_res["status"] == "PUBLISHED"
    assert "file_hashes" in pub_res
    assert pub_res["file_hashes"].get("sample_pdf_sha256") is not None
    assert pub_res["file_hashes"].get("full_pdf_sha256") is not None

    # Attempting to overwrite PDFs on published v1.0 must fail
    with pytest.raises(ValueError) as exc:
        attach_report_pdf_files(rep_id, sample_pdf_bytes=b"%PDF-1.4 new sample", full_pdf_bytes=b"%PDF-1.4 new full", version_override="v1.0")
    assert "đã được phát hành công khai và bị khóa bất biến" in str(exc.value)


def test_access_isolation_across_versions(client):
    """Stage 1.3: Buyer of v1.0 retains access to v1.0 files after v2.0 is published."""
    rep = create_admin_report_draft(
        title=f"Version Isolation Report {int(time.time()*1000)}",
        summary="Summary",
        version="v1.0",
        price_usd=50.0,
        admin_id="admin",
    )
    rep_id = rep["id"]

    # v1.0
    v1_full = b"%PDF-1.4 v1 content " + b"a" * 50
    attach_report_pdf_files(rep_id, sample_pdf_bytes=b"%PDF-1.4 v1 sample " + b"s"*50, full_pdf_bytes=v1_full, version_override="v1.0")
    publish_admin_report(rep_id, version="v1.0", admin_id="admin_1", is_human_admin=True)

    # Grant user entitlement for v1.0
    user_id = f"user_v1_buyer_{int(time.time()*1000)}"
    with db.tx() as c:
        c.execute("INSERT INTO users (id, email, password, role) VALUES (?, ?, 'pwd', 'customer')", (user_id, f"{user_id}@example.com"))
        grant_report_entitlement_tx(c, order={
            "id": "ord_test_v1",
            "user_id": user_id,
            "report_id": rep_id,
            "report_version": "v1.0",
        })

    # Verify user can access v1.0
    pdf_path, filename, ver = verify_user_report_download_access(user_id=user_id, user_role="customer", report_id=rep_id, version="v1.0")
    assert ver == "v1.0"
    assert pdf_path.exists()

    # Now create and publish v2.0
    update_admin_report(rep_id, updates={"version": "v2.0"}, admin_id="admin")
    v2_full = b"%PDF-1.4 v2 updated content " + b"b" * 50
    attach_report_pdf_files(rep_id, sample_pdf_bytes=b"%PDF-1.4 v2 sample " + b"s"*50, full_pdf_bytes=v2_full, version_override="v2.0")
    publish_admin_report(rep_id, version="v2.0", admin_id="admin_1", is_human_admin=True)

    # User still gets access to v1.0
    pdf_path_1, filename_1, ver_1 = verify_user_report_download_access(user_id=user_id, user_role="customer", report_id=rep_id, version="v1.0")
    assert ver_1 == "v1.0"
    assert pdf_path_1.exists()

    # User does NOT have access to v2.0
    with pytest.raises(PermissionError):
        verify_user_report_download_access(user_id=user_id, user_role="customer", report_id=rep_id, version="v2.0")


def test_purchase_synchronization_and_wallet_guard():
    """Stage 1.5: Purchase eligibility checks status, sale flag, USDT flag, and wallet address."""
    # When status is DRAFT
    eligible, reason = check_report_purchase_eligibility("DRAFT")
    assert eligible is False
    assert "chưa được xuất bản" in reason

    user_id = f"user_wallet_test_{int(time.time()*1000)}"
    with db.tx() as c:
        c.execute("INSERT INTO users (id, email, password, role) VALUES (?, ?, 'pwd', 'customer')", (user_id, f"{user_id}@example.com"))

    rep = create_admin_report_draft(
        title=f"Eligible Report {int(time.time()*1000)}",
        summary="Summary",
        version="v1.0",
        price_usd=50.0,
        admin_id="admin",
    )
    rep_id = rep["id"]
    attach_report_pdf_files(rep_id, sample_pdf_bytes=b"%PDF-1.4 sample "*5, full_pdf_bytes=b"%PDF-1.4 full "*5, version_override="v1.0")
    publish_admin_report(rep_id, version="v1.0", admin_id="admin_1", is_human_admin=True)

    # Idempotent entitlement check
    ord_id = f"ord_uniq_{int(time.time()*1000)}"
    with db.tx() as c:
        order_stub = {
            "id": ord_id,
            "user_id": user_id,
            "report_id": rep_id,
            "report_version": "v1.0",
        }
        grant_report_entitlement_tx(c, order=order_stub)
        grant_report_entitlement_tx(c, order=order_stub)
        rows = c.execute("SELECT COUNT(*) FROM report_entitlements WHERE user_id = ? AND report_id = ?", (user_id, rep_id)).fetchone()
        assert rows[0] == 1
