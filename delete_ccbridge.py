#!/usr/bin/env python3
"""Delete old cc-bridge skill"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Delete cc-bridge from host (bind-mounted, so container sees it too)
stdin, stdout, stderr = client.exec_command(
    'rm -rf ~/Desktop/p/docker-openclawd/deploy/config/skills/cc-bridge && echo "deleted"'
)
print(f"cc-bridge: {stdout.read().decode().strip()}")

# Verify it's gone from container
stdin, stdout, stderr = client.exec_command(
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls /home/node/.openclaw/skills/ 2>/dev/null | sort'
)
print(f"\nRemaining skills:\n{stdout.read().decode().strip()}")

client.close()
