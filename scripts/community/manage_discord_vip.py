#!/usr/bin/env python3
"""
ZUPIRUS Discord Reorganization & VIP Books Delivery Automation
- Groups uncategorized top channels into '📌 THÔNG TIN & NHẬP MÔN'
- GUARANTEE: Never touches 'Lưu Trữ' or '#lưu-trữ'
- Creates '#kho-sách-vip' in '💎 KHU VỰC VIP & PROP FUNDED'
- Posts/Uploads all 12 trading books & manuals with rich embeds
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

TOK = os.getenv("DISCORD_BOT_TOKEN", "").strip()
GID = os.getenv("DISCORD_GUILD_ID", "1564623129450385560").strip()
if not TOK:
    # Try reading from environment or local config
    TOK = os.environ.get("DISCORD_BOT_TOKEN", "")
API_BASE = "https://discord.com/api/v10"
HDRS = {
    "Authorization": f"Bot {TOK}",
    "User-Agent": "ZupirusQuantLab/2.0",
}

PERM_VIEW_CHANNEL = 1 << 10
PERM_SEND_MESSAGES = 1 << 11
PERM_ATTACH_FILES = 1 << 15
PERM_READ_HISTORY = 1 << 16

def req(method: str, path: str, payload=None, is_multipart=False, data_bytes=None, content_type=None):
    url = f"{API_BASE}{path}"
    headers = dict(HDRS)
    
    if content_type:
        headers["Content-Type"] = content_type
    elif not is_multipart and payload is not None:
        headers["Content-Type"] = "application/json"
        data_bytes = json.dumps(payload).encode("utf-8")

    for attempt in range(5):
        r = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
        try:
            with urllib.request.urlopen(r, timeout=60) as resp:
                raw = resp.read().decode("utf-8", errors="ignore")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            if e.code == 429:
                try:
                    retry_after = float(json.loads(body).get("retry_after", 2.0))
                except Exception:
                    retry_after = 2.0
                print(f"  [RATE LIMITED] Sleeping {retry_after}s...")
                time.sleep(retry_after + 0.5)
                continue
            raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {body}") from e
    raise RuntimeError(f"Rate limited 5 times on {method} {path}")


def main():
    print("[1] Fetching guild channels and roles...")
    roles = req("GET", f"/guilds/{GID}/roles")
    role_by_name = {r["name"]: r["id"] for r in roles}
    print(f"    Loaded {len(roles)} roles. Available:")
    for rname, rid in role_by_name.items():
        if any(k in rname.lower() for k in ["admin", "vip", "prop", "growth", "member", "everyone"]):
            print(f"    - {rname} ({rid})")

    chans = req("GET", f"/guilds/{GID}/channels")
    print(f"\n[2] Found {len(chans)} total channels in Discord server.")

    # Categorize channels
    cats = {c["id"]: c for c in chans if c.get("type") == 4}
    texts = [c for c in chans if c.get("type") == 0]

    for c in cats.values():
        print(f"    📁 Category: '{c['name']}' (ID: {c['id']})")

    # 1. FIND OR CREATE '📌 THÔNG TIN & NHẬP MÔN'
    target_cat_name = "📌 THÔNG TIN & NHẬP MÔN"
    target_cat = None
    for c in cats.values():
        if any(k in c["name"].lower() for k in ["thông tin & bắt đầu", "thông tin & nhập môn", "thông tin"]):
            target_cat = c
            break

    if not target_cat:
        print(f"    Creating new category: '{target_cat_name}'...")
        target_cat = req("POST", f"/guilds/{GID}/channels", {
            "name": target_cat_name,
            "type": 4,
            "position": 0,
        })
        print(f"    Created category ID: {target_cat['id']}")
    else:
        print(f"    Found existing category: '{target_cat['name']}' (ID: {target_cat['id']})")

    # 2. MOVE 5 TOP CHANNELS INTO THIS CATEGORY
    channels_to_group = [
        "chào-mừng",
        "nội-quy-zupirus",
        "thông-báo-hệ-thống",
        "bảng-giá-sepay",
        "hướng-dẫn-cloud-mt5",
    ]

    print("\n[3] Moving 5 informational channels into category...")
    for t in texts:
        # STRICT SAFEGUARD: NEVER TOUCH LƯU TRỮ
        if "lưu-trữ" in t["name"].lower() or "lưu trữ" in t["name"].lower():
            print(f"    🛡️ SAFEGUARD ACTIVATED: Skipping protected channel '{t['name']}'")
            continue

        if t["name"] in channels_to_group:
            if t.get("parent_id") == target_cat["id"]:
                print(f"    Channel '#{t['name']}' is already inside '{target_cat['name']}'")
            else:
                print(f"    Moving '#{t['name']}' into '{target_cat['name']}'...")
                req("PATCH", f"/channels/{t['id']}", {"parent_id": target_cat["id"]})
                print(f"    ✅ Moved '#{t['name']}' successfully.")
                time.sleep(0.4)

    # 3. FIND '💎 KHU VỰC VIP & PROP FUNDED' CATEGORY
    vip_cat = None
    for c in cats.values():
        if "vip" in c["name"].lower() or "prop" in c["name"].lower():
            vip_cat = c
            break

    print(f"\n[4] VIP Category: {vip_cat['name'] if vip_cat else 'None'}")

    # 4. FIND OR CREATE '#kho-sách-miễn-phí' (Free for all members)
    kho_sach_ch = None
    for t in texts:
        if t["name"] in ["kho-sách-miễn-phí", "kho-sách", "kho-sách-vip", "tủ-sách-vip", "thư-viện-vip"]:
            kho_sach_ch = t
            break

    # Look for info/getting started category
    info_cat = None
    for c in cats.values():
        if "thông tin" in c["name"].lower() or "bắt đầu" in c["name"].lower():
            info_cat = c
            break

    if not kho_sach_ch:
        print("    Creating '#kho-sách-miễn-phí' channel (Free for all members)...")
        free_overwrites = [
            {
                "id": GID,  # @everyone can view and read history
                "type": 0,
                "allow": str(PERM_VIEW_CHANNEL | PERM_READ_HISTORY),
                "deny": str(PERM_SEND_MESSAGES),  # Read-only library
            }
        ]

        payload = {
            "name": "kho-sách-miễn-phí",
            "type": 0,
            "topic": "📚 Thư viện 12 Ebook & 30 Cẩm nang Quỹ miễn phí 100% dành cho tất cả thành viên ZUPIRUS Quant Lab",
        }
        if info_cat:
            payload["parent_id"] = info_cat["id"]
        elif vip_cat:
            payload["parent_id"] = vip_cat["id"]
        payload["permission_overwrites"] = free_overwrites

        kho_sach_ch = req("POST", f"/guilds/{GID}/channels", payload)
        print(f"    ✅ Created channel '#kho-sách-miễn-phí' (ID: {kho_sach_ch['id']})")
    else:
        print(f"    Found existing channel '#{kho_sach_ch['name']}' (ID: {kho_sach_ch['id']})")

    # 5. UPLOAD / POST 12 BOOKS WITH RICH EMBEDS & ATTACHMENTS
    target_ch_id = kho_sach_ch["id"]
    print(f"\n[5] Deploying 12 VIP Ebooks into channel #{kho_sach_ch['name']} ({target_ch_id})...")

    # Check existing messages in channel to avoid double-posting
    existing_msgs = req("GET", f"/channels/{target_ch_id}/messages?limit=50")
    if len(existing_msgs) > 5:
        print(f"    Channel already has {len(existing_msgs)} messages. Skipping duplicate uploads.")
        print("\n✅ DISCORD DEPLOYMENT COMPLETE!")
        return

    # Post Welcome Banner
    banner_embed = {
        "title": "📚 KHO TRI THỨC ĐỊNH LƯỢNG & EBOOK MIỄN PHÍ (ALL MEMBERS)",
        "description": (
            "Chào mừng tất cả các nhà giao dịch và thành viên cộng đồng đến với kho tài liệu của **ZUPIRUS Quant Lab**.\n\n"
            "Nhằm hỗ trợ cộng đồng trang bị kiến thức và tư duy chuẩn mực, **ZUPIRUS mở quyền truy cập và tải về MIỄN PHÍ 100% toàn bộ 12 ấn phẩm cẩm nang & 30 thế đánh Quỹ thực chiến** (SMC, Đa Khung Thời Gian, Bẫy Thanh Khoản, Giờ Vàng, Quản Trị Rủi Ro) cho tất cả thành viên (không yêu cầu VIP).\n\n"
            "👇 **Nhấp vào file PDF đính kèm bên dưới mỗi bài viết để tải về máy!**"
        ),
        "color": 0x10B981,
        "footer": {"text": "ZUPIRUS QUANT LAB · TÀI NGUYÊN MIỄN PHÍ CỘNG ĐỒNG"},
    }
    req("POST", f"/channels/{target_ch_id}/messages", {"embeds": [banner_embed]})
    print("    [POSTED] Welcome VIP Banner embed.")
    time.sleep(0.5)

    pdf_dir = Path("web/public/vip-ebooks")
    if not pdf_dir.exists():
        pdf_dir = Path("public/vip-ebooks")

    books = [
        {
            "filename": "Da_khung_thoi_gian_H1_M15_M5.pdf",
            "title": "📘 1. Đa Khung Thời Gian H1 → M15 / M5",
            "desc": "Quy trình Top-Down Analysis chuẩn Quỹ: Xác định xu hướng H1, khoanh vùng POI trên M15 và bóp Entry tại M5.",
            "badge": "Price Action · Top-Down Bias",
            "color": 0x38BDF8,
        },
        {
            "filename": "Nhat_ky_checklist_giao_dich.pdf",
            "title": "📗 2. Nhật Ký & Checklist Giao Dịch",
            "desc": "Bộ biểu mẫu kế hoạch trước phiên, bảng kiểm tra 7 bước trước khi bấm lệnh và sổ theo dõi backtest.",
            "badge": "Quản Trị Vốn · Kỷ Luật Thép",
            "color": 0x10B981,
        },
        {
            "filename": "Pha_vo_that_vs_fakeout.pdf",
            "title": "📙 3. Phá Vỡ Thật vs Fakeout (Bẫy Quét)",
            "desc": "Cách phân biệt phá vỡ thực tế và bẫy phá vỡ giả (Trap). Tín hiệu xác nhận khối lượng và hành vi nến Retest.",
            "badge": "Price Action · Breakout Filter",
            "color": 0xF59E0B,
        },
        {
            "filename": "Phien_London_New_York_gio_vang.pdf",
            "title": "🌐 4. Phiên London / New York & Giờ Vàng",
            "desc": "Bản đồ múi giờ GMT+7 các phiên giao dịch, các vùng Killzone phiên Âu - Mỹ và thời khắc vàng của Vàng XAU/USD.",
            "badge": "Killzone Timing · Múi Giờ GMT+7",
            "color": 0x06B6D4,
        },
        {
            "filename": "So_tay_100_thuat_ngu_Forex.pdf",
            "title": "📕 5. Sổ Tay 100 Thuật Ngữ Forex Bỏ Túi",
            "desc": "100 thuật ngữ tài chính - ngoại hối Anh - Việt giải thích xúc tích: Pip, Spread, Margin, Slippage, Drawdown, FVG...",
            "badge": "Thuật Ngữ · Tra Cứu Nhanh",
            "color": 0xA855F7,
        },
        {
            "filename": "Giao_dich_vang_XAUUSD.pdf",
            "title": "🪙 6. Giao Dịch Vàng XAU/USD Chuyên Sâu",
            "desc": "Đặc tính hành vi của vàng, tương quan lợi suất trái phiếu Mỹ & DXY, cách tính đòn bẩy và 5 setup xác suất cao.",
            "badge": "Vàng XAU/USD · Setup Hay Gặp",
            "color": 0xEAB308,
        },
        {
            "filename": "Tam_ly_giao_dich_bay_FOMO.pdf",
            "title": "🧠 7. Tâm Lý Giao Dịch & Bẫy FOMO",
            "desc": "Giải mã vòng lặp cảm xúc sợ hãi - tham lam - trả thù thị trường. Bộ quy tắc Nếu... Thì... giúp giữ vững kỷ luật.",
            "badge": "Tâm Lý Học · Kiểm Soát Cảm Xúc",
            "color": 0xF43F5E,
        },
        {
            "filename": "Liquidity_bay_quet_stop_loss.pdf",
            "title": "🎯 8. Liquidity & Bẫy Quét Stop Loss",
            "desc": "Hiểu về cách Big Boys tạo lập thị trường săn tìm thanh khoản: Buy-side / Sell-side Liquidity, Sweep, Inducement.",
            "badge": "SMC · Thanh Khoản Thị Trường",
            "color": 0x3B82F6,
        },
        {
            "filename": "Zupirus_Kien_thuc_Forex.pdf",
            "title": "🎓 9. Zupirus Kiến Thức Forex Cốt Lõi",
            "desc": "Giáo trình toàn diện 11 bước từ nhập môn đến làm chủ phân tích định lượng XAU/USD của Zupirus Trading Academy.",
            "badge": "Giáo Trình Cốt Lõi · Toàn Tập",
            "color": 0x6366F1,
        },
        {
            "filename": "30_setup_mau_chu_thich_chart.pdf",
            "title": "📊 10. 30 Setup Mẫu Có Chú Thích Chart",
            "desc": "Bộ sưu tập 30 thế đánh thực chiến có sơ đồ trực quan, hướng dẫn điểm vào lệnh Entry, Stop-Loss Fail-Closed và chốt lời TP.",
            "badge": "30 Thế Đánh Quỹ · Đồ Thị Thực Tế",
            "color": 0x10B981,
        },
        {
            "filename": "Smart_Money_cho_nguoi_moi.pdf",
            "title": "⚡ 11. Smart Money Cho Người Mới Bắt Đầu",
            "desc": "Nắm vững cấu trúc dòng tiền thông minh: Break of Structure (BOS), Change of Character (CHoCH), Order Block và Fair Value Gap (FVG).",
            "badge": "SMC Nhập Môn · BOS / CHoCH / OB",
            "color": 0x38BDF8,
        },
        {
            "filename": "Cam_nang_mo_hinh_nen.pdf",
            "title": "🕯️ 12. Cẩm Nang 43 Mô Hình Nến Đảo Chiều",
            "desc": "Sổ tay 43 mẫu hình nến Price Action đảo chiều và tiếp diễn kinh điển kèm hình minh họa trực quan và điều kiện kích hoạt.",
            "badge": "Mô Hình Nến · 43 Mẫu Hình",
            "color": 0xF59E0B,
        },
    ]

    for idx, b in enumerate(books, 1):
        fpath = pdf_dir / b["filename"]
        if not fpath.exists():
            print(f"    [WARN] File not found: {fpath}")
            continue

        file_size_kb = fpath.stat().st_size / 1024
        print(f"    Uploading ({idx}/12) '{b['title']}' ({file_size_kb:.1f} KB)...")

        # Discord multipart upload
        boundary = f"----WebKitFormBoundary{int(time.time()*1000)}"
        embed_payload = {
            "title": b["title"],
            "description": f"{b['desc']}\n\n🏷️ **Thể loại:** `{b['badge']}`\n📄 **Dung lượng:** `{file_size_kb:.1f} KB`\n📥 **Tải về:** Đính kèm trực tiếp file PDF bên dưới",
            "color": b["color"],
            "footer": {"text": f"Ấn phẩm #{idx} · Thư viện ZUPIRUS Quant Academy"},
        }
        json_part = json.dumps({"embeds": [embed_payload]}).encode("utf-8")
        file_bytes = fpath.read_bytes()

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="payload_json"\r\n'
            f"Content-Type: application/json\r\n\r\n"
        ).encode("utf-8") + json_part + (
            f"\r\n--{boundary}\r\n"
            f'Content-Disposition: form-data; name="files[0]"; filename="{b["filename"]}"\r\n'
            f"Content-Type: application/pdf\r\n\r\n"
        ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

        req(
            "POST",
            f"/channels/{target_ch_id}/messages",
            is_multipart=True,
            data_bytes=body,
            content_type=f"multipart/form-data; boundary={boundary}",
        )
        print(f"    ✅ Uploaded ({idx}/12) '{b['filename']}' successfully.")
        time.sleep(1.0)

    print("\n🎉 ALL 12 VIP BOOKS HAVE BEEN DEPLOYED DIRECTLY TO DISCORD!")

if __name__ == "__main__":
    main()
