#!/usr/bin/env python3
"""Find available tools in OpenClaw containers."""
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

# Find the OpenClaw package location
print("=== Finding OpenClaw package ===")
result = run("docker exec deploy-openclaw-gateway-1 ls /app/ 2>/dev/null")
print(f"/app/: {result.strip()}")

result = run("docker exec deploy-openclaw-gateway-1 ls /app/dist/ 2>/dev/null")
print(f"/app/dist/: {result.strip()}")

# Find all tool-related files
print("\n=== Tool-related files ===")
result = run("docker exec deploy-openclaw-gateway-1 find /app -name '*tool*' -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -30")
print(result if result.strip() else "(none)")

# Search for exec tool definition
print("\n=== Search for 'exec' tool ===")
result = run("docker exec deploy-openclaw-gateway-1 grep -rl 'exec' /app/dist/ 2>/dev/null | head -10")
print(result if result.strip() else "(none in dist)")

# Check the gateway API for available tools
print("\n=== Gateway API: list tools ===")
for name, port in [("阿凛", 18789), ("阿澪", 18791), ("Lain", 18790), ("Lumi", 18792)]:
    result = run(f"curl -s http://localhost:{port}/api/tools 2>/dev/null | head -200")
    if result.strip():
        print(f"\n{name} (:{port}):")
        print(result[:500])
    else:
        print(f"\n{name} (:{port}): (no response)")

# Try the health endpoint
print("\n=== Gateway health ===")
for name, port in [("阿凛", 18789), ("阿澪", 18791)]:
    result = run(f"curl -s http://localhost:{port}/api/health 2>/dev/null")
    print(f"{name}: {result.strip()[:200]}")

# Check what the exec tool looks like in the container
print("\n=== Container exec tool test ===")
result = run("docker exec deploy-openclaw-gateway-1 which node 2>/dev/null")
print(f"node: {result.strip()}")

# Check recent container logs for tool calls
print("\n=== 阿凛 recent logs (tool calls) ===")
result = run("docker logs deploy-openclaw-gateway-1 --tail 300 2>&1 | grep -i -E 'tool|exec|dispatch|claude.code|nodes' | tail -20")
print(result if result.strip() else "(no matching logs)")

print("\n=== 阿澪 recent logs (tool calls) ===")
result = run("docker logs aling-gateway --tail 300 2>&1 | grep -i -E 'tool|exec|dispatch|claude.code|nodes|validation' | tail -20")
print(result if result.strip() else "(no matching logs)")

print("\n=== Lain recent logs (tool calls) ===")
result = run("docker logs lain-gateway --tail 300 2>&1 | grep -i -E 'tool|exec|dispatch|claude.code|nodes|validation' | tail -20")
print(result if result.strip() else "(no matching logs)")

c.close()
