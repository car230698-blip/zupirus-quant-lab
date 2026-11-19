#!/usr/bin/env python3
"""
Idempotent Discord Server Setup Automation for ZUPIRUS Quant Lab.

Creates Roles, Categories, Channels, Permission Overwrites, Branded Sovereign Embeds,
and optional Webhooks via the official Discord REST API v10 (stdlib only, zero dependencies).

Usage:
  DISCORD_BOT_TOKEN="..." DISCORD_GUILD_ID="..." python scripts/setup_discord_zupirus.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

API_BASE = "https://discord.com/api/v10"

# Discord permission bitflags
PERM_VIEW_CHANNEL = 1 << 10
PERM_SEND_MESSAGES = 1 << 11
PERM_EMBED_LINKS = 1 << 14
PERM_ATTACH_FILES = 1 << 15
PERM_READ_HISTORY = 1 << 16
PERM_ADMINISTRATOR = 1 << 3


class DiscordAPI:
    def __init__(self, token: str):
        self.token = token.strip()
        self.headers = {
            "Authorization": f"Bot {self.token}",
            "Content-Type": "application/json",
            "User-Agent": "ZupirusServerSetup/1.0",
        }

    def request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Any:
        url = f"{API_BASE}{path}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        for attempt in range(5):
            req = urllib.request.Request(url, data=data, headers=self.headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    raw = resp.read().decode("utf-8")
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="ignore")
                if e.code == 429:
                    try:
                        retry_after = float(json.loads(body).get("retry_after", 1.5))
                    except Exception:
                        retry_after = 2.0
                    time.sleep(retry_after + 0.25)
                    continue
                raise RuntimeError(f"Discord API {method} {path} failed ({e.code}): {body}") from e
        raise RuntimeError(f"Discord API rate-limited repeatedly on {method} {path}")


ROLES_SPEC = [
    {"key": "admin", "name": "👑 Root Admin", "color": 0xF59E0B, "hoist": True, "permissions": str(PERM_ADMINISTRATOR)},
    {"key": "prop", "name": "🏆 Prop Funded (LIVE)", "color": 0x10B981, "hoist": True, "permissions": "0"},
    {"key": "alpha", "name": "⚡ Alpha VIP", "color": 0x38BDF8, "hoist": True, "permissions": "0"},
    {"key": "growth", "name": "📈 Growth Trader", "color": 0xA855F7, "hoist": True, "permissions": "0"},
    {"key": "starter", "name": "🌱 Starter Member", "color": 0x94A3B8, "hoist": False, "permissions": "0"},
]

EMBEDS: Dict[str, Dict[str, Any]] = {
    "chào-mừng": {
        "title": "⚡ CHÀO MỪNG ĐẾN VỚI ZUPIRUS QUANT LAB",
        "description": (
            "Hạ tầng giao dịch định lượng **XAU/USD Cloud MT5 (Zero-VPS)** chuẩn Quỹ.\n\n"
            "• 🌐 **Cổng Khách Hàng:** https://app.zupirus.com\n"
            "• 🛡️ **4 Lớp Giáp Fail-Closed:** Idempotency Lock · Auto-SL ATR(14) · News Shield ±15p · Slippage Guard\n"
            "• 🏆 **Tối ưu cho tài khoản Quỹ (FTMO, The5ers, FundedNext)** với trần sụt giảm ngày 4.0% & HWM 8.0%.\n\n"
            "Hãy đọc `#nội-quy-zupirus` và `#hướng-dẫn-cloud-mt5` để bắt đầu ngay!"
        ),
        "color": 0xF59E0B,
    },
    "nội-quy-zupirus": {
        "title": "📜 NỘI QUY MÁY CHỦ & CAM KẾT MINH BẠCH",
        "description": (
            "1. **Tôn trọng cộng đồng:** Không spam, không quảng cáo sàn/nhóm tín hiệu ngoài, không lôi kéo IB.\n"
            "2. **Bảo mật tuyệt đối:** Admin ZUPIRUS **KHÔNG BAO GIỜ** nhắn tin riêng hỏi mật khẩu tài khoản hay yêu cầu chuyển tiền ngoài mã VietQR trên `app.zupirus.com`.\n"
            "3. **Tiền nằm tại sàn của bạn:** ZUPIRUS không giữ vốn nạp; mọi tài khoản MT5 được kết nối qua MetaApi Cloud mã hóa AES-256.\n"
            "4. **Lưu ý rủi ro:** Giao dịch XAU/USD có đòn bẩy mang rủi ro tài chính cao. Luôn tuân thủ quản trị vốn."
        ),
        "color": 0x10B981,
    },
    "bảng-giá-sepay": {
        "title": "💳 BIỂU PHÍ HẠ TẦNG CLOUD MT5 (SEPAY VIETQR TỰ ĐỘNG)",
        "description": (
            "Kích hoạt tức thì 24/7 qua **SePay VietQR** trực tiếp trong cổng https://app.zupirus.com:\n\n"
            "• 🌱 **STARTER — $25 / tháng:** 1 tài khoản Cloud MT5, 4 Lớp Giáp Fail-Closed, Auto-SL.\n"
            "• 📈 **GROWTH — $39 / tháng:** Lên tới 3 tài khoản MT5, Hệ số Lot tùy chỉnh, Auto BE & Partial TP.\n"
            "• ⚡ **ALPHA VIP — $59 / tháng:** Lên tới 5 tài khoản MT5, **Prop Firm Guard (Challenge & LIVE)**, chiến lược Alpha AI.\n\n"
            "🎁 *Ưu đãi chu kỳ: 3 Tháng (-10%) · 6 Tháng (-15%) · 12 Tháng (-20%).*"
        ),
        "color": 0x38BDF8,
    },
    "hướng-dẫn-cloud-mt5": {
        "title": "🚀 HƯỚNG DẪN KẾT NỐI CLOUD MT5 TRONG 3 BƯỚC (ZERO-VPS)",
        "description": (
            "**Bước 1:** Đăng ký tài khoản tại https://app.zupirus.com và xác thực email OTP.\n"
            "**Bước 2:** Chọn gói dịch vụ & quét mã **SePay VietQR** để mở slot Cloud MT5 tự động.\n"
            "**Bước 3:** Vào tab **Tài khoản Cloud MT5** → Nhập `MT5 Login`, `Master Password`, `Broker Server` (Exness, ICMarkets, FTMO, The5ers, FundedNext...) → Bật **Prop Firm Guard** nếu chạy quỹ → Xong!\n\n"
            "Không cần thuê VPS, không cần cài file EA `.ex5`."
        ),
        "color": 0xA855F7,
    },
    "hỗ-trợ-mt5-sepay": {
        "title": "🛠️ TRUNG TÂM HỖ TRỢ KỸ THUẬT MT5 & SEPAY",
        "description": (
            "Khi cần hỗ trợ, vui lòng gửi theo mẫu sau để đội ngũ xử lý nhanh nhất:\n"
            "• **Email đăng nhập ZUPIRUS:** ...\n"
            "• **Vấn đề gặp phải:** (Kết nối MT5 / Đối soát SePay / Cấu hình Prop Guard)\n"
            "• **Mã đơn hàng hoặc MT5 Login (không gửi mật khẩu!):** ..."
        ),
        "color": 0xF59E0B,
    },
}


def ow_allow(target_id: str, target_type: int, perms: int) -> Dict[str, Any]:
    return {"id": target_id, "type": target_type, "allow": str(perms), "deny": "0"}


def ow_deny(target_id: str, target_type: int, perms: int) -> Dict[str, Any]:
    return {"id": target_id, "type": target_type, "allow": "0", "deny": str(perms)}


def main() -> int:
    token = os.getenv("DISCORD_BOT_TOKEN", "").strip()
    guild_id = os.getenv("DISCORD_GUILD_ID", "").strip()
    if not token or not guild_id:
        print("Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID environment variables.", file=sys.stderr)
        return 1

    api = DiscordAPI(token)
    guild = api.request("GET", f"/guilds/{guild_id}")
    print(f"[DISCORD] Connected to server: {guild.get('name')} ({guild_id})")

    # 1. Create / sync roles
    existing_roles = {r["name"]: r for r in api.request("GET", f"/guilds/{guild_id}/roles")}
    role_ids: Dict[str, str] = {"everyone": guild_id}
    for rspec in ROLES_SPEC:
        if rspec["name"] in existing_roles:
            role_ids[rspec["key"]] = existing_roles[rspec["name"]]["id"]
            print(f"  [ROLE EXISTS] {rspec['name']}")
        else:
            created = api.request(
                "POST",
                f"/guilds/{guild_id}/roles",
                {
                    "name": rspec["name"],
                    "color": rspec["color"],
                    "hoist": rspec["hoist"],
                    "mentionable": True,
                    "permissions": rspec["permissions"],
                },
            )
            role_ids[rspec["key"]] = created["id"]
            print(f"  [ROLE CREATED] {rspec['name']}")
            time.sleep(0.35)

    # 2. Fetch existing channels
    existing_chans = api.request("GET", f"/guilds/{guild_id}/channels")
    cat_by_name = {c["name"]: c for c in existing_chans if c.get("type") == 4}
    text_by_name = {c["name"]: c for c in existing_chans if c.get("type") == 0}

    read_only_overwrites = [
        ow_deny(role_ids["everyone"], 0, PERM_SEND_MESSAGES),
        ow_allow(role_ids["admin"], 0, PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_EMBED_LINKS),
    ]
    vip_base_overwrites = [
        ow_deny(role_ids["everyone"], 0, PERM_VIEW_CHANNEL),
        ow_allow(role_ids["admin"], 0, PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_READ_HISTORY),
        ow_allow(role_ids["prop"], 0, PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_READ_HISTORY | PERM_ATTACH_FILES),
        ow_allow(role_ids["alpha"], 0, PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_READ_HISTORY | PERM_ATTACH_FILES),
    ]
    vip_growth_overwrites = vip_base_overwrites + [
        ow_allow(role_ids["growth"], 0, PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_READ_HISTORY),
    ]
    admin_only_overwrites = [
        ow_deny(role_ids["everyone"], 0, PERM_VIEW_CHANNEL),
        ow_allow(role_ids["admin"], 0, PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_READ_HISTORY),
    ]

    structure = [
        {
            "category": "📌 THÔNG TIN & BẮT ĐẦU",
            "overwrites": [],
            "channels": [
                ("chào-mừng", "Chào mừng đến với ZUPIRUS Quant Lab", read_only_overwrites),
                ("nội-quy-zupirus", "Nội quy cộng đồng & nguyên tắc bảo mật", read_only_overwrites),
                ("thông-báo-hệ-thống", "Cập nhật phiên bản, bảo trì và thông báo chính thức", read_only_overwrites),
                ("bảng-giá-sepay", "Bảng giá gói Cloud MT5 & thanh toán SePay VietQR", read_only_overwrites),
                ("hướng-dẫn-cloud-mt5", "Hướng dẫn kết nối Cloud MT5 Zero-VPS", read_only_overwrites),
            ],
        },
        {
            "category": "📊 GIAO DỊCH & QUỸ (XAU/USD)",
            "overwrites": [],
            "channels": [
                ("live-xauusd-tín-hiệu", "Luồng tín hiệu XAU/USD M15 & trạng thái 4 lớp giáp", read_only_overwrites),
                ("khoe-pass-quỹ", "Nhật ký Pass Quỹ FTMO / The5ers / FundedNext & Payout", []),
                ("phân-tích-phiên-á-âu-mỹ", "Nhận định cấu trúc thị trường Vàng theo phiên", []),
                ("thảo-luận-trader", "Giao lưu kinh nghiệm quản trị vốn và chạy quỹ", []),
            ],
        },
        {
            "category": "💎 KHU VỰC VIP & PROP FUNDED",
            "overwrites": vip_base_overwrites,
            "channels": [
                ("alpha-vip-lounge", "Phòng riêng cho thành viên Alpha VIP & Prop Funded", vip_base_overwrites),
                ("prop-firm-guard-live", "Theo dõi tài khoản quỹ LIVE & bảo vệ Drawdown", vip_base_overwrites),
                ("chiến-lược-ai-hindsight", "Phân tích dữ liệu học AI Hindsight & Walk-Forward", vip_growth_overwrites),
            ],
        },
        {
            "category": "🛠️ HỖ TRỢ KHÁCH HÀNG",
            "overwrites": [],
            "channels": [
                ("hỗ-trợ-mt5-sepay", "Hỗ trợ đấu nối MT5 Cloud & đối soát SePay", []),
                ("báo-lỗi-góp-ý", "Báo lỗi kỹ thuật và đề xuất tính năng mới", []),
            ],
        },
        {
            "category": "🔒 TRẠM QUẢN TRỊ (ADMIN ONLY)",
            "overwrites": admin_only_overwrites,
            "channels": [
                ("cảnh-báo-hệ-thống", "Cảnh báo lỗi, DD Breach và nhịp tim cluster", admin_only_overwrites),
                ("đối-soát-sepay-admin", "Log đơn hàng SePay và duyệt nâng cấp", admin_only_overwrites),
                ("nhật-ký-ai-swarm", "Nhật ký tiến hóa chiến lược AI Swarm", admin_only_overwrites),
            ],
        },
    ]

    created_channels: Dict[str, str] = {}
    for block in structure:
        cat_name = block["category"]
        if cat_name in cat_by_name:
            cat_id = cat_by_name[cat_name]["id"]
            print(f"[CATEGORY EXISTS] {cat_name}")
        else:
            cat_payload: Dict[str, Any] = {"name": cat_name, "type": 4}
            if block["overwrites"]:
                cat_payload["permission_overwrites"] = block["overwrites"]
            cat = api.request("POST", f"/guilds/{guild_id}/channels", cat_payload)
            cat_id = cat["id"]
            print(f"[CATEGORY CREATED] {cat_name}")
            time.sleep(0.35)

        for ch_name, topic, overwrites in block["channels"]:
            if ch_name in text_by_name:
                ch_id = text_by_name[ch_name]["id"]
                print(f"  [CHANNEL EXISTS] #{ch_name}")
            else:
                ch_payload: Dict[str, Any] = {
                    "name": ch_name,
                    "type": 0,
                    "parent_id": cat_id,
                    "topic": topic,
                }
                if overwrites:
                    ch_payload["permission_overwrites"] = overwrites
                ch = api.request("POST", f"/guilds/{guild_id}/channels", ch_payload)
                ch_id = ch["id"]
                print(f"  [CHANNEL CREATED] #{ch_name}")
                time.sleep(0.35)

                # Post branded welcome/guide embed once when newly created
                if ch_name in EMBEDS:
                    api.request("POST", f"/channels/{ch_id}/messages", {"embeds": [EMBEDS[ch_name]]})
                    print(f"    [EMBED POSTED] #{ch_name}")
                    time.sleep(0.35)

            created_channels[ch_name] = ch_id

    print(
        f"\n[DONE] ZUPIRUS Discord Server ready! "
        f"Roles={len(ROLES_SPEC)}, Categories={len(structure)}, Channels={len(created_channels)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
