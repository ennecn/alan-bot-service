#!/usr/bin/env python3
"""Add back the critical monkey-patch for API URL redirect."""
import paramiko, sys, io, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = mac.open_sftp()

DEPLOY_BASE = '/Users/fangjin/Desktop/p/docker-openclawd/deploy'
DOCKER = '/usr/local/bin/docker'

def run(cmd, timeout=60):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# Fix start.sh: add back ONLY the critical URL redirect monkey-patch
new_start_sh = r'''#!/bin/bash
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

# Note: No other monkey-patches needed - Gateway V2 handles all provider routing

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

print("Updating start.sh...")
with sftp.open(f'{DEPLOY_BASE}/start.sh', 'w') as f:
    f.write(new_start_sh)
run(f'chmod +x {DEPLOY_BASE}/start.sh')
print("  Done")

# Restart container
print("Restarting Alin container...")
out, _ = run(f'cd {DEPLOY_BASE} && {DOCKER} compose down 2>&1', timeout=30)
print(f"  {out}")
time.sleep(2)
out, _ = run(f'cd {DEPLOY_BASE} && {DOCKER} compose up -d 2>&1', timeout=60)
print(f"  {out}")

# Wait for boot
print("Waiting for startup...")
time.sleep(12)

# Check logs
print("\n=== Container logs ===")
out, _ = run(f'cd {DEPLOY_BASE} && {DOCKER} compose logs --tail 25 2>&1', timeout=15)
print(out[:2000])

# Verify the patch worked
print("\n=== Verify patch ===")
verify_script = '''
const fs = require('fs');
const f = '/app/node_modules/.pnpm/@mariozechner+pi-ai@0.52.6_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/models.generated.js';
const content = fs.readFileSync(f, 'utf-8');
const anthropic = (content.match(/api\\.anthropic\\.com/g) || []).length;
const proxy = (content.match(/127\\.0\\.0\\.1:8022/g) || []).length;
console.log('api.anthropic.com occurrences:', anthropic);
console.log('127.0.0.1:8022 occurrences:', proxy);
'''

with sftp.open('/tmp/verify_patch.js', 'w') as f:
    f.write(verify_script)

run(f'{DOCKER} cp /tmp/verify_patch.js deploy-openclaw-gateway-1:/tmp/verify_patch.js')
out, _ = run(f'{DOCKER} exec deploy-openclaw-gateway-1 node /tmp/verify_patch.js', timeout=10)
print(out)

# Check gateway log
print("\n=== Gateway V2 log (latest) ===")
out, _ = run('tail -10 /private/tmp/gateway-v2.log')
print(out)

sftp.close()
mac.close()
print("\n[DONE] Now test in Telegram!")
