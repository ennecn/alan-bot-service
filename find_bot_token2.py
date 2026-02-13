#!/usr/bin/env python3
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Check openclaw config inside container
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json 2>/dev/null | grep -A5 telegram',
    # Check for channels config
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls /home/node/.openclaw/channels/ 2>/dev/null',
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/channels/telegram.json 2>/dev/null',
    # Check workspace config
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 find /home/node/.openclaw -name "*.json" -type f 2>/dev/null',
    # Check .env in deploy dir
    'cat ~/Desktop/p/docker-openclawd/deploy/.env 2>/dev/null',
]
for cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    if out:
        print(f"=== {cmd[:80]} ===")
        print(out[:500])
        print()

client.close()
