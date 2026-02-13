#!/usr/bin/env python3
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Current claude-code skill
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/skills/claude-code/SKILL.md 2>/dev/null',
    # List files in the skill dir
    'ls -la ~/Desktop/p/docker-openclawd/deploy/config/skills/claude-code/ 2>/dev/null',
    # Check another skill for reference pattern (image-gen)
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/skills/image-gen/SKILL.md 2>/dev/null | head -40',
    # Check nodes status
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 openclaw nodes status 2>/dev/null',
]
for cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    result = out or err
    if result:
        print(f">>> {cmd[:80]}")
        print(result)
        print()

client.close()
