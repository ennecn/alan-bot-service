#!/usr/bin/env python3
"""Check if node is actually connected and gateway sees it."""
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

# Check gateway logs since restart (should show any node connections)
print('=== All gateway logs since restart ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "10m" 2>&1')
print(out.strip()[:3000], flush=True)

# Check node network connections
print('\n=== Node network connections ===', flush=True)
out, _ = run('lsof -p 45460 -i 2>/dev/null || echo "N/A"')
print(out.strip()[:500], flush=True)
out, _ = run('lsof -p 45461 -i 2>/dev/null || echo "N/A"')
print(out.strip()[:500], flush=True)

# Check if node process is actually openclaw
print('\n=== Process info ===', flush=True)
out, _ = run('ps aux | grep "openclaw" | grep -v grep')
print(out.strip()[:500], flush=True)

# Check the node err log file
print('\n=== /tmp/node-manual.log (full) ===', flush=True)
out, _ = run('cat /tmp/node-manual.log 2>&1')
print(out.strip()[:1000], flush=True)

# Check the node stderr (might be separate)
print('\n=== Try to get more node output ===', flush=True)
# Kill current manual node
run('pkill -f "openclaw node" 2>/dev/null || true')
time.sleep(2)

# Run with combined output to a log file, including stderr
run('OPENCLAW_GATEWAY_PASSWORD="openclaw123" nohup sh -c \'openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" 2>&1\' > /tmp/node-combined.log 2>&1 &')
time.sleep(8)

out, _ = run('cat /tmp/node-combined.log 2>&1')
print(f'Combined log:\n{out.strip()[:1000]}', flush=True)

# Check gateway logs again
print('\n=== Gateway logs (latest) ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "15s" 2>&1')
print(out.strip()[:1000], flush=True)

c.close()
print('\nDone!', flush=True)
