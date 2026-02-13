#!/usr/bin/env python3
"""Debug: Check Gateway logs and pairing mechanism."""
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

def run(cmd, timeout=30):
    _, stdout, stderr = client.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# Kill retry loop
run('pkill -f "node-retry.sh" 2>/dev/null || true')
run('pkill -f "openclaw node" 2>/dev/null || true')

# 1. Check Gateway logs inside container
print('=== Gateway logs (last 50 lines) ===')
out, _ = run('docker logs --tail 50 deploy-openclaw-gateway-1 2>&1 | grep -i "node\\|pair\\|ws\\|connect" | tail -20')
print(out.strip()[:1000])

# 2. Check Gateway config for node/pairing settings
print('\n=== Gateway config (node-related) ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json')
import json
try:
    config = json.loads(out)
    gw = config.get('gateway', {})
    print(f'  gateway config: {json.dumps(gw, indent=2)[:500]}')
    nh = config.get('nodeHost', {})
    print(f'  nodeHost config: {json.dumps(nh, indent=2)[:300]}')
except:
    print(f'  raw: {out.strip()[:500]}')

# 3. Check Node log on host
print('\n=== Node log ===')
out, _ = run('cat ~/.openclaw/logs/node.log 2>/dev/null | tail -20')
print(out.strip()[:500])

# 4. Check node.json (pairing credentials)
print('\n=== Node credentials ===')
out, _ = run('cat ~/.openclaw/node.json 2>/dev/null || echo "NO node.json"')
print(out.strip()[:300])

# 5. Try with both token AND password
print('\n=== Try with both token and password ===')
out, _ = run(
    'OPENCLAW_GATEWAY_TOKEN="mysecrettoken123" '
    'OPENCLAW_GATEWAY_PASSWORD="openclaw123" '
    'openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" 2>&1',
    timeout=10
)
print(out.strip()[:500])

# 6. Check the LaunchAgent plist that was installed
print('\n=== LaunchAgent plist ===')
out, _ = run('cat ~/Library/LaunchAgents/ai.openclaw.node.plist')
print(out.strip()[:800])

# 7. Check the Gateway's controlUi setting (dangerouslyDisableDeviceAuth was mentioned)
print('\n=== Gateway controlUi / device auth ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json')
try:
    config = json.loads(out)
    cui = config.get('gateway', {}).get('controlUi', {})
    print(f'  controlUi: {json.dumps(cui, indent=2)}')
    auth = config.get('gateway', {}).get('auth', {})
    print(f'  auth: {json.dumps(auth, indent=2)}')
except:
    pass

client.close()
print('\nDone.')
