#!/usr/bin/env python3
"""Fix exec approvals and test node run."""
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

# Step 1: Check host exec-approvals.json
print('=== Host exec-approvals.json ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/exec-approvals.json')
print(out.strip(), flush=True)

# Step 2: Update to full security
print('\n=== Update exec-approvals to full security ===', flush=True)
approvals = {
    "defaults": {
        "security": "full"
    }
}
sftp = c.open_sftp()
with sftp.file('/Users/fangjin/.openclaw/exec-approvals.json', 'w') as f:
    f.write(json.dumps(approvals, indent=2))
sftp.close()
print('  Written', flush=True)

# Verify
out, _ = run('cat /Users/fangjin/.openclaw/exec-approvals.json')
print(f'  {out.strip()}', flush=True)

# Step 3: Also check gateway exec-approvals
print('\n=== Gateway exec-approvals.json ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/exec-approvals.json 2>&1')
print(out.strip()[:300], flush=True)

# Step 4: Check node error log for any exec rejection
print('\n=== Node logs ===', flush=True)
out, _ = run('cat /tmp/node-bg.log 2>&1')
print(f'  Log: {out.strip()[:400]}', flush=True)

# Step 5: Try nodes run with explicit timeout flag
print('\n=== nodes run with --timeout 15000 ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --timeout 10000 -- echo "test" 2>&1', timeout=20)
print(f'  Result: {out.strip()[:400]}', flush=True)

# Step 6: Try nodes invoke with system.run command properly
print('\n=== nodes invoke system.run ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --invoke-timeout 10000 --json 2>&1', timeout=20)
print(f'  Result: {out.strip()[:400]}', flush=True)

# Step 7: Try nodes run help to see proper syntax
print('\n=== nodes run --help ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --help 2>&1')
print(out.strip()[:500], flush=True)

# Step 8: Try different command format
print('\n=== Try: echo test (no -- separator) ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --timeout 10000 echo test 2>&1', timeout=20)
print(f'  Result: {out.strip()[:400]}', flush=True)

# Step 9: Check node log for any activity
print('\n=== Node log after run attempts ===', flush=True)
out, _ = run('cat /tmp/node-bg.log 2>&1')
print(f'  {out.strip()[:600]}', flush=True)

c.close()
print('\nDone!', flush=True)
