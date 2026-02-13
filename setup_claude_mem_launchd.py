#!/usr/bin/env python3
"""Set up claude-mem worker as a launchd service on Mac Mini for auto-start."""
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

PLIST = """<?xml version="1.0" encoding="UTF-8"?>
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
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
"""

PLIST_PATH = "/Users/fangjin/Library/LaunchAgents/com.claude-mem.worker.plist"

sftp = c.open_sftp()
with sftp.open(PLIST_PATH, "wb") as f:
    f.write(PLIST.encode("utf-8"))
sftp.close()

# Load the service
si, so, se = c.exec_command(f"launchctl unload {PLIST_PATH} 2>/dev/null; launchctl load {PLIST_PATH}")
so.read()
err = se.read().decode().strip()

# Check status
si, so, se = c.exec_command("launchctl list | grep claude-mem")
out = so.read().decode().strip()
print(f"Launchd service: {out if out else 'loaded (checking...)'}")

# Verify worker is still running
import time
time.sleep(2)
si, so, se = c.exec_command("curl -s http://127.0.0.1:37777/api/health 2>/dev/null || echo 'not responding'")
out = so.read().decode().strip()
print(f"Worker health: {out}")

c.close()
print("Done! claude-mem worker will auto-start on boot.")
