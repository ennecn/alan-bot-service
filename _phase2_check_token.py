#!/usr/bin/env python3
"""Check device/node pairing state and tokens after approval."""
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

def run(cmd, timeout=30):
    _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# Check paired.json (has the MacMini device with token)
print('=== Paired devices (with tokens) ===', flush=True)
out, _ = run(f'cat {DEPLOY}/config/devices/paired.json')
print(out.strip()[:2000], flush=True)

# Check node.json
print('\n=== Host node.json ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/node.json')
print(out.strip(), flush=True)

# Check full node identity dir
print('\n=== Host .openclaw/identity/ ===', flush=True)
out, _ = run('find /Users/fangjin/.openclaw/identity/ -type f -exec echo "--- {} ---" \\; -exec cat {} \\; 2>&1')
print(out.strip()[:1000], flush=True)

# After device approval, does the node need to restart to pick up the token?
# Let's check latest logs
print('\n=== Latest node.log ===', flush=True)
out, _ = run('tail -20 /Users/fangjin/.openclaw/logs/node.log 2>&1')
print(out.strip()[:500], flush=True)

print('\n=== Latest node.err.log ===', flush=True)
out, _ = run('tail -20 /Users/fangjin/.openclaw/logs/node.err.log 2>&1')
print(out.strip()[:800], flush=True)

# Maybe the node needs to be restarted after device approval?
print('\n=== Restart node ===', flush=True)
run('openclaw node stop 2>&1')
time.sleep(2)
run('openclaw node restart 2>&1')
time.sleep(5)

# Check status
print('  Node status:', flush=True)
out, _ = run('openclaw node status 2>&1')
print(f'  {out.strip()[:300]}', flush=True)

# Check new logs
print('\n=== New logs after restart ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/logs/node.log 2>&1')
lines = out.strip().split('\n')
print('\n'.join(lines[-20:])[:800], flush=True)

out, _ = run('cat /Users/fangjin/.openclaw/logs/node.err.log 2>&1')
lines = out.strip().split('\n')
print('\n'.join(lines[-20:])[:800], flush=True)

# Check nodes list from gateway
print('\n=== Nodes list ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list 2>&1')
print(out.strip()[:500], flush=True)

# Check if node.json was updated with token
print('\n=== node.json after restart ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/node.json')
print(out.strip(), flush=True)

c.close()
print('\nDone!', flush=True)
