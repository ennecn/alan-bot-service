#!/usr/bin/env python3
"""Check Tunnel URL"""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def check_url():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    url = "https://encountered-cholesterol-dealer-minister.trycloudflare.com/"
    print(f"--- Checking {url} ---")
    cmd = f"curl -I -s -w '%{{http_code}}' {url} --max-time 5"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())

    client.close()

if __name__ == '__main__':
    check_url()
