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
import asyncio
import logging
from typing import Dict, Any, List, Optional
import httpx

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
            try:
                data = resp.json()
            except Exception:
                data = {}
            if not isinstance(data, dict):
                data = {}
            # Ensure deployment
            acc_id = data.get("id")
            if acc_id and data.get("state") != "DEPLOYED":
                await client.post(f"{PROVISIONING_API_BASE}/users/current/accounts/{acc_id}/deploy", headers=self._headers())
            return data

    async def deploy_account(self, metaapi_account_id: str) -> bool:
        """Deploy cloud MT5 terminal to start hosting."""
        if self.is_mock:
            return True
        url = f"{PROVISIONING_API_BASE}/users/current/accounts/{metaapi_account_id}/deploy"
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(url, headers=self._headers())
                return resp.status_code in (200, 202, 204)
        except Exception as e:
            logger.warning(f"deploy_account error for {metaapi_account_id}: {e}")
            return False

    async def undeploy_account(self, metaapi_account_id: str) -> bool:
        """Undeploy cloud MT5 terminal to stop hosting billing."""
        if self.is_mock:
            return True
        url = f"{PROVISIONING_API_BASE}/users/current/accounts/{metaapi_account_id}/undeploy"
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(url, headers=self._headers())
                return resp.status_code in (200, 204)
        except Exception as e:
            logger.warning(f"undeploy_account error for {metaapi_account_id}: {e}")
            return False

    async def delete_account(self, metaapi_account_id: str) -> bool:
        """Delete cloud MT5 account from MetaApi Provisioning API to stop all cloud billing."""
        if self.is_mock:
            return True
        url = f"{PROVISIONING_API_BASE}/users/current/accounts/{metaapi_account_id}"
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.delete(url, headers=self._headers())
                return resp.status_code in (200, 202, 204, 404)
        except Exception as e:
            logger.warning(f"delete_account error for {metaapi_account_id}: {e}")
            return False

    async def get_account_information(self, metaapi_account_id: str) -> Dict[str, Any]:
        """Retrieve real-time account metrics (balance, equity, margin, freeMargin)."""
        if self.is_mock:
            # In real production (outside pytest), NEVER fabricate fake $10,000 balance/equity
            if (
                not os.getenv("PYTEST_CURRENT_TEST")
                or "unfunded" in str(metaapi_account_id).lower()
                or "zero" in str(metaapi_account_id).lower()
            ):
                return {
                    "balance": 0.0,
                    "equity": 0.0,
                    "margin": 0.0,
                    "freeMargin": 0.0,
                    "currency": "USD",
                    "server": "Unverified",
                    "connected": False,
                    "simulated": True,
                }
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
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, headers=self._headers())
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, dict):
                        return data
        except Exception as e:
            logger.debug(f"get_account_information error for {metaapi_account_id}: {e}")
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
        action_u = str(action or "").strip().upper()
        if action_u not in ("BUY", "SELL"):
            raise ValueError(f"Unsupported trade action: {action}")
        action_type = "ORDER_TYPE_BUY" if action_u == "BUY" else "ORDER_TYPE_SELL"

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

        from app.services.symbol_precision import digits_for_symbol
        dec = digits_for_symbol(symbol)
        url = f"{CLIENT_API_BASE}/users/current/accounts/{metaapi_account_id}/trade"
        payload = {
            "actionType": action_type,
            "symbol": symbol,
            "volume": volume,
            "comment": comment
        }
        if stop_loss is not None:
            payload["stopLoss"] = round(float(stop_loss), dec)
        if take_profit is not None:
            payload["takeProfit"] = round(float(take_profit), dec)

        try:
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
                if not isinstance(data, dict):
                    data = {"numericCode": resp.status_code, "stringCode": "INVALID_JSON", "message": str(data)}
                data["latency_ms"] = latency_ms
                return data
        except Exception as e:
            return {
                "numericCode": 504,
                "stringCode": "NETWORK_TIMEOUT_OR_ERROR",
                "message": str(e),
                "orderId": None,
                "positionId": None,
                "latency_ms": int((time.time() - start_ts) * 1000),
            }

    async def get_open_positions(self, metaapi_account_id: str, raise_on_error: bool = False) -> List[Dict[str, Any]]:
        """Retrieve all currently active open positions on MT5 via MetaApi."""
        if self.is_mock:
            return []

        url = f"{CLIENT_API_BASE}/users/current/accounts/{metaapi_account_id}/positions"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, headers=self._headers())
                if resp.status_code == 200:
                    data = resp.json()
                    return data if isinstance(data, list) else []
                if raise_on_error:
                    raise RuntimeError(f"MetaApi get_open_positions HTTP {resp.status_code}: {resp.text[:160]}")
        except Exception as e:
            if raise_on_error:
                raise
            logger.debug(f"get_open_positions error for {metaapi_account_id}: {e}")
        return []

    async def get_closed_deals(self, metaapi_account_id: str, hours: int = 24) -> List[Dict[str, Any]]:
        """Retrieve closed execution deals from MetaApi history for real PnL reflection."""
        if self.is_mock:
            return []
        from datetime import datetime, timedelta, timezone
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(hours=hours)
        start_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
        end_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
        url = f"{CLIENT_API_BASE}/users/current/accounts/{metaapi_account_id}/history-deals/time/{start_iso}/{end_iso}"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, headers=self._headers())
                if resp.status_code == 200:
                    data = resp.json()
                    return data if isinstance(data, list) else []
        except Exception as e:
            logger.debug(f"get_closed_deals error for {metaapi_account_id}: {e}")
        return []

    async def modify_position_sl(
        self,
        metaapi_account_id: str,
        position_id: str,
        new_sl: float,
        take_profit: Optional[float] = None,
        symbol: str = ""
    ) -> Dict[str, Any]:
        """Modify Stop Loss (e.g., Auto Break-Even) of an open position."""
        start_ts = time.time()
        from app.services.symbol_precision import digits_for_symbol
        dec = digits_for_symbol(symbol) if symbol else 5
        if self.is_mock:
            return {
                "numericCode": 10009,
                "stringCode": "TRADE_RETCODE_DONE",
                "positionId": position_id,
                "stopLoss": round(new_sl, dec),
                "latency_ms": int((time.time() - start_ts) * 1000),
                "simulated": True
            }

        url = f"{CLIENT_API_BASE}/users/current/accounts/{metaapi_account_id}/trade"
        payload: Dict[str, Any] = {
            "actionType": "POSITION_MODIFY",
            "positionId": position_id,
            "stopLoss": round(new_sl, dec)
        }
        if take_profit is not None:
            payload["takeProfit"] = round(take_profit, dec)

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, headers=self._headers(), json=payload)
                lat = int((time.time() - start_ts) * 1000)
                if resp.status_code in (200, 201):
                    data = resp.json()
                    if not isinstance(data, dict):
                        data = {"numericCode": resp.status_code, "stringCode": "INVALID_JSON"}
                    data["latency_ms"] = lat
                    return data
                return {
                    "numericCode": resp.status_code,
                    "stringCode": "MODIFY_ERROR",
                    "message": resp.text,
                    "latency_ms": lat
                }
        except Exception as e:
            return {
                "numericCode": 504,
                "stringCode": "MODIFY_TIMEOUT_OR_ERROR",
                "message": str(e),
                "latency_ms": int((time.time() - start_ts) * 1000),
            }

    async def close_partial_position(
        self,
        metaapi_account_id: str,
        position_id: str,
        volume_to_close: float
    ) -> Dict[str, Any]:
        """Close partial lot (e.g. 50% TP1) of an open position."""
        start_ts = time.time()
        vol = max(0.01, round(volume_to_close, 2))
        if self.is_mock:
            return {
                "numericCode": 10009,
                "stringCode": "TRADE_RETCODE_DONE",
                "positionId": position_id,
                "closedVolume": vol,
                "latency_ms": int((time.time() - start_ts) * 1000),
                "simulated": True
            }

        url = f"{CLIENT_API_BASE}/users/current/accounts/{metaapi_account_id}/trade"
        payload = {
            "actionType": "POSITION_PARTIAL",
            "positionId": position_id,
            "volume": vol
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, headers=self._headers(), json=payload)
                lat = int((time.time() - start_ts) * 1000)
                if resp.status_code in (200, 201):
                    data = resp.json()
                    data["latency_ms"] = lat
                    return data
                # Fallback to POSITION_CLOSE with volume
                fallback_payload = {
                    "actionType": "POSITION_CLOSE",
                    "positionId": position_id,
                    "volume": vol
                }
                resp2 = await client.post(url, headers=self._headers(), json=fallback_payload)
                if resp2.status_code in (200, 201):
                    data = resp2.json()
                    data["latency_ms"] = int((time.time() - start_ts) * 1000)
                    return data
                return {
                    "numericCode": resp.status_code,
                    "stringCode": "CLOSE_PARTIAL_ERROR",
                    "message": resp.text,
                    "latency_ms": lat
                }
        except Exception as e:
            logger.error(f"close_partial_position network/timeout error for {metaapi_account_id}/{position_id}: {e}")
            return {
                "numericCode": 504,
                "stringCode": "CLOSE_PARTIAL_TIMEOUT_OR_ERROR",
                "message": str(e),
                "latency_ms": int((time.time() - start_ts) * 1000)
            }

    async def close_all_positions(self, metaapi_account_id: str) -> Dict[str, Any]:
        """Emergency circuit breaker: close all open positions on this account immediately."""
        try:
            positions = await self.get_open_positions(metaapi_account_id, raise_on_error=True)
        except Exception as e:
            logger.error(f"close_all_positions failed fetching open positions for {metaapi_account_id}: {e}")
            return {"closed_count": 0, "failed_count": 0, "status": "CLOSE_ALL_FETCH_ERROR", "error": str(e)}

        if not positions:
            return {"closed_count": 0, "failed_count": 0, "status": "NO_OPEN_POSITIONS"}

        tasks = []
        closed_count = 0
        failed_count = 0
        for pos in positions:
            pos_id = pos.get("id")
            if not pos_id:
                continue
            if self.is_mock:
                closed_count += 1
                continue
            url = f"{CLIENT_API_BASE}/users/current/accounts/{metaapi_account_id}/trade"
            payload = {"actionType": "POSITION_CLOSE", "positionId": str(pos_id)}
            async def _close(u, p):
                async with httpx.AsyncClient(timeout=10.0) as client:
                    return await client.post(u, headers=self._headers(), json=p)
            tasks.append(_close(url, payload))

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for res in results:
                if isinstance(res, Exception):
                    failed_count += 1
                    logger.error(f"close_all_positions exception for {metaapi_account_id}: {res}")
                elif getattr(res, "status_code", 0) in (200, 201):
                    body_ok = True
                    if hasattr(res, "json"):
                        try:
                            data = res.json()
                            if isinstance(data, dict) and ("numericCode" in data or "stringCode" in data):
                                body_ok = self._is_metaapi_success(data)
                        except Exception:
                            body_ok = True
                    elif isinstance(res, dict) and ("numericCode" in res or "stringCode" in res):
                        body_ok = self._is_metaapi_success(res)
                    if body_ok:
                        closed_count += 1
                    else:
                        failed_count += 1
                        logger.error(f"close_all_positions broker reject for {metaapi_account_id}: {res}")
                else:
                    failed_count += 1
                    logger.error(f"close_all_positions HTTP {getattr(res, 'status_code', '?')} for {metaapi_account_id}")

        status = "ALL_POSITIONS_CLOSED" if failed_count == 0 else "PARTIAL_CLOSE_FAILED"
        return {"closed_count": closed_count, "failed_count": failed_count, "status": status}


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
    if equity <= 0 or sl_points <= 0:
        return 0.0

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


from app.services.execution.fanout import execute_fan_out_for_signal  # noqa: E402,F401
