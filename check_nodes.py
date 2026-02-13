#!/usr/bin/env python3
"""Check session transcripts for nodes validation errors."""
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd, timeout=30)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

docker = "/usr/local/bin/docker"

# Check Lumi's latest session for nodes validation error
print("=== Lumi: latest session with nodes tool ===")
r = run(f'{docker} exec lumi-gateway sh -c "ls -t /home/node/.openclaw/agents/main/sessions/*.jsonl 2>/dev/null | head -3"')
print(f"Sessions: {r.strip()}")

latest = r.strip().split('\n')[0] if r.strip() else ""
if latest:
    # Search for nodes validation error
    r = run(f'{docker} exec lumi-gateway sh -c "grep -o \'Validation.*nodes.*\\|nodes.*Validation.*\\|\\\"nodes\\\".*error.*\\|error.*\\\"nodes\\\".*\' \\"{latest}\\" 2>/dev/null | tail -5"')
    print(f"Validation errors: {r.strip() if r.strip() else '(none)'}")

    # Search for the nodes tool call and its result
    r = run(f'{docker} exec lumi-gateway sh -c "grep \\\"nodes\\\" \\"{latest}\\" 2>/dev/null | tail -5"')
    if r.strip():
        # Truncate each line
        for line in r.strip().split('\n')[-3:]:
            print(f"  {line[:500]}")

print()
print("=== 阿凛: latest session with nodes tool ===")
r = run(f'{docker} exec deploy-openclaw-gateway-1 sh -c "ls -t /home/node/.openclaw/agents/main/sessions/*.jsonl 2>/dev/null | head -3"')
print(f"Sessions: {r.strip()}")

latest = r.strip().split('\n')[0] if r.strip() else ""
if latest:
    r = run(f'{docker} exec deploy-openclaw-gateway-1 sh -c "grep \\\"nodes\\\" \\"{latest}\\" 2>/dev/null | tail -5"')
    if r.strip():
        for line in r.strip().split('\n')[-3:]:
            print(f"  {line[:500]}")

# Also check the node-host configuration
print()
print("=== Node host config ===")
for name, container in [("Lumi", "lumi-gateway"), ("阿凛", "deploy-openclaw-gateway-1")]:
    r = run(f'{docker} exec {container} sh -c "cat /home/node/.openclaw/nodes.json 2>/dev/null"')
    print(f"{name} nodes.json: {r.strip()[:500] if r.strip() else '(not found)'}")

# Check openclaw.json for nodes config
print()
print("=== openclaw.json nodes section ===")
for name, container in [("Lumi", "lumi-gateway"), ("阿凛", "deploy-openclaw-gateway-1")]:
    r = run(f'{docker} exec {container} sh -c "cat /home/node/.openclaw/openclaw.json 2>/dev/null | /usr/bin/jq .nodes 2>/dev/null"')
    if not r.strip() or r.strip() == 'null':
        r = run(f'{docker} exec {container} sh -c "cat /home/node/.openclaw/openclaw.json 2>/dev/null | grep -A 20 nodes"')
    print(f"{name}: {r.strip()[:500] if r.strip() else '(none)'}")

c.close()
