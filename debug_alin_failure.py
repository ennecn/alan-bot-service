#!/usr/bin/env python3
"""Fetch detailed tool use logs to see arguments and results."""
import paramiko
import re

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def get_detailed_logs():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)

    # Get last 300 lines to cover the conversation
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker logs --tail 300 deploy-openclaw-gateway-1'
    stdin, stdout, stderr = client.exec_command(cmd)
    
    log_content = stdout.read().decode('utf-8', errors='replace')
    client.close()

    # Look for tool usage blocks. 
    # OpenClaw logs usually show: 
    # [Proxy] Detected tool_use: ...
    # [Proxy] Request Body: ... (might contain the tool args)
    # [Proxy] Received from upstream: ...
    
    print("--- SEARCHING FOR 'test20.txt' OR RELEVANT TOOL CALLS ---")
    
    lines = log_content.split('\n')
    context_lines = []
    
    for i, line in enumerate(lines):
        # Capture context around tool usage
        if 'tool_use' in line or 'test20.txt' in line:
            print(f"LINE {i}: {line.strip()}")
            # Print a few lines around it for context
            start = max(0, i - 5)
            end = min(len(lines), i + 10)
            for j in range(start, end):
                 if j != i: # Don't print the matched line again
                    print(f"  CTX {j}: {lines[j].strip()}")
            print("-" * 40)

if __name__ == '__main__':
    get_detailed_logs()
