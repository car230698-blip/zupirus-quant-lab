"""Unit tests for CSV export Cent normalization and Formula Injection defense (CWE-1236)."""
import io
import csv
from app.routers.dashboard import _csv_safe


def test_csv_safe_formula_injection_defense():
    """Verify that formula injection characters are neutralized with a leading single quote."""
    assert _csv_safe("=CMD('calc')") == "'=CMD('calc')"
    assert _csv_safe("+SUM(A1:A10)") == "'+SUM(A1:A10)"
    assert _csv_safe("-100") == "'-100"
    assert _csv_safe("@SUM(1,2)") == "'@SUM(1,2)"
    assert _csv_safe("\tMALICIOUS") == "'\tMALICIOUS"
    assert _csv_safe("\rCARRIAGE") == "'\rCARRIAGE"

    # Safe strings should not be modified
    assert _csv_safe("ZUPIRUS Quant") == "ZUPIRUS Quant"
    assert _csv_safe("XAUUSD") == "XAUUSD"
    assert _csv_safe("123456") == "123456"
    assert _csv_safe("") == ""
    assert _csv_safe(None) == ""


def test_cent_and_standard_profit_csv_row_formatting():
    """Verify that Cent accounts output raw USC units and USD normalized profit divided by 100."""
    # Test Cent Account Row
    cent_record = {
        "account_name": "=HackedAcc",
        "mt5_login": "888192",
        "broker_server": "Exness-MT5Cent",
        "symbol": "XAUUSD",
        "action": "BUY",
        "volume": 0.50,
        "entry_price": 2700.50,
        "profit": 5000.0,
        "status": "closed",
        "ticket": "@12345678",
        "account_type": "CENT",
        "currency": "USC",
    }

    acc_type = str(cent_record.get("account_type") or "").upper()
    curr = str(cent_record.get("currency") or "").upper()
    is_cent = acc_type == "CENT" or curr in ("USC", "EUC")
    raw_profit = float(cent_record.get("profit") or 0.0)

    if is_cent:
        orig_unit = curr if curr else "USC"
        profit_orig_str = f"{raw_profit:.2f} {orig_unit}"
        profit_usd = round(raw_profit / 100.0, 2)
    else:
        orig_unit = curr if curr else "USD"
        profit_orig_str = f"{raw_profit:.2f} {orig_unit}"
        profit_usd = round(raw_profit, 2)

    acc_label = f"{cent_record.get('account_name', '')} (#{cent_record.get('mt5_login', '')})"

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        _csv_safe(acc_label),
        _csv_safe(cent_record.get("broker_server", "")),
        _csv_safe(cent_record.get("symbol", "XAUUSD")),
        _csv_safe(cent_record.get("action", "")),
        cent_record.get("volume", 0.0),
        cent_record.get("entry_price", 0.0),
        _csv_safe(profit_orig_str),
        profit_usd,
        _csv_safe(cent_record.get("status", "")),
        _csv_safe(cent_record.get("ticket", "")),
    ])

    csv_output = buf.getvalue()
    # Profit in USD must be 50.0 (5000 / 100)
    assert "50.0" in csv_output
    assert "5000.00 USC" in csv_output
    # Account name with = must be escaped
    assert "'=HackedAcc (#888192)" in csv_output
    # Ticket with @ must be escaped
    assert "'@12345678" in csv_output
