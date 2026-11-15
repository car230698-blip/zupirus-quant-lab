# Hướng Dẫn Vận Hành Sao Lưu, Khôi Phục & Chuyển Đổi PostgreSQL / TimescaleDB

Tài liệu này cung cấp quy trình vận hành tiêu chuẩn (SOP) cho việc sao lưu dữ liệu, khôi phục sau sự cố, và chuyển đổi từ cơ sở dữ liệu SQLite sang PostgreSQL + TimescaleDB trong **ZUPIRUS Quant Lab**.

---

## 1. Sao Lưu Cơ Sở Dữ Liệu (Backup)

Hệ thống hỗ trợ cả script Python tự động tạo metadata kiểm định và script Bash tiêu chuẩn cho môi trường Docker / Linux.

### Cách 1: Sử dụng Python Script (Khuyến nghị - Tạo file `.meta.json` đối soát)
```bash
python scripts/backup_postgres.py --url "postgresql://zupirus:zupirus_secure_password@127.0.0.1:5432/zupirus" --out ./backups
```
*Đầu ra:*
- File nén sao lưu: `./backups/zupirus_pg_backup_<TIMESTAMP>.sql.gz`
- File metadata kiểm định: `./backups/zupirus_pg_backup_<TIMESTAMP>.meta.json` chứa số lượng bản ghi của toàn bộ bảng tại thời điểm sao lưu.

### Cách 2: Sử dụng Docker Compose / Bash
```bash
bash scripts/backup_postgres.sh ./backups
```

---

## 2. Khôi Phục Cơ Sở Dữ Liệu (Restore & Verification)

### Bước 1: Khôi phục và đối soát số lượng bản ghi
```bash
python scripts/restore_postgres.py \
  --url "postgresql://zupirus:zupirus_secure_password@127.0.0.1:5432/zupirus_test" \
  --backup "./backups/zupirus_pg_backup_<TIMESTAMP>.sql.gz" \
  --meta "./backups/zupirus_pg_backup_<TIMESTAMP>.meta.json"
```

*Cơ chế đối soát:*
Script tự động đọc file `.meta.json`, truy vấn `COUNT(*)` của từng bảng sau khi khôi phục, và in bảng báo cáo PASS/FAIL đối chiếu số dòng thực tế so với bản sao lưu gốc.

### Khôi phục trực tiếp qua Docker:
```bash
bash scripts/restore_postgres.sh ./backups/zupirus_pg_backup_<TIMESTAMP>.sql.gz
```

---

## 3. Chuyển Đổi Dữ Liệu Từ SQLite Cũ Sang PostgreSQL (Migration & Rollback)

Khi nâng cấp từ phiên bản SQLite sang PostgreSQL + TimescaleDB:

### Bước 1: Chạy script chuyển đổi
```bash
python scripts/migrate_sqlite_to_pg.py \
  --sqlite "./data/lab.sqlite3" \
  --pg "postgresql://zupirus:zupirus_secure_password@127.0.0.1:5432/zupirus"
```

*Quy trình tự động:*
1. **Tự động Snapshot quay lui:** Tạo file sao lưu snapshot `data/snapshots/lab_rollback_snap_<TIMESTAMP>.sqlite3`.
2. **Khởi tạo Schema & Hypertables:** Chạy versioned migrations (`schema_migrations`) trên PostgreSQL.
3. **Bơm dữ liệu nguyên tử (Atomic Ingestion):** Sử dụng `ON CONFLICT DO NOTHING` để không bao giờ ghi trùng dữ liệu nếu chạy lại nhiều lần.
4. **Kiểm tra đối soát 100% bản ghi:** So sánh số lượng dòng giữa SQLite và PostgreSQL cho từng bảng (`users`, `accounts`, `signals`, `dispatches`, `audit`, `kv`, `quotes`, `candles`).

### Bước 2: Kế hoạch quay lui (Rollback Procedure)
Nếu phát hiện bất thường sau khi chuyển đổi:
1. Đặt biến môi trường `DATABASE_URL=""` trong file cấu hình `.env` của container để hệ thống tự động quay về sử dụng SQLite an toàn.
2. Khôi phục file SQLite từ thư mục snapshot:
   ```bash
   cp data/snapshots/lab_rollback_snap_<TIMESTAMP>.sqlite3 data/lab.sqlite3
   ```
3. Khởi động lại service bằng Docker Compose.
