#!/usr/bin/env python3
"""Phase 2: Node pairing with correct gateway password."""
import paramiko, sys, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

# Gateway password (not token!)
GW_PASSWORD = 'openclaw123'

client1 = paramiko.SSHClient()
client1.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client1.connect(HOST, username=USER, password=PASS)

client2 = paramiko.SSHClient()
client2.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client2.connect(HOST, username=USER, password=PASS)

def run1(cmd, timeout=30):
    _, stdout, stderr = client1.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

def run2(cmd, timeout=30):
    _, stdout, stderr = client2.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# ============================================================
# Step 1: Kill existing node processes
# ============================================================
print('=== Step 1: Clean up ===')
run1('pkill -f "openclaw node" 2>/dev/null || true')
time.sleep(2)
out, _ = run1('pgrep -la "openclaw" 2>/dev/null || echo "NO PROCESSES"')
print(f'  {out.strip()}')

# ============================================================
# Step 2: exec-approvals.json (already done in v2, verify)
# ============================================================
print('\n=== Step 2: Verify exec-approvals.json ===')
out, _ = run1('cat /Users/fangjin/.openclaw/exec-approvals.json 2>/dev/null || echo "NOT FOUND"')
print(f'  {out.strip()}')

# ============================================================
# Step 3: Start Node with GATEWAY PASSWORD in background
# ============================================================
print('\n=== Step 3: Start Node with password ===')

node_script = f'''#!/bin/bash
export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH
export OPENCLAW_GATEWAY_PASSWORD="{GW_PASSWORD}"

echo "Starting OpenClaw Node at $(date)"
echo "Connecting to 127.0.0.1:18789 with gateway password..."

openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" 2>&1

echo "Node exited at $(date) with code $?"
'''

sftp = client1.open_sftp()
with sftp.file('/tmp/start-openclaw-node.sh', 'w') as f:
    f.write(node_script)
sftp.close()
run1('chmod +x /tmp/start-openclaw-node.sh')

# Start in background
run1('nohup /tmp/start-openclaw-node.sh > /tmp/openclaw-node.log 2>&1 &')
print('  Node script started in background')
time.sleep(5)

# Check if running
out, _ = run1('pgrep -la "openclaw" 2>/dev/null || echo "NOT RUNNING"')
print(f'  Process: {out.strip()[:300]}')

# Check early log
out, _ = run1('cat /tmp/openclaw-node.log')
print(f'  Log so far:\n{out.strip()[:500]}')

# ============================================================
# Step 4: Monitor and approve pending nodes (30s)
# ============================================================
print('\n=== Step 4: Monitor and approve (30s) ===')
approved = False

for i in range(30):
    time.sleep(1)

    # Check pending
    out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes pending 2>&1')
    out_s = out.strip()

    if 'No pending' not in out_s and out_s and 'Pending: 0' not in out_s:
        print(f'  [{i}s] Pending found: {out_s[:200]}')

        # Try JSON parse for approval
        try:
            out_json, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes pending --json 2>&1')
            pending = json.loads(out_json.strip())
            if isinstance(pending, list) and len(pending) > 0:
                for p in pending:
                    rid = p.get('id') or p.get('requestId') or p.get('nodeId', '')
                    name = p.get('displayName') or p.get('name', '')
                    print(f'  Approving: id={rid} name={name}')
                    out3, _ = run2(f'docker exec deploy-openclaw-gateway-1 npx openclaw nodes approve "{rid}" 2>&1')
                    print(f'  Result: {out3.strip()[:200]}')
                    approved = True
        except (json.JSONDecodeError, Exception) as e:
            print(f'  JSON parse failed: {e}')
            # Try approve by name
            out3, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes approve MacMini 2>&1')
            print(f'  Approve by name: {out3.strip()[:200]}')

        if approved:
            time.sleep(2)
            break
    else:
        # Check if already connected
        out_conn, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list --connected 2>&1')
        if 'MacMini' in out_conn:
            print(f'  [{i}s] Node already connected!')
            approved = True
            break
        if i % 5 == 0:
            print(f'  [{i}s] Waiting...')

# ============================================================
# Step 5: Verify connection
# ============================================================
print('\n=== Step 5: Verify connection ===')
time.sleep(2)

out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes status 2>&1')
print(f'  Status:\n{out.strip()[:500]}')

out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list 2>&1')
print(f'  List:\n{out.strip()[:500]}')

out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list --connected 2>&1')
print(f'  Connected:\n{out.strip()[:500]}')

# Final node log
out, _ = run1('cat /tmp/openclaw-node.log')
print(f'\n  Node log:\n{out.strip()[:1000]}')

# Check if node process is still alive (it should be running persistently)
out, _ = run1('pgrep -la "openclaw" 2>/dev/null || echo "NOT RUNNING"')
print(f'\n  Node processes: {out.strip()[:300]}')

client1.close()
client2.close()
print('\nPhase 2 complete!')
