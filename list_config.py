#!/usr/bin/env python3
"""List Antigravity Config Dir"""
import paramiko

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def list_config():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- Listing /root/.antigravity_tools ---")
    cmd = "ls -la /root/.antigravity_tools"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())
    
    # Also check subdirectory if any
    print("\n--- Recursive ---")
    cmd = "ls -R /root/.antigravity_tools"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())

    client.close()

if __name__ == '__main__':
    list_config()
