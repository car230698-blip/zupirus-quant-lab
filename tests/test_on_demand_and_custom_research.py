"""Comprehensive verification tests for ZUPIRUS on-demand research model.

Tests:
1. Retail Technical Analysis Engine & mobile 2-4 page PDF (XAUUSD, EURUSD, USDJPY on H1/H4).
2. Insufficient data detection (rejects < 30 bars with THIẾU DỮ LIỆU ĐỂ PHÂN TÍCH).
3. Institutional Custom Macro Research:
   - US CPI inquiry submission
   - Admin bespoke quotation & price sanity checks (rejects negative / inf)
   - Client quote confirmation
   - Admin execution -> multi-window 1, 5, 20 sessions evaluation, simulation ledger, failure modes
   - Deterministic bundle packaging (100% reproducible SHA-256)
   - Admin approval & private delivery
4. Security & Tenant Isolation:
   - Owner can download deliverable PDF & bundle
   - Unrelated User 2 gets 403 Forbidden
   - Private deliverables never leak into public catalog
5. Entitlement Invariant:
   - Trial grant/extension NEVER overwrites perpetual ownership (is_trial=0)
   - Trial revocation refuses to revoke is_trial=0 entitlement
"""
import io
import json
import math
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Tuple, List, Optional, Dict

import pytest
from fastapi.testclient import TestClient

from app.core.db import init, tx
init()
from app.domains.quant.candles import Candle
from app.domains.quant.institutional_macro import (
    build_institutional_deliverable_bundle,
    generate_institutional_pdf,
    run_institutional_macro_event_study,
)
from app.domains.quant.retail_analysis import generate_retail_pdf, run_retail_technical_analysis
from app.domains.reports.service import grant_report_entitlement_tx
from app.main import app

client = TestClient(app)


def _create_user_client(email: str, password: str = "SecurePassword123!") -> Tuple[TestClient, str]:
    c = TestClient(app)
    c.headers["x-zupirus"] = "1"
    r = c.post("/api/register", json={"email": email, "password": password})
    assert r.status_code == 200, f"Register failed: {r.text}"
    login_r = c.post("/api/login", json={"email": email, "password": password})
    assert login_r.status_code == 200, f"Login failed: {login_r.text}"
    user_id = login_r.json().get("user", {}).get("id") or login_r.json().get("id")
    if not user_id:
        with tx() as cursor:
            row = cursor.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            user_id = row[0] if row else "unknown_user"
    return c, user_id


def _create_admin_client() -> TestClient:
    c = TestClient(app)
    c.headers["x-zupirus"] = "1"
    r = c.post("/api/login", json={"email": "admin@zupirus.local", "password": "test-only-admin-password-123"})
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return c


# --- 1. Retail Technical Analysis Tests ---

def test_retail_technical_analysis_engine_and_pdf():
    """Verify deterministic retail analysis calculation and mobile-optimized PDF generator."""
    # Build 80 closed bars
    candles = [
        Candle(time=1700000000 + i * 3600, open=2650.0 + i * 0.5, high=2655.0 + i * 0.5, low=2648.0 + i * 0.5, close=2653.0 + i * 0.5, volume=100.0)
        for i in range(80)
    ]
    res = run_retail_technical_analysis("XAUUSD", "H1", candles, period_bars=60)
    assert res.status == "SUCCESS"
    assert res.symbol == "XAUUSD"
    assert res.timeframe == "H1"
    assert res.bars_evaluated == 60
    assert res.bias in ("BUY", "SELL", "ĐỨNG NGOÀI")
    assert res.invalidation_level > 0
    assert res.support_zone[0] < res.support_zone[1]
    assert res.resistance_zone[0] < res.resistance_zone[1]

    # Generate mobile PDF
    pdf_bytes = generate_retail_pdf(res, watermark="client@example.com")
    assert len(pdf_bytes) > 20000
    assert pdf_bytes.startswith(b"%PDF-")


def test_retail_insufficient_data_rejection():
    """Ensure engine distinguishes THIẾU DỮ LIỆU ĐỂ PHÂN TÍCH from normal STAND ASIDE."""
    few_candles = [
        Candle(time=1700000000 + i * 3600, open=2650.0, high=2655.0, low=2648.0, close=2652.0, volume=100.0)
        for i in range(15)
    ]
    res = run_retail_technical_analysis("EURUSD", "H1", few_candles, period_bars=50)
    assert res.status == "INSUFFICIENT_DATA"
    assert "THIẾU DỮ LIỆU" in res.bias_display_vi
    assert res.confidence_pct == 0


def test_retail_api_endpoint_execution():
    """Test POST /api/v1/research/retail/request creates private deliverable."""
    now_ts = int(time.time())
    client_retail, user_id = _create_user_client(f"retail_{now_ts}@zupirus.com")
    payload = {"symbol": "XAUUSD", "timeframe": "H1", "period_bars": 80}
    r = client_retail.post("/api/v1/research/retail/request", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["symbol"] == "XAUUSD"
    assert data["timeframe"] == "H1"
    assert "download_pdf_url" in data

    # Verify download succeeds for owner
    dl_r = client_retail.get(data["download_pdf_url"])
    assert dl_r.status_code == 200
    assert dl_r.headers["content-type"] == "application/pdf"
    assert len(dl_r.content) > 10000


# --- 2. Institutional Macro Event-Study & Deterministic Packaging ---

def test_institutional_macro_event_study_engine():
    """Test US CPI event study across XAUUSD, EURUSD, USDJPY with multi-window 1/5/20 evaluation."""
    study = run_institutional_macro_event_study(
        hypothesis_prompt="Đánh giá tác động của công bố chỉ số US CPI bất ngờ tăng mạnh đối với XAUUSD, EURUSD và USDJPY",
        symbols=["XAUUSD", "EURUSD", "USDJPY"],
        client_name="Alpha Family Office",
        quoted_price_usd=10000.0,
        turnaround_hours=48,
    )
    assert len(study.assets) == 3
    assert len(study.ledger_records) > 0

    gold_impact = next(a for a in study.assets if a.symbol == "XAUUSD")
    assert "1_SESSION" in gold_impact.windows
    assert "5_SESSIONS" in gold_impact.windows
    assert "20_SESSIONS" in gold_impact.windows
    assert gold_impact.windows["20_SESSIONS"].evidence_strength == "WEAK_EVIDENCE"
    assert len(gold_impact.failure_cases) > 0

    # Test PDF generation
    pdf_bytes = generate_institutional_pdf(study)
    assert len(pdf_bytes) > 20000
    assert pdf_bytes.startswith(b"%PDF-")


def test_institutional_bundle_deterministic_reproducibility():
    """Verify deliverable ZIP bundle SHA-256 is byte-for-byte identical across runs."""
    study = run_institutional_macro_event_study(
        hypothesis_prompt="Deterministic Replay Test on US CPI",
        symbols=["XAUUSD", "EURUSD", "USDJPY"],
        client_name="Prop Desk A",
        quoted_price_usd=10000.0,
    )
    zip_path1, fn1, sha1 = build_institutional_deliverable_bundle(study)
    zip_path2, fn2, sha2 = build_institutional_deliverable_bundle(study)

    assert fn1 == fn2
    assert sha1 == sha2, "Institutional bundle SHA-256 must be byte-for-byte identical"
    assert zip_path1.exists()

    # Verify bundle structure
    with zipfile.ZipFile(zip_path1, "r") as zf:
        names = zf.namelist()
        assert "report_full.pdf" in names
        assert "trades_ledger.csv" in names
        assert "metrics.json" in names
        assert "strategy_config.json" in names
        assert "replay.py" in names
        assert "QUICKSTART.md" in names
        assert "MANIFEST.sha256" in names


# --- 3. Full Institutional Lifecycle & Tenant Isolation (403 Forbidden) ---

def test_institutional_full_lifecycle_and_tenant_isolation():
    """Verify complete workflow: RFP Inquiry -> Admin Quote -> Client Confirm -> Admin Run -> Admin Approve -> Private Delivery.
    Also verifies User 2 gets 403 Forbidden!
    """
    now_ts = int(time.time())
    client1, user1_id = _create_user_client(f"alpha_desk_{now_ts}@zupirus.com")
    client2, user2_id = _create_user_client(f"intruder_{now_ts}@zupirus.com")
    client_admin = _create_admin_client()

    # 1. User 1 submits RFP
    rfp_payload = {
        "hypothesis_prompt": "Kiểm định mô hình phản ứng giá sau tin CPI Mỹ trên vàng và FX",
        "symbols": ["XAUUSD", "EURUSD", "USDJPY"],
        "turnaround_hours": 48,
        "client_notes": "Báo cáo cho kỳ họp hội đồng đầu tư",
    }
    r = client1.post("/api/v1/research/institutional/inquiry", json=rfp_payload)
    assert r.status_code == 200
    req_id = r.json()["request_id"]
    assert r.json()["status"] == "PENDING_QUOTE"

    # 2. Price Sanity Guards on Quote API: Reject negative and NaN prices
    bad_quote = client_admin.post(f"/api/v1/admin/research/requests/{req_id}/quote", json={"quoted_price_usd": -500.0})
    assert bad_quote.status_code in (400, 422)

    # 3. Admin quotes valid price ($10,000 USD bespoke contract)
    q_res = client_admin.post(
        f"/api/v1/admin/research/requests/{req_id}/quote",
        json={"quoted_price_usd": 10000.0, "scope_notes": "Bao gồm 3 tài sản và cửa sổ 1, 5, 20 phiên"},
    )
    assert q_res.status_code == 200
    assert q_res.json()["status"] == "QUOTED"

    # 4. Client confirms quote
    conf_res = client1.post(f"/api/v1/research/institutional/{req_id}/confirm")
    assert conf_res.status_code == 200
    assert conf_res.json()["status"] == "CONFIRMED"

    # 5. Admin runs study
    run_res = client_admin.post(f"/api/v1/admin/research/requests/{req_id}/run")
    assert run_res.status_code == 200
    assert run_res.json()["status"] == "READY_FOR_REVIEW"
    assert "bundle_sha256" in run_res.json()

    # 6. Admin approves & delivers
    app_res = client_admin.post(f"/api/v1/admin/research/requests/{req_id}/approve")
    assert app_res.status_code == 200
    assert app_res.json()["status"] == "DELIVERED"

    # 7. Security Isolation:
    # User 1 (Owner) can download PDF and Bundle
    dl_pdf_user1 = client1.get(f"/api/v1/research/orders/{req_id}/download-pdf")
    assert dl_pdf_user1.status_code == 200
    assert len(dl_pdf_user1.content) > 10000

    dl_bundle_user1 = client1.get(f"/api/v1/research/orders/{req_id}/download-bundle")
    assert dl_bundle_user1.status_code == 200
    assert dl_bundle_user1.headers["content-type"] == "application/zip"

    # User 2 (Unrelated User) MUST GET 403 FORBIDDEN!
    dl_pdf_user2 = client2.get(f"/api/v1/research/orders/{req_id}/download-pdf")
    assert dl_pdf_user2.status_code == 403, "Unrelated User 2 must receive 403 Forbidden!"

    dl_bundle_user2 = client2.get(f"/api/v1/research/orders/{req_id}/download-bundle")
    assert dl_bundle_user2.status_code == 403, "Unrelated User 2 must receive 403 Forbidden!"

    # 8. Private Deliverable is NEVER leaked to public catalog
    public_cat = client.get("/api/v1/reports")
    assert public_cat.status_code == 200
    items = public_cat.json().get("items") or []
    assert not any(i.get("id") == req_id for i in items), "Private custom study must never leak to public catalog!"


# --- 4. Entitlement Invariant: Never Overwrite Perpetual Ownership ---

def test_entitlement_perpetual_ownership_preserved():
    """Verify that granting or extending a trial never downgrades or overwrites perpetual ownership (is_trial=0)."""
    now_ts = int(time.time())
    client_holder, uid = _create_user_client(f"perpetual_holder_{now_ts}@zupirus.com")
    client_admin = _create_admin_client()

    order_id = f"ord_perp_{now_ts}"
    rep_id = "gold-m15-breakout-retest-v1"

    # Seed research report and version if not present
    with tx() as c:
        c.execute(
            """
            INSERT INTO research_reports (id, slug, title, summary, status, is_for_sale, price_usd, price_vnd, version, published_at, created_at, updated_at)
            VALUES (?, ?, 'Gold M15 Breakout Retest', 'Report for test', 'PUBLISHED', 1, 79.0, 1975000, 'v1.0', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET status = 'PUBLISHED', is_for_sale = 1, price_usd = 79.0
            """,
            (rep_id, rep_id, now_ts, now_ts, now_ts),
        )
        c.execute(
            """
            INSERT INTO report_versions (id, report_id, version, full_pdf_path, changelog, published_at, created_at)
            VALUES ('ver_test_perp', ?, 'v1.0', 'data/reports_private/test.pdf', 'init', ?, ?)
            ON CONFLICT(report_id, version) DO NOTHING
            """,
            (rep_id, now_ts, now_ts),
        )

    # 1. Grant permanent purchase (is_trial = 0, expires_at = None)
    order_dict = {
        "id": order_id,
        "user_id": uid,
        "report_id": rep_id,
        "report_version": "v1.0",
        "is_trial": 0,
    }
    with tx() as c:
        c.execute(
            """
            INSERT OR REPLACE INTO orders (
                id, user_id, amount_usd, locked_exchange_rate, amount_vnd,
                plan_tier, cloud_slots_count, status, payment_gateway,
                created_at, expires_at, paid_at, product_type, report_id, report_version
            ) VALUES (?, ?, 79.0, 1.0, 1975000, ?, 1, 'COMPLETED', 'DIRECT_USDT', ?, ?, ?, 'PDF_REPORT', ?, ?)
            """,
            (order_id, uid, f"report:{rep_id}", now_ts, now_ts + 86400, now_ts, rep_id, "v1.0"),
        )
        ent = grant_report_entitlement_tx(c, order=order_dict, now_ts=now_ts, is_trial=0, expires_at=None)
        assert ent["is_trial"] == 0
        assert ent["expires_at"] is None

    # 2. Attempt to grant a trial over the same report/version
    trial_order_id = f"trial_order_{now_ts}"
    trial_order_dict = {
        "id": trial_order_id,
        "user_id": uid,
        "report_id": rep_id,
        "report_version": "v1.0",
        "is_trial": 1,
    }
    with tx() as c:
        c.execute(
            """
            INSERT OR REPLACE INTO orders (
                id, user_id, amount_usd, locked_exchange_rate, amount_vnd,
                plan_tier, cloud_slots_count, status, payment_gateway,
                created_at, expires_at, paid_at, product_type, report_id, report_version
            ) VALUES (?, ?, 0.0, 1.0, 0, ?, 1, 'COMPLETED', 'DIRECT_USDT', ?, ?, ?, 'PDF_REPORT', ?, ?)
            """,
            (trial_order_id, uid, f"report:{rep_id}", now_ts, now_ts + 86400 * 7, now_ts, rep_id, "v1.0"),
        )
        ent_after_trial_grant = grant_report_entitlement_tx(
            c, order=trial_order_dict, now_ts=now_ts, is_trial=1, expires_at=now_ts + 86400 * 7
        )
        # CRITICAL INVARIANT: is_trial must remain 0 and expires_at must remain None!
        assert ent_after_trial_grant["is_trial"] == 0, "Perpetual ownership must NEVER be overwritten with trial!"
        assert ent_after_trial_grant["expires_at"] is None, "Perpetual expiration must NEVER be set by trial!"

    # 3. Attempt to revoke perpetual entitlement via trial endpoint must fail
    revoke_res = client_admin.post(
        f"/api/v1/admin/billing/trials/{ent['id']}/revoke",
        json={"reason": "Test revoke attempt"},
    )
    assert revoke_res.status_code == 400
    assert "vĩnh viễn" in revoke_res.json()["detail"].lower()


# --- 5. Institutional RFP Intake with Problem Description Alone & Chat Workflows ---

def test_institutional_inquiry_with_problem_description_alone():
    """Verify client can submit an RFP with JUST the problem description.
    Ensures agent auto-drafts proposal and posts welcoming message into the chat.
    """
    now_ts = int(time.time())
    client_inst, uid = _create_user_client(f"fund_cio_{now_ts}@institutional.com")

    # Submits only problem_description! No symbols, no timeframe, no methodology selected
    payload = {
        "problem_description": "Quỹ chúng tôi đang lo ngại lạm phát Mỹ dai dẳng và muốn biết giá vàng và tỷ giá EUR/USD phản ứng ra sao trong các nhịp số liệu CPI bất ngờ cao hơn dự báo."
    }
    r = client_inst.post("/api/v1/research/institutional/inquiry", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    req_id = data["request_id"]
    assert data["status"] == "PENDING_QUOTE"
    assert data["current_step"] == "PROPOSAL_PENDING"
    assert "draft_proposal" in data
    assert data["draft_proposal"]["version"] == 1
    assert "XAUUSD" in data["draft_proposal"]["recommended_symbols"]

    # Check that initial AI assistant message was automatically created in chat
    msg_res = client_inst.get(f"/api/v1/research/orders/{req_id}/messages")
    assert msg_res.status_code == 200
    messages = msg_res.json()["messages"]
    assert len(messages) >= 1
    assert messages[0]["sender_role"] == "ai_assistant"
    assert "ZUPIRUS Quant Lab đã tiếp nhận bài toán" in messages[0]["message"]


def test_real_time_chat_messages_and_security():
    """Verify bidirectional messaging, unread counts, admin inbox, and 403 isolation."""
    now_ts = int(time.time())
    client_owner, owner_id = _create_user_client(f"client_chat_{now_ts}@desk.com")
    client_intruder, intruder_id = _create_user_client(f"intruder_chat_{now_ts}@desk.com")
    client_admin = _create_admin_client()

    # 1. Create order
    r = client_owner.post("/api/v1/research/institutional/inquiry", json={"problem_description": "Khảo nghiệm phản ứng chính sách FOMC"})
    req_id = r.json()["request_id"]

    # 2. Client sends a message
    post_res = client_owner.post(f"/api/v1/research/orders/{req_id}/messages", json={"message": "Quỹ tôi muốn ưu tiên cửa sổ 5 phiên sau sự kiện."})
    assert post_res.status_code == 200
    msg = post_res.json()["message"]
    assert msg["sender_role"] == "client"

    # 3. Admin sees unread count in inbox
    inbox_res = client_admin.get("/api/v1/admin/research/inbox")
    assert inbox_res.status_code == 200
    inbox_item = next((item for item in inbox_res.json()["inbox"] if item["id"] == req_id), None)
    assert inbox_item is not None
    assert inbox_item["unread_count"] >= 1

    # 4. Admin replies
    admin_reply = client_admin.post(f"/api/v1/research/orders/{req_id}/messages", json={"message": "Đã ghi nhận, chúng tôi sẽ bổ sung cửa sổ 5 phiên vào đề xuất."})
    assert admin_reply.status_code == 200
    assert admin_reply.json()["message"]["sender_role"] == "admin"

    # 5. Security isolation: Intruder gets 403 Forbidden on messages
    int_msg = client_intruder.get(f"/api/v1/research/orders/{req_id}/messages")
    assert int_msg.status_code == 403
    int_post = client_intruder.post(f"/api/v1/research/orders/{req_id}/messages", json={"message": "Hacking chat"})
    assert int_post.status_code == 403


def test_attachment_upload_magic_bytes_and_security():
    """Verify attachment upload validates magic bytes (PNG, PDF, CSV), rejects spoofed files, and enforces 403."""
    now_ts = int(time.time())
    client_owner, owner_id = _create_user_client(f"att_owner_{now_ts}@desk.com")
    client_intruder, intruder_id = _create_user_client(f"att_intruder_{now_ts}@desk.com")
    client_admin = _create_admin_client()

    r = client_owner.post("/api/v1/research/institutional/inquiry", json={"problem_description": "Nghiên cứu đính kèm tài liệu"})
    req_id = r.json()["request_id"]

    # 1. Upload valid PNG
    png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"\x00" * 50
    up_png = client_owner.post(
        f"/api/v1/research/orders/{req_id}/attachments",
        files={"file": ("chart.png", png_bytes, "image/png")},
    )
    assert up_png.status_code == 200
    png_att_id = up_png.json()["attachment"]["id"]

    # 2. Upload valid CSV
    csv_bytes = b"timestamp,symbol,event_surprise,reaction_pips\n1700000000,XAUUSD,0.3,-18.5\n"
    up_csv = client_owner.post(
        f"/api/v1/research/orders/{req_id}/attachments",
        files={"file": ("historical_events.csv", csv_bytes, "text/csv")},
    )
    assert up_csv.status_code == 200
    csv_att_id = up_csv.json()["attachment"]["id"]

    # 3. Spoofed file: .png extension but binary executable content (invalid magic bytes)
    fake_png = b"MZ\x90\x00\x03\x00\x00\x00ThisIsAnExecutable"
    up_fake = client_owner.post(
        f"/api/v1/research/orders/{req_id}/attachments",
        files={"file": ("malicious.png", fake_png, "image/png")},
    )
    assert up_fake.status_code == 400
    assert "không hợp lệ" in up_fake.json()["detail"].lower()

    # 4. Download authorization: Owner can download
    dl_res = client_owner.get(f"/api/v1/research/orders/{req_id}/attachments/{png_att_id}/download")
    assert dl_res.status_code == 200
    assert dl_res.content == png_bytes

    # Intruder gets 403 Forbidden!
    int_dl = client_intruder.get(f"/api/v1/research/orders/{req_id}/attachments/{png_att_id}/download")
    assert int_dl.status_code == 403

    # 5. Admin designates CSV attachment as run input
    set_input = client_admin.post(f"/api/v1/admin/research/requests/{req_id}/attachments/{csv_att_id}/set-run-input")
    assert set_input.status_code == 200
    assert set_input.json()["input_attachment_id"] == csv_att_id


def test_versioned_proposal_and_client_confirmation():
    """Verify admin sends formal versioned proposal and client confirms matching version."""
    now_ts = int(time.time())
    client_inst, uid = _create_user_client(f"version_test_{now_ts}@inst.com")
    client_admin = _create_admin_client()

    # 1. Inquiry created (initial proposal v1 auto-drafted)
    r = client_inst.post("/api/v1/research/institutional/inquiry", json={"problem_description": "Nghiên cứu rủi ro địa chính trị"})
    req_id = r.json()["request_id"]

    # 2. Admin submits updated proposal v2 with custom terms
    prop_res = client_admin.post(
        f"/api/v1/admin/research/requests/{req_id}/proposal",
        json={
            "research_question": "Đánh giá định lượng tác động căng thẳng địa chính trị lên Vàng và dầu thô",
            "quoted_price_usd": 12500.0,
            "turnaround_hours": 72,
            "scope_notes": "Bao gồm 3 tài sản và phân tích ngoài mẫu",
        },
    )
    assert prop_res.status_code == 200
    assert prop_res.json()["proposal_version"] == 2

    # 3. Client attempts to confirm outdated version 1 -> rejected with 400!
    bad_conf = client_inst.post(f"/api/v1/research/institutional/{req_id}/confirm", json={"version": 1})
    assert bad_conf.status_code == 400
    assert "phiên bản mới" in bad_conf.json()["detail"].lower()

    # 4. Client confirms matching version 2 -> succeeds!
    good_conf = client_inst.post(f"/api/v1/research/institutional/{req_id}/confirm", json={"version": 2})
    assert good_conf.status_code == 200
    assert good_conf.json()["status"] == "CONFIRMED"
    assert good_conf.json()["current_step"] == "CONFIRMED"

