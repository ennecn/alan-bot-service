#!/usr/bin/env python3
"""Phase 2 fix: Investigate Gateway API and fix Node pairing."""
import paramiko, sys, io, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

def run(cmd, timeout=30):
    _, stdout, stderr = client.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# Kill everything
run('pkill -f "openclaw node" 2>/dev/null; pkill -f "node-retry" 2>/dev/null')
# Unload the installed LaunchAgent for now
run('launchctl bootout gui/501/ai.openclaw.node 2>/dev/null || true')
time.sleep(1)

# 1. Try Gateway HTTP API with various auth methods
print('=== Gateway HTTP API exploration ===')

# Try with password auth
endpoints = [
    '/api/nodes',
    '/api/nodes/pending',
    '/api/v1/nodes',
    '/api/v1/nodes/pending',
    '/nodes',
    '/api/tools-invoke',
]
for ep in endpoints:
    out, _ = run(f'curl -s -w "\\n%{{http_code}}" -H "Authorization: Bearer mysecrettoken123" http://127.0.0.1:18789{ep} 2>/dev/null')
    lines = out.strip().split('\n')
    code = lines[-1] if lines else '?'
    body = '\n'.join(lines[:-1])[:100]
    if code != '200' or '<html' in body.lower():
        out2, _ = run(f'curl -s -w "\\n%{{http_code}}" -H "X-Gateway-Password: openclaw123" http://127.0.0.1:18789{ep} 2>/dev/null')
        lines2 = out2.strip().split('\n')
        code2 = lines2[-1] if lines2 else '?'
        body2 = '\n'.join(lines2[:-1])[:100]
        print(f'  {ep}: Bearer={code} Password={code2} | {body2[:80]}')
    else:
        print(f'  {ep}: {code} | {body[:80]}')

# 2. Try tools-invoke API (documented way to call nodes tool)
print('\n=== Tools Invoke API ===')
for auth_header in [
    '-H "Authorization: Bearer mysecrettoken123"',
    '-H "Authorization: Bearer openclaw123"',
    '-H "X-Gateway-Token: mysecrettoken123"',
]:
    payload = json.dumps({"tool": "nodes", "input": {"action": "status"}})
    out, _ = run(f"""curl -s -X POST {auth_header} -H "Content-Type: application/json" -d '{payload}' http://127.0.0.1:18789/api/tools-invoke 2>/dev/null""")
    print(f'  {auth_header[:30]}...: {out.strip()[:200]}')

# 3. Try a fast pairing approach: start Node and immediately check
print('\n=== Fast pairing attempt ===')

# Create a script that starts Node AND polls for pending simultaneously
pair_script = '''#!/bin/bash
export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH
export OPENCLAW_GATEWAY_PASSWORD="openclaw123"

# Start node in background
openclaw node run --host 127.0.0.1 --port 18789 --display-name "MacMini" > /tmp/node-pair.log 2>&1 &
NODE_PID=$!

# Poll for pending very rapidly
for i in $(seq 1 20); do
    sleep 0.3
    PENDING=$(docker exec deploy-openclaw-gateway-1 npx -y openclaw nodes pending --json 2>/dev/null)
    echo "[$i] pending: $PENDING"
    if echo "$PENDING" | grep -q '"id"'; then
        ID=$(echo "$PENDING" | python3 -c "import sys,json; p=json.load(sys.stdin); print(p[0].get('id',''))" 2>/dev/null)
        if [ -n "$ID" ]; then
            echo "Approving: $ID"
            docker exec deploy-openclaw-gateway-1 npx -y openclaw nodes approve "$ID" 2>&1
            echo "Approved!"
            break
        fi
    fi
done

# Wait and check if still running
sleep 3
if kill -0 $NODE_PID 2>/dev/null; then
    echo "Node still running (PID=$NODE_PID)"
else
    echo "Node exited"
    cat /tmp/node-pair.log
fi

# Show status
docker exec deploy-openclaw-gateway-1 npx -y openclaw nodes status 2>&1
'''

sftp = client.open_sftp()
with sftp.file('/tmp/pair-attempt.sh', 'w') as f:
    f.write(pair_script)
sftp.close()
run('chmod +x /tmp/pair-attempt.sh')

out, err = run('/tmp/pair-attempt.sh 2>&1', timeout=90)
print(out.strip()[:1500])

# 4. Check gateway logs for what happened
print('\n=== Recent Gateway logs ===')
out, _ = run('docker logs --tail 10 deploy-openclaw-gateway-1 2>&1 | grep -i "node\\|pair\\|ws\\|approve"')
print(out.strip()[:500])

client.close()
print('\nDone.')
