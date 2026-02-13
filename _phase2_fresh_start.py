#!/usr/bin/env python3
"""Fresh start: kill node, clear logs, restart, monitor both sides."""
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=10)

def run(cmd, timeout=60):
    _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# Step 1: Kill everything and verify plist
print('=== Step 1: Stop node ===', flush=True)
uid_out, _ = run('id -u')
uid = uid_out.strip()
run(f'launchctl bootout gui/{uid}/ai.openclaw.node 2>&1 || true')
run('pkill -f "openclaw node" 2>/dev/null || true')
time.sleep(2)

# Verify plist has password
print('=== Step 2: Verify plist has password ===', flush=True)
out, _ = run('grep -A2 "OPENCLAW_GATEWAY_PASSWORD" ~/Library/LaunchAgents/ai.openclaw.node.plist')
print(f'  {out.strip()}', flush=True)
if not out.strip():
    print('  ERROR: Password not in plist!', flush=True)

# Clear logs
print('=== Step 3: Clear all logs ===', flush=True)
run('echo "" > /Users/fangjin/.openclaw/logs/node.log')
run('echo "" > /Users/fangjin/.openclaw/logs/node.err.log')

# Step 4: Start node manually (not launchd) to check env var passing
print('=== Step 4: Test manual run with password ===', flush=True)
run('pkill -f "openclaw node" 2>/dev/null || true')
time.sleep(1)

# Start node manually in background with env var
run('OPENCLAW_GATEWAY_PASSWORD="openclaw123" nohup openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" > /tmp/node-manual.log 2>&1 &')
print('  Started manually with OPENCLAW_GATEWAY_PASSWORD', flush=True)
time.sleep(5)

# Check process
out, _ = run('pgrep -la "openclaw" 2>/dev/null || echo "NOT RUNNING"')
print(f'  Process: {out.strip()[:300]}', flush=True)

# Check manual log
print('\n=== Manual run log ===', flush=True)
out, _ = run('cat /tmp/node-manual.log 2>&1')
print(out.strip()[:800], flush=True)

# Check gateway logs for connection
print('\n=== Gateway logs (recent) ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "30s" 2>&1')
print(out.strip()[:1000], flush=True)

# Check node.json for any changes (e.g., pairingToken stored)
print('\n=== node.json ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/node.json')
print(out.strip(), flush=True)

# Check device-auth
print('\n=== device-auth.json ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/identity/device-auth.json')
print(out.strip(), flush=True)

# Check if pending devices appeared
print('\n=== pending.json ===', flush=True)
out, _ = run('cat /Users/fangjin/Desktop/p/docker-openclawd/deploy/config/devices/pending.json')
print(out.strip()[:500], flush=True)

# Nodes list
print('\n=== nodes list ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list --json 2>&1')
print(out.strip()[:500], flush=True)

# Devices list
print('\n=== devices list ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw devices list 2>&1')
print(out.strip()[:500], flush=True)

c.close()
print('\nDone!', flush=True)
