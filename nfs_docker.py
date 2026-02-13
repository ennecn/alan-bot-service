#!/usr/bin/env python3
"""Check Docker containers and NAS mounts."""
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

cmds = [
    "export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH; docker ps --format '{{.Names}}'",
    "which docker || echo 'docker not in default PATH'",
    "/usr/local/bin/docker ps --format '{{.Names}}' 2>/dev/null || /opt/homebrew/bin/docker ps --format '{{.Names}}' 2>/dev/null || echo 'docker not found'",
]

for cmd in cmds:
    print(f"$ {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=10)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(f"[ERR] {err.rstrip()}")
    print()

client.close()
