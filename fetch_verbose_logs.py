#!/usr/bin/env python3
"""Fetch verbose logs with [DEBUG] tags."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def fetch_logs():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("Fetching last 500 lines...")
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker logs --tail 500 deploy-openclaw-gateway-1'
    stdin, stdout, stderr = client.exec_command(cmd)
    
    log_lines = stdout.read().decode('utf-8', errors='replace').split('\n')
    
    print("--- FILTERED LOGS ([DEBUG] or tool_use) ---")
    for line in log_lines:
        if '[DEBUG]' in line or 'tool_use' in line or 'tool_result' in line:
             # truncate very long lines for display
             if len(line) > 2000:
                 print(line[:2000] + "... [TRUNCATED]")
             else:
                 print(line)
                 
    client.close()

if __name__ == '__main__':
    fetch_logs()
