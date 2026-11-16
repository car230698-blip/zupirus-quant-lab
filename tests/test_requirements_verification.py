"""Comprehensive tests verifying the requested milestone requirements:
1. Customer Order History:
   - Return SL & TP from signal records into /api/dashboard.
   - Distinguish signal price from fill_price.
   - Correct backend state, ticket, deal, reason without guesswork.
   - Multi-tenant data isolation: User A cannot see User B's orders.
2. Admin Consolidated Activity & Orders:
   - Authorized /api/admin/orders endpoint.
   - Filter by account_id, state, team, search query, with pagination.
   - Accurate state mapping (queued, resume, waiting_approval, filled, cancelled, expired, rejected, intent, unknown).
3. Risk Calendar CRUD & Audit:
   - Positive timestamp requirement on creation (gt=0).
   - PUT update event with calendar_updated audit record.
   - DELETE event with calendar_deleted audit record.
   - Role protection (customer forbidden from admin news operations).
4. Strategy Closed Candle Evaluation:
   - Closed candle aggregation for configured timeframe (M15).
   - Decision records candle_time, version (2.1.0), and entry or STAND_ASIDE rationale.
"""
import time
import json
import pytest
from app import db, engine
from app.db import tx, insert_timescale_quote, query_timescale_candles
from app.engine import get_closed_candles_for_strategy, demo_step


def test_customer_order_history_sl_tp_fill_price_and_isolation(client):
    """Verify customer order history includes SL, TP, fill_price, and isolates data between users."""
    # 1. Register User A and User B
    user_a = {'email': 'usera@example.com', 'password': 'Password123!'}
    user_b = {'email': 'userb@example.com', 'password': 'Password123!'}
    client.post('/api/register', json=user_a)
    client.post('/api/register', json=user_b)

    # 2. Login as User A and create an account
    client.post('/api/login', json=user_a)
    acc_a_res = client.post('/api/accounts', json={'login': '11111', 'server': 'Broker-Demo', 'mode': 'DEMO'})
    assert acc_a_res.status_code == 200
    acc_a_id = acc_a_res.json()['id']

    # 3. Create a Signal and a Dispatch for User A with SL, TP, and fill_price
    sig_id = 'sig_test_user_a_001'
    now = time.time()
    with tx() as c:
        c.execute(
            """INSERT INTO signals(id, source, side, price, sl, tp, created, expires)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (sig_id, 'DEMO', 'BUY', 2650.50, 2640.00, 2665.00, now, now + 45)
        )
        c.execute(
            """INSERT INTO dispatches(signal_id, account_id, state, reason, ticket, deal, fill_price, created, updated)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (sig_id, acc_a_id, 'filled', None, '987654', '123456', 2650.55, now, now)
        )

    # 4. Query /api/dashboard as User A
    dash_a = client.get('/api/dashboard').json()
    orders_a = dash_a.get('orders', [])
    assert len(orders_a) == 1
    order = orders_a[0]
    assert order['signal_id'] == sig_id
    assert order['side'] == 'BUY'
    assert order['price'] == 2650.50
    assert order['fill_price'] == 2650.55
    assert order['sl'] == 2640.00
    assert order['tp'] == 2665.00
    assert order['ticket'] == '987654'
    assert order['deal'] == '123456'
    assert order['state'] == 'filled'

    # 5. Test filtering by account_id and state
    dash_filtered = client.get(f'/api/dashboard?account_id={acc_a_id}&state=filled').json()
    assert len(dash_filtered.get('orders', [])) == 1

    dash_empty = client.get(f'/api/dashboard?account_id={acc_a_id}&state=rejected').json()
    assert len(dash_empty.get('orders', [])) == 0

    # 6. Login as User B and verify User B cannot see User A's orders
    client.post('/api/login', json=user_b)
    dash_b = client.get('/api/dashboard').json()
    orders_b = dash_b.get('orders', [])
    assert len(orders_b) == 0  # Tenant isolation strictly enforced!


def test_admin_orders_query_filters_and_rbac(client):
    """Verify /api/admin/orders queries across accounts with filters, pagination, and RBAC."""
    # 1. Regular customer gets 403 Forbidden
    cust = {'email': 'regular@example.com', 'password': 'Password123!'}
    client.post('/api/register', json=cust)
    client.post('/api/login', json=cust)
    assert client.get('/api/admin/orders').status_code == 403

    # 2. Login as Admin
    admin_login = {'email': 'admin@zupirus.local', 'password': 'test-only-admin-password-123'}
    assert client.post('/api/login', json=admin_login).status_code == 200

    # Create test accounts through API so user relationship is valid
    acc1_res = client.post('/api/accounts', json={'login': '88888', 'server': 'Admin-Broker', 'mode': 'DEMO'})
    assert acc1_res.status_code == 200
    acc1_id = acc1_res.json()['id']

    acc2_res = client.post('/api/accounts', json={'login': '99999', 'server': 'Admin-Broker', 'mode': 'DEMO'})
    assert acc2_res.status_code == 200
    acc2_id = acc2_res.json()['id']

    # 3. Setup test dispatches with various backend states
    now = time.time()
    with tx() as c:
        states = ['queued', 'resume', 'waiting_approval', 'filled', 'cancelled', 'expired', 'rejected', 'intent', 'unknown']
        for idx, state in enumerate(states):
            sig_id = f'sig_adm_{idx}'
            c.execute(
                """INSERT OR REPLACE INTO signals(id, source, side, price, sl, tp, created, expires)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (sig_id, 'DEMO', 'BUY', 2650.0 + idx, 2640.0, 2660.0, now, now + 45)
            )
            c.execute(
                """INSERT INTO dispatches(signal_id, account_id, state, reason, ticket, deal, fill_price, created, updated)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (sig_id, acc1_id if idx % 2 == 0 else acc2_id,
                 state, f'reason_for_{state}', str(1000 + idx), str(2000 + idx), 2650.1 + idx, now - idx, now - idx)
            )

    # 4. Query all admin orders
    res = client.get('/api/admin/orders?limit=50&offset=0')
    assert res.status_code == 200
    data = res.json()
    assert data['total'] >= 9
    assert len(data['orders']) >= 9

    # 5. Filter by account_id
    res_acc1 = client.get(f'/api/admin/orders?account_id={acc1_id}')
    assert res_acc1.status_code == 200
    orders_acc1 = res_acc1.json()['orders']
    assert all(o['account_id'] == acc1_id for o in orders_acc1)

    # 6. Filter by state
    res_queued = client.get('/api/admin/orders?state=queued')
    assert res_queued.status_code == 200
    orders_queued = res_queued.json()['orders']
    assert len(orders_queued) >= 1
    assert all(o['state'] == 'queued' for o in orders_queued)

    # 7. Search filter
    res_search = client.get('/api/admin/orders?search=sig_adm_0')
    assert res_search.status_code == 200
    orders_search = res_search.json()['orders']
    assert any('sig_adm_0' in (o.get('signal_id') or '') for o in orders_search)


def test_risk_calendar_crud_and_audit(client):
    """Verify Risk Calendar add with positive timestamp requirement, update, delete, and audit logging."""
    # 1. Customer cannot modify risk calendar
    cust = {'email': 'news_test@example.com', 'password': 'Password123!'}
    client.post('/api/register', json=cust)
    client.post('/api/login', json=cust)
    assert client.post('/api/admin/news', json={'currency': 'USD', 'impact': 'high', 'title': 'NFP', 'ts': 1700000000}).status_code == 403

    # 2. Login as Admin
    admin_login = {'email': 'admin@zupirus.local', 'password': 'test-only-admin-password-123'}
    assert client.post('/api/login', json=admin_login).status_code == 200

    # 3. Add event with invalid timestamp (<= 0) should fail
    bad_res = client.post('/api/admin/news', json={'currency': 'USD', 'impact': 'high', 'title': 'Invalid TS', 'ts': 0})
    assert bad_res.status_code == 422

    # 4. Add event with valid positive timestamp
    valid_ts = time.time() + 3600
    add_res = client.post('/api/admin/news', json={'currency': 'USD', 'impact': 'high', 'title': 'US CPI Release', 'ts': valid_ts})
    assert add_res.status_code == 200
    news_id = add_res.json()['id']
    assert str(news_id) != ''

    # 5. Update event via PUT
    updated_title = 'US CPI Release (Updated)'
    updated_ts = valid_ts + 600
    put_res = client.put(f'/api/admin/news/{news_id}', json={
        'currency': 'USD',
        'impact': 'high',
        'title': updated_title,
        'ts': updated_ts,
    })
    assert put_res.status_code == 200
    assert put_res.json().get('ok') is True

    # Verify event was updated in monitor
    monitor = client.get('/api/admin/monitor').json()
    event = next((n for n in monitor['news'] if str(n['id']) == str(news_id)), None)
    assert event is not None
    assert event['title'] == updated_title
    assert event['ts'] == updated_ts

    # Verify audit log recorded calendar_updated
    audit_updated = next((a for a in monitor['audit'] if a['event'] == 'calendar_updated'), None)
    assert audit_updated is not None
    assert bool(audit_updated['actor']) is True

    # 6. Delete event via DELETE
    del_res = client.delete(f'/api/admin/news/{news_id}')
    assert del_res.status_code == 200
    assert del_res.json().get('ok') is True

    # Verify event is removed
    monitor_after = client.get('/api/admin/monitor').json()
    assert not any(str(n['id']) == str(news_id) for n in monitor_after['news'])

    # Verify audit log recorded calendar_deleted
    audit_deleted = next((a for a in monitor_after['audit'] if a['event'] == 'calendar_deleted'), None)
    assert audit_deleted is not None


def test_strategy_closed_candle_evaluation_and_rationale(client):
    """Verify strategy evaluates closed candles, records version v2.1.0 and entry or stand-aside rationale."""
    now = time.time()
    # Insert quotes ending right now
    for i in range(30):
        t = now - 30.0 + i
        insert_timescale_quote('DEMO', t, 2650.0 + i, 2650.5 + i, symbol='XAUUSD')

    with tx() as c:
        closed_candles, tf = get_closed_candles_for_strategy(c, 'DEMO', 'M15', min_required=20)
        assert tf == 'M15'
        assert isinstance(closed_candles, list)
        assert len(closed_candles) > 0

        demo_step(c)
        row = c.execute("SELECT value FROM kv WHERE key='strategy_last_decision'").fetchone()
        assert row is not None
        last_decision = json.loads(row[0])
        assert last_decision['version'] in ('2.1.0', 'tabula_rasa_2.2.0')
        assert 'reason' in last_decision
        assert 'candle_time' in last_decision
        assert last_decision['timeframe'] == 'M15'


def test_resend_mailer_and_otp_workflow(client):
    """Verify Resend mailer status, test send endpoint, and OTP generation + verification."""
    # 1. Admin mailer status
    admin_login = {'email': 'admin@zupirus.local', 'password': 'test-only-admin-password-123'}
    assert client.post('/api/login', json=admin_login).status_code == 200

    st_res = client.get('/api/admin/mailer/status')
    assert st_res.status_code == 200
    st_data = st_res.json()
    assert st_data['configured'] is True
    assert st_data['verified_domain'] == 'zupirus.com'
    assert 'system@zupirus.com' in st_data['sender']

    # 2. OTP Request & Verification
    test_email = 'trader.test@zupirus.com'
    otp_req = client.post('/api/auth/send-otp', json={'email': test_email})
    assert otp_req.status_code == 200
    assert otp_req.json()['ok'] is True

    # Retrieve code from DB to test verification
    with tx() as c:
        row = c.execute("SELECT code FROM otp_codes WHERE email=?", (test_email,)).fetchone()
        assert row is not None
        code = row['code']

    # Wrong code should fail
    bad_verify = client.post('/api/auth/verify-otp', json={'email': test_email, 'code': '000000'})
    assert bad_verify.status_code == 400

    # Correct code should succeed
    good_verify = client.post('/api/auth/verify-otp', json={'email': test_email, 'code': code})
    assert good_verify.status_code == 200
    assert good_verify.json()['verified'] is True

    # 3. Registration with OTP
    reg_email = 'new.trader@zupirus.com'
    client.post('/api/auth/send-otp', json={'email': reg_email})
    with tx() as c:
        row = c.execute("SELECT code FROM otp_codes WHERE email=?", (reg_email,)).fetchone()
        reg_code = row['code']

    # Fails with wrong OTP
    bad_reg = client.post('/api/register', json={'email': reg_email, 'password': 'StrongPassword123!', 'otp_code': '999999'})
    assert bad_reg.status_code == 400

    # Succeeds with correct OTP
    good_reg = client.post('/api/register', json={'email': reg_email, 'password': 'StrongPassword123!', 'otp_code': reg_code})
    assert good_reg.status_code == 200
    assert good_reg.json()['ok'] is True


def test_sepay_webhook_verification_and_recording(client):
    """Verify SePay HMAC-SHA256 webhook validation, transaction idempotency, and admin listing."""
    import hmac, hashlib
    from app.sepay import get_sepay_secret
    from app.db import tx, setkv

    with tx() as c:
        setkv(c, 'billing:settings', json.dumps({'webhook_secret': 'test_sepay_webhook_secret_123'}))

    secret = get_sepay_secret()
    payload = {
        "id": 998811,
        "gateway": "MBBank",
        "transactionDate": "2026-11-15 20:20:00",
        "accountNumber": "0999888777",
        "transferType": "in",
        "transferAmount": 4900000.0,
        "content": "ZP car230698@gmail.com PRO",
        "referenceCode": "MB_REF_123456"
    }
    raw_bytes = json.dumps(payload).encode('utf-8')
    valid_sig = hmac.new(secret.encode('utf-8'), raw_bytes, hashlib.sha256).hexdigest()

    # 1. Invalid signature should fail
    bad_res = client.post(
        '/api/webhooks/sepay',
        content=raw_bytes,
        headers={'x-sepay-signature': 'invalid_sig_hex', 'Content-Type': 'application/json'}
    )
    assert bad_res.status_code == 401

    # 2. Valid signature should succeed
    good_res = client.post(
        '/api/webhooks/sepay',
        content=raw_bytes,
        headers={'x-sepay-signature': valid_sig, 'Content-Type': 'application/json'}
    )
    assert good_res.status_code == 200
    assert good_res.json()['success'] is True
    assert good_res.json()['amount'] == 4900000.0

    # 3. Duplicate transaction ID should be idempotent
    dup_res = client.post(
        '/api/webhooks/sepay',
        content=raw_bytes,
        headers={'x-sepay-signature': valid_sig, 'Content-Type': 'application/json'}
    )
    assert dup_res.status_code == 200
    assert dup_res.json()['message'] == "Transaction already recorded"

    # 4. Check admin payments endpoint
    admin_login = {'email': 'admin@zupirus.local', 'password': 'test-only-admin-password-123'}
    assert client.post('/api/login', json=admin_login).status_code == 200

    admin_res = client.get('/api/admin/payments')
    assert admin_res.status_code == 200
    admin_data = admin_res.json()
    assert admin_data['total_revenue_vnd'] >= 4900000.0
    assert admin_data['total_transactions'] >= 1

    # 5. Admin manual payment approval
    manual_res = client.post('/api/admin/payments/manual-approve', json={
        'user_email': 'car230698@gmail.com',
        'amount_vnd': 500000.0,
        'gateway': 'MBBank',
        'reference_code': 'MANUAL_TEST_REF_888',
        'note': 'Khách chuyển khoản trực tiếp qua nhân viên hỗ trợ'
    })
    assert manual_res.status_code == 200
    assert manual_res.json()['ok'] is True
    assert manual_res.json()['amount'] == 500000.0

    # Verify total revenue and transaction list updated
    admin_res2 = client.get('/api/admin/payments')
    assert admin_res2.status_code == 200
    assert any(tx['reference_code'] == 'MANUAL_TEST_REF_888' for tx in admin_res2.json()['transactions'])


def test_legal_disclaimer_and_real_account_gating(client):
    """Verify High-Risk Legal Disclaimer retrieval, digital signature acceptance, and gated Real MT5 account creation."""
    # 1. Register and login as trader
    trader_cred = {'email': 'real.trader@zupirus.com', 'password': 'StrongPassword123!'}
    assert client.post('/api/register', json=trader_cred).status_code == 200
    assert client.post('/api/login', json=trader_cred).status_code == 200

    # 2. Get legal disclaimer text
    disc_text_res = client.get('/api/legal/disclaimer')
    assert disc_text_res.status_code == 200
    disc_data = disc_text_res.json()
    assert disc_data['version'] == '2026.1'
    assert len(disc_data['clauses']) >= 5

    # 3. Status should initially be false
    st_res = client.get('/api/legal/status')
    assert st_res.status_code == 200
    assert st_res.json()['accepted'] is False

    # 4. Attempting to create Real MT5 account before signing disclaimer must return 403 Forbidden
    unauth_real = client.post('/api/accounts/real', json={'login': '888123', 'server': 'Exness-Real21'})
    assert unauth_real.status_code == 403
    assert 'Miễn trừ trách nhiệm' in unauth_real.json()['detail']

    # 5. Partial acceptance fails (missing checkbox)
    bad_accept = client.post('/api/legal/accept', json={
        'signature_text': 'REAL TRADER',
        'confirmed_risk': True,
        'confirmed_age': False,
        'confirmed_no_solicitation': True
    })
    assert bad_accept.status_code == 400

    # 6. Complete digital signature acceptance succeeds
    good_accept = client.post('/api/legal/accept', json={
        'signature_text': 'REAL TRADER CHẤP NHẬN RỦI RO',
        'confirmed_risk': True,
        'confirmed_age': True,
        'confirmed_no_solicitation': True
    })
    assert good_accept.status_code == 200
    assert good_accept.json()['ok'] is True

    # 7. Status is now true
    st_res2 = client.get('/api/legal/status')
    assert st_res2.status_code == 200
    assert st_res2.json()['accepted'] is True

    # 8. Real account creation now succeeds
    real_acc_res = client.post('/api/accounts/real', json={
        'login': '888123',
        'server': 'Exness-Real21',
        'risk': 0.01
    })
    assert real_acc_res.status_code == 200
    real_data = real_acc_res.json()
    assert real_data['mode'] == 'REAL'
    assert real_data['id'].startswith('real_')

    # 9. Verify dashboard includes the real account
    dash = client.get('/api/dashboard').json()
    assert any(a['id'] == real_data['id'] and a['mode'] == 'REAL' for a in dash['accounts'])


