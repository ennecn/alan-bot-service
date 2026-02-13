#!/usr/bin/env python3
"""Restart node with updated config and test."""
import paramiko, sys, io, time
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

# Verify configs are in place
print('=== Configs ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/exec-approvals.json')
print(f'  exec-approvals: {out.strip()[:300]}', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/openclaw.json | python3 -m json.tool 2>&1 | head -20')
print(f'  openclaw.json: {out.strip()[:300]}', flush=True)

# Kill and restart
print('\n=== Restart node ===', flush=True)
run('pkill -f "openclaw.*node" 2>/dev/null || true; pkill -f "openclaw-node" 2>/dev/null || true')
time.sleep(3)
run('echo "" > /tmp/node-bg.log')
run(f'nohup env OPENCLAW_GATEWAY_PASSWORD="{GW_PASSWORD}" openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" > /tmp/node-bg.log 2>&1 &')
time.sleep(8)

# Check connection
out, _ = run('netstat -an | grep "18789.*ESTABLISH"')
connected = 'ESTABLISHED' in out
print(f'  Connected: {connected}', flush=True)

# Check log
out, _ = run('cat /tmp/node-bg.log 2>&1')
print(f'  Log: {out.strip()[:400]}', flush=True)

# Check socket
out, _ = run('ls -la /Users/fangjin/.openclaw/exec-approvals.sock 2>&1')
print(f'  Socket: {out.strip()[:200]}', flush=True)

# Test nodes run
print('\n=== Test nodes run ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 15000 echo "SUCCESS" 2>&1', timeout=25)
print(f'  Result: {out.strip()[:400]}', flush=True)

# Also try: run a simpler command
print('\n=== Test: whoami ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 15000 whoami 2>&1', timeout=25)
print(f'  Result: {out.strip()[:400]}', flush=True)

# Test: pwd
print('\n=== Test: pwd ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 15000 pwd 2>&1', timeout=25)
print(f'  Result: {out.strip()[:400]}', flush=True)

# Check node log for any activity
print('\n=== Node log after tests ===', flush=True)
out, _ = run('cat /tmp/node-bg.log 2>&1')
print(out.strip()[:800], flush=True)

# Check gateway logs
print('\n=== Gateway logs ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "1m" 2>&1')
print(out.strip()[:600], flush=True)

c.close()
print('\nDone!', flush=True)
