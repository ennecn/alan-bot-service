#!/usr/bin/env python3
"""Kill stuck mcp_process sessions."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def clean_sessions():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    # Check for running 'du' or 'sh' processes launched by mcp
    # The container uses `mcp_exec` which spawns `sh -c ...`
    # We can kill them.
    
    print("--- Listing processes ---")
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker exec deploy-openclaw-gateway-1 ps aux | grep "du -sh"'
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    print(out)
    
    if out:
        print("--- Killing stuck processes ---")
        # Kill all `du` processes
        cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker exec deploy-openclaw-gateway-1 pkill du'
        stdin, stdout, stderr = client.exec_command(cmd)
        print("Sent pkill signal.")
        
        # Verify
        cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker exec deploy-openclaw-gateway-1 ps aux | grep du'
        stdin, stdout, stderr = client.exec_command(cmd)
        print("Remaining processes:")
        print(stdout.read().decode().strip())
    else:
        print("No stuck 'du' processes found.")

    client.close()

if __name__ == '__main__':
    clean_sessions()
