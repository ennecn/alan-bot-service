#!/usr/bin/env python3
"""Check exec approval socket and try to fix the communication issue."""
import paramiko, sys, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=30):
    try:
        _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
        return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')
    except Exception as e:
        return f'TIMEOUT: {e}', ''

# Check exec-approvals socket
print('=== Check socket ===', flush=True)
out, _ = run('ls -la /Users/fangjin/.openclaw/exec-approvals.sock 2>&1')
print(f'  Socket: {out.strip()}', flush=True)

out, _ = run('file /Users/fangjin/.openclaw/exec-approvals.sock 2>&1')
print(f'  File type: {out.strip()}', flush=True)

# Check current exec-approvals.json
out, _ = run('cat /Users/fangjin/.openclaw/exec-approvals.json')
print(f'  JSON: {out.strip()[:300]}', flush=True)

# The socket was likely created by the node process at startup
# Let me restart the node to recreate the socket, then immediately set security=full
print('\n=== Restart node ===', flush=True)
run('pkill -f "openclaw.*node" 2>/dev/null || true; pkill -f "openclaw-node" 2>/dev/null || true')
time.sleep(3)
run('echo "" > /tmp/node-bg.log')
run('nohup env OPENCLAW_GATEWAY_PASSWORD="openclaw123" openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" > /tmp/node-bg.log 2>&1 &')
time.sleep(5)

# Check socket was recreated
out, _ = run('ls -la /Users/fangjin/.openclaw/exec-approvals.sock 2>&1')
print(f'  Socket after restart: {out.strip()}', flush=True)

# Check exec-approvals.json (node may have recreated it)
out, _ = run('cat /Users/fangjin/.openclaw/exec-approvals.json')
ea_data = json.loads(out.strip())
print(f'  JSON: {json.dumps(ea_data, indent=2)[:300]}', flush=True)

# NOW set security to full while keeping the socket info intact
print('\n=== Set security=full keeping socket ===', flush=True)
ea_data['defaults'] = {'security': 'full'}
sftp = c.open_sftp()
with sftp.file('/Users/fangjin/.openclaw/exec-approvals.json', 'w') as f:
    f.write(json.dumps(ea_data, indent=2))
sftp.close()
out, _ = run('cat /Users/fangjin/.openclaw/exec-approvals.json')
print(f'  Updated: {out.strip()[:400]}', flush=True)

# Wait for node to pick up changes
time.sleep(3)

# Test: nodes run
print('\n=== Test nodes run ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 10000 echo "hello" 2>&1', timeout=15)
print(f'  Result: {out.strip()[:400]}', flush=True)

# Check node log
print('\n=== Node log ===', flush=True)
out, _ = run('cat /tmp/node-bg.log 2>&1')
print(out.strip()[:600], flush=True)

# Maybe the node needs the approval server to be running separately?
# Check if there's a socket listener
print('\n=== Check socket listener ===', flush=True)
out, _ = run('ss -l -x 2>/dev/null | grep -i openclaw || netstat -an | grep -i openclaw 2>&1 | head -5 || echo "NO SOCKET LISTENER"')
print(f'  {out.strip()[:300]}', flush=True)

# Check version
print('\n=== Versions ===', flush=True)
out, _ = run('openclaw --version 2>&1')
print(f'  Host: {out.strip()}', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw --version 2>&1')
print(f'  Gateway: {out.strip()}', flush=True)

# Try upgrading gateway image
print('\n=== Check gateway image version ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /app/package.json 2>&1 | head -5')
print(f'  {out.strip()[:200]}', flush=True)

c.close()
print('\nDone!', flush=True)
