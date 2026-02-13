#!/usr/bin/env python3
"""Phase 2 final: Fix config, add password to node.json, pair Node."""
import paramiko, sys, io, json, time, base64
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

def run(cmd, timeout=30):
    _, stdout, stderr = client.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# 0. Kill everything and clean up
run('pkill -f "openclaw node" 2>/dev/null; launchctl bootout gui/501/ai.openclaw.node 2>/dev/null')
time.sleep(1)

# 1. Fix openclaw.json - remove invalid autoApprove key
print('=== Step 1: Fix openclaw.json ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json')
config = json.loads(out)
if 'nodes' in config.get('gateway', {}):
    del config['gateway']['nodes']
    new_json = json.dumps(config, indent=2, ensure_ascii=False)
    b64 = base64.b64encode(new_json.encode()).decode()
    run(f'docker exec deploy-openclaw-gateway-1 sh -c "echo {b64} | base64 -d > /home/node/.openclaw/openclaw.json"')
    print('  Removed invalid gateway.nodes config')
else:
    print('  Config already clean')

time.sleep(2)

# 2. Add password to node.json on host
print('\n=== Step 2: Update node.json with password ===')
node_config = {
    "version": 1,
    "nodeId": "368cef16-74e8-41d1-9145-16643586b691",
    "displayName": "MacMini",
    "gateway": {
        "host": "127.0.0.1",
        "port": 18789,
        "tls": False,
        "password": "openclaw123"
    }
}
sftp = client.open_sftp()
with sftp.file('/Users/fangjin/.openclaw/node.json', 'w') as f:
    f.write(json.dumps(node_config, indent=2))
sftp.close()
print('  node.json updated with gateway.password')

# 3. Start Node with password via env AND node.json
print('\n=== Step 3: Start Node ===')
# Use gtimeout or just run with a shell timeout
start_cmd = (
    'export OPENCLAW_GATEWAY_PASSWORD="openclaw123" && '
    'openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" '
    '> /tmp/node-start.log 2>&1 &'
)
run(start_cmd)
time.sleep(5)

out, _ = run('cat /tmp/node-start.log')
print(f'  Log: {out.strip()[:500]}')

out, _ = run('ps aux | grep "openclaw node" | grep -v grep')
running = 'openclaw' in out
print(f'  Running: {running}')
if out.strip():
    print(f'  Process: {out.strip()[:200]}')

# 4. If still "pairing required", try with token instead
if 'pairing required' in (out or ''):
    print('\n=== Step 3b: Try token auth instead ===')
    run('pkill -f "openclaw node" 2>/dev/null')
    time.sleep(1)
    
    node_config['gateway']['token'] = 'mysecrettoken123'
    del node_config['gateway']['password']
    with sftp.file('/Users/fangjin/.openclaw/node.json', 'w') as f:
        f.write(json.dumps(node_config, indent=2))
    
    start_cmd = (
        'export OPENCLAW_GATEWAY_TOKEN="mysecrettoken123" && '
        'openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" '
        '> /tmp/node-start.log 2>&1 &'
    )
    run(start_cmd)
    time.sleep(5)
    out, _ = run('cat /tmp/node-start.log')
    print(f'  Log: {out.strip()[:500]}')

# 5. Check Gateway logs
print('\n=== Step 4: Gateway logs ===')
out, _ = run('docker logs --tail 10 deploy-openclaw-gateway-1 2>&1')
for line in out.strip().split('\n'):
    if any(k in line.lower() for k in ['node', 'pair', 'ws', 'connect', 'approv']):
        # strip ANSI codes for readability
        import re
        clean = re.sub(r'\x1b\[[0-9;]*m', '', line)
        print(f'  {clean.strip()[:150]}')

# 6. Check if Node is connected now
print('\n=== Step 5: Check nodes status ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 npx -y openclaw nodes status 2>&1')
# Filter out npm noise
for line in out.strip().split('\n'):
    if 'npm' not in line.lower():
        print(f'  {line.strip()}')

# 7. Check if pairing succeeded by looking at Node log
print('\n=== Step 6: Node detailed log ===')
out, _ = run('cat ~/.openclaw/logs/node.log 2>/dev/null | tail -30')
for line in out.strip().split('\n')[-15:]:
    print(f'  {line.strip()}')

# 8. Final check - is the node process still alive?
out, _ = run('ps aux | grep "openclaw" | grep -v grep')
print(f'\n=== Processes ===\n  {out.strip()[:300]}')

client.close()
print('\nDone.')
