#!/usr/bin/env python3
"""Phase 2: Node pairing - Start node, approve, configure exec permissions, verify."""
import paramiko, sys, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

# Two SSH connections - one for node process, one for approval/management
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
# Step 1: Kill any existing node processes
# ============================================================
print('=== Step 1: Clean up existing node processes ===')
run1('pkill -f "openclaw node" 2>/dev/null || true')
time.sleep(2)
out, _ = run1('pgrep -f "openclaw node" 2>/dev/null || echo "NO PROCESS"')
print(f'  Existing processes: {out.strip()}')

# ============================================================
# Step 2: Configure exec permissions (full access)
# ============================================================
print('\n=== Step 2: Configure exec-approvals.json ===')
approvals_dir = '/Users/fangjin/.openclaw'
approvals_file = f'{approvals_dir}/exec-approvals.json'

run1(f'mkdir -p {approvals_dir}')
sftp = client1.open_sftp()
with sftp.file(approvals_file, 'w') as f:
    f.write(json.dumps({"defaults": {"security": "full"}}, indent=2))
sftp.close()
print(f'  Written: {approvals_file}')

# Verify
out, _ = run1(f'cat {approvals_file}')
print(f'  Contents: {out.strip()}')

# ============================================================
# Step 3: Check current gateway node status
# ============================================================
print('\n=== Step 3: Check gateway node status ===')
out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list 2>&1')
print(f'  Nodes list: {out.strip()[:500]}')

out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes pending 2>&1')
print(f'  Pending: {out.strip()[:300]}')

# ============================================================
# Step 4: Start Node in background with retry
# ============================================================
print('\n=== Step 4: Start OpenClaw Node ===')

node_script = '''#!/bin/bash
export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH
export OPENCLAW_GATEWAY_TOKEN="mysecrettoken123"

echo "Starting OpenClaw Node at $(date)"
echo "Connecting to 127.0.0.1:18789..."

for i in $(seq 1 5); do
    echo ""
    echo "=== Attempt $i at $(date) ==="
    openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" 2>&1
    EXIT_CODE=$?
    echo "Exit code: $EXIT_CODE"
    if [ $EXIT_CODE -eq 0 ]; then
        echo "Node connected successfully"
        break
    fi
    echo "Retrying in 3 seconds..."
    sleep 3
done

echo "Node script finished at $(date)"
'''

sftp = client1.open_sftp()
with sftp.file('/tmp/start-openclaw-node.sh', 'w') as f:
    f.write(node_script)
sftp.close()
run1('chmod +x /tmp/start-openclaw-node.sh')

# Start in background
run1('nohup /tmp/start-openclaw-node.sh > /tmp/openclaw-node.log 2>&1 &')
print('  Node started in background')
time.sleep(3)

# Check if it's running
out, _ = run1('pgrep -f "openclaw node" 2>/dev/null || echo "NOT RUNNING"')
print(f'  Process check: {out.strip()}')

# ============================================================
# Step 5: Monitor and approve pending nodes
# ============================================================
print('\n=== Step 5: Monitor and approve pending nodes (30s) ===')
approved = False

for i in range(30):
    time.sleep(1)

    # Check pending
    out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes pending 2>&1')
    out_stripped = out.strip()

    if 'No pending' in out_stripped or not out_stripped:
        # Check if already connected
        out_list, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list --connected 2>&1')
        if 'MacMini' in out_list:
            print(f'  [{i}s] Node already connected!')
            approved = True
            break
        if i % 5 == 0:
            sys.stdout.write(f'  [{i}s] Waiting for pending node...\n')
            sys.stdout.flush()
        continue

    print(f'  [{i}s] Pending found: {out_stripped[:200]}')

    # Try JSON parse
    try:
        out_json, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes pending --json 2>&1')
        pending = json.loads(out_json.strip())
        if isinstance(pending, list) and len(pending) > 0:
            for p in pending:
                rid = p.get('id') or p.get('requestId') or p.get('nodeId', '')
                name = p.get('displayName') or p.get('name', '')
                print(f'  Approving: id={rid} name={name}')
                out3, _ = run2(f'docker exec deploy-openclaw-gateway-1 npx openclaw nodes approve "{rid}" 2>&1')
                print(f'  Approve result: {out3.strip()[:200]}')
                approved = True
    except json.JSONDecodeError:
        # Try approve by display name
        out3, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes approve MacMini 2>&1')
        print(f'  Approve by name: {out3.strip()[:200]}')
        # Also try approving all
        out4, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes approve --all 2>&1')
        print(f'  Approve all: {out4.strip()[:200]}')

    if approved:
        time.sleep(2)
        break

if not approved:
    print('  WARNING: No pending node detected within 30s')
    # Check node log
    out, _ = run1('tail -20 /tmp/openclaw-node.log')
    print(f'\n  Node log:\n{out.strip()}')

# ============================================================
# Step 6: Verify connection
# ============================================================
print('\n=== Step 6: Verify connection ===')
time.sleep(3)

out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes status 2>&1')
print(f'  Status: {out.strip()[:500]}')

out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list 2>&1')
print(f'  List: {out.strip()[:500]}')

out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list --connected 2>&1')
print(f'  Connected: {out.strip()[:500]}')

# Check node log
out, _ = run1('tail -20 /tmp/openclaw-node.log')
print(f'\n  Node log (last 20 lines):\n{out.strip()}')

client1.close()
client2.close()
print('\nPhase 2 complete!')
