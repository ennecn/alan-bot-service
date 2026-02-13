#!/usr/bin/env python3
"""Phase 2 retry: Fix auth and pair Node with Gateway."""
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

# Kill any existing node process
run('pkill -f "openclaw node" 2>/dev/null || true')
time.sleep(1)

# Step 1: Start Node with PASSWORD (not token)
print('=== Step 1: Start Node with password auth ===')
node_cmd = (
    'export OPENCLAW_GATEWAY_PASSWORD="openclaw123" && '
    'nohup openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" '
    '> /tmp/openclaw-node.log 2>&1 &'
)
run(node_cmd)
print('  Node started in background')
time.sleep(6)

# Check log
out, _ = run('cat /tmp/openclaw-node.log')
print(f'  Log:\n{out.strip()[:800]}')

# Check process
out, _ = run('ps aux | grep "openclaw node" | grep -v grep')
print(f'\n  Process: {out.strip()[:200]}')

# Step 2: Check pairing status from container
print('\n=== Step 2: Check pairing via container ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes pending 2>&1')
print(f'  Pending: {out.strip()[:500]}')

out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list 2>&1')
print(f'  List: {out.strip()[:500]}')

out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes status 2>&1')
print(f'  Status: {out.strip()[:500]}')

# Step 3: Try to approve if there's a pending request
print('\n=== Step 3: Attempt auto-approve ===')
# Get pending nodes and try to approve
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes pending --json 2>&1')
print(f'  Pending JSON: {out.strip()[:500]}')

# If there are pending nodes, try to approve them
if '"id"' in out or 'requestId' in out:
    import json
    try:
        pending = json.loads(out.strip())
        if isinstance(pending, list):
            for p in pending:
                req_id = p.get('id') or p.get('requestId') or p.get('nodeId')
                if req_id:
                    print(f'  Approving: {req_id}')
                    out2, _ = run(f'docker exec deploy-openclaw-gateway-1 npx openclaw nodes approve {req_id} 2>&1')
                    print(f'  Result: {out2.strip()[:200]}')
    except:
        # Try simple approve
        print('  Trying to approve by name...')
        out2, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes approve MacMini 2>&1')
        print(f'  Result: {out2.strip()[:200]}')

# Step 4: Final status check
print('\n=== Step 4: Final status ===')
time.sleep(2)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list --connected 2>&1')
print(f'  Connected: {out.strip()[:500]}')

out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes status 2>&1')
print(f'  Status: {out.strip()[:500]}')

# Step 5: Test run command on Node
print('\n=== Step 5: Test run on Node ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini echo "Hello from Node" 2>&1')
print(f'  Test run: {out.strip()[:300]}')

client.close()
print('\nPhase 2 retry done.')
