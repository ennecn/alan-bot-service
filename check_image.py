#!/usr/bin/env python3
"""Check Image Name"""
import paramiko

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'

def check_image():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    cmd = "docker inspect antigravity-manager --format '{{.Config.Image}}'"
    stdin, stdout, stderr = client.exec_command(cmd)
    print(f"Image: {stdout.read().decode().strip()}")

    client.close()

if __name__ == '__main__':
    check_image()
