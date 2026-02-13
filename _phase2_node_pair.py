#!/usr/bin/env python3
"""Phase 2: Set up OpenClaw Node on Mac Mini host and pair with Alin's Gateway."""
import paramiko, sys, io, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

def run(cmd, timeout=30):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH && {cmd}'
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return out, err

# Step 1: Configure exec-approvals on host
print('=== Step 1: Configure exec-approvals ===')
exec_approvals = json.dumps({"defaults": {"security": "full"}}, indent=2)
sftp = client.open_sftp()
# Ensure .openclaw dir exists
run('mkdir -p ~/.openclaw')
with sftp.file('/Users/fangjin/.openclaw/exec-approvals.json', 'w') as f:
    f.write(exec_approvals)
print('  Written exec-approvals.json with security: full')

# Step 2: Check if there's an existing node.json (previous pairing)
print('\n=== Step 2: Check existing Node state ===')
out, _ = run('cat ~/.openclaw/node.json 2>/dev/null || echo "NO_NODE_JSON"')
if 'NO_NODE_JSON' not in out:
    print(f'  Existing node.json found: {out.strip()[:200]}')
else:
    print('  No previous Node pairing found')

# Step 3: Kill any existing openclaw node process
print('\n=== Step 3: Kill existing Node processes ===')
out, _ = run('pgrep -f "openclaw node" && pkill -f "openclaw node" && echo "Killed" || echo "No existing process"')
print(f'  {out.strip()}')
time.sleep(1)

# Step 4: Start Node in background
print('\n=== Step 4: Start Node instance ===')
node_cmd = (
    'export OPENCLAW_GATEWAY_TOKEN="mysecrettoken123" && '
    'nohup openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" '
    '> /tmp/openclaw-node.log 2>&1 &'
)
run(node_cmd)
print('  Node started in background')
time.sleep(5)

# Check if it's running
out, _ = run('pgrep -f "openclaw node" && echo "RUNNING" || echo "NOT RUNNING"')
print(f'  Process: {out.strip()}')

# Read log
out, _ = run('tail -20 /tmp/openclaw-node.log')
print(f'  Log:\n{out.strip()}')

# Step 5: Check for pending pairing requests
print('\n=== Step 5: Check pairing status ===')
time.sleep(2)
out, _ = run('docker exec deploy-openclaw-gateway-1 openclaw nodes pending 2>&1')
print(f'  Pending: {out.strip()[:500]}')

out, _ = run('docker exec deploy-openclaw-gateway-1 openclaw nodes status 2>&1')
print(f'  Status: {out.strip()[:500]}')

# Step 6: Try to list connected nodes
print('\n=== Step 6: List nodes ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 openclaw nodes list 2>&1')
print(f'  List: {out.strip()[:500]}')

out, _ = run('docker exec deploy-openclaw-gateway-1 openclaw nodes list --connected 2>&1')
print(f'  Connected: {out.strip()[:500]}')

sftp.close()
client.close()
print('\nPhase 2 initial setup done. Check output above for pairing status.')
