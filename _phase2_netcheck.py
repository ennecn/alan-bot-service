#!/usr/bin/env python3
"""Check network state of node process and try alternative approach."""
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

# Kill ALL node processes
print('=== Kill all openclaw processes ===', flush=True)
run('kill -9 $(pgrep -f "openclaw") 2>/dev/null || true')
time.sleep(3)
out, _ = run('pgrep -la openclaw 2>/dev/null || echo "ALL KILLED"')
print(f'  {out.strip()}', flush=True)

# Start fresh and capture STDERR immediately
print('\n=== Start node with combined output ===', flush=True)
cmd = 'cd /Users/fangjin && OPENCLAW_GATEWAY_PASSWORD="openclaw123" openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" > /tmp/node-test.log 2>&1 &'
run(cmd)
time.sleep(8)

# Get the actual PID
out, _ = run('pgrep -f "openclaw.*node.*run" 2>/dev/null || pgrep -f "openclaw-node" 2>/dev/null || echo "NO PID"')
node_pid = out.strip().split('\n')[0].strip()
print(f'  Node PID: {node_pid}', flush=True)

# Check network connections for THIS specific process
if node_pid != 'NO PID':
    print(f'\n=== Network connections for PID {node_pid} ===', flush=True)
    out, _ = run(f'lsof -p {node_pid} -i TCP 2>&1 | head -20')
    print(out.strip()[:500], flush=True)

# Check log output
print('\n=== node-test.log ===', flush=True)
out, _ = run('cat /tmp/node-test.log 2>&1')
print(out.strip()[:800], flush=True)

# Check gateway logs
print('\n=== Gateway logs (last 15s) ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "15s" 2>&1')
print(out.strip()[:1000] if out.strip() else '(no logs)', flush=True)

# Check all processes listening on 18789
print('\n=== Who listens on 18789? ===', flush=True)
out, _ = run('lsof -i :18789 -P -n 2>&1 | head -10')
print(out.strip()[:500], flush=True)

# Try netcat to test if 18789 is reachable
print('\n=== Test 127.0.0.1:18789 with nc ===', flush=True)
out, _ = run('echo "" | nc -w2 127.0.0.1 18789 2>&1; echo "Exit: $?"')
print(out.strip()[:200], flush=True)

# Try curl to gateway WebSocket endpoint
print('\n=== Curl gateway health ===', flush=True)
out, _ = run('curl -s http://127.0.0.1:18789/__openclaw__/health 2>&1 || curl -s http://127.0.0.1:18789/ 2>&1 | head -5')
print(out.strip()[:300], flush=True)

c.close()
print('\nDone!', flush=True)
