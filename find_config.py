#!/usr/bin/env python3
"""Find openclaw.json path inside containers."""
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

containers = ["deploy-openclaw-gateway-1", "lain-gateway", "lumi-gateway", "aling-gateway"]

for container in containers:
    print(f"\n=== {container} ===")
    cmd = f'/usr/local/bin/docker exec {container} find / -name "openclaw.json" -not -path "*/node_modules/*" 2>/dev/null'
    si, so, se = c.exec_command(cmd)
    out = so.read().decode().strip()
    print(f"  paths: {out}")

c.close()
