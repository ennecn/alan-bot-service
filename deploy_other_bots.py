#!/usr/bin/env python3
"""Deploy Gateway V2 start.sh to Lain, Lumi, and Aling."""
import paramiko, sys, io, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = mac.open_sftp()

BASE = '/Users/fangjin/Desktop/p/docker-openclawd'
DOCKER = '/usr/local/bin/docker'

BOTS = [
    {'name': 'Lain',  'dir': f'{BASE}/deploy-lain',  'container': 'lain-gateway'},
    {'name': 'Lumi',  'dir': f'{BASE}/deploy-lumi',  'container': 'lumi-gateway'},
    {'name': 'Aling', 'dir': f'{BASE}/deploy-aling', 'container': 'aling-gateway'},
]

def run(cmd, timeout=60):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# The proven start.sh template (same as Alin)
NEW_START_SH = r'''#!/bin/bash
echo "[$(date)] Starting OpenClaw with Gateway V2 proxy..."

# Restore SSH keys from workspace
if [ -d "/home/node/.openclaw/workspace/.ssh" ]; then
  mkdir -p ~/.ssh
  cp /home/node/.openclaw/workspace/.ssh/* ~/.ssh/ 2>/dev/null || true
  chmod 600 ~/.ssh/id_* 2>/dev/null || true
  echo "[$(date)] SSH keys restored from workspace"
fi

# Restore env secrets from workspace
if [ -f "/home/node/.openclaw/workspace/.secrets/.env" ]; then
  cp /home/node/.openclaw/workspace/.secrets/.env ~/.env 2>/dev/null || true
  echo "[$(date)] Env secrets restored from workspace"
fi

# CRITICAL: pi-ai has hardcoded https://api.anthropic.com in models.generated.js
# We must redirect it to our local api-proxy so Gateway V2 handles routing
find /app/node_modules/.pnpm -path '*/@mariozechner/pi-ai/dist/models.generated.js' -exec \
  sed -i 's|https://api.anthropic.com|http://127.0.0.1:8022|g' {} \; 2>/dev/null || true
echo "[$(date)] API URL patched (api.anthropic.com -> 127.0.0.1:8022)"

# Start API proxy in background
node /home/node/api-proxy.js &
PROXY_PID=$!
echo "[$(date)] API proxy started (PID: $PROXY_PID)"

# Wait for proxy to be ready
sleep 2

# Start OpenClaw gateway
echo "[$(date)] Starting OpenClaw gateway..."

# Claude Code setup
export PATH="/home/node/.openclaw/workspace/.claude-code:/home/node/.openclaw/workspace/.claude-code/node_modules/.bin:$PATH"

# OpenClaw requires ANTHROPIC_API_KEY starting with "sk-"
# The actual auth is handled by api-proxy -> Gateway V2
export ANTHROPIC_API_KEY="sk-gateway-proxy-placeholder"
export ANTHROPIC_BASE_URL="http://127.0.0.1:8022"
exec node dist/index.js gateway --bind lan --port 18789 --allow-unconfigured
'''

for bot in BOTS:
    print("=" * 60)
    print(f"Deploying: {bot['name']} ({bot['container']})")
    print("=" * 60)

    # Backup old start.sh
    run(f"cp {bot['dir']}/start.sh {bot['dir']}/start.sh.v1bak 2>/dev/null")

    # Write new start.sh
    with sftp.open(f"{bot['dir']}/start.sh", 'w') as f:
        f.write(NEW_START_SH)
    run(f"chmod +x {bot['dir']}/start.sh")
    print(f"  start.sh updated")

    # Restart container
    print(f"  Restarting {bot['container']}...")
    out, _ = run(f"cd {bot['dir']} && {DOCKER} compose down 2>&1", timeout=30)
    print(f"  down: {out.split(chr(10))[-1]}")

    time.sleep(2)

    out, _ = run(f"cd {bot['dir']} && {DOCKER} compose up -d 2>&1", timeout=60)
    print(f"  up: {out.split(chr(10))[-1]}")

    time.sleep(3)
    print()

# Wait for all containers to boot
print("Waiting 10s for all containers to initialize...")
time.sleep(10)

# Verify all containers
print("\n" + "=" * 60)
print("Verification")
print("=" * 60)

out, _ = run(f'{DOCKER} ps --format "table {{{{.Names}}}}\t{{{{.Status}}}}" 2>&1')
print(f"\n  Containers:\n{out}")

# Check each bot's logs
for bot in BOTS:
    print(f"\n--- {bot['name']} logs ---")
    out, _ = run(f"cd {bot['dir']} && {DOCKER} compose logs --tail 10 2>&1", timeout=10)
    # Show key lines
    for line in out.split('\n'):
        if any(kw in line for kw in ['API proxy', 'API URL patched', 'agent model', 'telegram', 'Error', 'error']):
            # Strip ANSI codes for readability
            clean = line.replace('[90m', '').replace('[39m', '').replace('[36m', '').replace('[34m', '').replace('[35m', '').replace('[32m', '').replace('[31m', '')
            print(f"  {clean.strip()}")

# Gateway status
print("\n--- Gateway V2 status ---")
out, _ = run('curl -s http://127.0.0.1:8080/api/status --max-time 5')
print(f"  {out[:500]}")

sftp.close()
mac.close()
print("\n[ALL BOTS DEPLOYED]")
