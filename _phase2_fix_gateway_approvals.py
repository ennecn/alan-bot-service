#!/usr/bin/env python3
"""Fix GATEWAY exec-approvals to have security=full, then test."""
import paramiko, sys, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'
DEPLOY = '/Users/fangjin/Desktop/p/docker-openclawd/deploy'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=30):
    try:
        _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
        return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')
    except Exception as e:
        return f'TIMEOUT: {e}', ''

# Step 1: Read gateway's exec-approvals.json
print('=== Gateway exec-approvals ===', flush=True)
out, _ = run(f'cat {DEPLOY}/config/exec-approvals.json')
gw_approvals = json.loads(out.strip())
print(f'  Current: {json.dumps(gw_approvals, indent=2)[:300]}', flush=True)

# Step 2: Update gateway's exec-approvals.json with security=full
print('\n=== Update gateway exec-approvals ===', flush=True)
gw_approvals['defaults'] = {'security': 'full'}
sftp = c.open_sftp()
with sftp.file(f'{DEPLOY}/config/exec-approvals.json', 'w') as f:
    f.write(json.dumps(gw_approvals, indent=2))
sftp.close()
out, _ = run(f'cat {DEPLOY}/config/exec-approvals.json')
print(f'  Updated: {out.strip()[:400]}', flush=True)

# Step 3: Also update gateway's openclaw.json tools.exec.security
print('\n=== Check gateway openclaw.json exec config ===', flush=True)
out, _ = run(f'cat {DEPLOY}/config/openclaw.json')
gw_config = json.loads(out.strip())
tools = gw_config.get('tools', {})
print(f'  tools.exec: {json.dumps(tools.get("exec", {}), indent=2)}', flush=True)
# Already has "security": "full" - good

# Step 4: Restart gateway to pick up changes
print('\n=== Restart gateway ===', flush=True)
out, _ = run(f'cd {DEPLOY} && docker compose restart openclaw-gateway 2>&1', timeout=60)
print(f'  {out.strip()[:200]}', flush=True)

# Wait for gateway
time.sleep(10)
out, _ = run('docker exec deploy-openclaw-gateway-1 echo ready 2>&1')
print(f'  Gateway: {out.strip()}', flush=True)

# Step 5: Restart node
print('\n=== Restart node ===', flush=True)
run('pkill -f "openclaw.*node" 2>/dev/null || true; pkill -f "openclaw-node" 2>/dev/null || true')
time.sleep(3)
run('echo "" > /tmp/node-bg.log')
run(f'nohup env OPENCLAW_GATEWAY_PASSWORD="openclaw123" openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" > /tmp/node-bg.log 2>&1 &')
time.sleep(8)

# Check connection
out, _ = run('netstat -an | grep "18789.*ESTABLISH"')
print(f'  Connection: {"ESTABLISHED" in out}', flush=True)

# Step 6: Test nodes run
print('\n=== Test nodes run echo hello ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 15000 echo "hello from MacMini" 2>&1', timeout=25)
print(f'  Result: {out.strip()[:400]}', flush=True)

# Test whoami
print('\n=== Test whoami ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 15000 whoami 2>&1', timeout=25)
print(f'  Result: {out.strip()[:400]}', flush=True)

# Test pwd
print('\n=== Test pwd ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 15000 pwd 2>&1', timeout=25)
print(f'  Result: {out.strip()[:400]}', flush=True)

# Check node log
print('\n=== Node log ===', flush=True)
out, _ = run('cat /tmp/node-bg.log')
print(out.strip()[:600], flush=True)

# Gateway logs
print('\n=== Gateway logs ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "30s" 2>&1')
print(out.strip()[:800], flush=True)

c.close()
print('\nDone!', flush=True)
