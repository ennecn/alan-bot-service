#!/usr/bin/env python3
"""Download simplified config"""
import paramiko
import os

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def download_data():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    sftp = client.open_sftp()
    
    # Download accounts.json
    print("Downloading accounts.json...")
    sftp.get('/root/.antigravity_tools/accounts.json', 'accounts.json')
    
    # Download token_stats.db
    print("Downloading token_stats.db...")
    sftp.get('/root/.antigravity_tools/token_stats.db', 'token_stats.db')
    
    sftp.close()
    client.close()
    print("Download complete.")

if __name__ == '__main__':
    download_data()
