#!/usr/bin/env python3
"""Benchmark du command in container."""
import paramiko
import time

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def benchmark():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    print("--- Running du benchmark ---")
    start = time.time()
    # Same command the bot used
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker exec deploy-openclaw-gateway-1 bash -c "time du -sh /home/node/.openclaw/workspace/clawhive-market* && ls -la /home/node/.openclaw/workspace/ | grep clawhive"'
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    end = time.time()
    
    print(f"Time taken (Client side): {end - start:.2f}s")
    print(f"Output:\n{out}")
    print(f"Stderr (time output):\n{err}")
    
    client.close()

if __name__ == '__main__':
    benchmark()
