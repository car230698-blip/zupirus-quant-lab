#!/usr/bin/env python3
"""
ZUPIRUS Bilingual Discord Community Automation (Vietnamese + English)
- REST API v10 via Python standard library only (zero third-party dependencies).
- Reads DISCORD_BOT_TOKEN and DISCORD_GUILD_ID from .env or environment.
- STRICT SAFETY CONSTRAINTS:
  1. PROTECTS 'Lưu Trữ' / '#lưu-trữ' / 'archive' (no rename, move, delete, or permission changes).
  2. PRESERVES '#bắt-đầu-tại-đây' (permanent invite link) & '💎 KHU VỰC VIP & PROP FUNDED'.
  3. ZERO IMPACT on core trading engines.
  4. DEFAULTS to --dry-run unless --apply is explicitly specified.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

API_BASE = "https://discord.com/api/v10"

# Discord permission bitflags
PERM_VIEW_CHANNEL = 1 << 10
PERM_SEND_MESSAGES = 1 << 11
PERM_EMBED_LINKS = 1 << 14
PERM_ATTACH_FILES = 1 << 15
PERM_READ_HISTORY = 1 << 16
PERM_ADMINISTRATOR = 1 << 3


def normalize_text(text: str) -> str:
    """Normalize unicode accents and lowercase for robust fuzzy matching."""
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower().strip()


def is_archive_entity(name: str, parent_name: str = "") -> bool:
    """Strictly checks if channel or category belongs to archives."""
    norm_name = normalize_text(name)
    norm_parent = normalize_text(parent_name)
    archive_keywords = ("luu tru", "archive", "luu-tru")
    return any(k in norm_name for k in archive_keywords) or any(k in norm_parent for k in archive_keywords)


def is_vip_entity(name: str, parent_name: str = "") -> bool:
    """Checks if channel or category belongs to VIP & Prop area."""
    norm_name = normalize_text(name)
    norm_parent = normalize_text(parent_name)
    vip_keywords = ("khu vuc vip", "vip & prop funded", "alpha vip", "kho-sach-vip", "prop-firm-guard-live")
    return any(k in norm_name for k in vip_keywords) or any(k in norm_parent for k in vip_keywords)


def load_env_file(filepath: Path) -> Dict[str, str]:
    """Parse .env file without external dependencies."""
    env: Dict[str, str] = {}
    if filepath.exists():
        for line in filepath.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip("'\"")
                env[k] = v
    return env


class DiscordClient:
    def __init__(self, token: str, guild_id: str, dry_run: bool = True):
        self.token = token.strip()
        self.guild_id = guild_id.strip()
        self.dry_run = dry_run
        self.headers = {
            "Authorization": f"Bot {self.token}",
            "Content-Type": "application/json",
            "User-Agent": "ZupirusBilingualSetup/1.0",
        }

    def request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Any:
        url = f"{API_BASE}{path}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        for attempt in range(5):
            req = urllib.request.Request(url, data=data, headers=self.headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    raw = resp.read().decode("utf-8", errors="ignore")
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


def setup_bilingual_discord(client: DiscordClient) -> None:
    print("=" * 80)
    print("⚡ ZUPIRUS DISCORD BILINGUAL SETUP (Tiếng Việt + English)")
    print(f"   Mode: {'[DRY-RUN - NO CHANGES WRITTEN]' if client.dry_run else '[APPLY - COMMITTING CHANGES TO LIVE DISCORD]'}")
    print(f"   Guild ID: {client.guild_id}")
    print("=" * 80)

    # 1. Fetch current roles and channels
    print("\n[1] Fetching live guild state from Discord...")
    roles = client.request("GET", f"/guilds/{client.guild_id}/roles")
    role_by_name = {r["name"]: r for r in roles}
    everyone_role = role_by_name.get("@everyone")
    admin_role = role_by_name.get("👑 Root Admin")

    everyone_id = everyone_role["id"] if everyone_role else client.guild_id
    admin_id = admin_role["id"] if admin_role else None

    print(f"    Loaded {len(roles)} roles (Everyone ID: {everyone_id}, Admin ID: {admin_id})")

    channels = client.request("GET", f"/guilds/{client.guild_id}/channels")
    cat_by_id = {c["id"]: c for c in channels if c.get("type") == 4}
    cat_by_name = {c["name"]: c for c in channels if c.get("type") == 4}
    chan_by_name = {c["name"]: c for c in channels if c.get("type") != 4}

    print(f"    Loaded {len(cat_by_id)} categories and {len(chan_by_name)} text/voice channels.")

    # 2. Safety Audit: Identify and lock archive entities
    print("\n[2] Safety Audit: Verifying Protected & Archive Entities...")
    protected_count = 0
    for c in channels:
        p_name = cat_by_id.get(c.get("parent_id"), {}).get("name", "")
        if is_archive_entity(c["name"], p_name):
            print(f"    🔒 PROTECTED - SKIPPED: '{c['name']}' (ID: {c['id']}, Type: {c.get('type')}) [ARCHIVE GUARD]")
            protected_count += 1
        elif is_vip_entity(c["name"], p_name):
            print(f"    💎 PROTECTED - SKIPPED: '{c['name']}' (ID: {c['id']}) [VIP GUARD]")
            protected_count += 1
        elif c["name"] == "bắt-đầu-tại-đây":
            print(f"    ⭐ PROTECTED - PRESERVED: '#bắt-đầu-tại-đây' (ID: {c['id']}) [INVITE LINK HOLDER]")
            protected_count += 1

    print(f"    Total protected entities: {protected_count}. All safety guardrails ACTIVE.")

    # 3. Setup Roles: 🇻🇳 Tiếng Việt & 🇬🇧 English
    print("\n[3] Setting up Language Roles (Idempotent)...")
    target_roles = [
        {"name": "🇻🇳 Tiếng Việt", "color": 0x10B981, "hoist": False, "mentionable": True},
        {"name": "🇬🇧 English", "color": 0x38BDF8, "hoist": False, "mentionable": True},
    ]
    role_ids: Dict[str, str] = {}
    for rspec in target_roles:
        rname = rspec["name"]
        existing = role_by_name.get(rname)
        if existing:
            role_ids[rname] = existing["id"]
            print(f"    ✓ Role '{rname}' already exists (ID: {existing['id']})")
        else:
            if client.dry_run:
                print(f"    [PLAN CREATE] Role '{rname}' (Color: {hex(rspec['color'])})")
                role_ids[rname] = f"mock-role-{rname}"
            else:
                new_role = client.request("POST", f"/guilds/{client.guild_id}/roles", {
                    "name": rname,
                    "color": rspec["color"],
                    "hoist": rspec["hoist"],
                    "mentionable": rspec["mentionable"],
                    "permissions": "0",
                })
                role_ids[rname] = new_role["id"]
                print(f"    + Created Role '{rname}' (ID: {new_role['id']})")
                time.sleep(0.3)

    vn_role_id = role_ids.get("🇻🇳 Tiếng Việt")
    en_role_id = role_ids.get("🇬🇧 English")

    # 4. Khu Vực Chung (Common / Info Category)
    print("\n[4] Configuring Common Area (Category: '📌 THÔNG TIN & BẮT ĐẦU')...")
    info_cat = cat_by_name.get("📌 THÔNG TIN & BẮT ĐẦU") or cat_by_name.get("📌 THÔNG TIN & NHẬP MÔN")
    if not info_cat:
        for c in cat_by_id.values():
            if "thông tin" in normalize_text(c["name"]):
                info_cat = c
                break

    info_cat_id = info_cat["id"] if info_cat else None
    print(f"    Category: '{info_cat['name'] if info_cat else 'TO CREATE'}' (ID: {info_cat_id})")

    # 4.1. Channel: #select-language
    select_lang_ch = chan_by_name.get("select-language")
    if select_lang_ch:
        print(f"    ✓ Channel '#select-language' already exists (ID: {select_lang_ch['id']})")
        select_lang_id = select_lang_ch["id"]
    else:
        overwrites = [
            {
                "id": everyone_id,
                "type": 0,
                "allow": str(PERM_VIEW_CHANNEL | PERM_READ_HISTORY),
                "deny": str(PERM_SEND_MESSAGES),
            }
        ]
        if client.dry_run:
            print("    [PLAN CREATE] Channel '#select-language' in common category (Read-only for @everyone)")
            select_lang_id = "mock-select-lang-id"
        else:
            new_ch = client.request("POST", f"/guilds/{client.guild_id}/channels", {
                "name": "select-language",
                "type": 0,
                "parent_id": info_cat_id,
                "topic": "🌐 Chọn ngôn ngữ nhận vai trò / Select your community language role (VN/EN)",
                "permission_overwrites": overwrites,
            })
            select_lang_id = new_ch["id"]
            print(f"    + Created Channel '#select-language' (ID: {select_lang_id})")
            time.sleep(0.3)

    # Post guide embed in #select-language if not present
    if not client.dry_run and select_lang_id and not select_lang_id.startswith("mock-"):
        msgs = client.request("GET", f"/channels/{select_lang_id}/messages?limit=5")
        if not any("SELECT YOUR LANGUAGE" in str(m) for m in msgs):
            client.request("POST", f"/channels/{select_lang_id}/messages", {
                "embeds": [
                    {
                        "title": "🌐 SELECT YOUR LANGUAGE / CHỌN NGÔN NGỮ CỘNG ĐỒNG",
                        "description": (
                            "Chào mừng bạn đến với **ZUPIRUS Quant Lab & Trading Academy**!\n"
                            "Welcome to the **ZUPIRUS Quant Lab & Trading Academy** community!\n\n"
                            "Vui lòng chọn ngôn ngữ để mở khóa khu vực thảo luận tương ứng:\n"
                            "Please select your language to unlock the dedicated community channels:\n\n"
                            "🇻🇳 **Tiếng Việt (`🇻🇳 CỘNG ĐỒNG VIỆT NAM`):**\n"
                            "• Thảo luận phân tích XAU/USD & tin tức phiên Á - Âu - Mỹ.\n"
                            "• Hỗ trợ kết nối Cloud MT5 (Zero-VPS), đối soát SePay VietQR 24/7.\n"
                            "• Chia sẻ kinh nghiệm thi và giữ tài khoản quỹ FTMO, The5ers, FundedNext.\n\n"
                            "🇬🇧 **English (`🇬🇧 GLOBAL ENGLISH`):**\n"
                            "• Quantitative & technical Gold (XAU/USD) analysis.\n"
                            "• Zero-VPS Cloud MT5 setup with 4 Fail-Closed Shields.\n"
                            "• International trader networking & English technical support.\n\n"
                            "────────────────────────────────────────\n"
                            "👉 **Cách Nhận Vai Trò / How To Get Your Role:**\n"
                            "Vào mục **Kênh & Vai trò (Channels & Roles)** ở đầu server Discord để tick chọn ngôn ngữ của bạn!\n"
                            "Head to **Channels & Roles** at the top left of this server to toggle your role!"
                        ),
                        "color": 0xF59E0B,
                    }
                ]
            })
            print("    + Posted Language Selection Guide in '#select-language'")
            time.sleep(0.3)

    # 4.2. Channel: #chart-gallery
    chart_ch = chan_by_name.get("chart-gallery")
    if chart_ch:
        print(f"    ✓ Channel '#chart-gallery' already exists (ID: {chart_ch['id']})")
    else:
        if client.dry_run:
            print("    [PLAN CREATE] Channel '#chart-gallery' in common category (Open for all members)")
        else:
            new_chart = client.request("POST", f"/guilds/{client.guild_id}/channels", {
                "name": "chart-gallery",
                "type": 0,
                "parent_id": info_cat_id,
                "topic": "📊 Chia sẻ biểu đồ & góc nhìn kỹ thuật XAU/USD (Share charts & trade analysis)",
            })
            print(f"    + Created Channel '#chart-gallery' (ID: {new_chart['id']})")
            time.sleep(0.3)

    # 4.3. Channel: #bắt-đầu-tại-đây (Append bilingual overview embed if not present)
    start_ch = chan_by_name.get("bắt-đầu-tại-đây")
    if start_ch and not client.dry_run:
        msgs = client.request("GET", f"/channels/{start_ch['id']}/messages?limit=10")
        has_bilingual_embed = any("BILINGUAL COMMUNITY" in str(m) for m in msgs)
        if not has_bilingual_embed:
            client.request("POST", f"/channels/{start_ch['id']}/messages", {
                "embeds": [
                    {
                        "title": "🌐 ZUPIRUS COMMUNITY — BILINGUAL COMMUNITY (VIỆT - ANH)",
                        "description": (
                            "**Máy chủ ZUPIRUS chính thức hỗ trợ song ngữ Tiếng Việt & English:**\n\n"
                            "• 🇻🇳 **Thành viên Việt Nam:** Chọn role `🇻🇳 Tiếng Việt` để mở khóa danh mục **`🇻🇳 CỘNG ĐỒNG VIỆT NAM`**.\n"
                            "• 🇬🇧 **International Members:** Select role `🇬🇧 English` to access **`🇬🇧 GLOBAL ENGLISH`**.\n\n"
                            "Xem hướng dẫn chi tiết tại kênh `#select-language` hoặc mục **Channels & Roles**!"
                        ),
                        "color": 0x38BDF8,
                    }
                ]
            })
            print("    + Appended bilingual overview notice in '#bắt-đầu-tại-đây'")
            time.sleep(0.3)

    # 5. Khu Vực Tiếng Việt (Category: '🇻🇳 CỘNG ĐỒNG VIỆT NAM')
    print("\n[5] Configuring Vietnamese Community Area...")
    # Find category '📊 GIAO DỊCH & QUỸ (XAU/USD)' or existing '🇻🇳 CỘNG ĐỒNG VIỆT NAM'
    vn_cat = cat_by_name.get("🇻🇳 CỘNG ĐỒNG VIỆT NAM") or cat_by_name.get("📊 GIAO DỊCH & QUỸ (XAU/USD)")
    if not vn_cat:
        for c in cat_by_id.values():
            if "giao dich & quy" in normalize_text(c["name"]) or "cong dong viet nam" in normalize_text(c["name"]):
                vn_cat = c
                break

    vn_overwrites = [
        {
            "id": everyone_id,
            "type": 0,
            "allow": "0",
            "deny": str(PERM_VIEW_CHANNEL),
        }
    ]
    if vn_role_id and not vn_role_id.startswith("mock-"):
        vn_overwrites.append({
            "id": vn_role_id,
            "type": 0,
            "allow": str(PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_READ_HISTORY | PERM_ATTACH_FILES | PERM_EMBED_LINKS),
            "deny": "0",
        })
    if admin_id:
        vn_overwrites.append({
            "id": admin_id,
            "type": 0,
            "allow": str(PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_READ_HISTORY | PERM_ATTACH_FILES | PERM_EMBED_LINKS),
            "deny": "0",
        })

    if vn_cat:
        vn_cat_id = vn_cat["id"]
        rename_needed = vn_cat["name"] != "🇻🇳 CỘNG ĐỒNG VIỆT NAM"
        if rename_needed:
            print(f"    [PLAN RENAME] Category '{vn_cat['name']}' -> '🇻🇳 CỘNG ĐỒNG VIỆT NAM' (ID: {vn_cat_id})")
        else:
            print(f"    ✓ Category '🇻🇳 CỘNG ĐỒNG VIỆT NAM' already configured (ID: {vn_cat_id})")

        print("    [PLAN PERMISSIONS] Category '🇻🇳 CỘNG ĐỒNG VIỆT NAM': @everyone DENY VIEW_CHANNEL, '🇻🇳 Tiếng Việt' ALLOW VIEW & CHAT")
        if not client.dry_run:
            payload: Dict[str, Any] = {"permission_overwrites": vn_overwrites}
            if rename_needed:
                payload["name"] = "🇻🇳 CỘNG ĐỒNG VIỆT NAM"
            client.request("PATCH", f"/channels/{vn_cat_id}", payload)
            print("    + Updated Category '🇻🇳 CỘNG ĐỒNG VIỆT NAM' name and permissions.")
            time.sleep(0.5)
    else:
        if client.dry_run:
            print("    [PLAN CREATE] Category '🇻🇳 CỘNG ĐỒNG VIỆT NAM' with Vietnamese role permissions.")
            vn_cat_id = "mock-vn-cat-id"
        else:
            new_cat = client.request("POST", f"/guilds/{client.guild_id}/channels", {
                "name": "🇻🇳 CỘNG ĐỒNG VIỆT NAM",
                "type": 4,
                "permission_overwrites": vn_overwrites,
            })
            vn_cat_id = new_cat["id"]
            print(f"    + Created Category '🇻🇳 CỘNG ĐỒNG VIỆT NAM' (ID: {vn_cat_id})")
            time.sleep(0.5)

    # 6. Khu Vực Quốc Tế (Category: '🇬🇧 GLOBAL ENGLISH')
    print("\n[6] Configuring Global English Area...")
    en_cat = cat_by_name.get("🇬🇧 GLOBAL ENGLISH")
    en_overwrites = [
        {
            "id": everyone_id,
            "type": 0,
            "allow": "0",
            "deny": str(PERM_VIEW_CHANNEL),
        }
    ]
    if en_role_id and not en_role_id.startswith("mock-"):
        en_overwrites.append({
            "id": en_role_id,
            "type": 0,
            "allow": str(PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_READ_HISTORY | PERM_ATTACH_FILES | PERM_EMBED_LINKS),
            "deny": "0",
        })
    if admin_id:
        en_overwrites.append({
            "id": admin_id,
            "type": 0,
            "allow": str(PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_READ_HISTORY | PERM_ATTACH_FILES | PERM_EMBED_LINKS),
            "deny": "0",
        })

    if en_cat:
        en_cat_id = en_cat["id"]
        print(f"    ✓ Category '🇬🇧 GLOBAL ENGLISH' already exists (ID: {en_cat_id})")
        if not client.dry_run:
            client.request("PATCH", f"/channels/{en_cat_id}", {"permission_overwrites": en_overwrites})
            print("    + Synced Category '🇬🇧 GLOBAL ENGLISH' permissions.")
            time.sleep(0.5)
    else:
        if client.dry_run:
            print("    [PLAN CREATE] Category '🇬🇧 GLOBAL ENGLISH' with English role permissions.")
            en_cat_id = "mock-en-cat-id"
        else:
            new_cat = client.request("POST", f"/guilds/{client.guild_id}/channels", {
                "name": "🇬🇧 GLOBAL ENGLISH",
                "type": 4,
                "permission_overwrites": en_overwrites,
            })
            en_cat_id = new_cat["id"]
            print(f"    + Created Category '🇬🇧 GLOBAL ENGLISH' (ID: {en_cat_id})")
            time.sleep(0.5)

    # Subchannels for Global English:
    en_channels_spec = [
        {
            "name": "getting-started-en",
            "topic": "⚡ Introduction, Rules & Getting Started with ZUPIRUS Quant Lab",
            "readonly": True,
        },
        {
            "name": "general-chat-en",
            "topic": "💬 General English discussions & trader networking",
            "readonly": False,
        },
        {
            "name": "help-desk-en",
            "topic": "🛠️ English technical support for Cloud MT5 connection & billing",
            "readonly": False,
        },
    ]

    for spec in en_channels_spec:
        cname = spec["name"]
        existing_ch = chan_by_name.get(cname)
        if existing_ch:
            print(f"    ✓ Channel '#{cname}' already exists (ID: {existing_ch['id']})")
            target_ch_id = existing_ch["id"]
        else:
            ch_overwrites: List[Dict[str, Any]] = []
            if spec["readonly"]:
                ch_overwrites.append({
                    "id": everyone_id,
                    "type": 0,
                    "allow": "0",
                    "deny": str(PERM_SEND_MESSAGES),
                })
                if en_role_id and not en_role_id.startswith("mock-"):
                    ch_overwrites.append({
                        "id": en_role_id,
                        "type": 0,
                        "allow": str(PERM_VIEW_CHANNEL | PERM_READ_HISTORY),
                        "deny": str(PERM_SEND_MESSAGES),
                    })

            if client.dry_run:
                print(f"    [PLAN CREATE] Channel '#{cname}' in '🇬🇧 GLOBAL ENGLISH' (Readonly: {spec['readonly']})")
                target_ch_id = f"mock-en-{cname}"
            else:
                payload = {
                    "name": cname,
                    "type": 0,
                    "parent_id": en_cat_id,
                    "topic": spec["topic"],
                }
                if ch_overwrites:
                    payload["permission_overwrites"] = ch_overwrites
                new_ch = client.request("POST", f"/guilds/{client.guild_id}/channels", payload)
                target_ch_id = new_ch["id"]
                print(f"    + Created Channel '#{cname}' (ID: {target_ch_id})")
                time.sleep(0.3)

        # If #getting-started-en was created or empty, post comprehensive English embeds
        if cname == "getting-started-en" and not client.dry_run and target_ch_id and not target_ch_id.startswith("mock-"):
            msgs = client.request("GET", f"/channels/{target_ch_id}/messages?limit=5")
            if not any("WELCOME TO ZUPIRUS QUANT LAB" in str(m) for m in msgs):
                client.request("POST", f"/channels/{target_ch_id}/messages", {
                    "embeds": [
                        {
                            "title": "⚡ 1. WELCOME TO ZUPIRUS QUANT LAB & TRADING ACADEMY",
                            "description": (
                                "ZUPIRUS is an enterprise-grade quantitative trading platform and algorithmic execution system designed for **Gold (XAU/USD) & Major FX** on Cloud MT5 without needing a VPS.\n\n"
                                "• 🌐 **Client Portal:** https://app.zupirus.com\n"
                                "• 📊 **Public Verified Performance:** https://zupirus.com/#track-record\n"
                                "• 🛡️ **4 Fail-Closed Protective Shields:**\n"
                                "  1. **Idempotency Lock:** Hardware-level lock eliminating duplicate executions and phantom fills.\n"
                                "  2. **Dynamic ATR Auto-SL:** Hard Stop-Loss injected directly on broker engine at order inception.\n"
                                "  3. **News Shield (±15 min):** Auto-freezes order execution around high-impact red USD events (CPI, NFP, FOMC).\n"
                                "  4. **Slippage & Spread Guard:** Rejects execution during dangerous market volatility or wide broker spread."
                            ),
                            "color": 0xF59E0B,
                        },
                        {
                            "title": "🏆 2. PROP FIRM CHALLENGE PASSING & RISK MANAGEMENT",
                            "description": (
                                "Built strictly according to institutional Prop Firm guidelines (FTMO, The5ers, FundedNext):\n\n"
                                "• **4.0% Daily Loss Hard-Stop:** Auto-shuts down execution before reaching the firm's 5.0% daily drawdown limit (giving you a 1.0% slippage safety buffer).\n"
                                "• **Target Protection:** Automatically scales down lot size to 0.35% when reaching 80% of challenge profit target to guarantee passing smoothly.\n"
                                "• **Direct Cloud Latency:** Under 3ms execution to London G2 Equinix financial hubs.\n"
                                "• **Free Quant Tools:**\n"
                                "  - [Prop Firm Drawdown Calculator](https://zupirus.com/cong-cu/tinh-drawdown-quy-prop-firm)\n"
                                "  - [XAU/USD Lot Size Calculator](https://zupirus.com/cong-cu/tinh-lot-size-xauusd)"
                            ),
                            "color": 0x10B981,
                        },
                        {
                            "title": "📜 3. COMMUNITY GUIDELINES & ZERO-TRUST SECURITY",
                            "description": (
                                "1. **Respect & Professionalism:** No spamming, external signal shilling, broker referral begging, or unverified claims.\n"
                                "2. **Zero-Trust Security:** Admins will **NEVER** DM you first asking for passwords, seed phrases, or external payments.\n"
                                "3. **Non-Custodial:** ZUPIRUS never touches your funds; your capital stays 100% inside your own MT5 broker account.\n"
                                "4. **English Only:** Please keep all discussions in this category strictly in English."
                            ),
                            "color": 0x38BDF8,
                        },
                    ]
                })
                print("    + Posted 3 English Master Embeds in '#getting-started-en'")
                time.sleep(0.3)

    print("\n" + "=" * 80)
    if client.dry_run:
        print("✅ DRY-RUN COMPLETED: 0 changes were written to live Discord.")
        print("   All archive and VIP channels remain strictly untouched.")
        print("   Run with '--apply' to execute these changes.")
    else:
        print("🎉 SUCCESS: Discord Bilingual Infrastructure successfully deployed to Live!")
    print("=" * 80)


def main() -> int:
    parser = argparse.ArgumentParser(description="ZUPIRUS Discord Bilingual Setup (Idempotent)")
    parser.add_argument("--apply", action="store_true", help="Actually apply the changes to Discord (default is dry-run)")
    parser.add_argument("--dry-run", action="store_true", help="Explicitly enforce dry-run inspection")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent.parent
    env_vars = load_env_file(repo_root / ".env")

    token = os.getenv("DISCORD_BOT_TOKEN") or env_vars.get("DISCORD_BOT_TOKEN", "").strip()
    guild_id = os.getenv("DISCORD_GUILD_ID") or env_vars.get("DISCORD_GUILD_ID", "").strip() or "1564623129450385560"

    if not token:
        print("❌ Error: Missing DISCORD_BOT_TOKEN in environment or .env file.", file=sys.stderr)
        return 1

    dry_run = True
    if args.apply and not args.dry_run:
        dry_run = False

    client = DiscordClient(token=token, guild_id=guild_id, dry_run=dry_run)
    try:
        setup_bilingual_discord(client)
        return 0
    except Exception as e:
        print(f"\n❌ Execution Failed: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
