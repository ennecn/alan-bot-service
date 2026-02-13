#!/usr/bin/env python3
"""Fix and restart gateway container."""
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'
DEPLOY = '/Users/fangjin/Desktop/p/docker-openclawd/deploy'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=60):
    try:
        _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
        return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')
    except Exception as e:
        return f'TIMEOUT: {e}', ''

# Check docker-compose for volume mounts
print('=== Docker compose volumes ===', flush=True)
out, _ = run(f'cat {DEPLOY}/docker-compose.yml')
print(out.strip()[:1500], flush=True)

# Check if /tmp/nas exists
print('\n=== Check /tmp/nas ===', flush=True)
out, _ = run('ls -la /tmp/nas 2>&1')
print(f'  {out.strip()[:200]}', flush=True)

# Create /tmp/nas if missing
run('mkdir -p /tmp/nas')

# Try docker compose up
print('\n=== docker compose up -d ===', flush=True)
out, _ = run(f'cd {DEPLOY} && docker compose up -d 2>&1', timeout=60)
print(f'  {out.strip()[:500]}', flush=True)

# Wait
time.sleep(10)

# Check container
print('\n=== Container status ===', flush=True)
out, _ = run('docker ps --filter "name=deploy-openclaw" --format "{{.ID}} {{.Names}} {{.Status}}"')
print(f'  {out.strip()}', flush=True)

# Check if gateway is running
out, _ = run('docker exec deploy-openclaw-gateway-1 echo ready 2>&1')
print(f'  Gateway: {out.strip()}', flush=True)

# Now restart node
print('\n=== Restart node ===', flush=True)
run('pkill -f "openclaw.*node" 2>/dev/null || true; pkill -f "openclaw-node" 2>/dev/null || true')
time.sleep(3)
run('echo "" > /tmp/node-bg.log')
run('nohup env OPENCLAW_GATEWAY_PASSWORD="openclaw123" openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" > /tmp/node-bg.log 2>&1 &')
time.sleep(8)

# Check connection
out, _ = run('netstat -an | grep "18789.*ESTABLISH"')
connected = 'ESTABLISHED' in out
print(f'  Connected: {connected}', flush=True)

# Check node log
out, _ = run('cat /tmp/node-bg.log')
print(f'  Log: {out.strip()[:300]}', flush=True)

# TEST: nodes run
print('\n=== TEST: nodes run echo hello ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 15000 echo "hello from MacMini" 2>&1', timeout=25)
print(f'  Result: {out.strip()[:500]}', flush=True)

# TEST: whoami
print('\n=== TEST: whoami ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 15000 whoami 2>&1', timeout=25)
print(f'  Result: {out.strip()[:500]}', flush=True)

# Gateway logs
print('\n=== Gateway logs ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "30s" 2>&1')
print(out.strip()[:600], flush=True)

c.close()
print('\nDone!', flush=True)
