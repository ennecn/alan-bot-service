#!/usr/bin/env python3
"""Check Tunnel Log"""
import paramiko

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def check_tunnel():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- 1. Check Port 18789 ---")
    cmd = "lsof -i :18789"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip() or "Nothing on 18789 (maybe it's a target port?)")

    print("\n--- 2. Read Tunnel Log ---")
    cmd = "head -n 20 /root/openclaw/tunnel.log" # It's usually at start
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())
    
    # Also check tail just in case it restarted
    print("\n--- Tail Tunnel Log ---")
    cmd = "tail -n 10 /root/openclaw/tunnel.log"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())

    client.close()

if __name__ == '__main__':
    check_tunnel()
