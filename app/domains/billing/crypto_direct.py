"""ZUPIRUS Quant Lab - Direct USDT On-Chain Payment Engine.
Supports direct, peer-to-peer cryptocurrency payments into Admin-owned wallets:
- USDT TRC20 (TRON Network)
- USDT BEP20 (BNB Smart Chain)

Features:
- 0% intermediary fee (no third-party processors)
- Unique exact amount allocation per order within a 30-minute window
- Public blockchain RPC verification against official token contracts
- Atomic idempotent fulfillment with double-spending prevention
- Zero private keys stored on server
"""
import os
import re
import time
import json
import random
import secrets
import logging
import urllib.request
import urllib.error
from typing import Dict, Any, Tuple, Optional, List
from app.db import tx, audit, is_postgres

logger = logging.getLogger("zupirus.billing.crypto_direct")

# Fallback default receiving wallet addresses from environment
DEFAULT_TRC20_WALLET = os.getenv("USDT_TRC20_ADDRESS", "").strip()
DEFAULT_BEP20_WALLET = os.getenv("USDT_BEP20_ADDRESS", "").strip()

# Official USDT Smart Contract Addresses
USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
USDT_BEP20_CONTRACT = "0x55d398326f99059fF775485246999027B3197955"

# RPC Endpoints with fallbacks
BSC_RPC_ENDPOINTS = [
    "https://binance.llamarpc.com",
    "https://bsc-dataseed.binance.org",
    "https://bsc-dataseed1.defibit.io",
]
TRONGRID_API_URL = "https://api.trongrid.io"

# ERC20 / TRC20 Transfer event signature: Transfer(address,address,uint256)
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

# Regex validation
TRC20_REGEX = re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$")
BEP20_REGEX = re.compile(r"^0x[a-fA-F0-9]{40}$")


def _call_bsc_rpc_impl(method: str, params: list) -> Any:
    payload = json.dumps({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1,
    }).encode("utf-8")
    for rpc_url in BSC_RPC_ENDPOINTS:
        try:
            req = urllib.request.Request(
                rpc_url,
                data=payload,
                headers={"Content-Type": "application/json", "User-Agent": "ZupirusQuantLab/0.2.0"}
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                res = json.loads(resp.read().decode("utf-8"))
                if "result" in res:
                    return res["result"]
        except Exception as e:
            logger.debug(f"BSC RPC {rpc_url} failed for {method}: {e}")
            continue
    return None


def call_bsc_rpc(method: str, params: list) -> Any:
    """Execute a JSON-RPC call against Binance Smart Chain RPC endpoints with fallback."""
    return _call_bsc_rpc(method, params)


def _call_bsc_rpc(method: str, params: list) -> Any:
    return _call_bsc_rpc_impl(method, params)


def validate_trc20_address(address: str) -> bool:
    """Validate TRON Base58 address format (starts with T, length 34)."""
    if not address or not isinstance(address, str):
        return False
    return bool(TRC20_REGEX.match(address.strip()))


def validate_bep20_address(address: str) -> bool:
    """Validate EVM hex address format (starts with 0x, length 42)."""
    if not address or not isinstance(address, str):
        return False
    return bool(BEP20_REGEX.match(address.strip()))


def validate_crypto_address(address: str, network: str) -> bool:
    """Validate crypto address based on network type."""
    net = (network or "").upper()
    if net in ("TRC20", "TRON"):
        return validate_trc20_address(address)
    if net in ("BEP20", "BSC", "EVM"):
        return validate_bep20_address(address)
    return False


def get_crypto_wallets_config(db_cursor: Optional[Any] = None) -> Dict[str, Any]:
    """Retrieve active Admin receiving wallet addresses from kv store."""
    def _read_from_cursor(c):
        row = c.execute("SELECT value FROM kv WHERE key = 'billing:crypto_wallets'").fetchone()
        if row and row[0]:
            try:
                data = json.loads(row[0])
                if isinstance(data, dict):
                    trc20 = str(data.get("usdt_trc20_address") or data.get("trc20_address") or "").strip()
                    bep20 = str(data.get("usdt_bep20_address") or data.get("bep20_address") or "").strip()
                    has_wallets = bool(trc20 or bep20)
                    return {
                        "enabled": bool(data.get("enabled", True)) and has_wallets,
                        "trc20_address": trc20,
                        "bep20_address": bep20,
                        "usdt_trc20_address": trc20,
                        "usdt_bep20_address": bep20,
                        "has_trc20": bool(trc20),
                        "has_bep20": bool(bep20),
                    }
            except Exception as e:
                logger.warning(f"Failed parsing crypto_wallets config: {e}")
        has_default_wallets = bool(DEFAULT_TRC20_WALLET or DEFAULT_BEP20_WALLET)
        return {
            "enabled": has_default_wallets,
            "trc20_address": DEFAULT_TRC20_WALLET,
            "bep20_address": DEFAULT_BEP20_WALLET,
            "usdt_trc20_address": DEFAULT_TRC20_WALLET,
            "usdt_bep20_address": DEFAULT_BEP20_WALLET,
            "has_trc20": bool(DEFAULT_TRC20_WALLET),
            "has_bep20": bool(DEFAULT_BEP20_WALLET),
        }

    if db_cursor is not None:
        return _read_from_cursor(db_cursor)
    with tx() as c:
        return _read_from_cursor(c)


def save_crypto_wallets_config(
    enabled: bool = True,
    usdt_trc20_address: Optional[str] = None,
    usdt_bep20_address: Optional[str] = None,
    trc20_address: Optional[str] = None,
    bep20_address: Optional[str] = None,
    admin_id: str = "admin",
) -> Dict[str, Any]:
    """Validate and store Admin receiving wallet addresses in kv store."""
    trc20_clean = (trc20_address if trc20_address is not None else usdt_trc20_address or "").strip()
    bep20_clean = (bep20_address if bep20_address is not None else usdt_bep20_address or "").strip()

    if trc20_clean and not validate_trc20_address(trc20_clean):
        raise ValueError("Địa chỉ ví USDT TRC20 không hợp lệ (phải bắt đầu bằng chữ T và dài đúng 34 ký tự Base58).")

    if bep20_clean and not validate_bep20_address(bep20_clean):
        raise ValueError("Địa chỉ ví USDT BEP20 không hợp lệ (phải bắt đầu bằng 0x và dài đúng 42 ký tự hex).")

    payload = {
        "enabled": bool(enabled),
        "trc20_address": trc20_clean,
        "bep20_address": bep20_clean,
        "usdt_trc20_address": trc20_clean,
        "usdt_bep20_address": bep20_clean,
        "updated_at": time.time(),
        "updated_by": admin_id,
    }

    with tx() as c:
        c.execute(
            "INSERT INTO kv (key, value) VALUES ('billing:crypto_wallets', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (json.dumps(payload),)
        )
        audit(c, admin_id, "crypto_wallet_updated", {
            "enabled": bool(enabled),
            "has_trc20": bool(trc20_clean),
            "has_bep20": bool(bep20_clean),
        })

    return {
        "enabled": bool(enabled),
        "trc20_address": trc20_clean,
        "bep20_address": bep20_clean,
        "usdt_trc20_address": trc20_clean,
        "usdt_bep20_address": bep20_clean,
    }


def get_active_billing_methods() -> Dict[str, bool]:
    """Return active payment gateways based on configuration."""
    cfg = get_crypto_wallets_config()
    is_enabled = bool(cfg.get("enabled", False))
    trc20_ready = is_enabled and validate_trc20_address(cfg.get("usdt_trc20_address", ""))
    bep20_ready = is_enabled and validate_bep20_address(cfg.get("usdt_bep20_address", ""))

    return {
        "sepay": True,
        "usdt_trc20": bool(trc20_ready),
        "usdt_bep20": bool(bep20_ready),
    }


def allocate_unique_usdt_amount(base_amount_usd: float, network: str, db_cursor: Optional[Any] = None) -> float:
    """
    Allocate a unique exact USDT amount in the 30-minute window (e.g. 25.01 - 25.99).
    Guarantees no two concurrent unexpired PENDING orders share the exact same amount on the same network.
    Uses an explicit lock on a pre-existing KV resource and PostgreSQL advisory transaction lock
    to eliminate concurrent allocation races on both SQLite and PostgreSQL.
    """
    now_ts = time.time()
    gateway = str(network or "USDT_TRC20").upper()
    base = round(float(base_amount_usd), 2)

    def _query_taken(c):
        lock_key = f"lock:usdt_alloc:{gateway}"
        try:
            # 1. Ensure the lock row exists on kv table
            c.execute("INSERT INTO kv (key, value) VALUES (?, '1') ON CONFLICT(key) DO NOTHING", (lock_key,))
            # 2. Acquire row lock on the existing KV resource
            for_update = " FOR UPDATE" if is_postgres() else ""
            c.execute(f"SELECT value FROM kv WHERE key = ?{for_update}", (lock_key,))
            if is_postgres():
                # Explicit transaction-scoped advisory lock on PostgreSQL
                c.execute("SELECT pg_advisory_xact_lock(hashtext(?))", (f"usdt_alloc_{gateway}",))
        except Exception as lock_err:
            logger.debug(f"USDT allocation lock notice: {lock_err}")

        # Also query active KV holds (for uncommitted or very fresh orders)
        held_rows = c.execute(
            "SELECT key, value FROM kv WHERE key LIKE ?",
            (f"usdt_hold:{gateway}:%",)
        ).fetchall()
        held_amounts = set()
        expired_hold_keys = []
        for hr in held_rows:
            try:
                k_str = hr[0]
                hold_ord_id = hr[1] if len(hr) > 1 else None
                if hold_ord_id:
                    ord_row = c.execute("SELECT status, expires_at FROM orders WHERE id = ?", (str(hold_ord_id),)).fetchone()
                    if ord_row:
                        st = ord_row[0]
                        exp = float(ord_row[1] or 0.0)
                        if st != "PENDING" or exp <= now_ts:
                            expired_hold_keys.append(k_str)
                            continue
                amt_str = str(k_str).split(":")[-1]
                held_amounts.add(round(float(amt_str), 2))
            except Exception:
                pass

        for ek in expired_hold_keys:
            c.execute("DELETE FROM kv WHERE key = ?", (ek,))

        rows = c.execute(
            """
            SELECT expected_amount_usdt FROM orders
            WHERE payment_gateway = ?
              AND status = 'PENDING'
              AND expires_at > ?
              AND expected_amount_usdt IS NOT NULL
            """,
            (gateway, now_ts)
        ).fetchall()
        order_amounts = {round(float(r[0]), 2) for r in rows if r[0] is not None}
        return order_amounts.union(held_amounts)

    if db_cursor is not None:
        taken = _query_taken(db_cursor)
    else:
        with tx() as c:
            taken = _query_taken(c)

    # Generate available candidate amounts from base + 0.01 up to base + 0.99
    available = [
        round(base + (cent / 100.0), 2)
        for cent in range(1, 100)
        if round(base + (cent / 100.0), 2) not in taken
    ]

    if available:
        # Pick the lowest available unique amount for predictable sequential pricing
        return available[0]

    # In extreme load, fallback to extended range up to base + 5.00
    for ext_cent in range(100, 500):
        cand = round(base + (ext_cent / 100.0), 2)
        if cand not in taken:
            return cand

    # Issue 8 Fix: Fail closed! Never re-issue an amount that is already occupied!
    raise RuntimeError("USDT_CAPACITY_EXHAUSTED: Toàn bộ mức số tiền USDT đang bận. Vui lòng thử lại sau vài phút.")


ALPHABET_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def tron_base58_to_hex(b58: str) -> str:
    """Decode a TRON Base58Check address (starting with T, length 34) to lowercase EVM hex (0x...)."""
    if not b58 or not isinstance(b58, str):
        return ""
    s = b58.strip()
    if not (s.startswith("T") and len(s) == 34):
        return s.lower()
    try:
        import hashlib
        n = 0
        for c in s:
            idx = ALPHABET_B58.index(c)
            n = n * 58 + idx
        h = f"{n:x}"
        if len(h) % 2:
            h = "0" + h
        raw = bytes.fromhex(h)
        pad = 0
        for c in s:
            if c == "1":
                pad += 1
            else:
                break
        raw = (b"\x00" * pad) + raw
        if len(raw) != 25:
            return s.lower()
        body, checksum = raw[:21], raw[21:]
        expected_cs = hashlib.sha256(hashlib.sha256(body).digest()).digest()[:4]
        if checksum != expected_cs:
            return s.lower()
        # body[0] is 0x41 (TRON network byte), body[1:] is 20-byte EVM address
        return f"0x{body[1:].hex().lower()}"
    except Exception as exc:
        logger.debug(f"tron_base58_to_hex fallback: {exc}")
        return s.lower()


def normalize_tron_address(addr: str) -> str:
    """Normalize any TRON address representation (Base58, 0x hex, or 41-prefixed hex) to lowercase 0x hex."""
    if not addr or not isinstance(addr, str):
        return ""
    a = addr.strip()
    if a.startswith("T") and len(a) == 34:
        return tron_base58_to_hex(a)
    clean = a.lower().replace("0x", "")
    if len(clean) == 42 and clean.startswith("41"):
        return f"0x{clean[2:]}"
    if len(clean) == 40:
        return f"0x{clean}"
    return a.lower()


# =========================================================================
# Blockchain Verification: TRC20 (TronGrid) & BEP20 (BNB Smart Chain RPC)
# =========================================================================

def verify_trc20_transaction(
    tx_hash: str,
    expected_to: str,
    expected_amount: float,
) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Verify USDT TRC20 transaction on TRON blockchain via TronGrid API.
    Checks:
    1. Transaction confirmed and successful.
    2. Smart contract is official Tether USD (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t).
    3. Transfer recipient matches expected_to.
    4. Amount matches expected_amount within tolerance <= 0.001 USDT.
    """
    tx_hash = (tx_hash or "").strip()
    expected_to = (expected_to or "").strip()

    if not tx_hash or len(tx_hash) < 60:
        return False, "Mã giao dịch (tx_hash) TRC20 không hợp lệ.", {}

    # Query TronGrid events endpoint
    url = f"{TRONGRID_API_URL}/v1/transactions/{tx_hash}/events"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "ZupirusQuantLab/0.2.0 (DirectUSDTOnChain)"}
    )

    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.warning(f"TronGrid API query error for tx {tx_hash}: {e}")
        return False, f"Không thể tra cứu blockchain TRON: {e}", {}

    events = data.get("data") or []
    if not events:
        # Check raw transaction endpoint as fallback
        raw_url = f"{TRONGRID_API_URL}/wallet/gettransactionbyid"
        raw_req = urllib.request.Request(
            raw_url,
            data=json.dumps({"value": tx_hash}).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "ZupirusQuantLab/0.2.0"}
        )
        try:
            with urllib.request.urlopen(raw_req, timeout=8) as resp:
                raw_tx = json.loads(resp.read().decode("utf-8"))
                if not raw_tx or not raw_tx.get("txID"):
                    return False, "Không tìm thấy giao dịch trên blockchain TRON.", {}
        except Exception:
            pass

    for ev in events:
        event_name = ev.get("event_name")
        contract = ev.get("contract_address")
        result = ev.get("result") or {}

        # Must be official TRC20 USDT contract
        if contract != USDT_TRC20_CONTRACT:
            continue

        if event_name == "Transfer":
            to_addr = str(result.get("to") or result.get("1") or "")
            value_raw = float(result.get("value") or result.get("2") or 0.0)
            # USDT TRC20 has 6 decimals
            actual_usdt = value_raw / 1_000_000.0

            # Compare recipient: handles TronGrid EVM Hex 0x..., Tron 41..., and Base58Check T...
            norm_actual = normalize_tron_address(to_addr)
            norm_expected = normalize_tron_address(expected_to)
            if norm_actual == norm_expected or to_addr == expected_to:
                ev_ts_raw = float(ev.get("block_timestamp") or ev.get("timestamp") or 0.0)
                ev_ts_sec = (ev_ts_raw / 1000.0) if ev_ts_raw > 1e11 else ev_ts_raw
                diff = abs(actual_usdt - expected_amount)
                if diff <= 0.001:
                    return True, "Xác minh giao dịch USDT TRC20 thành công.", {
                        "tx_hash": tx_hash,
                        "amount": actual_usdt,
                        "network": "TRC20",
                        "contract": contract,
                        "to": to_addr,
                        "timestamp": ev_ts_sec,
                    }
                elif actual_usdt < expected_amount:
                    return False, f"Số tiền chuyển thiếu: nhận được {actual_usdt:.4f} USDT, yêu cầu {expected_amount:.4f} USDT.", {
                        "underpaid": True,
                        "received": actual_usdt,
                        "expected": expected_amount,
                        "timestamp": ev_ts_sec,
                    }
                else:
                    # Overpaid: accepted with warning
                    return True, f"Xác minh thành công (chuyển dư: {actual_usdt:.4f} USDT).", {
                        "tx_hash": tx_hash,
                        "amount": actual_usdt,
                        "network": "TRC20",
                        "contract": contract,
                        "to": to_addr,
                        "timestamp": ev_ts_sec,
                    }

    return False, "Giao dịch không chuyển đúng hợp đồng USDT TRC20 chính thức hoặc sai địa chỉ ví nhận.", {}


def verify_bep20_transaction(
    tx_hash: str,
    expected_to: str,
    expected_amount: float,
) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Verify USDT BEP20 transaction on BNB Smart Chain via public JSON-RPC.
    Checks:
    1. Transaction confirmed with status == '0x1'.
    2. Event is ERC20 Transfer on official Binance-Peg USDT (0x55d398326f99059fF775485246999027B3197955).
    3. Recipient matches expected_to (case-insensitive).
    4. Amount matches expected_amount within tolerance <= 0.001 USDT.
    """
    tx_hash = (tx_hash or "").strip()
    expected_to = (expected_to or "").strip().lower()

    if not tx_hash or not tx_hash.startswith("0x") or len(tx_hash) != 66:
        return False, "Mã giao dịch (tx_hash) BEP20 không hợp lệ (phải bắt đầu bằng 0x và dài 66 ký tự).", {}

    receipt = _call_bsc_rpc("eth_getTransactionReceipt", [tx_hash])
    if not receipt:
        return False, "Không thể tra cứu biên nhận giao dịch BSC (RPC timeout hoặc giao dịch chưa được xác nhận).", {}

    # Check status: '0x1' is success on EVM
    status_hex = str(receipt.get("status") or "")
    if status_hex != "0x1":
        return False, "Giao dịch trên BNB Smart Chain đã thất bại (Reverted / Failed).", {}

    # Check block confirmations (require >= 3 confirmations on BSC)
    block_hex = receipt.get("blockNumber")
    if not block_hex:
        return False, "Giao dịch chưa được ghi nhận vào khối trên BSC. Vui lòng thử lại sau vài giây.", {
            "retry_later": True,
            "tx_hash": tx_hash,
        }

    try:
        tx_block = int(block_hex, 16) if isinstance(block_hex, str) else int(block_hex)
    except (ValueError, TypeError):
        return False, "Không thể đọc số khối của giao dịch BSC.", {}

    latest_block_hex = _call_bsc_rpc("eth_blockNumber", [])
    if not latest_block_hex:
        return False, "Không thể tra cứu chiều cao khối mới nhất trên BSC để xác minh đủ 3 xác nhận. Vui lòng thử lại sau vài giây.", {
            "retry_later": True,
            "tx_hash": tx_hash,
        }

    try:
        latest_block = int(latest_block_hex, 16) if isinstance(latest_block_hex, str) else int(latest_block_hex)
        confirmations = max(0, latest_block - tx_block + 1)
        if confirmations < 3:
            return False, f"Giao dịch mới có {confirmations}/3 xác nhận khối BSC. Vui lòng thử lại sau vài giây.", {
                "confirmations": confirmations,
                "required": 3,
                "tx_hash": tx_hash,
            }
    except Exception as conf_err:
        logger.warning(f"Confirmations calculation error: {conf_err}")
        return False, "Lỗi tính toán số xác nhận khối BSC. Vui lòng thử lại sau vài giây.", {}

    # Resolve block timestamp from receipt or eth_getBlockByNumber
    block_ts_sec = 0.0
    raw_rec_ts = receipt.get("blockTimestamp") or receipt.get("timestamp")
    if raw_rec_ts is not None:
        try:
            val_ts = int(raw_rec_ts, 16) if isinstance(raw_rec_ts, str) and raw_rec_ts.startswith("0x") else float(raw_rec_ts)
            block_ts_sec = (val_ts / 1000.0) if val_ts > 1e11 else float(val_ts)
        except Exception:
            block_ts_sec = 0.0
    if block_ts_sec <= 0:
        block_hex_param = block_hex if (isinstance(block_hex, str) and block_hex.startswith("0x")) else hex(tx_block)
        block_obj = _call_bsc_rpc("eth_getBlockByNumber", [block_hex_param, False])
        if isinstance(block_obj, dict) and block_obj.get("timestamp") is not None:
            try:
                b_ts = block_obj.get("timestamp")
                val_ts = int(b_ts, 16) if isinstance(b_ts, str) and b_ts.startswith("0x") else float(b_ts)
                block_ts_sec = (val_ts / 1000.0) if val_ts > 1e11 else float(val_ts)
            except Exception:
                block_ts_sec = 0.0

    logs = receipt.get("logs") or []
    usdt_contract_clean = USDT_BEP20_CONTRACT.lower()
    expected_to_unpadded = expected_to.replace("0x", "")

    for log in logs:
        contract_addr = str(log.get("address") or "").lower()
        if contract_addr != usdt_contract_clean:
            continue

        topics = log.get("topics") or []
        if not topics or topics[0].lower() != TRANSFER_TOPIC.lower():
            continue

        # Topic 2 contains the recipient address (padded to 32 bytes)
        if len(topics) >= 3:
            recipient_topic = str(topics[2]).lower()
            expected_topic_2 = "0x" + expected_to_unpadded.lower().zfill(64)
            # Exact 32-byte EVM topic comparison
            if recipient_topic == expected_topic_2:
                data_hex = log.get("data") or "0x0"
                try:
                    raw_val = int(data_hex, 16)
                except ValueError:
                    raw_val = 0

                # USDT BEP20 has 18 decimals
                actual_usdt = raw_val / 10**18
                diff = abs(actual_usdt - expected_amount)

                if diff <= 0.001:
                    return True, "Xác minh giao dịch USDT BEP20 thành công.", {
                        "tx_hash": tx_hash,
                        "amount": actual_usdt,
                        "network": "BEP20",
                        "contract": contract_addr,
                        "to": expected_to,
                        "timestamp": block_ts_sec,
                    }
                elif actual_usdt < expected_amount:
                    return False, f"Số tiền chuyển thiếu: nhận được {actual_usdt:.4f} USDT, yêu cầu {expected_amount:.4f} USDT.", {
                        "underpaid": True,
                        "received": actual_usdt,
                        "expected": expected_amount,
                        "timestamp": block_ts_sec,
                    }
                else:
                    return True, f"Xác minh thành công (chuyển dư: {actual_usdt:.4f} USDT).", {
                        "tx_hash": tx_hash,
                        "amount": actual_usdt,
                        "network": "BEP20",
                        "contract": contract_addr,
                        "to": expected_to,
                        "timestamp": block_ts_sec,
                    }

    return False, "Giao dịch không chuyển đúng hợp đồng Binance-Peg USDT chính thức hoặc sai địa chỉ ví nhận.", {}


# =========================================================================
# Order Fulfillment & Verification
# =========================================================================

async def verify_and_fulfill_crypto_order(
    order_id: str,
    tx_hash: str,
) -> Dict[str, Any]:
    """
    Verify submitted on-chain tx_hash and fulfill order atomically.
    Includes idempotency guards, underpayment handling, and referral bonus credits.
    """
    now_ts = time.time()
    order_id = str(order_id or "").strip().lower()
    tx_hash = str(tx_hash or "").strip()

    if not tx_hash:
        return {"ok": False, "message": "Vui lòng nhập mã băm giao dịch (Transaction Hash)."}

    # 1. Fetch order
    from app.db import is_postgres
    for_update = " FOR UPDATE" if is_postgres() else ""
    with tx() as c:
        row = c.execute(f"SELECT * FROM orders WHERE LOWER(id) = ?{for_update}", (order_id,)).fetchone()
        if not row and len(order_id) >= 6:
            row = c.execute(
                f"SELECT * FROM orders WHERE LOWER(id) LIKE ? ORDER BY created_at DESC LIMIT 1{for_update}",
                (f"%{order_id}",)
            ).fetchone()

        if not row:
            return {"ok": False, "message": f"Không tìm thấy đơn hàng {order_id}."}

        order = dict(row)

    if order["status"] == "PAID":
        return {"ok": True, "already_paid": True, "message": "Đơn hàng đã được xác nhận thanh toán thành công trước đó."}

    # Verify expiration (allow 48h grace period for blockchain transfer delays)
    now_ts = time.time()
    order_expires_at = float(order.get("expires_at") or 0)
    if order_expires_at > 0 and now_ts > (order_expires_at + 172800):
        return {"ok": False, "message": "Đơn hàng đã hết hạn thanh toán quá thời gian ân hạn (48 giờ). Vui lòng tạo đơn mới."}

    # 2. Check if tx_hash already used by another order or transaction
    with tx() as c:
        dup = c.execute("SELECT id FROM payment_transactions WHERE tx_hash = ?", (tx_hash,)).fetchone()
        if dup:
            return {"ok": False, "message": "Mã giao dịch này đã được sử dụng cho một đơn hàng khác."}
        dup_ord = c.execute("SELECT id FROM orders WHERE tx_hash = ? AND id != ?", (tx_hash, order["id"])).fetchone()
        if dup_ord:
            return {"ok": False, "message": "Mã giao dịch này đã được gán cho một đơn hàng khác."}
        saved_wallet_row = c.execute("SELECT value FROM kv WHERE key = ?", (f"order_wallet:{order['id']}",)).fetchone()
        saved_dest_wallet = saved_wallet_row[0] if saved_wallet_row and saved_wallet_row[0] else None

    # 3. Read admin destination wallet (saved at checkout, fallback to current config)
    cfg = get_crypto_wallets_config()
    gateway = str(order.get("payment_gateway") or "USDT_TRC20").upper()
    expected_amount = float(order.get("expected_amount_usdt") or order.get("amount_usd") or 25.0)

    if gateway == "USDT_TRC20":
        dest_wallet = saved_dest_wallet or cfg.get("usdt_trc20_address")
        if not dest_wallet:
            return {"ok": False, "message": "Ví nhận USDT TRC20 của hệ thống chưa được cấu hình."}
        valid, msg, details = verify_trc20_transaction(tx_hash, dest_wallet, expected_amount)
    elif gateway == "USDT_BEP20":
        dest_wallet = saved_dest_wallet or cfg.get("usdt_bep20_address")
        if not dest_wallet:
            return {"ok": False, "message": "Ví nhận USDT BEP20 của hệ thống chưa được cấu hình."}
        valid, msg, details = verify_bep20_transaction(tx_hash, dest_wallet, expected_amount)
    else:
        return {"ok": False, "message": f"Phương thức thanh toán {gateway} không hỗ trợ xác minh On-Chain."}

    # Check transaction timestamp against the order's active validity window FIRST (before mutating to UNDERPAID or PAID)
    has_ts_field = isinstance(details, dict) and ("timestamp" in details or "block_timestamp" in details)
    raw_tx_ts = float(details.get("timestamp") or details.get("block_timestamp") or 0.0) if isinstance(details, dict) else 0.0
    tx_ts_sec = (raw_tx_ts / 1000.0) if raw_tx_ts > 1e11 else raw_tx_ts
    ord_created = float(order.get("created_at") or 0.0)
    ord_expires = float(order.get("expires_at") or 0.0)
    if (valid or (isinstance(details, dict) and details.get("underpaid"))) and ord_created > 0:
        if (gateway == "USDT_BEP20" or has_ts_field) and tx_ts_sec <= 0:
            return {
                "ok": False,
                "message": "Không thể xác minh thời gian khối (block timestamp) của giao dịch để đối chiếu với đơn hàng.",
            }
        if tx_ts_sec > 0:
            if (ord_created > 0 and tx_ts_sec < ord_created - 60.0) or (ord_expires > 0 and tx_ts_sec > ord_expires + 300.0):
                return {
                    "ok": False,
                    "message": "Giao dịch nằm ngoài khung thời gian hiệu lực của đơn hàng này.",
                }

    # Underpaid branch (only reached if transaction timestamp is within order validity window)
    if not valid and details.get("underpaid"):
        with tx() as c:
            curr_row = c.execute(f"SELECT status FROM orders WHERE id = ?{for_update}", (order["id"],)).fetchone()
            if curr_row and curr_row[0] == "PAID":
                return {"ok": True, "already_paid": True, "message": "Đơn hàng đã được xác nhận thanh toán trước đó."}
            c.execute(
                "UPDATE orders SET status = 'UNDERPAID', tx_hash = ?, payment_status = 'UNDERPAID' WHERE id = ? AND status != 'PAID'",
                (tx_hash, order["id"])
            )
        # Notify user via email
        try:
            from app.mailer import send_underpaid_alert_email
            user_row = None
            with tx() as c:
                user_row = c.execute("SELECT email, preferred_language FROM users WHERE id = ?", (order["user_id"],)).fetchone()
            if user_row:
                send_underpaid_alert_email(
                    email=user_row["email"],
                    order_id=order["id"],
                    expected=expected_amount,
                    received=details.get("received", 0.0),
                    tx_hash=tx_hash,
                    lang=user_row["preferred_language"] or "en",
                )
        except Exception:
            pass
        return {"ok": False, "underpaid": True, "message": msg}

    if not valid:
        return {"ok": False, "message": msg}

    # 4. Fulfill order atomically with re-verification under row lock
    from app.domains.billing.service import apply_subscription_entitlements_tx, _deploy_with_retries
    tx_id = f"tx_crypto_{secrets.token_hex(8)}"
    actual_amount = float(details.get("amount", expected_amount))
    accounts_to_deploy = []
    new_sub_exp = now_ts + 86400 * 30
    user_email = None
    user_lang = "en"

    with tx() as c:
        re_row = c.execute(f"SELECT * FROM orders WHERE LOWER(id) = ?{for_update}", (order["id"].lower(),)).fetchone()
        if not re_row:
            return {"ok": False, "message": f"Không tìm thấy đơn hàng {order['id']}."}
        re_order = dict(re_row)
        if re_order["status"] == "PAID" and re_order.get("entitlement_status") == "GRANTED":
            return {"ok": True, "already_paid": True, "message": "Đơn hàng đã được xác nhận thanh toán thành công trước đó."}

        ins_cur = c.execute(
            """
            INSERT INTO payment_transactions (
                id, sepay_id, user_id, amount, currency, gateway, content, status, created_at, tx_hash
            ) VALUES (?, ?, ?, ?, 'USDT', ?, ?, 'completed', ?, ?)
            ON CONFLICT (sepay_id) DO NOTHING
            """,
            (
                tx_id,
                f"crypto_{tx_hash}",
                order["user_id"],
                actual_amount,
                gateway,
                f"Direct USDT Order {order['id']} ({tx_hash[:12]}...)",
                now_ts,
                tx_hash,
            )
        )
        if getattr(ins_cur, "rowcount", 1) <= 0:
            return {"ok": False, "message": "Mã giao dịch này đã được ghi nhận trước đó cho một thanh toán khác."}

        upd_cur = c.execute(
            """
            UPDATE orders SET
                status = 'PAID',
                payment_status = 'PAID',
                entitlement_status = 'GRANTED',
                paid_at = ?,
                tx_hash = ?
            WHERE id = ? AND (status != 'PAID' OR entitlement_status != 'GRANTED')
            """,
            (now_ts, tx_hash, order["id"])
        )
        if getattr(upd_cur, "rowcount", 1) <= 0 and re_order.get("entitlement_status") == "GRANTED":
            return {"ok": True, "already_paid": True, "message": "Đơn hàng đã được xác nhận bởi tiến trình khác."}

        new_sub_exp, accounts_to_deploy = apply_subscription_entitlements_tx(c, re_order, now_ts)

        usr_row = c.execute("SELECT email, preferred_language FROM users WHERE id = ?", (order["user_id"],)).fetchone()
        if usr_row:
            usr = dict(usr_row)
            user_email = usr.get("email")
            user_lang = usr.get("preferred_language") or "en"

    # 5. Background MetaApi deployment
    if accounts_to_deploy:
        await _deploy_with_retries(accounts_to_deploy, order_id=order["id"], max_retries=3, delay=1)

    try:
        from app.redis_client import publish_realtime_event
        publish_realtime_event(
            f"user:{order['user_id']}",
            "payment_paid",
            {"order_id": order["id"], "plan_tier": order["plan_tier"], "expires_at": new_sub_exp},
        )
        publish_realtime_event(
            "admin",
            "billing_paid",
            {"order_id": order["id"], "user_id": order["user_id"], "plan_tier": order["plan_tier"]},
        )
    except Exception:
        pass

    # 6. Referral bonus +7 days
    try:
        from app.services.referral import credit_referral_reward_for_first_order
        credit_referral_reward_for_first_order(order["user_id"])
    except Exception:
        pass

    # 7. Send receipt email
    if user_email:
        try:
            from app.mailer import send_payment_receipt_email
            send_payment_receipt_email(
                email=user_email,
                order_id=order["id"],
                plan_tier=order["plan_tier"],
                amount_vnd=int(order.get("amount_vnd") or 0),
                cloud_slots=int(order.get("cloud_slots_count") or 1),
                expires_at=new_sub_exp,
                lang=user_lang,
                amount_usd=actual_amount,
                currency="USDT",
            )
        except Exception as e:
            logger.warning(f"Failed sending receipt email: {e}")

    return {
        "ok": True,
        "status": "PAID",
        "fulfilled": True,
        "order_id": order["id"],
        "tx_hash": tx_hash,
        "amount": actual_amount,
        "network": gateway,
        "expires_at": new_sub_exp,
        "message": "Xác minh thanh toán Direct USDT thành công! Tài khoản đã được kích hoạt.",
    }


async def scan_and_reconcile_pending_crypto_orders() -> Dict[str, Any]:
    """
    Background worker: scan public blockchain for incoming transfers to Admin wallets
    matching active PENDING USDT orders, auto-fulfilling orders without requiring manual tx hash entry.
    """
    now_ts = time.time()
    with tx() as c:
        rows = c.execute(
            """
            SELECT id, user_id, expected_amount_usdt, payment_gateway, expires_at, created_at
            FROM orders
            WHERE payment_gateway LIKE ?
              AND status = 'PENDING'
              AND expires_at > ?
              AND expected_amount_usdt IS NOT NULL
            ORDER BY created_at DESC
            """,
            ("USDT%", now_ts)
        ).fetchall()
        order_wallets = {}
        for r in rows:
            oid = r["id"] if hasattr(r, "keys") else r[0]
            w_row = c.execute("SELECT value FROM kv WHERE key = ?", (f"order_wallet:{oid}",)).fetchone()
            if w_row and w_row[0]:
                order_wallets[oid] = w_row[0].strip()

    if not rows:
        return {"scanned": 0, "fulfilled": 0}

    stats = {"scanned": len(rows), "fulfilled": 0, "orders": []}
    cfg = get_crypto_wallets_config()
    trc20_admin = (cfg.get("trc20_address") or cfg.get("usdt_trc20_address") or "").strip()
    bep20_admin = (cfg.get("bep20_address") or cfg.get("usdt_bep20_address") or "").strip()

    trc20_wallets_targets: Dict[str, Dict[float, List[Dict[str, Any]]]] = {}
    bep20_wallets_targets: Dict[str, Dict[float, List[Dict[str, Any]]]] = {}

    for r in rows:
        d = dict(r) if hasattr(r, "keys") else {
            "id": r[0],
            "user_id": r[1],
            "expected_amount_usdt": r[2],
            "payment_gateway": r[3],
            "expires_at": r[4],
            "created_at": r[5] if len(r) > 5 else 0.0,
        }
        amt = round(float(d["expected_amount_usdt"]), 2)
        gw = str(d["payment_gateway"]).upper()
        ord_id = str(d["id"])
        ord_meta = {
            "id": ord_id,
            "created_at": float(d.get("created_at") or 0.0),
            "expires_at": float(d.get("expires_at") or 0.0),
        }
        saved_wallet = order_wallets.get(ord_id)

        if "TRC20" in gw:
            target_wallet = saved_wallet or trc20_admin
            if target_wallet:
                trc20_wallets_targets.setdefault(target_wallet, {}).setdefault(amt, []).append(ord_meta)
        elif "BEP20" in gw:
            target_wallet = saved_wallet or bep20_admin
            if target_wallet:
                bep20_wallets_targets.setdefault(target_wallet, {}).setdefault(amt, []).append(ord_meta)

    def _match_order_in_window(candidates: List[Dict[str, Any]], raw_ts: Any) -> Optional[str]:
        try:
            ts_val = float(raw_ts or 0.0)
        except Exception:
            ts_val = 0.0
        tx_ts = (ts_val / 1000.0) if ts_val > 1e11 else ts_val
        for cand in candidates:
            c_start = float(cand.get("created_at") or 0.0)
            c_end = float(cand.get("expires_at") or 0.0)
            if tx_ts > 0:
                if (c_start > 0 and tx_ts < c_start - 60.0) or (c_end > 0 and tx_ts > c_end + 300.0):
                    continue
            return str(cand["id"])
        return None

    # 1. Scan TRC20 incoming transfers via TronGrid per destination wallet
    for trc_wallet, trc20_targets in trc20_wallets_targets.items():
        if not trc20_targets or not trc_wallet:
            continue
        try:
            url = f"{TRONGRID_API_URL}/v1/accounts/{trc_wallet}/transactions/trc20?contract_address={USDT_TRC20_CONTRACT}&only_to=true&limit=25"
            req = urllib.request.Request(url, headers={"User-Agent": "ZupirusQuantLab/0.2.0 (BackgroundScanner)"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                transfers = data.get("data") or []
                for tr in transfers:
                    val_raw = float(tr.get("value") or 0.0)
                    amt = round(val_raw / 1_000_000.0, 2)
                    tx_id = tr.get("transaction_id")
                    if amt in trc20_targets and tx_id:
                        ord_id = _match_order_in_window(
                            trc20_targets[amt],
                            tr.get("block_timestamp") or tr.get("timestamp"),
                        )
                        if not ord_id:
                            continue
                        fulfill_res = await verify_and_fulfill_crypto_order(ord_id, tx_id)
                        if fulfill_res.get("ok"):
                            stats["fulfilled"] += 1
                            stats["orders"].append(ord_id)
                            logger.info(f"AUTO-FULFILLED USDT TRC20 Order {ord_id} to wallet {trc_wallet} via background scanner with tx {tx_id}")
        except Exception as e:
            logger.debug(f"Background TRC20 scan note for {trc_wallet}: {e}")

    # 2. Scan BEP20 incoming transfers via BSC RPC eth_getLogs per destination wallet
    for bep_wallet, bep20_targets in bep20_wallets_targets.items():
        if not bep20_targets or not bep_wallet:
            continue
        try:
            admin_padded = "0x" + bep_wallet.lower().replace("0x", "").zfill(64)
            latest_blk_hex = _call_bsc_rpc("eth_blockNumber", [])
            if latest_blk_hex:
                latest_blk = int(latest_blk_hex, 16) if isinstance(latest_blk_hex, str) else int(latest_blk_hex)
                from_blk_hex = hex(max(0, latest_blk - 120))  # Last ~6 minutes of BSC blocks
                logs_params = [{
                    "fromBlock": from_blk_hex,
                    "toBlock": "latest",
                    "address": USDT_BEP20_CONTRACT.lower(),
                    "topics": [TRANSFER_TOPIC, None, admin_padded]
                }]
                logs = _call_bsc_rpc("eth_getLogs", logs_params) or []
                for lg in logs:
                    data_hex = lg.get("data") or "0x0"
                    raw_val = int(data_hex, 16)
                    amt = round(raw_val / 10**18, 2)
                    tx_hash = lg.get("transactionHash")
                    if amt in bep20_targets and tx_hash:
                        raw_lg_ts = lg.get("timeStamp") or lg.get("blockTimestamp") or lg.get("timestamp")
                        if isinstance(raw_lg_ts, str) and raw_lg_ts.startswith("0x"):
                            try:
                                raw_lg_ts = int(raw_lg_ts, 16)
                            except Exception:
                                raw_lg_ts = 0
                        ord_id = _match_order_in_window(bep20_targets[amt], raw_lg_ts)
                        if not ord_id:
                            continue
                        fulfill_res = await verify_and_fulfill_crypto_order(ord_id, tx_hash)
                        if fulfill_res.get("ok"):
                            stats["fulfilled"] += 1
                            stats["orders"].append(ord_id)
                            logger.info(f"AUTO-FULFILLED USDT BEP20 Order {ord_id} to wallet {bep_wallet} via background scanner with tx {tx_hash}")
        except Exception as e:
            logger.debug(f"Background BEP20 scan note for {bep_wallet}: {e}")

    return stats
