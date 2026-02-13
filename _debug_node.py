#!/usr/bin/env python3
"""Debug Node startup and find openclaw binary in container."""
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH && {cmd}'
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return out, err

# 1. Try running openclaw node directly and capture error
print('=== Debug: Try openclaw node run directly ===')
out, err = run('OPENCLAW_GATEWAY_TOKEN="mysecrettoken123" openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" 2>&1 &', timeout=10)
print(f'  out: {out.strip()[:500]}')
print(f'  err: {err.strip()[:500]}')
time.sleep(5)

out, _ = run('cat /tmp/openclaw-node.log 2>/dev/null')
print(f'  log: {out.strip()[:500]}')

# Check if process is running
out, _ = run('ps aux | grep "openclaw" | grep -v grep')
print(f'  processes: {out.strip()[:500]}')

# 2. Try openclaw version
print('\n=== Debug: openclaw version ===')
out, err = run('openclaw --version 2>&1')
print(f'  version: {out.strip()} | err: {err.strip()[:200]}')

# 3. Try direct node command
print('\n=== Debug: Try openclaw node --help ===')
out, err = run('openclaw node --help 2>&1')
print(f'  {out.strip()[:500]}')

# 4. Check what's inside container
print('\n=== Debug: Container CLI ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 which node 2>/dev/null')
print(f'  container node: {out.strip()}')
out, _ = run('docker exec deploy-openclaw-gateway-1 ls /usr/local/bin/ 2>/dev/null | head -20')
print(f'  container bins: {out.strip()[:300]}')
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw --version 2>&1')
print(f'  container npx openclaw: {out.strip()[:300]}')

# 5. Check the Gateway HTTP API directly (for nodes management)
print('\n=== Debug: Gateway API ===')
out, _ = run('curl -s http://127.0.0.1:18789/health 2>/dev/null')
print(f'  /health: {out.strip()[:200]}')

# Try nodes API
out, _ = run('curl -s -H "Authorization: Bearer mysecrettoken123" http://127.0.0.1:18789/api/nodes 2>/dev/null')
print(f'  /api/nodes: {out.strip()[:300]}')

out, _ = run('curl -s -H "Authorization: Bearer mysecrettoken123" http://127.0.0.1:18789/api/nodes/pending 2>/dev/null')
print(f'  /api/nodes/pending: {out.strip()[:300]}')

client.close()
print('\nDebug done.')
