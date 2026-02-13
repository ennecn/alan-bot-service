#!/usr/bin/env python3
"""Test system.run invoke with properly passed params."""
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

# Approach: write params to a file inside container, then pipe
# system.which test
print('=== Test system.which ===', flush=True)
run('docker exec deploy-openclaw-gateway-1 bash -c \'echo \'\\\'\'{"bins":["echo","bash"]}\'\\\'\' > /tmp/which-params.json\'')
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /tmp/which-params.json 2>&1')
print(f'  File: {out.strip()}', flush=True)

out, _ = run('docker exec deploy-openclaw-gateway-1 bash -c \'cat /tmp/which-params.json | npx openclaw nodes invoke --node MacMini --command system.which --invoke-timeout 10000 --json\' 2>&1', timeout=15)
print(f'  Result: {out.strip()[:500]}', flush=True)

# Alternative: use heredoc inside docker exec
print('\n=== Alt: heredoc ===', flush=True)
out, _ = run("""docker exec deploy-openclaw-gateway-1 bash -c 'printf "%s" '"'"'{"bins":["echo","bash","ls"]}'"'"' | npx openclaw nodes invoke --node MacMini --command system.which --invoke-timeout 10000 --json' 2>&1""", timeout=15)
print(f'  Result: {out.strip()[:500]}', flush=True)

# system.run test
print('\n=== Test system.run ===', flush=True)
# Write file first
run('''docker exec deploy-openclaw-gateway-1 bash -c 'echo '"'"'{"command":["echo","hello from MacMini"],"cwd":"/Users/fangjin"}'"'"' > /tmp/run-params.json' ''')
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /tmp/run-params.json 2>&1')
print(f'  File: {out.strip()}', flush=True)

out, _ = run('docker exec deploy-openclaw-gateway-1 bash -c \'cat /tmp/run-params.json | npx openclaw nodes invoke --node MacMini --command system.run --invoke-timeout 15000 --json\' 2>&1', timeout=25)
print(f'  Result: {out.strip()[:500]}', flush=True)

# Gateway logs
print('\n=== Gateway logs ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "30s" 2>&1')
print(out.strip()[:600], flush=True)

c.close()
print('\nDone!', flush=True)
