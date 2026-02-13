#!/usr/bin/env python3
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Find skills directories
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 find / -path "*/skills" -type d 2>/dev/null | head -10',
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 find / -name "SKILL.md" 2>/dev/null | head -10',
    # Check workspace structure
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/workspace/ 2>/dev/null',
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/workspace/config/ 2>/dev/null',
    # Check host bind mount
    'ls -la ~/Desktop/p/docker-openclawd/deploy/config/skills/ 2>/dev/null',
    'ls -la ~/Desktop/p/docker-openclawd/deploy/config/ 2>/dev/null',
]
for cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    result = out or err
    if result:
        print(f">>> {cmd[:80]}")
        print(result[:500])
        print()

client.close()
