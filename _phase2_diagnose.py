#!/usr/bin/env python3
"""Diagnose why nodes run still times out."""
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

# Check nodes status
print('=== nodes status ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes status 2>&1', timeout=10)
print(out.strip()[:500], flush=True)

# Check devices
print('\n=== devices list ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw devices list 2>&1')
print(out.strip()[:400], flush=True)

# Check node log
print('\n=== node log ===', flush=True)
out, _ = run('cat /tmp/node-bg.log 2>&1')
print(out.strip()[:500], flush=True)

# Check exec-approvals in gateway
print('\n=== Gateway exec-approvals ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/exec-approvals.json 2>&1')
print(out.strip()[:400], flush=True)

# Gateway all logs
print('\n=== ALL gateway logs ===', flush=True)
out, _ = run('docker logs deploy-openclaw-gateway-1 2>&1')
print(out.strip()[:2000], flush=True)

c.close()
print('\nDone!', flush=True)
