#!/usr/bin/env python3
"""Debug: run node in foreground with verbose output after device approval."""
import paramiko, sys, io, time
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

# Stop any running node service
run('openclaw node stop 2>&1')
run('pkill -f "openclaw node" 2>/dev/null || true')
time.sleep(2)

# Check device-auth.json exists with token
print('=== device-auth.json ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/identity/device-auth.json')
print(out.strip(), flush=True)

# Run node foreground for 8 seconds
print('\n=== Run node foreground (8s) ===', flush=True)
# Use perl alarm trick since no coreutils timeout on macOS
cmd = '''perl -e 'alarm 8; exec @ARGV' -- bash -c 'export OPENCLAW_GATEWAY_PASSWORD="openclaw123" && openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" 2>&1'
'''
out, err = run(cmd, timeout=15)
print(f'STDOUT: {out.strip()[:1000]}', flush=True)
if err.strip():
    print(f'STDERR: {err.strip()[:500]}', flush=True)

# Search for how node-host handles pairing in the installed package
print('\n=== Search pairingToken in openclaw dist ===', flush=True)
out, _ = run('grep -r "pairingToken" /opt/homebrew/lib/node_modules/openclaw/dist/ --include="*.js" -l 2>&1 | head -5')
print(f'Files: {out.strip()}', flush=True)

# Look at the node-cli source for pairing flow
print('\n=== Node-host pairing flow ===', flush=True)
out, _ = run('grep -r "pairingToken\\|NOT_PAIRED\\|pairing.request\\|pairing required" /opt/homebrew/lib/node_modules/openclaw/dist/ --include="*.js" -B1 -A3 2>&1 | head -50')
print(out.strip()[:2000], flush=True)

# Look at how node stores the token after successful pairing
print('\n=== How node stores pairingToken ===', flush=True)
out, _ = run('grep -r "node\\.json\\|nodeJson\\|saveNode\\|writePairingToken" /opt/homebrew/lib/node_modules/openclaw/dist/ --include="*.js" -l 2>&1 | head -5')
print(f'Files: {out.strip()}', flush=True)

# Check if maybe the gateway needs a node-level pairing approval
print('\n=== Gateway source: node pairing approval ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 grep -r "nodes.*approve\\|nodesPaired\\|nodesApprove\\|node.*pair" /app/dist/ --include="*.js" -l 2>&1 | head -5')
print(f'Files: {out.strip()}', flush=True)

# Maybe the issue is version mismatch - gateway is 2026.2.4, node is 2026.2.9
print('\n=== Version check ===', flush=True)
out, _ = run('openclaw --version 2>&1')
print(f'Host openclaw: {out.strip()}', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw --version 2>&1')
print(f'Gateway openclaw: {out.strip()}', flush=True)

c.close()
print('\nDone!', flush=True)
