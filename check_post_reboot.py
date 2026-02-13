#!/usr/bin/env python3
"""Check VPS Services Post-Reboot"""
import paramiko

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def check_services():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- 1. Check Docker Containers ---")
    # List running containers
    cmd = "docker ps --format '{{.Names}} {{.Image}} {{.Status}}'"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip())

    print("\n--- 2. Check Antigravity (Port 8045) ---")
    cmd = "netstat -tulnp | grep 8045"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip() or "Port 8045 not listening")

    print("\n--- 3. Check Cloudflared process ---")
    cmd = "ps aux | grep cloudflared | grep -v grep"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip() or "Cloudflared not running")

    print("\n--- 4. Check OpenClaw (Should be STOPPED) ---")
    # Check if openclaw container exists and is running
    cmd = "docker ps -a --filter 'name=openclaw' --format '{{.Names}} {{.Status}}'"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip() or "No OpenClaw container found")
    
    # Also check if any rogue process
    cmd = "ps aux | grep openclaw | grep -v grep"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode().strip() or "No OpenClaw processes found")

    client.close()

if __name__ == '__main__':
    check_services()
