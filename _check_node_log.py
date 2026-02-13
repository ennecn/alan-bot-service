#!/usr/bin/env python3
"""Check OpenClaw node log and diagnose startup failure."""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

def run(cmd, timeout=30):
    _, stdout, stderr = client.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# Check the node log
print('=== Node log ===')
out, _ = run('cat /tmp/openclaw-node.log 2>/dev/null || echo "NO LOG"')
print(out.strip())

print('\n=== Check if openclaw node run works directly ===')
out, err = run('OPENCLAW_GATEWAY_TOKEN="mysecrettoken123" openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" --help 2>&1 || true', timeout=15)
print(f'Help: {out.strip()[:500]}')
if err.strip():
    print(f'Err: {err.strip()[:500]}')

print('\n=== openclaw --help ===')
out, _ = run('openclaw --help 2>&1')
print(out.strip()[:1000])

print('\n=== openclaw node --help ===')
out, _ = run('openclaw node --help 2>&1')
print(out.strip()[:1000])

print('\n=== Check docker gateway is running ===')
out, _ = run('docker ps --filter "name=deploy-openclaw" --format "{{.ID}} {{.Names}} {{.Status}}" 2>&1')
print(f'Containers: {out.strip()}')

print('\n=== Check port 18789 ===')
out, _ = run('lsof -i :18789 -P -n 2>&1 | head -5')
print(f'Port 18789: {out.strip()}')

print('\n=== Try running node directly (10s timeout) ===')
try:
    out, err = run('OPENCLAW_GATEWAY_TOKEN="mysecrettoken123" timeout 10 openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" 2>&1', timeout=15)
    print(f'Direct run output: {out.strip()[:500]}')
    if err.strip():
        print(f'Direct run err: {err.strip()[:500]}')
except Exception as e:
    print(f'Exception: {e}')

client.close()
