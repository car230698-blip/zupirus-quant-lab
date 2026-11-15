"""
ZUPIRUS Quant Lab - MetaApi Direct-to-User Execution Engine
Direct cloud execution from Quant Brain to user MT5 terminals via MetaApi.
Features:
- Zero EA installation on client MT5.
- AES-256 encrypted credentials storage.
- Microsecond fan-out order execution via asyncio.gather.
- Dynamic Lot sizing based on account equity & personalized risk tolerance.
- Redis-backed signal idempotency locking (prevents duplicate trades).
- High-frequency execution latency telemetry.
"""
import os
import time
import uuid
import math
import asyncio
import logging
from typing import Dict, Any, List, Optional
import httpx
from app.security import encrypt_secret, decrypt_secret

logger = logging.getLogger("zupirus.metaapi")

PROVISIONING_API_BASE = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai"
CLIENT_API_BASE = "https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai"


class MetaApiClient:
    """MetaApi Cloud Provisioning and Trading client."""

    def __init__(self, token: Optional[str] = None):
        self.token = token or os.getenv("METAAPI_TOKEN", "").strip()
        self.is_mock = not bool(self.token) or self.token.lower() in ("mock", "test", "demo", "none")
        if self.is_mock:
            logger.info("MetaApi running in Mock/Simulated Cloud Execution mode (METAAPI_TOKEN not set).")

    def _headers(self) -> Dict[str, str]:
        return {
            "auth-token": self.token,
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

    async def provision_account(
        self,
        name: str,
        login: str,
        password: str,
        server: str,
        platform: str = "mt5",
        magic: int = 230698
    ) -> Dict[str, Any]:
        """
        Deploy an MT5 account to MetaApi Cloud.
        Returns dict containing metaapi_account_id and state.
        """
        if self.is_mock:
            simulated_id = f"metaapi_{uuid.uuid4().hex[:16]}"
            return {
                "id": simulated_id,
                "state": "DEPLOYED",
                "name": name,
                "login": login,
                "server": server,
                "platform": platform,
                "magic": magic,
                "simulated": True
            }

        url = f"{PROVISIONING_API_BASE}/users/current/accounts"
        payload = {
            "name": name,
            "type": "cloud",
            "login": login,
            "password": password,
            "server": server,
            "platform": platform,
            "magic": magic
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=self._headers(), json=payload)
            if resp.status_code not in (200, 201, 202):
                raise RuntimeError(f"MetaApi Provisioning Error ({resp.status_code}): {resp.text}")
            data = resp.json()
            # Ensure deployment
            acc_id = data.get("id")
            if acc_id and data.get("state") != "DEPLOYED":
                await client.post(f"{PROVISIONING_API_BASE}/users/current/accounts/{acc_id}/deploy", headers=self._headers())
            return data

    async def undeploy_account(self, metaapi_account_id: str) -> bool:
        """Undeploy cloud MT5 terminal to stop hosting billing."""
        if self.is_mock:
            return True
        url = f"{PROVISIONING_API_BASE}/users/current/accounts/{metaapi_account_id}/undeploy"
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=self._headers())
            return resp.status_code in (200, 204)

    async def get_account_information(self, metaapi_account_id: str) -> Dict[str, Any]:
        """Retrieve real-time account metrics (balance, equity, margin, freeMargin)."""
        if self.is_mock:
            # Deterministic mock based on id
            return {
                "balance": 10000.0,
                "equity": 10000.0,
                "margin": 0.0,
                "freeMargin": 10000.0,
                "currency": "USD",
                "server": "Demo-Server",
                "connected": True
            }

        url = f"{CLIENT_API_BASE}/users/current/accounts/{metaapi_account_id}/account-information"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=self._headers())
            if resp.status_code == 200:
                return resp.json()
            return {"balance": 0.0, "equity": 0.0, "connected": False}

    async def execute_order(
        self,
        metaapi_account_id: str,
        symbol: str,
        action: str,
        volume: float,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
        comment: str = "Zupirus Direct"
    ) -> Dict[str, Any]:
        """
        Execute market BUY or SELL order with Stop Loss and Take Profit on MT5.
        """
        start_ts = time.time()
        action_type = "ORDER_TYPE_BUY" if action.upper() == "BUY" else "ORDER_TYPE_SELL"

        if self.is_mock:
            # Simulate real network hop ~25-45ms
            await asyncio.sleep(0.03)
            order_id = str(uuid.uuid4().int)[:10]
            position_id = str(uuid.uuid4().int)[:10]
            latency_ms = int((time.time() - start_ts) * 1000)
            return {
                "numericCode": 10009,
                "stringCode": "TRADE_RETCODE_DONE",
                "message": "Order executed successfully (Simulated Cloud)",
                "orderId": order_id,
                "positionId": position_id,
                "latency_ms": latency_ms,
                "volume": volume
            }

        url = f"{CLIENT_API_BASE}/users/current/accounts/{metaapi_account_id}/trade"
        payload = {
            "actionType": action_type,
            "symbol": symbol,
            "volume": volume,
            "comment": comment
        }
        if stop_loss is not None:
            payload["stopLoss"] = stop_loss
        if take_profit is not None:
            payload["takeProfit"] = take_profit

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=self._headers(), json=payload)
            latency_ms = int((time.time() - start_ts) * 1000)
            if resp.status_code not in (200, 201):
                return {
                    "numericCode": resp.status_code,
                    "stringCode": "TRADE_ERROR",
                    "message": resp.text,
                    "orderId": None,
                    "positionId": None,
                    "latency_ms": latency_ms
                }
            data = resp.json()
            data["latency_ms"] = latency_ms
            return data


def calculate_lot_size(
    equity: float,
    risk_percent: float,
    sl_points: float,
    symbol: str = "XAUUSD",
    max_lot: float = 1.0,
    multiplier: float = 1.0
) -> float:
    """
    Dynamic Risk-Adjusted Lot Sizing for XAUUSD.
    Formula:
    Risk Amount ($) = Equity * (risk_percent / 100)
    For XAUUSD: 1 Lot = 100 oz.
    1 point = 0.01 USD / oz. 100 points = $1.00 per oz.
    0.01 Lot on 100 points move = $1.00 risk.
    Lot = (Risk Amount / (SL_points * 0.01 * 100)) = Risk Amount / SL_points
    """
    if equity <= 0:
        return 0.01

    risk_pct = max(0.1, min(risk_percent, 10.0))
    risk_dollars = equity * (risk_pct / 100.0)

    # Minimum SL points for gold sanity check (e.g. 200 points = $2.00)
    effective_sl = max(sl_points, 150.0)

    # 1 standard lot (1.0) risking 100 points = $100.00
    # => 1 lot loses $1 per point.
    calculated_lot = (risk_dollars / effective_sl) * multiplier

    # Clamp lot size between 0.01 and max_lot
    lot = max(0.01, min(calculated_lot, max_lot))
    return round(lot, 2)


async def execute_fan_out_for_signal(
    signal: Dict[str, Any],
    accounts: List[Dict[str, Any]],
    metaapi_client: MetaApiClient,
    redis_client=None
) -> Dict[str, Any]:
    """
    Fan-out signal execution concurrently to all connected accounts using asyncio.gather.
    Includes Redis idempotency lock per (signal_id, account_id).
    """
    signal_id = signal.get("id") or str(uuid.uuid4())
    symbol = signal.get("symbol", "XAUUSD")
    action = signal.get("action", "BUY").upper()
    entry_price = float(signal.get("entry_price") or signal.get("price") or 2650.0)
    sl = float(signal["sl"]) if signal.get("sl") else None
    tp = float(signal["tp"]) if signal.get("tp") else None

    # Calculate SL distance in points
    if sl:
        sl_points = abs(entry_price - sl) * 100.0
    else:
        sl_points = 300.0  # Default 300 points ($3)

    tasks = []
    account_metas = []

    from app.services.symbol_mapper import resolve_broker_symbol
    from app.services.account_classifier import calculate_normalized_lot_size
    from app.services.signal_ingestion.sanitizer import check_live_spread_guard

    for acc in accounts:
        acc_id = acc["id"]
        meta_id = acc.get("metaapi_account_id") or acc_id

        # 1. Broker Symbol Auto-Discovery & Mapping check
        broker_sym = resolve_broker_symbol(acc_id, symbol)
        if not broker_sym:
            logger.info(f"Account {acc_id} does not support {symbol} (SKIPPED_UNSUPPORTED_SYMBOL).")
            continue

        # 2. Broker Live Spread Guard (Lớp 2: Kiểm tra riêng theo sàn của khách)
        broker_spread = float(acc.get("live_spread_pips") or 1.5)
        ok_spread, spread_err = check_live_spread_guard(symbol, broker_spread)
        if not ok_spread:
            logger.warning(f"Account {acc_id} rejected due to high spread: {spread_err}")
            continue

        # 3. Check Redis Idempotency Lock
        if redis_client:
            lock_key = f"zupirus:lock:signal:{signal_id}:{acc_id}"
            try:
                is_new = redis_client.set(lock_key, "1", ex=120, nx=True)
                if not is_new:
                    logger.warning(f"Idempotency: Signal {signal_id} already executed for account {acc_id}. Skipping.")
                    continue
            except Exception as e:
                logger.error(f"Redis idempotency lock error: {e}")

        # 4. Calculate dynamic proportional lot (Cent vs Standard vs Prop Firm)
        is_comp = bool(acc.get("is_compounding", False))
        balance = float(acc.get("balance") or 10000.0)
        equity = float(acc.get("equity") or balance)
        base_capital = equity if is_comp else balance

        risk_pct = float(acc.get("risk_percent", 1.0))
        max_lot = float(acc.get("max_lot", 5.0))
        mult = float(acc.get("risk_multiplier") or acc.get("multiplier") or 1.0)
        c_size = float(acc.get("contract_size") or 100.0)
        t_val = float(acc.get("tick_value") or 1.0)
        is_cent_acc = acc.get("account_type") == "CENT" or acc.get("currency") in ("USC", "EUC")

        volume = calculate_normalized_lot_size(
            equity=base_capital,
            risk_pct=risk_pct,
            sl_distance_points=sl_points,
            contract_size=c_size,
            tick_value=t_val,
            risk_multiplier=mult,
            max_lot=max_lot,
            is_cent=is_cent_acc
        )

        account_metas.append({
            "account_id": acc_id,
            "metaapi_account_id": meta_id,
            "user_id": acc.get("user_id"),
            "volume": volume,
            "equity": equity,
            "is_compounding": is_comp,
            "multiplier": mult,
            "broker_symbol": broker_sym,
        })

        # 5. Schedule concurrent execution task
        tasks.append(
            metaapi_client.execute_order(
                metaapi_account_id=meta_id,
                symbol=broker_sym,
                action=action,
                volume=volume,
                stop_loss=sl,
                take_profit=tp,
                comment=f"ZP-{signal_id[:6]}"
            )
        )

    if not tasks:
        return {
            "signal_id": signal_id,
            "total_accounts": len(accounts),
            "executed": 0,
            "skipped": len(accounts),
            "results": [],
            "avg_latency_ms": 0
        }

    # Parallel microsecond fan-out dispatch
    start_all = time.time()
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)
    total_elapsed_ms = int((time.time() - start_all) * 1000)

    executions = []
    latencies = []
    executed_count = 0
    failed_count = 0

    for meta, res in zip(account_metas, raw_results):
        if isinstance(res, Exception):
            failed_count += 1
            executions.append({
                "account_id": meta["account_id"],
                "metaapi_account_id": meta["metaapi_account_id"],
                "status": "FAILED",
                "volume": meta["volume"],
                "error": str(res),
                "latency_ms": 0
            })
        else:
            lat = res.get("latency_ms", 0)
            latencies.append(lat)
            is_success = res.get("numericCode") in (10009, 200, 201) or bool(res.get("orderId"))
            if is_success:
                executed_count += 1
                status = "FILLED"
            else:
                failed_count += 1
                status = "REJECTED"

            executions.append({
                "account_id": meta["account_id"],
                "metaapi_account_id": meta["metaapi_account_id"],
                "status": status,
                "volume": meta["volume"],
                "order_id": res.get("orderId"),
                "position_id": res.get("positionId"),
                "latency_ms": lat,
                "message": res.get("message")
            })

    avg_lat = int(sum(latencies) / len(latencies)) if latencies else total_elapsed_ms

    return {
        "signal_id": signal_id,
        "symbol": symbol,
        "action": action,
        "total_accounts": len(accounts),
        "executed": executed_count,
        "failed": failed_count,
        "skipped": len(accounts) - len(tasks),
        "total_fanout_elapsed_ms": total_elapsed_ms,
        "avg_latency_ms": avg_lat,
        "executions": executions
    }

