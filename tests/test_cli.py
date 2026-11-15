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


class TestCliEaDomain:
    def test_ea_pair_and_list_and_revoke(self):
        # 1. Generate pair code
        email = "agent-runner@zupirus.test"
        res_pair = run_cli("ea", "pair-code", "--user", email, "--json")
        assert res_pair.returncode == 0
        pair_data = parse_json_output(res_pair.stdout)
        assert pair_data["success"] is True
        assert "pairing_code" in pair_data
        assert pair_data["pairing_code"].startswith("ZP-")
        login = pair_data["login"]

        # 2. List EAs and find our account
        res_list = run_cli("ea", "list", "--json")
        assert res_list.returncode == 0
        list_data = parse_json_output(res_list.stdout)
        assert list_data["success"] is True
        matching = [a for a in list_data["accounts"] if a["login"] == login]
        assert len(matching) == 1
        assert matching[0]["enabled"] is True

        # 3. Revoke access
        res_rev = run_cli("ea", "revoke", "--account", login, "--reason", "Pytest decommission", "--json")
        assert res_rev.returncode == 0
        rev_data = parse_json_output(res_rev.stdout)
        assert rev_data["success"] is True
        assert rev_data["revoked"] is True
        assert rev_data["enabled"] is False


class TestCliSignalDomain:
    def test_signal_send_and_trace(self):
        # Ensure a demo account exists for signal target
        res_pair = run_cli("ea", "pair-code", "--user", "trader@zupirus.test", "--json")
        login = parse_json_output(res_pair.stdout)["login"]

        # 1. Send test signal
        res_send = run_cli("signal", "send-test", "--account", login, "--side", "BUY", "--lot", "0.02", "--force", "--json")
        assert res_send.returncode == 0
        sig_data = parse_json_output(res_send.stdout)
        assert sig_data["success"] is True
        assert sig_data["side"] == "BUY"
        assert sig_data["lot"] == 0.02
        sig_id = sig_data["signal_id"]
        assert sig_id.startswith("test_")

        # 2. Trace the signal lifecycle
        res_trace = run_cli("signal", "trace", sig_id, "--json")
        assert res_trace.returncode == 0
        trace_data = parse_json_output(res_trace.stdout)
        assert trace_data["success"] is True
        assert trace_data["signal"]["id"] == sig_id
        assert trace_data["signal"]["side"] == "BUY"
        assert trace_data["anti_duplicate_audit"]["passed"] is True
        assert len(trace_data["dispatches"]["records"]) >= 1


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
    def test_missing_account_error_json(self):
        res = run_cli("ea", "revoke", "--account", "nonexistent_999999", "--json")
        assert res.returncode == 1
        data = parse_json_output(res.stdout)
        assert data["success"] is False
        assert "not found" in data["error"].lower()

    def test_missing_signal_trace_error_json(self):
        res = run_cli("signal", "trace", "nonexistent_sig_123", "--json")
        assert res.returncode == 1
        data = parse_json_output(res.stdout)
        assert data["success"] is False
        assert "not found" in data["error"].lower()
