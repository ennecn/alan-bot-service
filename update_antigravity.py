#!/usr/bin/env python3
"""Update Antigravity"""
import paramiko
import time

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def update():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    # 1. Inspect old container to get run args
    print("--- Inspecting old container ---")
    inspect_cmd = "docker inspect antigravity-manager"
    stdin, stdout, stderr = client.exec_command(inspect_cmd)
    # We know the binds and ports from previous check, but let's be safe.
    # Actually, simplistic approach: stop, rm, run with known consistent params from check_antigravity_detail.py
    # Binds: /root/.antigravity_tools:/root/.antigravity_tools
    # Env: API_KEY=..., WEB_PASSWORD=..., PORT=8045
    # Ports: 8045:8045
    
    # 2. Pull new image
    print("--- Pulling v4.1.12 ---")
    cmd = "docker pull lbjlaq/antigravity-manager:v4.1.12"
    stdin, stdout, stderr = client.exec_command(cmd)
    exit_status = stdout.channel.recv_exit_status()
    if exit_status != 0:
        print(f"Pull failed: {stderr.read().decode()}")
        return
    print(stdout.read().decode())

    # 3. Stop and Remove old
    print("--- Stopping old container ---")
    client.exec_command("docker stop antigravity-manager")
    client.exec_command("docker rm antigravity-manager")
    
    # 4. Run new
    # Note: Using same env vars as discovered
    print("--- Running new container ---")
    run_cmd = (
        "docker run -d --name antigravity-manager "
        "--restart unless-stopped "
        "-p 8045:8045 "
        "-v /root/.antigravity_tools:/root/.antigravity_tools "
        "-e API_KEY=sk-antigravity-openclaw "
        "-e WEB_PASSWORD=openclaw2026admin "
        "-e RUST_LOG=info "
        "-e TZ=Asia/Shanghai "  # Good practice
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
    update()
