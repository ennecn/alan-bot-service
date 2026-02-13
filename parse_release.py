#!/usr/bin/env python3
"""Parse Release JSON"""
import json
import paramiko

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def parse_release():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- Reading JSON ---")
    cmd = "cat /tmp/release_v4.1.12.json"
    stdin, stdout, stderr = client.exec_command(cmd)
    try:
        data = json.loads(stdout.read().decode().strip())
        print("Assets:")
        for asset in data.get('assets', []):
            print(f"- {asset.get('name')}: {asset.get('browser_download_url')}")
    except Exception as e:
        print(f"Error parsing JSON: {e}")
        print(stdout.read().decode()) # Print raw if fail

    client.close()

if __name__ == '__main__':
    parse_release()
