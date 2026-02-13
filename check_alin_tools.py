#!/usr/bin/env python3
"""Fetch recent logs from Alin to check for tool usage."""
import paramiko
import re

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def check_logs():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    print(f"Connecting to {HOST}...")
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("Fetching last 200 lines from 'deploy-openclaw-gateway-1'...")
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker logs --tail 200 deploy-openclaw-gateway-1'
    
    stdin, stdout, stderr = client.exec_command(cmd)
    
    # regex for relevant keywords
    pattern = re.compile(r'(tool_use|tool_result|call_tool|<tool_code>)', re.IGNORECASE)
    
    found = False
    for line in stdout:
        if pattern.search(line):
            print(line.strip())
            found = True
            
    if not found:
        print("No tool use events found in the last 200 lines.")
        
    client.close()

if __name__ == '__main__':
    check_logs()
