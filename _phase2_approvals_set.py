#!/usr/bin/env python3
"""Set exec approvals properly via CLI and test."""
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

# Step 1: Use approvals set --stdin on the host to set full security
print('=== Step 1: Set approvals via CLI ===', flush=True)
# Create the approvals JSON file first
run('cat > /tmp/approvals.json << \'APPROVALS\'\n{"defaults": {"security": "full"}, "agents": {}}\nAPPROVALS')

out, _ = run('cat /tmp/approvals.json')
print(f'  File: {out.strip()}', flush=True)

# Use approvals set --file
out, _ = run('openclaw approvals set --file /tmp/approvals.json 2>&1')
print(f'  Set result: {out.strip()[:400]}', flush=True)

# Verify
out, _ = run('openclaw approvals get 2>&1')
print(f'  Get result: {out.strip()[:400]}', flush=True)

# Also try set on the node specifically
print('\n=== Step 2: Set on node ===', flush=True)
out, _ = run('openclaw approvals set --node MacMini --file /tmp/approvals.json 2>&1')
print(f'  Set on node: {out.strip()[:400]}', flush=True)

# Step 3: Check current exec-approvals.json
print('\n=== Step 3: Check file ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/exec-approvals.json')
print(out.strip()[:400], flush=True)

# Step 4: Test nodes run directly
print('\n=== Step 4: Test nodes run ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes run --node MacMini --timeout 10000 --ask off echo "hello" 2>&1', timeout=15)
print(f'  Result: {out.strip()[:400]}', flush=True)

# Step 5: Maybe the issue is the `--ask` mode. The node might need approval
# on every command. Let's check if the node outputs something about approval
print('\n=== Step 5: Node log ===', flush=True)
out, _ = run('cat /tmp/node-bg.log 2>&1')
print(out.strip()[:600], flush=True)

# Step 6: Try running via the gateway's agent system instead of CLI
# The bot would use the system.run tool
print('\n=== Step 6: Test via gateway agent ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw agent --help 2>&1')
print(out.strip()[:300], flush=True)

# Step 7: Check if we can use nodes.run from inside the gateway
print('\n=== Step 7: Alternative approach - use openclaw nodes run from HOST ===', flush=True)
# The host CLI connects to the same gateway
out, _ = run('OPENCLAW_GATEWAY_PASSWORD="openclaw123" openclaw nodes run --host 127.0.0.1 --port 18789 --node MacMini --timeout 10000 --ask off echo "test" 2>&1', timeout=15)
print(f'  Host nodes run: {out.strip()[:400]}', flush=True)

c.close()
print('\nDone!', flush=True)
