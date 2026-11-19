"""Non-blocking Discord Webhook notifier for ZUPIRUS Quant Lab.

Reads webhook URLs from environment variables (never hardcoded):
  - DISCORD_WEBHOOK_SIGNALS  (#live-xauusd-tín-hiệu)
  - DISCORD_WEBHOOK_ALERTS   (#cảnh-báo-hệ-thống — Admin Only)
  - DISCORD_WEBHOOK_BILLING  (#đối-soát-sepay-admin — Admin Only)
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.request
from typing import Any, Dict, List, Optional

logger = logging.getLogger("zupirus.discord")


def _post_webhook_sync(url: str, payload: Dict[str, Any]) -> bool:
    if not url or os.getenv("PYTEST_CURRENT_TEST"):
        return False
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "ZupirusNotifier/1.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return 200 <= resp.status < 300
    except Exception as exc:
        logger.debug(f"Discord webhook delivery failed: {exc}")
        return False


def send_discord_embed(
    webhook_env_key: str,
    title: str,
    description: str,
    color: int = 0xF59E0B,
    fields: Optional[List[Dict[str, Any]]] = None,
    sync: bool = False,
) -> bool:
    """Dispatch a branded Sovereign embed to the configured Discord Webhook."""
    url = os.getenv(webhook_env_key, "").strip()
    if not url:
        return False

    embed: Dict[str, Any] = {
        "title": title[:250],
        "description": description[:3800],
        "color": color,
        "footer": {"text": "ZUPIRUS Quant Lab · Sovereign XAU Cloud OS"},
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if fields:
        embed["fields"] = fields[:10]

    payload = {"embeds": [embed]}
    if sync:
        return _post_webhook_sync(url, payload)

    t = threading.Thread(target=_post_webhook_sync, args=(url, payload), daemon=True)
    t.start()
    return True


def notify_discord_alert(subject: str, body: str, sync: bool = False) -> bool:
    """Forward critical Admin / Prop Guard alerts to #cảnh-báo-hệ-thống."""
    return send_discord_embed(
        "DISCORD_WEBHOOK_ALERTS",
        title=f"🚨 {subject}",
        description=body,
        color=0xF43F5E,
        sync=sync,
    )


def notify_discord_billing(
    order_code: str,
    user_email: str,
    plan_tier: str,
    amount_vnd: float,
    cloud_slots: int,
    sync: bool = False,
) -> bool:
    """Notify #đối-soát-sepay-admin on successful SePay payment & subscription activation."""
    return send_discord_embed(
        "DISCORD_WEBHOOK_BILLING",
        title="💳 THANH TOÁN SEPAY THÀNH CÔNG",
        description=f"Đơn hàng `{order_code}` đã được xác nhận và tự động kích hoạt gói dịch vụ.",
        color=0x10B981,
        fields=[
            {"name": "Khách hàng", "value": str(user_email or "N/A"), "inline": True},
            {"name": "Gói / Slots", "value": f"{str(plan_tier).upper()} · {cloud_slots} MT5", "inline": True},
            {"name": "Số tiền", "value": f"{int(round(float(amount_vnd or 0))):,} ₫", "inline": True},
        ],
        sync=sync,
    )


def notify_discord_signal(
    symbol: str,
    action: str,
    entry_price: float,
    sl: Optional[float],
    tp: Optional[float],
    accounts_count: int,
    sync: bool = False,
) -> bool:
    """Broadcast approved XAU/USD signal execution to #live-xauusd-tín-hiệu."""
    act = str(action or "BUY").upper()
    color = 0x10B981 if act == "BUY" else 0xF43F5E
    return send_discord_embed(
        "DISCORD_WEBHOOK_SIGNALS",
        title=f"⚡ TÍN HIỆU {act} {symbol}",
        description="Đã vượt qua **4/4 Lớp Giáp Fail-Closed** và đang thực thi đồng bộ trên Cloud MT5.",
        color=color,
        fields=[
            {"name": "Giá tham chiếu", "value": f"${float(entry_price or 0):,.2f}", "inline": True},
            {"name": "Stop Loss", "value": f"${float(sl):,.2f}" if sl else "Auto ATR(14)", "inline": True},
            {"name": "Take Profit", "value": f"${float(tp):,.2f}" if tp else "Dynamic R:R", "inline": True},
            {"name": "Cloud MT5 Nodes", "value": f"{accounts_count} tài khoản", "inline": True},
        ],
        sync=sync,
    )
