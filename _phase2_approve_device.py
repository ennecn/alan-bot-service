#!/usr/bin/env python3
"""Phase 2: Approve device pairing for MacMini node."""
import paramiko, sys, io, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=10)

def run(cmd, timeout=30):
    _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

deploy = '/Users/fangjin/Desktop/p/docker-openclawd/deploy'

# Check what commands exist for device pairing
print('=== openclaw pairing --help (container) ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw pairing --help 2>&1')
print(out.strip()[:500], flush=True)

print('\n=== openclaw devices --help (container) ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw devices --help 2>&1')
print(out.strip()[:500], flush=True)

# List pending devices
print('\n=== openclaw devices pending ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw devices pending 2>&1')
print(out.strip()[:500], flush=True)

# Try to approve the pending device by requestId
REQUEST_ID = 'e5545824-8daa-4f9d-b9ac-0e358f354af7'
DEVICE_ID = '53e13c5ae4de0ca154c8cd019c8b1cd98d108794fceceeaa1d12c4328b565d51'

print(f'\n=== Try approve by requestId: {REQUEST_ID} ===', flush=True)
out, _ = run(f'docker exec deploy-openclaw-gateway-1 npx openclaw devices approve "{REQUEST_ID}" 2>&1')
print(out.strip()[:500], flush=True)

print(f'\n=== Try approve by deviceId ===', flush=True)
out, _ = run(f'docker exec deploy-openclaw-gateway-1 npx openclaw devices approve "{DEVICE_ID}" 2>&1')
print(out.strip()[:500], flush=True)

print('\n=== Try pairing approve ===', flush=True)
out, _ = run(f'docker exec deploy-openclaw-gateway-1 npx openclaw pairing approve "{REQUEST_ID}" 2>&1')
print(out.strip()[:500], flush=True)

# Try the nodes approve too
print('\n=== Try nodes approve by requestId ===', flush=True)
out, _ = run(f'docker exec deploy-openclaw-gateway-1 npx openclaw nodes approve "{REQUEST_ID}" 2>&1')
print(out.strip()[:500], flush=True)

# Check if it worked - look at paired.json
print('\n=== paired.json after approval ===', flush=True)
out, _ = run(f'cat {deploy}/config/devices/paired.json')
print(out.strip()[:1000], flush=True)

print('\n=== pending.json after approval ===', flush=True)
out, _ = run(f'cat {deploy}/config/devices/pending.json')
print(out.strip()[:500], flush=True)

# Also try: directly modify the paired.json to add the node
print('\n=== devices list ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw devices list 2>&1')
print(out.strip()[:500], flush=True)

# Check node status after attempts
print('\n=== openclaw node status (host) ===', flush=True)
out, _ = run('openclaw node status 2>&1')
print(out.strip()[:500], flush=True)

# Check launchd service
print('\n=== launchd status ===', flush=True)
out, _ = run('launchctl list | grep -i openclaw 2>&1')
print(out.strip()[:300], flush=True)

# Check actual plist that was created
print('\n=== ai.openclaw.node.plist ===', flush=True)
out, _ = run('cat ~/Library/LaunchAgents/ai.openclaw.node.plist 2>/dev/null || echo "NOT FOUND"')
print(out.strip()[:1000], flush=True)

# Check node log
print('\n=== Node log (from launchd) ===', flush=True)
out, _ = run('tail -30 /Users/fangjin/.openclaw/logs/node.log 2>/dev/null || echo "NO LOG"')
print(out.strip()[:1000], flush=True)

c.close()
print('\nDone!', flush=True)
