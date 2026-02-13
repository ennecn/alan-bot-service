#!/usr/bin/env python3
"""Locate mcp_exec implementation."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def locate_mcp():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- Searching for mcp related files ---")
    # Search for files containing "mcp_exec" or just "exec" in node_modules
    # It might be in a package like @modelcontextprotocol/server-filesystem or similar
    # Or OpenClaw's own implementation.
    
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker exec deploy-openclaw-gateway-1 find /app/node_modules -name "*mcp*" | head -20'
    stdin, stdout, stderr = client.exec_command(cmd)
    print("MCP Packages:")
    print(stdout.read().decode().strip())
    
    # Check openclaw specific tools
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker exec deploy-openclaw-gateway-1 find /app -name "*tool*" | grep -i exec'
    stdin, stdout, stderr = client.exec_command(cmd)
    print("\nTool Exec Files:")
    print(stdout.read().decode().strip())

    client.close()

if __name__ == '__main__':
    locate_mcp()
