#!/usr/bin/env python3
"""Fix exec approvals properly and test system.run."""
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

# Step 1: Check current exec-approvals (node regenerated it)
print('=== Step 1: Current exec-approvals ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/exec-approvals.json')
print(out.strip()[:400], flush=True)

# Step 2: Use openclaw approvals CLI to set full security
print('\n=== Step 2: Set exec approvals via CLI ===', flush=True)
out, _ = run('openclaw approvals --help 2>&1')
print(out.strip()[:500], flush=True)

# Try to set defaults
print('\n=== approvals set --help ===', flush=True)
out, _ = run('openclaw approvals set --help 2>&1')
print(out.strip()[:500], flush=True)

# Try set-defaults or similar
print('\n=== Try: approvals defaults ===', flush=True)
out, _ = run('openclaw approvals defaults --help 2>&1')
print(out.strip()[:500], flush=True)

# Try setting security to full
print('\n=== Try: approvals defaults --security full ===', flush=True)
out, _ = run('openclaw approvals defaults --security full 2>&1')
print(out.strip()[:400], flush=True)

# Also try via JSON edit - update defaults.security in the existing file
print('\n=== Step 3: Patch exec-approvals.json ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/exec-approvals.json')
try:
    data = json.loads(out.strip())
    data['defaults'] = {"security": "full"}
    sftp = c.open_sftp()
    with sftp.file('/Users/fangjin/.openclaw/exec-approvals.json', 'w') as f:
        f.write(json.dumps(data, indent=2))
    sftp.close()
    print('  Patched (kept version/socket)', flush=True)
except Exception as e:
    print(f'  Error: {e}', flush=True)

# Verify
out, _ = run('cat /Users/fangjin/.openclaw/exec-approvals.json')
print(f'  Updated: {out.strip()[:500]}', flush=True)

# Step 4: Test system.which with correct params
print('\n=== Step 4: Test system.which ===', flush=True)
# Need to pass JSON params via stdin
out, _ = run('''echo '{"bins": ["echo", "bash", "whoami"]}' | docker exec -i deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.which --invoke-timeout 10000 --json 2>&1''', timeout=15)
print(f'  system.which: {out.strip()[:500]}', flush=True)

# Step 5: Test system.run
print('\n=== Step 5: Test system.run ===', flush=True)
out, _ = run('''echo '{"command": ["echo", "hello from MacMini"]}' | docker exec -i deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --invoke-timeout 10000 --json 2>&1''', timeout=15)
print(f'  system.run: {out.strip()[:500]}', flush=True)

# Also try with just a string command
out, _ = run('''echo '{"command": "echo hello"}' | docker exec -i deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --invoke-timeout 10000 --json 2>&1''', timeout=15)
print(f'  system.run (str): {out.strip()[:500]}', flush=True)

# Step 6: Try nodes run again (now with patched exec-approvals)
print('\n=== Step 6: nodes run again ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --ask off --timeout 10000 echo hello 2>&1', timeout=15)
print(f'  nodes run: {out.strip()[:400]}', flush=True)

# Check node log
print('\n=== Node log ===', flush=True)
out, _ = run('cat /tmp/node-bg.log 2>&1')
print(out.strip()[:600], flush=True)

c.close()
print('\nDone!', flush=True)
