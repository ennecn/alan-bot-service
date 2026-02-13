#!/usr/bin/env python3
"""Update Antigravity Force"""
import paramiko
import time

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def update_force():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- Stopping old container (Force) ---")
    # Using ; to ensure commands run sequentially in one session if needed, 
    # but paramiko exec_command opens new channel each time.
    # The previous script might have failed because exec_command returns immediately? 
    # No, it waits for channel... wait, successful exec_command returns (stdin, stdout, stderr). 
    # I didn't wait for exit status in the previous script for stop/rm.
    
    stdin, stdout, stderr = client.exec_command("docker stop antigravity-manager")
    stdout.channel.recv_exit_status() # Wait
    
    stdin, stdout, stderr = client.exec_command("docker rm antigravity-manager")
    stdout.channel.recv_exit_status() # Wait
    
    print("--- Running new container ---")
    run_cmd = (
        "docker run -d --name antigravity-manager "
        "--restart unless-stopped "
        "-p 8045:8045 "
        "-v /root/.antigravity_tools:/root/.antigravity_tools "
        "-e API_KEY=sk-antigravity-openclaw "
        "-e WEB_PASSWORD=openclaw2026admin "
        "-e RUST_LOG=info "
        "-e TZ=Asia/Shanghai "
        "lbjlaq/antigravity-manager:v4.1.12"
    )
    stdin, stdout, stderr = client.exec_command(run_cmd)
    exit_status = stdout.channel.recv_exit_status()
    if exit_status != 0:
        print(f"Run failed: {stderr.read().decode()}")
    else:
        print(f"New container ID: {stdout.read().decode().strip()}")
        
    client.close()

if __name__ == '__main__':
    update_force()
