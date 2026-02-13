#!/usr/bin/env python3
"""Phase 2 Final: Complete node pairing with network verification."""
import paramiko, sys, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'
GW_PASSWORD = 'openclaw123'
DEPLOY = '/Users/fangjin/Desktop/p/docker-openclawd/deploy'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=30):
    _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# Step 1: Kill all openclaw node processes carefully
print('=== Step 1: Clean kill ===', flush=True)
run('pkill -f "openclaw.*node.*run" 2>/dev/null || true')
run('pkill -f "openclaw-node" 2>/dev/null || true')
time.sleep(3)
out, _ = run('pgrep -la "openclaw" 2>/dev/null || echo "CLEAN"')
print(f'  {out.strip()[:200]}', flush=True)

# Step 2: Verify gateway is running
print('\n=== Step 2: Gateway check ===', flush=True)
out, _ = run('docker ps --filter name=deploy-openclaw-gateway --format "{{.Status}}"')
print(f'  Gateway: {out.strip()}', flush=True)
out, _ = run('curl -s -w "\\nHTTP %{http_code}" http://127.0.0.1:18789/ 2>&1 | tail -2')
print(f'  Curl: {out.strip()[:200]}', flush=True)

# Step 3: Run node foreground (5 second test)
print('\n=== Step 3: Quick test node connection ===', flush=True)
# Use perl to set alarm for timeout
cmd = '''perl -e '$SIG{ALRM} = sub { kill 15, $$child; exit 0 }; alarm 6; $child = fork; if ($child == 0) { $ENV{OPENCLAW_GATEWAY_PASSWORD} = "openclaw123"; exec("openclaw", "node", "run", "--host", "127.0.0.1", "--port", "18789", "--display-name", "MacMini") } else { waitpid($child, 0); }' 2>&1'''
out, err = run(cmd, timeout=15)
print(f'  Output: {out.strip()[:500]}', flush=True)
if err.strip():
    print(f'  Stderr: {err.strip()[:300]}', flush=True)

# Step 4: Check if the connection worked by looking at gateway logs
print('\n=== Step 4: Gateway logs ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "20s" 2>&1')
print(f'  {out.strip()[:800]}', flush=True)

# Step 5: Check pending and approve if needed
print('\n=== Step 5: Check pending devices ===', flush=True)
out, _ = run(f'cat {DEPLOY}/config/devices/pending.json')
try:
    pending = json.loads(out.strip())
    if pending:
        print(f'  Found {len(pending)} pending device(s)', flush=True)
        for req_id in pending:
            print(f'  Approving: {req_id}', flush=True)
            out2, _ = run(f'docker exec deploy-openclaw-gateway-1 npx openclaw devices approve "{req_id}" 2>&1')
            print(f'  Result: {out2.strip()[:200]}', flush=True)
    else:
        print('  No pending devices', flush=True)
except:
    print(f'  Raw: {out.strip()[:200]}', flush=True)

# Step 6: Now start node persistently in background
print('\n=== Step 6: Start node persistently ===', flush=True)
# Use nohup with explicit env
run(f'nohup env OPENCLAW_GATEWAY_PASSWORD="{GW_PASSWORD}" openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" > /tmp/node-persistent.log 2>&1 &')
time.sleep(8)

out, _ = run('cat /tmp/node-persistent.log 2>&1')
print(f'  Log: {out.strip()[:500]}', flush=True)

# Check gateway logs
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "12s" 2>&1')
print(f'\n  GW logs: {out.strip()[:500]}', flush=True)

# Check process is alive
out, _ = run('pgrep -la "openclaw" 2>/dev/null || echo "NOT RUNNING"')
print(f'\n  Processes: {out.strip()[:200]}', flush=True)

# Check network connection of node
out, _ = run('pgrep -f "openclaw-node" 2>/dev/null')
node_pids = out.strip().split('\n')
for pid in node_pids:
    if pid.strip():
        out, _ = run(f'lsof -p {pid.strip()} -i TCP 2>&1 | grep -i "18789\\|ESTABLISH" | head -5')
        if out.strip():
            print(f'  PID {pid.strip()} TCP: {out.strip()[:300]}', flush=True)

# Step 7: Final verification
print('\n=== Step 7: Final state ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw devices list 2>&1')
print(f'  Devices:\n{out.strip()[:400]}', flush=True)

out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list 2>&1')
print(f'\n  Nodes:\n{out.strip()[:400]}', flush=True)

c.close()
print('\nDone!', flush=True)
