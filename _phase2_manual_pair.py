#!/usr/bin/env python3
"""Phase 2: Investigate Gateway node state and try manual pairing."""
import paramiko, sys, io, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

def run(cmd, timeout=30):
    _, stdout, stderr = client.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# 1. Find node/pairing state files in container
print('=== Container .openclaw directory structure ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 find /home/node/.openclaw -type f 2>/dev/null | head -30')
print(out.strip())

# 2. Check for any node/device/pairing related files
print('\n=== Node/pairing related files ===')
for pattern in ['node', 'pair', 'device', 'state', 'peers']:
    out, _ = run(f'docker exec deploy-openclaw-gateway-1 find /home/node/.openclaw -name "*{pattern}*" 2>/dev/null')
    if out.strip():
        print(f'  {pattern}: {out.strip()}')

# 3. Check all files in .openclaw root
print('\n=== .openclaw root files ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/')
print(out.strip())

# 4. Check if there's a gateway state dir
print('\n=== Gateway state directories ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/gateway/ 2>/dev/null || echo "no gateway dir"')
print(out.strip())
out, _ = run('docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/devices/ 2>/dev/null || echo "no devices dir"')
print(out.strip())
out, _ = run('docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/nodes/ 2>/dev/null || echo "no nodes dir"')
print(out.strip())

# 5. Check the full openclaw.json for any node section
print('\n=== Full openclaw.json (formatted) ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json')
try:
    config = json.loads(out)
    print(json.dumps(config, indent=2, ensure_ascii=False)[:2000])
except:
    print(out.strip()[:2000])

# 6. Try adding a nodes section to openclaw.json to pre-approve the node
print('\n=== Try: Add node config to openclaw.json ===')
NODE_ID = "368cef16-74e8-41d1-9145-16643586b691"
config = json.loads(out)

# Try adding various node configuration approaches
config['gateway'] = config.get('gateway', {})
config['gateway']['nodes'] = {
    "autoApprove": True
}

import base64
new_json = json.dumps(config, indent=2, ensure_ascii=False)
b64 = base64.b64encode(new_json.encode()).decode()
run(f'docker exec deploy-openclaw-gateway-1 sh -c "echo {b64} | base64 -d > /home/node/.openclaw/openclaw.json"')
print('  Added gateway.nodes.autoApprove=true')

# Wait for hot-reload
time.sleep(3)

# 7. Try connecting Node again
print('\n=== Retry Node connection ===')
run('pkill -f "openclaw node" 2>/dev/null || true')
time.sleep(1)

out, _ = run(
    'OPENCLAW_GATEWAY_PASSWORD="openclaw123" '
    'timeout 10 openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" 2>&1',
    timeout=15
)
print(f'  Node output: {out.strip()[:500]}')

# 8. Check Gateway log for clues
print('\n=== Gateway logs after retry ===')
out, _ = run('docker logs --tail 5 deploy-openclaw-gateway-1 2>&1')
print(out.strip()[:500])

# 9. Check the node's stored ID
print('\n=== Host node.json ===')
out, _ = run('cat ~/.openclaw/node.json')
print(out.strip())

# 10. Try from inside the container itself (bypass Docker networking)
print('\n=== Try: Node from INSIDE container (loopback test) ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw node run --host 127.0.0.1 --port 18789 --display-name "InternalTest" 2>&1', timeout=10)
print(f'  Internal test: {out.strip()[:300]}')

client.close()
print('\nDone.')
