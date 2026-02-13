#!/usr/bin/env python3
"""Phase 2: Coordinated Node start + approval. 
Runs Node in retry loop while simultaneously monitoring for pending requests."""
import paramiko, sys, io, time, threading, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

# Two separate SSH connections - one for Node, one for approval
client1 = paramiko.SSHClient()
client1.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client1.connect(HOST, username=USER, password=PASS)

client2 = paramiko.SSHClient()
client2.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client2.connect(HOST, username=USER, password=PASS)

PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

def run1(cmd, timeout=30):
    _, stdout, stderr = client1.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

def run2(cmd, timeout=30):
    _, stdout, stderr = client2.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# Kill existing
run1('pkill -f "openclaw node" 2>/dev/null || true')
time.sleep(1)

# First, let's try openclaw node install (creates a persistent service)
print('=== Try: openclaw node install ===')
out, err = run1('OPENCLAW_GATEWAY_PASSWORD="openclaw123" openclaw node install --host 127.0.0.1 --port 18789 --display-name "MacMini" 2>&1', timeout=30)
print(f'  Install output: {out.strip()[:500]}')
if err.strip():
    print(f'  Install err: {err.strip()[:300]}')

time.sleep(3)

# Check if service started
out, _ = run1('openclaw node status 2>&1')
print(f'  Node status: {out.strip()[:300]}')

# Check log
out, _ = run1('cat /tmp/openclaw-node.log 2>/dev/null; tail -10 ~/Library/Logs/openclaw-node*.log 2>/dev/null; echo "---"')
print(f'  Logs: {out.strip()[:500]}')

# Now start the Node manually in foreground with a retry wrapper script
print('\n=== Starting Node with retry loop ===')
retry_script = '''#!/bin/bash
export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH
export OPENCLAW_GATEWAY_PASSWORD="openclaw123"
for i in $(seq 1 10); do
    echo "Attempt $i at $(date)"
    openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" 2>&1 || true
    sleep 2
done
'''
sftp = client1.open_sftp()
with sftp.file('/tmp/node-retry.sh', 'w') as f:
    f.write(retry_script)
sftp.close()
run1('chmod +x /tmp/node-retry.sh')

# Start retry loop in background
run1('nohup /tmp/node-retry.sh > /tmp/openclaw-node-retry.log 2>&1 &')
print('  Retry loop started')

# Monitor for pending requests and approve them
print('\n=== Monitoring for pending nodes (15 seconds) ===')
approved = False
for i in range(15):
    time.sleep(1)
    out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes pending 2>&1')
    if 'No pending' not in out and out.strip():
        print(f'  [{i}s] Pending: {out.strip()[:300]}')
        # Try to approve
        out2, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes pending --json 2>&1')
        print(f'  [{i}s] Pending JSON: {out2.strip()[:300]}')
        try:
            pending = json.loads(out2.strip())
            if isinstance(pending, list) and len(pending) > 0:
                for p in pending:
                    rid = p.get('id') or p.get('requestId') or p.get('nodeId', '')
                    name = p.get('displayName') or p.get('name', '')
                    print(f'  Approving: id={rid} name={name}')
                    out3, _ = run2(f'docker exec deploy-openclaw-gateway-1 npx openclaw nodes approve "{rid}" 2>&1')
                    print(f'  Approve result: {out3.strip()[:200]}')
                    approved = True
        except json.JSONDecodeError:
            # Try approve by name
            out3, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes approve MacMini 2>&1')
            print(f'  Approve by name: {out3.strip()[:200]}')
    else:
        sys.stdout.write(f'  [{i}s] ...\r')
        sys.stdout.flush()

    if approved:
        break

print()

# Check final status
time.sleep(3)
print('\n=== Final status ===')
out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes status 2>&1')
print(f'  Status: {out.strip()[:500]}')

out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list 2>&1')
print(f'  List: {out.strip()[:500]}')

out, _ = run2('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list --connected 2>&1')
print(f'  Connected: {out.strip()[:500]}')

# Check retry log
out, _ = run1('cat /tmp/openclaw-node-retry.log')
print(f'\n  Retry log:\n{out.strip()[:800]}')

# Kill retry loop
run1('pkill -f "node-retry.sh" 2>/dev/null || true')

client1.close()
client2.close()
print('\nDone.')
