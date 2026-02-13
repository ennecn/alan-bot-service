#!/usr/bin/env python3
"""Restart gateway container and node, then verify pairing."""
import paramiko, sys, io, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'
DEPLOY = '/Users/fangjin/Desktop/p/docker-openclawd/deploy'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=10)

def run(cmd, timeout=60):
    _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# Step 1: Stop node
print('=== Step 1: Stop node service ===', flush=True)
run('openclaw node stop 2>&1')
run('pkill -f "openclaw node" 2>/dev/null || true')
time.sleep(2)
print('  Done', flush=True)

# Step 2: Confirm device is in paired.json
print('\n=== Step 2: Verify paired.json has MacMini ===', flush=True)
out, _ = run(f'cat {DEPLOY}/config/devices/paired.json')
data = json.loads(out.strip())
mac_device = None
for did, info in data.items():
    if info.get('displayName') == 'MacMini':
        mac_device = info
        print(f'  MacMini device found: {did[:20]}... role={info.get("role")}', flush=True)
        print(f'  Token: {info.get("tokens", {}).get("node", {}).get("token", "NONE")[:8]}...', flush=True)

if not mac_device:
    print('  WARNING: MacMini not found in paired.json!', flush=True)

# Step 3: Restart gateway container
print('\n=== Step 3: Restart gateway container ===', flush=True)
out, _ = run(f'cd {DEPLOY} && docker compose restart openclaw-gateway 2>&1', timeout=60)
print(f'  {out.strip()[:300]}', flush=True)

# Wait for gateway to be ready
print('  Waiting for gateway to be ready...', flush=True)
for i in range(20):
    time.sleep(2)
    out, _ = run('docker exec deploy-openclaw-gateway-1 echo "ready" 2>&1')
    if 'ready' in out:
        print(f'  Gateway ready after {(i+1)*2}s', flush=True)
        break

# Step 4: Verify gateway sees the paired device
print('\n=== Step 4: Verify gateway state after restart ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw devices list 2>&1')
print(f'  Devices:\n{out.strip()[:500]}', flush=True)

# Step 5: Clear node logs and restart
print('\n=== Step 5: Restart node service ===', flush=True)
run('echo "" > /Users/fangjin/.openclaw/logs/node.log')
run('echo "" > /Users/fangjin/.openclaw/logs/node.err.log')

# Manually bootstrap launchd
uid_out, _ = run('id -u')
uid = uid_out.strip()
PLIST = '/Users/fangjin/Library/LaunchAgents/ai.openclaw.node.plist'
run(f'launchctl bootout gui/{uid}/ai.openclaw.node 2>&1 || true')
time.sleep(1)
out, _ = run(f'launchctl bootstrap gui/{uid} {PLIST} 2>&1')
print(f'  Bootstrap: {out.strip()}', flush=True)
time.sleep(8)

# Step 6: Check results
print('\n=== Step 6: Check results ===', flush=True)

out, _ = run('openclaw node status 2>&1')
print(f'  Node status:\n{out.strip()[:400]}', flush=True)

out, _ = run('cat /Users/fangjin/.openclaw/logs/node.log 2>&1')
print(f'\n  Node log:\n{out.strip()[:500]}', flush=True)

out, _ = run('cat /Users/fangjin/.openclaw/logs/node.err.log 2>&1')
print(f'\n  Error log:\n{out.strip()[:500]}', flush=True)

# Check node.json for pairingToken
out, _ = run('cat /Users/fangjin/.openclaw/node.json')
print(f'\n  node.json:\n{out.strip()}', flush=True)

# Check nodes list
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list 2>&1')
print(f'\n  Nodes list:\n{out.strip()[:500]}', flush=True)

# Check pending devices
out, _ = run(f'cat {DEPLOY}/config/devices/pending.json')
print(f'\n  Pending devices:\n{out.strip()[:300]}', flush=True)

c.close()
print('\nDone!', flush=True)
