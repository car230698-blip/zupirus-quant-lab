---
name: zupirus-cli
description: Agent-Native internal operations, signal tracing, MT5 EA management, and research approval CLI for ZUPIRUS Quant Lab.
---

# `zupirus-cli` — Agent-Native Operations & Verification Manual

`zupirus-cli` transforms **ZUPIRUS Quant Lab** into an **Agent-Native** system adhering to the principles of **CLI-Anything** (`HKUDS/CLI-Anything` — *"Making Software Agent-Native"*).

It provides AI Agents with deterministic, 100% terminal-driven command surfaces with pure `--json` outputs (zero extraneous banner or log noise on stdout) to inspect, operate, inject signals, trace dispatches, and approve walk-forward research models without requiring browser/GUI interactions.

---

## 1. Quick Invocation

From anywhere in the repository or system (when installed):
```bash
# Direct entry-point
zupirus-cli <domain> <subcommand> [flags]

# Or via Python module
python -m cli.main <domain> <subcommand> [flags]

# Windows launcher
.\zupirus-cli.cmd <domain> <subcommand> [flags]
```

### Agent-Native Rule
Always append `--json` to any command when invoked programmatically by an AI Agent.
When `--json` is supplied:
- `stdout` strictly contains valid JSON (safe for `json.loads()` or piping to `jq`).
- Python logging is automatically redirected away from `stdout`.
- Successful commands return exit code `0` with `"success": true`.
- Errors return exit code `1` with `"success": false, "error": "<reason>"`.

---

## 2. Command Reference

### Domain 1: `system` — Health & Emergency Controls

#### 1.1 `zupirus-cli system status --json`
Inspects PostgreSQL/TimescaleDB connectivity, Redis stream status, Real-Execution Lock enforcement, XAUUSD price feed, worker heartbeats, and kill switch state.

#### 1.2 `zupirus-cli system kill-switch (--on | --off) [--reason "..."] --json`
Instantly triggers or disengages the system-wide emergency halt:
- `--on`: Sets `kv.halted = 1`, disables all client copy accounts (`enabled = 0`), cancels all queued dispatches, and logs an audit record.
- `--off`: Sets `kv.halted = 0` and logs an audit record.

---

### Domain 2: `ea` — MT5 Copy EA Management & Pairing

#### 2.1 `zupirus-cli ea list --json`
Lists all registered MT5 EA accounts, equity, peak, drawdown, open positions, online heartbeat state, and whether a device is currently paired.

#### 2.2 `zupirus-cli ea pair-code --user <email> [--account <login>] --json`
Generates a secure, single-use pairing code valid for 10 minutes to link a new MT5 terminal.

#### 2.3 `zupirus-cli ea revoke --account <login> [--reason "..."] --json`
Revokes an EA's paired device token, terminates pairing codes, cancels queued dispatches, and disables copy trading for that account.

---

### Domain 3: `signal` — Signal Injection & Lifecycle Tracing

#### 3.1 `zupirus-cli signal send-test --account <login> --side BUY|SELL [--lot 0.01] [--price 2725.50] [--force] --json`
Dispatches a test signal to a target Demo account through the production execution pipeline.

#### 3.2 `zupirus-cli signal trace <signal_id> --json`
Provides end-to-end observability from signal creation -> outbox -> Redis stream -> EA poll -> MT5 deal ticket, verifying anti-duplicate constraints.

---

### Domain 4: `research` — Strategy Validation & Approval Workflow

#### 4.1 `zupirus-cli research run-validation [--cutoff <timestamp>] --json`
Executes rolling Walk-Forward Out-of-Sample analysis and halts at the LangGraph `interrupt` approval gate (`state = waiting_approval`).

#### 4.2 `zupirus-cli research pending --json`
Returns all strategy proposals currently waiting at the interrupt checkpoint.

#### 4.3 `zupirus-cli research approve <proposal_id> [--reviewer admin] [--reason "..."] --json`
Approves the proposal, resumes the checkpoint graph, and archives the candidate for demo review (hard-coded: never promotes automatically to live execution).

#### 4.4 `zupirus-cli research reject <proposal_id> [--reviewer admin] [--reason "..."] --json`
Rejects the proposal, marking it `rejected` and permanently recording the audit trail.

---

## 3. Autonomous Verification Protocol for AI Agents

When tasked with verifying or accepting **ZUPIRUS Quant Lab**, an AI Agent should execute this deterministic 5-step sequence:

```bash
# Step 1: Verify system health and database readiness
zupirus-cli system status --json

# Step 2: Query EA client registry and generate demo pairing code
zupirus-cli ea pair-code --user test-agent@zupirus.com --json
zupirus-cli ea list --json

# Step 3: Dispatch test signal and verify anti-duplicate lock
zupirus-cli signal send-test --account <LOGIN> --side BUY --lot 0.01 --json

# Step 4: Trace full signal lifecycle (Database -> Outbox -> Redis Stream)
zupirus-cli signal trace <SIGNAL_ID> --json

# Step 5: Verify LangGraph research workflow (Walk-Forward -> Interrupt -> Approve)
zupirus-cli research run-validation --cutoff 180 --json
zupirus-cli research pending --json
zupirus-cli research approve <PROPOSAL_ID> --reason "Agent verification acceptance" --json
```
