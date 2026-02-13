#!/usr/bin/env python3
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Reference claude_code_run.py from cloned repo
    'cat /tmp/claude-code-hooks/scripts/claude_code_run.py 2>/dev/null',
    # Current dispatch script
    'cat /Users/fangjin/claude-code-dispatch.sh 2>/dev/null',
    # Current hook script
    'cat /Users/fangjin/.claude/hooks/notify-openclaw.sh 2>/dev/null',
    # Current status script
    'cat /Users/fangjin/claude-code-status.sh 2>/dev/null',
]
for cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    result = out or err
    print(f"=== {cmd.split('/')[-1].split(' ')[0]} ===")
    print(result if result else "(empty/not found)")
    print()

client.close()
