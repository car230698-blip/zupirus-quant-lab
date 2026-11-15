---
name: zupirus-cli
description: Agent-Native internal operations, signal tracing, MetaApi Cloud MT5 terminal management, and research approval CLI for ZUPIRUS Quant Lab.
---

# `zupirus-cli` — Agent-Native Operations & Verification Manual

`zupirus-cli` transforms **ZUPIRUS Quant Lab** into an **Agent-Native** system adhering to the principles of **CLI-Anything** (`HKUDS/CLI-Anything` — *"Making Software Agent-Native"*).

It provides AI Agents with deterministic, 100% terminal-driven command surfaces with pure `--json` outputs (zero extraneous banner or log noise on stdout) to inspect, operate, inject signals, trace dispatches, sync MetaApi Cloud MT5 terminals, and approve walk-forward research models without requiring browser/GUI interactions.

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

#### 1.2 `zupirus-cli healthcheck [--json]` / `zupirus-cli system healthcheck [--json]`
Fast non-zero exit check for system health, verifying database connectivity and operational status. Designed for automated CI/CD pipelines, Docker health probes, and deployment post-checks.

#### 1.3 `zupirus-cli system kill-switch (--on | --off) [--reason "..."] --json`
Instantly triggers or disengages the system-wide emergency halt:
- `--on`: Sets `kv.halted = 1`, pauses all auto trading, cancels all queued dispatches, and logs an audit record.
- `--off`: Sets `kv.halted = 0` and logs an audit record.

---

### Domain 2: `cloud` — MetaApi Cloud MT5 Management (Direct-to-User)

#### 2.1 `zupirus-cli cloud list --json`
Lists all connected MetaApi Cloud MT5 terminals, account login, broker server, equity, balance, deployment state (`DEPLOYED` / `UNDEPLOYED` / `ERROR`), and auto-trade status.

#### 2.2 `zupirus-cli cloud sync [--account <login>] --json`
Syncs real-time balance & equity directly from the MetaApi Cloud terminal into the database.

#### 2.3 `zupirus-cli cloud undeploy-expired --json`
Scans for expired subscriptions and automatically unprovisions / undeploys their MetaApi cloud terminals to eliminate hosting costs.

#### 2.4 `zupirus-cli cloud dispatch-test [--symbol XAUUSD] [--action BUY|SELL] [--price 2650.0] --json`
Executes an ultra-fast Fan-Out test order across all active Cloud MT5 accounts with Redis idempotency locking (`exec:{signal_id}:{account_id}`).

*(Note: `ea` is retained as a deprecated alias pointing to `cloud`)*

---

### Domain 3: `signal` — Signal Injection & Lifecycle Tracing

#### 3.1 `zupirus-cli signal send-test --account <login> --side BUY|SELL [--lot 0.01] [--price 2725.50] [--force] --json`
Dispatches a test signal to a target account through the execution pipeline.

#### 3.2 `zupirus-cli signal trace <signal_id> --json`
Provides end-to-end observability from signal creation -> outbox -> Redis stream -> Cloud Execution -> Deal Ticket, verifying anti-duplicate constraints.

#### 3.3 `zupirus-cli signal test-ingest --action BUY|SELL --price <price> [--sl <sl>] [--tp <tp>] [--tier STANDARD|ALPHA] --json`
Simulates signal ingestion through all 4 Mandatory Safety Guards (Mandatory ATR SL, News Shield, Slippage Guard, Redis Deduplication) and outputs audit results.

#### 3.4 `zupirus-cli signal list-audit [--limit 20] --json`
Queries the `signal_audit_logs` table for recent approval and rejection decisions with exact reasons.

---

### Domain 4: `billing` — Real-Time FX Rate & Subscription Orders

#### 4.1 `zupirus-cli billing fx [--force] --json`
Inspects the current USD/VND live exchange rate, Redis cache status, and VND equivalents for all platform tiers.

#### 4.2 `zupirus-cli billing orders [--limit 20] --json`
Lists recent VietQR subscription and cloud slot checkout orders with status and timestamps.

---

### Domain 5: `research` — Strategy Validation & Approval Workflow

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

When tasked with verifying or accepting **ZUPIRUS Quant Lab**, an AI Agent should execute this deterministic sequence:

```bash
# Step 1: Verify system health and database readiness
zupirus-cli system status --json

# Step 2: Query Cloud MT5 terminals registry
zupirus-cli cloud list --json

# Step 3: Test Fan-Out direct dispatch across active cloud terminals
zupirus-cli cloud dispatch-test --symbol XAUUSD --action BUY --json

# Step 4: Run Walk-Forward Out-of-Sample validation
zupirus-cli research run-validation --cutoff 180 --json

# Step 5: Verify Emergency Kill Switch cycle
zupirus-cli system kill-switch --on --reason "Automated acceptance test" --json
zupirus-cli system kill-switch --off --reason "Acceptance test completed" --json
```
