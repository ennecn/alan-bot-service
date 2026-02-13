#!/usr/bin/env python3
"""Check Binary Type"""
import paramiko

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def check_bin():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- Check Binary Type ---")
    cmd = "docker exec antigravity-manager file /app/antigravity-tools"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())
    
    # Also check if curl can find the assets
    print("\n--- Listing Assets via API ---")
    # GitHub API might be rate limited but worth a try to see filenames
    cmd = "curl -s https://api.github.com/repos/lbjlaq/Antigravity-Manager/releases/tags/v4.1.12 | grep name"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip()[:1000]) # Limit output

    client.close()

if __name__ == '__main__':
    check_bin()
