#!/usr/bin/env python3
import paramiko
import sys
import os

def upload_file(local_path, remote_path):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

    sftp = client.open_sftp()
    # Convert Windows path to proper format
    local_path = local_path.replace('\\', '/')
    print(f"Uploading {local_path} to {remote_path}...")
    sftp.put(local_path, remote_path)
    print("Upload complete!")
    sftp.close()
    client.close()

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python upload_to_macmini.py <local_path> <remote_path>")
        sys.exit(1)
    upload_file(sys.argv[1], sys.argv[2])
