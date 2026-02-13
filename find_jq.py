#!/usr/bin/env python3
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Find jq
cmds = ['which jq', 'find /opt/homebrew -name jq -type f 2>/dev/null', 'find /usr -name jq -type f 2>/dev/null']
for cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    if out:
        print(f"[{cmd}] → {out}")

client.close()
