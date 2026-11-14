#!/usr/bin/env python3
"""
ZUPIRUS Quant Lab — Bộ thu báo giá Bid/Ask XAUUSD từ MetaTrader 5 Demo (Windows x64)
Lưu bền vững vào SQLite cục bộ (WAL) khi VPS hoặc mạng gián đoạn và tự động đồng bộ
theo lô lũy đẳng (idempotent batches) sang máy chủ Linux VPS (/api/ingest/ticks).

Yêu cầu môi trường trên máy Windows chạy MT5 Demo:
- Hệ điều hành: Windows 10/11 hoặc Windows Server (64-bit / x64)
- Phiên bản Python: Python 3.14 (Windows x64).
- Cài đặt gói một lần:
    py -3.14 -m pip install --upgrade pip MetaTrader5
"""

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


CANDIDATE_XAU_SYMBOLS = [
    "XAUUSD",
    "XAUUSDm",
    "XAUUSD.a",
    "XAUUSDc",
    "XAUUSD.pro",
    "XAUUSD_i",
    "XAUUSD.ecn",
    "GOLD",
    "GOLDm",
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def normalize_canonical_symbol(raw_symbol: str) -> str:
    upper = raw_symbol.strip().upper()
    if upper.startswith("XAUUSD") or upper.startswith("GOLD"):
        return "XAUUSD"
    return "XAUUSD"


class SqliteTickSpool:
    """
    Bộ lưu trữ SQLite bền vững tại máy trạm Windows thu thập MT5.
    Đảm bảo:
    - Không mất tick khi VPS bảo trì hoặc đứt mạng.
    - Khôi phục đúng mốc thời gian (watermark) khi khởi động lại bộ thu.
    - Phân biệt tick trùng khi đọc gối đầu (overlap poll) với nhiều báo giá hợp lệ trong cùng mili-giây.
    """

    def __init__(self, db_path: str) -> None:
        self.db_path = os.path.abspath(db_path)
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self.conn = sqlite3.connect(self.db_path, timeout=30.0)
        self.conn.execute("PRAGMA journal_mode=WAL;")
        self.conn.execute("PRAGMA synchronous=FULL;")
        self._init_schema()

    def _init_schema(self) -> None:
        with self.conn:
            self.conn.execute(
                """
                CREATE TABLE IF NOT EXISTS ticks_spool (
                    spool_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    raw_symbol TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    time_ms INTEGER NOT NULL,
                    seq_within_ms INTEGER NOT NULL,
                    bid REAL NOT NULL,
                    ask REAL NOT NULL,
                    flags INTEGER NOT NULL DEFAULT 0,
                    source_tick_hash TEXT NOT NULL,
                    recorded_at_utc TEXT NOT NULL,
                    synced INTEGER NOT NULL DEFAULT 0,
                    synced_batch_id TEXT,
                    UNIQUE(raw_symbol, time_ms, seq_within_ms)
                );
                """
            )
            self.conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_ticks_spool_unsynced
                ON ticks_spool(synced, spool_id);
                """
            )
            self.conn.execute(
                """
                CREATE TABLE IF NOT EXISTS collector_watermark (
                    raw_symbol TEXT PRIMARY KEY,
                    last_time_ms INTEGER NOT NULL,
                    last_seq_within_ms INTEGER NOT NULL,
                    last_bid REAL NOT NULL,
                    last_ask REAL NOT NULL,
                    updated_at_utc TEXT NOT NULL
                );
                """
            )

    def get_watermark(self, raw_symbol: str) -> Optional[Tuple[int, int, float, float]]:
        cur = self.conn.execute(
            """
            SELECT last_time_ms, last_seq_within_ms, last_bid, last_ask
            FROM collector_watermark
            WHERE raw_symbol = ?
            """,
            (raw_symbol,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return int(row[0]), int(row[1]), float(row[2]), float(row[3])

    def append_ticks(
        self,
        raw_symbol: str,
        ticks: List[Dict[str, Any]],
    ) -> int:
        """
        Ghi danh sách báo giá Bid/Ask vào SQLite theo thứ tự thời gian.
        Hỗ trợ nhiều báo giá hợp lệ trong cùng 1 mili-giây (tăng seq_within_ms)
        và bỏ qua các báo giá trùng lặp khi đọc gối đầu từ mốc watermark.
        """
        if not ticks:
            return 0

        canonical = normalize_canonical_symbol(raw_symbol)
        wm = self.get_watermark(raw_symbol)
        last_time_ms = wm[0] if wm else -1
        last_seq = wm[1] if wm else -1
        last_bid = wm[2] if wm else -1.0
        last_ask = wm[3] if wm else -1.0

        # Each poll includes the entire watermark millisecond. Preserve sequence
        # by skipping the ordered prefix already stored, even when quotes repeat.
        overlap_count = 0
        watermark_time = last_time_ms
        watermark_seq = last_seq
        inserted = 0
        now_str = utc_now_iso()

        with self.conn:
            for t in ticks:
                time_ms = int(t["time_ms"])
                bid = round(float(t["bid"]), 5)
                ask = round(float(t["ask"]), 5)
                flags = int(t.get("flags", 0))

                if bid <= 0 or ask < bid or time_ms <= 0:
                    continue

                # Bỏ qua tick cũ hơn mốc watermark đã lưu
                if time_ms < last_time_ms:
                    continue

                if time_ms == watermark_time and t.get("seq_within_ms") is None:
                    overlap_count += 1
                    if overlap_count <= watermark_seq + 1:
                        continue

                if time_ms == last_time_ms:
                    # Nếu cùng mili-giây và cùng đúng mức giá Bid/Ask vừa ghi ở ranh giới poll -> tick trùng
                    explicit_seq = t.get("seq_within_ms")
                    if explicit_seq is not None and int(explicit_seq) <= last_seq:
                        continue
                    if (
                        explicit_seq is None
                        and abs(bid - last_bid) < 1e-8
                        and abs(ask - last_ask) < 1e-8
                    ):
                        continue
                    seq_within_ms = (
                        int(explicit_seq)
                        if explicit_seq is not None
                        else (last_seq + 1)
                    )
                else:
                    seq_within_ms = int(t.get("seq_within_ms", 0))

                tick_hash = hashlib.sha256(
                    f"{raw_symbol}:{time_ms}:{seq_within_ms}:{bid:.5f}:{ask:.5f}".encode(
                        "utf-8"
                    )
                ).hexdigest()[:24]

                cur = self.conn.execute(
                    """
                    INSERT OR IGNORE INTO ticks_spool
                    (raw_symbol, symbol, time_ms, seq_within_ms, bid, ask, flags, source_tick_hash, recorded_at_utc, synced)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                    """,
                    (
                        raw_symbol,
                        canonical,
                        time_ms,
                        seq_within_ms,
                        bid,
                        ask,
                        flags,
                        tick_hash,
                        now_str,
                    ),
                )
                if cur.rowcount > 0:
                    inserted += 1
                    last_time_ms = time_ms
                    last_seq = seq_within_ms
                    last_bid = bid
                    last_ask = ask

            if last_time_ms > 0:
                self.conn.execute(
                    """
                    INSERT INTO collector_watermark
                    (raw_symbol, last_time_ms, last_seq_within_ms, last_bid, last_ask, updated_at_utc)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(raw_symbol) DO UPDATE SET
                        last_time_ms = excluded.last_time_ms,
                        last_seq_within_ms = excluded.last_seq_within_ms,
                        last_bid = excluded.last_bid,
                        last_ask = excluded.last_ask,
                        updated_at_utc = excluded.updated_at_utc
                    """,
                    (raw_symbol, last_time_ms, last_seq, last_bid, last_ask, now_str),
                )

        return inserted

    def fetch_pending_batch(self, limit: int = 250) -> List[Dict[str, Any]]:
        cur = self.conn.execute(
            """
            SELECT spool_id, raw_symbol, symbol, time_ms, seq_within_ms, bid, ask, flags, source_tick_hash
            FROM ticks_spool
            WHERE synced = 0
            ORDER BY time_ms ASC, seq_within_ms ASC, spool_id ASC
            LIMIT ?
            """,
            (limit,),
        )
        rows = cur.fetchall()
        result: List[Dict[str, Any]] = []
        for r in rows:
            result.append(
                {
                    "spoolId": int(r[0]),
                    "rawSymbol": str(r[1]),
                    "symbol": str(r[2]),
                    "timeMs": int(r[3]),
                    "seqWithinMs": int(r[4]),
                    "bid": float(r[5]),
                    "ask": float(r[6]),
                    "flags": int(r[7]),
                    "sourceTickId": str(r[8]),
                }
            )
        return result

    def mark_batch_synced(self, spool_ids: List[int], batch_id: str) -> None:
        if not spool_ids:
            return
        placeholders = ",".join("?" for _ in spool_ids)
        with self.conn:
            self.conn.execute(
                f"UPDATE ticks_spool SET synced = 1, synced_batch_id = ? WHERE spool_id IN ({placeholders})",
                [batch_id, *spool_ids],
            )

    def count_pending(self) -> int:
        cur = self.conn.execute("SELECT COUNT(*) FROM ticks_spool WHERE synced = 0")
        row = cur.fetchone()
        return int(row[0]) if row else 0

    def count_total(self) -> int:
        cur = self.conn.execute("SELECT COUNT(*) FROM ticks_spool")
        row = cur.fetchone()
        return int(row[0]) if row else 0

    def close(self) -> None:
        self.conn.close()


def send_batch_to_vps(
    vps_url: str,
    collector_token: str,
    collector_id: str,
    batch_rows: List[Dict[str, Any]],
    timeout_sec: float = 10.0,
) -> Dict[str, Any]:
    if not batch_rows:
        return {"acknowledged": True, "empty": True}

    first_id = batch_rows[0]["spoolId"]
    last_id = batch_rows[-1]["spoolId"]
    raw_symbol = batch_rows[0]["rawSymbol"]
    batch_id = f"MT5-BATCH-{collector_id}-{raw_symbol}-{first_id}-{last_id}"

    payload = {
        "batchId": batch_id,
        "collectorId": collector_id,
        "rawSymbol": raw_symbol,
        "symbol": batch_rows[0]["symbol"],
        "sentAtUtc": utc_now_iso(),
        "ticks": [
            {
                "timeMs": item["timeMs"],
                "seqWithinMs": item["seqWithinMs"],
                "bid": item["bid"],
                "ask": item["ask"],
                "sourceTickId": item["sourceTickId"],
                "rawSymbol": item["rawSymbol"],
            }
            for item in batch_rows
        ],
    }

    body_bytes = json.dumps(payload).encode("utf-8")
    endpoint = vps_url.rstrip("/") + "/api/ingest/ticks"
    req = urllib.request.Request(
        endpoint,
        data=body_bytes,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {collector_token}",
            "X-Zupirus-Role": "COLLECTOR",
        },
    )

    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
        resp_body = resp.read().decode("utf-8")
        parsed = json.loads(resp_body)
        if resp.status in (200, 201) and parsed.get("acknowledged") is True:
            return {"acknowledged": True, "batchId": batch_id, "response": parsed}
        raise RuntimeError(f"VPS chưa xác nhận lưu bền vững lô {batch_id}: {resp_body}")


def sync_pending_batches(
    spool: SqliteTickSpool,
    vps_url: str,
    collector_token: str,
    collector_id: str,
    batch_size: int = 250,
) -> Tuple[int, Optional[str]]:
    total_synced = 0
    while True:
        pending = spool.fetch_pending_batch(limit=batch_size)
        if not pending:
            break
        try:
            res = send_batch_to_vps(
                vps_url=vps_url,
                collector_token=collector_token,
                collector_id=collector_id,
                batch_rows=pending,
            )
            if res.get("acknowledged"):
                spool.mark_batch_synced(
                    [r["spoolId"] for r in pending], str(res["batchId"])
                )
                total_synced += len(pending)
            else:
                break
        except Exception as exc:
            return total_synced, str(exc)
    return total_synced, None


def resolve_mt5_symbol(mt5_mod: Any, preferred_symbol: Optional[str]) -> str:
    if preferred_symbol:
        info = mt5_mod.symbol_info(preferred_symbol)
        if info is not None:
            if not info.visible:
                mt5_mod.symbol_select(preferred_symbol, True)
            return preferred_symbol

    for cand in CANDIDATE_XAU_SYMBOLS:
        info = mt5_mod.symbol_info(cand)
        if info is not None:
            if not info.visible:
                mt5_mod.symbol_select(cand, True)
            return cand

    all_symbols = mt5_mod.symbols_get() or []
    for s in all_symbols:
        name = getattr(s, "name", "")
        if "XAUUSD" in name.upper():
            mt5_mod.symbol_select(name, True)
            return name

    raise RuntimeError(
        "Không tìm thấy mã XAUUSD (hoặc hậu tố XAUUSDm/XAUUSD.a) trên MT5 Terminal."
    )


def run_self_test(db_path: str, vps_url: Optional[str], token: str) -> int:
    """
    Kiểm thử tự động bộ thu SQLite (chạy được trên cả Linux CI và Windows):
    - Kiểm tra hậu tố tên mã (XAUUSDm -> XAUUSD)
    - Kiểm tra nhiều báo giá hợp lệ trong cùng mili-giây vs tick trùng
    - Kiểm tra lưu bền vững khi chưa có kết nối VPS và tự đồng bộ lại từ mốc đã ghi sau restart
    """
    spool = SqliteTickSpool(db_path)
    sample_ticks = [
        {"time_ms": 1772438400100, "bid": 2860.10, "ask": 2860.26},
        # Báo giá thứ 2 hợp lệ trong cùng mili-giây 1772438400100 (giá thay đổi)
        {"time_ms": 1772438400100, "bid": 2860.12, "ask": 2860.28},
        # Báo giá trùng lặp ở ranh giới poll -> phải bị bỏ qua
        {"time_ms": 1772438400100, "bid": 2860.12, "ask": 2860.28},
        {"time_ms": 1772438400500, "bid": 2860.20, "ask": 2860.36},
    ]
    inserted_first = spool.append_ticks("XAUUSDm", sample_ticks)
    same_ms = sample_ticks[:2]
    with tempfile.TemporaryDirectory() as overlap_dir:
        overlap_store = SqliteTickSpool(os.path.join(overlap_dir, "same-ms.sqlite"))
        assert overlap_store.append_ticks("XAUUSDm", same_ms) == 2
        assert overlap_store.append_ticks("XAUUSDm", same_ms) == 0
        overlap_store.close()
    spool.close()

    # Mở lại kết nối SQLite (mô phỏng restart bộ thu) và gửi lại lô gối đầu
    spool2 = SqliteTickSpool(db_path)
    overlap_ticks = [
        {"time_ms": 1772438400100, "bid": 2860.10, "ask": 2860.26},
        {"time_ms": 1772438400500, "bid": 2860.20, "ask": 2860.36},
        {"time_ms": 1772438400900, "bid": 2860.35, "ask": 2860.50},
    ]
    inserted_second = spool2.append_ticks("XAUUSDm", overlap_ticks)
    pending_before_sync = spool2.count_pending()

    synced_count = 0
    sync_err = None
    if vps_url:
        synced_count, sync_err = sync_pending_batches(
            spool=spool2,
            vps_url=vps_url,
            collector_token=token,
            collector_id="WIN-MT5-SELFTEST",
            batch_size=100,
        )

    summary = {
        "status": "ok",
        "rawSymbol": "XAUUSDm",
        "canonicalSymbol": normalize_canonical_symbol("XAUUSDm"),
        "insertedFirstRun": inserted_first,
        "insertedAfterRestartOverlap": inserted_second,
        "totalStoredInSqlite": spool2.count_total(),
        "pendingBeforeSync": pending_before_sync,
        "syncedToVps": synced_count,
        "pendingAfterSync": spool2.count_pending(),
        "syncError": sync_err,
    }
    spool2.close()
    print(json.dumps(summary))
    if inserted_first != 3 or inserted_second != 1:
        return 1
    if vps_url and sync_err is not None:
        return 2
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bộ thu báo giá Bid/Ask XAUUSD từ MT5 Demo (Windows) đồng bộ bền vững sang ZUPIRUS Quant Lab VPS"
    )
    parser.add_argument(
        "--vps-url",
        default=os.environ.get("ZUPIRUS_VPS_URL", "http://127.0.0.1:3000"),
        help="URL máy chủ ZUPIRUS Quant Lab (ví dụ: http://127.0.0.1:3100)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("COLLECTOR_AUTH_TOKEN", ""),
        help="Bearer token xác thực của bộ thu (COLLECTOR_AUTH_TOKEN)",
    )
    parser.add_argument(
        "--symbol",
        default=os.environ.get("MT5_SYMBOL", ""),
        help="Tên mã trên MT5 (để trống sẽ tự dò XAUUSD / XAUUSDm / XAUUSD.a)",
    )
    parser.add_argument(
        "--db-path",
        default=os.environ.get(
            "COLLECTOR_DB_PATH", "./data/collector/mt5_ticks_spool.db"
        ),
        help="Đường dẫn file SQLite lưu đệm bền vững trên máy Windows",
    )
    parser.add_argument(
        "--collector-id",
        default=os.environ.get("COLLECTOR_ID", "MT5-WIN-DEMO-01"),
        help="Mã định danh bộ thu",
    )
    parser.add_argument(
        "--poll-interval-ms",
        type=int,
        default=250,
        help="Chu kỳ đọc tick từ MT5 (mili-giây)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=250,
        help="Số lượng tick tối đa mỗi lô gửi lên VPS",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Chạy chế độ tự kiểm thử SQLite spool, hậu tố mã, mốc khôi phục và đồng bộ HTTP",
    )
    args = parser.parse_args()

    if args.self_test:
        return run_self_test(
            db_path=args.db_path,
            vps_url=args.vps_url if args.vps_url != "none" else None,
            token=args.token,
        )

    try:
        import MetaTrader5 as mt5  # type: ignore
    except ImportError:
        sys.stderr.write(
            "Lỗi: Chưa cài gói MetaTrader5. Trên Windows x64 (ví dụ Python 3.14), chạy: py -3.14 -m pip install MetaTrader5\n"
        )
        return 1

    if not mt5.initialize():
        sys.stderr.write(f"Không thể khởi tạo kết nối MT5 Terminal: {mt5.last_error()}\n")
        return 1

    try:
        account = mt5.account_info()
        if account is None or account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
            sys.stderr.write("Đăng nhập tài khoản MT5 Demo trước khi chạy bộ thu.\n")
            return 1
        raw_symbol = resolve_mt5_symbol(mt5, args.symbol or None)
        spool = SqliteTickSpool(args.db_path)
        print(
            f"[MT5 Collector] Đã kết nối MT5 Demo. Mã thu thập: {raw_symbol} -> {normalize_canonical_symbol(raw_symbol)}. SQLite: {args.db_path}"
        )

        while True:
            wm = spool.get_watermark(raw_symbol)
            if wm is not None:
                from_sec = max(0, (wm[0] // 1000) - 2)
                from_dt = datetime.fromtimestamp(from_sec, tz=timezone.utc)
            else:
                from_dt = datetime.fromtimestamp(
                    max(0, int(time.time()) - 60), tz=timezone.utc
                )

            # A fixed tick count can fill entirely inside the overlap at busy times.
            raw_ticks = mt5.copy_ticks_range(
                raw_symbol, from_dt, datetime.now(timezone.utc), mt5.COPY_TICKS_INFO
            )
            parsed_ticks: List[Dict[str, Any]] = []
            if raw_ticks is not None and len(raw_ticks) > 0:
                previous_time, sequence = -1, 0
                for rt in raw_ticks:
                    time_msc = int(rt["time_msc"]) or int(rt["time"]) * 1000
                    bid = float(rt["bid"])
                    ask = float(rt["ask"])
                    flags = int(rt["flags"])
                    if bid > 0 and ask >= bid:
                        sequence = sequence + 1 if time_msc == previous_time else 0
                        previous_time = time_msc
                        parsed_ticks.append(
                            {
                                "time_ms": time_msc,
                                "seq_within_ms": sequence,
                                "bid": bid,
                                "ask": ask,
                                "flags": flags,
                            }
                        )

            spool.append_ticks(raw_symbol, parsed_ticks)
            synced, err = sync_pending_batches(
                spool=spool,
                vps_url=args.vps_url,
                collector_token=args.token,
                collector_id=args.collector_id,
                batch_size=args.batch_size,
            )
            if err:
                sys.stderr.write(
                    f"[MT5 Collector] Tạm hoãn đồng bộ VPS ({err}). Đang lưu bền vững {spool.count_pending()} tick trong SQLite.\n"
                )
            time.sleep(max(0.05, args.poll_interval_ms / 1000.0))
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    sys.exit(main())
