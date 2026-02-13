#!/usr/bin/env python3
"""Phase 2 Final: Verify node is connected and functional."""
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
        return f'ERROR: {e}', ''

# Check node is running
print('=== Node process ===', flush=True)
out, _ = run('pgrep -la "openclaw" 2>/dev/null || echo "NOT RUNNING"')
print(f'  {out.strip()[:200]}', flush=True)

# TCP connection check
print('\n=== TCP connections to 18789 ===', flush=True)
out, _ = run('netstat -an | grep 18789 | grep ESTABLISH')
print(f'  {out.strip()[:300]}', flush=True)

# Try nodes status (uses node.list which merges devices + connected)
print('\n=== nodes status (uses node.list) ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes status 2>&1', timeout=15)
print(out.strip()[:500], flush=True)

# Try nodes run with JSON output
print('\n=== nodes run --node MacMini --json echo hello ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --json -- echo hello 2>&1', timeout=20)
print(out.strip()[:500], flush=True)

# Try nodes run without --json
print('\n=== nodes run --node MacMini echo hello ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini -- echo "hello from MacMini" 2>&1', timeout=20)
print(out.strip()[:500], flush=True)

# Try nodes invoke 
print('\n=== nodes invoke system.run --node MacMini ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --json -- echo "test" 2>&1', timeout=20)
print(out.strip()[:500], flush=True)

# Try nodes describe
print('\n=== nodes describe MacMini ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes describe --node MacMini 2>&1', timeout=20)
print(out.strip()[:500], flush=True)

# Also try the device ID as node reference
DEVICE_ID = '53e13c5ae4de0ca154c8cd019c8b1cd98d108794fceceeaa1d12c4328b565d51'
print(f'\n=== nodes run --node {DEVICE_ID[:12]} echo test ===', flush=True)
out, _ = run(f'docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node {DEVICE_ID[:12]} -- echo test 2>&1', timeout=20)
print(out.strip()[:500], flush=True)

c.close()
print('\nDone!', flush=True)
