"""Main CLI dispatcher for zupirus-cli following CLI-Anything architecture.
Making ZUPIRUS Quant Lab agent-native for 100% terminal-driven autonomous operation."""
import sys
import logging
import argparse
from typing import List, Optional

from cli.formatters import emit_error
from cli.system import cmd_status, cmd_kill_switch, cmd_healthcheck
from cli.signal import (
    cmd_signal_send_test,
    cmd_signal_trace,
    cmd_signal_test_ingest,
    cmd_signal_list_audit,
)
from cli.billing import cmd_billing_fx, cmd_billing_orders
from cli.research import (
    cmd_research_run_validation,
    cmd_research_pending,
    cmd_research_approve,
    cmd_research_reject,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="zupirus-cli",
        description="ZUPIRUS Quant Lab · Agent-Native Internal Operations & Acceptance CLI"
    )
    parser.add_argument("--json", action="store_true", help="Output pure machine-readable JSON (agent-native)")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose diagnostics (stderr only)")

    subparsers = parser.add_subparsers(dest="command", help="Operational domain commands")

    # -------------------------------------------------------------
    # 1. SYSTEM DOMAIN
    # -------------------------------------------------------------
    p_system = subparsers.add_parser("system", help="System health, databases, and emergency controls")
    system_subs = p_system.add_subparsers(dest="subcommand")

    # system status
    p_sys_status = system_subs.add_parser("status", help="Inspect DB, Redis, Price Feed, Workers, and Locks")
    p_sys_status.add_argument("--json", action="store_true", help="Output pure JSON")

    # system healthcheck
    p_sys_health = system_subs.add_parser("healthcheck", help="Quick system and database health check")
    p_sys_health.add_argument("--json", action="store_true", help="Output pure JSON")

    # system kill-switch
    p_sys_kill = system_subs.add_parser("kill-switch", help="Activate or deactivate emergency halt")
    group_kill = p_sys_kill.add_mutually_exclusive_group(required=True)
    group_kill.add_argument("--on", action="store_true", help="Engage emergency kill switch (halt execution)")
    group_kill.add_argument("--off", action="store_true", help="Disengage emergency kill switch (resume execution)")
    p_sys_kill.add_argument("--reason", type=str, default="", help="Audit explanation for state transition")
    p_sys_kill.add_argument("--json", action="store_true", help="Output pure JSON")

    # -------------------------------------------------------------
    # 2. SIGNAL & DISPATCH DOMAIN
    # -------------------------------------------------------------
    p_sig = subparsers.add_parser("signal", help="Signal generation, testing, and lifecycle tracing")
    sig_subs = p_sig.add_subparsers(dest="subcommand")

    # signal send-test
    p_sig_send = sig_subs.add_parser("send-test", help="Dispatch test signal to a demo account via full pipeline")
    p_sig_send.add_argument("--account", type=str, required=True, help="Target account login")
    p_sig_send.add_argument("--side", type=str, required=True, choices=["BUY", "SELL", "buy", "sell"], help="Order direction")
    p_sig_send.add_argument("--lot", type=float, default=0.01, help="Lot volume (default 0.01)")
    p_sig_send.add_argument("--price", type=float, default=None, help="Explicit entry price (optional)")
    p_sig_send.add_argument("--force", action="store_true", help="Bypass enabled account check")
    p_sig_send.add_argument("--json", action="store_true", help="Output pure JSON")

    # signal trace
    p_sig_trace = sig_subs.add_parser("trace", help="Trace signal from DB -> Redis -> EA -> Deal Ticket")
    p_sig_trace.add_argument("signal_id", type=str, help="Signal ID to trace")
    p_sig_trace.add_argument("--json", action="store_true", help="Output pure JSON")

    # signal test-ingest
    p_sig_ingest = sig_subs.add_parser("test-ingest", help="Test ingest signal through 4 safety guards")
    p_sig_ingest.add_argument("--action", type=str, required=True, choices=["BUY", "SELL", "buy", "sell"], help="Order direction")
    p_sig_ingest.add_argument("--price", type=float, required=True, help="Entry price")
    p_sig_ingest.add_argument("--sl", type=float, default=None, help="Stop loss price (optional)")
    p_sig_ingest.add_argument("--tp", type=float, default=None, help="Take profit price (optional)")
    p_sig_ingest.add_argument("--tier", type=str, default="STANDARD", choices=["STANDARD", "ALPHA"], help="Strategy tier")
    p_sig_ingest.add_argument("--symbol", type=str, default="XAUUSD", help="Symbol (default XAUUSD)")
    p_sig_ingest.add_argument("--json", action="store_true", help="Output pure JSON")

    # signal list-audit
    p_sig_audit = sig_subs.add_parser("list-audit", help="List recent signal audit logs from the safety pipeline")
    p_sig_audit.add_argument("--limit", type=int, default=20, help="Max records to return")
    p_sig_audit.add_argument("--json", action="store_true", help="Output pure JSON")

    # -------------------------------------------------------------
    # 4. BILLING & FX DOMAIN
    # -------------------------------------------------------------
    p_bill = subparsers.add_parser("billing", help="Real-time FX rates, subscription tiers, and orders")
    bill_subs = p_bill.add_subparsers(dest="subcommand")

    # billing fx
    p_bill_fx = bill_subs.add_parser("fx", help="Inspect real-time USD/VND rate and pricing")
    p_bill_fx.add_argument("--force", action="store_true", help="Force refresh from external FX API")
    p_bill_fx.add_argument("--json", action="store_true", help="Output pure JSON")

    # billing orders
    p_bill_ord = bill_subs.add_parser("orders", help="List subscription & cloud slot orders")
    p_bill_ord.add_argument("--limit", type=int, default=20, help="Max orders to return")
    p_bill_ord.add_argument("--json", action="store_true", help="Output pure JSON")

    # -------------------------------------------------------------
    # 4. RESEARCH & APPROVAL DOMAIN
    # -------------------------------------------------------------
    p_res = subparsers.add_parser("research", help="Walk-forward validation, proposals queue, and approvals")
    res_subs = p_res.add_subparsers(dest="subcommand")

    # research run-validation
    p_res_run = res_subs.add_parser("run-validation", help="Trigger Walk-Forward Out-of-Sample analysis")
    p_res_run.add_argument("--cutoff", type=float, default=None, help="Cutoff index or timestamp for replay data")
    p_res_run.add_argument("--json", action="store_true", help="Output pure JSON")

    # research pending
    p_res_pending = res_subs.add_parser("pending", help="List strategy proposals waiting at interrupt for approval")
    p_res_pending.add_argument("--json", action="store_true", help="Output pure JSON")

    # research approve
    p_res_app = res_subs.add_parser("approve", help="Approve strategy proposal at checkpoint")
    p_res_app.add_argument("proposal_id", type=str, help="Proposal ID (job id)")
    p_res_app.add_argument("--reviewer", type=str, default="admin", help="Admin reviewer identifier")
    p_res_app.add_argument("--reason", type=str, default="", help="Approval comments")
    p_res_app.add_argument("--json", action="store_true", help="Output pure JSON")

    # research reject
    p_res_rej = res_subs.add_parser("reject", help="Reject strategy proposal at checkpoint")
    p_res_rej.add_argument("proposal_id", type=str, help="Proposal ID (job id)")
    p_res_rej.add_argument("--reviewer", type=str, default="admin", help="Admin reviewer identifier")
    p_res_rej.add_argument("--reason", type=str, default="", help="Rejection comments")
    p_res_rej.add_argument("--json", action="store_true", help="Output pure JSON")

    # -------------------------------------------------------------
    # 6. TOP-LEVEL HEALTHCHECK
    # -------------------------------------------------------------
    p_health = subparsers.add_parser("healthcheck", help="Quick system and database health check")
    p_health.add_argument("--json", action="store_true", help="Output pure JSON")

    return parser


def main(argv: Optional[List[str]] = None):
    args_list = argv if argv is not None else sys.argv[1:]

    # Early detection of --json flag to silence noisy loggers completely
    as_json = "--json" in args_list
    if as_json:
        # Redirect all standard python logging to CRITICAL or null to keep stdout 100% clean JSON
        logging.basicConfig(level=logging.CRITICAL, stream=sys.stderr)
        for log_name in ("zupirus.db", "zupirus.redis", "zupirus.migrations", "urllib3"):
            logging.getLogger(log_name).setLevel(logging.CRITICAL)
    else:
        logging.basicConfig(level=logging.WARNING, format="%(message)s")

    parser = build_parser()
    if not args_list:
        parser.print_help()
        sys.exit(0)

    try:
        args = parser.parse_args(args_list)
    except SystemExit as e:
        sys.exit(e.code)

    # Determine effective json mode (global or subcommand)
    effective_json = getattr(args, "json", False) or as_json

    if not args.command:
        parser.print_help()
        sys.exit(0)

    try:
        if args.command == "healthcheck":
            cmd_healthcheck(as_json=effective_json)

        elif args.command == "system":
            if args.subcommand == "status":
                cmd_status(as_json=effective_json)
            elif args.subcommand == "healthcheck":
                cmd_healthcheck(as_json=effective_json)
            elif args.subcommand == "kill-switch":
                cmd_kill_switch(on=args.on, off=args.off, reason=args.reason, as_json=effective_json)
            else:
                emit_error(f"Unknown system subcommand '{args.subcommand}'. Use --help.", as_json=effective_json)

        elif args.command == "signal":
            if args.subcommand == "send-test":
                cmd_signal_send_test(
                    account_login=args.account,
                    side=args.side,
                    lot=args.lot,
                    price=args.price,
                    force=args.force,
                    as_json=effective_json
                )
            elif args.subcommand == "trace":
                cmd_signal_trace(signal_id=args.signal_id, as_json=effective_json)
            elif args.subcommand == "test-ingest":
                cmd_signal_test_ingest(
                    action=args.action,
                    price=args.price,
                    sl=args.sl,
                    tp=args.tp,
                    strategy_tier=args.tier,
                    symbol=args.symbol,
                    as_json=effective_json
                )
            elif args.subcommand == "list-audit":
                cmd_signal_list_audit(limit=args.limit, as_json=effective_json)
            else:
                emit_error(f"Unknown signal subcommand '{args.subcommand}'. Use --help.", as_json=effective_json)

        elif args.command == "billing":
            if args.subcommand == "fx":
                cmd_billing_fx(force=args.force, as_json=effective_json)
            elif args.subcommand == "orders":
                cmd_billing_orders(limit=args.limit, as_json=effective_json)
            else:
                emit_error(f"Unknown billing subcommand '{args.subcommand}'. Use --help.", as_json=effective_json)

        elif args.command == "research":
            if args.subcommand == "run-validation":
                cmd_research_run_validation(cutoff=args.cutoff, as_json=effective_json)
            elif args.subcommand == "pending":
                cmd_research_pending(as_json=effective_json)
            elif args.subcommand == "approve":
                cmd_research_approve(
                    proposal_id=args.proposal_id,
                    reviewer=args.reviewer,
                    reason=args.reason,
                    as_json=effective_json
                )
            elif args.subcommand == "reject":
                cmd_research_reject(
                    proposal_id=args.proposal_id,
                    reviewer=args.reviewer,
                    reason=args.reason,
                    as_json=effective_json
                )
            else:
                emit_error(f"Unknown research subcommand '{args.subcommand}'. Use --help.", as_json=effective_json)

        else:
            emit_error(f"Unknown command '{args.command}'.", as_json=effective_json)

    except Exception as e:
        emit_error(str(e), as_json=effective_json)


if __name__ == "__main__":
    main()
