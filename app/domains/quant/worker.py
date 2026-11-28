"""Librarian & On-Demand Execution Worker for the quant lab.

Writes a research heartbeat, reconciles pending USDT payments,
automatically executes confirmed institutional & retail research studies,
and checks for hung jobs (>15 minutes timeout).
It does not discover trade signals and it does not place orders.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time

from app.db import init, setkv, tx

logger = logging.getLogger("zupirus.quant.worker")


def process_on_demand_research_jobs(now: float, target_request_id: Optional[str] = None) -> None:
    """Worker picks up CONFIRMED paid requests and auto-executes study.
    Also handles hung jobs (>15 minutes timeout).
    """
    from app.routers.custom_research import _log_audit_action, execute_research_run_internal

    # 1. Check for hung jobs > 15m (900s)
    with tx() as c:
        hung_rows = c.execute(
            """
            SELECT id, last_run_started_at FROM custom_research_requests
            WHERE status = 'RUNNING' AND last_run_started_at IS NOT NULL AND (? - last_run_started_at) > 900
            """,
            (now,),
        ).fetchall()

        for h in hung_rows:
            req_id = h["id"]
            logger.warning("Job %s timed out (>15 min). Marking FAILED.", req_id)
            c.execute(
                """
                UPDATE custom_research_requests
                SET status = 'FAILED', action_category = 'ACTIONABLE',
                    waiting_reason_vi = 'Quá thời gian thực thi (timeout 15 phút), cần can thiệp hoặc chạy lại',
                    updated_at = ?
                WHERE id = ?
                """,
                (now, req_id),
            )
            c.execute(
                """
                UPDATE custom_research_runs
                SET status = 'TIMED_OUT', error_details = 'Run exceeded 15 minute timeout limit', completed_at = ?
                WHERE request_id = ? AND status = 'RUNNING'
                """,
                (now, req_id),
            )
            _log_audit_action(c, req_id, "system_worker", "worker", "RUN_TIMED_OUT", reason="Exceeded 15m timeout")

        # 2. Pick up CONFIRMED + PAID requests for automated execution
        if target_request_id:
            ready_rows = c.execute(
                """
                SELECT id FROM custom_research_requests
                WHERE id = ? AND status = 'CONFIRMED' AND payment_status = 'PAID'
                """,
                (target_request_id,),
            ).fetchall()
        else:
            ready_rows = c.execute(
                """
                SELECT id FROM custom_research_requests
                WHERE status = 'CONFIRMED' AND payment_status = 'PAID'
                ORDER BY created_at ASC
                """
            ).fetchall()

    for r in ready_rows:
        try:
            logger.info("Worker auto-executing confirmed study %s...", r["id"])
            execute_research_run_internal(r["id"], "system_worker", "worker", is_rerun=False)
        except Exception as exc:
            logger.exception("Worker failed executing study %s: %s", r["id"], exc)


def main() -> None:
    init()
    logger.info("Quant librarian started. Auto-execution and copy-trade are not part of this process.")
    last_sync_time = 0.0
    while True:
        now = time.time()
        try:
            with tx() as c:
                setkv(c, "research_heartbeat", now)
                setkv(c, "product_mode", "quant_library")
                setkv(c, "execution_mode", "retired")
        except Exception as exc:
            logger.warning("Quant librarian heartbeat failed: %s", type(exc).__name__)
        try:
            from app.domains.billing.crypto_direct import scan_and_reconcile_pending_crypto_orders
            asyncio.run(scan_and_reconcile_pending_crypto_orders())
        except Exception as exc:
            logger.debug("USDT reconcile note: %s", type(exc).__name__)

        # Process on-demand research jobs & timeout watchdog
        try:
            process_on_demand_research_jobs(now)
        except Exception as exc:
            logger.debug("On-demand research worker check note: %s", exc)

        # Automated periodic market data ingest every 4 hours (14400s)
        if now - last_sync_time > 14400:
            try:
                from app.domains.quant.data_feed import sync_market_candles
                logger.info("Running automated market data sync for XAUUSD, EURUSD & BTCUSD...")
                sync_market_candles("XAUUSD", "M15", "5d")
                sync_market_candles("EURUSD", "M15", "5d")
                sync_market_candles("BTCUSD", "M15", "5d")
                last_sync_time = now
                logger.info("Automated market data sync completed successfully.")
            except Exception as exc:
                logger.warning("Automated market data sync skipped/failed: %s", exc)

        # Periodic Autonomous Research Cycle (Disabled by default for commercial pivot)
        enable_auto_pub = os.getenv("ENABLE_AUTO_RESEARCH_SCHEDULE", "").lower() in ("true", "1")
        if enable_auto_pub:
            try:
                from app.db import getkv
                with tx() as c:
                    last_run_raw = getkv(c, "quant_auto_research_last_run")
                last_run = float(last_run_raw) if last_run_raw else 0.0
                # 604800s = 7 days
                if (now - last_run > 604800) and (now - last_sync_time < 30):
                    import threading
                    from app.domains.ai.autonomous_pipeline import run_autonomous_research_cycle
                    logger.info("Spawning non-blocking background thread for scheduled weekly Research Cycle...")
                    threading.Thread(
                        target=run_autonomous_research_cycle,
                        kwargs={"force": False, "trigger_type": "SCHEDULED"},
                        daemon=True,
                        name="quant-research-scheduled",
                    ).start()
            except Exception as exc:
                logger.debug("Autonomous research cycle worker check note: %s", exc)

        time.sleep(10)


if __name__ == "__main__":
    main()
