#!/usr/bin/env python3
"""Phase 2: Simple node pairing - step by step."""
import paramiko, sys, time, json

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'
GW_PASSWORD = 'openclaw123'

def get_client():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=10)
    return c

def run(client, cmd, timeout=30):
    _, stdout, stderr = client.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

print('Connecting...', flush=True)
c = get_client()

# Step 1: Kill existing
print('Step 1: Kill existing node processes', flush=True)
run(c, 'pkill -f "openclaw node" 2>/dev/null || true')
time.sleep(1)

# Step 2: Start node in background with password
print('Step 2: Start node with OPENCLAW_GATEWAY_PASSWORD', flush=True)
node_cmd = f'OPENCLAW_GATEWAY_PASSWORD="{GW_PASSWORD}" nohup openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" > /tmp/openclaw-node.log 2>&1 &'
run(c, node_cmd)
time.sleep(5)

# Check log
out, _ = run(c, 'cat /tmp/openclaw-node.log')
print(f'Node log:\n{out.strip()[:600]}', flush=True)

# Check process
out, _ = run(c, 'pgrep -la "openclaw" 2>/dev/null || echo "NOT RUNNING"')
print(f'Processes: {out.strip()}', flush=True)

c.close()

# Step 3: Monitor with separate connection
print('\nStep 3: Check pending and approve...', flush=True)
c2 = get_client()

for i in range(20):
    time.sleep(1)
    out, _ = run(c2, 'docker exec deploy-openclaw-gateway-1 npx openclaw nodes pending 2>&1')
    out_s = out.strip()

    if 'No pending' not in out_s and out_s and 'Pending: 0' not in out_s:
        print(f'[{i}s] Pending: {out_s[:300]}', flush=True)
        # Try approve
        try:
            out_j, _ = run(c2, 'docker exec deploy-openclaw-gateway-1 npx openclaw nodes pending --json 2>&1')
            data = json.loads(out_j.strip())
            if isinstance(data, list):
                for p in data:
                    rid = p.get('id', '')
                    print(f'  Approving {rid}...', flush=True)
                    out3, _ = run(c2, f'docker exec deploy-openclaw-gateway-1 npx openclaw nodes approve "{rid}" 2>&1')
                    print(f'  Result: {out3.strip()[:200]}', flush=True)
        except Exception as e:
            print(f'  Error: {e}', flush=True)
        break

    # Also check if already connected
    out_conn, _ = run(c2, 'docker exec deploy-openclaw-gateway-1 npx openclaw nodes list 2>&1')
    if 'MacMini' in out_conn and 'Paired' in out_conn:
        print(f'[{i}s] Already paired! {out_conn.strip()[:200]}', flush=True)
        break

    if i % 5 == 0:
        print(f'[{i}s] Waiting... {out_s[:100]}', flush=True)

# Step 4: Verify
print('\nStep 4: Verify', flush=True)
time.sleep(2)
out, _ = run(c2, 'docker exec deploy-openclaw-gateway-1 npx openclaw nodes list 2>&1')
print(f'List: {out.strip()[:500]}', flush=True)

out, _ = run(c2, 'docker exec deploy-openclaw-gateway-1 npx openclaw nodes list --connected 2>&1')
print(f'Connected: {out.strip()[:500]}', flush=True)

# Node log final
c3 = get_client()
out, _ = run(c3, 'cat /tmp/openclaw-node.log')
print(f'\nFinal node log:\n{out.strip()[:800]}', flush=True)

c2.close()
c3.close()
print('\nPhase 2 done!', flush=True)
