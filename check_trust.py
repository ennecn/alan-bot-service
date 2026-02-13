#!/usr/bin/env python3
import paramiko, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Current Claude Code settings
    'cat /Users/fangjin/.claude/settings.json 2>/dev/null',
    # Check if script(1) is available
    'which script 2>/dev/null',
    # Check claude version
    '/opt/homebrew/bin/claude --version 2>/dev/null',
    # Check if --dangerously-skip-permissions bypasses workspace trust
    '/opt/homebrew/bin/claude --help 2>/dev/null | grep -A2 "dangerously\\|trust\\|workspace"',
    # Check existing trusted directories in settings
    'cat /Users/fangjin/.claude/settings.local.json 2>/dev/null',
    # Check if there's a projects config
    'ls -la /Users/fangjin/.claude/projects/ 2>/dev/null',
]
for cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    result = out or err
    label = cmd.split('/')[-1].split(' ')[0] if '/' in cmd else cmd[:60]
    print(f"=== {label} ===")
    print(result if result else "(empty)")
    print()

client.close()
