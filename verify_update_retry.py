#!/usr/bin/env python3
"""Verify Update Retry"""
import paramiko
import time

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def verify_retry():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- 2. Check API (Retry via Local Curl) ---")
    # Wait longer
    time.sleep(10)
    cmd = "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8045/v1/models"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(f"Local HTTP: {stdout.read().decode().strip()}")
    
    # Also check from EXTERNAL via Mac Mini
    # This confirms firewall/tunnel isn't blocking
    print("\n--- 3. Check External Access (Mac Mini) ---")
    # This part runs on Mac Mini
    # But I can't easily trigger Mac Mini unless I SSH to it.
    # Ah, I have `ssh_macmini.py` context from previous turn but that script is long running?
    # No, I can write a quick script to SSH to Mac Mini and curl the VPS.
    
    client.close()

if __name__ == '__main__':
    verify_retry()
