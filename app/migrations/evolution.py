import logging

logger = logging.getLogger("zupirus.migrations")

def apply_migration_008(c, is_pg: bool):
    """Create legal_disclaimers and real_accounts tables for terms compliance and real MT5 accounts."""
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS legal_disclaimers (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            terms_version TEXT NOT NULL,
            accepted_at DOUBLE PRECISION NOT NULL,
            ip_address TEXT,
            signature_text TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
        );
        CREATE INDEX IF NOT EXISTS idx_disclaimer_user ON legal_disclaimers(user_id);

        CREATE TABLE IF NOT EXISTS real_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            login TEXT NOT NULL,
            server TEXT NOT NULL,
            disclaimer_id TEXT REFERENCES legal_disclaimers(id),
            mode TEXT NOT NULL DEFAULT 'REAL',
            enabled INTEGER NOT NULL DEFAULT 0,
            risk DOUBLE PRECISION NOT NULL DEFAULT 0.01,
            max_spread DOUBLE PRECISION NOT NULL DEFAULT 0.8,
            max_positions INTEGER NOT NULL DEFAULT 1,
            max_dd DOUBLE PRECISION NOT NULL DEFAULT 5.0,
            balance DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            equity DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            peak DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            seen DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            created_at DOUBLE PRECISION NOT NULL,
            UNIQUE(login, server)
        );
        CREATE INDEX IF NOT EXISTS idx_real_acc_user ON real_accounts(user_id);
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS legal_disclaimers (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            terms_version TEXT NOT NULL,
            accepted_at REAL NOT NULL,
            ip_address TEXT,
            signature_text TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
        );
        CREATE INDEX IF NOT EXISTS idx_disclaimer_user ON legal_disclaimers(user_id);

        CREATE TABLE IF NOT EXISTS real_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            login TEXT NOT NULL,
            server TEXT NOT NULL,
            disclaimer_id TEXT REFERENCES legal_disclaimers(id),
            mode TEXT NOT NULL DEFAULT 'REAL',
            enabled INTEGER NOT NULL DEFAULT 0,
            risk REAL NOT NULL DEFAULT 0.01,
            max_spread REAL NOT NULL DEFAULT 0.8,
            max_positions INTEGER NOT NULL DEFAULT 1,
            max_dd REAL NOT NULL DEFAULT 5.0,
            balance REAL NOT NULL DEFAULT 0.0,
            equity REAL NOT NULL DEFAULT 0.0,
            peak REAL NOT NULL DEFAULT 0.0,
            seen REAL NOT NULL DEFAULT 0.0,
            created_at REAL NOT NULL,
            UNIQUE(login, server)
        );
        CREATE INDEX IF NOT EXISTS idx_real_acc_user ON real_accounts(user_id);
        """)


def apply_migration_009(c, is_pg: bool):
    """Create metaapi_cloud_accounts and metaapi_trade_executions tables for Direct-to-User cloud execution."""
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS metaapi_cloud_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            login TEXT NOT NULL,
            server TEXT NOT NULL,
            platform TEXT NOT NULL DEFAULT 'mt5',
            account_name TEXT,
            metaapi_account_id TEXT,
            metaapi_state TEXT NOT NULL DEFAULT 'DEPLOYED',
            disclaimer_id TEXT REFERENCES legal_disclaimers(id),
            risk_percent DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            max_lot DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            auto_trade INTEGER NOT NULL DEFAULT 1,
            balance DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            equity DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            currency TEXT NOT NULL DEFAULT 'USD',
            encrypted_password TEXT,
            last_sync DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            created_at DOUBLE PRECISION NOT NULL,
            UNIQUE(login, server)
        );
        CREATE INDEX IF NOT EXISTS idx_metaapi_acc_user ON metaapi_cloud_accounts(user_id);

        CREATE TABLE IF NOT EXISTS metaapi_trade_executions (
            id TEXT PRIMARY KEY,
            signal_id TEXT NOT NULL,
            account_id TEXT REFERENCES metaapi_cloud_accounts(id),
            metaapi_account_id TEXT,
            symbol TEXT NOT NULL DEFAULT 'XAUUSD',
            action TEXT NOT NULL,
            volume DOUBLE PRECISION NOT NULL,
            entry_price DOUBLE PRECISION NOT NULL,
            sl DOUBLE PRECISION,
            tp DOUBLE PRECISION,
            position_id TEXT,
            order_id TEXT,
            ticket TEXT,
            origin TEXT NOT NULL DEFAULT 'UNKNOWN',
            client_order_id TEXT,
            evidence_json TEXT,
            reserved_risk_pct DOUBLE PRECISION DEFAULT 0.0,
            sl_confirmed INTEGER DEFAULT 0,
            closed_volume DOUBLE PRECISION DEFAULT 0.0,
            last_verified_at DOUBLE PRECISION,
            status TEXT NOT NULL,
            latency_ms INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            executed_at DOUBLE PRECISION NOT NULL,
            closed_at DOUBLE PRECISION,
            profit DOUBLE PRECISION,
            UNIQUE(signal_id, account_id)
        );
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_sig ON metaapi_trade_executions(signal_id);
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_acc ON metaapi_trade_executions(account_id);
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_client_order ON metaapi_trade_executions(account_id, client_order_id);
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_origin ON metaapi_trade_executions(origin);
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS metaapi_cloud_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            login TEXT NOT NULL,
            server TEXT NOT NULL,
            platform TEXT NOT NULL DEFAULT 'mt5',
            account_name TEXT,
            metaapi_account_id TEXT,
            metaapi_state TEXT NOT NULL DEFAULT 'DEPLOYED',
            disclaimer_id TEXT REFERENCES legal_disclaimers(id),
            risk_percent REAL NOT NULL DEFAULT 1.0,
            max_lot REAL NOT NULL DEFAULT 1.0,
            multiplier REAL NOT NULL DEFAULT 1.0,
            auto_trade INTEGER NOT NULL DEFAULT 1,
            balance REAL NOT NULL DEFAULT 0.0,
            equity REAL NOT NULL DEFAULT 0.0,
            currency TEXT NOT NULL DEFAULT 'USD',
            encrypted_password TEXT,
            last_sync REAL NOT NULL DEFAULT 0.0,
            created_at REAL NOT NULL,
            UNIQUE(login, server)
        );
        CREATE INDEX IF NOT EXISTS idx_metaapi_acc_user ON metaapi_cloud_accounts(user_id);

        CREATE TABLE IF NOT EXISTS metaapi_trade_executions (
            id TEXT PRIMARY KEY,
            signal_id TEXT NOT NULL,
            account_id TEXT REFERENCES metaapi_cloud_accounts(id),
            metaapi_account_id TEXT,
            symbol TEXT NOT NULL DEFAULT 'XAUUSD',
            action TEXT NOT NULL,
            volume REAL NOT NULL,
            entry_price REAL NOT NULL,
            sl REAL,
            tp REAL,
            position_id TEXT,
            order_id TEXT,
            ticket TEXT,
            origin TEXT NOT NULL DEFAULT 'UNKNOWN',
            client_order_id TEXT,
            evidence_json TEXT,
            reserved_risk_pct REAL DEFAULT 0.0,
            sl_confirmed INTEGER DEFAULT 0,
            closed_volume REAL DEFAULT 0.0,
            last_verified_at REAL,
            status TEXT NOT NULL,
            latency_ms INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            executed_at REAL NOT NULL,
            closed_at REAL,
            profit REAL,
            UNIQUE(signal_id, account_id)
        );
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_sig ON metaapi_trade_executions(signal_id);
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_acc ON metaapi_trade_executions(account_id);
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_client_order ON metaapi_trade_executions(account_id, client_order_id);
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_origin ON metaapi_trade_executions(origin);
        """)


def apply_migration_010(c, is_pg: bool):
    """Migration 010: Standardize trading_accounts table for MetaApi Cloud and remove obsolete EA pairing tables."""
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS trading_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            mt5_login TEXT NOT NULL,
            encrypted_master_password TEXT NOT NULL,
            broker_server TEXT NOT NULL,
            metaapi_account_id TEXT,
            deployment_state TEXT NOT NULL DEFAULT 'DEPLOYED',
            risk_config TEXT NOT NULL DEFAULT '{"risk_percent": 1.0, "max_lot": 1.0, "multiplier": 1.0}',
            subscription_expires_at DOUBLE PRECISION,
            auto_trade INTEGER NOT NULL DEFAULT 1,
            balance DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            equity DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            created_at DOUBLE PRECISION NOT NULL,
            last_sync DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            UNIQUE(mt5_login, broker_server)
        );
        CREATE INDEX IF NOT EXISTS idx_trading_acc_user ON trading_accounts(user_id);
        DROP TABLE IF EXISTS pairings;
        DROP TABLE IF EXISTS devices;
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS trading_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            mt5_login TEXT NOT NULL,
            encrypted_master_password TEXT NOT NULL,
            broker_server TEXT NOT NULL,
            metaapi_account_id TEXT,
            deployment_state TEXT NOT NULL DEFAULT 'DEPLOYED',
            risk_config TEXT NOT NULL DEFAULT '{"risk_percent": 1.0, "max_lot": 1.0, "multiplier": 1.0}',
            subscription_expires_at REAL,
            auto_trade INTEGER NOT NULL DEFAULT 1,
            balance REAL NOT NULL DEFAULT 0.0,
            equity REAL NOT NULL DEFAULT 0.0,
            created_at REAL NOT NULL,
            last_sync REAL NOT NULL DEFAULT 0.0,
            UNIQUE(mt5_login, broker_server)
        );
        CREATE INDEX IF NOT EXISTS idx_trading_acc_user ON trading_accounts(user_id);
        DROP TABLE IF EXISTS pairings;
        DROP TABLE IF EXISTS devices;
        """)


def apply_migration_011(c, is_pg: bool):
    """Migration 011: Add subscriptions, orders with locked FX rate, signal audit logs, and cloud slot columns."""
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS subscriptions (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id) UNIQUE,
            plan_tier TEXT NOT NULL DEFAULT 'starter',
            service_expires_at DOUBLE PRECISION,
            max_mt5_accounts INTEGER NOT NULL DEFAULT 1,
            allow_custom_multiplier INTEGER NOT NULL DEFAULT 0,
            allow_compounding INTEGER NOT NULL DEFAULT 0,
            allow_partial_tp_be INTEGER NOT NULL DEFAULT 0,
            allow_prop_firm_mode INTEGER NOT NULL DEFAULT 0,
            allow_alpha_strategies INTEGER NOT NULL DEFAULT 0,
            created_at DOUBLE PRECISION NOT NULL,
            updated_at DOUBLE PRECISION NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sub_user ON subscriptions(user_id);

        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            amount_usd DOUBLE PRECISION NOT NULL,
            locked_exchange_rate DOUBLE PRECISION NOT NULL,
            amount_vnd BIGINT NOT NULL,
            plan_tier TEXT NOT NULL,
            cloud_slots_count INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'PENDING',
            payment_gateway TEXT NOT NULL DEFAULT 'SEPAY',
            sepay_transaction_id TEXT,
            created_at DOUBLE PRECISION NOT NULL,
            expires_at DOUBLE PRECISION NOT NULL,
            paid_at DOUBLE PRECISION
        );
        CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

        CREATE TABLE IF NOT EXISTS signal_audit_logs (
            id TEXT PRIMARY KEY,
            signal_id TEXT NOT NULL,
            source_name TEXT NOT NULL,
            strategy_tier TEXT NOT NULL DEFAULT 'STANDARD',
            symbol TEXT NOT NULL DEFAULT 'XAUUSD',
            side TEXT NOT NULL,
            entry_price DOUBLE PRECISION NOT NULL,
            stop_loss DOUBLE PRECISION,
            take_profit DOUBLE PRECISION,
            raw_payload TEXT,
            status TEXT NOT NULL,
            reject_reason TEXT,
            pnl DOUBLE PRECISION,
            created_at DOUBLE PRECISION NOT NULL,
            processed_at DOUBLE PRECISION
        );
        CREATE INDEX IF NOT EXISTS idx_sig_audit_created ON signal_audit_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sig_audit_status ON signal_audit_logs(status);

        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS cloud_expires_at DOUBLE PRECISION;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS risk_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS is_compounding INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS is_prop_firm_mode INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS prop_daily_dd_limit_pct DOUBLE PRECISION NOT NULL DEFAULT 4.5;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS prop_profit_target_pct DOUBLE PRECISION NOT NULL DEFAULT 8.0;
        ALTER TABLE metaapi_trade_executions ADD COLUMN IF NOT EXISTS ticket TEXT;
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS subscriptions (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id) UNIQUE,
            plan_tier TEXT NOT NULL DEFAULT 'starter',
            service_expires_at REAL,
            max_mt5_accounts INTEGER NOT NULL DEFAULT 1,
            allow_custom_multiplier INTEGER NOT NULL DEFAULT 0,
            allow_compounding INTEGER NOT NULL DEFAULT 0,
            allow_partial_tp_be INTEGER NOT NULL DEFAULT 0,
            allow_prop_firm_mode INTEGER NOT NULL DEFAULT 0,
            allow_alpha_strategies INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sub_user ON subscriptions(user_id);

        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            amount_usd REAL NOT NULL,
            locked_exchange_rate REAL NOT NULL,
            amount_vnd INTEGER NOT NULL,
            plan_tier TEXT NOT NULL,
            cloud_slots_count INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'PENDING',
            payment_gateway TEXT NOT NULL DEFAULT 'SEPAY',
            sepay_transaction_id TEXT,
            created_at REAL NOT NULL,
            expires_at REAL NOT NULL,
            paid_at REAL
        );
        CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

        CREATE TABLE IF NOT EXISTS signal_audit_logs (
            id TEXT PRIMARY KEY,
            signal_id TEXT NOT NULL,
            source_name TEXT NOT NULL,
            strategy_tier TEXT NOT NULL DEFAULT 'STANDARD',
            symbol TEXT NOT NULL DEFAULT 'XAUUSD',
            side TEXT NOT NULL,
            entry_price REAL NOT NULL,
            stop_loss REAL,
            take_profit REAL,
            raw_payload TEXT,
            status TEXT NOT NULL,
            reject_reason TEXT,
            pnl REAL,
            created_at REAL NOT NULL,
            processed_at REAL
        );
        CREATE INDEX IF NOT EXISTS idx_sig_audit_created ON signal_audit_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sig_audit_status ON signal_audit_logs(status);
        """)
        for col, col_def in [
            ("cloud_expires_at", "REAL"),
            ("risk_multiplier", "REAL NOT NULL DEFAULT 1.0"),
            ("is_compounding", "INTEGER NOT NULL DEFAULT 0"),
            ("is_prop_firm_mode", "INTEGER NOT NULL DEFAULT 0"),
            ("prop_daily_dd_limit_pct", "REAL NOT NULL DEFAULT 4.5"),
            ("prop_profit_target_pct", "REAL NOT NULL DEFAULT 8.0"),
            ("ticket", "TEXT")
        ]:
            try:
                c.execute(f"ALTER TABLE trading_accounts ADD COLUMN {col} {col_def}")
            except Exception:
                pass
        try:
            c.execute("ALTER TABLE metaapi_trade_executions ADD COLUMN ticket TEXT")
        except Exception:
            pass


def apply_migration_012(c, is_pg: bool):
    """Add context_snapshot and MAE/MFE to signal_audit_logs, create strategy_candidates table."""
    if is_pg:
        c.execute("""
        ALTER TABLE signal_audit_logs ADD COLUMN IF NOT EXISTS context_snapshot TEXT;
        ALTER TABLE signal_audit_logs ADD COLUMN IF NOT EXISTS mae DOUBLE PRECISION;
        ALTER TABLE signal_audit_logs ADD COLUMN IF NOT EXISTS mfe DOUBLE PRECISION;

        CREATE TABLE IF NOT EXISTS strategy_candidates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'DISCOVERED',
            rules_json TEXT NOT NULL,
            sample_size INTEGER NOT NULL DEFAULT 0,
            win_rate DOUBLE PRECISION,
            profit_factor DOUBLE PRECISION,
            sharpe_ratio DOUBLE PRECISION,
            max_drawdown_pct DOUBLE PRECISION,
            oos_net_units DOUBLE PRECISION,
            shadow_trades_count INTEGER NOT NULL DEFAULT 0,
            shadow_pnl DOUBLE PRECISION DEFAULT 0.0,
            created_at DOUBLE PRECISION NOT NULL,
            updated_at DOUBLE PRECISION
        );
        CREATE INDEX IF NOT EXISTS idx_strat_candidates_status ON strategy_candidates(status);
        """)
    else:
        for col, col_def in [
            ("context_snapshot", "TEXT"),
            ("mae", "REAL"),
            ("mfe", "REAL")
        ]:
            try:
                c.execute(f"ALTER TABLE signal_audit_logs ADD COLUMN {col} {col_def}")
            except Exception:
                pass

        c.executescript("""
        CREATE TABLE IF NOT EXISTS strategy_candidates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'DISCOVERED',
            rules_json TEXT NOT NULL,
            sample_size INTEGER NOT NULL DEFAULT 0,
            win_rate REAL,
            profit_factor REAL,
            sharpe_ratio REAL,
            max_drawdown_pct REAL,
            oos_net_units REAL,
            shadow_trades_count INTEGER NOT NULL DEFAULT 0,
            shadow_pnl REAL DEFAULT 0.0,
            created_at REAL NOT NULL,
            updated_at REAL
        );
        CREATE INDEX IF NOT EXISTS idx_strat_candidates_status ON strategy_candidates(status);
        """)
