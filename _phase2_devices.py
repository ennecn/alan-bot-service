#!/usr/bin/env python3
"""Check devices directory and try pairing approaches."""
import paramiko, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=10)

def run(cmd, timeout=30):
    _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

deploy = '/Users/fangjin/Desktop/p/docker-openclawd/deploy'

# Check devices directory
print('=== Devices directory ===', flush=True)
out, _ = run(f'find {deploy}/config/devices/ -type f 2>&1')
print(out.strip(), flush=True)

out, _ = run(f'find {deploy}/config/devices/ -name "*.json" -exec echo "--- {{}} ---" \\; -exec cat {{}} \\; 2>&1')
print(out.strip()[:2000], flush=True)

# Try listing gateway nodes with JSON
print('\n=== Nodes list --json ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list --json 2>&1')
print(out.strip()[:500], flush=True)

# Search OpenClaw source for pairing mechanism
print('\n=== Search for pairing code in container ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 find /app/dist -name "*.js" | head -20 2>&1')
print(out.strip(), flush=True)

# Find relevant source files
print('\n=== Grep for "pairing required" in container source ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 grep -r "pairing required" /app/dist/ --include="*.js" -l 2>&1')
print(out.strip()[:500], flush=True)

out, _ = run('docker exec deploy-openclaw-gateway-1 grep -r "pairing required" /app/dist/ --include="*.js" -B2 -A2 2>&1 | head -40')
print(out.strip()[:1500], flush=True)

# Check node host source in repo
print('\n=== Search for node-host pairing in repo ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 grep -r "pairingToken\\|pairing.token\\|pairToken" /app/dist/ --include="*.js" -l 2>&1')
print(out.strip()[:500], flush=True)

# Check how nodes approve works
print('\n=== Grep for pendingPair in container ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 grep -r "pendingPair\\|pending.*pair\\|pairRequest\\|pair.*request" /app/dist/ --include="*.js" -l 2>&1')
print(out.strip()[:500], flush=True)

# Try openclaw node install (might handle pairing differently)
print('\n=== Try: openclaw node install ===', flush=True)
out, _ = run(f'OPENCLAW_GATEWAY_PASSWORD="openclaw123" openclaw node install --host 127.0.0.1 --port 18789 --display-name "MacMini" --force 2>&1', timeout=15)
print(out.strip()[:800], flush=True)

# Check if install created anything
print('\n=== After install: node.json ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/node.json')
print(out.strip(), flush=True)

# Check launchd plist
print('\n=== Launchd plist ===', flush=True)
out, _ = run('ls -la ~/Library/LaunchAgents/com.openclaw* 2>&1')
print(out.strip(), flush=True)
out, _ = run('cat ~/Library/LaunchAgents/com.openclaw-node.plist 2>/dev/null || echo "NOT FOUND"')
print(out.strip()[:1000], flush=True)

c.close()
print('\nDone!', flush=True)
