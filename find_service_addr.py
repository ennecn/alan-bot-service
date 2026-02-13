#!/usr/bin/env python3
"""Find Service Address"""
import paramiko

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def find_addr():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- 1. Check Cloudflared ---")
    cmd = "ps aux | grep cloudflared | grep -v grep"
    stdin, stdout, stderr = client.exec_command(cmd)
    cf_out = stdout.read().decode().strip()
    if cf_out:
        print(f"Running: {cf_out}")
        # Try to find config
        cmd = "find /etc/cloudflared -name '*.yml' -o -name '*.json' 2>/dev/null"
        stdin, stdout, stderr = client.exec_command(cmd)
        print("Configs:\n" + stdout.read().decode().strip())
    else:
        print("Cloudflared not running.")

    print("\n--- 2. Check Nginx ---")
    cmd = "ps aux | grep nginx | grep -v grep"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip() or "Nginx not running.")

    print("\n--- 3. Check Caddy ---")
    cmd = "ps aux | grep caddy | grep -v grep"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip() or "Caddy not running.")

    client.close()

if __name__ == '__main__':
    find_addr()
