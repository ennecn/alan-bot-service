#!/usr/bin/env python3
"""Check nodes tool schema and node-host configuration."""
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

# Check the nodes tool definition in the dist
print("=== Nodes tool schema (from dist) ===")
r = run(f'{docker} exec deploy-openclaw-gateway-1 sh -c "grep -A 30 \\\"nodes\\\" /app/dist/nodes-cli-hT8yYD7S.js 2>/dev/null | head -50"')
print(r.strip()[:1000] if r.strip() else "(not found)")

# Check node-host runner
print("\n=== Node host runner ===")
r = run(f'{docker} exec deploy-openclaw-gateway-1 sh -c "ls /app/dist/node-host/ 2>/dev/null"')
print(f"Files: {r.strip()}")

# Check the actual nodes tool validation in the source
print("\n=== Nodes tool validation (grep for validation) ===")
r = run(f'{docker} exec deploy-openclaw-gateway-1 sh -c "grep -rl \\\"Validation failed\\\" /app/dist/ 2>/dev/null | head -5"')
print(f"Files with validation: {r.strip()}")

# Check the node-host runner.js
print("\n=== node-host runner.js ===")
r = run(f'{docker} exec deploy-openclaw-gateway-1 sh -c "cat /app/dist/node-host/runner.js 2>/dev/null | head -100"')
if not r.strip():
    # Try finding the runner
    r = run(f'{docker} exec deploy-openclaw-gateway-1 sh -c "find /app/dist -name \\\"*runner*\\\" -path \\\"*node*\\\" 2>/dev/null"')
    print(f"Runner files: {r.strip()}")

# Check the session transcript for the actual error response
print("\n=== Lumi: nodes tool result ===")
r = run(f'{docker} exec lumi-gateway sh -c "grep -A 2 call_4d1bbebf8c64c728 /home/node/.openclaw/agents/main/sessions/d78bda1e-dbfb-484b-ab5d-95161eb3edba.jsonl 2>/dev/null | tail -5"')
for line in r.strip().split('\n')[-3:]:
    print(f"  {line[:800]}")

print("\n=== 阿凛: nodes tool result ===")
r = run(f'{docker} exec deploy-openclaw-gateway-1 sh -c "grep -A 2 call_5d4a8c608275e6e1 /home/node/.openclaw/agents/main/sessions/37853765-2dc6-4678-94ae-04d2a9c2f466.jsonl 2>/dev/null | tail -5"')
for line in r.strip().split('\n')[-3:]:
    print(f"  {line[:800]}")

# Check the node-host config in openclaw.json
print("\n=== Full openclaw.json (Lumi) ===")
r = run(f'{docker} exec lumi-gateway sh -c "cat /home/node/.openclaw/openclaw.json 2>/dev/null"')
print(r.strip()[:2000] if r.strip() else "(not found)")

c.close()
