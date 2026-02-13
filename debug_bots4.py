#!/usr/bin/env python3
"""Check agent-skills and nodes tool source."""
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

# Check agent-skills (only on 阿凛)
print("=== agent-skills (阿凛 only) ===")
result = run("ls ~/Desktop/p/docker-openclawd/deploy/config/skills/agent-skills/")
print(result)

result = run("cat ~/Desktop/p/docker-openclawd/deploy/config/skills/agent-skills/_meta.json 2>/dev/null")
print(f"meta: {result.strip()}")

# Check if agent-skills has nodes-related content
result = run("grep -rl 'nodes' ~/Desktop/p/docker-openclawd/deploy/config/skills/agent-skills/ 2>/dev/null")
print(f"nodes refs: {result.strip() if result.strip() else '(none)'}")

# Search the entire OpenClaw app for 'nodes' tool
print("\n=== Search /app for nodes tool ===")
result = run("docker exec deploy-openclaw-gateway-1 grep -rl 'nodes' /app/dist/ /app/src/ 2>/dev/null | head -20")
print(result if result.strip() else "(none in /app/dist or /app/src)")

# Check /app structure
print("\n=== /app structure ===")
result = run("docker exec deploy-openclaw-gateway-1 ls /app/")
print(result)

# Search in node_modules for nodes tool
print("\n=== Search node_modules for nodes tool ===")
result = run("docker exec deploy-openclaw-gateway-1 find /app/node_modules/@mariozechner -name '*.js' 2>/dev/null | head -5")
print(f"pi-ai files: {result.strip() if result.strip() else '(none)'}")

# Try finding the actual package
result = run("docker exec deploy-openclaw-gateway-1 find /app/node_modules -maxdepth 3 -name 'pi-ai' -type d 2>/dev/null")
print(f"pi-ai dirs: {result.strip() if result.strip() else '(none)'}")

# Check package.json for the main package
print("\n=== /app/package.json ===")
result = run("docker exec deploy-openclaw-gateway-1 cat /app/package.json 2>/dev/null | head -20")
print(result)

# Search for 'nodes' in the entire /app directory (excluding node_modules)
print("\n=== Search /app (excl node_modules) for 'nodes' ===")
result = run("docker exec deploy-openclaw-gateway-1 grep -rl 'nodes' /app/ --exclude-dir=node_modules 2>/dev/null | head -20")
print(result if result.strip() else "(none)")

# Search in node_modules for the tool definition
print("\n=== Search for 'nodes' tool in all JS files ===")
result = run("docker exec deploy-openclaw-gateway-1 grep -rl '\"nodes\"' /app/node_modules/.pnpm/ 2>/dev/null | grep -v '.map' | head -20")
print(result if result.strip() else "(none)")

# Check the nas-access skill (all bots have it, might provide nodes)
print("\n=== nas-access skill ===")
result = run("cat ~/Desktop/p/docker-openclawd/deploy/config/skills/nas-access/SKILL.md 2>/dev/null | head -30")
print(result)

result = run("grep -l 'nodes' ~/Desktop/p/docker-openclawd/deploy/config/skills/nas-access/* 2>/dev/null")
print(f"nodes refs in nas-access: {result.strip() if result.strip() else '(none)'}")

c.close()
