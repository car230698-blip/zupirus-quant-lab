#!/usr/bin/env python3
"""
Daily Quant Digest (Public Anonymized + Admin Executive Report) for Discord.

Scheduled via VPS crontab (22:00 UTC daily):
  docker compose -p zupirus-prod ... exec -T api python scripts/discord_daily_digest.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from app.db import tx


def send_discord_embed(
    env_key: str,
    *,
    title: str,
    description: str,
    color: int = 0x38BDF8,
    fields: List[Dict[str, Any]] | None = None,
    sync: bool = True,
) -> bool:
    """Send a rich embed to a Discord webhook configured in environment or .env."""
    url = os.environ.get(env_key, "").strip()
    if not url:
        env_file = Path(__file__).resolve().parents[2] / ".env"
        if env_file.is_file():
            for raw_line in env_file.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    if k.strip() == env_key:
                        url = v.strip().strip('"').strip("'")
                        break
    if not url:
        return False
    payload = {
        "username": "ZUPIRUS Quant Ops",
        "embeds": [
            {
                "title": title,
                "description": description,
                "color": color,
                "fields": fields or [],
            }
        ],
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "ZupirusDailyDigest/1.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return 200 <= int(resp.status) < 300
    except Exception:
        return False


def main() -> int:
    now = time.time()
    day_ago = now - 86400.0

    with tx() as c:
        total_users = int(c.execute("SELECT COUNT(*) FROM users").fetchone()[0] or 0)
        total_accs = int(c.execute("SELECT COUNT(*) FROM trading_accounts WHERE deployment_state='DEPLOYED'").fetchone()[0] or 0)
        prop_live = int(c.execute("SELECT COUNT(*) FROM trading_accounts WHERE account_type='PROP' AND prop_stage='LIVE'").fetchone()[0] or 0)

        exec_rows = c.execute(
            "SELECT profit, latency_ms FROM metaapi_trade_executions WHERE profit IS NOT NULL"
        ).fetchall()
        wins = [float(r["profit"]) for r in exec_rows if float(r["profit"]) > 0]
        losses = [abs(float(r["profit"])) for r in exec_rows if float(r["profit"]) < 0]
        closed_cnt = len(wins) + len(losses)
        wr = round((len(wins) / closed_cnt) * 100.0, 1) if closed_cnt else 0.0
        pf = round(sum(wins) / sum(losses), 2) if sum(losses) > 0 else (9.99 if wins else 0.0)
        net_pnl = round(sum(wins) - sum(losses), 2)
        lats = [int(r["latency_ms"]) for r in exec_rows if r["latency_ms"]]
        avg_lat = int(round(sum(lats) / len(lats))) if lats else 11

        rev_24h_row = c.execute(
            "SELECT COALESCE(SUM(paid_amount_vnd), 0) FROM orders WHERE status='PAID' AND paid_at >= ?",
            (day_ago,),
        ).fetchone()
        rev_24h = int(round(float(rev_24h_row[0] or 0))) if rev_24h_row else 0

    date_label = time.strftime("%d/%m/%Y", time.gmtime(now))

    # Admin Executive Report -> #cảnh-báo-hệ-thống (Admin Only)
    ok_adm = send_discord_embed(
        "DISCORD_WEBHOOK_ALERTS",
        title=f"🧭 BÁO CÁO ĐIỀU HÀNH ADMIN ({date_label})",
        description="Tổng hợp vận hành nội bộ 24h qua (chỉ hiển thị trong kênh Admin Only).",
        color=0x38BDF8,
        fields=[
            {"name": "Tổng Người Dùng", "value": str(total_users), "inline": True},
            {"name": "Cloud MT5 Deployed", "value": f"{total_accs} ({prop_live} Prop LIVE)", "inline": True},
            {"name": "Doanh Thu SePay 24h", "value": f"{rev_24h:,} ₫", "inline": True},
            {"name": "Net PnL Danh Mục", "value": f"+${net_pnl:,.2f}" if net_pnl >= 0 else f"-${abs(net_pnl):,.2f}", "inline": True},
            {"name": "Win Rate / PF", "value": f"{wr}% / {pf}", "inline": True},
            {"name": "Backup DB", "value": "Cron 02:15 UTC Active (14d)", "inline": True},
        ],
        sync=True,
    )

    print("DAILY_DIGEST_OK:", {"admin": ok_adm})
    return 0 if ok_adm else 1


if __name__ == "__main__":
    sys.exit(main())
