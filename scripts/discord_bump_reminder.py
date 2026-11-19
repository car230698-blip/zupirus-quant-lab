#!/usr/bin/env python3
"""
ToS-Compliant Disboard /bump Reminder for ZUPIRUS Discord Admin Channel.

Sends a lightweight reminder embed to DISCORD_WEBHOOK_ALERTS every 2 hours 5 minutes
(125 minutes) so an admin can manually run `/bump` on Disboard.org without violating
Discord/Disboard anti-selfbot rules.

Scheduled via VPS crontab (runs every 5 minutes, emits only when >= 125m elapsed):
  */5 * * * * /usr/bin/python3 /root/zupirus-quant-lab/scripts/discord_bump_reminder.py >/dev/null 2>&1
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

INTERVAL_SECONDS = 125 * 60  # 2 hours 5 minutes
STATE_FILE = Path("/tmp/zupirus_disboard_bump_reminder.ts")
VN_TZ = datetime.timezone(datetime.timedelta(hours=7))


def _load_webhook_url() -> str:
    url = os.environ.get("DISCORD_WEBHOOK_ALERTS", "").strip()
    if url:
        return url
    env_file = Path(__file__).resolve().parents[1] / ".env"
    if env_file.is_file():
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == "DISCORD_WEBHOOK_ALERTS":
                return v.strip().strip('"').strip("'")
    return ""


def _should_fire(now: float, force: bool) -> bool:
    if force or not STATE_FILE.is_file():
        return True
    try:
        last_ts = float(STATE_FILE.read_text(encoding="utf-8").strip())
    except (ValueError, OSError):
        return True
    return (now - last_ts) >= (INTERVAL_SECONDS - 30)


def _send_reminder(webhook_url: str, now: float) -> int:
    now_vn = datetime.datetime.fromtimestamp(now, tz=VN_TZ)
    next_vn = datetime.datetime.fromtimestamp(now + INTERVAL_SECONDS, tz=VN_TZ)
    payload = {
        "username": "ZUPIRUS Growth Bot",
        "embeds": [
            {
                "title": "🚀 ĐẾN GIỜ BUMP SERVER ZUPIRUS LÊN TOP DISBOARD!",
                "description": (
                    "Gõ lệnh **`/bump`** ngay tại kênh quản trị của server **ZUPIRUS** để đẩy "
                    "server lên đầu trang tìm kiếm trên **Disboard.org** (an toàn 100% đúng luật Discord/Disboard)."
                ),
                "color": 0xF59E0B,
                "fields": [
                    {"name": "Server", "value": "ZUPIRUS", "inline": True},
                    {"name": "Link mời vĩnh viễn", "value": "https://discord.gg/yxCx3dVe34", "inline": True},
                    {"name": "Giờ nhắc (GMT+7)", "value": now_vn.strftime("%H:%M · %d/%m/%Y"), "inline": True},
                    {"name": "Lần nhắc tiếp theo (+2h05m)", "value": next_vn.strftime("%H:%M · %d/%m/%Y"), "inline": True},
                ],
                "footer": {"text": "ZUPIRUS Growth Ops · Chu kỳ nhắc 2 giờ 5 phút (ToS-Safe)"},
            }
        ],
    }
    req = urllib.request.Request(
        webhook_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "ZupirusGrowthBot/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return int(resp.status)


def main() -> int:
    parser = argparse.ArgumentParser(description="Send Disboard /bump reminder every 2h05m.")
    parser.add_argument("--force", action="store_true", help="Send immediately regardless of cooldown.")
    args = parser.parse_args()

    now = time.time()
    if not _should_fire(now, force=args.force):
        return 0

    webhook_url = _load_webhook_url()
    if not webhook_url:
        print("BUMP_REMINDER_SKIP: DISCORD_WEBHOOK_ALERTS not configured", file=sys.stderr)
        return 1

    status = _send_reminder(webhook_url, now)
    STATE_FILE.write_text(f"{now:.0f}\n", encoding="utf-8")
    next_vn = datetime.datetime.fromtimestamp(now + INTERVAL_SECONDS, tz=VN_TZ)
    print(f"BUMP_REMINDER_OK: http={status} next_vn={next_vn.strftime('%H:%M %d/%m/%Y')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
