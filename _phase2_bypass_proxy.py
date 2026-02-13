#!/usr/bin/env python3
"""Phase 2: Bypass Clash Verge proxy by connecting directly to container IP."""
import paramiko, sys, io, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

def run(cmd, timeout=30):
    _, stdout, stderr = client.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# 1. Get container IP
print('=== Step 1: Get container IP ===')
out, _ = run("docker inspect deploy-openclaw-gateway-1 --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'")
container_ip = out.strip()
print(f'  Container IP: {container_ip}')

# 2. Test direct connection to container IP (bypasses host proxy)
print('\n=== Step 2: Test direct connection ===')
out, _ = run(f'curl -s -o /dev/null -w "%{{http_code}}" http://{container_ip}:18789/ 2>/dev/null')
print(f'  HTTP to {container_ip}:18789: {out.strip()}')

# 3. Kill old processes
run('pkill -f "openclaw node" 2>/dev/null || true')
time.sleep(1)

# 4. Update node.json to use container IP directly
print('\n=== Step 3: Update node.json with container IP ===')
node_config = {
    "version": 1,
    "nodeId": "368cef16-74e8-41d1-9145-16643586b691",
    "displayName": "MacMini",
    "gateway": {
        "host": container_ip,
        "port": 18789,
        "tls": False,
        "password": "openclaw123"
    }
}
sftp = client.open_sftp()
with sftp.file('/Users/fangjin/.openclaw/node.json', 'w') as f:
    f.write(json.dumps(node_config, indent=2))
sftp.close()
print(f'  node.json updated: host={container_ip}')

# 5. Start Node connecting to container IP
print('\n=== Step 4: Start Node with container IP ===')
start_cmd = (
    f'export OPENCLAW_GATEWAY_PASSWORD="openclaw123" && '
    f'openclaw node run --host {container_ip} --port 18789 --display-name "MacMini" '
    f'> /tmp/node-direct.log 2>&1 &'
)
run(start_cmd)
time.sleep(6)

out, _ = run('cat /tmp/node-direct.log')
print(f'  Log:\n{out.strip()[:600]}')

# Check process
out, _ = run('ps aux | grep "openclaw node" | grep -v grep')
running = bool(out.strip())
print(f'\n  Running: {running}')

# 6. Check Gateway logs for connection from Docker bridge IP
print('\n=== Step 5: Gateway logs ===')
out, _ = run('docker logs --tail 10 deploy-openclaw-gateway-1 2>&1')
import re
for line in out.strip().split('\n'):
    clean = re.sub(r'\x1b\[[0-9;]*m', '', line)
    if any(k in clean.lower() for k in ['ws', 'node', 'pair', 'connect']):
        print(f'  {clean.strip()[:160]}')

# 7. If connected, check pending/status
if running:
    print('\n=== Step 6: Pairing status ===')
    out, _ = run('docker exec deploy-openclaw-gateway-1 npx -y openclaw nodes pending 2>&1')
    for line in out.strip().split('\n'):
        if 'npm' not in line.lower():
            print(f'  Pending: {line.strip()}')
    
    out, _ = run('docker exec deploy-openclaw-gateway-1 npx -y openclaw nodes status 2>&1')
    for line in out.strip().split('\n'):
        if 'npm' not in line.lower():
            print(f'  Status: {line.strip()}')
    
    # Try to approve
    out, _ = run('docker exec deploy-openclaw-gateway-1 npx -y openclaw nodes pending --json 2>&1')
    try:
        pending = json.loads(out.strip())
        if pending:
            print(f'  Found {len(pending)} pending request(s)!')
            for p in pending:
                pid = p.get('id') or p.get('requestId') or p.get('nodeId', '')
                print(f'    Approving {pid}...')
                out2, _ = run(f'docker exec deploy-openclaw-gateway-1 npx -y openclaw nodes approve "{pid}" 2>&1')
                print(f'    Result: {out2.strip()[:200]}')
    except:
        pass
else:
    # Node still not running. Let's also check if there's a Clash proxy issue
    print('\n=== Step 6: Check network config ===')
    out, _ = run('scutil --proxy 2>/dev/null || echo "no scutil"')
    print(f'  System proxy:\n{out.strip()[:400]}')
    
    out, _ = run('networksetup -getwebproxy Wi-Fi 2>/dev/null || echo "no proxy info"')
    print(f'  Wi-Fi web proxy: {out.strip()[:200]}')
    
    # Test if container IP is reachable on a specific port
    out, _ = run(f'nc -z -w 2 {container_ip} 18789 && echo "REACHABLE" || echo "NOT REACHABLE"')
    print(f'  {container_ip}:18789 reachable: {out.strip()}')

client.close()
print('\nDone.')
