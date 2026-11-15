"""Automated acceptance tests for zupirus-cli (CLI-Anything agent-native operations)."""
import json
import subprocess
import sys
import pytest


def run_cli(*args: str) -> subprocess.CompletedProcess:
    """Helper to run zupirus-cli via python module entry-point."""
    cmd = [sys.executable, "-m", "cli.main", *args]
    return subprocess.run(cmd, capture_output=True, text=True)


def parse_json_output(stdout: str) -> dict:
    """Assert stdout is clean, unpolluted, parseable JSON."""
    clean = stdout.strip()
    assert clean, "CLI output was unexpectedly empty"
    try:
        return json.loads(clean)
    except json.JSONDecodeError as e:
        pytest.fail(f"CLI stdout contained non-JSON junk: {e}\nRaw output:\n{clean}")


class TestCliSystemDomain:
    def test_system_status_json(self):
        res = run_cli("system", "status", "--json")
        assert res.returncode == 0
        data = parse_json_output(res.stdout)
        assert data["success"] is True
        assert "database" in data
        assert "redis" in data
        assert "execution_lock" in data
        assert "price_feed" in data
        assert "workers" in data
        assert "kill_switch" in data
        assert data["execution_lock"]["simulation_only"] is True

    def test_healthcheck_commands(self):
        # 1. Top-level healthcheck
        res_top = run_cli("healthcheck", "--json")
        assert res_top.returncode == 0
        data_top = parse_json_output(res_top.stdout)
        assert data_top["status"] == "healthy"
        assert data_top["database"] == "up"

        # 2. System healthcheck subcommand
        res_sub = run_cli("system", "healthcheck", "--json")
        assert res_sub.returncode == 0
        data_sub = parse_json_output(res_sub.stdout)
        assert data_sub["status"] == "healthy"
        assert data_sub["database"] == "up"

    def test_kill_switch_cycle(self):
        # 1. Turn kill-switch ON
        res_on = run_cli("system", "kill-switch", "--on", "--reason", "Automated pytest halt", "--json")
        assert res_on.returncode == 0
        data_on = parse_json_output(res_on.stdout)
        assert data_on["success"] is True
        assert data_on["halted"] is True
        assert data_on["status"] == "HALTED"

        # Verify status reports HALTED
        res_st = run_cli("system", "status", "--json")
        data_st = parse_json_output(res_st.stdout)
        assert data_st["kill_switch"]["halted"] is True

        # 2. Turn kill-switch OFF
        res_off = run_cli("system", "kill-switch", "--off", "--reason", "Automated pytest resume", "--json")
        assert res_off.returncode == 0
        data_off = parse_json_output(res_off.stdout)
        assert data_off["success"] is True
        assert data_off["halted"] is False
        assert data_off["status"] == "OPERATIONAL"


class TestCliCloudDomain:
    def test_cloud_list_json(self):
        res = run_cli("cloud", "list", "--json")
        assert res.returncode == 0
        data = parse_json_output(res.stdout)
        assert data["success"] is True
        assert "total_accounts" in data
        assert "accounts" in data
        assert isinstance(data["accounts"], list)

    def test_legacy_ea_alias_json(self):
        res = run_cli("ea", "list", "--json")
        assert res.returncode == 0
        data = parse_json_output(res.stdout)
        assert data["success"] is True
        assert "accounts" in data

    def test_cloud_undeploy_expired_json(self):
        res = run_cli("cloud", "undeploy-expired", "--json")
        assert res.returncode == 0
        data = parse_json_output(res.stdout)
        assert data["success"] is True
        assert "undeployed_count" in data

    def test_cloud_dispatch_test_json(self):
        res = run_cli("cloud", "dispatch-test", "--symbol", "XAUUSD", "--action", "BUY", "--json")
        assert res.returncode == 0
        data = parse_json_output(res.stdout)
        assert data["success"] is True
        assert "executed" in data


class TestCliResearchDomain:
    def test_research_run_pending_approve_cycle(self):
        # 1. Run Walk-Forward validation
        res_run = run_cli("research", "run-validation", "--cutoff", "180", "--json")
        assert res_run.returncode == 0
        prop_data = parse_json_output(res_run.stdout)
        assert prop_data["success"] is True
        prop_id = prop_data["proposal_id"]
        assert prop_id.startswith("wf_")
        assert prop_data["state"] == "waiting_approval"

        # 2. Inspect pending proposals
        res_pend = run_cli("research", "pending", "--json")
        assert res_pend.returncode == 0
        pend_data = parse_json_output(res_pend.stdout)
        assert pend_data["success"] is True
        assert any(p["proposal_id"] == prop_id for p in pend_data["proposals"])

        # 3. Approve proposal
        res_app = run_cli("research", "approve", prop_id, "--reviewer", "quant-agent-1", "--reason", "Walk-forward robust", "--json")
        assert res_app.returncode == 0
        app_data = parse_json_output(res_app.stdout)
        assert app_data["success"] is True
        assert app_data["decision"] == "APPROVED"
        assert app_data["disposition"] == "approved_for_demo_review"

        # 4. Reject workflow on another proposal
        res_run2 = run_cli("research", "run-validation", "--cutoff", "180", "--json")
        prop_id2 = parse_json_output(res_run2.stdout)["proposal_id"]

        res_rej = run_cli("research", "reject", prop_id2, "--reviewer", "risk-officer", "--reason", "Drawdown threshold exceeded", "--json")
        assert res_rej.returncode == 0
        rej_data = parse_json_output(res_rej.stdout)
        assert rej_data["success"] is True
        assert rej_data["decision"] == "REJECTED"


class TestCliErrorHandling:
    def test_missing_signal_trace_error_json(self):
        res = run_cli("signal", "trace", "nonexistent_sig_123", "--json")
        assert res.returncode == 1
        data = parse_json_output(res.stdout)
        assert data["success"] is False
        assert "not found" in data["error"].lower()
