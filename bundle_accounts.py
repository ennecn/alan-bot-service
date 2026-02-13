#!/usr/bin/env python3
"""Bundle and Download Accounts"""
import paramiko
import os

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def bundle_download():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("Bundling accounts...")
    # Tar the accounts directory
    cmd = "tar -czf /tmp/accounts.tar.gz -C /root/.antigravity_tools/accounts ."
    client.exec_command(cmd)
    
    print("Downloading accounts.tar.gz...")
    sftp = client.open_sftp()
    sftp.get('/tmp/accounts.tar.gz', 'accounts.tar.gz')
    sftp.close()
    
    # Cleanup
    client.exec_command("rm /tmp/accounts.tar.gz")
    client.close()
    print("Download complete.")

if __name__ == '__main__':
    bundle_download()
