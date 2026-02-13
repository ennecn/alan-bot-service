#!/usr/bin/env python3
"""Check OpenClaw tools via WebSocket API and container inspection."""
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd, timeout=15)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

# Fix docker path issue
docker = "/usr/local/bin/docker"

# Check container file structure
print("=== Container /app structure ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 ls -la /app/ 2>&1")
print(result[:500])

print("\n=== Container /app/node_modules/@mariozechner ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 ls /app/node_modules/@mariozechner/ 2>&1")
print(result[:300])

# Find the actual pi-ai package
print("\n=== Find pi-ai package ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 find /app/node_modules -maxdepth 4 -name 'pi-ai' -type d 2>&1 | head -5")
print(result)

# Search for tool definitions in the package
print("\n=== Search for tool definitions ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 find /app/node_modules -path '*/pi-ai/dist/tools*' 2>&1 | head -20")
print(result if result.strip() else "(none)")

# Search for 'nodes' in all JS files
print("\n=== Search for 'nodes' in JS files ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 grep -rl 'nodes' /app/node_modules/@mariozechner/ 2>&1 | grep -v '.map' | grep -v '.git' | head -20")
print(result if result.strip() else "(none)")

# Check the OpenClaw gateway WebSocket for tool list
print("\n=== Gateway WebSocket tool list ===")
# Try the REST API endpoints
for endpoint in ["/api/v1/tools", "/api/tools", "/tools", "/api/v1/status"]:
    result = run(f"curl -s http://localhost:18789{endpoint} 2>/dev/null | head -100")
    if result.strip() and not result.strip().startswith("<!doctype"):
        print(f"GET {endpoint}: {result[:300]}")

# Check the OpenClaw process and its loaded modules
print("\n=== OpenClaw process info ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 ps aux 2>&1 | head -10")
print(result)

# Check the main entry point
print("\n=== Main entry point ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 cat /app/package.json 2>&1 | head -30")
print(result)

# Search for 'nodes' or 'exec' tool in the entire node_modules
print("\n=== Search for tool registration (nodes/exec) ===")
result = run(f'{docker} exec deploy-openclaw-gateway-1 grep -r "registerTool\\|toolName.*nodes\\|name.*nodes" /app/node_modules/@mariozechner/ 2>&1 | grep -v ".map" | head -20')
print(result if result.strip() else "(none)")

# Check if there's a tools config in the container
print("\n=== Container config ===")
result = run(f"{docker} exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/config/openclaw.json 2>&1")
print(result[:500])

c.close()
