"""Autonomous Quant Lab Research Pipeline Orchestrator.

Orchestrates the end-to-end 100% Zero-Touch Autonomous Desk:
1. Ingests fresh institutional market candles for Gold, FX, and Crypto.
2. Executes multi-strategy Walk-Forward & Monte Carlo statistical evaluations.
3. Submits study bundles to the Institutional Gatekeeper (5 criteria).
4. Directs Google Gemini (gemini-4-hydrogen across 8-key rotating pool)
   to draft 5-chapter institutional research papers in accented Vietnamese.
5. Renders branded methodology PDFs with embedded equity curves and tables.
6. Automatically publishes approved reports to the public catalog with USDT pricing.
Zero admin manual intervention required.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.db import getkv, setkv, tx
from app.domains.ai.autonomous_gate import evaluate_institutional_gate
from app.domains.ai.report_writer import generate_research_report
from app.domains.quant.data_feed import fetch_public_ohlcv, sync_market_candles
from app.domains.quant.methodology import build_methodology
from app.domains.quant.service import create_methodology_from_candles, render_bilingual_pdf
from app.domains.quant.studies import run_studies
from app.domains.reports.service import update_admin_report

logger = logging.getLogger("zupirus.ai.autonomous_pipeline")

AUTONOMOUS_UNIVERSE = [
    {
        "symbol": "XAUUSD",
        "timeframe": "M15",
        "strategy": "breakout_retest",
        "title_vi": "Chiến Lược Định Lượng Breakout & Retest Theo Cấu Trúc Khối Lượng Vàng XAU/USD",
        "title_en": "Quantitative Breakout & Retest Strategy on COMEX Gold (XAU/USD)",
        "price_usd": 19.99,
    },
    {
        "symbol": "EURUSD",
        "timeframe": "M15",
        "strategy": "asian_mean_reversion",
        "title_vi": "Mô Hình Hồi Quy Trung Bình Phiên Á & Phân Kỳ Dải Biên Độ Cặp EUR/USD",
        "title_en": "Asian Session Mean Reversion & Volatility Band Strategy on EUR/USD",
        "price_usd": 14.99,
    },
    {
        "symbol": "BTCUSD",
        "timeframe": "M15",
        "strategy": "london_sweep",
        "title_vi": "Khai Thác Thanh Khoản Phiên Giao Dịch & Quét Đỉnh Đáy Bitcoin (BTC/USD)",
        "title_en": "Session Liquidity Purge & Trend Continuation on Bitcoin (BTC/USD)",
        "price_usd": 24.99,
    },
]


def run_autonomous_research_cycle(
    force: bool = False,
    universe: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Execute a complete autonomous research cycle across target assets and strategies."""
    now = time.time()
    targets = universe or AUTONOMOUS_UNIVERSE
    logger.info("Starting Autonomous Quant Research Cycle for %d targets (force=%s)...", len(targets), force)

    published_reports: List[Dict[str, Any]] = []
    rejected_reports: List[Dict[str, Any]] = []

    for item in targets:
        symbol = item["symbol"]
        timeframe = item["timeframe"]
        strategy = item["strategy"]
        title_vi = item["title_vi"]
        title_en = item["title_en"]
        price_usd = float(item.get("price_usd", 19.99))

        logger.info("Evaluating candidate: %s · %s · %s...", symbol, timeframe, strategy)

        try:
            # 1. Ingest fresh candles
            candles = fetch_public_ohlcv(symbol=symbol, timeframe=timeframe, range_str="5d")
            if not candles or len(candles) < 50:
                logger.warning("Insufficient candles for %s (%d bars). Skipping.", symbol, len(candles) if candles else 0)
                rejected_reports.append({
                    "symbol": symbol,
                    "strategy": strategy,
                    "status": "REJECT",
                    "reason": f"Nguồn dữ liệu nến không đủ độ dài mẫu ({len(candles) if candles else 0} nến).",
                })
                continue

            # Convert to dictionary rows for the quant study engine
            candle_rows = [
                {
                    "time": int(c.time),
                    "open": float(c.open),
                    "high": float(c.high),
                    "low": float(c.low),
                    "close": float(c.close),
                    "volume": float(c.volume),
                }
                for c in candles
            ]

            # 2. Run statistical backtest and Monte Carlo simulation
            bundle = run_studies(
                candle_rows,
                symbol=symbol,
                timeframe=timeframe,
                strategy_name=strategy,
                round_trip_cost_r=0.025,
            )

            # 3. Submit to Institutional Gatekeeper
            gate_res = evaluate_institutional_gate(bundle)
            logger.info("Gatekeeper result for %s/%s: %s (Score: %.1f/100)", symbol, strategy, gate_res.status, gate_res.score)

            if not gate_res.passed and not force:
                logger.info("Candidate %s/%s rejected by institutional gate: %s", symbol, strategy, gate_res.failed_checks)
                rejected_reports.append({
                    "symbol": symbol,
                    "strategy": strategy,
                    "status": "REJECT",
                    "score": gate_res.score,
                    "failed_checks": gate_res.failed_checks,
                    "passed_checks": gate_res.passed_checks,
                })
                continue

            # 4. Generate Institutional AI Report via Gemini 4 Hydrogen
            logger.info("Calling Gemini 4 Hydrogen for %s/%s institutional report drafting...", symbol, strategy)
            ai_report = generate_research_report(bundle, use_gemini=True)

            # 5. Build Methodology Document & Render PDFs
            doc = build_methodology(
                bundle,
                title_vi=title_vi,
                title_en=title_en,
                version="v1.0-auto",
                ai_report=ai_report,
            )

            # 6. Ingest into Catalog and Auto-Publish
            draft_res = create_methodology_from_candles(
                rows=candle_rows,
                symbol=symbol,
                timeframe=timeframe,
                title_vi=title_vi,
                title_en=title_en,
                price_usd=price_usd,
                strategy_name=strategy,
                admin_id="autonomous_desk_agent",
                version="v1.0-auto",
                round_trip_cost_r=0.025,
                source="AUTONOMOUS_PIPELINE",
                store_candles=True,
            )

            report_id = draft_res.get("report", {}).get("id") or draft_res.get("id")
            if report_id:
                # 7. Auto-Publish Immediately (Zero manual admin approval)
                updated = update_admin_report(
                    report_id=report_id,
                    updates={
                        "status": "PUBLISHED",
                        "price_usd": price_usd,
                        "description": gate_res.summary_vi,
                    },
                    admin_id="autonomous_desk_agent",
                )
                logger.info("Report %s successfully auto-published to public catalog at $%.2f USDT!", report_id, price_usd)
                published_reports.append({
                    "report_id": report_id,
                    "symbol": symbol,
                    "strategy": strategy,
                    "title": title_vi,
                    "price_usd": price_usd,
                    "score": gate_res.score,
                    "status": "PUBLISHED",
                    "sample_pdf_url": updated.get("sample_pdf_url"),
                })
        except Exception as exc:
            logger.exception("Error processing candidate %s/%s: %s", symbol, strategy, exc)
            rejected_reports.append({
                "symbol": symbol,
                "strategy": strategy,
                "status": "ERROR",
                "error": str(exc),
            })

    # Record last run summary in database
    summary = {
        "timestamp": now,
        "total_candidates": len(targets),
        "published_count": len(published_reports),
        "rejected_count": len(rejected_reports),
        "published": published_reports,
        "rejected": rejected_reports,
    }

    try:
        with tx() as c:
            setkv(c, "quant_auto_research_last_run", now)
            setkv(c, "quant_auto_research_last_summary", json.dumps(summary, ensure_ascii=False))
    except Exception as exc:
        logger.warning("Failed to store autonomous summary in kv: %s", exc)

    logger.info(
        "Autonomous Quant Research Cycle completed: %d published, %d rejected.",
        len(published_reports),
        len(rejected_reports),
    )
    return summary


def get_autonomous_pipeline_status() -> Dict[str, Any]:
    """Retrieve status, last run timestamp, and publication metrics of the autonomous desk."""
    last_run_ts: float = 0.0
    summary_data: Dict[str, Any] = {}
    try:
        with tx() as c:
            raw_ts = getkv(c, "quant_auto_research_last_run")
            if raw_ts:
                last_run_ts = float(raw_ts)
            raw_sum = getkv(c, "quant_auto_research_last_summary")
            if raw_sum:
                summary_data = json.loads(raw_sum)
    except Exception as exc:
        logger.debug("get_autonomous_pipeline_status error: %s", exc)

    return {
        "is_active": True,
        "engine": "ZUPIRUS 100% Autonomous Zero-Touch Quant Desk",
        "ai_writer_model": "gemini-4-hydrogen",
        "last_run_timestamp": last_run_ts,
        "last_run_iso": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(last_run_ts)) if last_run_ts else None,
        "last_summary": summary_data,
    }
