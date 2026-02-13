#!/usr/bin/env python3
import paramiko
import json
import sys

def run_cmd(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    client.close()
    return out, err

# Copy sessions.json out of container to host, then read it
PATH = 'export PATH=/usr/local/bin:/usr/bin:/bin'
CONTAINER = 'deploy-openclaw-gateway-1'
SESSIONS_PATH = '/home/node/.openclaw/agents/main/sessions/sessions.json'

# Copy to host temp
run_cmd(f'{PATH} && docker cp {CONTAINER}:{SESSIONS_PATH} /tmp/sessions.json')

# Read it via SFTP
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()
with sftp.open('/tmp/sessions.json', 'r') as f:
    data = json.load(f)
sftp.close()
client.close()

# Find the session cc880d45
target = 'cc880d45-0d6b-4378-908d-9053e0c7c681'
print(f"Total sessions in sessions.json: {len(data)}")
print()

# Look for the target session
for key, value in data.items():
    if isinstance(value, dict):
        sid = value.get('sessionId', '')
        if sid == target:
            print(f"Found target session!")
            print(f"  Key: {key}")
            print(f"  Data: {json.dumps(value, indent=2, ensure_ascii=False)[:2000]}")
            print()

# Also show a few sample entries to understand structure
print("Sample entries (first 3):")
for i, (key, value) in enumerate(data.items()):
    if i >= 3:
        break
    print(f"  Key: {key[:80]}...")
    if isinstance(value, dict):
        print(f"  Value keys: {list(value.keys())}")
        print(f"  sessionId: {value.get('sessionId', 'N/A')}")
    print()
