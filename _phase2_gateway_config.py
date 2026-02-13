#!/usr/bin/env python3
"""Inspect gateway config and node pairing state."""
import paramiko, sys, io
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

# Check gateway config directory
print('=== Gateway config (mounted volume) ===', flush=True)
deploy_dir = '/Users/fangjin/Desktop/p/docker-openclawd/deploy'
out, _ = run(f'ls -la {deploy_dir}/config/ 2>&1')
print(out.strip(), flush=True)

print('\n=== config/config.json ===', flush=True)
out, _ = run(f'cat {deploy_dir}/config/config.json 2>/dev/null || echo "NOT FOUND"')
print(out.strip()[:1000], flush=True)

print('\n=== config/openclaw.json ===', flush=True)
out, _ = run(f'cat {deploy_dir}/config/openclaw.json 2>/dev/null || echo "NOT FOUND"')
print(out.strip()[:1000], flush=True)

print('\n=== All JSON files in config/ ===', flush=True)
out, _ = run(f'find {deploy_dir}/config/ -name "*.json" -exec echo "--- {{}} ---" \\; -exec cat {{}} \\; 2>&1')
print(out.strip()[:3000], flush=True)

# Check gateway container internal state
print('\n=== Container: /home/node/.openclaw/ ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/ 2>&1')
print(out.strip(), flush=True)

print('\n=== Container: node pairing data ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 find /home/node/.openclaw/ -name "*.json" -exec echo "--- {} ---" \\; -exec cat {} \\; 2>&1')
print(out.strip()[:3000], flush=True)

# Check OpenClaw node pairing source code for keywords
print('\n=== Look at node-host pairing source ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 find /app -name "*.js" -path "*/node-host*" 2>&1 | head -10')
print(f'Node host files: {out.strip()}', flush=True)

out, _ = run('docker exec deploy-openclaw-gateway-1 find /app -name "*.js" | xargs grep -l "pairing" 2>/dev/null | head -10')
print(f'Files with "pairing": {out.strip()}', flush=True)

# Try: node run with verbose output
print('\n=== Try node run (5s, verbose) ===', flush=True)
out, err = run('OPENCLAW_GATEWAY_PASSWORD="openclaw123" gtimeout 5 openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" 2>&1 || true', timeout=10)
print(f'Output: {out.strip()[:500]}', flush=True)

# Check the node.json - maybe it needs a pairingToken
print('\n=== Current node.json ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/node.json')
print(out.strip(), flush=True)

# Check .openclaw logs
print('\n=== Node logs ===', flush=True)
out, _ = run('ls -la /Users/fangjin/.openclaw/logs/ 2>&1')
print(out.strip(), flush=True)
out, _ = run('find /Users/fangjin/.openclaw/logs/ -name "*.log" -exec tail -20 {} \\; 2>&1')
print(out.strip()[:1500], flush=True)

c.close()
print('\nDone!', flush=True)
