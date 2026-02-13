#!/usr/bin/env python3
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    'find /usr/local/bin -name docker -type f 2>/dev/null',
    'find /opt -name docker -type f 2>/dev/null',
    'find /Applications -name docker -type f 2>/dev/null',
    'ls -la /usr/local/bin/docker* 2>/dev/null',
    'ls -la ~/.docker/bin/docker 2>/dev/null',
    'mdfind -name docker 2>/dev/null | grep -i bin | head -5',
]
for cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    if out:
        print(f"[{cmd}]\n{out}\n")

client.close()
