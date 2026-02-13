#!/usr/bin/env python3
"""Deploy patched api-proxy.js to Host (bind mount) and restart container."""
import paramiko
import os

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
LOCAL_FILE = 'api-proxy.js'
REMOTE_PATH = '/Users/fangjin/Desktop/p/docker-openclawd/deploy/api-proxy.js'
REMOTE_BAK = '/Users/fangjin/Desktop/p/docker-openclawd/deploy/api-proxy.js.bak'
CONTAINER = 'deploy-openclaw-gateway-1'

def deploy():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print(f"Connecting to {HOST}...")
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    # 1. Backup if not exists
    print(f"Checking backup at {REMOTE_BAK}...")
    cmd = f'ls {REMOTE_BAK} || cp {REMOTE_PATH} {REMOTE_BAK}'
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode())
    
    # 2. Upload file (SFTP)
    print(f"Uploading {LOCAL_FILE} to {REMOTE_PATH}...")
    sftp = client.open_sftp()
    sftp.put(LOCAL_FILE, REMOTE_PATH)
    sftp.close()

    # 3. Restart container
    print(f"Restarting container {CONTAINER}...")
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker restart {CONTAINER}'
    
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    
    if err:
        print(f"Error during restart: {err}")
    else:
        print(f"Success! Container {CONTAINER} restarted.")
        print(out)
        
    client.close()

if __name__ == '__main__':
    deploy()
