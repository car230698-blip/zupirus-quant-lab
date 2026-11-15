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

**Example output:**
```json
{
  "success": true,
  "timestamp": 1794706704.114,
  "database": {
    "engine": "PostgreSQL + TimescaleDB",
    "is_postgres": true,
    "healthy": true,
    "details": {
      "status": "up",
      "engine": "postgresql",
      "is_postgres": true
    }
  },
  "redis": {
    "connected": true,
    "is_in_memory_mock": false,
    "mode": "Connected (Redis Server)",
    "streams": ["stream:signals"],
    "channels": ["channel:signals"]
  },
  "execution_lock": {
    "real_trading_allowed": false,
    "simulation_only": true,
    "real_execution_locked": true,
    "status": "ENFORCED (DEMO/REPLAY ONLY)",
    "policy": "Hard lock against live capital execution"
  },
  "price_feed": {
    "symbol": "XAUUSD",
    "source": "DEMO",
    "last_price": 2724.50,
    "bid": 2724.35,
    "ask": 2724.65,
    "spread": 0.30,
    "updated_at": 1794706700.0,
    "seconds_ago": 4.1,
    "status": "ACTIVE"
  },
  "workers": {
    "execution": {
      "heartbeat": 1794706701.0,
      "seconds_ago": 3.1,
      "status": "HEALTHY"
    },
    "research": {
      "heartbeat": 1794706699.0,
      "seconds_ago": 5.1,
      "status": "HEALTHY"
    }
  },
  "kill_switch": {
    "halted": false,
    "status": "OPERATIONAL"
  }
}
```

#### 1.2 `zupirus-cli system kill-switch (--on | --off) [--reason "..."] --json`
Instantly triggers or disengages the system-wide emergency halt:
- `--on`: Sets `kv.halted = 1`, disables all client copy accounts (`enabled = 0`), cancels all queued dispatches, and logs an audit record.
- `--off`: Sets `kv.halted = 0` and logs an audit record.

**Example output:**
```json
{
  "success": true,
  "halted": true,
  "status": "HALTED",
  "reason": "Elevated market volatility before CPI release",
  "cancelled_dispatches": 2,
  "timestamp": 1794706802.767
}
```

---

### Domain 2: `ea` — MT5 Copy EA Management & Pairing

#### 2.1 `zupirus-cli ea list --json`
Lists all registered MT5 EA accounts, equity, peak, drawdown, open positions, online heartbeat state, and whether a device is currently paired.

**Example output:**
```json
{
  "success": true,
  "total_count": 1,
  "accounts": [
    {
      "account_id": "37fa5d84b1a0887130745f53",
      "login": "61713217",
      "server": "MetaQuotes-Demo",
      "mode": "DEMO",
      "user_email": "test@zupirus.com",
      "enabled": true,
      "paired": false,
      "balance": 10000.0,
      "equity": 10000.0,
      "peak": 10000.0,
      "drawdown_pct": 0.0,
      "open_positions": 0,
      "last_heartbeat": 1794706721.5,
      "seconds_ago": 6.9,
      "status": "ONLINE",
      "cached_redis_heartbeat": null
    }
  ]
}
```

#### 2.2 `zupirus-cli ea pair-code --user <email> [--account <login>] --json`
Generates a secure, single-use pairing code valid for 10 minutes to link a new MT5 terminal.

**Example output:**
```json
{
  "success": true,
  "account_id": "37fa5d84b1a0887130745f53",
  "user_email": "test@zupirus.com",
  "login": "61713217",
  "server": "MetaQuotes-Demo",
  "pairing_code": "ZP-207B72",
  "expires_in_seconds": 600,
  "expires_at": 1794707321.6,
  "usage_instructions": "Enter this pairing code into InpPairingCode in MT5 EA settings."
}
```

#### 2.3 `zupirus-cli ea revoke --account <login> [--reason "..."] --json`
Revokes an EA's paired device token, terminates pairing codes, cancels queued dispatches, and disables copy trading for that account.

**Example output:**
```json
{
  "success": true,
  "account_id": "37fa5d84b1a0887130745f53",
  "login": "61713217",
  "server": "MetaQuotes-Demo",
  "revoked": true,
  "enabled": false,
  "cancelled_dispatches": 0,
  "reason": "Account de-provisioned",
  "timestamp": 1794706825.587
}
```

---

### Domain 3: `signal` — Signal Injection & Lifecycle Tracing

#### 3.1 `zupirus-cli signal send-test --account <login> --side BUY|SELL [--lot 0.01] [--price 2725.50] [--force] --json`
Dispatches a test signal to a target Demo account through the production execution pipeline:
- Inserts record into `signals` table with computed SL and TP.
- Inserts atomic outbox event into `outbox` table.
- Publishes event to Redis Streams (`stream:signals`) and Pub/Sub (`channel:signals`).
- Acquires distributed lock (`lock:dispatch:{account_id}:{signal_id}`) and creates dispatch in `dispatches` table.

**Example output:**
```json
{
  "success": true,
  "signal_id": "test_910a81650911be47c82d",
  "account_id": "37fa5d84b1a0887130745f53",
  "login": "61713217",
  "server": "MetaQuotes-Demo",
  "side": "BUY",
  "lot": 0.01,
  "price": 2725.5,
  "sl": 2719.5,
  "tp": 2737.5,
  "created_at": 1794706735.267,
  "expires_at": 1794706780.3,
  "valid_duration_seconds": 45,
  "dispatch": {
    "id": 1,
    "state": "queued"
  },
  "redis_published": true
}
```

#### 3.2 `zupirus-cli signal trace <signal_id> --json`
Provides end-to-end observability from signal creation -> outbox -> Redis stream -> EA poll -> MT5 deal ticket, verifying anti-duplicate constraints.

**Example output:**
```json
{
  "success": true,
  "signal": {
    "id": "test_910a81650911be47c82d",
    "source": "DEMO",
    "side": "BUY",
    "price": 2725.5,
    "sl": 2719.5,
    "tp": 2737.5,
    "created_at": 1794706735.266,
    "expires_at": 1794706780.3,
    "is_expired": false,
    "seconds_remaining": 37.3
  },
  "outbox": {
    "count": 1,
    "records": [
      {
        "id": 1,
        "event_type": "signal_created",
        "status": "published",
        "retry_count": 0,
        "created_at": "1794706735.266",
        "published_at": "1794706735.266"
      }
    ]
  },
  "dispatches": {
    "count": 1,
    "records": [
      {
        "dispatch_id": 1,
        "account_id": "37fa5d84b1a0887130745f53",
        "login": "61713217",
        "server": "MetaQuotes-Demo",
        "mode": "DEMO",
        "state": "queued",
        "nonce": null,
        "ticket": null,
        "deal": null,
        "reason": null,
        "created_at": 1794706735.266,
        "updated_at": 1794706735.266
      }
    ]
  },
  "anti_duplicate_audit": {
    "passed": true,
    "status": "PASS: No duplicate deals or concurrent double executions detected",
    "unique_deals_count": 0,
    "constraint_enforced": "UNIQUE(account_id, signal_id) + distributed lock"
  }
}
```

---

### Domain 4: `research` — Strategy Validation & Approval Workflow

#### 4.1 `zupirus-cli research run-validation [--cutoff <timestamp>] --json`
Executes rolling Walk-Forward Out-of-Sample analysis and halts at the LangGraph `interrupt` approval gate (`state = waiting_approval`).

**Example output:**
```json
{
  "success": true,
  "proposal_id": "wf_8bbfd8f398c0735aa4b576f7",
  "state": "waiting_approval",
  "method": "rolling 120 train / 60 OOS, no overlapping test blocks",
  "strategy": "SMA crossover, slow=20, train-selected fast in [3,5,8], SL=6, TP=12, next-bar fill, close-only exits",
  "folds_count": 13,
  "oos_net_price_units": 119.24,
  "max_drawdown_price_units": 0.37,
  "total_trades": 13,
  "production_qualified": false,
  "requires_approval": true,
  "checkpoint_status": "INTERRUPTED: Stored in checkpointer awaiting admin decision",
  "created_at": 1794706749.227
}
```

#### 4.2 `zupirus-cli research pending --json`
Returns all strategy proposals currently waiting at the interrupt checkpoint.

**Example output:**
```json
{
  "success": true,
  "pending_count": 1,
  "proposals": [
    {
      "proposal_id": "wf_8bbfd8f398c0735aa4b576f7",
      "state": "waiting_approval",
      "created_at": 1794706749.226,
      "created_time": "2026-11-15 08:39:09",
      "strategy": "SMA crossover, slow=20, train-selected fast in [3,5,8], SL=6, TP=12, next-bar fill, close-only exits",
      "folds_count": 13,
      "oos_net_price_units": 119.24,
      "max_drawdown_price_units": 0.37,
      "trades": 13
    }
  ]
}
```

#### 4.3 `zupirus-cli research approve <proposal_id> [--reviewer admin] [--reason "..."] --json`
Approves the proposal, resumes the checkpoint graph, and archives the candidate for demo review (hard-coded: never promotes automatically to live execution).

**Example output:**
```json
{
  "success": true,
  "proposal_id": "wf_8bbfd8f398c0735aa4b576f7",
  "decision": "APPROVED",
  "disposition": "approved_for_demo_review",
  "reviewer": "admin",
  "reason": "Passed OOS evaluation",
  "state": "completed",
  "archived_as_candidate": true,
  "live_promotion_allowed": false,
  "resolved_at": 1794706765.746
}
```

#### 4.4 `zupirus-cli research reject <proposal_id> [--reviewer admin] [--reason "..."] --json`
Rejects the proposal, marking it `rejected` and permanently recording the audit trail.

**Example output:**
```json
{
  "success": true,
  "proposal_id": "wf_8bbfd8f398c0735aa4b576f7",
  "decision": "REJECTED",
  "disposition": "rejected",
  "reviewer": "admin",
  "reason": "Exceeded drawdown threshold",
  "state": "completed",
  "resolved_at": 1794706765.746
}
```

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

All 5 steps return valid JSON and zero errors, ensuring 100% autonomous software operations.
