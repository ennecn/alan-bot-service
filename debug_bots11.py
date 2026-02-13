#!/usr/bin/env python3
"""Check node pairing status for each bot."""
import paramiko
import sys
import json

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd, timeout=15)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

docker = "/usr/local/bin/docker"

# Check the gateway WebSocket API for nodes
ports = {"阿凛": 18789, "阿澪": 18791, "Lain": 18790, "Lumi": 18792}

for name, port in ports.items():
    print(f"\n=== {name} (:{port}) ===")
    # Try various API endpoints
    for endpoint in ["/api/nodes", "/api/v1/nodes", "/nodes"]:
        result = run(f"curl -s http://localhost:{port}{endpoint} 2>/dev/null | head -50")
        if result.strip() and not result.strip().startswith("<!doctype"):
            print(f"GET {endpoint}: {result.strip()[:300]}")

# Check the session files for 阿凛 to find tool calls
print("\n=== 阿凛 session files ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 find /home/node/.openclaw/agents -name '*.jsonl' 2>/dev/null | head -10")
print(result)

# Read the session file properly (escape the glob)
result = run(f"{docker} exec deploy-openclaw-gateway-1 ls -lt /home/node/.openclaw/agents/main/sessions/ 2>/dev/null | head -10")
print(f"\nSession dir: {result.strip()}")

# Get the specific session file
result = run(f"{docker} exec deploy-openclaw-gateway-1 find /home/node/.openclaw/agents/main/sessions -name '2b4f063e*' 2>/dev/null")
session_file = result.strip()
if session_file:
    print(f"\nSession file: {session_file}")
    # Search for tool names
    result = run(f'{docker} exec deploy-openclaw-gateway-1 grep -o \'"name":"[^"]*"\' "{session_file}" 2>/dev/null | sort | uniq -c | sort -rn | head -20')
    print(f"Tool names: {result.strip()}")
    # Search for nodes/exec/dispatch
    result = run(f'{docker} exec deploy-openclaw-gateway-1 grep "dispatch\\|nodes\\|claude-code" "{session_file}" 2>/dev/null | tail -5')
    print(f"Dispatch refs: {result.strip()[:500]}")

# Check the WebSocket RPC for node list
print("\n=== WebSocket RPC node list ===")
# Try using the gateway's internal API
result = run(f"curl -s -X POST http://localhost:18789/api/rpc -H 'Content-Type: application/json' -d '{{\"method\":\"nodes.list\"}}' 2>/dev/null | head -50")
print(f"阿凛 nodes.list: {result.strip()[:300]}")

# Check if there's a tailscale/tailnet connection
print("\n=== Tailscale/Tailnet ===")
for name, container in [("阿凛", "deploy-openclaw-gateway-1"), ("阿澪", "aling-gateway")]:
    result = run(f"{docker} exec {container} which tailscale 2>&1")
    print(f"{name} tailscale: {result.strip()}")
    result = run(f"{docker} exec {container} ls /home/node/.openclaw/tailnet/ 2>/dev/null")
    print(f"{name} tailnet dir: {result.strip() if result.strip() else '(none)'}")

c.close()
