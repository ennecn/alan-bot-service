#!/usr/bin/env python3
"""Verify NFS mounts in all 4 OpenClaw containers."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

CONTAINERS = [
    ("alin",  "deploy-openclaw-gateway-1"),
    ("aling", "aling-gateway"),
    ("lain",  "lain-gateway"),
    ("lumi",  "lumi-gateway"),
]

def ssh_exec(client, cmd, timeout=30):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode()
    err = stderr.read().decode()
    return out, err, exit_code

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

print("=== Verifying NFS mounts ===\n")

for name, container in CONTAINERS:
    print(f"[{name}] Container: {container}")

    # List /mnt/nas
    out, err, rc = ssh_exec(client, f"/usr/local/bin/docker exec {container} ls /mnt/nas/")
    if rc == 0 and out.strip():
        files = out.strip().split('\n')[:5]
        print(f"  ls /mnt/nas/: OK ({len(out.strip().split(chr(10)))} items)")
        for f in files:
            print(f"    {f}")
    else:
        print(f"  ls /mnt/nas/: FAILED rc={rc}")
        print(f"    stdout: {out.strip()}")
        print(f"    stderr: {err.strip()}")

    # Check mount type
    out, err, rc = ssh_exec(client, f"/usr/local/bin/docker exec {container} mount")
    for line in out.split('\n'):
        if '/mnt/nas' in line:
            print(f"  mount: {line.strip()}")
            break
    else:
        print(f"  mount: /mnt/nas not found in mount output")

    # Write test
    out, err, rc = ssh_exec(client, f"/usr/local/bin/docker exec {container} touch /mnt/nas/.nfs-test-{name}")
    if rc == 0:
        print(f"  write test: OK (created .nfs-test-{name})")
    else:
        print(f"  write test: FAILED - {err.strip()}")

    # Cleanup test file
    ssh_exec(client, f"/usr/local/bin/docker exec {container} rm -f /mnt/nas/.nfs-test-{name}")
    print()

# Also inspect the Docker volumes
print("=== Docker NFS Volumes ===\n")
out, err, rc = ssh_exec(client, "/usr/local/bin/docker volume ls --format '{{.Name}}' --filter driver=local")
for line in out.strip().split('\n'):
    if 'nas' in line:
        print(f"Volume: {line}")
        out2, err2, rc2 = ssh_exec(client, f"/usr/local/bin/docker volume inspect {line}")
        print(f"  {out2.strip()[:500]}")
        print()

client.close()
