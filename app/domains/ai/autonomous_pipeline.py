"""Autonomous Quant Lab Research Pipeline Orchestrator.

Orchestrates the quantitative research and draft generation desk:
1. Ingests institutional market candles for target assets (COMEX Gold, FX, Crypto).
2. Executes multi-strategy Walk-Forward & Monte Carlo statistical evaluations.
3. Submits study bundles to the Institutional Gatekeeper (5 criteria).
4. Directs Google Gemini (gemini-4-hydrogen across 8-key rotating pool)
   to draft 5-chapter institutional research papers in accented Vietnamese.
5. Renders branded methodology PDFs with embedded equity curves and tables.
6. Saves the compiled research as a DRAFT / READY_FOR_REVIEW report in the catalog.

SAFETY & GOVERNANCE POLICY:
- Agents, workers, and automated scripts NEVER publish reports automatically.
- All public publishing requires explicit human Admin approval via `publish_admin_report`.
- The `force` flag only forces re-running candidate draft generation, NEVER bypasses approval.
- Concurrency mutex prevents racing between scheduled runs and manual admin triggers.
"""
from __future__ import annotations

import json
import logging
import secrets
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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
        "symbol": "GC=F",
        "timeframe": "M15",
        "strategy": "breakout_retest",
        "title_vi": "Nghiên Cứu Thăm Dò Cấu Trúc Khối Lượng Breakout & Retest Hợp Đồng Tương Lai Vàng COMEX (GC=F)",
        "title_en": "Exploratory Breakout & Retest Quantitative Study on COMEX Gold Futures (GC=F)",
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

RESEARCH_LOCK_KEY = "lock:quant_research_running"
RESEARCH_LOCK_TIMEOUT_SEC = 900  # 15 minutes


def acquire_research_job_lock(job_id: Optional[str] = None, timeout_sec: int = RESEARCH_LOCK_TIMEOUT_SEC) -> Tuple[bool, Optional[str]]:
    """Atomically acquire the research execution mutex to avoid concurrent duplicate runs.
    Returns (acquired, existing_or_active_job_id)."""
    now = time.time()
    eff_job_id = job_id or f"job_{secrets.token_hex(6)}"
    with tx() as c:
        raw_lock = getkv(c, RESEARCH_LOCK_KEY)
        if raw_lock:
            try:
                data = json.loads(raw_lock)
                if isinstance(data, dict):
                    expires_at = float(data.get("expires_at") or 0.0)
                    if expires_at > now:
                        return False, str(data.get("job_id") or "active_job")
            except Exception:
                pass

        lock_payload = json.dumps({
            "job_id": eff_job_id,
            "started_at": now,
            "expires_at": now + timeout_sec,
        })
        setkv(c, RESEARCH_LOCK_KEY, lock_payload)
        setkv(c, "quant_active_research_job_id", eff_job_id)
        return True, eff_job_id


def release_research_job_lock(job_id: Optional[str] = None) -> None:
    """Release the research execution mutex."""
    try:
        with tx() as c:
            raw_lock = getkv(c, RESEARCH_LOCK_KEY)
            if raw_lock:
                try:
                    data = json.loads(raw_lock)
                    if not job_id or str(data.get("job_id")) == job_id:
                        setkv(c, RESEARCH_LOCK_KEY, "")
                except Exception:
                    setkv(c, RESEARCH_LOCK_KEY, "")
            else:
                setkv(c, RESEARCH_LOCK_KEY, "")
    except Exception as exc:
        logger.debug("release_research_job_lock notice: %s", exc)


def run_autonomous_research_cycle(
    force: bool = False,
    universe: Optional[List[Dict[str, Any]]] = None,
    trigger_type: str = "MANUAL",
) -> Dict[str, Any]:
    """Execute a research cycle across target assets and strategies.
    Creates DRAFT reports ready for review. Never auto-publishes."""
    now = time.time()
    job_id = f"job_quant_{secrets.token_hex(6)}"

    # 1. Concurrency Mutex Check
    acquired, running_job = acquire_research_job_lock(job_id)
    if not acquired:
        logger.warning("Research cycle skipped: Job %s is currently running.", running_job)
        return {
            "success": False,
            "job_id": job_id,
            "status": "BLOCKED",
            "message": f"Một tác vụ nghiên cứu khác đang chạy ({running_job}). Vui lòng đợi hoàn tất.",
            "running_job_id": running_job,
        }

    targets = universe or AUTONOMOUS_UNIVERSE
    logger.info("Starting Quant Research Cycle (job_id=%s, trigger=%s, targets=%d, force=%s)...", job_id, trigger_type, len(targets), force)

    draft_reports: List[Dict[str, Any]] = []
    rejected_reports: List[Dict[str, Any]] = []

    try:
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
                        "report_id": None,
                        "symbol": symbol,
                        "strategy": strategy,
                        "status": "REJECT",
                        "reason": f"Nguồn dữ liệu nến không đủ độ dài mẫu ({len(candles) if candles else 0} nến).",
                        "failed_checks": ["INSUFFICIENT_SAMPLE_SIZE"],
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
                    logger.info("Candidate %s/%s rejected by institutional gate [%s]: %s", symbol, strategy, gate_res.status, gate_res.failed_checks)
                    rejected_reports.append({
                        "report_id": None,
                        "symbol": symbol,
                        "strategy": strategy,
                        "status": gate_res.status,
                        "score": gate_res.score,
                        "reason": gate_res.summary_vi,
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
                    version="v1.0-draft",
                    ai_report=ai_report,
                )

                # 6. Ingest into Catalog as DRAFT (Never Auto-Published)
                draft_res = create_methodology_from_candles(
                    rows=candle_rows,
                    symbol=symbol,
                    timeframe=timeframe,
                    title_vi=title_vi,
                    title_en=title_en,
                    price_usd=price_usd,
                    strategy_name=strategy,
                    admin_id="autonomous_desk_agent",
                    version="v1.0-draft",
                    round_trip_cost_r=0.025,
                    source="AUTONOMOUS_PIPELINE",
                    store_candles=True,
                )

                # CONTRACT FIX: Read correct report_id from draft_res dictionary
                report_id = draft_res.get("report_id") or draft_res.get("report", {}).get("id") or draft_res.get("id")
                if not report_id:
                    raise ValueError(f"create_methodology_from_candles did not return a valid report_id: {draft_res}")

                # Update draft metadata with Gatekeeper summary (remains strictly DRAFT/READY_FOR_REVIEW)
                updated = update_admin_report(
                    report_id=report_id,
                    updates={
                        "status": "READY_FOR_REVIEW" if gate_res.passed else "DRAFT",
                        "price_usd": price_usd,
                        "description": gate_res.summary_vi,
                    },
                    admin_id="autonomous_desk_agent",
                )
                logger.info("Report draft %s created successfully with status %s.", report_id, updated.get("status"))
                draft_reports.append({
                    "report_id": report_id,
                    "symbol": symbol,
                    "strategy": strategy,
                    "title": title_vi,
                    "price_usd": price_usd,
                    "score": gate_res.score,
                    "status": updated.get("status", "DRAFT"),
                    "gate_verdict": gate_res.status,
                    "sample_pdf_url": updated.get("sample_pdf_url"),
                    "full_pdf_path": updated.get("full_pdf_path"),
                })
            except Exception as exc:
                logger.exception("Error processing candidate %s/%s: %s", symbol, strategy, exc)
                rejected_reports.append({
                    "report_id": None,
                    "symbol": symbol,
                    "strategy": strategy,
                    "status": "ERROR",
                    "reason": str(exc),
                    "failed_checks": ["PIPELINE_RUNTIME_ERROR"],
                })

        # Record last run summary in database
        summary = {
            "success": True,
            "status": "COMPLETED",
            "job_id": job_id,
            "trigger_type": trigger_type,
            "timestamp": now,
            "total_candidates": len(targets),
            "drafts_count": len(draft_reports),
            "rejected_count": len(rejected_reports),
            "drafts": draft_reports,
            "rejected": rejected_reports,
        }

        try:
            with tx() as c:
                setkv(c, "quant_auto_research_last_run", now)
                setkv(c, "quant_auto_research_last_summary", json.dumps(summary, ensure_ascii=False))
        except Exception as exc:
            logger.warning("Failed to store autonomous summary in kv: %s", exc)

        logger.info(
            "Quant Research Cycle completed: %d drafts created (awaiting admin review), %d rejected.",
            len(draft_reports),
            len(rejected_reports),
        )
        return summary
    finally:
        release_research_job_lock(job_id)


def get_autonomous_pipeline_status() -> Dict[str, Any]:
    """Retrieve status, active job lock, and last run metrics of the quant research desk."""
    last_run_ts: float = 0.0
    summary_data: Dict[str, Any] = {}
    active_job_id: Optional[str] = None
    is_job_running = False

    try:
        with tx() as c:
            raw_ts = getkv(c, "quant_auto_research_last_run")
            if raw_ts:
                last_run_ts = float(raw_ts)
            raw_sum = getkv(c, "quant_auto_research_last_summary")
            if raw_sum:
                summary_data = json.loads(raw_sum)
            raw_lock = getkv(c, RESEARCH_LOCK_KEY)
            if raw_lock:
                try:
                    lock_d = json.loads(raw_lock)
                    if isinstance(lock_d, dict) and float(lock_d.get("expires_at", 0)) > time.time():
                        is_job_running = True
                        active_job_id = lock_d.get("job_id")
                except Exception:
                    pass
    except Exception as exc:
        logger.debug("get_autonomous_pipeline_status error: %s", exc)

    return {
        "is_active": True,
        "is_job_running": is_job_running,
        "active_job_id": active_job_id,
        "engine": "ZUPIRUS Verifiable Quant Research Desk",
        "ai_writer_model": "gemini-4-hydrogen",
        "governance_rule": "Agent generates DRAFT only. Publishing requires Admin review.",
        "last_run_timestamp": last_run_ts,
        "last_run_iso": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(last_run_ts)) if last_run_ts else None,
        "last_summary": summary_data,
    }
