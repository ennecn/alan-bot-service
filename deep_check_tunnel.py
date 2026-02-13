#!/usr/bin/env python3
"""Deep Check Tunnel"""
import paramiko

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def deep_check():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- 1. Check Process listening on 18789 ---")
    # netstat might be better if lsof missing
    cmd = "netstat -tulnp | grep 18789"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())
    
    print("\n--- 2. Cat Tunnel Log (Start) ---")
    cmd = "cat /root/openclaw/tunnel.log | head -n 30"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())

    # also check if 8045 is tunnel target
    print("\n--- 3. Cat Cloudflared Args ---")
    cmd = "ps aux | grep cloudflared"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())

    client.close()

if __name__ == '__main__':
    deep_check()
