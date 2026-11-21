#!/usr/bin/env python3
"""
ZUPIRUS Discord Channel Optimization & Consolidation
- Consolidates #chào-mừng, #nội-quy-zupirus, #bảng-giá-sepay, #hướng-dẫn-cloud-mt5 into a single streamlined channel #bắt-đầu-tại-đây (preserving invite link).
- Keeps #thông-báo-hệ-thống for announcements.
- GUARANTEE: Never touches 'Lưu Trữ' or '#lưu-trữ'.
- Deletes redundant duplicate channels.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

TOK = os.getenv("DISCORD_BOT_TOKEN", "").strip()
GID = os.getenv("DISCORD_GUILD_ID", "1564623129450385560").strip()
API_BASE = "https://discord.com/api/v10"
HDRS = {
    "Authorization": f"Bot {TOK}",
    "Content-Type": "application/json",
    "User-Agent": "ZupirusQuantLab/2.0",
}

def req(method: str, path: str, payload=None):
    url = f"{API_BASE}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    for attempt in range(5):
        r = urllib.request.Request(url, data=data, headers=HDRS, method=method)
        try:
            with urllib.request.urlopen(r, timeout=15) as resp:
                raw = resp.read().decode("utf-8", errors="ignore")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            if e.code == 429:
                try:
                    retry_after = float(json.loads(body).get("retry_after", 2.0))
                except Exception:
                    retry_after = 2.0
                time.sleep(retry_after + 0.5)
                continue
            raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {body}") from e
    raise RuntimeError(f"Rate limited 5 times on {method} {path}")

def main():
    print("[1] Fetching channels...")
    chans = req("GET", f"/guilds/{GID}/channels")
    chan_by_name = {c["name"]: c for c in chans}

    # Find the primary channel to keep (chào-mừng, holds the permanent invite)
    primary_ch = chan_by_name.get("chào-mừng") or chan_by_name.get("chào-mừng-và-hướng-dẫn") or chan_by_name.get("bắt-đầu-tại-đây")
    if not primary_ch:
        print("[ERROR] Cannot find primary channel!")
        return 1

    primary_id = primary_ch["id"]
    print(f"    Primary channel: #{primary_ch['name']} (ID: {primary_id})")

    # Rename primary channel to #bắt-đầu-tại-đây for maximum clarity
    new_name = "bắt-đầu-tại-đây"
    if primary_ch["name"] != new_name:
        print(f"    Renaming #{primary_ch['name']} to #{new_name}...")
        req("PATCH", f"/channels/{primary_id}", {
            "name": new_name,
            "topic": "⚡ Chào mừng, Nội quy, Bảng giá & Hướng dẫn bắt đầu ZUPIRUS Quant Lab",
        })
        time.sleep(0.5)

    # 4 Comprehensive consolidated embeds
    consolidated_embeds = [
        {
            "title": "⚡ 1. CHÀO MỪNG ĐẾN VỚI ZUPIRUS QUANT LAB",
            "description": (
                "Hạ tầng giao dịch định lượng **XAU/USD Cloud MT5 (Zero-VPS)** chuẩn Quỹ quốc tế.\n\n"
                "• 🌐 **Cổng Khách Hàng:** https://app.zupirus.com\n"
                "• 🛡️ **4 Lớp Giáp Fail-Closed:** Idempotency Lock · Auto-SL ATR(14) · News Shield ±15p · Slippage Guard\n"
                "• 🏆 **Tối ưu cho tài khoản Quỹ (FTMO, The5ers, FundedNext)** với cơ chế bảo vệ sụt giảm ngày 4.0% & trần HWM 8.0%."
            ),
            "color": 0xF59E0B,
        },
        {
            "title": "📜 2. NỘI QUY CỘNG ĐỒNG & NGUYÊN TẮC BẢO MẬT",
            "description": (
                "1. **Tôn trọng cộng đồng:** Không spam, không chèo kéo sàn/nhóm ngoài, không quảng bá IB.\n"
                "2. **Bảo mật tuyệt đối:** Admin ZUPIRUS **KHÔNG BAO GIỜ** chủ động nhắn tin riêng hỏi mật khẩu hay yêu cầu chuyển khoản ngoài mã QR trên `app.zupirus.com`.\n"
                "3. **Tiền nằm tại sàn của bạn:** ZUPIRUS không giữ tiền ký quỹ; MT5 được kết nối qua MetaApi Cloud mã hóa AES-256.\n"
                "4. **Quản trị rủi ro:** Giao dịch Vàng đòn bẩy có độ biến động cao; luôn đặt quản trị vốn lên hàng đầu."
            ),
            "color": 0x10B981,
        },
        {
            "title": "💳 3. BIỂU PHÍ HẠ TẦNG CLOUD MT5 (SEPAY VIETQR TỰ ĐỘNG)",
            "description": (
                "Kích hoạt tức thì 24/7 qua **SePay VietQR** trực tiếp trong cổng https://app.zupirus.com:\n\n"
                "• 🌱 **STARTER — $25 / tháng:** 1 tài khoản Cloud MT5, 4 Lớp Giáp Fail-Closed, Auto-SL.\n"
                "• 📈 **GROWTH — $39 / tháng:** Lên tới 3 tài khoản MT5, Hệ số Lot tùy chỉnh, Auto BE & Partial TP.\n"
                "• ⚡ **ALPHA VIP — $59 / tháng:** Lên tới 5 tài khoản MT5, **Prop Firm Guard (Challenge & LIVE)**, chiến lược Alpha AI, mở khóa trọn bộ Kho Ebook VIP & 30 Setup Quỹ.\n\n"
                "🎁 *Ưu đãi chu kỳ: 3 Tháng (-10%) · 6 Tháng (-15%) · 12 Tháng (-20%).*"
            ),
            "color": 0x38BDF8,
        },
        {
            "title": "🚀 4. HƯỚNG DẪN KẾT NỐI CLOUD MT5 TRONG 3 BƯỚC (ZERO-VPS)",
            "description": (
                "**Bước 1:** Đăng ký tài khoản tại https://app.zupirus.com và xác thực email OTP.\n"
                "**Bước 2:** Chọn gói dịch vụ & quét mã **SePay VietQR** để mở slot Cloud MT5 tự động.\n"
                "**Bước 3:** Vào tab **Tài khoản Cloud MT5** → Nhập `MT5 Login`, `Master Password`, `Broker Server` (Exness, ICMarkets, FTMO, The5ers...) → Bật **Prop Firm Guard** nếu chạy quỹ → Xong!\n\n"
                "*(Hệ thống chạy ngầm trên đám mây London G2 ~14ms, không cần thuê VPS, không cần cài file EA)*"
            ),
            "color": 0xA855F7,
            "footer": {"text": "ZUPIRUS QUANT LAB · BẮT ĐẦU TẠI ĐÂY"},
        },
    ]

    print(f"[2] Posting consolidated embeds to #{new_name}...")
    req("POST", f"/channels/{primary_id}/messages", {
        "embeds": consolidated_embeds
    })
    print("    ✅ Posted 4-in-1 consolidated guide.")
    time.sleep(0.5)

    # Delete redundant channels that have now been merged
    redundant_channels = ["nội-quy-zupirus", "bảng-giá-sepay", "hướng-dẫn-cloud-mt5"]
    print(f"\n[3] Removing {len(redundant_channels)} merged channels to streamline sidebar...")
    for cname in redundant_channels:
        ch = chan_by_name.get(cname)
        if ch:
            # SAFEGUARD: Never delete Lưu Trữ
            if "lưu-trữ" in ch["name"].lower() or "lưu trữ" in ch["name"].lower():
                print(f"    🛡️ SAFEGUARD ACTIVATED: Skipping '{ch['name']}'")
                continue
            print(f"    Deleting merged channel #{cname} (ID: {ch['id']})...")
            req("DELETE", f"/channels/{ch['id']}")
            print(f"    ✅ Deleted #{cname}.")
            time.sleep(0.5)
        else:
            print(f"    Channel #{cname} not found or already deleted.")

    print("\n🎉 DISCORD OPTIMIZATION COMPLETE!")
    return 0

if __name__ == "__main__":
    sys.exit(main())
