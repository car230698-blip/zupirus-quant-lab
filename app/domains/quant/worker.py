"""Librarian process for the quant lab.

Writes a research heartbeat and reconciles pending USDT payments.
It does not discover trade signals and it does not place orders.
"""
from __future__ import annotations

import asyncio
import logging
import time

from app.db import init, setkv, tx

logger = logging.getLogger("zupirus.quant.worker")


def main() -> None:
    init()
    logger.info("Quant librarian started. Auto-execution and copy-trade are not part of this process.")
    while True:
        try:
            with tx() as c:
                setkv(c, "research_heartbeat", time.time())
                setkv(c, "product_mode", "quant_library")
                setkv(c, "execution_mode", "retired")
        except Exception as exc:
            logger.warning("Quant librarian heartbeat failed: %s", type(exc).__name__)
        try:
            from app.domains.billing.crypto_direct import scan_and_reconcile_pending_crypto_orders
            asyncio.run(scan_and_reconcile_pending_crypto_orders())
        except Exception as exc:
            logger.debug("USDT reconcile note: %s", type(exc).__name__)
        time.sleep(10)


if __name__ == "__main__":
    main()
