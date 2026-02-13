#!/usr/bin/env python3
"""Check paired devices and nodes for each bot."""
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

containers = {
    "阿凛": "deploy-openclaw-gateway-1",
    "阿澪": "aling-gateway",
    "Lain": "lain-gateway",
    "Lumi": "lumi-gateway"
}

for name, container in containers.items():
    print(f"\n{'='*50}")
    print(f"=== {name} ({container}) ===")
    print(f"{'='*50}")

    # Check paired devices
    result = run(f"{docker} exec {container} cat /home/node/.openclaw/devices/paired.json 2>/dev/null")
    print(f"paired.json: {result.strip()[:500]}")

    # Check pending devices
    result = run(f"{docker} exec {container} cat /home/node/.openclaw/devices/pending.json 2>/dev/null")
    print(f"pending.json: {result.strip()[:200]}")

    # Check exec-approvals
    result = run(f"{docker} exec {container} cat /home/node/.openclaw/exec-approvals.json 2>/dev/null")
    print(f"exec-approvals.json: {result.strip()[:300]}")

    # Search for any node/MacMini references in all config files
    result = run(f'{docker} exec {container} grep -rl "MacMini\\|macmini\\|mac-mini\\|node.*ssh\\|ssh.*node" /home/node/.openclaw/ 2>/dev/null | grep -v node_modules | grep -v workspace | head -10')
    print(f"MacMini refs: {result.strip() if result.strip() else '(none)'}")

    # Check the agent models.json for any node config
    result = run(f"{docker} exec {container} cat /home/node/.openclaw/agents/main/agent/models.json 2>/dev/null")
    print(f"models.json: {result.strip()[:200]}")

c.close()
