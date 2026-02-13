#!/usr/bin/env python3
"""Verify Update"""
import paramiko
import time

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def verify():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- 1. Check Logs for Version ---")
    # Antigravity logs version on startup usually
    cmd = "docker logs antigravity-manager 2>&1 | head -n 20"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())
    
    print("\n--- 2. Check API ---")
    # Wait a bit for startup
    time.sleep(5)
    cmd = "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8045/v1/models"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(f"Local HTTP: {stdout.read().decode().strip()}")
    
    client.close()

if __name__ == '__main__':
    verify()
