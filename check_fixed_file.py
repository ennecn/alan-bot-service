#!/usr/bin/env python3
"""Check for test-all-fixed.txt"""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def check_file():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- Checking test-all-fixed.txt inside container ---")
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker exec deploy-openclaw-gateway-1 ls -l /mnt/nas/shared/test-all-fixed.txt'
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"CONTAINER: {out}")
    else:
        print(f"CONTAINER: Not found ({err})")

    print("\n--- Checking test-all-fixed.txt on Host ---")
    cmd = 'ls -l /tmp/nas/shared/test-all-fixed.txt'
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    if out:
        print(f"HOST: {out}")
    else:
        print("HOST: Not found")
        
    client.close()

if __name__ == '__main__':
    check_file()
