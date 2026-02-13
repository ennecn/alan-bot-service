#!/usr/bin/env python3
import paramiko
import sys

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Copy file out via SFTP
stdin, stdout, stderr = client.exec_command(
    'export PATH=/usr/local/bin:/usr/bin:/bin && '
    'docker cp deploy-openclaw-gateway-1:/home/node/.openclaw/agents/main/sessions/29c76df5-c172-44ec-96fd-ee6027e978ec.jsonl /tmp/new_session.jsonl'
)
stdout.read()

sftp = client.open_sftp()
with sftp.open('/tmp/new_session.jsonl', 'r') as f:
    content = f.read().decode('utf-8', errors='replace')
sftp.close()
client.close()

# Write to local file for reading
with open(r'D:\openclawVPS\new_session.jsonl', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Downloaded {len(content)} bytes")
print("Saved to D:\\openclawVPS\\new_session.jsonl")
