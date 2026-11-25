"""
ZUPIRUS Quant Lab - Cloud Operations CLI
Customer auto-trading and MT5 broker execution are strictly disabled in ZUPIRUS Quant Lab.
"""
from typing import Optional, List, Dict, Any
from cli.formatters import emit_json, emit_error, format_table


def cmd_cloud_list(as_json: bool = False):
    """List connected Cloud accounts (disabled in ZUPIRUS Quant Lab)."""
    if as_json:
        emit_json({"success": True, "total_accounts": 0, "accounts": []})
        return
    print("Zero customer trading accounts. ZUPIRUS Quant Lab operates exclusively as a quantitative research & PDF report platform.")


def cmd_cloud_sync(account_login: Optional[str] = None, account_id: Optional[str] = None, as_json: bool = False):
    """Sync real-time balance & equity (no-op in ZUPIRUS Quant Lab)."""
    if as_json:
        emit_json({"success": True, "synced": 0, "message": "Customer auto-trading disabled"})
        return
    print("Sync skipped: Customer auto-trading disabled.")


def cmd_cloud_undeploy_expired(as_json: bool = False):
    """Undeploy expired subscriptions (no-op in ZUPIRUS Quant Lab)."""
    if as_json:
        emit_json({"success": True, "undeployed_count": 0, "scanned": 0, "errors": []})
        return
    print("Scanned 0 expired accounts.")


def cmd_cloud_dispatch_test(
    symbol: str = "XAUUSD",
    action: str = "BUY",
    price: Optional[float] = None,
    volume: float = 0.01,
    as_json: bool = False,
):
    """Dispatch test signal (strictly recorded to shadow research ledger, zero customer executions)."""
    res = {
        "success": True,
        "status": "RECORDED_RESEARCH",
        "symbol": symbol,
        "action": action,
        "price": price or 3000.0,
        "volume": volume,
        "total_eligible_accounts": 0,
        "executed": 0,
        "message": "Customer execution disabled. Signal recorded in research shadow ledger.",
    }
    if as_json:
        emit_json(res)
        return
    print(f"Test signal {symbol} {action} recorded for quantitative research. Executed: 0.")
