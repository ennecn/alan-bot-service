#!/usr/bin/env python3
"""Reset 阿凛's bloated session (807+ messages) to restore tool-calling ability.
Telegram chat history is NOT affected - only the AI's conversation context is reset."""

import paramiko
import json
import datetime
import sys

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
CONTAINER = 'deploy-openclaw-gateway-1'
PATH = 'export PATH=/usr/local/bin:/usr/bin:/bin'
SESSIONS_DIR = '/home/node/.openclaw/agents/main/sessions'
TARGET_SESSION = 'cc880d45-0d6b-4378-908d-9053e0c7c681'
TARGET_KEY = 'agent:main:telegram:dm:6564284621'

def ssh_cmd(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    client.close()
    return out.strip(), err.strip()

def docker_cmd(cmd):
    return ssh_cmd(f'{PATH} && docker exec {CONTAINER} {cmd}')

# Step 1: Check current session size
print("Step 1: Checking current session...")
out, _ = docker_cmd(f'wc -l {SESSIONS_DIR}/{TARGET_SESSION}.jsonl')
print(f"  Lines: {out}")
out, _ = docker_cmd(f'wc -c {SESSIONS_DIR}/{TARGET_SESSION}.jsonl')
print(f"  Size: {out}")

# Step 2: Backup the session file
ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H-%M-%S.000Z')
backup_name = f'{TARGET_SESSION}.jsonl.deleted.{ts}'
print(f"\nStep 2: Backing up session to {backup_name}...")
out, err = docker_cmd(f'cp {SESSIONS_DIR}/{TARGET_SESSION}.jsonl {SESSIONS_DIR}/{backup_name}')
if err:
    print(f"  Error: {err}")
    sys.exit(1)
print("  Backup created.")

# Step 3: Read sessions.json, remove the target entry
print("\nStep 3: Updating sessions.json...")
ssh_cmd(f'{PATH} && docker cp {CONTAINER}:{SESSIONS_DIR}/sessions.json /tmp/sessions.json')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)
sftp = client.open_sftp()

with sftp.open('/tmp/sessions.json', 'r') as f:
    data = json.load(f)

if TARGET_KEY in data:
    old_entry = data[TARGET_KEY]
    print(f"  Found entry: sessionId={old_entry.get('sessionId')}")
    del data[TARGET_KEY]
    print(f"  Removed entry from sessions.json")
else:
    print(f"  WARNING: Key {TARGET_KEY} not found!")

with sftp.open('/tmp/sessions_new.json', 'w') as f:
    json.dump(data, f)

sftp.close()
client.close()

# Copy updated sessions.json back into container
ssh_cmd(f'{PATH} && docker cp /tmp/sessions_new.json {CONTAINER}:{SESSIONS_DIR}/sessions.json')
print("  sessions.json updated in container.")

# Step 4: Remove the old session file
print(f"\nStep 4: Removing old session file...")
out, err = docker_cmd(f'rm {SESSIONS_DIR}/{TARGET_SESSION}.jsonl')
if err:
    print(f"  Error: {err}")
else:
    print("  Old session file removed.")

# Step 5: Verify
print(f"\nStep 5: Verifying...")
out, _ = docker_cmd(f'ls -la {SESSIONS_DIR}/{TARGET_SESSION}*')
print(f"  Remaining files: {out}")

# Check sessions.json no longer has the key
ssh_cmd(f'{PATH} && docker cp {CONTAINER}:{SESSIONS_DIR}/sessions.json /tmp/sessions_verify.json')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)
sftp = client.open_sftp()
with sftp.open('/tmp/sessions_verify.json', 'r') as f:
    verify = json.load(f)
sftp.close()
client.close()

if TARGET_KEY in verify:
    print(f"  WARNING: Key still exists in sessions.json!")
else:
    print(f"  Confirmed: {TARGET_KEY} removed from sessions.json")

print(f"\nDone! Next message from Telegram DM 6564284621 will create a fresh session.")
print("Telegram chat history is unaffected.")
