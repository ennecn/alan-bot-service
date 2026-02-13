#!/usr/bin/env python3
"""Deep dive into nodes tool configuration."""
import paramiko
import sys
import json

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

# Full openclaw.json for each bot - look for ANY tool-related config
bots = {
    "阿凛": "deploy",
    "阿澪": "deploy-aling",
    "Lain": "deploy-lain",
    "Lumi": "deploy-lumi"
}

for name, dir_name in bots.items():
    print(f"\n{'='*60}")
    print(f"=== {name} ({dir_name}) - Full openclaw.json ===")
    print(f"{'='*60}")
    result = run(f"cat ~/Desktop/p/docker-openclawd/{dir_name}/config/openclaw.json")
    print(result)

# Check if there's a separate nodes config file
print(f"\n{'='*60}")
print("=== Looking for nodes config files ===")
print(f"{'='*60}")
for name, dir_name in bots.items():
    result = run(f"find ~/Desktop/p/docker-openclawd/{dir_name}/config -name '*node*' -o -name '*remote*' 2>/dev/null")
    if result.strip():
        print(f"{name}: {result.strip()}")
    else:
        print(f"{name}: (no nodes config files)")

# Check inside containers for nodes tool definition
print(f"\n{'='*60}")
print("=== Checking inside containers for nodes tool ===")
print(f"{'='*60}")
containers = {
    "阿凛": "deploy-openclaw-gateway-1",
    "阿澪": "aling-gateway",
    "Lain": "lain-gateway",
    "Lumi": "lumi-gateway"
}
for name, container in containers.items():
    result = run(f"docker exec {container} find /app -name '*node*' -path '*/tools/*' 2>/dev/null | head -10")
    if result.strip():
        print(f"{name}: {result.strip()}")

# Check the OpenClaw source for nodes tool definition
print(f"\n{'='*60}")
print("=== OpenClaw source: nodes tool ===")
print(f"{'='*60}")
result = run("docker exec deploy-openclaw-gateway-1 grep -r 'nodes' /app/node_modules/.pnpm/@mariozechner+pi-ai*/node_modules/@mariozechner/pi-ai/dist/ --include='*.js' -l 2>/dev/null | head -10")
print(f"Files mentioning 'nodes': {result.strip()}")

# Check if there's a nodes tool in the tools directory
result = run("docker exec deploy-openclaw-gateway-1 ls /app/node_modules/.pnpm/@mariozechner+pi-ai*/node_modules/@mariozechner/pi-ai/dist/tools/ 2>/dev/null")
print(f"\nTools directory: {result.strip()}")

# Check the actual tool validation error
print(f"\n{'='*60}")
print("=== Container logs (last 200 lines, grep for nodes/validation) ===")
print(f"{'='*60}")
for name, container in containers.items():
    result = run(f"docker logs {container} --tail 200 2>&1 | grep -i -E 'nodes|validation|tool.*fail' | tail -10")
    if result.strip():
        print(f"\n{name}:")
        print(result.strip())
    else:
        print(f"\n{name}: (no matching logs)")

c.close()
