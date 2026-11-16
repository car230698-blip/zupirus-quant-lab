"""Broker Symbol Auto-Discovery and Dynamic Mapping Service.
Automatically translates standard symbols (XAUUSD, EURUSD, GBPUSD, USDJPY)
to broker-specific variants (XAUUSDm, XAUUSD.pro, GOLD, etc.) per trading account.
If a broker/prop-firm locks out a specific symbol, it is safely marked SKIPPED_UNSUPPORTED_SYMBOL
for that account alone without blocking the rest of the customer fleet.
"""
import time
import logging
from typing import Dict, Any, List, Optional
from app.db import tx

logger = logging.getLogger("zupirus.symbol_mapper")

# Standard symbols supported by Zupirus Core Fleet
STANDARD_SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY"]

# Known broker aliases and suffix patterns
SYMBOL_ALIASES = {
    "XAUUSD": ["XAUUSD", "XAUUSDm", "XAUUSD.pro", "XAUUSD+", "XAUUSDc", "GOLD", "GOLDm", "XAUUSD.raw"],
    "EURUSD": ["EURUSD", "EURUSDm", "EURUSD.pro", "EURUSD+", "EURUSDc", "EURUSD.raw"],
    "GBPUSD": ["GBPUSD", "GBPUSDm", "GBPUSD.pro", "GBPUSD+", "GBPUSDc", "GBPUSD.raw"],
    "USDJPY": ["USDJPY", "USDJPYm", "USDJPY.pro", "USDJPY+", "USDJPYc", "USDJPY.raw"],
}


def discover_and_map_account_symbols(
    account_id: str,
    available_broker_symbols: List[str],
    db_cursor: Optional[Any] = None,
) -> Dict[str, str]:
    """Scan broker symbols returned from MetaApi deployment and populate account_symbol_map."""
    now_ts = time.time()
    discovered_map: Dict[str, str] = {}
    broker_symbols_upper = {s.upper(): s for s in available_broker_symbols}

    def _execute_mapping(c):
        for std_sym in STANDARD_SYMBOLS:
            candidates = SYMBOL_ALIASES.get(std_sym, [std_sym])
            matched_broker_sym = None

            for cand in candidates:
                if cand.upper() in broker_symbols_upper:
                    matched_broker_sym = broker_symbols_upper[cand.upper()]
                    break

            is_supported = 1 if matched_broker_sym else 0
            resolved = matched_broker_sym if matched_broker_sym else std_sym

            # Default contract sizes (Cent = 1.0, Standard Gold = 100.0, Standard FX = 100,000.0)
            contract_size = 100.0 if "XAU" in std_sym or "GOLD" in std_sym else 100000.0

            try:
                c.execute(
                    """
                    INSERT INTO account_symbol_map (
                        account_id, standard_symbol, broker_symbol, contract_size, tick_value, is_supported, updated_at
                    ) VALUES (?, ?, ?, ?, 1.0, ?, ?)
                    ON CONFLICT(account_id, standard_symbol) DO UPDATE SET
                        broker_symbol = excluded.broker_symbol,
                        is_supported = excluded.is_supported,
                        updated_at = excluded.updated_at
                    """,
                    (account_id, std_sym, resolved, contract_size, is_supported, now_ts)
                )
            except Exception:
                try:
                    c.execute("DELETE FROM account_symbol_map WHERE account_id = ? AND standard_symbol = ?", (account_id, std_sym))
                    c.execute(
                        """
                        INSERT INTO account_symbol_map (
                            account_id, standard_symbol, broker_symbol, contract_size, tick_value, is_supported, updated_at
                        ) VALUES (?, ?, ?, ?, 1.0, ?, ?)
                        """,
                        (account_id, std_sym, resolved, contract_size, is_supported, now_ts)
                    )
                except Exception as e:
                    logger.warning(f"Error saving account_symbol_map for {account_id}: {e}")

            if matched_broker_sym:
                discovered_map[std_sym] = matched_broker_sym

    if db_cursor is not None:
        _execute_mapping(db_cursor)
    else:
        with tx() as c:
            _execute_mapping(c)

    logger.info(f"Mapped {len(discovered_map)}/{len(STANDARD_SYMBOLS)} symbols for account {account_id}")
    return discovered_map


def resolve_broker_symbol(account_id: str, standard_symbol: str) -> Optional[str]:
    """Retrieve the broker-specific symbol for an account.
    Prioritizes user's `symbol_mapping_custom` in `risk_config`, then `account_symbol_map`.
    Returns None if the account's broker does not support this symbol.
    """
    std_sym = standard_symbol.upper()
    with tx() as c:
        # 1. Check custom user symbol mapping in trading_accounts.risk_config
        try:
            acc_row = c.execute("SELECT risk_config FROM trading_accounts WHERE id = ?", (account_id,)).fetchone()
            if acc_row and acc_row[0]:
                import json
                cfg = json.loads(acc_row[0]) if isinstance(acc_row[0], str) else acc_row[0]
                custom = cfg.get("symbol_mapping_custom") if isinstance(cfg, dict) else None
                if isinstance(custom, dict) and custom.get(std_sym):
                    return str(custom[std_sym]).strip()
                if isinstance(custom, str) and custom.strip():
                    cs = custom.strip()
                    if cs.upper().startswith(std_sym):
                        return cs
                    if std_sym == "XAUUSD" and any(k in cs.upper() for k in ("XAU", "GOLD")):
                        return cs
                    return f"{std_sym}{cs}" if cs.startswith((".", "_", "-")) or len(cs) <= 3 else cs
        except Exception:
            pass

        row = c.execute(
            "SELECT broker_symbol, is_supported FROM account_symbol_map WHERE account_id = ? AND standard_symbol = ?",
            (account_id, std_sym)
        ).fetchone()

        if row:
            is_sup = row["is_supported"] if hasattr(row, "keys") else row[1]
            broker_sym = row["broker_symbol"] if hasattr(row, "keys") else row[0]
            if is_sup:
                return broker_sym
            return None

    # Fallback to standard symbol if mapping not yet scanned
    return standard_symbol


def get_account_symbol_mappings(account_id: str) -> List[Dict[str, Any]]:
    """Return all symbol mappings for an account."""
    with tx() as c:
        rows = c.execute(
            "SELECT standard_symbol, broker_symbol, contract_size, tick_value, is_supported, updated_at FROM account_symbol_map WHERE account_id = ?",
            (account_id,)
        ).fetchall()
        return [dict(r) for r in rows]
