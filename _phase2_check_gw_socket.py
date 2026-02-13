#!/usr/bin/env python3
"""Check if exec-approvals socket exists inside gateway container."""
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
        return f'TIMEOUT: {e}', ''

# Check socket inside container
print('=== Socket inside container ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/exec-approvals.sock 2>&1')
print(f'  {out.strip()}', flush=True)

# Check exec-approvals config  
print('\n=== exec-approvals.json inside container ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/exec-approvals.json 2>&1')
print(out.strip()[:400], flush=True)

# Maybe the socket needs to be created by the gateway process
# Check if the gateway creates a socket at startup
print('\n=== Find all sockets in container ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 find / -name "*.sock" -type s 2>/dev/null | head -10')
print(out.strip()[:300], flush=True)

# The exec approval socket is created by the gateway's approval daemon
# Check gateway openclaw.json exec config
print('\n=== Gateway tools.exec config ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get(\'tools\',{}),indent=2))"')
print(out.strip()[:300], flush=True)

# The key thing: maybe we need openclaw.json tools.exec.security = "full" 
# AND the exec-approvals.json defaults.security = "full"
# AND the socket to exist
# The socket is created by the approval daemon which is part of the gateway

# Check if the gateway has a --exec-approvals flag or config
print('\n=== Check start.sh for approval config ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /home/node/start.sh 2>&1')
print(out.strip()[:500], flush=True)

# Maybe we need to run the approval daemon separately
print('\n=== Check approval daemon ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw approvals --help 2>&1')
print(out.strip()[:400], flush=True)

# Try: run the approval daemon inside container
print('\n=== Try starting approval socket ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw approvals get --json 2>&1')
print(out.strip()[:400], flush=True)

# Use approvals set inside container with security full
print('\n=== Set approvals inside container ===', flush=True)
run('docker exec deploy-openclaw-gateway-1 bash -c \'echo \'\'{"defaults":{"security":"full"},"agents":{}}\'\'  > /tmp/approvals.json\'')
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /tmp/approvals.json 2>&1')
print(f'  File: {out.strip()[:200]}', flush=True)

out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw approvals set --file /tmp/approvals.json 2>&1')
print(f'  Set result: {out.strip()[:400]}', flush=True)

# Check socket now
print('\n=== Socket after approval set ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/exec-approvals.sock 2>&1')
print(f'  {out.strip()}', flush=True)

# Try nodes run again
print('\n=== TEST: nodes run ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 10000 echo hello 2>&1', timeout=15)
print(f'  Result: {out.strip()[:400]}', flush=True)

c.close()
print('\nDone!', flush=True)
