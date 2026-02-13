#!/usr/bin/env python3
"""Phase 5: Configure launchd service for OpenClaw Node with gateway password."""
import paramiko, sys, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'
GW_PASSWORD = 'openclaw123'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=30):
    try:
        _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
        return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')
    except Exception as e:
        return f'TIMEOUT: {e}', ''

sftp = c.open_sftp()

# ============================================================
# Step 1: Kill current manually started node
# ============================================================
print('=== Step 1: Stop current node ===', flush=True)
run('pkill -f "openclaw.*node" 2>/dev/null || true; pkill -f "openclaw-node" 2>/dev/null || true')
time.sleep(2)

# Unload existing launchd service
uid_out, _ = run('id -u')
uid = uid_out.strip()
run(f'launchctl bootout gui/{uid}/ai.openclaw.node 2>&1 || true')
time.sleep(1)

# ============================================================
# Step 2: Write updated plist with OPENCLAW_GATEWAY_PASSWORD
# ============================================================
print('\n=== Step 2: Write plist ===', flush=True)

PLIST = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>ai.openclaw.node</string>
    <key>Comment</key>
    <string>OpenClaw Node Host (MacMini)</string>
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
      <string>{GW_PASSWORD}</string>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
      <key>HOME</key>
      <string>/Users/fangjin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/fangjin/.openclaw/logs/node.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/fangjin/.openclaw/logs/node.err.log</string>
    <key>ThrottleInterval</key>
    <integer>10</integer>
  </dict>
</plist>'''

PLIST_PATH = '/Users/fangjin/Library/LaunchAgents/ai.openclaw.node.plist'
with sftp.file(PLIST_PATH, 'w') as f:
    f.write(PLIST)
print(f'  Written to {PLIST_PATH}', flush=True)

# ============================================================
# Step 3: Clear old logs
# ============================================================
print('\n=== Step 3: Clear logs ===', flush=True)
run('mkdir -p /Users/fangjin/.openclaw/logs')
run('echo "" > /Users/fangjin/.openclaw/logs/node.log')
run('echo "" > /Users/fangjin/.openclaw/logs/node.err.log')

# ============================================================
# Step 4: Load launchd service
# ============================================================
print('\n=== Step 4: Bootstrap launchd ===', flush=True)
out, _ = run(f'launchctl bootstrap gui/{uid} {PLIST_PATH} 2>&1')
print(f'  Bootstrap: {out.strip() or "OK"}', flush=True)
time.sleep(8)

# ============================================================
# Step 5: Verify service
# ============================================================
print('\n=== Step 5: Verify ===', flush=True)
out, _ = run('openclaw node status 2>&1')
print(f'  Status:\n{out.strip()[:400]}', flush=True)

# Check connection
out, _ = run('netstat -an | grep "18789.*ESTABLISH"')
connected = 'ESTABLISHED' in out
print(f'\n  Connected: {connected}', flush=True)

# Check logs
out, _ = run('cat /Users/fangjin/.openclaw/logs/node.log 2>&1')
print(f'\n  Log: {out.strip()[:300]}', flush=True)
out, _ = run('cat /Users/fangjin/.openclaw/logs/node.err.log 2>&1')
err = out.strip()
print(f'  Err: {err[:300] if err else "(empty - no errors)"}', flush=True)

# Quick functionality test
print('\n=== Step 6: Quick test ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.which --params '{"bins":["echo"]}' --invoke-timeout 5000 --json 2>&1''', timeout=10)
print(f'  system.which: {out.strip()[:200]}', flush=True)

sftp.close()
c.close()
print('\nPhase 5 complete!', flush=True)
