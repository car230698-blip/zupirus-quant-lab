"""Billing, USD/VND exchange rate, and order inspection commands for zupirus-cli."""
import time
from typing import Optional
from app.db import tx, init
from app.services.fx_rate import get_usd_vnd_rate, convert_usd_to_vnd
from cli.formatters import emit_json, emit_error, format_table


def cmd_billing_fx(force: bool = False, as_json: bool = False):
    """Inspect current USD -> VND real-time exchange rate and tier price equivalents."""
    rate, source, is_cached = get_usd_vnd_rate(force_refresh=force)

    pricing_summary = {
        "cloud_slot_10usd": convert_usd_to_vnd(10.0, rate),
        "tier_starter_bundle_30usd": convert_usd_to_vnd(30.0, rate),
        "tier_growth_bundle_45usd": convert_usd_to_vnd(45.0, rate),
        "tier_alpha_bundle_59usd": convert_usd_to_vnd(59.0, rate),
    }

    data = {
        "rate": rate,
        "rate_formatted": f"{rate:,.1f} VND/USD",
        "source": source,
        "is_cached": is_cached,
        "pricing_vnd": pricing_summary,
        "timestamp": time.time(),
    }

    if as_json:
        emit_json(data)
        return

    print("=== ZUPIRUS Real-Time FX Rate Monitor ===")
    print(f"Rate:         {rate:,.1f} VND/USD")
    print(f"Source:       {source} ({'Cached in Redis' if is_cached else 'Fresh Fetch'})")
    print("\n--- Current Pricing in VND (Ceil 1,000d) ---")
    print(f"Cloud MT5 Slot ($10/mo):          {pricing_summary['cloud_slot_10usd']:,} VND")
    print(f"Starter Bundle ($30/mo):          {pricing_summary['tier_starter_bundle_30usd']:,} VND")
    print(f"Growth Bundle ($45/mo):           {pricing_summary['tier_growth_bundle_45usd']:,} VND")
    print(f"Prop Firm Alpha Bundle ($59/mo):  {pricing_summary['tier_alpha_bundle_59usd']:,} VND")


def cmd_billing_orders(limit: int = 20, as_json: bool = False):
    """List recent subscription checkout orders."""
    init()
    with tx() as c:
        rows = c.execute(
            """
            SELECT id, user_id, amount_usd, amount_vnd, plan_tier, cloud_slots_count,
                   status, payment_gateway, created_at, paid_at
            FROM orders
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,)
        ).fetchall()

    orders_data = [dict(r) for r in rows]

    if as_json:
        emit_json({"orders": orders_data, "total": len(orders_data)})
        return

    if not orders_data:
        print("No billing orders recorded yet.")
        return

    headers = ["Order ID", "User ID", "Tier", "USD", "VND", "Status", "Created"]
    table_rows = []
    for o in orders_data:
        created_str = time.strftime("%Y-%m-%d %H:%M", time.localtime(o["created_at"]))
        table_rows.append([
            o["id"],
            o["user_id"][:10],
            o["plan_tier"].upper(),
            f"${o['amount_usd']:.2f}",
            f"{o['amount_vnd']:,}d",
            o["status"],
            created_str,
        ])

    print(format_table(headers, table_rows))

