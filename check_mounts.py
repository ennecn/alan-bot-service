#!/usr/bin/env python3
"""Check all mounts for the container."""
import paramiko
import json

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def check_mounts():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("Checking mounts for deploy-openclaw-gateway-1...")
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker inspect -f "{{json .Mounts}}" deploy-openclaw-gateway-1'
    stdin, stdout, stderr = client.exec_command(cmd)
    output = stdout.read().decode().strip()
    
    try:
        mounts = json.loads(output)
        for m in mounts:
            print(f"Source: {m['Source']} -> Dest: {m['Destination']} (Type: {m['Type']})")
            if 'api-proxy.js' in m['Destination']:
                print(f"!!! FOUND IT: {m['Source']}")
    except Exception as e:
        print(f"Error parsing JSON: {e}")
        print(output)

    client.close()

if __name__ == '__main__':
    check_mounts()
