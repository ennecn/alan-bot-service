#!/usr/bin/env python3
"""Check OpenClaw logs for nodes/validation errors."""
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
    "Lumi": "lumi-gateway",
    "阿凛": "deploy-openclaw-gateway-1",
    "阿澪": "aling-gateway",
    "Lain": "lain-gateway",
}

for name, container in containers.items():
    print(f"\n{'='*60}")
    print(f"  {name} ({container})")
    print(f"{'='*60}")

    # Check log tail
    print("\n--- Log tail (last 40 lines) ---")
    r = run(f'{docker} exec {container} sh -c "tail -40 /tmp/openclaw/openclaw-2026-02-11.log 2>/dev/null"')
    print(r.strip() if r.strip() else "(empty)")

    # Check for validation errors
    print("\n--- Validation/nodes errors ---")
    r = run(f'{docker} exec {container} sh -c "grep -i validation /tmp/openclaw/openclaw-2026-02-11.log 2>/dev/null | tail -10"')
    print(r.strip() if r.strip() else "(none)")

    # Check for node.invoke errors
    print("\n--- node.invoke errors ---")
    r = run(f'{docker} exec {container} sh -c "grep node.invoke /tmp/openclaw/openclaw-2026-02-11.log 2>/dev/null | tail -10"')
    print(r.strip() if r.strip() else "(none)")

c.close()
