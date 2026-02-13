#!/usr/bin/env python3
"""Check cc-bridge skill contents, then delete if it's old claude code stuff"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Check cc-bridge contents
cmds = [
    ("cc-bridge files", "ls -la ~/Desktop/p/docker-openclawd/deploy/config/skills/cc-bridge/"),
    ("cc-bridge SKILL.md", "cat ~/Desktop/p/docker-openclawd/deploy/config/skills/cc-bridge/SKILL.md 2>/dev/null"),
]

for label, cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    print(f"--- {label} ---")
    print(out or stderr.read().decode().strip() or "(empty)")
    print()

client.close()
