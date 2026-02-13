#!/usr/bin/env python3
"""Verify node with longer timeouts and gateway logs."""
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

# Gateway logs about node connections
print('=== Gateway container logs (last 50) ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --tail 50 2>&1')
print(out.strip()[:2500], flush=True)

# Check if nodes list requires the node to have gone through a different registration
print('\n=== nodes list --help ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list --help 2>&1')
print(out.strip()[:500], flush=True)

# Try nodes run with higher timeout
print('\n=== nodes run (60s timeout) ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run echo "hello" 2>&1', timeout=60)
print(out.strip()[:500], flush=True)

# Check what happens if we try nodes invoke system.run
print('\n=== nodes invoke --help ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --help 2>&1')
print(out.strip()[:500], flush=True)

# Check node process health
print('\n=== Node still running? ===', flush=True)
out, _ = run('openclaw node status 2>&1')
print(out.strip()[:300], flush=True)

# Check all recent error/node logs
print('\n=== Latest node.log ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/logs/node.log 2>&1')
print(out.strip()[:800], flush=True)

print('\n=== Latest node.err.log ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/logs/node.err.log 2>&1')
print(out.strip()[:800] if out.strip() else '(empty)', flush=True)

c.close()
print('\nDone!', flush=True)
