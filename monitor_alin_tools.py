#!/usr/bin/env python3
"""Live monitor Alin's logs for tool use events."""
import paramiko
import sys
import time
import re

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def monitor_logs():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    print(f"Connecting to {HOST}...")
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("Tailing logs for 'deploy-openclaw-gateway-1'...")
    # Using stdbuf to unbuffer output if available, otherwise just rely on docker's streaming
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker logs -f --tail 0 deploy-openclaw-gateway-1'
    
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True)
    
    # regex for relevant keywords
    pattern = re.compile(r'(tool_use|tool_result|call_tool|<tool_code>)', re.IGNORECASE)
    
    try:
        iterator = iter(stdout.readline, "")
        for line in iterator:
            if pattern.search(line):
                print(line.strip())
                # Start tracking a block of context if needed
    except KeyboardInterrupt:
        print("\nStopping monitor...")
    except Exception as e:
        print(f"\nError: {e}")
    finally:
        client.close()

if __name__ == '__main__':
    monitor_logs()
