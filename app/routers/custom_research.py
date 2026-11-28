"""Custom On-Demand Quantitative Research Router.

Handles:
1. Product Line A: Retail Technical Analysis (XAUUSD, EURUSD, USDJPY - H1/H4)
   - On-demand deterministic analysis & mobile-optimized 2-4 page PDF note.
2. Product Line B: Institutional Custom Macro Research (US CPI multi-asset event studies)
   - Bespoke RFP inquiry -> Proposal Draft Agent -> Admin Quote/Proposal -> Client Confirm -> Admin Run -> Review -> Approve & Private Deliver.
3. Real-time Order Chat & Attachments:
   - WebSocket/SSE streaming, message history, PNG/JPEG/WebP/PDF/CSV uploads with magic bytes validation.
4. Strict Tenant/User Isolation:
   - Private research deliverables and attachments are never published to public catalog.
   - Non-owners receive 403 Forbidden on download and chat access attempts.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import secrets
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from app.core.db import tx
from app.domains.billing.crypto_direct import (
    get_crypto_wallets_config,
    validate_crypto_address,
    verify_trc20_transaction,
    verify_bep20_transaction,
)
from app.domains.quant.candles import Candle, resample_candles
from app.domains.quant.institutional_macro import (
    build_institutional_deliverable_bundle,
    generate_institutional_pdf,
    run_institutional_macro_event_study,
)
from app.domains.quant.retail_analysis import generate_retail_pdf, run_retail_technical_analysis
from app.domains.reports.pdf_builder import get_private_reports_dir
from app.domains.reports.service import grant_report_entitlement_tx
from app.routers.deps import get_current_admin, get_current_user

logger = logging.getLogger("zupirus.routers.custom_research")
router = APIRouter(tags=["Custom Research"])

# In-memory SSE queues per request_id for live chat broadcasts
_chat_subscribers: Dict[str, List[asyncio.Queue]] = {}


def _fail(status_code: int, detail: str) -> None:
    raise HTTPException(status_code=status_code, detail=detail)


def _get_attachments_dir(request_id: str) -> Path:
    data_dir = Path(os.getenv("DATA_DIR", "data"))
    base = data_dir / "research_attachments" / request_id
    base.mkdir(parents=True, exist_ok=True)
    return base


def is_sandbox_allowed() -> bool:
    env = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).lower()
    allow_sb = os.getenv("ALLOW_SANDBOX_PAY", "").lower() in ("true", "1", "yes")
    if env in ("production", "prod"):
        return allow_sb
    return os.getenv("ALLOW_SANDBOX_PAY", "true").lower() in ("true", "1", "yes")


def _broadcast_chat_message(request_id: str, message_data: dict) -> None:
    # 1. In-process queues
    queues = _chat_subscribers.get(request_id, [])
    for q in list(queues):
        try:
            q.put_nowait(message_data)
        except Exception:
            pass

    # 2. Cross-process Redis pub/sub if available
    redis_url = os.getenv("REDIS_URL")
    if redis_url:
        try:
            import redis
            rc = redis.from_url(redis_url, socket_timeout=1.0)
            rc.publish(f"cr_chat:{request_id}", json.dumps(message_data, ensure_ascii=False))
        except Exception:
            pass


def _validate_attachment_bytes(filename: str, content: bytes) -> str:
    """Validate allowed file extension and inspect magic bytes for PNG, JPEG, WebP, PDF, CSV."""
    if len(content) > 20 * 1024 * 1024:
        _fail(400, "Dung lượng tệp vượt quá giới hạn tối đa (20MB).")

    ext = Path(filename).suffix.lower()
    if ext == ".png" and content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    elif ext in (".jpg", ".jpeg") and content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    elif ext == ".webp" and content.startswith(b"RIFF") and b"WEBP" in content[:16]:
        return "image/webp"
    elif ext == ".pdf" and content.startswith(b"%PDF"):
        return "application/pdf"
    elif ext == ".csv":
        try:
            content.decode("utf-8")
            return "text/csv"
        except UnicodeDecodeError:
            try:
                content.decode("latin-1")
                return "text/csv"
            except Exception:
                pass
    _fail(400, "Định dạng tệp không hợp lệ hoặc không được hỗ trợ. Chỉ hỗ trợ PNG, JPEG, WebP, PDF và CSV.")
    return "application/octet-stream"


def _verify_order_access(c, request_id: str, user: dict) -> dict:
    row = c.execute("SELECT * FROM custom_research_requests WHERE id = ?", (request_id,)).fetchone()
    if not row:
        _fail(404, f"Không tìm thấy yêu cầu nghiên cứu {request_id}")
    req = dict(row)
    is_owner = str(user.get("id")) == str(req.get("user_id"))
    is_admin = user.get("role") == "admin"
    if not (is_owner or is_admin):
        _fail(403, "Bạn không có quyền truy cập vào hồ sơ nghiên cứu riêng này.")
    return req


# --- Schemas ---

class RetailAnalysisRequestPayload(BaseModel):
    symbol: str = Field(default="XAUUSD", min_length=2, max_length=20)
    timeframe: str = Field(default="H1", min_length=2, max_length=5)
    period_bars: int = Field(default=100, ge=30, le=500)


class InstitutionalInquiryPayload(BaseModel):
    problem_description: Optional[str] = None
    hypothesis_prompt: Optional[str] = None
    symbols: Optional[List[str]] = None
    turnaround_hours: Optional[int] = 48
    client_notes: Optional[str] = None


class AdminQuotePayload(BaseModel):
    quoted_price_usd: float = Field(ge=0.0)
    scope_notes: Optional[str] = None


class AdminProposalPayload(BaseModel):
    research_question: Optional[str] = None
    deliverables: Optional[List[str]] = None
    turnaround_hours: Optional[int] = 48
    quoted_price_usd: float = Field(ge=0.0)
    scope_notes: Optional[str] = None


class ClientConfirmPayload(BaseModel):
    version: Optional[int] = None


class SandboxPayPayload(BaseModel):
    notes: Optional[str] = "Sandbox Test Payment"


class VerifyPaymentPayload(BaseModel):
    tx_hash: str = Field(min_length=6)


class ChatMessagePayload(BaseModel):
    message: str = Field(min_length=1, max_length=5000)


class AdminClosePayload(BaseModel):
    reason: Optional[str] = None


class CheckoutLockPayload(BaseModel):
    payment_network: str = Field(default="BEP20")


class AdminRerunPayload(BaseModel):
    reason: str = Field(min_length=3)


class AdminOverrideStatusPayload(BaseModel):
    new_status: str
    reason: str = Field(min_length=3)


class AdminApprovePayload(BaseModel):
    run_id: Optional[str] = None


def detect_proposal_ambiguities(desc: str, symbols: List[str]) -> List[str]:
    ambiguities = []
    desc_clean = (desc or "").strip().lower()
    if len(desc_clean) < 40:
        ambiguities.append("Mô tả bài toán còn ngắn gọn, cần làm rõ giả thuyết hoặc cơ chế tác động mong muốn.")
    if not symbols or symbols == ["XAUUSD", "EURUSD", "USDJPY"]:
        ambiguities.append("Khách hàng chưa chỉ định danh mục tài sản riêng (đang dùng rổ mặc định Vàng & FX).")
    if not any(k in desc_clean for k in ["ngày", "tháng", "năm", "kỳ", "phiên", "cpi", "fomc", "nfp", "window", "event"]):
        ambiguities.append("Chưa chỉ định rõ mốc thời gian hoặc sự kiện kích hoạt cụ thể cần đo lường.")
    return ambiguities


def _log_audit_action(
    c,
    request_id: str,
    operator_id: str,
    operator_role: str,
    action: str,
    reason: Optional[str] = None,
    details: Optional[dict] = None,
) -> None:
    now_ts = time.time()
    log_id = f"cral_{uuid.uuid4().hex[:12]}"
    c.execute(
        """
        INSERT INTO custom_research_audit_logs (
            id, request_id, operator_id, operator_role, action, reason, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            log_id,
            request_id,
            str(operator_id),
            str(operator_role),
            action,
            reason,
            json.dumps(details or {}, ensure_ascii=False) if details else None,
            now_ts,
        ),
    )


# --- Candle Helper for Retail Requests ---

def _load_candles_for_symbol(symbol: str, timeframe: str) -> List[Candle]:
    sym_u = symbol.strip().upper()
    tf_u = timeframe.strip().upper()

    candles: List[Candle] = []

    if "EUR" in sym_u:
        p = Path("data/eurusd_h1_yahoo.json")
        if p.exists():
            try:
                raw_list = json.loads(p.read_text(encoding="utf-8"))
                h1_candles = [Candle(time=int(c["time"]), open=float(c["open"]), high=float(c["high"]), low=float(c["low"]), close=float(c["close"]), volume=float(c.get("volume", 0))) for c in raw_list]
                if tf_u == "H4":
                    candles = resample_candles(h1_candles, "H4")
                else:
                    candles = h1_candles
            except Exception as e:
                logger.warning("Error loading EURUSD candles: %s", e)
    elif "GC" in sym_u or sym_u == "GC=F":
        # COMEX Gold Futures
        p = Path("data/xauusd_gcf_m15_historical.json")
        if p.exists():
            try:
                raw_list = json.loads(p.read_text(encoding="utf-8"))
                m15_candles = [Candle(time=int(c["time"]), open=float(c["open"]), high=float(c["high"]), low=float(c["low"]), close=float(c["close"]), volume=float(c.get("volume", 0))) for c in raw_list]
                candles = resample_candles(m15_candles, tf_u)
            except Exception as e:
                logger.warning("Error loading COMEX Gold candles: %s", e)
    elif "XAU" in sym_u or "GOLD" in sym_u:
        # Spot Gold (XAU/USD) - strictly use spot market candle feed
        p = Path("data/candles_xauusd_m15.json")
        if p.exists():
            try:
                raw_list = json.loads(p.read_text(encoding="utf-8"))
                m15_candles = [Candle(time=int(c["time"]), open=float(c["open"]), high=float(c["high"]), low=float(c["low"]), close=float(c["close"]), volume=float(c.get("volume", 0))) for c in raw_list]
                candles = resample_candles(m15_candles, tf_u)
            except Exception as e:
                logger.warning("Error loading Spot Gold candles: %s", e)
    elif "JPY" in sym_u:
        # USDJPY: only enable when valid closed candles source file exists
        p = Path("data/usdjpy_h1.json")
        if p.exists():
            try:
                raw_list = json.loads(p.read_text(encoding="utf-8"))
                h1_candles = [Candle(time=int(c["time"]), open=float(c["open"]), high=float(c["high"]), low=float(c["low"]), close=float(c["close"]), volume=float(c.get("volume", 0))) for c in raw_list]
                candles = resample_candles(h1_candles, tf_u) if tf_u == "H4" else h1_candles
            except Exception as e:
                logger.warning("Error loading USDJPY candles: %s", e)

    # Strictly use real historical closed candles. Synthetic math.sin() candles are prohibited.
    # If candle data is missing, returns [] which cleanly triggers INSUFFICIENT_DATA and halts PDF delivery.
    return candles


# --- Product Line A: Retail Technical Analysis Endpoints ---

@router.post("/api/v1/research/retail/request")
def execute_retail_technical_analysis(
    payload: RetailAnalysisRequestPayload,
    user: dict = Depends(get_current_user),
):
    """Client initiates on-demand technical analysis note.
    Runs quantitative engine on closed candles, creates private 2-4 page mobile PDF note, and saves deliverable.
    """
    sym_u = payload.symbol.strip().upper()
    tf_u = payload.timeframe.strip().upper()

    candles = _load_candles_for_symbol(sym_u, tf_u)

    user_email = user.get("email", "client@zupirus.com")
    result = run_retail_technical_analysis(
        symbol=sym_u,
        timeframe=tf_u,
        candles=candles,
        period_bars=payload.period_bars,
    )

    req_id = f"crr_ret_{uuid.uuid4().hex[:10]}"
    now_ts = time.time()

    if result.status == "INSUFFICIENT_DATA" or len(candles) < 30:
        pdf_path = None
        download_url = None
        status_str = "INSUFFICIENT_DATA"
        step_str = "NEEDS_DATA"
        next_action = "Nguồn dữ liệu nến cho mã này chưa đủ hoặc chưa có. Vui lòng chọn mã khác (XAUUSD, EURUSD)."
    else:
        pdf_bytes = generate_retail_pdf(result, watermark=user_email)
        deliverables_dir = get_private_reports_dir() / "retail_notes"
        deliverables_dir.mkdir(parents=True, exist_ok=True)
        pdf_filename = f"retail_note_{sym_u}_{tf_u}_{result.run_id}.pdf"
        p_file = deliverables_dir / pdf_filename
        p_file.write_bytes(pdf_bytes)
        pdf_path = str(p_file)
        download_url = f"/api/v1/research/orders/{req_id}/download-pdf"
        status_str = "COMPLETED"
        step_str = "DELIVERED"
        next_action = "Tải bản ghi chú PDF chuyên sâu"

    with tx() as c:
        c.execute(
            """
            INSERT INTO custom_research_requests (
                id, user_id, client_email, product_type, symbol, timeframe, period_bars,
                hypothesis_prompt, symbols_json, turnaround_hours, quoted_price_usd,
                scope_notes, status, run_id, deliverable_report_id, deliverable_version,
                deliverable_pdf_path, deliverable_bundle_path, delivered_run_id, delivered_pdf_path,
                current_step, next_action_vi, created_at, updated_at
            ) VALUES (?, ?, ?, 'RETAIL_ANALYSIS', ?, ?, ?, ?, ?, 0, 0.0, ?, ?, ?, ?, 'v1.0', ?, NULL, ?, ?, ?, ?, ?, ?)
            """,
            (
                req_id,
                user["id"],
                user_email,
                sym_u,
                tf_u,
                payload.period_bars,
                f"Phân tích kỹ thuật tự động {sym_u} khung {tf_u}",
                json.dumps([sym_u]),
                f"Bản phân tích kỹ thuật cá nhân định lượng {sym_u} {tf_u}",
                status_str,
                result.run_id,
                f"rep_retail_{result.run_id}",
                pdf_path,
                result.run_id if status_str == "COMPLETED" else None,
                pdf_path if status_str == "COMPLETED" else None,
                step_str,
                next_action,
                now_ts,
                now_ts,
            ),
        )

    return {
        "ok": True,
        "request_id": req_id,
        "run_id": result.run_id,
        "symbol": sym_u,
        "timeframe": tf_u,
        "cutoff_time_utc": result.cutoff_time_utc,
        "status": result.status,
        "bias": result.bias,
        "bias_display_vi": result.bias_display_vi,
        "confidence_pct": result.confidence_pct,
        "current_price": result.current_price,
        "invalidation_level": result.invalidation_level,
        "support_zone": result.support_zone,
        "resistance_zone": result.resistance_zone,
        "thesis_summary_vi": result.thesis_summary_vi,
        "action_plan_vi": result.action_plan_vi,
        "download_pdf_url": download_url,
    }


# --- Product Line B: Institutional Custom Macro Research Endpoints ---

@router.post("/api/v1/research/institutional/inquiry")
def submit_institutional_inquiry(
    payload: InstitutionalInquiryPayload,
    user: dict = Depends(get_current_user),
):
    """Client submits an institutional quantitative research inquiry / RFP.
    Can be submitted with JUST a problem description.
    Opens a conversation thread, auto-generates a draft scope proposal, and posts an initial agent response.
    """
    desc = (payload.problem_description or payload.hypothesis_prompt or "").strip()
    if len(desc) < 5:
        _fail(400, "Vui lòng mô tả vấn đề cần giải quyết hoặc rủi ro Quý khách đang quan tâm.")

    desc_l = desc.lower()
    is_boj_usdjpy = any(k in desc_l for k in ("boj", "ngân hàng trung ương nhật", "lãi suất boj", "usdjpy", "usd/jpy", "yên nhật"))
    has_greeting = bool(re.search(r'\b(chào|hello|hi)\b', desc_l))
    has_help = any(term in desc_l for term in ("cần hỗ trợ", "can ho tro", "hỗ trợ", "tư vấn", "test", "help"))
    is_generic = (len(desc) < 20 or has_greeting or has_help) and not is_boj_usdjpy

    init_status = "NEEDS_CLARIFICATION" if is_generic else "PENDING_QUOTE"
    init_step = "NEEDS_DATA" if is_generic else "PROPOSAL_PENDING"
    init_act_cat = "ACTIONABLE" if is_generic else "WAITING_ADMIN"
    init_waiting_reason = "Bài toán còn khái quát, cần làm rõ phạm vi sự kiện, rổ tài sản và câu hỏi nghiên cứu" if is_generic else "Chờ ban quản trị rà soát và gửi đề xuất chính thức"

    req_id = f"crr_{uuid.uuid4().hex[:12]}"
    now_ts = time.time()
    user_email = user.get("email", "institutional_client@zupirus.com")

    symbols_clean = [s.strip().upper() for s in (payload.symbols or []) if s.strip()]
    if not symbols_clean:
        found_symbols = []
        desc_u = desc.upper()
        if any(k in desc_u for k in ("XAU", "VÀNG", "GOLD")):
            found_symbols.append("XAUUSD")
        if "EUR" in desc_u:
            found_symbols.append("EURUSD")
        if is_boj_usdjpy or any(k in desc_u for k in ("JPY", "YÊN", "BOJ")):
            found_symbols.append("USDJPY")

        if found_symbols:
            symbols_clean = found_symbols
        elif is_generic:
            symbols_clean = []
        else:
            symbols_clean = ["XAUUSD", "EURUSD"]

    primary_symbol = symbols_clean[0] if symbols_clean else "STUDY"
    turnaround = payload.turnaround_hours or 48

    # Agent proposal drafting - verify data coverage without assuming VALIDATED
    if is_generic:
        draft_proposal = {
            "version": 1,
            "research_question": "Cần làm rõ bài toán nghiên cứu từ khách hàng",
            "recommended_symbols": [],
            "recommended_event": "Chưa xác định (cần làm rõ mục tiêu)",
            "study_windows": ["Chờ làm rõ"],
            "data_availability": "NEEDS_CLARIFICATION (Chưa đủ thông tin để kiểm tra độ phủ dữ liệu)",
            "deliverables": [
                "Báo cáo nghiên cứu độc quyền PDF chuyên sâu (20+ trang)",
                "Nhật ký mô phỏng giao dịch chi tiết (trades_ledger.csv)",
                "Bộ chỉ số định lượng & suy diễn thống kê (metrics.json)",
                "Bộ công cụ tái lập độc lập offline (replay.py & QUICKSTART.md)",
                "Bảng kê mã băm mật mã chứng minh tính toàn vẹn (MANIFEST.sha256)",
            ],
            "turnaround_hours": turnaround,
            "suggested_price_usd": 0.0,
        }
        welcome_msg = (
            f"Chào Quý khách! ZUPIRUS Quant Lab đã tiếp nhận yêu cầu: **\"{desc}\"**.\n\n"
            f"Hiện tại mô tả bài toán còn khái quát ([NEEDS_CLARIFICATION]). Để ban quản trị và desk định lượng xây dựng đề xuất và báo giá chính xác, Quý khách vui lòng làm rõ thêm:\n"
            f"1. **Mục tiêu nghiên cứu**: Bạn muốn kiểm định tác động của sự kiện vĩ mô nào (ví dụ: CPI Surprise, FOMC, NFP, lãi suất)?\n"
            f"2. **Tài sản trọng tâm**: Bạn quan tâm chủ yếu đến Kim loại quý (Vàng XAUUSD / COMEX GC=F), Ngoại hối (EURUSD) hay rổ tài sản khác?\n"
            f"3. **Khung thời gian & kỳ vọng**: Kỳ vọng giữ vị thế ngắn hạn trong ngày (Intraday) hay nhiều tuần (Swing/Position)?\n\n"
            f"Quý khách có thể trả lời trực tiếp tại khung chat này hoặc đính kèm tài liệu mô tả để Admin phản hồi."
        )
    elif is_boj_usdjpy:
        data_status = "INSUFFICIENT_DATA (Hệ thống chưa có tệp nến USDJPY cho chuỗi sự kiện BoJ/Lãi suất)"
        draft_proposal = {
            "version": 1,
            "research_question": f"Khảo nghiệm định lượng tác động: {desc[:120]}",
            "recommended_symbols": ["USDJPY"],
            "recommended_event": "Quyết định lãi suất BoJ & Chính sách tiền tệ Yên Nhật",
            "study_windows": ["1 phiên (Intraday)", "5 phiên (Swing)", "20 phiên (Position)"],
            "data_availability": data_status,
            "deliverables": [
                "Báo cáo nghiên cứu độc quyền PDF chuyên sâu (20+ trang)",
                "Nhật ký mô phỏng giao dịch chi tiết (trades_ledger.csv)",
                "Bộ chỉ số định lượng & suy diễn thống kê (metrics.json)",
                "Bộ công cụ tái lập độc lập offline (replay.py & QUICKSTART.md)",
                "Bảng kê mã băm mật mã chứng minh tính toàn vẹn (MANIFEST.sha256)",
            ],
            "turnaround_hours": turnaround,
            "suggested_price_usd": 10000.0,
        }
        welcome_msg = (
            f"Chào Quý khách! ZUPIRUS Quant Lab đã tiếp nhận bài toán nghiên cứu:\n"
            f"**\"{desc}\"**\n\n"
            f"Hệ thống đã nhận diện bài toán chuyên sâu về Ngân hàng Trung ương Nhật Bản (BoJ) & tỷ giá USDJPY (v1):\n"
            f"- **Câu hỏi kiểm định**: {draft_proposal['research_question']}\n"
            f"- **Tài sản trọng tâm**: USDJPY\n"
            f"- **Cửa sổ so sánh**: 1 phiên, 5 phiên, 20 phiên sau sự kiện\n"
            f"- **Độ phủ dữ liệu**: {data_status}\n"
            f"- **Bộ sản phẩm bàn giao**: Báo cáo PDF chuyên sâu, Ledger CSV, Metrics JSON, Bộ Replay CLI độc lập và Manifest SHA-256.\n\n"
            f"Hiện tại hệ thống chưa có sẵn tệp nến USDJPY cho chuỗi sự kiện này. Quý khách có thể gửi thêm tệp dữ liệu tại khung chat này hoặc đợi ban quản trị thu nạp nến để gửi báo giá chính thức."
        )
    else:
        has_jpy = any("JPY" in s for s in symbols_clean)
        data_status = "PARTIAL_DATA (EURUSD & XAUUSD khả dụng; USDJPY cần nạp tệp nến)" if has_jpy else "DATA_AVAILABLE (Nguồn dữ liệu EURUSD H1 / XAUUSD M15 khả dụng)"
        draft_proposal = {
            "version": 1,
            "research_question": f"Khảo nghiệm định lượng tác động: {desc[:120]}",
            "recommended_symbols": symbols_clean,
            "recommended_event": "Phản ứng vĩ mô / CPI Surprise & Chính sách tiền tệ",
            "study_windows": ["1 phiên (Intraday)", "5 phiên (Swing)", "20 phiên (Position)"],
            "data_availability": data_status,
            "deliverables": [
                "Báo cáo nghiên cứu độc quyền PDF chuyên sâu (20+ trang)",
                "Nhật ký mô phỏng giao dịch chi tiết (trades_ledger.csv)",
                "Bộ chỉ số định lượng & suy diễn thống kê (metrics.json)",
                "Bộ công cụ tái lập độc lập offline (replay.py & QUICKSTART.md)",
                "Bảng kê mã băm mật mã chứng minh tính toàn vẹn (MANIFEST.sha256)",
            ],
            "turnaround_hours": turnaround,
            "suggested_price_usd": 10000.0,
        }
        welcome_msg = (
            f"Chào Quý khách! ZUPIRUS Quant Lab đã tiếp nhận bài toán nghiên cứu:\n"
            f"**\"{desc}\"**\n\n"
            f"Hệ thống đã chuẩn bị bản thảo đề xuất sơ bộ (v1):\n"
            f"- **Câu hỏi kiểm định**: {draft_proposal['research_question']}\n"
            f"- **Rổ tài sản khảo nghiệm**: {', '.join(symbols_clean)}\n"
            f"- **Cửa sổ so sánh**: 1 phiên, 5 phiên, 20 phiên sau sự kiện\n"
            f"- **Độ phủ dữ liệu**: {data_status}\n"
            f"- **Bộ sản phẩm bàn giao**: Báo cáo PDF chuyên sâu, Ledger CSV, Metrics JSON, Bộ Replay CLI độc lập và Manifest SHA-256.\n\n"
            f"Quý khách có thể gửi thêm tài liệu, file dữ liệu hoặc đặt câu hỏi trực tiếp tại khung chat này. "
            f"Ban quản trị sẽ xem xét và gửi báo giá / đề xuất chính thức tới Quý khách."
        )

    with tx() as c:
        c.execute(
            """
            INSERT INTO custom_research_requests (
                id, user_id, client_email, product_type, symbol, timeframe, period_bars,
                hypothesis_prompt, problem_description, symbols_json, turnaround_hours, quoted_price_usd,
                scope_notes, status, run_id, deliverable_report_id, deliverable_version,
                deliverable_pdf_path, deliverable_bundle_path, proposal_version, proposal_details_json,
                current_step, action_category, waiting_reason_vi, next_action_vi, created_at, updated_at
            ) VALUES (?, ?, ?, 'INSTITUTIONAL_RESEARCH', ?, 'MACRO_EVENT', 20, ?, ?, ?, ?, 0.0, ?, ?, NULL, NULL, 'v1.0', NULL, NULL, 1, ?, ?, ?, ?, 'Chờ ban quản trị rà soát và gửi đề xuất chính thức', ?, ?)
            """,
            (
                req_id,
                user["id"],
                user_email,
                primary_symbol,
                desc,
                desc,
                json.dumps(symbols_clean),
                turnaround,
                payload.client_notes,
                init_status,
                json.dumps(draft_proposal, ensure_ascii=False),
                init_step,
                init_act_cat,
                init_waiting_reason,
                now_ts,
                now_ts,
            ),
        )

        # Insert initial AI assistant welcome message into order chat
        msg_id = f"msg_{uuid.uuid4().hex[:10]}"
        c.execute(
            """
            INSERT INTO custom_research_messages (
                id, request_id, sender_id, sender_role, sender_name, message,
                attachment_path, attachment_name, attachment_type, attachment_size,
                is_read_by_admin, is_read_by_client, created_at
            ) VALUES (?, ?, 'system_ai', 'ai_assistant', 'ZUPIRUS AI Quant Desk', ?, NULL, NULL, NULL, NULL, 0, 1, ?)
            """,
            (msg_id, req_id, welcome_msg, now_ts),
        )

    return {
        "ok": True,
        "request_id": req_id,
        "status": init_status,
        "current_step": init_step,
        "message": "Yêu cầu nghiên cứu tổ chức đã được tiếp nhận. Cuộc trao đổi đã được mở và đề xuất sơ bộ đã sẵn sàng.",
        "hypothesis_prompt": desc,
        "symbols": symbols_clean,
        "turnaround_hours": turnaround,
        "draft_proposal": draft_proposal,
    }


@router.post("/api/v1/research/institutional/{request_id}/confirm")
def confirm_institutional_quote(
    request_id: str,
    payload: Optional[ClientConfirmPayload] = None,
    user: dict = Depends(get_current_user),
):
    """Client confirms the quoted price and authorizes study execution.
    Checks proposal version to avoid confirming outdated quotes.
    If price > 0, moves to WAITING_PAYMENT so commercial study is only executed after verified payment.
    """
    now_ts = time.time()
    with tx() as c:
        req = _verify_order_access(c, request_id, user)

        current_ver = int(req.get("proposal_version") or 1)
        if payload and payload.version is not None and payload.version != current_ver:
            _fail(400, f"Đề xuất đã có phiên bản mới (v{current_ver}). Vui lòng xem và xác nhận phiên bản mới nhất.")

        quoted_price = float(req.get("quoted_price_usd") or 0.0)
        pay_status = req.get("payment_status", "UNPAID")

        if quoted_price > 0 and pay_status != "PAID":
            new_status = "WAITING_PAYMENT"
            next_step = "PAYMENT_PENDING"
            act_cat = "WAITING_CLIENT"
            next_act = "Khách hàng thực hiện thanh toán USDT theo báo giá đã xác nhận"
            waiting_reason = f"Đã chấp nhận đề xuất v{current_ver}. Đang chờ thanh toán USDT (${quoted_price:,.2f})"
            conf_msg = f"Khách hàng ({user.get('email')}) đã chấp nhận đề xuất nghiên cứu phiên bản v{current_ver} (${quoted_price:,.2f} USD). Vui lòng hoàn tất thanh toán để hệ thống xếp lịch chạy."
        else:
            new_status = "CONFIRMED"
            next_step = "CONFIRMED"
            act_cat = "RUNNING"
            next_act = "Chờ ban quản trị bấm Chạy nghiên cứu"
            waiting_reason = "Đã xác nhận đơn. Sẵn sàng thực thi nghiên cứu"
            conf_msg = f"Khách hàng ({user.get('email')}) đã xác nhận đề xuất nghiên cứu phiên bản v{current_ver}. Đơn hàng đã sẵn sàng để thực thi."

        c.execute(
            """
            UPDATE custom_research_requests
            SET status = ?, client_confirmed_version = ?, current_step = ?,
                action_category = ?, waiting_reason_vi = ?, next_action_vi = ?, updated_at = ?
            WHERE id = ?
            """,
            (new_status, current_ver, next_step, act_cat, waiting_reason, next_act, now_ts, request_id),
        )

        c.execute(
            """
            INSERT INTO custom_research_messages (
                id, request_id, sender_id, sender_role, sender_name, message,
                is_read_by_admin, is_read_by_client, created_at
            ) VALUES (?, ?, ?, 'client', ?, ?, 0, 1, ?)
            """,
            (f"msg_{uuid.uuid4().hex[:10]}", request_id, user["id"], user.get("email"), conf_msg, now_ts),
        )

    _broadcast_chat_message(request_id, {"event": "status_changed", "status": new_status, "current_step": next_step})

    return {
        "ok": True,
        "request_id": request_id,
        "status": new_status,
        "current_step": next_step,
        "confirmed_version": current_ver,
        "message": f"Đã xác nhận đề xuất nghiên cứu thành công (Trạng thái: {new_status}).",
    }


@router.post("/api/v1/research/orders/{request_id}/checkout-lock")
def checkout_lock_research_request(
    request_id: str,
    payload: CheckoutLockPayload,
    user: dict = Depends(get_current_user),
):
    """Lock checkout parameters for USDT payment.
    Requires client to have confirmed current proposal version.
    Saves immutable checkout record with distinct checkout_id, deposit address, and 24h expiration.
    Handles idempotent locks and quotes changing cleanly.
    """
    net = payload.payment_network.strip().upper()
    if net not in ("BEP20", "TRC20"):
        _fail(400, "Mạng thanh toán không hợp lệ. Chỉ hỗ trợ BEP20 hoặc TRC20.")

    now_ts = time.time()
    with tx() as c:
        req = _verify_order_access(c, request_id, user)
        price = float(req.get("quoted_price_usd") or 0.0)
        if price <= 0:
            _fail(400, "Hồ sơ chưa có báo giá chính thức. Vui lòng chờ đề xuất từ Ban Quản Trị.")

        if req.get("payment_status") == "PAID":
            _fail(400, "Hồ sơ nghiên cứu này đã được thanh toán.")

        client_conf_ver = req.get("client_confirmed_version")
        current_ver = int(req.get("proposal_version") or 1)
        if not client_conf_ver or int(client_conf_ver) != current_ver:
            _fail(400, f"Vui lòng chấp nhận đề xuất nghiên cứu chính thức phiên bản v{current_ver} trước khi tạo lệnh thanh toán.")

        cfg = get_crypto_wallets_config(c)
        if net == "BEP20":
            wallet_addr = (cfg.get("bep20_address") or cfg.get("usdt_bep20_address") or "").strip()
        else:
            wallet_addr = (cfg.get("trc20_address") or cfg.get("usdt_trc20_address") or "").strip()

        if not wallet_addr or not validate_crypto_address(wallet_addr, net):
            _fail(400, f"Hệ thống chưa cấu hình địa chỉ ví nhận USDT {net} hợp lệ. Vui lòng liên hệ Ban Quản Trị.")

        # Check existing active checkout for idempotency
        existing_chk = c.execute(
            """
            SELECT id, expires_at FROM custom_research_checkouts
            WHERE request_id = ? AND proposal_version = ? AND payment_network = ? AND status = 'PENDING' AND expires_at > ?
            ORDER BY created_at DESC LIMIT 1
            """,
            (request_id, current_ver, net, now_ts),
        ).fetchone()

        if existing_chk:
            chk_id = existing_chk[0]
            expires_at = float(existing_chk[1])
        else:
            # Supersede older pending checkouts for this request
            c.execute(
                "UPDATE custom_research_checkouts SET status = 'SUPERSEDED' WHERE request_id = ? AND status = 'PENDING'",
                (request_id,),
            )
            chk_id = f"chk_{uuid.uuid4().hex[:12]}"
            expires_at = now_ts + 86400  # 24h
            c.execute(
                """
                INSERT INTO custom_research_checkouts (
                    id, request_id, proposal_version, amount_usd, currency, payment_network,
                    deposit_address, status, expires_at, created_at
                ) VALUES (?, ?, ?, ?, 'USDT', ?, ?, 'PENDING', ?, ?)
                """,
                (chk_id, request_id, current_ver, price, net, wallet_addr, expires_at, now_ts),
            )

        c.execute(
            """
            UPDATE custom_research_requests
            SET checkout_id = ?, checkout_locked = 1, checkout_locked_at = ?, payment_network = ?, currency = 'USDT',
                checkout_proposal_version = ?, checkout_amount = ?, checkout_deposit_address = ?,
                checkout_expires_at = ?,
                status = 'WAITING_PAYMENT', current_step = 'PAYMENT_PENDING', action_category = 'WAITING_CLIENT',
                waiting_reason_vi = 'Đang chờ khách hàng thanh toán USDT', updated_at = ?
            WHERE id = ?
            """,
            (chk_id, now_ts, net, current_ver, price, wallet_addr, expires_at, now_ts, request_id),
        )

        _log_audit_action(
            c, request_id, str(user["id"]), user.get("role", "client"), "CHECKOUT_LOCKED",
            details={"checkout_id": chk_id, "network": net, "amount": price, "deposit_address": wallet_addr, "expires_at": expires_at}
        )

    return {
        "ok": True,
        "request_id": request_id,
        "checkout_id": chk_id,
        "checkout_locked": 1,
        "checkout_locked_at": now_ts,
        "payment_network": net,
        "currency": "USDT",
        "amount_usdt": price,
        "proposal_version": current_ver,
        "deposit_address": wallet_addr,
        "expires_at": expires_at,
        "expires_in_seconds": int(max(0, expires_at - now_ts)),
    }


@router.post("/api/v1/research/orders/{request_id}/sandbox-pay")
def sandbox_pay_research_request(
    request_id: str,
    payload: Optional[SandboxPayPayload] = None,
    user: dict = Depends(get_current_user),
):
    """Sandbox payment simulation for custom research order testing without real funds."""
    if not is_sandbox_allowed():
        _fail(403, "Cổng thanh toán thử nghiệm (Sandbox) bị khóa trên môi trường Production.")

    now_ts = time.time()
    with tx() as c:
        req = _verify_order_access(c, request_id, user)
        if req.get("payment_status") == "PAID":
            _fail(400, "Hồ sơ nghiên cứu này đã được thanh toán trước đó.")

        mock_tx = f"SANDBOX_TX_{uuid.uuid4().hex[:12].upper()}"
        mock_ord = f"ord_sb_{uuid.uuid4().hex[:8]}"

        chk_id = req.get("checkout_id")
        if chk_id:
            c.execute(
                "UPDATE custom_research_checkouts SET status = 'PAID', paid_at = ?, tx_hash = ? WHERE id = ?",
                (now_ts, mock_tx, chk_id),
            )

        c.execute(
            """
            UPDATE custom_research_requests
            SET payment_status = 'PAID', payment_order_id = ?, payment_tx_hash = ?,
                payment_confirmed_at = ?, status = 'CONFIRMED', current_step = 'CONFIRMED',
                action_category = 'RUNNING',
                waiting_reason_vi = 'Đã thanh toán (Sandbox). Hệ thống tự động xếp hàng đợi chạy',
                updated_at = ?
            WHERE id = ?
            """,
            (mock_ord, mock_tx, now_ts, now_ts, request_id),
        )

        _log_audit_action(
            c, request_id, str(user["id"]), user.get("role", "client"), "SANDBOX_PAYMENT", details={"tx_hash": mock_tx}
        )

        pay_msg = f"Đơn hàng đã được thanh toán thành công qua Sandbox Test (Mã TX: {mock_tx}). Trạng thái chuyển sang CONFIRMED và sẵn sàng chạy."
        c.execute(
            """
            INSERT INTO custom_research_messages (
                id, request_id, sender_id, sender_role, sender_name, message,
                is_read_by_admin, is_read_by_client, created_at
            ) VALUES (?, ?, ?, 'system', 'Hệ Thống Thanh Toán Sandbox', ?, 0, 1, ?)
            """,
            (f"msg_{uuid.uuid4().hex[:10]}", request_id, user["id"], pay_msg, now_ts),
        )

    _broadcast_chat_message(request_id, {"event": "status_changed", "status": "CONFIRMED", "payment_status": "PAID"})

    return {
        "ok": True,
        "request_id": request_id,
        "payment_status": "PAID",
        "tx_hash": mock_tx,
        "status": "CONFIRMED",
        "action_category": "RUNNING",
        "message": "Đã thanh toán Sandbox thành công.",
    }


@router.post("/api/v1/research/orders/{request_id}/verify-payment")
def verify_research_payment(
    request_id: str,
    payload: VerifyPaymentPayload,
    user: dict = Depends(get_current_user),
):
    """Verify payment transaction for custom research order with duplication & timeout protection."""
    now_ts = time.time()
    clean_tx = payload.tx_hash.strip()
    if not clean_tx:
        _fail(400, "Vui lòng nhập mã giao dịch on-chain (TxHash).")

    with tx() as c:
        req = _verify_order_access(c, request_id, user)

        if req.get("payment_status") == "PAID":
            _fail(400, "Hồ sơ nghiên cứu này đã được đối soát thanh toán trước đó.")

        # 1. Check duplicate tx_hash in custom_research_requests
        dup_req = c.execute(
            "SELECT id FROM custom_research_requests WHERE payment_tx_hash = ? AND id != ? AND payment_status = 'PAID'",
            (clean_tx, request_id),
        ).fetchone()
        if dup_req:
            _fail(409, f"Mã giao dịch (TX hash) này đã được xác nhận cho hồ sơ nghiên cứu {dup_req['id']}.")

        # 2. Check duplicate tx_hash in legacy orders table (do NOT swallow error)
        dup_ord = c.execute(
            "SELECT id FROM orders WHERE tx_hash = ? AND status = 'PAID'",
            (clean_tx,),
        ).fetchone()
        if dup_ord:
            _fail(409, f"Mã giao dịch (TX hash) này đã được đối soát cho đơn mua trước đó {dup_ord['id']}.")

        # 3. Check duplicate in custom_research_checkouts
        dup_chk = c.execute(
            "SELECT id, request_id FROM custom_research_checkouts WHERE tx_hash = ? AND status = 'PAID' AND request_id != ?",
            (clean_tx, request_id),
        ).fetchone()
        if dup_chk:
            _fail(409, f"Mã giao dịch (TX hash) này đã được ghi nhận cho thanh toán {dup_chk['id']} thuộc hồ sơ {dup_chk['request_id']}.")

        # 4. Check version match
        lock_ver = req.get("checkout_proposal_version")
        curr_ver = int(req.get("proposal_version") or 1)
        if lock_ver and int(lock_ver) != curr_ver:
            _fail(400, f"Báo giá đã thay đổi sang phiên bản v{curr_ver}. Vui lòng tạo lệnh thanh toán mới cho phiên bản này.")

        # 5. Check expiration
        expires_at = req.get("checkout_expires_at")
        if expires_at and now_ts > float(expires_at):
            _fail(400, "Lệnh thanh toán đã hết hạn (24 giờ). Vui lòng tạo lại yêu cầu thanh toán.")

        # 6. Check sandbox in production vs on-chain verification
        is_test_tx = clean_tx.startswith("SANDBOX_") or clean_tx.startswith("0xTEST_") or clean_tx.startswith("TEST_")
        if is_test_tx:
            if not is_sandbox_allowed():
                _fail(403, "Mã giao dịch thử nghiệm (Sandbox / Test) bị chặn trên môi trường Production.")
        else:
            net = (req.get("payment_network") or "TRC20").strip().upper()
            dest_wallet = (req.get("checkout_deposit_address") or "").strip()
            expected_amt = float(req.get("checkout_amount") or req.get("quoted_price_usd") or 0.0)
            if not dest_wallet:
                _fail(400, "Chưa xác định được ví nhận thanh toán hợp lệ của đơn hàng này. Vui lòng tạo lại lệnh thanh toán.")

            if net == "TRC20":
                valid, vmsg, tx_info = verify_trc20_transaction(clean_tx, dest_wallet, expected_amt)
            elif net == "BEP20":
                valid, vmsg, tx_info = verify_bep20_transaction(clean_tx, dest_wallet, expected_amt)
            else:
                _fail(400, f"Mạng thanh toán {net} không được hỗ trợ.")

            if not valid:
                _fail(400, f"Xác minh on-chain thất bại: {vmsg}")

            # Verify transaction timestamp if available
            tx_time = (tx_info or {}).get("timestamp")
            lock_time = float(req.get("checkout_locked_at") or 0.0)
            if tx_time and lock_time and tx_time < (lock_time - 3600):
                _fail(400, "Giao dịch on-chain này xảy ra trước thời điểm tạo lệnh thanh toán của hồ sơ.")

        # Update checkout record
        chk_id = req.get("checkout_id")
        if chk_id:
            c.execute(
                "UPDATE custom_research_checkouts SET status = 'PAID', paid_at = ?, tx_hash = ? WHERE id = ?",
                (now_ts, clean_tx, chk_id),
            )

        c.execute(
            """
            UPDATE custom_research_requests
            SET payment_status = 'PAID', payment_tx_hash = ?, payment_confirmed_at = ?,
                status = 'CONFIRMED', current_step = 'CONFIRMED', action_category = 'RUNNING',
                waiting_reason_vi = 'Đã đối soát thanh toán. Hệ thống tự động xếp hàng đợi chạy',
                updated_at = ?
            WHERE id = ? AND payment_status != 'PAID'
            """,
            (clean_tx, now_ts, now_ts, request_id),
        )

        _log_audit_action(
            c, request_id, str(user["id"]), user.get("role", "client"), "PAYMENT_VERIFIED",
            details={"tx_hash": clean_tx, "network": req.get("payment_network"), "amount": req.get("quoted_price_usd")}
        )

        conf_msg = f"Thanh toán USDT on-chain đã được đối soát thành công (TX: {clean_tx}). Hệ thống tự động chuyển hồ sơ vào hàng đợi thực thi."
        c.execute(
            """
            INSERT INTO custom_research_messages (
                id, request_id, sender_id, sender_role, sender_name, message,
                is_read_by_admin, is_read_by_client, created_at
            ) VALUES (?, ?, ?, 'system', 'Hệ Thống Đối Soát USDT', ?, 0, 1, ?)
            """,
            (f"msg_{uuid.uuid4().hex[:10]}", request_id, user["id"], conf_msg, now_ts),
        )

    _broadcast_chat_message(request_id, {"event": "status_changed", "status": "CONFIRMED", "payment_status": "PAID"})

    return {
        "ok": True,
        "request_id": request_id,
        "payment_status": "PAID",
        "tx_hash": clean_tx,
        "status": "CONFIRMED",
        "action_category": "RUNNING",
        "message": "Đối soát giao dịch thành công. Hồ sơ đã sẵn sàng chạy.",
    }


# --- Client & Shared Order Query Endpoints ---

@router.get("/api/v1/research/my-requests")
def list_my_research_requests(user: dict = Depends(get_current_user)):
    """List all custom research requests submitted by the logged in user."""
    with tx() as c:
        rows = c.execute(
            """
            SELECT * FROM custom_research_requests
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (user["id"],),
        ).fetchall()

        results = []
        for r in rows:
            d = dict(r)
            d["symbols"] = json.loads(d.get("symbols_json") or "[]")
            if d.get("proposal_details_json"):
                try:
                    d["proposal_details"] = json.loads(d["proposal_details_json"])
                except Exception:
                    d["proposal_details"] = None
            unread = c.execute(
                "SELECT COUNT(*) FROM custom_research_messages WHERE request_id = ? AND is_read_by_client = 0",
                (d["id"],),
            ).fetchone()
            d["unread_messages_count"] = unread[0] if unread else 0
            results.append(d)

    return {"ok": True, "items": results, "requests": results, "count": len(results)}


@router.get("/api/v1/research/my-inbox")
def client_research_inbox(user: dict = Depends(get_current_user)):
    """Client Inbox: List all client orders with latest message and unread count."""
    with tx() as c:
        rows = c.execute(
            """
            SELECT crr.id, crr.client_email, crr.product_type, crr.symbol, crr.status, crr.current_step,
                   crr.updated_at,
                   COUNT(CASE WHEN crm.is_read_by_client = 0 THEN 1 END) as unread_count,
                   (SELECT message FROM custom_research_messages WHERE request_id = crr.id ORDER BY created_at DESC LIMIT 1) as last_message,
                   (SELECT created_at FROM custom_research_messages WHERE request_id = crr.id ORDER BY created_at DESC LIMIT 1) as last_message_at
            FROM custom_research_requests crr
            LEFT JOIN custom_research_messages crm ON crm.request_id = crr.id
            WHERE crr.user_id = ?
            GROUP BY crr.id
            ORDER BY last_message_at DESC NULLS LAST, crr.updated_at DESC
            """,
            (user["id"],),
        ).fetchall()

        inbox_items = [dict(r) for r in rows]

    return {"ok": True, "inbox": inbox_items, "count": len(inbox_items)}


@router.get("/api/v1/research/orders/{request_id}")
def get_research_order_detail(
    request_id: str,
    user: dict = Depends(get_current_user),
):
    """Retrieve full detail for a custom research order.
    Client response only exposes safe metadata and sanitized download URLs,
    keeping internal system paths, audit logs, and unapproved runs strictly within admin scope.
    """
    is_admin = user.get("role") == "admin"
    with tx() as c:
        req = _verify_order_access(c, request_id, user)
        req["symbols"] = json.loads(req.get("symbols_json") or "[]")
        if req.get("proposal_details_json"):
            try:
                req["proposal_details"] = json.loads(req["proposal_details_json"])
            except Exception:
                req["proposal_details"] = None

        req["can_sandbox_pay"] = is_sandbox_allowed()
        req["can_download_pdf"] = bool(req.get("delivered_pdf_path")) if req.get("product_type") == "INSTITUTIONAL_RESEARCH" else bool(req.get("deliverable_pdf_path"))
        req["can_download_bundle"] = bool(req.get("delivered_bundle_path")) if req.get("product_type") == "INSTITUTIONAL_RESEARCH" else bool(req.get("deliverable_bundle_path"))
        req["download_pdf_url"] = f"/api/v1/research/orders/{request_id}/download-pdf"
        req["download_bundle_url"] = f"/api/v1/research/orders/{request_id}/download-bundle"

        # Fetch attachments
        att_rows = c.execute(
            "SELECT * FROM custom_research_attachments WHERE request_id = ? ORDER BY created_at ASC",
            (request_id,),
        ).fetchall()
        attachments = []
        for a in att_rows:
            ad = dict(a)
            if not is_admin:
                ad.pop("stored_path", None)
            ad["download_url"] = f"/api/v1/research/orders/{request_id}/attachments/{ad['id']}/download"
            attachments.append(ad)
        req["attachments"] = attachments

        # Fetch runs
        run_rows = c.execute(
            "SELECT * FROM custom_research_runs WHERE request_id = ? ORDER BY run_number ASC",
            (request_id,),
        ).fetchall()

        if is_admin:
            req["runs"] = [dict(r) for r in run_rows]
            # Fetch audit logs (admin-only)
            log_rows = c.execute(
                "SELECT * FROM custom_research_audit_logs WHERE request_id = ? ORDER BY created_at DESC",
                (request_id,),
            ).fetchall()
            req["audit_logs"] = [dict(l) for l in log_rows]
        else:
            # Client only sees approved deliverable runs without raw server disk paths
            req["runs"] = [dict(r) for r in run_rows if r.get("is_approved") == 1]
            for r in req["runs"]:
                r.pop("deliverable_pdf_path", None)
                r.pop("deliverable_bundle_path", None)
            req["audit_logs"] = []
            req.pop("deliverable_pdf_path", None)
            req.pop("deliverable_bundle_path", None)
            req.pop("delivered_pdf_path", None)
            req.pop("delivered_bundle_path", None)

    return {"ok": True, "order": req}


# --- Real-Time Chat & Attachments Endpoints ---

@router.get("/api/v1/research/orders/{request_id}/messages")
def get_order_messages(
    request_id: str,
    since_ts: Optional[float] = Query(None, description="Fetch messages created after this timestamp"),
    user: dict = Depends(get_current_user),
):
    """Get chat history for a research request. Supports since_ts catch-up and marks messages as read."""
    with tx() as c:
        _verify_order_access(c, request_id, user)
        is_admin = user.get("role") == "admin"
        if is_admin:
            c.execute("UPDATE custom_research_messages SET is_read_by_admin = 1 WHERE request_id = ?", (request_id,))
        else:
            c.execute("UPDATE custom_research_messages SET is_read_by_client = 1 WHERE request_id = ?", (request_id,))

        if since_ts is not None:
            rows = c.execute(
                "SELECT * FROM custom_research_messages WHERE request_id = ? AND created_at > ? ORDER BY created_at ASC",
                (request_id, float(since_ts)),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM custom_research_messages WHERE request_id = ? ORDER BY created_at ASC",
                (request_id,),
            ).fetchall()
        messages = [dict(r) for r in rows]

    return {"ok": True, "request_id": request_id, "messages": messages, "count": len(messages)}


@router.post("/api/v1/research/orders/{request_id}/messages")
def send_order_message(
    request_id: str,
    payload: ChatMessagePayload,
    user: dict = Depends(get_current_user),
):
    """Post a message to the order chat."""
    now_ts = time.time()
    sender_role = "admin" if user.get("role") == "admin" else "client"
    sender_name = "Ban Quản Trị ZUPIRUS" if sender_role == "admin" else (user.get("email") or "Khách hàng")
    msg_id = f"msg_{uuid.uuid4().hex[:10]}"

    with tx() as c:
        _verify_order_access(c, request_id, user)
        c.execute(
            """
            INSERT INTO custom_research_messages (
                id, request_id, sender_id, sender_role, sender_name, message,
                attachment_path, attachment_name, attachment_type, attachment_size,
                is_read_by_admin, is_read_by_client, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
            """,
            (
                msg_id,
                request_id,
                user["id"],
                sender_role,
                sender_name,
                payload.message.strip(),
                1 if sender_role == "admin" else 0,
                1 if sender_role == "client" else 0,
                now_ts,
            ),
        )
        c.execute("UPDATE custom_research_requests SET updated_at = ? WHERE id = ?", (now_ts, request_id))

    msg_data = {
        "id": msg_id,
        "request_id": request_id,
        "sender_id": user["id"],
        "sender_role": sender_role,
        "sender_name": sender_name,
        "message": payload.message.strip(),
        "attachment_path": None,
        "attachment_name": None,
        "attachment_type": None,
        "attachment_size": None,
        "created_at": now_ts,
    }
    _broadcast_chat_message(request_id, {"event": "new_message", "message": msg_data})

    return {"ok": True, "message": msg_data}


@router.get("/api/v1/research/orders/{request_id}/messages/events")
async def stream_order_messages(
    request: Request,
    request_id: str,
    since_ts: Optional[float] = Query(None),
):
    """Server-Sent Events (SSE) stream for real-time order chat with catch-up on reconnect."""
    user = get_current_user(request)
    with tx() as c:
        _verify_order_access(c, request_id, user)

    q = asyncio.Queue()
    _chat_subscribers.setdefault(request_id, []).append(q)

    async def event_generator():
        try:
            yield f"event: connected\ndata: {json.dumps({'ok': True, 'request_id': request_id})}\n\n"

            # Catch up missed messages if since_ts supplied
            if since_ts:
                with tx() as c:
                    missed_rows = c.execute(
                        "SELECT * FROM custom_research_messages WHERE request_id = ? AND created_at > ? ORDER BY created_at ASC",
                        (request_id, float(since_ts)),
                    ).fetchall()
                    for r in missed_rows:
                        yield f"event: message\ndata: {json.dumps({'event': 'new_message', 'message': dict(r)}, ensure_ascii=False)}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield f"event: message\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            if request_id in _chat_subscribers and q in _chat_subscribers[request_id]:
                _chat_subscribers[request_id].remove(q)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/api/v1/research/orders/{request_id}/attachments")
async def upload_order_attachment(
    request_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Upload a file attachment (PNG, JPEG, WebP, PDF, CSV) to the order chat.
    Enforces authorization check strictly before writing any file to persistent storage.
    """
    # 1. Check authorization first
    with tx() as c:
        _verify_order_access(c, request_id, user)

    # 2. Read and validate content
    content = await file.read()
    mime_type = _validate_attachment_bytes(file.filename or "upload", content)

    now_ts = time.time()
    safe_name = re.sub(r"[^a-zA-Z0-9_.-]", "_", file.filename or "attachment")
    att_id = f"att_{uuid.uuid4().hex[:10]}"
    storage_dir = _get_attachments_dir(request_id)
    stored_file_path = storage_dir / f"{att_id}_{safe_name}"

    try:
        stored_file_path.write_bytes(content)
    except Exception as e:
        if stored_file_path.exists():
            try:
                stored_file_path.unlink()
            except Exception:
                pass
        _fail(500, f"Lỗi lưu trữ tệp: {e}")

    sender_role = "admin" if user.get("role") == "admin" else "client"
    sender_name = "Ban Quản Trị ZUPIRUS" if sender_role == "admin" else (user.get("email") or "Khách hàng")
    msg_id = f"msg_{uuid.uuid4().hex[:10]}"

    try:
        with tx() as c:
            c.execute(
                """
                INSERT INTO custom_research_attachments (
                    id, request_id, message_id, uploader_id, filename, stored_path,
                    file_type, file_size, is_run_input, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (att_id, request_id, msg_id, user["id"], safe_name, str(stored_file_path), mime_type, len(content), now_ts),
            )

            c.execute(
                """
                INSERT INTO custom_research_messages (
                    id, request_id, sender_id, sender_role, sender_name, message,
                    attachment_id, attachment_path, attachment_name, attachment_type, attachment_size,
                    is_read_by_admin, is_read_by_client, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    msg_id,
                    request_id,
                    user["id"],
                    sender_role,
                    sender_name,
                    f"Đã đính kèm tệp: {safe_name}",
                    att_id,
                    str(stored_file_path),
                    safe_name,
                    mime_type,
                    len(content),
                    1 if sender_role == "admin" else 0,
                    1 if sender_role == "client" else 0,
                    now_ts,
                ),
            )
            c.execute("UPDATE custom_research_requests SET updated_at = ? WHERE id = ?", (now_ts, request_id))
    except Exception as e:
        if stored_file_path.exists():
            try:
                stored_file_path.unlink()
            except Exception:
                pass
        raise e

    att_info = {
        "id": att_id,
        "request_id": request_id,
        "filename": safe_name,
        "file_type": mime_type,
        "file_size": len(content),
        "download_url": f"/api/v1/research/orders/{request_id}/attachments/{att_id}/download",
        "created_at": now_ts,
    }
    _broadcast_chat_message(request_id, {"event": "new_attachment", "attachment": att_info})

    return {"ok": True, "attachment": att_info}


@router.get("/api/v1/research/orders/{request_id}/attachments/{att_id}/download")
def download_order_attachment(
    request_id: str,
    att_id: str,
    user: dict = Depends(get_current_user),
):
    """Download an uploaded attachment. Supports lookup by either att_id or message_id with 403 authorization check."""
    with tx() as c:
        _verify_order_access(c, request_id, user)
        row = c.execute(
            "SELECT * FROM custom_research_attachments WHERE (id = ? OR message_id = ?) AND request_id = ?",
            (att_id, att_id, request_id),
        ).fetchone()
        if not row:
            _fail(404, "Không tìm thấy tệp đính kèm.")
        att = dict(row)

    file_p = Path(att["stored_path"])
    if not file_p.exists():
        _fail(404, "Tệp không tồn tại trên hệ thống lưu trữ.")

    return FileResponse(
        path=str(file_p),
        media_type=att.get("file_type") or "application/octet-stream",
        filename=att.get("filename") or file_p.name,
    )


# --- Admin Workflow Endpoints ---

@router.get("/api/v1/admin/research/requests")
def admin_list_research_requests(
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    include_archived: bool = Query(False),
    admin: dict = Depends(get_current_admin),
):
    """Admin: List all research inquiries and active studies.
    Categorized into Actionable Queue (Pending Reply, Pending Quote, Needs Data, Pending Review, Failed/Intervention).
    Returns both 'items' and 'requests' for frontend backward-compatibility.
    """
    with tx() as c:
        where_clauses = []
        params = []

        if not include_archived:
            where_clauses.append("is_archived = 0")

        if status:
            where_clauses.append("status = ?")
            params.append(status.upper())

        if category:
            cat = category.strip().lower()
            if cat == "actionable":
                where_clauses.append(
                    "(action_category = 'ACTIONABLE' OR status IN ('PENDING_QUOTE', 'NEEDS_CLARIFICATION', 'NEEDS_DATA', 'READY_FOR_REVIEW', 'FAILED') "
                    "OR (SELECT COUNT(*) FROM custom_research_messages WHERE request_id = custom_research_requests.id AND is_read_by_admin = 0) > 0)"
                )
            elif cat == "waiting_client":
                where_clauses.append("(action_category = 'WAITING_CLIENT' OR status IN ('QUOTED', 'WAITING_PAYMENT'))")
            elif cat == "running":
                where_clauses.append("(action_category = 'RUNNING' OR status IN ('CONFIRMED', 'RUNNING'))")
            elif cat == "completed":
                where_clauses.append("(action_category = 'COMPLETED' OR status IN ('DELIVERED', 'REJECTED'))")

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        query = f"SELECT * FROM custom_research_requests {where_sql} ORDER BY updated_at DESC, created_at DESC"
        rows = c.execute(query, tuple(params)).fetchall()

        items = []
        for r in rows:
            d = dict(r)
            d["symbols"] = json.loads(d.get("symbols_json") or "[]")
            if d.get("proposal_details_json"):
                try:
                    d["proposal_details"] = json.loads(d["proposal_details_json"])
                except Exception:
                    d["proposal_details"] = None

            # Count unread messages for admin
            unread = c.execute(
                "SELECT COUNT(*) FROM custom_research_messages WHERE request_id = ? AND is_read_by_admin = 0",
                (d["id"],),
            ).fetchone()
            d["unread_messages_count"] = unread[0] if unread else 0

            # Compute queue subcategory
            if d["unread_messages_count"] > 0:
                d["queue_group"] = "PENDING_REPLY"
            elif d["status"] == "PENDING_QUOTE":
                d["queue_group"] = "PENDING_QUOTE"
            elif d["status"] == "NEEDS_CLARIFICATION":
                d["queue_group"] = "NEEDS_CLARIFICATION"
            elif d["status"] in ("NEEDS_DATA", "NEEDS_ATTENTION"):
                d["queue_group"] = "NEEDS_DATA"
            elif d["status"] == "READY_FOR_REVIEW":
                d["queue_group"] = "READY_FOR_REVIEW"
            elif d["status"] in ("FAILED", "TIMED_OUT", "ERROR"):
                d["queue_group"] = "ERROR_INTERVENTION"
            elif d["status"] in ("QUOTED", "WAITING_PAYMENT"):
                d["queue_group"] = "WAITING_CLIENT"
            elif d["status"] in ("CONFIRMED", "RUNNING"):
                d["queue_group"] = "RUNNING"
            elif d["status"] in ("DELIVERED", "REJECTED"):
                d["queue_group"] = "COMPLETED"
            else:
                d["queue_group"] = "ACTIONABLE"

            items.append(d)

    return {"ok": True, "items": items, "requests": items, "count": len(items)}


@router.get("/api/v1/admin/research/requests/{request_id}/draft-proposal")
def admin_get_draft_proposal(
    request_id: str,
    admin: dict = Depends(get_current_admin),
):
    """Auto-draft proposal with ambiguity detection for admin review."""
    with tx() as c:
        row = c.execute("SELECT * FROM custom_research_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            _fail(404, f"Không tìm thấy yêu cầu nghiên cứu {request_id}")
        req = dict(row)

    desc = req.get("problem_description") or req.get("hypothesis_prompt") or ""
    symbols = json.loads(req.get("symbols_json") or "[\"XAUUSD\", \"EURUSD\", \"USDJPY\"]")
    turnaround = int(req.get("turnaround_hours") or 48)
    ambiguities = detect_proposal_ambiguities(desc, symbols)

    draft = {
        "research_question": f"Khảo nghiệm định lượng tác động: {desc[:150]}" if desc else "Khảo nghiệm phản ứng vĩ mô đa tài sản",
        "deliverables": [
            "Báo cáo nghiên cứu độc quyền PDF chuyên sâu (20+ trang)",
            "Nhật ký mô phỏng giao dịch chi tiết (trades_ledger.csv)",
            "Bộ chỉ số định lượng & suy diễn thống kê (metrics.json)",
            "Bộ công cụ tái lập độc lập offline (replay.py & QUICKSTART.md)",
            "Bảng kê mã băm mật mã chứng minh tính toàn vẹn (MANIFEST.sha256)",
        ],
        "turnaround_hours": turnaround,
        "quoted_price_usd": float(req.get("quoted_price_usd") or 10000.0),
        "scope_notes": req.get("scope_notes") or f"Khảo nghiệm trên rổ tài sản {', '.join(symbols)}.",
        "ambiguities_vi": ambiguities,
    }
    return {"ok": True, "request_id": request_id, "draft_proposal": draft}


def execute_research_run_internal(
    request_id: str,
    operator_id: str,
    operator_role: str,
    is_rerun: bool = False,
    rerun_reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute quantitative research run with concurrency guard, data input check, run persistence, and audit logging."""
    now_ts = time.time()
    with tx() as c:
        row = c.execute("SELECT * FROM custom_research_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            _fail(404, f"Không tìm thấy yêu cầu nghiên cứu {request_id}")
        req = dict(row)

        # Mutex lock check: if currently RUNNING and last_run_started_at < 15 min ago, reject (allow worker claim)
        if req.get("status") == "RUNNING" and operator_role != "worker":
            last_start = float(req.get("last_run_started_at") or 0.0)
            if last_start > 0 and now_ts - last_start < 900:
                _fail(409, "Nghiên cứu này đang trong quá trình thực thi. Vui lòng không thực hiện chạy trùng lặp.")

        price = float(req.get("quoted_price_usd") or 0.0)
        pay_status = req.get("payment_status", "UNPAID")
        if price > 0 and pay_status != "PAID":
            _fail(
                400,
                f"Yêu cầu nghiên cứu có báo giá thương mại (${price:,.2f} USD) chưa hoàn tất thanh toán (Trạng thái: {pay_status}). Chỉ được thực thi sau khi thanh toán on-chain được xác nhận.",
            )

        # Check required data inputs
        symbols = json.loads(req.get("symbols_json") or "[\"XAUUSD\", \"EURUSD\", \"USDJPY\"]")
        input_att_id = req.get("input_attachment_id")
        if input_att_id:
            att = c.execute("SELECT * FROM custom_research_attachments WHERE id = ?", (input_att_id,)).fetchone()
            stored = att["stored_path"] if att and "stored_path" in att.keys() else None
            if not stored or not Path(stored).exists():
                # Save NEEDS_DATA in an isolated committed transaction before failing so state is never rolled back
                with tx() as c_err:
                    c_err.execute(
                        """
                        UPDATE custom_research_requests
                        SET status = 'NEEDS_DATA', current_step = 'NEEDS_DATA', action_category = 'ACTIONABLE',
                            waiting_reason_vi = 'Tệp dữ liệu đầu vào đính kèm không tồn tại trên hệ thống lưu trữ.',
                            updated_at = ?
                        WHERE id = ?
                        """,
                        (now_ts, request_id),
                    )
                    _log_audit_action(c_err, request_id, operator_id, operator_role, "DATA_CHECK_FAILED", reason="Missing attachment file")
                _fail(400, "Tệp dữ liệu đầu vào đính kèm không tồn tại trên hệ thống lưu trữ.")

        # Determine next run number
        max_run = c.execute(
            "SELECT MAX(run_number) FROM custom_research_runs WHERE request_id = ?",
            (request_id,),
        ).fetchone()
        next_run_num = (max_run[0] or 0) + 1 if max_run else 1
        run_uuid = f"run_{uuid.uuid4().hex[:12]}"
        proposal_ver = int(req.get("proposal_version") or 1)

        c.execute(
            """
            INSERT INTO custom_research_runs (
                id, request_id, run_number, proposal_version, status, input_attachment_id,
                parameters_json, metrics_json, deliverable_pdf_path, deliverable_bundle_path,
                deliverable_bundle_sha256, error_details, is_approved, started_at
            ) VALUES (?, ?, ?, ?, 'RUNNING', ?, ?, NULL, NULL, NULL, NULL, NULL, 0, ?)
            """,
            (
                run_uuid,
                request_id,
                next_run_num,
                proposal_ver,
                input_att_id,
                json.dumps({"symbols": symbols, "turnaround": req.get("turnaround_hours")}),
                now_ts,
            ),
        )

        c.execute(
            """
            UPDATE custom_research_requests
            SET status = 'RUNNING', current_step = 'RUNNING', action_category = 'RUNNING',
                last_run_started_at = ?, run_count = run_count + 1, updated_at = ?
            WHERE id = ?
            """,
            (now_ts, now_ts, request_id),
        )

    # Execute study engine
    try:
        prompt = req.get("hypothesis_prompt") or "Nghiên cứu định lượng vĩ mô"
        turnaround = int(req.get("turnaround_hours") or 48)
        client_name = req.get("client_email") or "Tổ chức Đối tác"

        study = run_institutional_macro_event_study(
            hypothesis_prompt=prompt,
            symbols=symbols,
            client_name=client_name,
            quoted_price_usd=price,
            turnaround_hours=turnaround,
        )

        zip_path, bundle_filename, bundle_sha = build_institutional_deliverable_bundle(study)
        pdf_path = zip_path.parent / f"{study.study_id}_report_full.pdf"

        done_ts = time.time()
        with tx() as c:
            # Atomic active check before writing run outputs
            active_run = c.execute(
                "SELECT status FROM custom_research_runs WHERE id = ?",
                (run_uuid,),
            ).fetchone()
            if not active_run or active_run[0] != 'RUNNING':
                logger.warning("Run %s is not in RUNNING state (%s). Aborting output commit.", run_uuid, active_run[0] if active_run else "MISSING")
                return

            c.execute(
                """
                UPDATE custom_research_runs
                SET status = 'COMPLETED', deliverable_pdf_path = ?, deliverable_bundle_path = ?,
                    deliverable_bundle_sha256 = ?, metrics_json = ?, completed_at = ?
                WHERE id = ?
                """,
                (
                    str(pdf_path),
                    str(zip_path),
                    bundle_sha,
                    json.dumps(study.to_dict(), ensure_ascii=False),
                    done_ts,
                    run_uuid,
                ),
            )

            c.execute(
                """
                UPDATE custom_research_requests
                SET run_id = ?, deliverable_report_id = ?, deliverable_pdf_path = ?,
                    deliverable_bundle_path = ?, status = 'READY_FOR_REVIEW', current_step = 'IN_REVIEW',
                    action_category = 'ACTIONABLE',
                    waiting_reason_vi = 'Chờ ban quản trị kiểm tra bằng chứng và duyệt bàn giao',
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    study.study_id,
                    f"rep_{study.study_id}",
                    str(pdf_path),
                    str(zip_path),
                    done_ts,
                    request_id,
                ),
            )

            _log_audit_action(
                c,
                request_id,
                operator_id,
                operator_role,
                "RERUN_EXECUTED" if is_rerun else "RUN_EXECUTED",
                reason=rerun_reason,
                details={"run_id": study.study_id, "run_number": next_run_num, "bundle_sha256": bundle_sha},
            )

            run_msg = (
                f"Nghiên cứu định lượng (Lượt #{next_run_num}) đã hoàn thành (Mã bài chạy: {study.study_id}). "
                f"Bằng chứng, PDF và gói ZIP kiểm chứng đã sẵn sàng để kiểm tra."
            )
            c.execute(
                """
                INSERT INTO custom_research_messages (
                    id, request_id, sender_id, sender_role, sender_name, message,
                    is_read_by_admin, is_read_by_client, created_at
                ) VALUES (?, ?, 'system', 'system', 'Hệ Thống ZUPIRUS Engine', ?, 1, 1, ?)
                """,
                (f"msg_{uuid.uuid4().hex[:10]}", request_id, run_msg, done_ts),
            )

        _broadcast_chat_message(request_id, {"event": "status_changed", "status": "READY_FOR_REVIEW", "current_step": "IN_REVIEW"})

        return {
            "ok": True,
            "request_id": request_id,
            "run_id": study.study_id,
            "run_number": next_run_num,
            "status": "READY_FOR_REVIEW",
            "current_step": "IN_REVIEW",
            "bundle_filename": bundle_filename,
            "bundle_sha256": bundle_sha,
            "message": "Nghiên cứu đã thực thi thành công. Bằng chứng, ledger và bundle ZIP sẵn sàng để Admin rà soát.",
        }
    except Exception as exc:
        logger.exception("Error executing research run for %s", request_id)
        err_ts = time.time()
        with tx() as c:
            c.execute(
                "UPDATE custom_research_runs SET status = 'FAILED', error_details = ?, completed_at = ? WHERE id = ?",
                (str(exc)[:500], err_ts, run_uuid),
            )
            c.execute(
                """
                UPDATE custom_research_requests
                SET status = 'FAILED', action_category = 'ACTIONABLE',
                    waiting_reason_vi = ?, updated_at = ?
                WHERE id = ?
                """,
                (f"Lỗi thực thi: {str(exc)[:100]}", err_ts, request_id),
            )
            _log_audit_action(
                c, request_id, operator_id, operator_role, "RUN_FAILED", reason=str(exc)[:200], details={"run_uuid": run_uuid}
            )
        raise HTTPException(status_code=500, detail=f"Lỗi thực thi nghiên cứu: {exc}")


@router.get("/api/v1/admin/research/inbox")
def admin_research_inbox(admin: dict = Depends(get_current_admin)):
    """Admin Inbox: List all orders with their latest message and unread count."""
    with tx() as c:
        rows = c.execute(
            """
            SELECT crr.id, crr.client_email, crr.product_type, crr.symbol, crr.status, crr.current_step,
                   crr.updated_at,
                   COUNT(CASE WHEN crm.is_read_by_admin = 0 THEN 1 END) as unread_count,
                   (SELECT message FROM custom_research_messages WHERE request_id = crr.id ORDER BY created_at DESC LIMIT 1) as last_message,
                   (SELECT created_at FROM custom_research_messages WHERE request_id = crr.id ORDER BY created_at DESC LIMIT 1) as last_message_at
            FROM custom_research_requests crr
            LEFT JOIN custom_research_messages crm ON crm.request_id = crr.id
            GROUP BY crr.id
            ORDER BY last_message_at DESC NULLS LAST, crr.updated_at DESC
            """
        ).fetchall()

        inbox_items = [dict(r) for r in rows]

    return {"ok": True, "inbox": inbox_items, "count": len(inbox_items)}


@router.post("/api/v1/admin/research/requests/{request_id}/quote")
def admin_quote_research_request(
    request_id: str,
    payload: AdminQuotePayload,
    admin: dict = Depends(get_current_admin),
):
    """Admin sets or revises the bespoke quotation price for an institutional research request."""
    if payload.quoted_price_usd < 0 or math.isnan(payload.quoted_price_usd) or math.isinf(payload.quoted_price_usd):
        _fail(400, "Giá báo phải là số dương hữu hạn.")

    now_ts = time.time()
    with tx() as c:
        row = c.execute("SELECT * FROM custom_research_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            _fail(404, f"Không tìm thấy yêu cầu nghiên cứu {request_id}")

        req = dict(row)
        new_ver = int(req.get("proposal_version") or 1) + 1

        c.execute(
            """
            UPDATE custom_research_requests
            SET quoted_price_usd = ?, scope_notes = ?, proposal_version = ?, status = 'QUOTED',
                current_step = 'PROPOSAL_PENDING', next_action_vi = 'Chờ khách hàng duyệt báo giá mới', updated_at = ?
            WHERE id = ?
            """,
            (payload.quoted_price_usd, payload.scope_notes, new_ver, now_ts, request_id),
        )

        # Notify chat
        quote_msg = (
            f"Ban quản trị đã gửi báo giá chính thức phiên bản v{new_ver}: "
            f"**${payload.quoted_price_usd:,.2f} USD**.\n"
            f"Phạm vi: {payload.scope_notes or 'Theo thỏa thuận'}. "
            f"Quý khách vui lòng bấm nút Xác nhận để tiến hành thực thi."
        )
        c.execute(
            """
            INSERT INTO custom_research_messages (
                id, request_id, sender_id, sender_role, sender_name, message,
                is_read_by_admin, is_read_by_client, created_at
            ) VALUES (?, ?, ?, 'admin', 'Ban Quản Trị ZUPIRUS', ?, 1, 0, ?)
            """,
            (f"msg_{uuid.uuid4().hex[:10]}", request_id, admin["id"], quote_msg, now_ts),
        )

    _broadcast_chat_message(request_id, {"event": "status_changed", "status": "QUOTED", "proposal_version": new_ver})

    return {
        "ok": True,
        "request_id": request_id,
        "status": "QUOTED",
        "proposal_version": new_ver,
        "quoted_price_usd": payload.quoted_price_usd,
        "scope_notes": payload.scope_notes,
    }


@router.post("/api/v1/admin/research/requests/{request_id}/proposal")
def admin_send_formal_proposal(
    request_id: str,
    payload: AdminProposalPayload,
    admin: dict = Depends(get_current_admin),
):
    """Admin updates or sends a formal structured proposal to the client."""
    if payload.quoted_price_usd < 0 or math.isnan(payload.quoted_price_usd) or math.isinf(payload.quoted_price_usd):
        _fail(400, "Giá báo phải là số dương hữu hạn.")

    now_ts = time.time()
    with tx() as c:
        row = c.execute("SELECT * FROM custom_research_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            _fail(404, f"Không tìm thấy yêu cầu nghiên cứu {request_id}")

        req = dict(row)
        new_ver = int(req.get("proposal_version") or 1) + 1

        proposal_dict = {
            "version": new_ver,
            "research_question": payload.research_question or req.get("hypothesis_prompt"),
            "deliverables": payload.deliverables or [
                "Báo cáo nghiên cứu độc quyền PDF chuyên sâu (20+ trang)",
                "Nhật ký mô phỏng giao dịch chi tiết (trades_ledger.csv)",
                "Bộ chỉ số định lượng & suy diễn thống kê (metrics.json)",
                "Bộ công cụ tái lập độc lập offline (replay.py & QUICKSTART.md)",
                "Bảng kê mã băm mật mã chứng minh tính toàn vẹn (MANIFEST.sha256)",
            ],
            "turnaround_hours": payload.turnaround_hours or req.get("turnaround_hours") or 48,
            "quoted_price_usd": payload.quoted_price_usd,
            "scope_notes": payload.scope_notes,
        }

        c.execute(
            """
            UPDATE custom_research_requests
            SET quoted_price_usd = ?, scope_notes = ?, proposal_version = ?,
                proposal_details_json = ?, status = 'QUOTED', current_step = 'PROPOSAL_PENDING',
                next_action_vi = 'Chờ khách hàng duyệt đề xuất mới', updated_at = ?
            WHERE id = ?
            """,
            (
                payload.quoted_price_usd,
                payload.scope_notes,
                new_ver,
                json.dumps(proposal_dict, ensure_ascii=False),
                now_ts,
                request_id,
            ),
        )

        # Notify chat
        p_msg = (
            f"Ban quản trị đã cập nhật đề xuất nghiên cứu phiên bản v{new_ver}:\n"
            f"- **Câu hỏi**: {proposal_dict['research_question']}\n"
            f"- **Giá hợp đồng**: ${payload.quoted_price_usd:,.2f} USD\n"
            f"- **Thời hạn**: {proposal_dict['turnaround_hours']} giờ\n"
            f"Quý khách vui lòng xác nhận đề xuất để tiến hành thực thi."
        )
        c.execute(
            """
            INSERT INTO custom_research_messages (
                id, request_id, sender_id, sender_role, sender_name, message,
                is_read_by_admin, is_read_by_client, created_at
            ) VALUES (?, ?, ?, 'admin', 'Ban Quản Trị ZUPIRUS', ?, 1, 0, ?)
            """,
            (f"msg_{uuid.uuid4().hex[:10]}", request_id, admin["id"], p_msg, now_ts),
        )

    _broadcast_chat_message(request_id, {"event": "proposal_updated", "proposal": proposal_dict})

    return {
        "ok": True,
        "request_id": request_id,
        "proposal_version": new_ver,
        "proposal": proposal_dict,
    }


@router.post("/api/v1/admin/research/requests/{request_id}/attachments/{att_id}/set-run-input")
def admin_set_attachment_as_run_input(
    request_id: str,
    att_id: str,
    admin: dict = Depends(get_current_admin),
):
    """Admin designates an uploaded attachment as formal input data for the research run."""
    now_ts = time.time()
    with tx() as c:
        row = c.execute("SELECT * FROM custom_research_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            _fail(404, f"Không tìm thấy yêu cầu nghiên cứu {request_id}")

        att = c.execute(
            "SELECT * FROM custom_research_attachments WHERE (id = ? OR message_id = ?) AND request_id = ?",
            (att_id, att_id, request_id),
        ).fetchone()
        if not att:
            _fail(404, f"Không tìm thấy tệp đính kèm {att_id}")
        real_att_id = att["id"]

        c.execute(
            "UPDATE custom_research_attachments SET is_run_input = 0 WHERE request_id = ?",
            (request_id,),
        )
        c.execute(
            "UPDATE custom_research_attachments SET is_run_input = 1 WHERE id = ?",
            (real_att_id,),
        )
        c.execute(
            "UPDATE custom_research_requests SET input_attachment_id = ?, updated_at = ? WHERE id = ?",
            (real_att_id, now_ts, request_id),
        )

    return {"ok": True, "request_id": request_id, "input_attachment_id": real_att_id}


@router.post("/api/v1/admin/research/requests/{request_id}/run")
def admin_run_research_study(
    request_id: str,
    admin: dict = Depends(get_current_admin),
):
    """Admin executes quantitative study engine on the request."""
    return execute_research_run_internal(request_id, str(admin["id"]), "admin", is_rerun=False)


@router.post("/api/v1/admin/research/requests/{request_id}/rerun")
def admin_rerun_research_request(
    request_id: str,
    payload: AdminRerunPayload,
    admin: dict = Depends(get_current_admin),
):
    """Admin triggers a re-run with audit trail and retry limit."""
    with tx() as c:
        row = c.execute("SELECT * FROM custom_research_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            _fail(404, f"Không tìm thấy yêu cầu nghiên cứu {request_id}")
        req = dict(row)
        retry_cnt = int(req.get("retry_count") or 0)
        if retry_cnt >= 5:
            _fail(400, "Đã đạt giới hạn tối đa số lần chạy lại (5 lần). Vui lòng can thiệp thủ công hoặc kiểm tra dữ liệu đầu vào.")
        c.execute("UPDATE custom_research_requests SET retry_count = retry_count + 1 WHERE id = ?", (request_id,))

    return execute_research_run_internal(request_id, str(admin["id"]), "admin", is_rerun=True, rerun_reason=payload.reason)


@router.post("/api/v1/admin/research/requests/{request_id}/override-status")
def admin_override_status(
    request_id: str,
    payload: AdminOverrideStatusPayload,
    admin: dict = Depends(get_current_admin),
):
    """Admin manual intervention: overrides request status with audit log."""
    allowed = {
        "PENDING", "PENDING_QUOTE", "QUOTED", "WAITING_PAYMENT", "CONFIRMED",
        "RUNNING", "NEEDS_DATA", "READY_FOR_REVIEW", "DELIVERED", "FAILED", "REJECTED"
    }
    new_status = payload.new_status.strip().upper()
    if new_status not in allowed:
        _fail(400, f"Trạng thái không hợp lệ. Cho phép: {', '.join(sorted(allowed))}")

    now_ts = time.time()
    with tx() as c:
        row = c.execute("SELECT * FROM custom_research_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            _fail(404, f"Không tìm thấy yêu cầu nghiên cứu {request_id}")
        req = dict(row)
        old_status = req.get("status")

        if new_status in ("RUNNING", "CONFIRMED"):
            cat = "RUNNING"
        elif new_status in ("DELIVERED", "REJECTED"):
            cat = "COMPLETED"
        elif new_status in ("QUOTED", "WAITING_PAYMENT"):
            cat = "WAITING_CLIENT"
        else:
            cat = "ACTIONABLE"

        c.execute(
            """
            UPDATE custom_research_requests
            SET status = ?, action_category = ?, waiting_reason_vi = ?, updated_at = ?
            WHERE id = ?
            """,
            (new_status, cat, f"Admin can thiệp: {payload.reason}", now_ts, request_id),
        )

        _log_audit_action(
            c,
            request_id,
            str(admin["id"]),
            "admin",
            "STATUS_OVERRIDE",
            reason=payload.reason,
            details={"old_status": old_status, "new_status": new_status},
        )

        override_msg = f"Ban Quản Trị đã can thiệp thay đổi trạng thái hồ sơ: {old_status} -> {new_status}. Lý do: {payload.reason}"
        c.execute(
            """
            INSERT INTO custom_research_messages (
                id, request_id, sender_id, sender_role, sender_name, message,
                is_read_by_admin, is_read_by_client, created_at
            ) VALUES (?, ?, ?, 'admin', 'Ban Quản Trị ZUPIRUS', ?, 1, 0, ?)
            """,
            (f"msg_{uuid.uuid4().hex[:10]}", request_id, admin["id"], override_msg, now_ts),
        )

    _broadcast_chat_message(request_id, {"event": "status_changed", "status": new_status, "action_category": cat})

    return {"ok": True, "request_id": request_id, "status": new_status, "action_category": cat, "reason": payload.reason}


@router.post("/api/v1/admin/research/requests/{request_id}/archive")
def admin_archive_research_request(
    request_id: str,
    admin: dict = Depends(get_current_admin),
):
    """Archive a research request rather than hard deleting."""
    now_ts = time.time()
    with tx() as c:
        row = c.execute("SELECT * FROM custom_research_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            _fail(404, f"Không tìm thấy yêu cầu nghiên cứu {request_id}")
        c.execute("UPDATE custom_research_requests SET is_archived = 1, updated_at = ? WHERE id = ?", (now_ts, request_id))
        _log_audit_action(c, request_id, str(admin["id"]), "admin", "REQUEST_ARCHIVED", reason="Archived by admin")

    return {"ok": True, "request_id": request_id, "is_archived": 1}


@router.get("/api/v1/admin/research/requests/{request_id}/runs/{run_id}/preview-pdf")
def admin_preview_run_pdf(
    request_id: str,
    run_id: str,
    admin: dict = Depends(get_current_admin),
):
    """Admin: Preview specific PDF deliverable by run_id."""
    with tx() as c:
        run_row = c.execute(
            "SELECT deliverable_pdf_path FROM custom_research_runs WHERE id = ? AND request_id = ?",
            (run_id, request_id),
        ).fetchone()
        if not run_row or not run_row[0] or not Path(run_row[0]).exists():
            _fail(404, f"Không tìm thấy tệp PDF của lượt chạy {run_id}.")
        pdf_path = Path(run_row[0])

    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        filename=f"preview_run_{run_id}.pdf",
    )


@router.get("/api/v1/admin/research/requests/{request_id}/runs/{run_id}/download-bundle")
def admin_download_run_bundle(
    request_id: str,
    run_id: str,
    admin: dict = Depends(get_current_admin),
):
    """Admin: Download specific bundle ZIP deliverable by run_id."""
    with tx() as c:
        run_row = c.execute(
            "SELECT deliverable_bundle_path FROM custom_research_runs WHERE id = ? AND request_id = ?",
            (run_id, request_id),
        ).fetchone()
        if not run_row or not run_row[0] or not Path(run_row[0]).exists():
            _fail(404, f"Không tìm thấy gói bundle ZIP của lượt chạy {run_id}.")
        bundle_path = Path(run_row[0])

    return FileResponse(
        path=str(bundle_path),
        media_type="application/zip",
        filename=f"bundle_run_{run_id}.zip",
    )


@router.post("/api/v1/admin/research/requests/{request_id}/approve")
def admin_approve_deliver_research_request(
    request_id: str,
    payload: Optional[AdminApprovePayload] = None,
    admin: dict = Depends(get_current_admin),
):
    """Admin approves evidence and delivers private research package exclusively to client.
    Can approve a specific run by run_id or the latest completed run.
    Stores immutable deliverable paths and hashes to protect client downloads against subsequent background runs.
    """
    now_ts = time.time()
    with tx() as c:
        row = c.execute("SELECT * FROM custom_research_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            _fail(404, f"Không tìm thấy yêu cầu nghiên cứu {request_id}")
        req = dict(row)

        target_run = None
        if payload and payload.run_id:
            run_row = c.execute(
                "SELECT * FROM custom_research_runs WHERE id = ? AND request_id = ?",
                (payload.run_id, request_id),
            ).fetchone()
            if not run_row:
                _fail(404, f"Không tìm thấy lượt chạy {payload.run_id} thuộc hồ sơ này.")
            target_run = dict(run_row)
        else:
            run_row = c.execute(
                """
                SELECT * FROM custom_research_runs
                WHERE request_id = ? AND status = 'COMPLETED'
                ORDER BY run_number DESC LIMIT 1
                """,
                (request_id,),
            ).fetchone()
            if run_row:
                target_run = dict(run_row)

        if not target_run:
            _fail(400, "Chưa có lượt chạy hoàn tất nào cho hồ sơ này. Hãy bấm 'Chạy nghiên cứu' trước khi duyệt bàn giao.")

        if target_run.get("status") != "COMPLETED":
            _fail(400, f"Lượt chạy {target_run['id']} chưa hoàn tất thành công (trạng thái: {target_run.get('status')}).")

        curr_proposal_ver = int(req.get("proposal_version") or 1)
        if int(target_run.get("proposal_version") or 1) != curr_proposal_ver:
            _fail(400, f"Lượt chạy {target_run['id']} thuộc phiên bản đề xuất v{target_run.get('proposal_version')}, không khớp phiên bản hiện tại v{curr_proposal_ver}.")

        # Enforce valid run paths without falling back to request pointers
        pdf_path = target_run.get("deliverable_pdf_path")
        bundle_path = target_run.get("deliverable_bundle_path")
        bundle_sha = target_run.get("deliverable_bundle_sha256")

        if not pdf_path or not Path(pdf_path).exists():
            _fail(400, "Tệp PDF nghiên cứu của lượt chạy này không tồn tại trên hệ thống lưu trữ.")
        if not bundle_path or not Path(bundle_path).exists():
            _fail(400, "Tệp bundle ZIP của lượt chạy này không tồn tại trên hệ thống lưu trữ.")
        if not bundle_sha:
            _fail(400, "Lượt chạy thiếu mã băm SHA-256 xác thực.")

        # Mark target run as approved
        c.execute(
            """
            UPDATE custom_research_runs
            SET is_approved = 1, approved_at = ?
            WHERE id = ?
            """,
            (now_ts, target_run["id"]),
        )

        # Save immutable handover records on custom_research_requests
        c.execute(
            """
            UPDATE custom_research_requests
            SET delivered_run_id = ?, delivered_pdf_path = ?, delivered_bundle_path = ?,
                delivered_bundle_sha256 = ?, delivered_at = ?,
                status = 'DELIVERED', current_step = 'DELIVERED', action_category = 'COMPLETED',
                waiting_reason_vi = 'Đã hoàn tất bàn giao. Khách hàng có thể tải PDF và gói Replay', updated_at = ?
            WHERE id = ?
            """,
            (target_run["id"], str(pdf_path), str(bundle_path), bundle_sha, now_ts, now_ts, request_id),
        )

        _log_audit_action(
            c, request_id, str(admin["id"]), "admin", "DELIVERABLE_APPROVED",
            reason=f"Approved and delivered run {target_run['id']}",
            details={"run_id": target_run["id"], "run_number": target_run.get("run_number")},
        )

        deliv_msg = (
            "Hồ sơ nghiên cứu đã được Ban Quản Trị phê duyệt và bàn giao riêng thành công!\n"
            "Quý khách có thể tải trực tiếp bản Báo cáo PDF chuyên sâu và trọn bộ Bundle ZIP tái lập độc lập từ thư viện của mình."
        )
        c.execute(
            """
            INSERT INTO custom_research_messages (
                id, request_id, sender_id, sender_role, sender_name, message,
                is_read_by_admin, is_read_by_client, created_at
            ) VALUES (?, ?, ?, 'admin', 'Ban Quản Trị ZUPIRUS', ?, 1, 0, ?)
            """,
            (f"msg_{uuid.uuid4().hex[:10]}", request_id, admin["id"], deliv_msg, now_ts),
        )

    _broadcast_chat_message(request_id, {"event": "status_changed", "status": "DELIVERED", "current_step": "DELIVERED"})

    return {
        "ok": True,
        "request_id": request_id,
        "status": "DELIVERED",
        "current_step": "DELIVERED",
        "approved_run_id": target_run["id"],
        "message": f"Đã duyệt bàn giao nghiên cứu riêng thành công cho khách hàng ({req.get('client_email')}).",
    }


@router.post("/api/v1/admin/research/requests/{request_id}/close")
def admin_close_research_request(
    request_id: str,
    payload: AdminClosePayload,
    admin: dict = Depends(get_current_admin),
):
    """Admin closes or rejects a research request. If paid or has runs, reject hard deletion and recommend archive."""
    now_ts = time.time()
    with tx() as c:
        row = c.execute("SELECT * FROM custom_research_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            _fail(404, f"Không tìm thấy yêu cầu nghiên cứu {request_id}")
        req = dict(row)

        if req.get("payment_status") == "PAID" or int(req.get("run_count") or 0) > 0:
            _fail(400, "Hồ sơ đã có giao dịch thanh toán hoặc lịch sử chạy nghiên cứu, không thể đóng hoặc xóa vĩnh viễn. Vui lòng bấm Lưu trữ (Archive) để bảo toàn bằng chứng.")

        c.execute(
            """
            UPDATE custom_research_requests
            SET status = 'REJECTED', rejection_reason = ?, current_step = 'CLOSED',
                action_category = 'COMPLETED',
                next_action_vi = 'Yêu cầu đã kết thúc', updated_at = ?
            WHERE id = ?
            """,
            (payload.reason or "Yêu cầu đã đóng bởi quản trị viên", now_ts, request_id),
        )

        _log_audit_action(c, request_id, str(admin["id"]), "admin", "REQUEST_CLOSED", reason=payload.reason)

    _broadcast_chat_message(request_id, {"event": "status_changed", "status": "REJECTED", "current_step": "CLOSED"})

    return {
        "ok": True,
        "request_id": request_id,
        "status": "REJECTED",
        "current_step": "CLOSED",
        "message": "Đã đóng yêu cầu nghiên cứu.",
    }


# --- Isolated Deliverable Downloads with Strict 403 Security Check ---

@router.get("/api/v1/research/orders/{request_id}/download-pdf")
def download_research_order_pdf(
    request_id: str,
    user: dict = Depends(get_current_user),
):
    """Download research PDF. Strictly restricted to request owner or system admin.
    Client can only download after deliverable approval for institutional orders.
    During reruns, previously approved deliverable remains downloadable by client.
    """
    with tx() as c:
        req = _verify_order_access(c, request_id, user)
        is_admin = user.get("role") == "admin"
        if not is_admin:
            if req.get("product_type") == "INSTITUTIONAL_RESEARCH":
                if req.get("status") not in ("DELIVERED", "COMPLETED") and not (req.get("delivered_pdf_path") or req.get("deliverable_pdf_path")):
                    _fail(403, "Bản nghiên cứu đang chờ Ban Quản Trị phê duyệt cuối cùng trước khi bàn giao.")

    pdf_path_str = req.get("delivered_pdf_path") or req.get("deliverable_pdf_path")
    if not pdf_path_str or not Path(pdf_path_str).exists():
        _fail(404, "Tệp PDF nghiên cứu chưa sẵn sàng hoặc chưa được tạo.")

    pdf_p = Path(pdf_path_str)
    return FileResponse(
        path=str(pdf_p),
        media_type="application/pdf",
        filename=f"zupirus_{req.get('product_type', 'research').lower()}_{req.get('symbol', 'study')}.pdf",
    )


@router.get("/api/v1/research/orders/{request_id}/download-bundle")
def download_research_order_bundle(
    request_id: str,
    user: dict = Depends(get_current_user),
):
    """Download complete deliverable bundle ZIP. Strictly restricted to request owner or admin.
    Client can only download after deliverable approval for institutional orders.
    During reruns, previously approved deliverable bundle remains downloadable by client.
    """
    with tx() as c:
        req = _verify_order_access(c, request_id, user)
        is_admin = user.get("role") == "admin"
        if not is_admin:
            if req.get("product_type") == "INSTITUTIONAL_RESEARCH":
                if req.get("status") not in ("DELIVERED", "COMPLETED") and not (req.get("delivered_bundle_path") or req.get("deliverable_bundle_path")):
                    _fail(403, "Gói nghiên cứu đang chờ Ban Quản Trị phê duyệt cuối cùng trước khi bàn giao.")

    bundle_path_str = req.get("delivered_bundle_path") or req.get("deliverable_bundle_path")
    if not bundle_path_str or not Path(bundle_path_str).exists():
        _fail(404, "Gói bằng chứng nghiên cứu (bundle ZIP) chưa được tạo hoặc chưa sẵn sàng.")

    bundle_p = Path(bundle_path_str)
    return FileResponse(
        path=str(bundle_p),
        media_type="application/zip",
        filename=f"zupirus_bundle_{req.get('product_type', 'study').lower()}_{req.get('symbol', 'study')}.zip",
    )
