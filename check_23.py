#!/usr/bin/env python3
"""Check test23.txt"""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def check_23():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- Listing /tmp/nas/shared/test23.txt on Host ---")
    cmd = 'ls -l /tmp/nas/shared/test23.txt'
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    if out:
        print(f"HOST: {out}")
    else:
        print("HOST: Not found")
        
    client.close()

if __name__ == '__main__':
    check_23()
