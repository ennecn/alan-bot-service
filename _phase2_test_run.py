#!/usr/bin/env python3
"""Test running a command on the node."""
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

# Get recent gateway logs (after restart)
print('=== Gateway logs (most recent) ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "2m" 2>&1')
print(out.strip()[:2000], flush=True)

# Check all gateway logs since about 5 minutes ago
print('\n=== Gateway logs (5 min) ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "5m" 2>&1')
print(out.strip()[:2000], flush=True)

# Try nodes run with explicit node name
print('\n=== Try nodes run --node MacMini ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini -- echo "test" 2>&1', timeout=30)
print(out.strip()[:500], flush=True)

# Try specifying as node id from node.json
print('\n=== Try nodes run with node id ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node 368cef16-74e8-41d1-9145-16643586b691 -- echo "test" 2>&1', timeout=30)
print(out.strip()[:500], flush=True)

# Try using device id
DEVICE_ID = '53e13c5ae4de0ca154c8cd019c8b1cd98d108794fceceeaa1d12c4328b565d51'
print(f'\n=== Try nodes run with device id ===', flush=True)
out, _ = run(f'docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node {DEVICE_ID[:12]} -- echo "test" 2>&1', timeout=30)
print(out.strip()[:500], flush=True)

# Check if there's a separate nodes pairing system
print('\n=== Search for nodes/paired.json in gateway config ===', flush=True)
out, _ = run('find /Users/fangjin/Desktop/p/docker-openclawd/deploy/config/ -name "*node*" -o -name "*pair*" 2>&1')
print(out.strip()[:500], flush=True)

# Check devices that have role=node
print('\n=== devices list --json (full) ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw devices list --json 2>&1')
print(out.strip()[:1500], flush=True)

c.close()
print('\nDone!', flush=True)
