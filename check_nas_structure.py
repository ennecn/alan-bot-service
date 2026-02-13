#!/usr/bin/env python3
"""Check NAS directory structure."""
import paramiko
import sys

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def check_structure():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- 1. List /mnt/nas inside container ---")
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker exec deploy-openclaw-gateway-1 ls -la /mnt/nas'
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(out)
    else:
        print(f"Error listing container path: {err}")

    print("\n--- 2. List /tmp/nas on Host ---")
    cmd = 'ls -la /tmp/nas'
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(out)
    else:
        print(f"Error listing host path: {err}")
        
    client.close()

if __name__ == '__main__':
    check_structure()
