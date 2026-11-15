# Hướng Dẫn Vận Hành Sao Lưu, Khôi Phục & Chuyển Đổi PostgreSQL / TimescaleDB

Tài liệu này cung cấp quy trình vận hành tiêu chuẩn (SOP) cho việc sao lưu dữ liệu, khôi phục sau sự cố, và chuyển đổi từ cơ sở dữ liệu SQLite sang PostgreSQL + TimescaleDB trong **ZUPIRUS Quant Lab**.

---

## 1. Sao lưu PostgreSQL / TimescaleDB

Trong thư mục dự án, chọn đúng tên project và file Compose của stack đang chạy. Khi không cấu hình `DATABASE_URL`, script dùng `pg_dump` và `pg_restore` trong container TimescaleDB.

```bash
export COMPOSE_PROJECT_NAME=zupirus-test
export COMPOSE_FILE=compose.yaml:compose.staging.yaml
bash scripts/backup_postgres.sh ./backups
```

Script in đường dẫn file `.dump` sau khi `pg_dump` thành công và danh mục trong archive đọc được. Với database bên ngoài Compose, dùng `python3 scripts/backup_postgres.py --url "$DATABASE_URL" --out ./backups` và cài các công cụ PostgreSQL client tương thích.

## 2. Khôi phục và kiểm chứng

Dùng database mới, trống, trên môi trường tương thích với phiên bản PostgreSQL và TimescaleDB của nguồn sao lưu. Ví dụ dưới đây dùng cùng container TimescaleDB nhưng một database riêng.

```bash
docker compose exec -T timescaledb sh -ec 'createdb -U "$POSTGRES_USER" zupirus_restore_check'
bash scripts/restore_postgres.sh ./backups/zupirus_pg_backup_TIMESTAMP.dump zupirus_restore_check
docker compose exec -T timescaledb sh -ec 'psql -X -U "$POSTGRES_USER" -d zupirus_restore_check'
```

Script chuẩn bị TimescaleDB, chạy restore và trả lỗi khi công cụ PostgreSQL thất bại. Script cũng đọc các bản `.sql.gz` do `pg_dump` tạo. Trong database khôi phục, kiểm tra số bản ghi và giá trị mẫu của các bảng quan trọng, đồng thời kiểm tra `timescaledb_information.hypertables`. Docker smoke tự chạy một lượt restore, đối chiếu báo giá đã ghi và xác nhận bảng `quotes` vẫn là hypertable.

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

