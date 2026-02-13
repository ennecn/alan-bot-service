#!/usr/bin/env python3
"""Get full nodes invoke help and find param passing method."""
import paramiko, sys, io
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

# Full help
print('=== nodes invoke --help ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --help 2>&1')
print(out.strip(), flush=True)

# Also check host version help
print('\n=== Host: nodes invoke --help ===', flush=True)
out, _ = run('openclaw nodes invoke --help 2>&1')
print(out.strip(), flush=True)

# Check: does the host CLI have different invoke syntax?
print('\n=== Host nodes invoke test ===', flush=True)
# Use host CLI directly (host has v2026.2.9, gateway has v2026.2.4)
# But host CLI needs gateway connection too
out, _ = run('OPENCLAW_GATEWAY_PASSWORD="openclaw123" openclaw nodes invoke --help 2>&1')
print(out.strip()[:500], flush=True)

c.close()
print('\nDone!', flush=True)
