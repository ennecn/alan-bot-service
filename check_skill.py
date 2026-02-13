#!/usr/bin/env python3
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Check existing skill
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/workspace/config/skills/ 2>/dev/null',
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/workspace/config/skills/claude-code/ 2>/dev/null',
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/workspace/config/skills/claude-code/SKILL.md 2>/dev/null',
    # Check other skills for reference pattern
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls /home/node/.openclaw/workspace/config/skills/',
]
for cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"=== {cmd.split('cat ')[-1].split(' 2>')[0] if 'cat' in cmd else cmd.split('ls ')[-1].split(' 2>')[0]} ===")
        print(out)
        print()

client.close()
