#!/usr/bin/env python3
import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

PLIST_PATH = '/Users/fangjin/Library/LaunchAgents/com.claude-mem.worker.plist'

# Fix PATH in plist to include ~/.local/bin for uvx
plist = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude-mem.worker</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/bun</string>
        <string>plugin/scripts/worker-service.cjs</string>
        <string>start</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/fangjin/.claude/plugins/marketplaces/thedotmack</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/fangjin/.claude-mem/logs/worker-launchd.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/fangjin/.claude-mem/logs/worker-launchd-err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/Users/fangjin/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>'''

with sftp.open(PLIST_PATH, 'w') as f:
    f.write(plist)
print("Updated plist with ~/.local/bin in PATH")

# Kill current manual worker
_, stdout, _ = client.exec_command('bash -l -c \'kill -9 $(pgrep -f "worker-service.cjs") 2>/dev/null; echo killed\'')
print(f"Kill: {stdout.read().decode().strip()}")

import time; time.sleep(2)

# Reload launchd service
_, stdout, _ = client.exec_command(f'launchctl unload {PLIST_PATH} 2>/dev/null; launchctl load {PLIST_PATH}')
stdout.read()
print("Reloaded launchd service")

time.sleep(5)

# Verify
_, stdout, _ = client.exec_command('curl -s http://127.0.0.1:37777/api/health')
print(f"Health: {stdout.read().decode().strip()}")

time.sleep(5)

_, stdout, _ = client.exec_command('curl -s http://127.0.0.1:37777/api/stats')
print(f"Stats: {stdout.read().decode().strip()}")

# Test search
test_script = '''#!/bin/bash
sleep 2
curl -s "http://127.0.0.1:37777/api/search?query=kimi&limit=5"
'''
with sftp.open('/tmp/test-search.sh', 'w') as f:
    f.write(test_script)

_, stdout, _ = client.exec_command('bash /tmp/test-search.sh')
out = stdout.read().decode('utf-8', errors='replace')
print(f"Search: {out.strip()[:300]}")

sftp.close()
client.close()
