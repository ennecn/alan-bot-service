#!/usr/bin/env python3
"""Get Antigravity Env Vars"""
import paramiko
import json

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def get_env():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- Fetching Env Vars ---")
    cmd = "docker inspect antigravity-manager --format '{{json .Config.Env}}'"
    stdin, stdout, stderr = client.exec_command(cmd)
    
    try:
        env_json = stdout.read().decode().strip()
        env_list = json.loads(env_json)
        for e in env_list:
            if 'ACCOUNT' in e or 'KEY' in e or 'TOKEN' in e or 'PROX' in e:
                print(e)
            # Also print all just in case
        print("\n--- Full Env (formatted) ---")
        print(json.dumps(env_list, indent=2))
        
    except Exception as e:
        print(f"Error parsing JSON: {e}")
        print(env_json)

    client.close()

if __name__ == '__main__':
    get_env()
