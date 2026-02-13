#!/usr/bin/env python3
"""Try upgrading gateway to match node version, or find alternative approach."""
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

def run(cmd, timeout=60):
    try:
        _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
        return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')
    except Exception as e:
        return f'TIMEOUT: {e}', ''

# Step 1: Check if we can update the gateway container with npm
print('=== Step 1: Current gateway docker image ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw --version 2>&1')
print(f'  Gateway version: {out.strip()}', flush=True)

out, _ = run(f'cat {DEPLOY}/docker-compose.yml')
print(f'  Docker compose:\n{out.strip()[:500]}', flush=True)

# The image is "openclaw:local" - a locally built image
# Let's try to update OpenClaw inside the container
print('\n=== Step 2: Update openclaw in container ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npm ls openclaw 2>&1 | head -5')
print(f'  npm ls: {out.strip()[:300]}', flush=True)

# Try npm update inside container  
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw self-update --help 2>&1')
print(f'  self-update: {out.strip()[:300]}', flush=True)

# Step 3: Alternative - check if the node-host needs an openclaw.json config
# with exec security settings
print('\n=== Step 3: Create node-host config ===', flush=True)
# Check if we can use a profile-specific config
out, _ = run('openclaw config --help 2>&1')
print(out.strip()[:400], flush=True)

# Try: set exec security via config
print('\n=== config set ===', flush=True)
out, _ = run('openclaw config set tools.exec.security full 2>&1')
print(f'  Set result: {out.strip()[:300]}', flush=True)

# Check what config file was created
out, _ = run('cat /Users/fangjin/.openclaw/openclaw.json 2>/dev/null || echo "NOT FOUND"')
print(f'  Config: {out.strip()[:400]}', flush=True)

out, _ = run('cat /Users/fangjin/.openclaw/config.json 2>/dev/null || echo "NOT FOUND"')
print(f'  Config2: {out.strip()[:400]}', flush=True)

# Step 4: Maybe we need to also set the exec approval socket on the node
# The node-host might need to run its own approval server
print('\n=== Step 4: Check openclaw approvals get ===', flush=True)
out, _ = run('openclaw approvals get --json 2>&1')
print(f'  {out.strip()[:400]}', flush=True)

# Step 5: Try running the approval server
print('\n=== Step 5: Check if there is an approval server command ===', flush=True)
out, _ = run('openclaw approvals --help 2>&1')
print(out.strip()[:400], flush=True)

# Step 6: Downgrade node to match gateway
print('\n=== Step 6: Try downgrading node CLI ===', flush=True)
out, _ = run('npm list -g openclaw 2>&1')
print(f'  Current: {out.strip()[:200]}', flush=True)

# Install specific version
print('  Installing openclaw@2026.2.4...', flush=True)
out, _ = run('npm install -g openclaw@2026.2.4 2>&1', timeout=120)
lines = out.strip().split('\n')
for line in lines[-5:]:
    print(f'  {line}', flush=True)

out, _ = run('openclaw --version 2>&1')
print(f'  New version: {out.strip()}', flush=True)

c.close()
print('\nDone!', flush=True)
