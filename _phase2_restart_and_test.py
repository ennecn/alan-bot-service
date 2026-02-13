#!/usr/bin/env python3
"""Restart node and test command execution."""
import paramiko, sys, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'
GW_PASSWORD = 'openclaw123'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=30):
    try:
        _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
        return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')
    except Exception as e:
        return f'TIMEOUT: {e}', ''

# Step 1: Verify exec-approvals.json
print('=== Step 1: Verify exec-approvals ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/exec-approvals.json')
current = out.strip()
print(f'  Current: {current}', flush=True)

# If it doesn't have "security": "full", update it
if '"security": "full"' not in current:
    print('  Updating...', flush=True)
    sftp = c.open_sftp()
    with sftp.file('/Users/fangjin/.openclaw/exec-approvals.json', 'w') as f:
        f.write(json.dumps({"defaults": {"security": "full"}}, indent=2))
    sftp.close()

# Step 2: Kill and restart node
print('\n=== Step 2: Restart node ===', flush=True)
run('pkill -f "openclaw.*node" 2>/dev/null || true; pkill -f "openclaw-node" 2>/dev/null || true')
time.sleep(3)

run('echo "" > /tmp/node-bg.log')
run(f'nohup env OPENCLAW_GATEWAY_PASSWORD="{GW_PASSWORD}" openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" > /tmp/node-bg.log 2>&1 &')
time.sleep(8)

# Check log
out, _ = run('cat /tmp/node-bg.log 2>&1')
print(f'  Log: {out.strip()[:400]}', flush=True)

# Check connected
out, _ = run('netstat -an | grep "18789.*ESTABLISH"')
print(f'  Connection: {out.strip()[:200]}', flush=True)

# Step 3: Verify node is in the registry
print('\n=== Step 3: Node status ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes status 2>&1', timeout=15)
print(out.strip()[:400], flush=True)

# Step 4: Test command execution
print('\n=== Step 4: Test nodes run ===', flush=True)

# Try with --ask off to bypass exec approval prompt
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 10000 echo "hello" 2>&1', timeout=20)
print(f'  --ask off: {out.strip()[:400]}', flush=True)

# Try with command-timeout
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --command-timeout 10000 echo "hello" 2>&1', timeout=20)
print(f'  --command-timeout: {out.strip()[:400]}', flush=True)

# Try whoami
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off whoami 2>&1', timeout=15)
print(f'  whoami: {out.strip()[:400]}', flush=True)

# Check node log for any exec activity
print('\n=== Node log after exec attempts ===', flush=True)
out, _ = run('cat /tmp/node-bg.log 2>&1')
print(out.strip()[:600], flush=True)

# Try with nodes invoke and proper params
print('\n=== nodes invoke ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.which --json --invoke-timeout 10000 <<< '{"bin": "echo"}' 2>&1''', timeout=15)
print(f'  system.which: {out.strip()[:400]}', flush=True)

c.close()
print('\nDone!', flush=True)
