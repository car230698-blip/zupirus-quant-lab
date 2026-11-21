"""Hindsight Long-term Memory Engine for AI Agents (vectorize-io/hindsight).
Provides Episodic, Semantic, and Reflective memory storage, consolidation, and contextual recall
for autonomous trading agents, risk officers, and quant research assistants."""
import time
import json
import secrets
import logging
from typing import List, Dict, Any, Optional, Tuple

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
    user_id: Optional[str] = None,
    scope: Optional[str] = None,
) -> str:
    """Stores a memory entry in the Hindsight long-term storage with strict tenant isolation."""
    if not content and title:
        content = title
        title = content[:60]
    elif not title and content:
        title = content[:60]

    resolved_user_id = user_id or (metadata or {}).get("user_id") or (metadata or {}).get("user")
    resolved_scope = scope or ("user" if resolved_user_id else "system")

    if c is None:
        try:
            from app.db import tx
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
                    user_id=resolved_user_id,
                    scope=resolved_scope,
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

    is_pg = bool(getattr(c, "_is_pg", False))
    if is_pg:
        try:
            c.execute("SAVEPOINT sp_hindsight_insert")
        except Exception:
            is_pg = False
    try:
        c.execute(
            """INSERT INTO hindsight_memories (id, category, entity_id, title, content, tags, relevance_score, created, user_id, scope)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (mid, category, entity_id, title, full_content, tag_str, float(relevance_score), now, resolved_user_id, resolved_scope),
        )
        if is_pg:
            c.execute("RELEASE SAVEPOINT sp_hindsight_insert")
        logger.info(f"Hindsight stored [{category}] {title} ({mid})")
    except Exception:
        if is_pg:
            try:
                c.execute("ROLLBACK TO SAVEPOINT sp_hindsight_insert")
            except Exception:
                pass
        try:
            c.execute(
                """INSERT INTO hindsight_memories (id, category, entity_id, title, content, tags, relevance_score, created)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (mid, category, entity_id, title, full_content, tag_str, float(relevance_score), now),
            )
        except Exception as e:
            logger.warning(f"Failed to store hindsight memory: {e}")
    return mid


def recall_memories(
    c=None,
    query: Optional[str] = None,
    category: Optional[str] = None,
    entity_id: Optional[str] = None,
    limit: int = 10,
    user_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Retrieves contextually relevant long-term memories with strict tenant isolation when user_id is specified."""
    if c is None:
        try:
            from app.db import tx
            with tx() as conn:
                return recall_memories(
                    conn,
                    query=query,
                    category=category,
                    entity_id=entity_id,
                    limit=limit,
                    user_id=user_id,
                )
        except Exception as e:
            logger.warning(f"Could not open transaction to recall memories: {e}")
            return []
    clauses = ["1=1"]
    params: List[Any] = []

    if user_id:
        clauses.append("(user_id = ? OR (scope = 'system' AND user_id IS NULL AND LOWER(category) IN ('semantic', 'reflective')))")
        params.append(user_id)

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
    sql = f"""SELECT id, category, entity_id, title, content, tags, relevance_score, created, user_id, scope
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
                "content": r[4], "tags": r[5], "relevance_score": r[6], "created": r[7],
                "user_id": r[8] if len(r) > 8 else None,
                "scope": r[9] if len(r) > 9 else "system",
            }
            d["tag_list"] = [t.strip() for t in (d.get("tags") or "").split(",") if t.strip()]
            results.append(d)
        return results
    except Exception as e:
        logger.warning(f"Error recalling hindsight memories: {e}")
        return []


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
    exit_reason: str = "TP",
    accumulate_pnl: bool = False,
) -> str:
    """Post-trade reflection: Updates signal audit record with real trade metrics
    and generates reflective memory to learn why the external signal succeeded or failed."""
    # 1. Update signal_audit_logs with real trade outcome
    context_data: Dict[str, Any] = {}
    side = "UNKNOWN"
    entry_price = 0.0
    effective_pnl = float(pnl or 0.0)
    try:
        row = c.execute(
            "SELECT side, entry_price, context_snapshot, pnl FROM signal_audit_logs WHERE signal_id = ?",
            (signal_id,)
        ).fetchone()
        if row:
            side = row["side"] if hasattr(row, 'keys') else row[0]
            entry_price = float(row["entry_price"] if hasattr(row, 'keys') else row[1])
            ctx_str = row["context_snapshot"] if hasattr(row, 'keys') else row[2]
            prev_pnl = row["pnl"] if hasattr(row, 'keys') else row[3]
            if ctx_str:
                context_data = json.loads(ctx_str)
            if accumulate_pnl and prev_pnl is not None:
                effective_pnl = round(float(prev_pnl) + effective_pnl, 2)

        c.execute(
            """
            UPDATE signal_audit_logs
            SET pnl = ?, mae = ?, mfe = ?
            WHERE signal_id = ?
            """,
            (effective_pnl, mae, mfe, signal_id)
        )
    except Exception as e:
        logger.warning(f"Could not update signal audit log outcome: {e}")

    # 2. Synthesize reflective post-mortem
    pnl = effective_pnl
    outcome = "WIN" if pnl > 0 else ("LOSS" if pnl < 0 else "BE")
    session = context_data.get("session", "Unknown")
    atr_val = context_data.get("atr_14", 3.50)
    news_dist = context_data.get("news_distance_mins", 999.0)

    pnl = float(pnl or 0.0)
    entry_price = float(entry_price or 0.0)
    exit_price = float(exit_price or 0.0)
    mae = float(mae or 0.0)
    mfe = float(mfe or 0.0)
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


def synthesize_inductive_rules(c, min_samples: Optional[int] = None) -> List[Dict[str, Any]]:
    """Tabula Rasa induction: Synthesizes high-probability semantic rules from observed
    winning signal clusters vs losing signal clusters (combining signal_audit_logs + graded shadow_signals)."""
    import os
    import re
    if min_samples is None:
        try:
            min_samples = int(os.getenv("MIN_INDUCTIVE_SAMPLES", "30").strip())
        except (ValueError, TypeError):
            min_samples = 30
    rows = []
    try:
        audit_rows = c.execute(
            """
            SELECT side, entry_price, pnl, context_snapshot
            FROM signal_audit_logs
            WHERE pnl IS NOT NULL AND context_snapshot IS NOT NULL
            ORDER BY created_at DESC LIMIT 200
            """
        ).fetchall()
        rows.extend(audit_rows)
    except Exception:
        pass

    try:
        from app.services.signal_ingestion.context import get_trading_session
        shadow_rows = c.execute(
            """
            SELECT side, entry_price, pnl_pips, signal_time
            FROM shadow_signals
            WHERE eval_status IN ('WIN_TP', 'LOSS_SL', 'EXPIRED', 'TIME_CLOSED') AND pnl_pips IS NOT NULL
            ORDER BY signal_time DESC LIMIT 200
            """
        ).fetchall()
        for sr in shadow_rows:
            s_side = sr["side"] if hasattr(sr, "keys") else sr[0]
            s_entry = sr["entry_price"] if hasattr(sr, "keys") else sr[1]
            s_pnl_pips = float(sr["pnl_pips"] if hasattr(sr, "keys") else sr[2])
            s_ts = float((sr["signal_time"] if hasattr(sr, "keys") else sr[3]) or time.time())
            rows.append({
                "side": s_side,
                "entry_price": s_entry,
                "pnl": s_pnl_pips,
                "is_shadow": True,
                "context_snapshot": json.dumps({"session": get_trading_session(s_ts)}),
            })
    except Exception as sh_err:
        logger.debug(f"Shadow signals induction query note: {sh_err}")

    if not rows or len(rows) < min_samples:
        return []

    # Cluster by session and side (with optional h1_trend & swept_liquidity microstructure clustering)
    clusters_detailed: Dict[Tuple[str, str, str, bool], List[float]] = {}
    clusters_legacy: Dict[Tuple[str, str], List[float]] = {}
    shadow_detailed: Dict[Tuple[str, str, str, bool], List[float]] = {}
    shadow_legacy: Dict[Tuple[str, str], List[float]] = {}

    for r in rows:
        side = r["side"] if hasattr(r, 'keys') else r[0]
        pnl = float(r["pnl"] if hasattr(r, 'keys') else r[2])
        ctx_str = r["context_snapshot"] if hasattr(r, 'keys') else r[3]
        is_sh = bool(r.get("is_shadow")) if isinstance(r, dict) else False
        session = "London"
        h1_trend = "NEUTRAL"
        swept = False
        if ctx_str:
            try:
                c_data = json.loads(ctx_str)
                session = c_data.get("session", "London")
                h1_trend = c_data.get("h1_trend", "NEUTRAL")
                swept = bool(c_data.get("swept_liquidity", False))
            except Exception:
                pass

        k_det = (session, side, h1_trend, swept)
        k_leg = (session, side)

        clusters_detailed.setdefault(k_det, []).append(pnl)
        clusters_legacy.setdefault(k_leg, []).append(pnl)
        if is_sh:
            shadow_detailed.setdefault(k_det, []).append(pnl)
            shadow_legacy.setdefault(k_leg, []).append(pnl)

    # If any detailed cluster meets min_samples, use detailed clustering; otherwise fallback to legacy 2-tuple
    if any(len(v) >= min_samples for v in clusters_detailed.values()):
        clusters = {k: v for k, v in clusters_detailed.items()}
        shadow_pips_clusters = shadow_detailed
        is_detailed = True
    else:
        clusters = {k: v for k, v in clusters_legacy.items()}
        shadow_pips_clusters = shadow_legacy
        is_detailed = False

    discovered_rules = []
    for cluster_key, pnls in clusters.items():
        if len(pnls) >= min_samples:
            if is_detailed:
                sess, side, h1_trend, swept = cluster_key
                micro_desc = f", H1 {h1_trend}" + (", Swept Liquidity" if swept else "")
                slug_extra = f"_{h1_trend.lower()}" + ("_swept" if swept else "")
            else:
                sess, side = cluster_key
                micro_desc = ""
                slug_extra = ""

            wins = sum(1 for p in pnls if p > 0)
            win_rate = round(wins / len(pnls), 2)
            sh_pips_list = shadow_pips_clusters.get(cluster_key, [])
            sh_pips_sum = round(sum(sh_pips_list), 2)
            live_usd_sum = round(sum(pnls) - sum(sh_pips_list), 2)
            total_pnl = live_usd_sum if (len(pnls) > len(sh_pips_list)) else sh_pips_sum
            expectancy_pips = round(total_pnl / len(pnls), 3)
            unit_lbl = "USD" if (len(pnls) > len(sh_pips_list) and not sh_pips_list) else ("pips (Shadow)" if len(sh_pips_list) == len(pnls) else f"USD (Live: {live_usd_sum:+.2f} USD, Shadow: {sh_pips_sum:+.1f} pips)")
            if win_rate >= 0.58 and total_pnl > 0 and expectancy_pips > 0:
                rule_desc = f"Quy tắc quy nạp: Trong phiên {sess}{micro_desc}, tín hiệu {side} có xác suất thắng {win_rate*100:.0f}%, kỳ vọng {expectancy_pips:+.2f} {unit_lbl}/lệnh (Mẫu: {len(pnls)} lệnh, Hiệu suất: {total_pnl:+.2f} {unit_lbl})."
                store_memory(
                    c,
                    category=CATEGORY_SEMANTIC,
                    title=f"Discovered Rule: {sess}{micro_desc} {side} Edge",
                    content=rule_desc,
                    tags=["discovered_rule", sess.lower(), side.lower(), "inductive"],
                    metadata={"session": sess, "side": side, "win_rate": win_rate, "sample_size": len(pnls)}
                )

                # Persist self-learned skill into Agent Skill Registry (slugify session to avoid '/' in skill_id)
                sess_slug = re.sub(r"[^a-z0-9]+", "_", sess.lower()).strip("_")
                side_slug = re.sub(r"[^a-z0-9]+", "_", side.lower()).strip("_")
                learned_skill_id = f"learned_{sess_slug}_{side_slug}{slug_extra}_filter"
                learned_name = f"Learned Filter: {sess}{micro_desc} {side} Edge"
                learned_desc = f"Bộ lọc tự học: Tín hiệu {side} trong phiên {sess}{micro_desc} đạt WinRate {win_rate*100:.0f}% ({len(pnls)} lệnh thực tế)."
                learned_trigger = f"Khi có tín hiệu {side} phát sinh trong phiên {sess}{micro_desc}."
                learned_md = f"""# Kỹ Năng Tự Học: {learned_name}

## Nguồn Gốc & Dữ Liệu Thực Chiến
Được đúc kết tự động qua vòng lặp phản tư (Reflective Memory) của AI Agent từ {len(pnls)} lệnh thực tế.
- Phiên giao dịch: {sess}{micro_desc}
- Hướng lệnh: {side}
- Tỷ lệ thắng thực nghiệm: {win_rate*100:.0f}%
- Hiệu suất tích lũy: {total_pnl:+.2f} {unit_lbl}

## Hướng Dẫn Kích Hoạt
Khi có tín hiệu {side} được gửi đến trong phiên {sess}{micro_desc}, AI Agent đối chiếu với quy tắc này để ưu tiên giữ lệnh hoặc cộng thêm điểm số tin cậy cho nguồn phát tín hiệu.
"""
                try:
                    from app.skills.registry import register_learned_skill
                    register_learned_skill(
                        skill_id=learned_skill_id,
                        name=learned_name,
                        description=learned_desc,
                        trigger_condition=learned_trigger,
                        skill_md=learned_md,
                        db_cursor=c
                    )
                except Exception as e:
                    logger.debug(f"Could not register learned skill {learned_skill_id}: {e}")

                discovered_rules.append({
                    "session": sess,
                    "side": side,
                    "win_rate": win_rate,
                    "samples": len(pnls),
                    "rule": rule_desc,
                    "skill_id": learned_skill_id,
                })
            elif win_rate <= 0.38 and total_pnl < 0:
                # Self-learned Hazard Guard: Learn from repeated losses and block toxic clusters
                rule_desc = f"Quy tắc cảnh báo rủi ro: Trong phiên {sess}, tín hiệu {side} có xác suất thua cao ({100 - win_rate*100:.0f}%, PnL âm: {total_pnl:+.2f} {unit_lbl}, Mẫu: {len(pnls)} lệnh). Khuyến nghị chặn chiều này để bảo toàn vốn."
                store_memory(
                    c,
                    category=CATEGORY_SEMANTIC,
                    title=f"Discovered Hazard: Avoid {sess} {side}",
                    content=rule_desc,
                    tags=["discovered_hazard", "avoid_rule", sess.lower(), side.lower(), "inductive"],
                    metadata={"session": sess, "side": side, "win_rate": win_rate, "sample_size": len(pnls), "hazard": True}
                )
                sess_slug = re.sub(r"[^a-z0-9]+", "_", sess.lower()).strip("_")
                side_slug = re.sub(r"[^a-z0-9]+", "_", side.lower()).strip("_")
                learned_skill_id = f"learned_{sess_slug}_{side_slug}_avoid"
                learned_name = f"Learned Hazard Guard: Avoid {sess} {side}"
                learned_desc = f"Lá chắn tự học: Tránh vào lệnh {side} trong phiên {sess} do xác suất thua cao ({100 - win_rate*100:.0f}% thua qua {len(pnls)} lệnh thực tế)."
                learned_trigger = f"Khi có tín hiệu {side} phát sinh trong phiên {sess}."
                learned_md = f"""# Lá Chắn Rủi Ro Tự Học: {learned_name}

## Nguồn Gốc & Thống Kê Thua Lỗ Thực Chiến
Được đúc kết tự động qua bài học phản tư (Reflective Memory) của AI Agent từ {len(pnls)} lệnh thực tế nhằm ngăn ngừa lặp lại chuỗi thua.
- Phiên giao dịch: {sess}
- Hướng lệnh cần tránh: {side}
- Tỷ lệ thua: {100 - win_rate*100:.0f}% (WinRate chỉ {win_rate*100:.0f}%)
- Khoản lỗ tích lũy: {total_pnl:+.2f} {unit_lbl}

## Hướng Dẫn Kích Hoạt
Khi có tín hiệu {side} phát sinh trong phiên {sess}, bộ điều phối tự động kích hoạt lá chắn này để CHẶN lệnh, bảo vệ tài khoản khỏi rủi ro sụt giảm vốn lặp lại.
"""
                try:
                    from app.skills.registry import register_learned_skill
                    register_learned_skill(
                        skill_id=learned_skill_id,
                        name=learned_name,
                        description=learned_desc,
                        trigger_condition=learned_trigger,
                        skill_md=learned_md,
                        db_cursor=c,
                        auto_approve=True,
                    )
                except Exception as e:
                    logger.debug(f"Could not register learned hazard guard {learned_skill_id}: {e}")

                discovered_rules.append({
                    "session": sess,
                    "side": side,
                    "win_rate": win_rate,
                    "samples": len(pnls),
                    "rule": rule_desc,
                    "skill_id": learned_skill_id,
                    "action": "AVOID",
                })

    return discovered_rules

