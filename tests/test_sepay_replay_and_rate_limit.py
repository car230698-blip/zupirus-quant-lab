"""Unit tests for SePay webhook replay attack protection and Redis rate limiter."""
import time
import hmac
import hashlib
from app.domains.billing.sepay import verify_sepay_signature
from app.core.redis_client import check_rate_limit


def test_sepay_signature_replay_protection():
    """Verify that SePay webhooks older than 300 seconds are rejected."""
    secret = "test_sepay_secret_key_123"
    raw_body = b'{"id":123,"gateway":"MBBank","amount":500000}'
    now = time.time()

    # Case 1: Fresh timestamp (within 5 minutes) -> should succeed
    fresh_ts = str(int(now - 10))
    expected_digest = hmac.new(
        secret.encode("utf-8"),
        f"{fresh_ts}.".encode("utf-8") + raw_body,
        hashlib.sha256,
    ).hexdigest()

    assert verify_sepay_signature(
        raw_body=raw_body,
        signature_header=f"sha256={expected_digest}",
        secret=secret,
        timestamp_header=fresh_ts,
    ) is True

    # Case 2: Stale/replay timestamp (600 seconds old) -> should be rejected
    stale_ts = str(int(now - 600))
    stale_digest = hmac.new(
        secret.encode("utf-8"),
        f"{stale_ts}.".encode("utf-8") + raw_body,
        hashlib.sha256,
    ).hexdigest()

    assert verify_sepay_signature(
        raw_body=raw_body,
        signature_header=f"sha256={stale_digest}",
        secret=secret,
        timestamp_header=stale_ts,
    ) is False

    # Case 3: Fresh timestamp in milliseconds (e.g. now * 1000)
    ms_ts = str(int(now * 1000))
    ms_digest = hmac.new(
        secret.encode("utf-8"),
        f"{ms_ts}.".encode("utf-8") + raw_body,
        hashlib.sha256,
    ).hexdigest()

    assert verify_sepay_signature(
        raw_body=raw_body,
        signature_header=f"sha256={ms_digest}",
        secret=secret,
        timestamp_header=ms_ts,
    ) is True

    # Case 4: No timestamp header provided -> retains backward compatibility
    direct_digest = hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()

    assert verify_sepay_signature(
        raw_body=raw_body,
        signature_header=direct_digest,
        secret=secret,
        timestamp_header=None,
    ) is True


def test_redis_check_rate_limit_sliding_window():
    """Verify check_rate_limit enforces limits and blocks when exceeded."""
    key = f"test_rate_{int(time.time() * 1000)}"

    # Limit = 3 requests per 60 seconds
    assert check_rate_limit(key, limit=3, window_sec=60) is True  # 1st
    assert check_rate_limit(key, limit=3, window_sec=60) is True  # 2nd
    assert check_rate_limit(key, limit=3, window_sec=60) is True  # 3rd
    assert check_rate_limit(key, limit=3, window_sec=60) is False  # 4th - BLOCKED!
    assert check_rate_limit(key, limit=3, window_sec=60) is False  # 5th - BLOCKED!
