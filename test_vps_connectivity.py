#!/usr/bin/env python3
"""Test connection to VPS"""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def test_conn():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- Testing connection to VPS:8045 ---")
    cmd = "curl -s -o /dev/null -w '%{http_code}' http://138.68.44.141:8045/v1/models --max-time 5"
    stdin, stdout, stderr = client.exec_command(cmd)
    code = stdout.read().decode().strip()
    print(f"HTTP Code: {code}")

    client.close()

if __name__ == '__main__':
    test_conn()
