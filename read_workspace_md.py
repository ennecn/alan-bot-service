#!/usr/bin/env python3
"""Read workspace instruction files"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

files = ['IDENTITY.md', 'TOOLS.md', 'MEMORY.md', 'SOUL.md', 'AGENTS.md', 'USER.md', 'HEARTBEAT.md']

for f in files:
    stdin, stdout, stderr = client.exec_command(
        f'/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/workspace/{f} 2>/dev/null'
    )
    content = stdout.read().decode().strip()
    if content:
        # Truncate long files
        if len(content) > 1500:
            content = content[:1500] + "\n... (truncated)"
        print(f"=== {f} ===")
        print(content)
        print()

client.close()
