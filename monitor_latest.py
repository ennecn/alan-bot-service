#!/usr/bin/env python3
"""Monitor for the latest request."""
import paramiko
import time

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def monitor():
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
    
    # Find the last "Request Body"
    last_request_idx = -1
    for i, line in enumerate(log_lines):
        if '[DEBUG] Request Body' in line:
            last_request_idx = i
            
    if last_request_idx != -1:
        print(f"Found latest Request Body at line {last_request_idx}")
        # Print the request body (truncated) and everything after it
        print(log_lines[last_request_idx][:200] + "...")
        print("--- Logs after latest request ---")
        for line in log_lines[last_request_idx+1:]:
             if '[DEBUG]' in line or 'tool_use' in line or 'tool_result' in line:
                 print(line[:500]) # slight truncation for readability
    else:
        print("No Request Body found in last 500 lines.")

    client.close()

if __name__ == '__main__':
    monitor()
