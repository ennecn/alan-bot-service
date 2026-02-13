#!/usr/bin/env python3
"""Phase 2: Start node in background and verify connection."""
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

# Clean kill
print('=== Kill existing ===', flush=True)
run('pkill -f "openclaw.*node" 2>/dev/null || true; pkill -f "openclaw-node" 2>/dev/null || true')
time.sleep(3)

# Start in background
print('=== Start node in background ===', flush=True)
run('echo "" > /tmp/node-bg.log')
run(f'nohup env OPENCLAW_GATEWAY_PASSWORD="{GW_PASSWORD}" openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" > /tmp/node-bg.log 2>&1 &')
print('  Started', flush=True)
time.sleep(8)

# Check log (no timeout issue since we're reading a file)
print('\n=== Node log ===', flush=True)
out, _ = run('cat /tmp/node-bg.log 2>&1')
print(out.strip()[:600], flush=True)

# Check process is alive
print('\n=== Process check ===', flush=True)
out, _ = run('pgrep -la "openclaw" 2>/dev/null || echo "NOT RUNNING"')
print(f'  {out.strip()[:300]}', flush=True)

# Check TCP connections of the node process
print('\n=== Node TCP connections ===', flush=True)
out, _ = run('pgrep -f "openclaw-node" 2>/dev/null')
pids = [p.strip() for p in out.strip().split('\n') if p.strip()]
for pid in pids:
    out2, _ = run(f'lsof -p {pid} -i TCP 2>&1 | head -10')
    print(f'  PID {pid}: {out2.strip()[:400]}', flush=True)

# Gateway logs
print('\n=== Gateway logs (15s) ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "15s" 2>&1')
print(out.strip()[:600] if out.strip() else '(no logs)', flush=True)

# Check if node is connected
print('\n=== Devices list ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw devices list 2>&1')
print(out.strip()[:400], flush=True)

print('\n=== Nodes list ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list 2>&1')
print(out.strip()[:400], flush=True)

# Try: nodes describe (to see if node is available)
print('\n=== Nodes describe MacMini ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes describe --node MacMini 2>&1', timeout=15)
print(out.strip()[:400], flush=True)

# If node log shows "pairing required", check pending and approve
out, _ = run('cat /tmp/node-bg.log 2>&1')
if 'pairing required' in out:
    print('\n=== Still pairing required! Checking pending... ===', flush=True)
    out2, _ = run(f'cat {DEPLOY}/config/devices/pending.json')
    try:
        pending = json.loads(out2.strip())
        if pending:
            for req_id in pending:
                print(f'  Approving: {req_id}', flush=True)
                out3, _ = run(f'docker exec deploy-openclaw-gateway-1 npx openclaw devices approve "{req_id}" 2>&1')
                print(f'  Result: {out3.strip()[:200]}', flush=True)
            
            # Wait for node to reconnect
            print('  Waiting for reconnect...', flush=True)
            time.sleep(10)
            out4, _ = run('cat /tmp/node-bg.log 2>&1')
            print(f'  Log after approve:\n{out4.strip()[:600]}', flush=True)
    except:
        pass
elif not out.strip() or out.strip() == 'node host PATH:':
    # Node connected silently = success!
    print('\n=== Node connected successfully (no errors)! ===', flush=True)

c.close()
print('\nDone!', flush=True)
