#!/usr/bin/env python3
"""Verify patch status and container execution details."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def verify_patch():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- 1. Check container ENTRYPOINT/CMD ---")
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker inspect -f "Entrypoint: {{.Config.Entrypoint}} Cmd: {{.Config.Cmd}} Env: {{.Config.Env}}" deploy-openclaw-gateway-1'
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())

    print("\n--- 2. Check running processes ---")
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker exec deploy-openclaw-gateway-1 ps aux'
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())

    print("\n--- 3. Check /app/api-proxy.js content (first 120 lines) ---")
    # Check if my logFull function exists
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker exec deploy-openclaw-gateway-1 head -n 120 /app/api-proxy.js'
    stdin, stdout, stderr = client.exec_command(cmd)
    content = stdout.read().decode().strip()
    if 'function logFull' in content:
        print("SUCCESS: Patch found in /app/api-proxy.js")
    else:
        print("FAILURE: Patch NOT found in /app/api-proxy.js")
        print(content[:500]) # print start of file to see what's there

    client.close()

if __name__ == '__main__':
    verify_patch()
