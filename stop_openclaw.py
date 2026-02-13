#!/usr/bin/env python3
"""Stop OpenClaw Only"""
import paramiko

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def stop_openclaw():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- Stopping OpenClaw Container ---")
    cmd = "docker stop openclaw-openclaw-gateway-1"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())
    
    print("\n--- Verify Stopped ---")
    cmd = "docker ps --format '{{.Names}} {{.Status}}'"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())

    client.close()

if __name__ == '__main__':
    stop_openclaw()
