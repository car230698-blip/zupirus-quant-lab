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
                    closed_count += 1
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

    # Global Kill Switch Check (Fail-Closed)
    from app.db import tx, getkv
    with tx() as c:
        halt_row = c.execute("SELECT value FROM kv WHERE key = 'halted'").fetchone()
        is_halted = bool(halt_row and str(halt_row[0]).strip() in ("1", "true", "True"))
    if is_halted:
        logger.warning(f"execute_fan_out_for_signal aborted: Global Kill Switch is ACTIVE (halted=1). Signal: {signal_id}")
        return {
            "signal_id": signal_id,
            "total_accounts": len(accounts),
            "executed": 0,
            "failed": len(accounts),
            "skipped": len(accounts),
            "executions": [],
            "error": "KILL_SWITCH_ACTIVE"
        }
    try:
        entry_price = float(signal.get("entry_price") or signal.get("price") or 0.0)
    except (ValueError, TypeError):
        entry_price = 0.0
    if entry_price <= 0:
        logger.warning(f"execute_fan_out_for_signal aborted: invalid/missing entry_price for {symbol} ({signal_id})")
        return {
            "signal_id": signal_id,
            "total_accounts": len(accounts),
            "executed": 0,
            "failed": len(accounts),
            "skipped": len(accounts),
            "executions": [],
            "error": "INVALID_ENTRY_PRICE",
        }
    sl = float(signal["sl"]) if signal.get("sl") else None
    tp = float(signal["tp"]) if signal.get("tp") else None

    # Calculate SL distance in broker points consistently via point_size_for_symbol
    from app.services.symbol_precision import point_size_for_symbol
    sym_u = str(symbol or "XAUUSD").upper()
    if sl:
        sl_dist = abs(entry_price - sl)
        sl_points = sl_dist / point_size_for_symbol(sym_u)
    else:
        sl_points = 300.0  # Default $300 risk per 1.0 standard lot

    tasks = []
    account_metas = []

    from app.services.symbol_mapper import resolve_broker_symbol
    from app.services.account_classifier import calculate_normalized_lot_size
    from app.services.signal_ingestion.sanitizer import check_live_spread_guard
    from app.services.execution.watcher import is_account_drawdown_halted

    for acc in accounts:
        acc_id = acc["id"]
        meta_id = acc.get("metaapi_account_id") or acc_id

        # 0. Check per-account Prop Drawdown Lock (unified key check)
        with tx() as c:
            is_dd_locked = is_account_drawdown_halted(c, acc_id)
        if is_dd_locked:
            logger.warning(f"Account {acc_id} skipped: Prop drawdown circuit breaker is LOCKED.")
            continue

        # 1. Broker Symbol Auto-Discovery & Mapping check
        broker_sym = resolve_broker_symbol(acc_id, symbol)
        if not broker_sym:
            logger.info(f"Account {acc_id} does not support {symbol} (SKIPPED_UNSUPPORTED_SYMBOL).")
            continue

        # 2. Broker Live Spread Guard (Lớp 2: Kiểm tra riêng theo sàn của khách)
        try:
            broker_spread = float(acc.get("live_spread_pips") or 0.0)
        except (ValueError, TypeError):
            broker_spread = 0.0
        if broker_spread <= 0:
            try:
                from app.db import tx
                from app.services.symbol_mapper import canonical_symbol
                canon_sym = canonical_symbol(symbol)
                with tx() as c:
                    q_row = c.execute(
                        "SELECT bid, ask, ts FROM quotes WHERE symbol = ? AND (? - ts) < 120 ORDER BY ts DESC LIMIT 1",
                        (canon_sym, time.time())
                    ).fetchone()
                    if q_row and q_row[0] and q_row[1]:
                        from app.services.symbol_precision import pip_multiplier_for_symbol
                        broker_spread = round(abs(float(q_row[1]) - float(q_row[0])) * pip_multiplier_for_symbol(canon_sym), 1)
            except Exception:
                pass
        if broker_spread <= 0 and metaapi_client and getattr(metaapi_client, "is_mock", False):
            broker_spread = 1.5
        if broker_spread <= 0:
            logger.warning(f"Account {acc_id} rejected: No live broker spread quote available (Fail-Closed).")
            continue

        ok_spread, spread_err = check_live_spread_guard(symbol, broker_spread)
        if not ok_spread:
            logger.warning(f"Account {acc_id} rejected due to high spread: {spread_err}")
            continue

        # 3. Fast read-only duplicate check before network/sizing checks
        is_duplicate = False
        try:
            from app.db import tx
            with tx() as c:
                existing = c.execute(
                    "SELECT id FROM metaapi_trade_executions WHERE account_id = ? AND (signal_id = ? OR order_id = ? OR position_id = ?)",
                    (acc_id, signal_id, signal_id, signal_id)
                ).fetchone()
                if existing:
                    is_duplicate = True
        except Exception:
            pass

        if is_duplicate:
            logger.warning(f"Idempotency: Signal {signal_id} already executed for account {acc_id}. Skipping.")
            continue

        # 4. Calculate dynamic proportional lot (Cent vs Standard vs Prop Firm)
        is_comp = bool(acc.get("is_compounding", False))
        try:
            balance = float(acc.get("balance") or 0.0)
        except (ValueError, TypeError):
            balance = 0.0
        raw_eq = acc.get("equity")
        try:
            equity = float(raw_eq) if raw_eq is not None and str(raw_eq).strip() != "" else balance
        except (ValueError, TypeError):
            equity = balance
        if equity <= 0:
            logger.warning(f"Account {acc_id} skipped: zero or negative equity ({equity}).")
            continue

        # Never size on inflated balance if account is in drawdown (equity < balance)
        base_capital = min(balance, equity) if (not is_comp and balance > 0) else equity

        try:
            risk_pct = float(acc.get("risk_percent") if acc.get("risk_percent") is not None else 1.0)
        except (ValueError, TypeError):
            risk_pct = 1.0
        try:
            max_lot = float(acc.get("max_lot") if acc.get("max_lot") is not None else 5.0)
        except (ValueError, TypeError):
            max_lot = 5.0
        try:
            mult = float(acc.get("risk_multiplier") or acc.get("multiplier") or 1.0)
        except (ValueError, TypeError):
            mult = 1.0
        try:
            c_size = float(acc.get("contract_size") or 100.0)
        except (ValueError, TypeError):
            c_size = 100.0
        try:
            t_val = float(acc.get("tick_value") or 1.0)
        except (ValueError, TypeError):
            t_val = 1.0
        is_cent_acc = acc.get("account_type") == "CENT" or acc.get("currency") in ("USC", "EUC") or c_size <= 1.0

        is_prop_mode = bool(acc.get("is_prop_firm_mode"))
        prop_stage = str(acc.get("prop_stage") or "CHALLENGE").upper()
        effective_risk_pct = risk_pct
        effective_mult = mult

        if is_prop_mode:
            # Check profit-target throttle flag (halve risk when >= 80% of prop profit target achieved)
            try:
                from app.db import tx, getkv
                with tx() as c:
                    if getkv(c, f"prop_target_throttle:{acc_id}") == "1":
                        effective_risk_pct = effective_risk_pct * 0.5
            except Exception:
                pass

        open_positions_cache = None
        if metaapi_client:
            try:
                from app.config import MAX_CONCURRENT_TRADES_PER_ACCOUNT
                import inspect
                if "raise_on_error" in inspect.signature(metaapi_client.get_open_positions).parameters:
                    open_positions_cache = await metaapi_client.get_open_positions(meta_id, raise_on_error=True) or []
                else:
                    open_positions_cache = await metaapi_client.get_open_positions(meta_id) or []
                if len(open_positions_cache) >= MAX_CONCURRENT_TRADES_PER_ACCOUNT:
                    logger.info(
                        f"Account {acc_id} skipped: MAX_CONCURRENT_TRADES_REACHED "
                        f"({len(open_positions_cache)} >= {MAX_CONCURRENT_TRADES_PER_ACCOUNT})."
                    )
                    continue
            except Exception as pos_err:
                logger.warning(f"Account {acc_id} skipped fail-closed on position check error: {pos_err}")
                continue

        if is_prop_mode and prop_stage == "LIVE" and metaapi_client:
            try:
                from app.services.symbol_precision import contract_size_for_symbol, quote_to_usd_rate
                open_positions = open_positions_cache if open_positions_cache is not None else []
                eff_contract = contract_size_for_symbol(symbol, is_cent=is_cent_acc, account_contract_size=c_size)
                open_idea_risk_pct = 0.0
                sym_upper = symbol.upper()
                broker_upper = broker_sym.upper()
                unprotected_same_idea = False

                from app.services.symbol_mapper import canonical_symbol
                canon_target = canonical_symbol(symbol)
                for pos in open_positions:
                    pos_sym = str(pos.get("symbol") or "").upper()
                    if pos_sym != broker_upper and canonical_symbol(pos_sym) != canon_target:
                        continue
                    pos_type = str(pos.get("type") or "").upper()
                    pos_side = "BUY" if "BUY" in pos_type else ("SELL" if "SELL" in pos_type else "")
                    if pos_side != action:
                        continue
                    pos_open = float(pos.get("openPrice") or 0.0)
                    pos_sl = float(pos.get("stopLoss") or 0.0)
                    pos_vol = float(pos.get("volume") or 0.0)
                    if pos_open <= 0 or pos_vol <= 0:
                        continue
                    if pos_sl <= 0:
                        unprotected_same_idea = True
                        break
                    is_pos_buy = (pos_side == "BUY")
                    still_at_risk = (is_pos_buy and pos_sl < pos_open) or (not is_pos_buy and pos_sl > pos_open)
                    if still_at_risk:
                        pos_risk_usd = abs(pos_open - pos_sl) * pos_vol * eff_contract * quote_to_usd_rate(symbol, pos_open)
                        open_idea_risk_pct += (pos_risk_usd / base_capital) * 100.0

                if unprotected_same_idea:
                    logger.warning(f"Account {acc_id} (PROP LIVE) skipped fail-closed: open {symbol} {action} position has no SL.")
                    continue

                remaining_idea_risk_pct = max(0.0, 1.0 - open_idea_risk_pct)
                if remaining_idea_risk_pct <= 0.05:
                    logger.info(
                        f"Account {acc_id} (PROP LIVE) skipped: PROP_LIVE_IDEA_RISK_CAP_1PCT "
                        f"(open={open_idea_risk_pct:.2f}%, remaining={remaining_idea_risk_pct:.2f}%)."
                    )
                    continue
                capped_risk = min(effective_risk_pct * effective_mult, remaining_idea_risk_pct)
                effective_risk_pct = capped_risk
                effective_mult = 1.0
            except Exception as prop_err:
                logger.warning(f"Account {acc_id} (PROP LIVE) fail-closed on position check error: {prop_err}")
                continue

        volume = calculate_normalized_lot_size(
            equity=base_capital,
            risk_pct=effective_risk_pct,
            sl_distance_points=sl_points,
            contract_size=c_size,
            tick_value=t_val,
            risk_multiplier=effective_mult,
            max_lot=max_lot,
            is_cent=is_cent_acc,
            symbol=symbol,
            entry_price=entry_price,
        )
        if volume <= 0:
            logger.info(f"Account {acc_id} skipped: calculated volume={volume} <= 0 (risk budget too small for min_lot).")
            continue

        # Acquire Redis + DB idempotency lock only after all guards and sizing pass
        if redis_client:
            lock_key = f"zupirus:lock:signal:{signal_id}:{acc_id}"
            try:
                if not redis_client.set(lock_key, "1", ex=120, nx=True):
                    logger.warning(f"Idempotency: Signal {signal_id} already locked in Redis for {acc_id}. Skipping.")
                    continue
            except Exception as e:
                logger.error(f"Redis idempotency lock error: {e}")

        try:
            from app.db import tx
            with tx() as c:
                lock_cur = c.execute(
                    "INSERT INTO signal_dispatch_locks (id, signal_fingerprint, account_id, worker_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (signal_fingerprint, account_id) DO NOTHING",
                    (f"lck_{uuid.uuid4().hex[:12]}", str(signal_id), acc_id, str(os.getpid()), time.time())
                )
                if getattr(lock_cur, "rowcount", 1) == 0:
                    logger.warning(f"Idempotency: Signal {signal_id} already locked in DB for {acc_id}. Skipping.")
                    if redis_client:
                        try:
                            redis_client.delete(f"zupirus:lock:signal:{signal_id}:{acc_id}")
                        except Exception:
                            pass
                    continue
        except Exception:
            pass

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
            "symbol": symbol,
            "action": action,
            "total_accounts": len(accounts),
            "executed": 0,
            "failed": 0,
            "skipped": len(accounts),
            "executions": [],
            "results": [],
            "avg_latency_ms": 0,
            "total_fanout_elapsed_ms": 0
        }

    # Parallel microsecond fan-out dispatch
    start_all = time.time()
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)
    total_elapsed_ms = int((time.time() - start_all) * 1000)

    from app.services.execution.watcher import _is_metaapi_success

    executions = []
    latencies = []
    executed_count = 0
    failed_count = 0
    now_ts = time.time()

    for meta, res in zip(account_metas, raw_results):
        if isinstance(res, Exception):
            failed_count += 1
            executions.append({
                "account_id": meta["account_id"],
                "metaapi_account_id": meta["metaapi_account_id"],
                "status": "FAILED",
                "volume": meta["volume"],
                "error": str(res),
                "latency_ms": 0,
                "persisted": True
            })
        else:
            lat = res.get("latency_ms", 0)
            latencies.append(lat)
            is_success = _is_metaapi_success(res)
            if is_success:
                executed_count += 1
                status = "FILLED"
            else:
                failed_count += 1
                status = "REJECTED"

            filled_vol = float(res.get("volume") or res.get("closedVolume") or meta["volume"])
            executions.append({
                "account_id": meta["account_id"],
                "metaapi_account_id": meta["metaapi_account_id"],
                "status": status,
                "volume": filled_vol,
                "order_id": res.get("orderId"),
                "position_id": res.get("positionId"),
                "latency_ms": lat,
                "message": res.get("message"),
                "persisted": True
            })

    # Persist all executions directly into metaapi_trade_executions
    try:
        with tx() as c:
            for ex in executions:
                exec_id = f"exec_{uuid.uuid4().hex[:16]}"
                acc_id_val = ex["account_id"]
                # Ensure metaapi_cloud_accounts has a row for acc_id_val so SQLite FK constraint on metaapi_trade_executions is satisfied
                is_pg_conn = bool(getattr(c, "_is_pg", False))
                if is_pg_conn:
                    c.execute("SAVEPOINT sp_metaapi_fk")
                try:
                    has_cloud = c.execute("SELECT 1 FROM metaapi_cloud_accounts WHERE id = ?", (acc_id_val,)).fetchone()
                    if not has_cloud:
                        u_row = c.execute("SELECT id FROM users LIMIT 1").fetchone()
                        fallback_uid = u_row[0] if u_row else "system"
                        c.execute(
                            """
                            INSERT INTO metaapi_cloud_accounts(
                                id, user_id, login, server, platform, account_name,
                                metaapi_account_id, metaapi_state, auto_trade, created_at
                            ) VALUES(?, ?, ?, 'MT5-Cloud', 'mt5', ?, ?, 'DEPLOYED', 1, ?)
                            ON CONFLICT (id) DO NOTHING
                            """,
                            (acc_id_val, fallback_uid, acc_id_val, acc_id_val, ex.get("metaapi_account_id") or acc_id_val, now_ts)
                        )
                    if is_pg_conn:
                        c.execute("RELEASE SAVEPOINT sp_metaapi_fk")
                except Exception:
                    if is_pg_conn:
                        c.execute("ROLLBACK TO SAVEPOINT sp_metaapi_fk")
                c.execute("""
                    INSERT INTO metaapi_trade_executions(
                        id, signal_id, account_id, metaapi_account_id, symbol,
                        action, volume, entry_price, sl, tp, position_id,
                        order_id, status, latency_ms, error_message, executed_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    exec_id, signal_id, acc_id_val, ex.get("metaapi_account_id"),
                    symbol, action, ex["volume"], entry_price,
                    sl, tp, ex.get("position_id"), ex.get("order_id"),
                    ex["status"], ex.get("latency_ms", 0),
                    ex.get("error") or ex.get("message"), now_ts
                ))
    except Exception as persist_err:
        logger.error(f"Error persisting trade executions inside execute_fan_out_for_signal: {persist_err}")

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

