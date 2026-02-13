#!/usr/bin/env python3
"""Read mcp_exec source code."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def read_source():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- Reading /app/src/agents/bash-tools.exec.ts (first 300 lines) ---")
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker exec deploy-openclaw-gateway-1 cat /app/src/agents/bash-tools.exec.ts | head -n 300'
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode('utf-8', errors='replace'))

    client.close()

if __name__ == '__main__':
    read_source()
