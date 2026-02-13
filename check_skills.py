#!/usr/bin/env python3
"""Check all skills in 阿凛's container and host, find duplicates"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # List all skills in container
    ("Container skills", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/skills/ 2>/dev/null"),
    # List all skill dirs on host
    ("Host skill dirs", "ls -la ~/Desktop/p/docker-openclawd/deploy/config/skills/ 2>/dev/null"),
    # Check each skill's _meta.json
    ("All _meta.json", "for d in ~/Desktop/p/docker-openclawd/deploy/config/skills/*/; do echo \"=== $(basename $d) ===\"; cat \"$d/_meta.json\" 2>/dev/null || echo '(no meta)'; echo; done"),
    # Check for any claude-code related skill names
    ("Claude-related skills", "ls -d ~/Desktop/p/docker-openclawd/deploy/config/skills/*claude* ~/Desktop/p/docker-openclawd/deploy/config/skills/*code* 2>/dev/null || echo 'none found'"),
]

for label, cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    print(f"--- {label} ---")
    print(out or err or "(empty)")
    print()

client.close()
