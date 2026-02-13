#!/usr/bin/env python3
"""Search OpenClaw dist for tool definitions."""
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd, timeout=20)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

docker = "/usr/local/bin/docker"

# List dist directory
print("=== /app/dist/ ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 ls /app/dist/")
print(result)

# Search for tool definitions in dist
print("\n=== Search dist for 'exec' tool ===")
result = run(f'{docker} exec deploy-openclaw-gateway-1 grep -rl "exec" /app/dist/ 2>/dev/null | head -20')
print(result[:500] if result.strip() else "(none)")

# Search for 'nodes' in dist
print("\n=== Search dist for 'nodes' ===")
result = run(f'{docker} exec deploy-openclaw-gateway-1 grep -rl "nodes" /app/dist/ 2>/dev/null | head -20')
print(result[:500] if result.strip() else "(none)")

# Check the skills directory in the container
print("\n=== Container skills ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 ls /app/skills/ 2>/dev/null")
print(result if result.strip() else "(none)")

# Check built-in skills
result = run(f"{docker} exec deploy-openclaw-gateway-1 ls /app/skills/ 2>/dev/null")
print(f"Built-in skills: {result.strip()}")

# Check the config directory inside container
print("\n=== Container config dir ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 find /home/node/.openclaw -type f -name '*.json' 2>/dev/null | head -20")
print(result if result.strip() else "(none)")

# Check the actual openclaw config location
result = run(f"{docker} exec deploy-openclaw-gateway-1 find /home/node -name 'openclaw.json' 2>/dev/null | head -5")
print(f"\nopenclaw.json locations: {result.strip()}")

# Read the config
result = run(f"{docker} exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json 2>/dev/null")
if not result.strip() or "No such file" in result:
    result = run(f"{docker} exec deploy-openclaw-gateway-1 find /home/node -name 'openclaw.json' -exec cat {{}} \\; 2>/dev/null | head -50")
print(f"\nConfig content: {result[:500]}")

# Check the extensions directory
print("\n=== Extensions ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 ls /app/extensions/ 2>/dev/null")
print(result if result.strip() else "(none)")

# Search for tool names in the binary/dist
print("\n=== Tool names in dist ===")
result = run(f'{docker} exec deploy-openclaw-gateway-1 grep -oh "\"[a-z_]*\"" /app/dist/tools/*.js 2>/dev/null | sort -u | head -30')
print(result if result.strip() else "(checking other paths...)")

result = run(f"{docker} exec deploy-openclaw-gateway-1 ls /app/dist/tools/ 2>/dev/null")
print(f"dist/tools/: {result.strip() if result.strip() else '(not found)'}")

# Try finding tools in the pi-agent-core package
print("\n=== pi-agent-core tools ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 find /app/node_modules/@mariozechner/pi-agent-core -name '*tool*' -o -name '*node*' 2>/dev/null | grep -v '.map' | head -20")
print(result if result.strip() else "(none)")

result = run(f"{docker} exec deploy-openclaw-gateway-1 ls /app/node_modules/@mariozechner/pi-agent-core/dist/ 2>/dev/null")
print(f"\npi-agent-core/dist/: {result.strip()[:300]}")

c.close()
