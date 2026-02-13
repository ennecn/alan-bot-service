#!/usr/bin/env python3
"""Update hook to use chat.inject instead of wake"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

with sftp.file('/Users/fangjin/.claude/hooks/notify-openclaw.sh', 'r') as f:
    hook = f.read().decode()

# Update to use inject method
old = '''/opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "$WAKE_TEXT" \\
    > /dev/null 2>&1 \\
    && log "WebSocket inject sent" \\
    || log "WebSocket inject failed (non-fatal)"'''

new = '''/opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "$WAKE_TEXT" inject \\
    > /dev/null 2>&1 \\
    && log "WebSocket inject sent" \\
    || log "WebSocket inject failed (non-fatal)"'''

if old in hook:
    hook = hook.replace(old, new)
    with sftp.file('/Users/fangjin/.claude/hooks/notify-openclaw.sh', 'w') as f:
        f.write(hook)
    print("Hook updated: wake -> chat.inject")
else:
    print("WARNING: pattern not found, checking current state...")
    import subprocess
    stdin, stdout, stderr = client.exec_command('grep "inject" /Users/fangjin/.claude/hooks/notify-openclaw.sh')
    print(stdout.read().decode().strip())

# Test chat.inject
import time
stdin, stdout, stderr = client.exec_command(
    '/opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "[Claude Code 任务完成] 测试注入消息" inject 2>&1'
)
time.sleep(12)
result = stdout.read().decode().strip()
print(f"Inject test: {result}")

sftp.close()
client.close()
