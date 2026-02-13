#!/usr/bin/env python3
"""Search for nodes tool in OpenClaw source."""
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

# Find the pi-ai dist directory
print("=== Finding pi-ai dist ===")
result = run("docker exec deploy-openclaw-gateway-1 find /app/node_modules -path '*/pi-ai/dist' -type d 2>/dev/null | head -5")
print(result)

# Search for 'nodes' in the source
print("\n=== Searching for 'nodes' tool in source ===")
result = run("docker exec deploy-openclaw-gateway-1 grep -rl 'nodes' /app/node_modules/@mariozechner/pi-ai/dist/ 2>/dev/null | head -20")
print(result if result.strip() else "(not found in @mariozechner)")

# Try the pnpm path
result = run("docker exec deploy-openclaw-gateway-1 find /app/node_modules -name 'pi-ai' -type d 2>/dev/null | head -5")
print(f"\npi-ai dirs: {result}")

# Search more broadly
print("\n=== Broad search for 'nodes' tool definition ===")
result = run("docker exec deploy-openclaw-gateway-1 grep -rl '\"nodes\"' /app/dist/ 2>/dev/null | head -10")
print(f"In /app/dist/: {result.strip() if result.strip() else '(none)'}")

result = run("docker exec deploy-openclaw-gateway-1 grep -rl 'nodes.*tool\\|tool.*nodes\\|NodesT' /app/dist/ 2>/dev/null | head -10")
print(f"Nodes tool refs: {result.strip() if result.strip() else '(none)'}")

# Check the tools directory structure
print("\n=== /app/dist/ tools structure ===")
result = run("docker exec deploy-openclaw-gateway-1 find /app/dist -name '*tool*' -o -name '*node*' 2>/dev/null | grep -v node_modules | head -20")
print(result if result.strip() else "(none)")

# Check if there's a nodes.js or similar
print("\n=== Search for nodes-related files ===")
result = run("docker exec deploy-openclaw-gateway-1 find /app -name '*nodes*' -not -path '*/node_modules/*' 2>/dev/null | head -20")
print(result if result.strip() else "(none)")

# Check the skill's SKILL.md for all bots - compare them
print("\n=== Comparing SKILL.md across bots ===")
for name, dir_name in [("阿凛", "deploy"), ("阿澪", "deploy-aling"), ("Lain", "deploy-lain"), ("Lumi", "deploy-lumi")]:
    result = run(f"md5 -q ~/Desktop/p/docker-openclawd/{dir_name}/config/skills/claude-code/SKILL.md 2>/dev/null")
    print(f"{name}: {result.strip()}")

# Show the actual SKILL.md for aling to compare
print("\n=== 阿澪 SKILL.md ===")
result = run("cat ~/Desktop/p/docker-openclawd/deploy-aling/config/skills/claude-code/SKILL.md")
print(result)

c.close()
