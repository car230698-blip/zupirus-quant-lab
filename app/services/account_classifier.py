"""Account Type Classifier & Dynamic Proportional Lot Sizing.
Recognizes account categories:
- CENT: USC/EUC currencies, micro lot sizing (contractSize 1 vs 100)
- PROP_FIRM: FTMO, Funding Pips, MFF, Proprietary Trading firms
- RAW_ECN: Zero spread / Raw / Pro accounts with sub-pip spreads
- STANDARD: Classic USD/EUR retail accounts

Ensures micro-accounts ($50-$100 Cent), standard ($1k-$5k), and prop firm accounts ($100,000)
all execute exactly matching % risk allocations without rounding errors or margin blowouts.
"""
import math
import logging

logger = logging.getLogger("zupirus.classifier")


def detect_account_type(
    currency: str = "USD",
    server: str = "",
    name: str = "",
    contract_size: float = 100.0,
    leverage: float = 100.0,
) -> str:
    """Classify account into CENT, PROP_FIRM, RAW_ECN, or STANDARD."""
    curr_upper = (currency or "USD").upper()
    server_upper = (server or "").upper()
    name_upper = (name or "").upper()

    # 1. Cent Account detection
    if curr_upper in ("USC", "EUC") or contract_size <= 1.0 or "CENT" in server_upper or "CENT" in name_upper:
        return "CENT"

    # 2. Prop Firm / Funded Account detection
    prop_keywords = ["FTMO", "FUNDED", "FUNDING", "PROP", "MFF", "TFT", "E8", "ALPHA CAPITAL"]
    if any(k in server_upper or k in name_upper for k in prop_keywords):
        return "PROP_FIRM"

    # 3. Raw / ECN / Pro Spread Account detection
    ecn_keywords = ["RAW", "ECN", "ZERO", "PRO", "RAZOR"]
    if any(k in server_upper or k in name_upper for k in ecn_keywords):
        return "RAW_ECN"

    # 4. Standard default
    return "STANDARD"


def calculate_normalized_lot_size(
    equity: float,
    risk_pct: float,
    sl_distance_points: float,
    contract_size: float = 100.0,
    tick_value: float = 1.0,
    risk_multiplier: float = 1.0,
    min_lot: float = 0.01,
    max_lot: float = 10.0,
    is_cent: bool = False,
    symbol: str = "XAUUSD",
    entry_price: float = 0.0,
) -> float:
    """Calculate normalized, risk-proportional lot size.
    Formula:
    Risk Amount ($) = Equity * (Risk% * Multiplier / 100)
    Value Per Lot ($) = SL Distance * Contract Size * Tick Value * Quote-to-USD
    Raw Lots = Risk Amount / Value Per Lot
    """
    if equity <= 0 or sl_distance_points <= 0 or contract_size <= 0:
        return 0.0

    eff_multiplier = max(0.01, min(risk_multiplier, 10.0))
    # Cent accounts store equity in USC (1 USD = 100 USC); convert to USD so risk_amount matches USD loss_per_lot
    equity_usd = (equity / 100.0) if is_cent else equity
    risk_amount = equity_usd * (risk_pct * eff_multiplier / 100.0)

    sym_u = str(symbol or "XAUUSD").upper()
    from app.services.symbol_precision import (
        contract_size_for_symbol,
        point_size_for_symbol,
        quote_to_usd_rate,
    )
    point_size = point_size_for_symbol(sym_u)
    eff_contract = contract_size_for_symbol(sym_u, is_cent=is_cent, account_contract_size=contract_size)
    # If broker tick_value is already provided (!= 1.0), avoid double-converting via quote_to_usd_rate
    usd_conv = 1.0 if abs(float(tick_value or 1.0) - 1.0) > 1e-6 else quote_to_usd_rate(sym_u, entry_price)
    loss_per_lot = sl_distance_points * point_size * eff_contract * float(tick_value or 1.0) * usd_conv
    if loss_per_lot <= 0:
        return 0.0

    # If Cent account with contract_size 1.0 (USC), scaling is automatic via contract_size
    raw_lot = risk_amount / loss_per_lot

    # Round to 0.01 step
    step_lots = math.floor(raw_lot * 100.0) / 100.0

    # If calculated lot is below minimum broker lot
    if step_lots < min_lot:
        # Fail-closed: Never force minimum lot if it exceeds the user's allocated risk budget
        min_lot_risk = min_lot * loss_per_lot
        if min_lot_risk > risk_amount:
            logger.warning(
                f"Lot sizing rejected: Min lot {min_lot} requires ${min_lot_risk:.2f} risk, "
                f"exceeding allowed risk budget (${risk_amount:.2f}) for equity ${equity:.2f}"
            )
            return 0.0
        return min_lot

    if step_lots > max_lot:
        return max_lot

    return round(step_lots, 2)

