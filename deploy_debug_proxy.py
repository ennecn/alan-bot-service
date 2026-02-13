#!/usr/bin/env python3
"""Deploy patched api-proxy.js to Alin container."""
import paramiko
import os

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
LOCAL_FILE = 'api-proxy.js'
REMOTE_TEMP = '/tmp/api-proxy-debug.js'
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

    # 1. Upload file
    print(f"Uploading {LOCAL_FILE} to {REMOTE_TEMP}...")
    sftp = client.open_sftp()
    sftp.put(LOCAL_FILE, REMOTE_TEMP)
    sftp.close()

    # 2. Copy to container and restart
    print(f"Copying to container {CONTAINER}...")
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker cp {REMOTE_TEMP} {CONTAINER}:/home/node/api-proxy.js && docker restart {CONTAINER}'
    
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    
    if err:
        print(f"Error during deployment: {err}")
    else:
        print(f"Success! Container {CONTAINER} restarted.")
        print(out)
        
    client.close()

if __name__ == '__main__':
    deploy()
