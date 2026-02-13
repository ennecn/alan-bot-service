#!/usr/bin/env python3
"""Test invoke with --params flag."""
import paramiko, sys, io, time
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

# Test system.which with --params
print('=== system.which with --params ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.which --params '{"bins":["echo","bash","ls"]}' --invoke-timeout 10000 --json 2>&1''', timeout=15)
print(f'  Result: {out.strip()[:500]}', flush=True)

# Test system.run with --params  
print('\n=== system.run with --params ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --params '{"command":["echo","hello from MacMini"],"cwd":"/Users/fangjin"}' --invoke-timeout 15000 --json 2>&1''', timeout=25)
print(f'  Result: {out.strip()[:500]}', flush=True)

# Test system.run: whoami
print('\n=== system.run: whoami ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --params '{"command":["whoami"]}' --invoke-timeout 15000 --json 2>&1''', timeout=25)
print(f'  Result: {out.strip()[:500]}', flush=True)

# Test system.run: ls
print('\n=== system.run: ls ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --params '{"command":["ls","-la","/Users/fangjin/claude-workspace"]}' --invoke-timeout 15000 --json 2>&1''', timeout=25)
print(f'  Result: {out.strip()[:800]}', flush=True)

# Gateway logs
print('\n=== Gateway logs ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "30s" 2>&1')
print(out.strip()[:600], flush=True)

c.close()
print('\nDone!', flush=True)
