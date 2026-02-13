#!/usr/bin/env python3
"""Fix ANTHROPIC_API_KEY format in start.sh and restart Alin."""
import paramiko, sys, io, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

MAC = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
DEPLOY_BASE = '/Users/fangjin/Desktop/p/docker-openclawd/deploy'
DOCKER = '/usr/local/bin/docker'

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect(MAC, username=USER, password=PASS)
sftp = mac.open_sftp()

def run(cmd, timeout=60):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# Fix: ANTHROPIC_API_KEY must start with "sk-" for OpenClaw to accept it
# The api-proxy replaces it with the gateway client key anyway
print("=" * 60)
print("Fix: Update start.sh with sk- prefixed ANTHROPIC_API_KEY")
print("=" * 60)

new_start_sh = '''#!/bin/bash
echo "[$(date)] Starting OpenClaw with Gateway V2 proxy..."

# Restore SSH keys from workspace (persist across container restarts)
if [ -d "/home/node/.openclaw/workspace/.ssh" ]; then
  mkdir -p ~/.ssh
  cp /home/node/.openclaw/workspace/.ssh/* ~/.ssh/ 2>/dev/null || true
  chmod 600 ~/.ssh/id_* 2>/dev/null || true
  echo "[$(date)] SSH keys restored from workspace"
fi

# Restore env secrets from workspace (persist across container restarts)
if [ -f "/home/node/.openclaw/workspace/.secrets/.env" ]; then
  cp /home/node/.openclaw/workspace/.secrets/.env ~/.env 2>/dev/null || true
  echo "[$(date)] Env secrets restored from workspace"
fi

echo "[$(date)] Gateway V2 handles all routing - no monkey-patches needed"

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

# IMPORTANT: OpenClaw requires ANTHROPIC_API_KEY to start with "sk-"
# The actual auth to the provider is handled by api-proxy -> Gateway V2
export ANTHROPIC_API_KEY="sk-${API_KEY}"
export ANTHROPIC_BASE_URL="http://127.0.0.1:8022"
exec node dist/index.js gateway --bind lan --port 18789 --allow-unconfigured
'''

with sftp.open(f'{DEPLOY_BASE}/start.sh', 'w') as f:
    f.write(new_start_sh)
run(f'chmod +x {DEPLOY_BASE}/start.sh')
print("  start.sh updated")

# Restart container
print("\n  Restarting Alin container...")
out, _ = run(f'cd {DEPLOY_BASE} && {DOCKER} compose down 2>&1', timeout=30)
print(f"  down: {out}")

time.sleep(2)

out, _ = run(f'cd {DEPLOY_BASE} && {DOCKER} compose up -d 2>&1', timeout=60)
print(f"  up: {out}")

time.sleep(8)

# Verify env inside container
print("\n  Checking ANTHROPIC_API_KEY inside container...")
out, _ = run(f'{DOCKER} exec deploy-openclaw-gateway-1 sh -c "echo ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"')
print(f"  {out}")

# Check container logs
print("\n  Container logs:")
out, _ = run(f'cd {DEPLOY_BASE} && {DOCKER} compose logs --tail 20 2>&1', timeout=15)
print(f"{out[:2000]}")

sftp.close()
mac.close()
print("\n[DONE]")
