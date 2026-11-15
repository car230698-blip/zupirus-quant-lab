"""Hindsight Long-term Memory Engine for AI Agents (vectorize-io/hindsight).
Provides Episodic, Semantic, and Reflective memory storage, consolidation, and contextual recall
for autonomous trading agents, risk officers, and quant research assistants."""
import time
import json
import secrets
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger("zupirus.hindsight")

CATEGORY_EPISODIC = "episodic"      # Time-bound event logs (order execution, news blackout hit, broker crash)
CATEGORY_SEMANTIC = "semantic"      # Consolidated domain rules & customer preferences
CATEGORY_REFLECTIVE = "reflective"  # Post-trade evaluation, WFO policy reflections, post-mortems


def store_memory(
    c=None,
    category: str = "episodic",
    title: str = "",
    content: str = "",
    entity_id: Optional[str] = None,
    tags: Optional[List[str]] = None,
    relevance_score: float = 1.0,
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """Stores a memory entry in the Hindsight long-term storage."""
    if not content and title:
        content = title
        title = content[:60]
    elif not title and content:
        title = content[:60]

    if c is None:
        try:
            from .db import tx
            with tx() as conn:
                return store_memory(
                    conn,
                    category=category,
                    title=title,
                    content=content,
                    entity_id=entity_id,
                    tags=tags,
                    relevance_score=relevance_score,
                    metadata=metadata,
                )
        except Exception as e:
            logger.warning(f"Could not open transaction to store memory: {e}")
            return ""

    mid = f"mem_{secrets.token_hex(8)}"
    now = time.time()
    tag_str = ",".join(tags) if tags else ""
    meta_json = json.dumps(metadata or {})
    full_content = content
    if metadata:
        full_content = f"{content} | meta:{meta_json}"

    try:
        c.execute(
            """INSERT INTO hindsight_memories (id, category, entity_id, title, content, tags, relevance_score, created)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (mid, category, entity_id, title, full_content, tag_str, float(relevance_score), now),
        )
        logger.info(f"Hindsight stored [{category}] {title} ({mid})")
    except Exception as e:
        logger.warning(f"Failed to store hindsight memory: {e}")
    return mid


def recall_memories(
    c=None,
    query: Optional[str] = None,
    category: Optional[str] = None,
    entity_id: Optional[str] = None,
    limit: int = 10,
) -> List[Dict[str, Any]]:
    """Retrieves contextually relevant long-term memories for an Agent's reasoning context."""
    if c is None:
        try:
            from .db import tx
            with tx() as conn:
                return recall_memories(
                    conn,
                    query=query,
                    category=category,
                    entity_id=entity_id,
                    limit=limit,
                )
        except Exception as e:
            logger.warning(f"Could not open transaction to recall memories: {e}")
            return []
    clauses = ["1=1"]
    params: List[Any] = []

    if category:
        clauses.append("category = ?")
        params.append(category)

    if entity_id:
        clauses.append("entity_id = ?")
        params.append(entity_id)

    if query and query.strip():
        q_term = f"%{query.strip().lower()}%"
        clauses.append("(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ?)")
        params.extend([q_term, q_term, q_term])

    where_sql = " AND ".join(clauses)
    sql = f"""SELECT id, category, entity_id, title, content, tags, relevance_score, created
              FROM hindsight_memories
              WHERE {where_sql}
              ORDER BY created DESC
              LIMIT ?"""
    params.append(limit)

    try:
        rows = c.execute(sql, params).fetchall()
        results = []
        for r in rows:
            d = dict(r) if hasattr(r, 'keys') else {
                "id": r[0], "category": r[1], "entity_id": r[2], "title": r[3],
                "content": r[4], "tags": r[5], "relevance_score": r[6], "created": r[7]
            }
            # Parse tags
            d["tag_list"] = [t.strip() for t in (d.get("tags") or "").split(",") if t.strip()]
            results.append(d)
        return results
    except Exception as e:
        logger.warning(f"Error recalling hindsight memories: {e}")
        return []


def reflect_on_execution(c, account_id: str, order_info: Dict[str, Any]) -> str:
    """Forms a reflective memory following an order fill or broker reconciliation."""
    side = order_info.get("side", "UNKNOWN")
    ticket = order_info.get("ticket", "N/A")
    deal = order_info.get("deal", "N/A")
    price = order_info.get("fill_price") or order_info.get("price", 0.0)
    sl = order_info.get("sl", 0.0)
    tp = order_info.get("tp", 0.0)

    title = f"Reflective Trade Insight: {side} XAUUSD #{ticket}"
    content = (
        f"Lệnh {side} tài khoản {account_id[:8]} đã khớp tại mức giá ${price:.2f} "
        f"(SL: ${sl:.2f}, TP: ${tp:.2f}, Deal: {deal}). Hệ thống đã chiếm Distributed Lock "
        f"thành công và đối soát vé với MetaTrader 5 Terminal."
    )
    return store_memory(
        c,
        category=CATEGORY_EPISODIC,
        title=title,
        content=content,
        entity_id=account_id,
        tags=["trade_execution", "mt5_fill", side.lower()],
        metadata=order_info,
    )


def reflect_on_policy_approval(c, job_id: str, approved: bool, report: Dict[str, Any]) -> str:
    """Forms a reflective memory following Admin's Walk-Forward candidate decision."""
    disposition = "approved_for_demo_review" if approved else "rejected"
    oos_net = report.get("oos_net_price_units", 0.0)
    dd = report.get("max_drawdown_price_units", 0.0)

    title = f"Policy Reflection: Job {job_id[:8]} ({disposition.upper()})"
    content = (
        f"Chiến lược WFO #{job_id} đã được người quản trị quyết định: {disposition.upper()}. "
        f"Chỉ số Out-of-Sample: Lợi nhuận ròng={oos_net:.2f} pts, Drawdown tối đa={dd:.2f} pts, "
        f"Số vòng kiểm định={len(report.get('folds', []))}. Bài học kinh nghiệm: Các mô hình có OOS dương "
        f"và DD thấp được ưu tiên chuyển sang giai đoạn review Demo."
    )
    return store_memory(
        c,
        category=CATEGORY_REFLECTIVE,
        title=title,
        content=content,
        entity_id=job_id,
        tags=["wfo_decision", "admin_approval", disposition],
        metadata={"job_id": job_id, "approved": approved, "oos_net": oos_net, "dd": dd},
    )


def reflect_on_signal_outcome(
    c,
    signal_id: str,
    pnl: float,
    mae: float = 0.0,
    mfe: float = 0.0,
    exit_price: float = 0.0,
    exit_reason: str = "TP"
) -> str:
    """Post-trade reflection: Updates signal audit record with real trade metrics
    and generates reflective memory to learn why the external signal succeeded or failed."""
    # 1. Update signal_audit_logs with real trade outcome
    context_data: Dict[str, Any] = {}
    side = "UNKNOWN"
    entry_price = 0.0
    try:
        row = c.execute(
            "SELECT side, entry_price, context_snapshot FROM signal_audit_logs WHERE signal_id = ?",
            (signal_id,)
        ).fetchone()
        if row:
            side = row["side"] if hasattr(row, 'keys') else row[0]
            entry_price = float(row["entry_price"] if hasattr(row, 'keys') else row[1])
            ctx_str = row["context_snapshot"] if hasattr(row, 'keys') else row[2]
            if ctx_str:
                context_data = json.loads(ctx_str)

        c.execute(
            """
            UPDATE signal_audit_logs
            SET pnl = ?, mae = ?, mfe = ?
            WHERE signal_id = ?
            """,
            (pnl, mae, mfe, signal_id)
        )
    except Exception as e:
        logger.warning(f"Could not update signal audit log outcome: {e}")

    # 2. Synthesize reflective post-mortem
    outcome = "WIN" if pnl > 0 else ("LOSS" if pnl < 0 else "BE")
    session = context_data.get("session", "Unknown")
    atr_val = context_data.get("atr_14", 3.50)
    news_dist = context_data.get("news_distance_mins", 999.0)

    title = f"Post-Trade Reflection: Signal #{signal_id[:8]} [{outcome} | PnL={pnl:+.2f}]"
    content = (
        f"Lệnh {side} tín hiệu #{signal_id[:8]} (Vào: ${entry_price:.2f}, Thoát: ${exit_price:.2f}, Lý do: {exit_reason}) "
        f"đạt kết quả {outcome} với PnL={pnl:+.2f} USD, Gồng lỗ tối đa (MAE)={mae:.2f} pts, "
        f"Lợi nhuận đỉnh (MFE)={mfe:.2f} pts. Bối cảnh vào lệnh: Phiên {session}, ATR={atr_val}, Cách tin={news_dist}m. "
        f"Bài học đúc kết: {'Điều kiện thị trường ủng hộ đà di chuyển.' if pnl > 0 else 'Thị trường có thể chịu cản lớn hoặc quét thanh khoản ngược hướng.'}"
    )

    return store_memory(
        c,
        category=CATEGORY_REFLECTIVE,
        title=title,
        content=content,
        entity_id=signal_id,
        tags=["signal_post_mortem", outcome.lower(), session.lower(), side.lower()],
        metadata={
            "signal_id": signal_id,
            "pnl": pnl,
            "mae": mae,
            "mfe": mfe,
            "exit_reason": exit_reason,
            "context": context_data,
        }
    )


def synthesize_inductive_rules(c, min_samples: int = 5) -> List[Dict[str, Any]]:
    """Tabula Rasa induction: Synthesizes high-probability semantic rules from observed
    winning signal clusters vs losing signal clusters."""
    try:
        rows = c.execute(
            """
            SELECT side, entry_price, pnl, context_snapshot
            FROM signal_audit_logs
            WHERE pnl IS NOT NULL AND context_snapshot IS NOT NULL
            ORDER BY created_at DESC LIMIT 200
            """
        ).fetchall()
    except Exception:
        return []

    if not rows or len(rows) < min_samples:
        return []

    # Cluster by session and side
    clusters: Dict[Tuple[str, str], List[float]] = {}
    for r in rows:
        side = r["side"] if hasattr(r, 'keys') else r[0]
        pnl = float(r["pnl"] if hasattr(r, 'keys') else r[2])
        ctx_str = r["context_snapshot"] if hasattr(r, 'keys') else r[3]
        session = "London"
        if ctx_str:
            try:
                session = json.loads(ctx_str).get("session", "London")
            except Exception:
                pass
        key = (session, side)
        clusters.setdefault(key, []).append(pnl)

    discovered_rules = []
    for (sess, side), pnls in clusters.items():
        if len(pnls) >= min_samples:
            wins = sum(1 for p in pnls if p > 0)
            win_rate = round(wins / len(pnls), 2)
            total_pnl = round(sum(pnls), 2)
            if win_rate >= 0.60:
                rule_desc = f"Quy tắc quy nạp: Trong phiên {sess}, tín hiệu {side} có xác suất thắng {win_rate*100:.0f}% (Mẫu: {len(pnls)} lệnh, Tổng PnL: {total_pnl:+.2f})."
                store_memory(
                    c,
                    category=CATEGORY_SEMANTIC,
                    title=f"Discovered Rule: {sess} {side} Edge",
                    content=rule_desc,
                    tags=["discovered_rule", sess.lower(), side.lower(), "inductive"],
                    metadata={"session": sess, "side": side, "win_rate": win_rate, "sample_size": len(pnls)}
                )
                discovered_rules.append({
                    "session": sess,
                    "side": side,
                    "win_rate": win_rate,
                    "samples": len(pnls),
                    "rule": rule_desc,
                })

    return discovered_rules

