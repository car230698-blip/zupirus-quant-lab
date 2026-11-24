"""Script to upload 10 trading books (PDF) from zip to Discord via Webhook with beautiful embeds."""
import os
import sys
import zipfile
import urllib.request
import urllib.parse
import json
import uuid

BOOK_DESCRIPTIONS = {
    "Lo_trinh_30_ngay_cho_nguoi_moi.pdf": "📘 Cuốn 01: Lộ trình 30 ngày nhập môn Trading chuẩn chỉ từ số 0.",
    "Nen_dao_chieu_tai_vung_Pin_Bar_Engulfing.pdf": "📙 Cuốn 02: Nến đảo chiều tại vùng then chốt (Pin Bar, Engulfing & False Break).",
    "Cau_truc_thi_truong_BOS_CHoCH.pdf": "📗 Cuốn 03: Đọc hiểu cấu trúc thị trường chuyên sâu (BOS & CHoCH Market Structure).",
    "Ho_tro_khang_cu_cung_cau_kenh_gia.pdf": "📕 Cuốn 04: Vùng Cung Cầu (Supply & Demand), Hỗ Trợ Kháng Cự & Kênh Giá.",
    "Nhip_hoi_Fibonacci_OTE.pdf": "📓 Cuốn 05: Điểm vào lệnh tối ưu OTE & Nhịp hồi quy chuẩn Fibonacci.",
    "Mo_hinh_gia_kinh_dien.pdf": "📔 Cuốn 06: Tổng hợp mô hình giá kinh điển (Double Top/Bottom, Head & Shoulders).",
    "Order_Block_FVG_Breaker_chuyen_sau.pdf": "💎 Cuốn 07: Phương pháp Smart Money Concept (SMC) - Order Block, FVG & Breaker Block.",
    "Stop_Loss_Take_Profit_khoi_luong_lenh.pdf": "🛡️ Cuốn 08: Quản trị vốn, tính toán khối lượng Lot & kỹ thuật đặt SL/TP theo ATR.",
    "Tin_tuc_va_lich_kinh_te.pdf": "📰 Cuốn 09: Giao dịch theo tin tức, lịch kinh tế (CPI, NFP, FOMC) & cơ chế News Shield.",
    "Sai_lam_nguoi_moi_va_khi_nao_dung_ngoai.pdf": "⛔ Cuốn 10: Những sai lầm chết người của người mới & khi nào cần đứng ngoài thị trường."
}

def upload_pdf_webhook(webhook_url: str, pdf_name: str, pdf_bytes: bytes, description: str):
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    
    embed = {
        "title": f"📚 {pdf_name.replace('_', ' ').replace('.pdf', '')}",
        "description": description,
        "color": 0xF59E0B,
        "footer": {"text": "ZUPIRUS Quant Lab · Thư Viện Kiến Thức Giao Dịch"}
    }
    
    payload_json = json.dumps({
        "embeds": [embed]
    })
    
    body = bytearray()
    # payload_json part
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(b'Content-Disposition: form-data; name="payload_json"\r\n')
    body.extend(b'Content-Type: application/json\r\n\r\n')
    body.extend(payload_json.encode())
    body.extend(b'\r\n')
    
    # file part
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(f'Content-Disposition: form-data; name="files[0]"; filename="{pdf_name}"\r\n'.encode())
    body.extend(b'Content-Type: application/pdf\r\n\r\n')
    body.extend(pdf_bytes)
    body.extend(b'\r\n')
    
    body.extend(f"--{boundary}--\r\n".encode())
    
    req = urllib.request.Request(
        webhook_url,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "ZupirusUploader/1.0"
        },
        method="POST"
    )
    
    with urllib.request.urlopen(req) as resp:
        return resp.status

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python upload_books_to_discord.py <zip_path> <webhook_url>")
        sys.exit(1)
        
    zip_path = sys.argv[1]
    webhook_url = sys.argv[2]
    
    print(f"Opening zip: {zip_path}")
    with zipfile.ZipFile(zip_path, 'r') as z:
        for filename in sorted(z.namelist()):
            if not filename.endswith(".pdf"):
                continue
            desc = BOOK_DESCRIPTIONS.get(filename, f"Tài liệu giao dịch định lượng: {filename}")
            print(f"Uploading {filename}...")
            data = z.read(filename)
            try:
                status = upload_pdf_webhook(webhook_url, filename, data, desc)
                print(f" -> OK ({status})")
            except Exception as e:
                print(f" -> FAILED: {e}")
            import time
            time.sleep(1.5) # avoid rate limits
    print("Done uploading all books!")
