#!/usr/bin/env python3
import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

# Check existing launchd config
_, stdout, _ = client.exec_command('cat /Users/fangjin/Library/LaunchAgents/com.claude-mem.worker.plist 2>/dev/null || echo "no plist"')
out = stdout.read().decode('utf-8', errors='replace')
print(f"Existing plist:\n{out}")

# Check launchctl
_, stdout, _ = client.exec_command('launchctl list | grep claude-mem')
out = stdout.read().decode('utf-8', errors='replace')
print(f"Launchctl: {out}")

client.close()
