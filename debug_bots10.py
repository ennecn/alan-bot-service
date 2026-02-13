#!/usr/bin/env python3
"""Check how 阿凛 dispatches and if SSH is available in containers."""
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd, timeout=15)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

docker = "/usr/local/bin/docker"

# Check if SSH client is available in containers
print("=== SSH availability in containers ===")
for name, container in [("阿凛", "deploy-openclaw-gateway-1"), ("阿澪", "aling-gateway")]:
    result = run(f"{docker} exec {container} which ssh 2>&1")
    print(f"{name} ssh: {result.strip()}")
    result = run(f"{docker} exec {container} which sshpass 2>&1")
    print(f"{name} sshpass: {result.strip()}")

# Check if the dispatch script is accessible from inside the container
print("\n=== Dispatch script accessibility ===")
for name, container in [("阿凛", "deploy-openclaw-gateway-1"), ("阿澪", "aling-gateway")]:
    result = run(f"{docker} exec {container} ls -la /Users/fangjin/claude-code-dispatch.sh 2>&1")
    print(f"{name}: {result.strip()}")
    # Check if host filesystem is mounted
    result = run(f"{docker} exec {container} ls /Users/fangjin/ 2>&1 | head -5")
    print(f"{name} /Users/fangjin/: {result.strip()[:200]}")

# Check 阿凛's recent session for tool calls
print("\n=== 阿凛 recent session (tool calls) ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 find /home/node/.openclaw/agents/main/sessions -name '*.jsonl' -newer /home/node/.openclaw/agents/main/sessions/sessions.json 2>/dev/null | head -5")
print(f"Session files: {result.strip()}")

# Get the latest session file
result = run(f"{docker} exec deploy-openclaw-gateway-1 ls -lt /home/node/.openclaw/agents/main/sessions/*.jsonl 2>/dev/null | head -3")
print(f"Latest sessions: {result.strip()}")

# Search for tool_use in the latest session
result = run(f'{docker} exec deploy-openclaw-gateway-1 ls -t /home/node/.openclaw/agents/main/sessions/*.jsonl 2>/dev/null | head -1')
latest = result.strip()
if latest:
    print(f"\nLatest session: {latest}")
    result = run(f'{docker} exec deploy-openclaw-gateway-1 grep -o "tool_use.*dispatch\\|nodes.*run\\|exec.*dispatch" {latest} 2>/dev/null | tail -10')
    print(f"Tool calls: {result.strip() if result.strip() else '(none found)'}")
    # Search for the actual tool name used
    result = run(f'{docker} exec deploy-openclaw-gateway-1 grep -o \'"name":"[^"]*"\' {latest} 2>/dev/null | sort | uniq -c | sort -rn | head -20')
    print(f"Tool names used: {result.strip()}")

# Check the OpenClaw CLI for nodes subcommand
print("\n=== OpenClaw nodes CLI ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 ls /app/dist/cli/ 2>/dev/null")
print(f"CLI dir: {result.strip()[:300]}")

# Check if there's a way to list nodes
result = run(f'{docker} exec deploy-openclaw-gateway-1 grep -o "nodes.*add\\|nodes.*list\\|nodes.*remove\\|addNode\\|listNodes" /app/dist/nodes-cli-hT8yYD7S.js 2>/dev/null | head -10')
print(f"\nNodes CLI commands: {result.strip()}")

c.close()
