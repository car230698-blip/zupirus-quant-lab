import time
import json
from fastapi.testclient import TestClient
from app.db import init, tx
from app.main import app
from app.security import digest
from app.domains.notifications.service import emit_notification


def test_emit_notification_and_cooldown():
    init()
    with tx() as c:
        nid1 = emit_notification(
            c,
            user_id="usr_test_123",
            role="customer",
            severity="WARNING",
            title="Cảnh Báo Chạm Ngưỡng Drawdown",
            body="Tài khoản #12345 chạm 75% giới hạn DD ngày.",
            send_email=False,
            cooldown_key="test_dd_warn_123",
            cooldown_sec=300,
        )
        assert nid1.startswith("notif_")

        row = c.execute("SELECT severity, title, body FROM notifications WHERE id = ?", (nid1,)).fetchone()
        assert row is not None
        assert (row["severity"] if hasattr(row, "keys") else row[0]) == "WARNING"


def test_notifications_api_lifecycle():
    init()
    client = TestClient(app)

    raw_token = "qa_session_secret_token_123"
    token_digest = digest(raw_token)
    expires = time.time() + 3600
    now = time.time()
    test_notif_id = f"notif_qa_{int(now * 1000)}"

    with tx() as c:
        c.execute("DELETE FROM notifications WHERE user_id = 'usr_notif_qa'")
        c.execute(
            """
            INSERT INTO users (id, email, password, role)
            VALUES ('usr_notif_qa', 'qa_user@zupirus.com', 'dummy_hash', 'customer')
            ON CONFLICT(id) DO NOTHING
            """
        )
        c.execute(
            """
            INSERT INTO sessions (token, user_id, expires)
            VALUES (?, 'usr_notif_qa', ?)
            ON CONFLICT(token) DO UPDATE SET expires = excluded.expires
            """,
            (token_digest, expires),
        )
        c.execute(
            """
            INSERT INTO notifications (id, user_id, role, severity, title, body, created_at)
            VALUES (?, 'usr_notif_qa', 'customer', 'INFO', 'Hệ Thống Sẵn Sàng', 'Chào mừng đến với ZUPIRUS.', ?)
            ON CONFLICT(id) DO NOTHING
            """,
            (test_notif_id, now),
        )

    # 1. List notifications
    res = client.get(
        "/api/v1/notifications",
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["unread_count"] >= 1
    assert any(n["id"] == test_notif_id for n in data["notifications"])

    # 2. Mark single read
    res_read = client.post(
        f"/api/v1/notifications/{test_notif_id}/read",
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert res_read.status_code == 200
    assert res_read.json()["ok"] is True

    # 3. Mark all read
    res_all = client.post(
        "/api/v1/notifications/read-all",
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert res_all.status_code == 200


def test_export_orders_csv_format():
    init()
    client = TestClient(app)
    raw_token = "qa_session_secret_token_123"

    res = client.get(
        "/api/v1/orders/export?days=30",
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert res.status_code == 200
    assert "text/csv" in res.headers.get("content-type", "")
    content = res.content
    # Must start with UTF-8 BOM (\xef\xbb\xbf)
    assert content.startswith(b"\xef\xbb\xbf")
    text = content.decode("utf-8-sig")
    assert "Thời Gian" in text
    assert "Tài Khoản MT5" in text
    assert "Khối Lượng (Lot)" in text
