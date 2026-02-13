#!/usr/bin/env python3
"""Phase 2: Fix launchd plist with gateway password, restart, and approve device pairing."""
import paramiko, sys, io, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'
GW_PASSWORD = 'openclaw123'
DEPLOY = '/Users/fangjin/Desktop/p/docker-openclawd/deploy'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=10)

def run(cmd, timeout=30):
    _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# ============================================================
# Step 1: Stop existing node service and clear stale state
# ============================================================
print('=== Step 1: Stop existing node and clear state ===', flush=True)
run('openclaw node stop 2>&1')
time.sleep(1)
run('pkill -f "openclaw node" 2>/dev/null || true')
time.sleep(1)

# Check err log to confirm password issue
out, _ = run('tail -5 /Users/fangjin/.openclaw/logs/node.err.log 2>/dev/null')
print(f'  Error log: {out.strip()[:300]}', flush=True)

# ============================================================
# Step 2: Delete existing node identity so fresh pairing happens
# ============================================================
print('\n=== Step 2: Reset node identity for fresh pairing ===', flush=True)
# We need to delete node.json so a fresh pairing request is generated
# Actually, keep node.json but clear any stale pairing token
out, _ = run('cat /Users/fangjin/.openclaw/node.json')
print(f'  Current node.json: {out.strip()}', flush=True)

# ============================================================
# Step 3: Update launchd plist with OPENCLAW_GATEWAY_PASSWORD
# ============================================================
print('\n=== Step 3: Update launchd plist with password ===', flush=True)

PLIST = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>ai.openclaw.node</string>
    <key>Comment</key>
    <string>OpenClaw Node Host</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/node</string>
      <string>/opt/homebrew/lib/node_modules/openclaw/dist/index.js</string>
      <string>node</string>
      <string>run</string>
      <string>--host</string>
      <string>127.0.0.1</string>
      <string>--port</string>
      <string>18789</string>
      <string>--display-name</string>
      <string>MacMini</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>OPENCLAW_GATEWAY_PASSWORD</key>
      <string>''' + GW_PASSWORD + '''</string>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/fangjin/.openclaw/logs/node.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/fangjin/.openclaw/logs/node.err.log</string>
  </dict>
</plist>'''

PLIST_PATH = '/Users/fangjin/Library/LaunchAgents/ai.openclaw.node.plist'
sftp = c.open_sftp()
with sftp.file(PLIST_PATH, 'w') as f:
    f.write(PLIST)
sftp.close()
print(f'  Written plist with OPENCLAW_GATEWAY_PASSWORD', flush=True)

# ============================================================
# Step 4: Clear old logs
# ============================================================
print('\n=== Step 4: Clear old logs ===', flush=True)
run('echo "" > /Users/fangjin/.openclaw/logs/node.log')
run('echo "" > /Users/fangjin/.openclaw/logs/node.err.log')

# ============================================================
# Step 5: Unload and reload launchd service
# ============================================================
print('\n=== Step 5: Reload launchd service ===', flush=True)
uid_out, _ = run('id -u')
uid = uid_out.strip()
print(f'  UID: {uid}', flush=True)

out, _ = run(f'launchctl bootout gui/{uid}/ai.openclaw.node 2>&1 || true')
print(f'  Bootout: {out.strip()}', flush=True)
time.sleep(2)

out, _ = run(f'launchctl bootstrap gui/{uid} {PLIST_PATH} 2>&1')
print(f'  Bootstrap: {out.strip()}', flush=True)
time.sleep(5)

# Check status
out, _ = run('openclaw node status 2>&1')
print(f'  Node status: {out.strip()[:300]}', flush=True)

# Check logs
out, _ = run('cat /Users/fangjin/.openclaw/logs/node.log 2>&1')
print(f'  Node log: {out.strip()[:500]}', flush=True)

out, _ = run('cat /Users/fangjin/.openclaw/logs/node.err.log 2>&1')
print(f'  Error log: {out.strip()[:500]}', flush=True)

# ============================================================
# Step 6: Check for pending device and approve
# ============================================================
print('\n=== Step 6: Monitor for pending devices (20s) ===', flush=True)
approved = False
for i in range(20):
    time.sleep(1)

    # Check pending.json directly
    out, _ = run(f'cat {DEPLOY}/config/devices/pending.json 2>/dev/null || echo "{{}}"')
    try:
        pending = json.loads(out.strip())
        if pending:
            print(f'  [{i}s] Found pending device(s)!', flush=True)
            for req_id, info in pending.items():
                name = info.get('displayName', 'unknown')
                print(f'  Pending: {req_id} ({name})', flush=True)

                # Try devices approve
                out2, _ = run(f'docker exec deploy-openclaw-gateway-1 npx openclaw devices approve "{req_id}" 2>&1')
                print(f'  Approve result: {out2.strip()[:300]}', flush=True)

                if 'error' not in out2.lower() and 'Error' not in out2:
                    approved = True
            if approved:
                break
        else:
            if i % 5 == 0:
                print(f'  [{i}s] No pending devices yet...', flush=True)
    except json.JSONDecodeError:
        if i % 5 == 0:
            print(f'  [{i}s] Waiting...', flush=True)

# Also check devices list
print('\n=== Devices list ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw devices list 2>&1')
print(out.strip()[:500], flush=True)

# Check if node is now connected
print('\n=== Nodes list ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw nodes list 2>&1')
print(out.strip()[:500], flush=True)

# Node final log
print('\n=== Final node log ===', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/logs/node.log 2>&1')
print(out.strip()[:600], flush=True)

out, _ = run('tail -10 /Users/fangjin/.openclaw/logs/node.err.log 2>&1')
print(f'\n  Error log: {out.strip()[:400]}', flush=True)

c.close()
print('\nPhase 2 done!', flush=True)
