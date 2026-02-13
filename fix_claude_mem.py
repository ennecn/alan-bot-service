#!/usr/bin/env python3
"""Fix bun install and start claude-mem worker on Mac Mini."""
import paramiko
import time

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

BUN = "/opt/homebrew/bin/bun"
MDIR = "/Users/fangjin/.claude/plugins/marketplaces/thedotmack"

def run(cmd, timeout=120):
    si, so, se = c.exec_command(cmd, timeout=timeout)
    return so.read().decode().strip(), se.read().decode().strip()

# 1. Verify bun
out, _ = run(f"{BUN} --version")
print(f"1. Bun version: {out}")

# 2. Install dependencies
print("2. Running bun install...")
out, err = run(f"cd {MDIR} && {BUN} install", timeout=120)
lines = (out or err).split("\n")
for line in lines[-8:]:
    if line.strip():
        print(f"   {line}")

# 3. Start worker
print("\n3. Starting worker...")
out, err = run(f"cd {MDIR} && {BUN} plugin/scripts/worker-service.cjs restart", timeout=30)
print(f"   {out or err}")

time.sleep(3)

out, err = run(f"cd {MDIR} && {BUN} plugin/scripts/worker-service.cjs status")
print(f"   Status: {out}")

# 4. Verify worker health
out, _ = run("curl -s http://127.0.0.1:37777/api/health 2>/dev/null || echo 'not responding'")
print(f"\n4. Worker health: {out}")

c.close()
print("\nDone!")
