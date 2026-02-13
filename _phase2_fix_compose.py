#!/usr/bin/env python3
"""Remove NAS mount from docker-compose and restart."""
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

# Backup docker-compose
print('=== Backup docker-compose.yml ===', flush=True)
run(f'cp {DEPLOY}/docker-compose.yml {DEPLOY}/docker-compose.yml.bak')

# Read current compose
out, _ = run(f'cat {DEPLOY}/docker-compose.yml')
compose = out

# Remove the NAS line
print('=== Remove NAS mount ===', flush=True)
new_compose = compose.replace('      - /tmp/nas:/mnt/nas\n', '')
sftp = c.open_sftp()
with sftp.file(f'{DEPLOY}/docker-compose.yml', 'w') as f:
    f.write(new_compose)
sftp.close()

# Verify
out, _ = run(f'cat {DEPLOY}/docker-compose.yml')
print(out.strip()[:800], flush=True)

# Remove old container and start fresh
print('\n=== Remove old container ===', flush=True)
out, _ = run(f'cd {DEPLOY} && docker compose rm -f 2>&1')
print(f'  {out.strip()[:200]}', flush=True)

# Start
print('\n=== Docker compose up ===', flush=True)
out, _ = run(f'cd {DEPLOY} && docker compose up -d 2>&1', timeout=60)
print(f'  {out.strip()[:400]}', flush=True)

time.sleep(12)

# Check
out, _ = run('docker ps --filter "name=deploy-openclaw" --format "{{.ID}} {{.Names}} {{.Status}}"')
print(f'\n  Status: {out.strip()}', flush=True)

out, _ = run('docker exec deploy-openclaw-gateway-1 echo ready 2>&1')
print(f'  Gateway: {out.strip()}', flush=True)

if 'ready' in out:
    # Restart node
    print('\n=== Start node ===', flush=True)
    run('pkill -f "openclaw.*node" 2>/dev/null || true; pkill -f "openclaw-node" 2>/dev/null || true')
    time.sleep(3)
    run('echo "" > /tmp/node-bg.log')
    run('nohup env OPENCLAW_GATEWAY_PASSWORD="openclaw123" openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" > /tmp/node-bg.log 2>&1 &')
    time.sleep(8)

    # Check
    out, _ = run('netstat -an | grep "18789.*ESTABLISH"')
    print(f'  Connected: {"ESTABLISHED" in out}', flush=True)

    # TEST
    print('\n=== TEST: nodes run echo hello ===', flush=True)
    out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 15000 echo "hello from MacMini" 2>&1', timeout=25)
    print(f'  RESULT: {out.strip()[:500]}', flush=True)

    print('\n=== TEST: whoami ===', flush=True)
    out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 15000 whoami 2>&1', timeout=25)
    print(f'  RESULT: {out.strip()[:500]}', flush=True)

    # Gateway logs
    print('\n=== Gateway logs ===', flush=True)
    out, _ = run('docker logs deploy-openclaw-gateway-1 --since "30s" 2>&1')
    print(out.strip()[:800], flush=True)

c.close()
print('\nDone!', flush=True)
