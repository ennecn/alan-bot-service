#!/usr/bin/env python3
"""Verify node is actually connected and usable."""
import paramiko, sys, io, time
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

# Check node is still running
print('=== Node status ===', flush=True)
out, _ = run('openclaw node status 2>&1')
print(out.strip()[:400], flush=True)

# Check error log
print('\n=== Error log ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/logs/node.err.log 2>&1')
print(out.strip()[:500] if out.strip() else '(empty - no errors)', flush=True)

# Check full node log
print('\n=== Node log ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/logs/node.log 2>&1')
print(out.strip()[:500], flush=True)

# Try to run a command on the node from gateway
print('\n=== Try: nodes run echo test ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini echo "hello from node" 2>&1')
print(out.strip()[:500], flush=True)

# Try: nodes invoke
print('\n=== Try: nodes invoke ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --help 2>&1')
print(out.strip()[:500], flush=True)

# Try: nodes describe
print('\n=== Try: nodes describe MacMini ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes describe MacMini 2>&1')
print(out.strip()[:500], flush=True)

# Try: nodes list with different flags
print('\n=== Try: nodes list --all ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list --all 2>&1')
print(out.strip()[:500], flush=True)

print('\n=== Try: nodes list --json ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list --json 2>&1')
print(out.strip()[:500], flush=True)

# Check: devices list --json
print('\n=== Devices list --json ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw devices list --json 2>&1')
print(out.strip()[:1000], flush=True)

# Check gateway logs
print('\n=== Gateway container logs (last 30 lines) ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --tail 30 2>&1')
print(out.strip()[:1500], flush=True)

c.close()
print('\nDone!', flush=True)
