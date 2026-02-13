#!/usr/bin/env python3
"""Check if Alin wrote to container FS and verify NAS mounts."""
import paramiko
import json
import sys

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def run_checks():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print(f"Connecting to {HOST}...")
        client.connect(HOST, username=USER, password=PASS)
    except Exception as e:
        print(f"SSH Failed: {e}")
        return

    print("\n--- 1. Check file inside container ---")
    # Check if the file exists inside the container's /mnt/nas/shared/test20.txt
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker exec deploy-openclaw-gateway-1 ls -l /mnt/nas/shared/test20.txt'
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    
    if out:
        print(f"FOUND IN CONTAINER: {out}")
        print(">> HYPOTHESIS CONFIRMED: File exists inside container but likely not on NAS.")
    else:
        print(f"Not found in container: {err}")

    print("\n--- 2. Check Container Mounts ---")
    cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker inspect -f "{{json .Mounts}}" deploy-openclaw-gateway-1'
    stdin, stdout, stderr = client.exec_command(cmd)
    mounts_json = stdout.read().decode().strip()
    try:
        mounts = json.loads(mounts_json)
        nas_mount = next((m for m in mounts if '/mnt/nas' in m['Destination']), None)
        if nas_mount:
            print(f"NAS Mount Found: {json.dumps(nas_mount, indent=2)}")
        else:
            print(">> MISSING MOUNT: No mount point found for /mnt/nas inside container.")
            print("Current mounts:")
            for m in mounts:
                print(f" - {m['Source']} -> {m['Destination']}")
    except:
        print(f"Failed to parse mounts: {mounts_json}")

    print("\n--- 3. Check Host Mounts ---")
    cmd = 'mount | grep -i nas'
    stdin, stdout, stderr = client.exec_command(cmd)
    host_mounts = stdout.read().decode().strip()
    if host_mounts:
        print(f"Host Mounts:\n{host_mounts}")
    else:
        print(">> No NAS mounts found on Host (Mac Mini).")

    client.close()

if __name__ == '__main__':
    run_checks()
