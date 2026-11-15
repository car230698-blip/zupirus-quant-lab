"""Main CLI dispatcher for zupirus-cli following CLI-Anything architecture.
Making ZUPIRUS Quant Lab agent-native for 100% terminal-driven autonomous operation."""
import os
import sys
import logging
import argparse
from typing import List, Optional

from cli.formatters import emit_error
from cli.system import cmd_status, cmd_kill_switch
from cli.ea import cmd_ea_list, cmd_ea_pair_code, cmd_ea_revoke
from cli.signal import cmd_signal_send_test, cmd_signal_trace
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

    # system kill-switch
    p_sys_kill = system_subs.add_parser("kill-switch", help="Activate or deactivate emergency halt")
    group_kill = p_sys_kill.add_mutually_exclusive_group(required=True)
    group_kill.add_argument("--on", action="store_true", help="Engage emergency kill switch (halt execution)")
    group_kill.add_argument("--off", action="store_true", help="Disengage emergency kill switch (resume execution)")
    p_sys_kill.add_argument("--reason", type=str, default="", help="Audit explanation for state transition")
    p_sys_kill.add_argument("--json", action="store_true", help="Output pure JSON")

    # -------------------------------------------------------------
    # 2. EA MT5 CLIENT DOMAIN
    # -------------------------------------------------------------
    p_ea = subparsers.add_parser("ea", help="Manage MT5 Copy EAs, heartbeats, and pairing")
    ea_subs = p_ea.add_subparsers(dest="subcommand")

    # ea list
    p_ea_list = ea_subs.add_parser("list", help="List all MT5 EAs, equity, drawdown, and pairing status")
    p_ea_list.add_argument("--json", action="store_true", help="Output pure JSON")

    # ea pair-code
    p_ea_pair = ea_subs.add_parser("pair-code", help="Generate single-use pairing code for MT5 EA")
    p_ea_pair.add_argument("--user", type=str, required=True, help="User email account")
    p_ea_pair.add_argument("--account", type=str, default=None, help="Target account login number")
    p_ea_pair.add_argument("--json", action="store_true", help="Output pure JSON")

    # ea revoke
    p_ea_revoke = ea_subs.add_parser("revoke", help="Revoke EA access and device token")
    p_ea_revoke.add_argument("--account", type=str, required=True, help="Target account login number")
    p_ea_revoke.add_argument("--reason", type=str, default="", help="Revocation reason")
    p_ea_revoke.add_argument("--json", action="store_true", help="Output pure JSON")

    # -------------------------------------------------------------
    # 3. SIGNAL & DISPATCH DOMAIN
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
        if args.command == "system":
            if args.subcommand == "status":
                cmd_status(as_json=effective_json)
            elif args.subcommand == "kill-switch":
                cmd_kill_switch(on=args.on, off=args.off, reason=args.reason, as_json=effective_json)
            else:
                emit_error(f"Unknown system subcommand '{args.subcommand}'. Use --help.", as_json=effective_json)

        elif args.command == "ea":
            if args.subcommand == "list":
                cmd_ea_list(as_json=effective_json)
            elif args.subcommand == "pair-code":
                cmd_ea_pair_code(user_email=args.user, account_login=args.account, as_json=effective_json)
            elif args.subcommand == "revoke":
                cmd_ea_revoke(account_login=args.account, reason=args.reason, as_json=effective_json)
            else:
                emit_error(f"Unknown ea subcommand '{args.subcommand}'. Use --help.", as_json=effective_json)

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
            else:
                emit_error(f"Unknown signal subcommand '{args.subcommand}'. Use --help.", as_json=effective_json)

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
