#!/usr/bin/env python3
"""Setup launchd plist for Gateway V2 on Mac Mini."""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH && {cmd}'
    _, stdout, stderr = client.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8','replace'), stderr.read().decode('utf-8','replace')

# Find node path
out, _ = run('which node')
node_path = out.strip()
print(f'Node path: {node_path}')

# Check if there is already a running process
out, _ = run('lsof -i :8080 -t')
pids = out.strip()
print(f'Current PIDs on 8080: {pids}')

PLIST_NAME = 'com.llm-gateway-v2.plist'
PLIST_PATH = f'/Users/fangjin/Library/LaunchAgents/{PLIST_NAME}'

# Create plist
plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.llm-gateway-v2</string>
    <key>ProgramArguments</key>
    <array>
        <string>{node_path}</string>
        <string>/Users/fangjin/llm-gateway-v2/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/fangjin/llm-gateway-v2</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/llm-gateway-v2.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/llm-gateway-v2.stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>8080</string>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
"""

# Ensure LaunchAgents dir exists
run('mkdir -p ~/Library/LaunchAgents')

# Write plist via SFTP
sftp = client.open_sftp()
with sftp.file(PLIST_PATH, 'w') as f:
    f.write(plist_content)
sftp.close()
print(f'Plist written to {PLIST_PATH}')

# Kill existing process
if pids:
    for pid in pids.split('\n'):
        pid = pid.strip()
        if pid:
            print(f'Killing old PID {pid}...')
            run(f'kill -9 {pid}')
    import time
    time.sleep(2)

# Load via launchctl
uid_out, _ = run('id -u')
uid = uid_out.strip()
print(f'UID: {uid}')

out, err = run(f'launchctl bootout gui/{uid}/{PLIST_NAME} 2>&1 || true')
print(f'Bootout: {out.strip()} {err.strip()}')

import time
time.sleep(1)

out, err = run(f'launchctl bootstrap gui/{uid} {PLIST_PATH} 2>&1')
print(f'Bootstrap: {out.strip()} {err.strip()}')

time.sleep(3)

# Verify
out, _ = run('curl -s http://127.0.0.1:8080/health')
print(f'Health: {out.strip()}')

out, _ = run('curl -s http://127.0.0.1:8080/api/bots')
print(f'Bots: {out.strip()[:300]}')

out, _ = run('tail -5 /tmp/llm-gateway-v2.stdout.log')
print(f'Log:\n{out.strip()}')

client.close()
print('\nDone!')
