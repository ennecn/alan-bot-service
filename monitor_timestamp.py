#!/usr/bin/env python3
"""Monitor for recent logs."""
import paramiko

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

    print("Fetching last 1000 lines...")
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker logs --tail 1000 deploy-openclaw-gateway-1'
    stdin, stdout, stderr = client.exec_command(cmd)
    
    log_lines = stdout.read().decode('utf-8', errors='replace').split('\n')
    
    found_new = False
    for line in log_lines:
        # Check for timestamp later than 14:10 (just to be safe)
        # Format: [2026-02-10T14:xx:xx
        # or in text: 2026-02-10 14:xx UTC
        if '2026-02-10' in line and ('14:1' in line or '14:2' in line or '14:3' in line):
             print(f"FOUND RECENT LINE: {line[:200]}")
             found_new = True
             
    if not found_new:
        print("No recent timestamps found (checked 14:10+).")

    client.close()

if __name__ == '__main__':
    monitor()
