#!/usr/bin/env python3
"""Test if we can actually invoke commands on the node."""
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=30):
    try:
        _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
        return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')
    except Exception as e:
        return f'TIMEOUT/ERROR: {e}', ''

# Check node log
print('=== Node log ===', flush=True)
out, _ = run('cat /tmp/node-bg.log 2>&1')
print(out.strip()[:500], flush=True)

# Gateway logs recent
print('\n=== Gateway logs (2 min) ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "2m" 2>&1')
print(out.strip()[:1000] if out.strip() else '(empty)', flush=True)

# Check netstat for connections to port 18789 
print('\n=== netstat for 18789 ===', flush=True)
out, _ = run('netstat -an | grep 18789 | head -10 2>&1')
print(out.strip()[:500] if out.strip() else '(no connections)', flush=True)

# Try nodes run --node MacMini with short timeout
print('\n=== nodes run --node MacMini (15s timeout) ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 timeout 12 npx openclaw nodes run --node MacMini -- echo "hello from MacMini" 2>&1', timeout=20)
print(out.strip()[:500], flush=True)

# Try using curl to gateway API for node info
print('\n=== Gateway API: devices ===', flush=True)
out, _ = run('curl -s http://127.0.0.1:18789/__openclaw__/api/devices 2>&1 | head -20', timeout=10)
print(out.strip()[:500], flush=True)

# Try the control-ui API endpoints
print('\n=== Control UI API endpoints ===', flush=True)
out, _ = run('curl -s http://127.0.0.1:18789/__openclaw__/api/nodes 2>&1 | head -20', timeout=10)
print(out.strip()[:300], flush=True)

# Check the node.json
print('\n=== node.json ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/node.json')
print(out.strip(), flush=True)

# Check if node updated device-auth.json
print('\n=== device-auth.json ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/identity/device-auth.json')
print(out.strip(), flush=True)

c.close()
print('\nDone!', flush=True)
