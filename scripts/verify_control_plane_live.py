import json
from app.domains.ai.gemini_client import get_daily_quota_stats
from app.domains.ai.signal_swarm import get_agents_heartbeat, wake_agent

print("=== 1. AI QUOTA STATUS ===")
print(json.dumps(get_daily_quota_stats(), indent=2))

print("\n=== 2. AGENTS HEARTBEAT ===")
for a in get_agents_heartbeat():
    print(f"[{a['status']}] {a['id']} ({a['name']}): calls_today={a['calls_today']}, dur={a['last_duration_ms']}ms, summary={a['last_summary']}")

print("\n=== 3. TESTING WAKE NOW (SENTINEL) ===")
ok, msg, data = wake_agent("sentinel")
print(f"Wake result: ok={ok}, msg={msg}, data={data}")

print("\n=== 4. TESTING ATOMIC LOCK DUPLICATE WAKE (SENTINEL) ===")
ok2, msg2, data2 = wake_agent("sentinel")
print(f"Second immediate wake result: ok={ok2}, msg={msg2}")

print("\n=== 5. POST-WAKE HEARTBEAT ===")
for a in get_agents_heartbeat():
    print(f"[{a['status']}] {a['id']} ({a['name']}): calls_today={a['calls_today']}, dur={a['last_duration_ms']}ms, summary={a['last_summary']}")
