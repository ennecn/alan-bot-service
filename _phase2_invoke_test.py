#!/usr/bin/env python3
"""Test node invoke with proper params, and check gateway internal log."""
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

# Test 1: system.which with proper JSON 
print('=== Test 1: system.which ===', flush=True)
# Write params to a temp file and pipe it
run('echo \'{"bins":["echo","bash","ls"]}\' > /tmp/invoke-params.json')
out, _ = run('cat /tmp/invoke-params.json | docker exec -i deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.which --invoke-timeout 10000 --json 2>&1', timeout=15)
print(f'  Result: {out.strip()[:500]}', flush=True)

# Test 2: system.run with proper JSON
print('\n=== Test 2: system.run ===', flush=True)
run('echo \'{"command":["echo","hello"],"cwd":"/Users/fangjin"}\' > /tmp/invoke-params.json')
out, _ = run('cat /tmp/invoke-params.json | docker exec -i deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --invoke-timeout 15000 --json 2>&1', timeout=25)
print(f'  Result: {out.strip()[:500]}', flush=True)

# Test 3: Try nodes run with --json to see structured error
print('\n=== Test 3: nodes run --json ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 10000 --json -- echo hello 2>&1', timeout=15)
print(f'  Result: {out.strip()[:500]}', flush=True)

# Test 4: Check the gateway internal log file
print('\n=== Test 4: Gateway log file ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 tail -20 /tmp/openclaw/openclaw-2026-02-10.log 2>&1')
print(out.strip()[:800], flush=True)

# Test 5: Check node describe for capabilities
print('\n=== Test 5: nodes describe ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes describe --node MacMini --json 2>&1', timeout=10)
print(out.strip()[:800], flush=True)

# Test 6: Check gateway logs after invokes
print('\n=== Gateway logs ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 --since "1m" 2>&1')
print(out.strip()[:600], flush=True)

c.close()
print('\nDone!', flush=True)
