import os,sys
from pathlib import Path

# Live order-routing tests target modules removed from the quant-library product.
# They stay in the tree as history. The product test is that those modules do not import.
collect_ignore = [
    "test_end_to_end_autonomous_system.py",
    "test_full_autonomous_lifecycle.py",
    "test_institutional_quant_upgrades.py",
    "test_multi_strategy_and_metrics.py",
    "test_p0_execution_safety.py",
    "test_prop_live_rules.py",
    "test_spec_6_phases_complete.py",
    "test_watcher_and_metaapi_positions.py",
    "test_audit_10_points_remediation.py",
    "test_audit_11_defects_verification.py",
    "test_audit_20_defects_verification.py",
    "test_audit_716e543_deep_fixes.py",
    "test_autonomous_v2_simulation.py",
    "test_defect_fixes_2fc4df7.py",
    "test_defect_fixes_411e342.py",
    "test_defect_fixes_metaapi_6points.py",
    # These modules assert the removed MT5 / copy-trade / fan-out product.
    "test_admin_ai_and_user_deletion.py",
    "test_admin_control_plane.py",
    "test_audit_remediation.py",
    "test_crash_model.py",
    "test_dashboard_cloud_accounts.py",
    "test_defect_fixes_ab87ffc.py",
    "test_dynamic_skills_registry.py",
    "test_hybrid_signals_and_billing.py",
    "test_metaapi_direct_execution.py",
    "test_more_safety.py",
    "test_notifications_and_export.py",
    "test_requirements_verification.py",
    "test_system.py",
    "test_tabula_rasa_learning.py",
    "test_ui_error_and_signal_bench.py",
    "test_user_and_admin_services_audit.py",
]
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
# Only default to SQLite if DATABASE_URL is not set in environment (preserves CI PostgreSQL/TimescaleDB setup)
if not os.environ.get('DATABASE_URL'):
    os.environ.pop('DATABASE_URL', None)
os.environ.setdefault('ADMIN_PASSWORD','test-only-admin-password-123')
os.environ['COOKIE_SECURE']='false'
os.environ['ALLOWED_ORIGINS']='http://testserver,http://localhost:8080'
os.environ['FEED_TOKEN']='f'*40
os.environ['ENABLE_LEGACY_EA_BRIDGE']='true'
os.environ.setdefault('ENABLE_LEGACY_CUSTOMER_EXECUTION','true')
import pytest
try:
    from fastapi.testclient import TestClient
    from app import db, main, research
except ImportError:
    TestClient = None
    db = main = research = None

@pytest.fixture
def client(tmp_path,monkeypatch):
    if TestClient is None or main is None:
        pytest.skip("FastAPI runtime dependencies not installed")
    from app.core import db as core_db
    if not os.environ.get('DATABASE_URL'):
        monkeypatch.delenv('DATABASE_URL', raising=False)
        monkeypatch.setattr(db,'DATABASE_URL','')
        monkeypatch.setattr(db,'_pg_pool',None)
        monkeypatch.setattr(db,'DB',tmp_path/'lab.sqlite3')
        monkeypatch.setattr(db,'DATA',tmp_path)
        monkeypatch.setattr(core_db,'DATABASE_URL','')
        monkeypatch.setattr(core_db,'_pg_pool',None)
        monkeypatch.setattr(core_db,'DB',tmp_path/'lab.sqlite3')
        monkeypatch.setattr(core_db,'DATA',tmp_path)
    else:
        monkeypatch.setattr(db,'DATA',tmp_path)
        monkeypatch.setattr(core_db,'DATA',tmp_path)
        from app.core.db import is_postgres
        if is_postgres():
            with db.tx() as cleanup_cur:
                try:
                    cleanup_cur.execute(
                        "TRUNCATE TABLE users, orders, quotes, candles, dispatches, signals, "
                        "strategy_candidates, signal_audit_logs CASCADE;"
                    )
                except Exception:
                    for tbl in (
                        'sim_positions',
                        'dispatches',
                        'metaapi_trade_executions',
                        'trading_accounts',
                        'metaapi_cloud_accounts',
                        'real_accounts',
                        'orders',
                        'subscriptions',
                        'sessions',
                        'otp_codes',
                        'accounts',
                        'users',
                    ):
                        try:
                            with db.tx() as fallback_cur:
                                fallback_cur.execute(f"DELETE FROM {tbl}")
                        except Exception:
                            pass
    monkeypatch.setattr(research,'DATA',tmp_path)
    from app.db import init as init_app_db
    init_app_db()
    with db.tx() as boot_cur:
        try:
            from app.security import bootstrap
            bootstrap(boot_cur)
        except Exception:
            pass
        # Shared Postgres CI DBs can lose seed sources when other modules DELETE them.
        # Re-upsert the curator cold-start set so admin source tests stay deterministic.
        try:
            import time as _time
            now_ts = _time.time()
            for sid, sname, stype, sstat, suniv, score, pf, wr, mdd, tot, ev in (
                ("src_tv_primary", "TradingView Webhook Primary", "tradingview_webhook", "ACTIVE_LIVE", "XAUUSD,EURUSD,GBPUSD,USDJPY", 86.5, 1.82, 0.64, 45.0, 120, 120),
                ("src_zupirus_agent", "Zupirus AI Inductive Engine", "agent_inductive", "ACTIVE_LIVE", "XAUUSD", 88.5, 1.92, 0.66, 22.0, 110, 110),
                ("src_gold_momentum", "PineScript XAUUSD Trend Seeker", "pinescript_scraper", "SHADOW_ONLY", "XAUUSD", 74.0, 1.48, 0.53, 72.0, 48, 48),
                ("src_fx_breakout", "London FX Squeeze Alpha", "external_feed", "SHADOW_ONLY", "EURUSD,GBPUSD", 71.5, 1.42, 0.51, 80.0, 36, 36),
            ):
                boot_cur.execute(
                    """
                    INSERT INTO signal_sources (
                        id, name, source_type, status, symbol_universe,
                        trust_score, profit_factor, win_rate, max_drawdown_pips,
                        total_signals, evaluated_signals, config_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
                    ON CONFLICT (id) DO UPDATE SET
                        name = excluded.name,
                        status = excluded.status,
                        trust_score = excluded.trust_score,
                        updated_at = excluded.updated_at
                    """,
                    (sid, sname, stype, sstat, suniv, score, pf, wr, mdd, tot, ev, now_ts, now_ts),
                )
        except Exception:
            pass
    with TestClient(main.app) as c:
        c.headers.update({'X-Zupirus':'1'})
        yield c

@pytest.fixture
def customer(client):
    try:
        with db.tx() as c:
            for tbl in (
                'sim_positions',
                'dispatches',
                'metaapi_trade_executions',
            ):
                try:
                    c.execute(f"DELETE FROM {tbl}")
                except Exception:
                    pass
            c.execute("DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email = 'alice@example.com')")
            c.execute("DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE email = 'alice@example.com')")
            c.execute("DELETE FROM trading_accounts WHERE user_id IN (SELECT id FROM users WHERE email = 'alice@example.com')")
            c.execute("DELETE FROM metaapi_cloud_accounts WHERE user_id IN (SELECT id FROM users WHERE email = 'alice@example.com')")
            c.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = 'alice@example.com')")
            c.execute("DELETE FROM accounts WHERE user_id IN (SELECT id FROM users WHERE email = 'alice@example.com')")
            c.execute("DELETE FROM users WHERE email = 'alice@example.com'")
    except Exception:
        pass
    p={'email':'alice@example.com','password':'customer-password-123'}
    assert client.post('/api/register',json=p).status_code==200
    assert client.post('/api/login',json=p).status_code==200
    return client

@pytest.fixture
def demo(customer):
    c=customer
    aid=c.post('/api/accounts',json={'login':'12345','server':'Broker-Demo','mode':'DEMO'}).json()['id']
    c.put(f'/api/accounts/{aid}/risk',json={'enabled':True,'risk':.25,'max_spread':.8,'max_positions':1,'max_dd':10})
    code=c.post(f'/api/accounts/{aid}/pair').json()['code']
    identity={'login':'12345','server':'Broker-Demo','mode':'DEMO'}
    r=c.post('/api/ea/pair',json={**identity,'code':code});assert r.status_code==200
    headers={'Authorization':'Bearer '+r.text}
    assert c.post('/api/ea/heartbeat',headers=headers,json={**identity,'balance':10000,'equity':10000,'positions':0}).status_code==200
    return c,aid,identity,headers
