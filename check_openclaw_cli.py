#!/usr/bin/env python3
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    'which openclaw',
    'openclaw --help 2>&1 | head -30',
    'openclaw message --help 2>&1 | head -20',
    'openclaw node --help 2>&1 | head -20',
]
for cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    print(f"=== {cmd} ===")
    print(out or err or "(empty)")
    print()

client.close()
