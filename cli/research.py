"""Research Team validation, proposals queue, and strategy approval workflow for zupirus-cli."""
import time
import json
import secrets
from typing import Optional, List, Dict, Any

from app.db import tx, init, ROOT
from app.research import walk_forward
from cli.formatters import emit_json, emit_error, format_table


def cmd_research_run_validation(cutoff: Optional[float] = None, as_json: bool = False):
    """Kích hoạt kiểm định Walk-Forward Out-of-Sample trên dữ liệu replay và tạo đề xuất chờ duyệt."""
    init()
    now = time.time()
    replay_file = ROOT / "data/replay.json"
    if not replay_file.exists():
        emit_error(f"Replay data file not found at {replay_file}", as_json=as_json)

    raw_data = json.loads(replay_file.read_text())
    prices = [x["close"] for x in raw_data]

    if cutoff is not None:
        # Filter prices up to cutoff index or timestamp
        if cutoff < len(prices):
            prices = prices[:int(cutoff)]

    # Compute walk-forward report
    report = walk_forward(prices)

    # Create job paused at LangGraph interrupt point (state='waiting_approval')
    jid = f"wf_{secrets.token_hex(12)}"
    saved_state = {
        "report": report,
        "interrupted_at": now,
        "interrupt_node": "admin_review",
        "notice": "Approval archives a research candidate only. No live promotion."
    }

    with tx() as c:
        c.execute(
            "INSERT INTO jobs(id, state, decision, result, error, created) VALUES(?,?,?,?,?,?)",
            (jid, "waiting_approval", None, json.dumps(saved_state), None, now)
        )
        c.execute(
            "INSERT INTO audit(ts, actor, event, detail) VALUES(?,?,?,?)",
            (now, "zupirus-cli", "walk_forward_validation_completed", json.dumps({"job_id": jid, "oos_pnl": report["oos_net_price_units"]}))
        )

    payload = {
        "success": True,
        "proposal_id": jid,
        "state": "waiting_approval",
        "method": report.get("method"),
        "strategy": report.get("strategy"),
        "folds_count": len(report.get("folds", [])),
        "oos_net_price_units": report.get("oos_net_price_units"),
        "max_drawdown_price_units": report.get("max_drawdown_price_units"),
        "total_trades": report.get("trades"),
        "production_qualified": False,
        "requires_approval": True,
        "checkpoint_status": "INTERRUPTED: Stored in checkpointer awaiting admin decision",
        "created_at": round(now, 3)
    }

    if as_json:
        emit_json(payload)

    print("\n[WALK-FORWARD VALIDATION COMPLETED]")
    print(f"Proposal ID     : {jid}")
    print(f"Workflow State  : WAITING_APPROVAL (Paused at LangGraph Interrupt)")
    print(f"Strategy Model  : {report.get('strategy')}")
    print(f"Folds Tested    : {len(report.get('folds', []))} rolling folds")
    print(f"OOS Net Return  : +{report.get('oos_net_price_units')} price units")
    print(f"Max Drawdown    : {report.get('max_drawdown_price_units')} price units")
    print(f"Trades Executed : {report.get('trades')}")
    print(f"\nNext Steps:\n  zupirus-cli research approve {jid} --reason \"Passed criteria\"\n  zupirus-cli research reject {jid} --reason \"Too high drawdown\"")


def cmd_research_pending(as_json: bool = False):
    """Liệt kê các đề xuất chiến lược đang dừng ở điểm interrupt chờ Admin duyệt."""
    init()

    with tx() as c:
        rows = c.execute("SELECT * FROM jobs WHERE state='waiting_approval' ORDER BY created DESC").fetchall()

    pending_list: List[Dict[str, Any]] = []
    for r in rows:
        jid = r["id"]
        created = float(r["created"])
        report = {}
        if r["result"]:
            try:
                parsed = json.loads(r["result"])
                report = parsed.get("report", parsed)
            except Exception:
                report = {}

        pending_list.append({
            "proposal_id": jid,
            "state": r["state"],
            "created_at": created,
            "created_time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(created)),
            "strategy": report.get("strategy", "SMA Crossover Walk-Forward"),
            "folds_count": len(report.get("folds", [])),
            "oos_net_price_units": report.get("oos_net_price_units", 0.0),
            "max_drawdown_price_units": report.get("max_drawdown_price_units", 0.0),
            "trades": report.get("trades", 0)
        })

    payload = {
        "success": True,
        "pending_count": len(pending_list),
        "proposals": pending_list
    }

    if as_json:
        emit_json(payload)

    headers = ["Proposal ID", "Created At", "Folds", "OOS Net PnL", "Max DD", "Trades", "State"]
    rows_data = [
        [
            p["proposal_id"],
            p["created_time"],
            p["folds_count"],
            f"+{p['oos_net_price_units']}" if p["oos_net_price_units"] >= 0 else str(p["oos_net_price_units"]),
            p["max_drawdown_price_units"],
            p["trades"],
            p["state"].upper()
        ]
        for p in pending_list
    ]

    print("=" * 80)
    print(f"  ZUPIRUS QUANT LAB · PENDING RESEARCH PROPOSALS ({len(pending_list)})")
    print("=" * 80)
    print(format_table(headers, rows_data))
    print("=" * 80)


def cmd_research_approve(proposal_id: str, reviewer: str = "admin", reason: str = "", as_json: bool = False):
    """Phê duyệt đề xuất chiến lược và lưu checkpoint lưu trữ ứng viên nghiên cứu."""
    init()
    clean_id = (proposal_id or "").strip()
    if not clean_id:
        emit_error("Missing required proposal_id parameter.", as_json=as_json)

    now = time.time()
    reason_text = reason.strip() or "Approved via zupirus-cli"

    with tx() as c:
        row = c.execute("SELECT * FROM jobs WHERE id=?", (clean_id,)).fetchone()
        if not row:
            emit_error(f"Proposal '{clean_id}' not found.", as_json=as_json)
        if row["state"] != "waiting_approval":
            emit_error(f"Proposal '{clean_id}' is in state '{row['state']}' (must be 'waiting_approval').", as_json=as_json)

        # Update saved state
        result_data = {}
        if row["result"]:
            try:
                result_data = json.loads(row["result"])
            except Exception:
                result_data = {}

        result_data["approved"] = True
        result_data["disposition"] = "approved_for_demo_review"
        result_data["reviewer"] = reviewer
        result_data["reason"] = reason_text
        result_data["resolved_at"] = now

        c.execute(
            "UPDATE jobs SET state='completed', decision=1, result=?, error=NULL WHERE id=?",
            (json.dumps(result_data), clean_id)
        )
        c.execute(
            "INSERT INTO audit(ts, actor, event, detail) VALUES(?,?,?,?)",
            (now, reviewer, "research_approved", json.dumps({"proposal_id": clean_id, "reason": reason_text}))
        )

    payload = {
        "success": True,
        "proposal_id": clean_id,
        "decision": "APPROVED",
        "disposition": "approved_for_demo_review",
        "reviewer": reviewer,
        "reason": reason_text,
        "state": "completed",
        "archived_as_candidate": True,
        "live_promotion_allowed": False,
        "resolved_at": round(now, 3)
    }

    if as_json:
        emit_json(payload)

    print(f"\n[PROPOSAL APPROVED]")
    print(f"Proposal ID : {clean_id}")
    print(f"Decision    : APPROVED (Candidate archived for demo evaluation)")
    print(f"Reviewer    : {reviewer}")
    print(f"Reason      : {reason_text}")
    print(f"Status      : COMPLETED")


def cmd_research_reject(proposal_id: str, reviewer: str = "admin", reason: str = "", as_json: bool = False):
    """Từ chối đề xuất chiến lược và lưu checkpoint loại bỏ."""
    init()
    clean_id = (proposal_id or "").strip()
    if not clean_id:
        emit_error("Missing required proposal_id parameter.", as_json=as_json)

    now = time.time()
    reason_text = reason.strip() or "Rejected via zupirus-cli"

    with tx() as c:
        row = c.execute("SELECT * FROM jobs WHERE id=?", (clean_id,)).fetchone()
        if not row:
            emit_error(f"Proposal '{clean_id}' not found.", as_json=as_json)
        if row["state"] != "waiting_approval":
            emit_error(f"Proposal '{clean_id}' is in state '{row['state']}' (must be 'waiting_approval').", as_json=as_json)

        result_data = {}
        if row["result"]:
            try:
                result_data = json.loads(row["result"])
            except Exception:
                result_data = {}

        result_data["approved"] = False
        result_data["disposition"] = "rejected"
        result_data["reviewer"] = reviewer
        result_data["reason"] = reason_text
        result_data["resolved_at"] = now

        c.execute(
            "UPDATE jobs SET state='completed', decision=0, result=?, error=NULL WHERE id=?",
            (json.dumps(result_data), clean_id)
        )
        c.execute(
            "INSERT INTO audit(ts, actor, event, detail) VALUES(?,?,?,?)",
            (now, reviewer, "research_rejected", json.dumps({"proposal_id": clean_id, "reason": reason_text}))
        )

    payload = {
        "success": True,
        "proposal_id": clean_id,
        "decision": "REJECTED",
        "disposition": "rejected",
        "reviewer": reviewer,
        "reason": reason_text,
        "state": "completed",
        "resolved_at": round(now, 3)
    }

    if as_json:
        emit_json(payload)

    print(f"\n[PROPOSAL REJECTED]")
    print(f"Proposal ID : {clean_id}")
    print(f"Decision    : REJECTED (Candidate discarded)")
    print(f"Reviewer    : {reviewer}")
    print(f"Reason      : {reason_text}")
    print(f"Status      : COMPLETED")
