import os
import time
import logging

logger = logging.getLogger("zupirus.migrations")

def apply_migration_013(c, is_pg: bool):
    """Multi-source curator funnel, shadow signals ledger, and broker symbol auto-discovery."""
    now_ts = time.time()
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS signal_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'SHADOW_ONLY',
            symbol_universe TEXT NOT NULL DEFAULT 'XAUUSD,EURUSD,GBPUSD,USDJPY',
            trust_score DOUBLE PRECISION NOT NULL DEFAULT 50.0,
            profit_factor DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            win_rate DOUBLE PRECISION NOT NULL DEFAULT 0.5,
            max_drawdown_pips DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            total_signals INTEGER NOT NULL DEFAULT 0,
            evaluated_signals INTEGER NOT NULL DEFAULT 0,
            config_json TEXT NOT NULL DEFAULT '{}',
            created_at DOUBLE PRECISION NOT NULL,
            updated_at DOUBLE PRECISION NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sig_sources_status ON signal_sources(status);

        CREATE TABLE IF NOT EXISTS shadow_signals (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL REFERENCES signal_sources(id),
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            entry_price DOUBLE PRECISION NOT NULL,
            stop_loss DOUBLE PRECISION NOT NULL,
            take_profit DOUBLE PRECISION,
            signal_time DOUBLE PRECISION NOT NULL,
            eval_status TEXT NOT NULL DEFAULT 'PENDING',
            mae DOUBLE PRECISION,
            mfe DOUBLE PRECISION,
            exit_price DOUBLE PRECISION,
            exit_time DOUBLE PRECISION,
            exit_reason TEXT,
            pnl_pips DOUBLE PRECISION,
            context_snapshot TEXT,
            created_at DOUBLE PRECISION NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_shadow_sig_source ON shadow_signals(source_id);
        CREATE INDEX IF NOT EXISTS idx_shadow_sig_eval ON shadow_signals(eval_status);

        CREATE TABLE IF NOT EXISTS account_symbol_map (
            account_id TEXT NOT NULL,
            standard_symbol TEXT NOT NULL,
            broker_symbol TEXT NOT NULL,
            contract_size DOUBLE PRECISION NOT NULL DEFAULT 100.0,
            tick_value DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            is_supported INTEGER NOT NULL DEFAULT 1,
            updated_at DOUBLE PRECISION NOT NULL,
            PRIMARY KEY (account_id, standard_symbol)
        );

        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'STANDARD';
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS contract_size DOUBLE PRECISION DEFAULT 100.0;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS tick_value DOUBLE PRECISION DEFAULT 1.0;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS auto_be_partial_tp INTEGER DEFAULT 0;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS latency_ms INTEGER DEFAULT 35;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS account_name TEXT;
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS signal_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'SHADOW_ONLY',
            symbol_universe TEXT NOT NULL DEFAULT 'XAUUSD,EURUSD,GBPUSD,USDJPY',
            trust_score REAL NOT NULL DEFAULT 50.0,
            profit_factor REAL NOT NULL DEFAULT 1.0,
            win_rate REAL NOT NULL DEFAULT 0.5,
            max_drawdown_pips REAL NOT NULL DEFAULT 0.0,
            total_signals INTEGER NOT NULL DEFAULT 0,
            evaluated_signals INTEGER NOT NULL DEFAULT 0,
            config_json TEXT NOT NULL DEFAULT '{}',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sig_sources_status ON signal_sources(status);

        CREATE TABLE IF NOT EXISTS shadow_signals (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL REFERENCES signal_sources(id),
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            entry_price REAL NOT NULL,
            stop_loss REAL NOT NULL,
            take_profit REAL,
            signal_time REAL NOT NULL,
            eval_status TEXT NOT NULL DEFAULT 'PENDING',
            mae REAL,
            mfe REAL,
            exit_price REAL,
            exit_time REAL,
            exit_reason TEXT,
            pnl_pips REAL,
            context_snapshot TEXT,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_shadow_sig_source ON shadow_signals(source_id);
        CREATE INDEX IF NOT EXISTS idx_shadow_sig_eval ON shadow_signals(eval_status);

        CREATE TABLE IF NOT EXISTS account_symbol_map (
            account_id TEXT NOT NULL,
            standard_symbol TEXT NOT NULL,
            broker_symbol TEXT NOT NULL,
            contract_size REAL NOT NULL DEFAULT 100.0,
            tick_value REAL NOT NULL DEFAULT 1.0,
            is_supported INTEGER NOT NULL DEFAULT 1,
            updated_at REAL NOT NULL,
            PRIMARY KEY (account_id, standard_symbol)
        );
        """)

        for col, col_def in [
            ("account_type", "TEXT DEFAULT 'STANDARD'"),
            ("currency", "TEXT DEFAULT 'USD'"),
            ("contract_size", "REAL DEFAULT 100.0"),
            ("tick_value", "REAL DEFAULT 1.0"),
            ("auto_be_partial_tp", "INTEGER DEFAULT 0"),
            ("latency_ms", "INTEGER DEFAULT 35"),
            ("account_name", "TEXT")
        ]:
            try:
                c.execute(f"ALTER TABLE trading_accounts ADD COLUMN {col} {col_def}")
            except Exception:
                pass

    # Seed initial seed sources for Cold-Start Bootstrapping (no Master Account copy source)
    initial_sources = [
        ("src_tv_primary", "TradingView Webhook Primary", "tradingview_webhook", "ACTIVE_LIVE", "XAUUSD,EURUSD,GBPUSD,USDJPY", 86.5, 1.82, 0.64, 45.0, 120, 120),
        ("src_zupirus_agent", "Zupirus AI Inductive Engine", "agent_inductive", "ACTIVE_LIVE", "XAUUSD", 88.5, 1.92, 0.66, 22.0, 110, 110),
        ("src_gold_momentum", "PineScript XAUUSD Trend Seeker", "pinescript_scraper", "SHADOW_ONLY", "XAUUSD", 74.0, 1.48, 0.53, 72.0, 48, 48),
        ("src_fx_breakout", "London FX Squeeze Alpha", "external_feed", "SHADOW_ONLY", "EURUSD,GBPUSD", 71.5, 1.42, 0.51, 80.0, 36, 36),
    ]

    for sid, sname, stype, sstat, suniv, score, pf, wr, mdd, tot, ev in initial_sources:
        if is_pg:
            c.execute("""
            INSERT INTO signal_sources (
                id, name, source_type, status, symbol_universe,
                trust_score, profit_factor, win_rate, max_drawdown_pips,
                total_signals, evaluated_signals, config_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
            ON CONFLICT (id) DO NOTHING
            """, (sid, sname, stype, sstat, suniv, score, pf, wr, mdd, tot, ev, now_ts, now_ts))
        else:
            try:
                c.execute("""
                INSERT INTO signal_sources (
                    id, name, source_type, status, symbol_universe,
                    trust_score, profit_factor, win_rate, max_drawdown_pips,
                    total_signals, evaluated_signals, config_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
                ON CONFLICT (id) DO NOTHING
                """, (sid, sname, stype, sstat, suniv, score, pf, wr, mdd, tot, ev, now_ts, now_ts))
            except Exception:
                c.execute("""
                INSERT OR IGNORE INTO signal_sources (
                    id, name, source_type, status, symbol_universe,
                    trust_score, profit_factor, win_rate, max_drawdown_pips,
                    total_signals, evaluated_signals, config_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
                """, (sid, sname, stype, sstat, suniv, score, pf, wr, mdd, tot, ev, now_ts, now_ts))


def apply_migration_014(c, is_pg: bool):
    """Dynamic Agent Skill Registry: creates agent_skills table and seeds 5 core analytical skills."""
    now_ts = time.time()
    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS agent_skills (
            id TEXT PRIMARY KEY,
            skill_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            trigger_condition TEXT NOT NULL,
            skill_md TEXT NOT NULL,
            is_builtin INTEGER NOT NULL DEFAULT 1,
            usage_count INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at DOUBLE PRECISION NOT NULL,
            updated_at DOUBLE PRECISION NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_skills_enabled ON agent_skills(enabled);
        CREATE INDEX IF NOT EXISTS idx_agent_skills_builtin ON agent_skills(is_builtin);
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS agent_skills (
            id TEXT PRIMARY KEY,
            skill_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            trigger_condition TEXT NOT NULL,
            skill_md TEXT NOT NULL,
            is_builtin INTEGER NOT NULL DEFAULT 1,
            usage_count INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_skills_enabled ON agent_skills(enabled);
        CREATE INDEX IF NOT EXISTS idx_agent_skills_builtin ON agent_skills(is_builtin);
        """)

    # Seed 5 core analytical skills
    core_skills = [
        (
            "sk_market_regime_scanner",
            "market_regime_scanner",
            "Market Regime Scanner (ATR & Session)",
            "Đo lường biên độ ATR(14), cấu trúc biến động và xác định phiên giao dịch (Á/Âu/Mỹ) từ nến M1/M15/H1.",
            "Khi tiếp nhận tín hiệu mới hoặc cần xác định trạng thái biến động thị trường.",
            "# Market Regime Scanner\nĐo lường ATR(14) và xác định phiên giao dịch thực tế."
        ),
        (
            "sk_liquidity_spread_auditor",
            "liquidity_spread_auditor",
            "Liquidity & Spread Auditor",
            "Đối chiếu dữ liệu tick/nến M1 và nhật ký spread để phân biệt lệnh chạm SL do sai xu hướng vs giãn spread giao phiên hoặc quét thanh khoản.",
            "Khi có lệnh chạm Stop Loss hoặc kiểm toán hiệu suất sau đóng vị thế.",
            "# Liquidity & Spread Auditor\nKiểm toán nguyên nhân lệnh chạm Stop Loss (SL): TREND_FAIL, SPREAD_SPIKE_ROLLOVER, LIQUIDITY_SWEEP."
        ),
        (
            "sk_macro_news_interpreter",
            "macro_news_interpreter",
            "Macro News Interpreter",
            "Đối chiếu lịch kinh tế USD (CPI, NFP, FOMC) quanh thời điểm mở/đóng lệnh, gắn nhãn bối cảnh vĩ mô và độ nhạy tin tức.",
            "Trước khi mở vị thế hoặc phân tích độ nhạy tin tức của nguồn tín hiệu.",
            "# Macro News Interpreter\nPhân tích khoảng cách tới sự kiện kinh tế vĩ mô USD và kích hoạt News Shield khi <=30m."
        ),
        (
            "sk_source_grading_analyst",
            "source_grading_analyst",
            "Source Grading & Trust Analyst",
            "Chấm điểm EOD M1 Candle Grader cho kho SHADOW_ONLY (quy tắc bảo thủ SL ưu tiên), tính Profit Factor, Max Drawdown, MAE/MFE và Trust Score (0-100).",
            "Cuối ngày giao dịch (EOD) hoặc khi Admin yêu cầu xếp hạng lại các nguồn tín hiệu.",
            "# Source Grading Analyst\nChấm điểm nến M1 và cập nhật bảng xếp hạng tín nhiệm Trust Score."
        ),
        (
            "sk_strategy_synthesizer",
            "strategy_synthesizer",
            "Strategy Synthesizer & Walk-Forward Validator",
            "Truy xuất các quy tắc lặp lại từ Hindsight Semantic Memory, tổng hợp Ứng viên Chiến lược và chạy kiểm định Out-of-Sample trên TimescaleDB trước khi gửi Admin phê duyệt.",
            "Khi tích lũy đủ cụm lệnh thắng/thua hoặc định kỳ tổng hợp chiến lược mới.",
            "# Strategy Synthesizer\nĐóng gói cụm quy tắc từ Hindsight Memory thành Ứng viên Chiến lược mới."
        ),
    ]

    for sid, skid, sname, sdesc, strig, smd in core_skills:
        if is_pg:
            c.execute("""
            INSERT INTO agent_skills (
                id, skill_id, name, description, trigger_condition,
                skill_md, is_builtin, usage_count, enabled, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 1, ?, ?)
            ON CONFLICT (skill_id) DO NOTHING
            """, (sid, skid, sname, sdesc, strig, smd, now_ts, now_ts))
        else:
            try:
                c.execute("""
                INSERT INTO agent_skills (
                    id, skill_id, name, description, trigger_condition,
                    skill_md, is_builtin, usage_count, enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 1, ?, ?)
                ON CONFLICT (skill_id) DO NOTHING
                """, (sid, skid, sname, sdesc, strig, smd, now_ts, now_ts))
            except Exception:
                c.execute("""
                INSERT OR IGNORE INTO agent_skills (
                    id, skill_id, name, description, trigger_condition,
                    skill_md, is_builtin, usage_count, enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 1, ?, ?)
                """, (sid, skid, sname, sdesc, strig, smd, now_ts, now_ts))


def apply_migration_015(c, is_pg: bool):
    """Migration 015: Ensure ticket column exists in metaapi_trade_executions."""
    if is_pg:
        c.execute("ALTER TABLE metaapi_trade_executions ADD COLUMN IF NOT EXISTS ticket TEXT;")
    else:
        try:
            c.execute("ALTER TABLE metaapi_trade_executions ADD COLUMN ticket TEXT")
        except Exception:
            pass


def apply_migration_016(c, is_pg: bool):
    """Migration 016: Customer isolation on hindsight_memories, signal_dispatch_locks table, orders payment/entitlement/cloud states, trading_accounts full risk fields, and remove master feed source."""
    now_ts = time.time()
    if is_pg:
        c.execute("""
            ALTER TABLE hindsight_memories ADD COLUMN IF NOT EXISTS user_id TEXT;
            ALTER TABLE hindsight_memories ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'user';
            CREATE INDEX IF NOT EXISTS idx_hindsight_user_scope ON hindsight_memories(user_id, scope);

            CREATE TABLE IF NOT EXISTS signal_dispatch_locks (
                id TEXT PRIMARY KEY,
                signal_fingerprint TEXT NOT NULL,
                account_id TEXT NOT NULL,
                worker_id TEXT,
                created_at DOUBLE PRECISION NOT NULL,
                UNIQUE(signal_fingerprint, account_id)
            );
            CREATE INDEX IF NOT EXISTS idx_signal_dispatch_locks_fp ON signal_dispatch_locks(signal_fingerprint, account_id);

            ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount_vnd BIGINT NOT NULL DEFAULT 0;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'PENDING';
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS entitlement_status TEXT NOT NULL DEFAULT 'PENDING';
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS cloud_deploy_status TEXT NOT NULL DEFAULT 'PENDING';

            ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS max_lot DOUBLE PRECISION DEFAULT 5.0;
            ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS daily_profit_target_usd DOUBLE PRECISION DEFAULT 0.0;
            ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS symbol_mapping_custom TEXT DEFAULT '';
        """)
    else:
        for alter_sql in [
            "ALTER TABLE hindsight_memories ADD COLUMN user_id TEXT",
            "ALTER TABLE hindsight_memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'user'",
            "ALTER TABLE orders ADD COLUMN paid_amount_vnd INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'PENDING'",
            "ALTER TABLE orders ADD COLUMN entitlement_status TEXT NOT NULL DEFAULT 'PENDING'",
            "ALTER TABLE orders ADD COLUMN cloud_deploy_status TEXT NOT NULL DEFAULT 'PENDING'",
            "ALTER TABLE trading_accounts ADD COLUMN max_lot REAL DEFAULT 5.0",
            "ALTER TABLE trading_accounts ADD COLUMN daily_profit_target_usd REAL DEFAULT 0.0",
            "ALTER TABLE trading_accounts ADD COLUMN symbol_mapping_custom TEXT DEFAULT ''",
        ]:
            try:
                c.execute(alter_sql)
            except Exception:
                pass

        c.executescript("""
            CREATE INDEX IF NOT EXISTS idx_hindsight_user_scope ON hindsight_memories(user_id, scope);
            CREATE TABLE IF NOT EXISTS signal_dispatch_locks (
                id TEXT PRIMARY KEY,
                signal_fingerprint TEXT NOT NULL,
                account_id TEXT NOT NULL,
                worker_id TEXT,
                created_at REAL NOT NULL,
                UNIQUE(signal_fingerprint, account_id)
            );
            CREATE INDEX IF NOT EXISTS idx_signal_dispatch_locks_fp ON signal_dispatch_locks(signal_fingerprint, account_id);
        """)

    # Clean up legacy master feed source if present and ensure Zupirus AI Inductive Engine exists
    if is_pg:
        c.execute("SAVEPOINT sp_mig_016_seed")
    try:
        c.execute("DELETE FROM signal_sources WHERE id = 'src_metaapi_feed' OR source_type = 'metaapi_feed'")
        c.execute("""
            INSERT INTO signal_sources (
                id, name, source_type, status, symbol_universe,
                trust_score, profit_factor, win_rate, max_drawdown_pips,
                total_signals, evaluated_signals, config_json, created_at, updated_at
            ) VALUES ('src_zupirus_agent', 'Zupirus AI Inductive Engine', 'agent_inductive', 'ACTIVE_LIVE', 'XAUUSD', 88.5, 1.92, 0.66, 22.0, 110, 110, '{}', ?, ?)
            ON CONFLICT (id) DO NOTHING
        """, (now_ts, now_ts))
        if is_pg:
            c.execute("RELEASE SAVEPOINT sp_mig_016_seed")
    except Exception:
        if is_pg:
            c.execute("ROLLBACK TO SAVEPOINT sp_mig_016_seed")


def apply_migration_017(c, is_pg: bool):
    """Add prop_stage column ('CHALLENGE' | 'LIVE') to trading_accounts."""
    if is_pg:
        c.execute("ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS prop_stage TEXT NOT NULL DEFAULT 'CHALLENGE';")
    else:
        cols = [r[1] for r in c.execute("PRAGMA table_info(trading_accounts)").fetchall()]
        if "prop_stage" not in cols:
            c.execute("ALTER TABLE trading_accounts ADD COLUMN prop_stage TEXT NOT NULL DEFAULT 'CHALLENGE'")


def apply_migration_018(c, is_pg: bool):
    """Add volume, closed_at, and profit columns to dispatches table for soft-closing and accurate lot display."""
    if is_pg:
        c.execute("""
            ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS volume DOUBLE PRECISION DEFAULT 0.01;
            ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS closed_at DOUBLE PRECISION;
            ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS profit DOUBLE PRECISION DEFAULT 0.0;
        """)
    else:
        cols = [r[1] for r in c.execute("PRAGMA table_info(dispatches)").fetchall()]
        if "volume" not in cols:
            try:
                c.execute("ALTER TABLE dispatches ADD COLUMN volume REAL DEFAULT 0.01")
            except Exception:
                pass
        if "closed_at" not in cols:
            try:
                c.execute("ALTER TABLE dispatches ADD COLUMN closed_at REAL")
            except Exception:
                pass
        if "profit" not in cols:
            try:
                c.execute("ALTER TABLE dispatches ADD COLUMN profit REAL DEFAULT 0.0")
            except Exception:
                pass


def apply_migration_019(c, is_pg: bool):
    """019_knowledge_chunks_rag: Semantic RAG knowledge_chunks table with pgvector support and hybrid fallback."""
    if is_pg:
        c.execute("""
            CREATE TABLE IF NOT EXISTS knowledge_chunks (
                id TEXT PRIMARY KEY,
                skill_id TEXT NOT NULL,
                school TEXT,
                doc_type TEXT,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding_json TEXT,
                created_at DOUBLE PRECISION NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_skill ON knowledge_chunks(skill_id);
            CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_school ON knowledge_chunks(school);
        """)
        enable_pgvector = os.getenv("ENABLE_PGVECTOR", "true").lower() in ("true", "1", "yes")
        if enable_pgvector:
            c.execute("SAVEPOINT sp_mig_019_vector")
            try:
                c.execute("CREATE EXTENSION IF NOT EXISTS vector;")
                c.execute("ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding vector(768);")
                c.execute("RELEASE SAVEPOINT sp_mig_019_vector")
            except Exception as e:
                logger.warning(f"pgvector extension not available or failed: {e}. Falling back to embedding_json.")
                c.execute("ROLLBACK TO SAVEPOINT sp_mig_019_vector")
    else:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS knowledge_chunks (
                id TEXT PRIMARY KEY,
                skill_id TEXT NOT NULL,
                school TEXT,
                doc_type TEXT,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding_json TEXT,
                created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_skill ON knowledge_chunks(skill_id);
            CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_school ON knowledge_chunks(school);
        """)


def apply_migration_020(c, is_pg: bool):
    """020_notifications_system: In-App notification storage with user, role, severity, and read tracking."""
    if is_pg:
        c.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                role TEXT NOT NULL DEFAULT 'user',
                severity TEXT NOT NULL DEFAULT 'INFO',
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                meta_json TEXT,
                read_at DOUBLE PRECISION,
                created_at DOUBLE PRECISION NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_role ON notifications(role);
            CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
        """)
    else:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                role TEXT NOT NULL DEFAULT 'user',
                severity TEXT NOT NULL DEFAULT 'INFO',
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                meta_json TEXT,
                read_at REAL,
                created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_role ON notifications(role);
            CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
        """)


def apply_migration_021(c, is_pg: bool):
    """021_trading_accounts_allowed_strategies: Multi-strategy allocation column for Growth & Alpha tiers."""
    if is_pg:
        c.execute("ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS allowed_strategy_ids TEXT DEFAULT NULL;")
    else:
        cols = [r[1] for r in c.execute("PRAGMA table_info(trading_accounts)").fetchall()]
        if "allowed_strategy_ids" not in cols:
            try:
                c.execute("ALTER TABLE trading_accounts ADD COLUMN allowed_strategy_ids TEXT DEFAULT NULL")
            except Exception:
                pass


def apply_migration_022(c, is_pg: bool):
    """022_align_quotes_hypertable_unique_constraint: Align quotes hypertable unique constraint with (time, source, symbol, ts)."""
    if is_pg:
        c.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'uq_quotes' AND conrelid = 'quotes'::regclass
                  AND array_length(conkey, 1) < 4
            ) THEN
                ALTER TABLE quotes DROP CONSTRAINT uq_quotes;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_quotes' AND conrelid = 'quotes'::regclass
            ) THEN
                ALTER TABLE quotes ADD CONSTRAINT uq_quotes UNIQUE ("time", source, symbol, ts);
            END IF;
        END $$;
        """)


def apply_migration_023(c, is_pg: bool):
    """023_execution_safety_and_ownership: Add origin, client_order_id, evidence_json, reserved_risk_pct, sl_confirmed, closed_volume to metaapi_trade_executions and strategy_id to signal_audit_logs."""
    if is_pg:
        c.execute("""
        ALTER TABLE metaapi_trade_executions ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'UNKNOWN';
        ALTER TABLE metaapi_trade_executions ADD COLUMN IF NOT EXISTS client_order_id TEXT;
        ALTER TABLE metaapi_trade_executions ADD COLUMN IF NOT EXISTS evidence_json TEXT;
        ALTER TABLE metaapi_trade_executions ADD COLUMN IF NOT EXISTS reserved_risk_pct DOUBLE PRECISION DEFAULT 0.0;
        ALTER TABLE metaapi_trade_executions ADD COLUMN IF NOT EXISTS sl_confirmed INTEGER DEFAULT 0;
        ALTER TABLE metaapi_trade_executions ADD COLUMN IF NOT EXISTS closed_volume DOUBLE PRECISION DEFAULT 0.0;
        ALTER TABLE metaapi_trade_executions ADD COLUMN IF NOT EXISTS last_verified_at DOUBLE PRECISION;
        ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS last_verified_at DOUBLE PRECISION;
        ALTER TABLE signal_audit_logs ADD COLUMN IF NOT EXISTS strategy_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_acc_client_order ON metaapi_trade_executions(account_id, client_order_id);
        CREATE INDEX IF NOT EXISTS idx_metaapi_exec_origin ON metaapi_trade_executions(origin);
        CREATE INDEX IF NOT EXISTS idx_sig_audit_strat ON signal_audit_logs(strategy_id);
        """)
    else:
        cols = [r[1] for r in c.execute("PRAGMA table_info(metaapi_trade_executions)").fetchall()]
        new_cols = [
            ("origin", "TEXT NOT NULL DEFAULT 'UNKNOWN'"),
            ("client_order_id", "TEXT"),
            ("evidence_json", "TEXT"),
            ("reserved_risk_pct", "REAL DEFAULT 0.0"),
            ("sl_confirmed", "INTEGER DEFAULT 0"),
            ("closed_volume", "REAL DEFAULT 0.0"),
            ("last_verified_at", "REAL"),
            ("ticket", "TEXT"),
        ]
        for col_name, col_def in new_cols:
            if col_name not in cols:
                try:
                    c.execute(f"ALTER TABLE metaapi_trade_executions ADD COLUMN {col_name} {col_def}")
                except Exception:
                    pass
        sig_cols = [r[1] for r in c.execute("PRAGMA table_info(signal_audit_logs)").fetchall()]
        if "strategy_id" not in sig_cols:
            try:
                c.execute("ALTER TABLE signal_audit_logs ADD COLUMN strategy_id TEXT")
            except Exception:
                pass
        t_cols = [r[1] for r in c.execute("PRAGMA table_info(trading_accounts)").fetchall()]
        if "last_verified_at" not in t_cols:
            try:
                c.execute("ALTER TABLE trading_accounts ADD COLUMN last_verified_at REAL")
            except Exception:
                pass
        try:
            c.execute("CREATE INDEX IF NOT EXISTS idx_metaapi_exec_acc_client_order ON metaapi_trade_executions(account_id, client_order_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_metaapi_exec_origin ON metaapi_trade_executions(origin)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_sig_audit_strat ON signal_audit_logs(strategy_id)")
        except Exception:
            pass


def apply_migration_024(c, is_pg: bool):
    """024_user_language_and_intl_billing: Add preferred_language to users, and gateway, currency, external_payment_id, invoice_url to orders & payment_transactions."""
    if is_pg:
        c.execute("""
        ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'vi';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'VND';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS external_payment_id TEXT;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_url TEXT;
        ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS external_payment_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_orders_ext_pay ON orders(external_payment_id);
        CREATE INDEX IF NOT EXISTS idx_payment_ext_pay ON payment_transactions(external_payment_id);
        """)
    else:
        u_cols = [r[1] for r in c.execute("PRAGMA table_info(users)").fetchall()]
        if "preferred_language" not in u_cols:
            try:
                c.execute("ALTER TABLE users ADD COLUMN preferred_language TEXT NOT NULL DEFAULT 'vi'")
            except Exception:
                pass

        o_cols = [r[1] for r in c.execute("PRAGMA table_info(orders)").fetchall()]
        if "currency" not in o_cols:
            try:
                c.execute("ALTER TABLE orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'VND'")
            except Exception:
                pass
        if "external_payment_id" not in o_cols:
            try:
                c.execute("ALTER TABLE orders ADD COLUMN external_payment_id TEXT")
            except Exception:
                pass
        if "invoice_url" not in o_cols:
            try:
                c.execute("ALTER TABLE orders ADD COLUMN invoice_url TEXT")
            except Exception:
                pass

        p_cols = [r[1] for r in c.execute("PRAGMA table_info(payment_transactions)").fetchall()]
        if "external_payment_id" not in p_cols:
            try:
                c.execute("ALTER TABLE payment_transactions ADD COLUMN external_payment_id TEXT")
            except Exception:
                pass

        try:
            c.execute("CREATE INDEX IF NOT EXISTS idx_orders_ext_pay ON orders(external_payment_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_payment_ext_pay ON payment_transactions(external_payment_id)")
        except Exception:
            pass


def apply_migration_025(c, is_pg: bool):
    """025_direct_usdt_billing: Add expected_amount_usdt and tx_hash columns with unique indexes for Direct On-Chain USDT."""
    if is_pg:
        c.execute("""
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS expected_amount_usdt DOUBLE PRECISION;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS tx_hash TEXT;
        ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS tx_hash TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tx_hash_uniq ON orders(tx_hash) WHERE tx_hash IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_tx_hash_uniq ON payment_transactions(tx_hash) WHERE tx_hash IS NOT NULL;
        """)
    else:
        o_cols = [r[1] for r in c.execute("PRAGMA table_info(orders)").fetchall()]
        if "expected_amount_usdt" not in o_cols:
            try:
                c.execute("ALTER TABLE orders ADD COLUMN expected_amount_usdt REAL")
            except Exception:
                pass
        if "tx_hash" not in o_cols:
            try:
                c.execute("ALTER TABLE orders ADD COLUMN tx_hash TEXT")
            except Exception:
                pass

        p_cols = [r[1] for r in c.execute("PRAGMA table_info(payment_transactions)").fetchall()]
        if "tx_hash" not in p_cols:
            try:
                c.execute("ALTER TABLE payment_transactions ADD COLUMN tx_hash TEXT")
            except Exception:
                pass

        try:
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tx_hash_uniq ON orders(tx_hash) WHERE tx_hash IS NOT NULL")
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_tx_hash_uniq ON payment_transactions(tx_hash) WHERE tx_hash IS NOT NULL")
        except Exception:
            pass


def apply_migration_026(c, is_pg: bool):
    """026_snapshots_and_signals_constraints: Drop FK from snapshots to accounts (supports trading_accounts) and expand signals.source check constraint to allow CLOUD_MT5, TRADINGVIEW, MANUAL, ZUPIRUS_AGENT."""
    if is_pg:
        c.execute("""
        ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_account_id_fkey;
        ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_source_check;
        ALTER TABLE signals ADD CONSTRAINT signals_source_check CHECK(source IN ('DEMO', 'REPLAY', 'CLOUD_MT5', 'TRADINGVIEW', 'MANUAL', 'ZUPIRUS_AGENT'));
        """)
    else:
        # SQLite: Drop FK on snapshots referencing accounts and expand signals.source CHECK
        try:
            fk_rows = c.execute("PRAGMA foreign_key_list(snapshots)").fetchall()
            has_accounts_fk = any((r[2] if len(r) > 2 else "") == "accounts" for r in fk_rows)
            row = c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='snapshots'").fetchone()
            sql_def = (row[0] if row else "") or ""
            if has_accounts_fk or "REFERENCES accounts" in sql_def or "references accounts" in sql_def.lower():
                c.execute("PRAGMA foreign_keys = OFF")
                cols_info = c.execute("PRAGMA table_info(snapshots)").fetchall()
                col_names = [col[1] for col in cols_info]
                c.execute("""
                    CREATE TABLE snapshots_mig_026 (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        account_id TEXT,
                        ts REAL NOT NULL,
                        balance REAL NOT NULL,
                        equity REAL NOT NULL
                    )
                """)
                target_cols = [col[1] for col in c.execute("PRAGMA table_info(snapshots_mig_026)").fetchall()]
                common_cols = [c_name for c_name in col_names if c_name in target_cols]
                common_str = ", ".join(common_cols)
                if common_str:
                    c.execute(f"INSERT INTO snapshots_mig_026 ({common_str}) SELECT {common_str} FROM snapshots")
                c.execute("DROP TABLE snapshots")
                c.execute("ALTER TABLE snapshots_mig_026 RENAME TO snapshots")
                c.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_account_ts ON snapshots(account_id, ts DESC)")
                c.execute("PRAGMA foreign_keys = ON")
        except Exception as e:
            logger.warning(f"apply_migration_026 SQLite snapshots rebuild warning: {e}")

        try:
            row = c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='signals'").fetchone()
            sql_def = (row[0] if row else "") or ""
            if row and ("CLOUD_MT5" not in sql_def):
                c.execute("PRAGMA foreign_keys = OFF")
                cols_info = c.execute("PRAGMA table_info(signals)").fetchall()
                col_names = [col[1] for col in cols_info]
                c.execute("""
                    CREATE TABLE signals_mig_026 (
                        id TEXT PRIMARY KEY,
                        source TEXT NOT NULL CHECK(source IN ('DEMO', 'REPLAY', 'CLOUD_MT5', 'TRADINGVIEW', 'MANUAL', 'ZUPIRUS_AGENT')),
                        side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
                        price REAL NOT NULL,
                        sl REAL NOT NULL,
                        tp REAL NOT NULL,
                        created REAL NOT NULL,
                        expires REAL NOT NULL
                    )
                """)
                target_cols = [col[1] for col in c.execute("PRAGMA table_info(signals_mig_026)").fetchall()]
                common_cols = [c_name for c_name in col_names if c_name in target_cols]
                common_str = ", ".join(common_cols)
                if common_str:
                    c.execute(f"INSERT INTO signals_mig_026 ({common_str}) SELECT {common_str} FROM signals")
                c.execute("DROP TABLE signals")
                c.execute("ALTER TABLE signals_mig_026 RENAME TO signals")
                c.execute("CREATE INDEX IF NOT EXISTS idx_signals_source_expires ON signals(source, expires)")
                c.execute("PRAGMA foreign_keys = ON")
        except Exception as e:
            logger.warning(f"apply_migration_026 SQLite signals rebuild warning: {e}")


def apply_migration_027(c, is_pg: bool):
    """027_quant_research_reports_and_entitlements:
    Creates research_reports, report_versions, and report_entitlements tables for the XAU/USD Quantitative
    Research & PDF Report Platform, and adds product_type, report_id, report_version to orders.
    Seeds a flagship sample published report with public sample PDF and private full PDF.
    """
    import time
    import json
    from pathlib import Path

    if is_pg:
        c.execute("""
        CREATE TABLE IF NOT EXISTS research_reports (
            id TEXT PRIMARY KEY,
            slug TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            market TEXT NOT NULL DEFAULT 'XAU/USD',
            timeframe TEXT NOT NULL DEFAULT 'M15 / H1',
            version TEXT NOT NULL DEFAULT 'v1.0',
            status TEXT NOT NULL DEFAULT 'DRAFT',
            price_usd DOUBLE PRECISION NOT NULL DEFAULT 29.0,
            price_vnd BIGINT NOT NULL DEFAULT 750000,
            currency TEXT NOT NULL DEFAULT 'VND',
            sample_pdf_path TEXT,
            full_pdf_path TEXT,
            preview_highlights_json TEXT,
            research_candidate_id TEXT,
            wfo_metrics_json TEXT,
            published_at DOUBLE PRECISION,
            created_at DOUBLE PRECISION NOT NULL,
            updated_at DOUBLE PRECISION NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_research_reports_status ON research_reports(status, published_at DESC);
        CREATE INDEX IF NOT EXISTS idx_research_reports_slug ON research_reports(slug);

        CREATE TABLE IF NOT EXISTS report_versions (
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES research_reports(id),
            version TEXT NOT NULL,
            full_pdf_path TEXT NOT NULL,
            sample_pdf_path TEXT,
            changelog TEXT,
            wfo_metrics_json TEXT,
            published_at DOUBLE PRECISION NOT NULL,
            created_at DOUBLE PRECISION NOT NULL,
            UNIQUE(report_id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_report_versions_rep ON report_versions(report_id);

        CREATE TABLE IF NOT EXISTS report_entitlements (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            report_id TEXT NOT NULL REFERENCES research_reports(id),
            purchased_version TEXT NOT NULL,
            full_pdf_path TEXT NOT NULL,
            order_id TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            granted_at DOUBLE PRECISION NOT NULL,
            revoked_at DOUBLE PRECISION,
            UNIQUE(user_id, report_id, purchased_version)
        );
        CREATE INDEX IF NOT EXISTS idx_report_entitlements_user ON report_entitlements(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_report_entitlements_report ON report_entitlements(report_id);

        ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'SUBSCRIPTION';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS report_id TEXT;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS report_version TEXT;
        """)
    else:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS research_reports (
            id TEXT PRIMARY KEY,
            slug TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            market TEXT NOT NULL DEFAULT 'XAU/USD',
            timeframe TEXT NOT NULL DEFAULT 'M15 / H1',
            version TEXT NOT NULL DEFAULT 'v1.0',
            status TEXT NOT NULL DEFAULT 'DRAFT',
            price_usd REAL NOT NULL DEFAULT 29.0,
            price_vnd INTEGER NOT NULL DEFAULT 750000,
            currency TEXT NOT NULL DEFAULT 'VND',
            sample_pdf_path TEXT,
            full_pdf_path TEXT,
            preview_highlights_json TEXT,
            research_candidate_id TEXT,
            wfo_metrics_json TEXT,
            published_at REAL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_research_reports_status ON research_reports(status, published_at DESC);
        CREATE INDEX IF NOT EXISTS idx_research_reports_slug ON research_reports(slug);

        CREATE TABLE IF NOT EXISTS report_versions (
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES research_reports(id),
            version TEXT NOT NULL,
            full_pdf_path TEXT NOT NULL,
            sample_pdf_path TEXT,
            changelog TEXT,
            wfo_metrics_json TEXT,
            published_at REAL NOT NULL,
            created_at REAL NOT NULL,
            UNIQUE(report_id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_report_versions_rep ON report_versions(report_id);

        CREATE TABLE IF NOT EXISTS report_entitlements (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            report_id TEXT NOT NULL REFERENCES research_reports(id),
            purchased_version TEXT NOT NULL,
            full_pdf_path TEXT NOT NULL,
            order_id TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            granted_at REAL NOT NULL,
            revoked_at REAL,
            UNIQUE(user_id, report_id, purchased_version)
        );
        CREATE INDEX IF NOT EXISTS idx_report_entitlements_user ON report_entitlements(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_report_entitlements_report ON report_entitlements(report_id);
        """)
        o_cols = [r[1] for r in c.execute("PRAGMA table_info(orders)").fetchall()]
        for col_name, col_def in [
            ("product_type", "TEXT NOT NULL DEFAULT 'SUBSCRIPTION'"),
            ("report_id", "TEXT"),
            ("report_version", "TEXT"),
        ]:
            if col_name not in o_cols:
                try:
                    c.execute(f"ALTER TABLE orders ADD COLUMN {col_name} {col_def}")
                except Exception:
                    pass

    # Ensure sample PDF files and flagship published report exist
    try:
        from app.domains.reports.pdf_builder import ensure_flagship_sample_report_seeded
        ensure_flagship_sample_report_seeded(c)
    except Exception as seed_err:
        logger.debug(f"Seed flagship report note in migration 027: {seed_err}")


def apply_migration_028(c, is_pg: bool):
    """Migration 028: Prune legacy MT5 copy-trading and execution tables.
    ZUPIRUS Quant Lab operates exclusively as a quantitative research & PDF report platform.
    """
    tables_to_drop = [
        "metaapi_trade_executions",
        "metaapi_cloud_accounts",
        "trading_accounts",
        "real_accounts",
        "dispatches",
        "account_symbol_map",
        "signal_dispatch_locks",
        "devices",
        "pairings",
    ]
    if is_pg:
        for tbl in tables_to_drop:
            try:
                c.execute(f"DROP TABLE IF EXISTS {tbl} CASCADE;")
            except Exception as e:
                logger.warning(f"Migration 028 drop table {tbl} warning: {e}")
    else:
        for tbl in tables_to_drop:
            try:
                c.execute(f"DROP TABLE IF EXISTS {tbl};")
            except Exception as e:
                logger.warning(f"Migration 028 drop table {tbl} warning: {e}")









