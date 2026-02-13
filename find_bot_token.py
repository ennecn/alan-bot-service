#!/usr/bin/env python3
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Check for bot token in container env
cmds = [
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 env | grep -i telegram 2>&1',
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 env | grep -i bot 2>&1',
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 env | grep -i token 2>&1',
    # Check docker-compose for env vars
    'cat ~/Desktop/p/docker-openclawd/deploy/docker-compose.yml 2>/dev/null | grep -A2 -i telegram',
    'cat ~/Desktop/p/docker-openclawd/deploy/.env 2>/dev/null | grep -i telegram',
    'cat ~/Desktop/p/docker-openclawd/deploy/.env 2>/dev/null | grep -i bot',
]
for cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"[{cmd.split('|')[0].strip()[:60]}]")
        print(out)
        print()

client.close()
