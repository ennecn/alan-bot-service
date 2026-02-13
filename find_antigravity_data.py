#!/usr/bin/env python3
"""Find Antigravity Data"""
import paramiko

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def find_data():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- Listing /root on VPS ---")
    cmd = "ls -la /root"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())
    
    print("\n--- Listing /app inside container ---")
    cmd = "docker exec antigravity-manager ls -la /app"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())

    # Check binds 
    print("\n--- Checking Binds ---")
    cmd = "docker inspect antigravity-manager --format '{{json .HostConfig.Binds}}'"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())

    client.close()

if __name__ == '__main__':
    find_data()
