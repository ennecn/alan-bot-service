#!/usr/bin/env python3
"""Quick NFS checks with proper timeout handling."""
import paramiko
import threading
import sys

def run_with_timeout(client, cmd, timeout_sec=8):
    """Run SSH command with a hard timeout."""
    result = {"out": "", "err": "", "done": False}
    def worker():
        try:
            stdin, stdout, stderr = client.exec_command(cmd)
            result["out"] = stdout.read().decode()
            result["err"] = stderr.read().decode()
        except Exception as e:
            result["err"] = str(e)
        result["done"] = True
    t = threading.Thread(target=worker)
    t.daemon = True
    t.start()
    t.join(timeout_sec)
    if not result["done"]:
        return "[TIMED OUT]", ""
    return result["out"], result["err"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

checks = [
    ("showmount -e 192.168.21.135", "NFS Exports", 8),
    ("rpcinfo -p 192.168.21.135", "RPC Services", 8),
    ("showmount -a 192.168.21.135", "NFS Active Mounts", 8),
    ("mount_nfs 2>&1 | head -5", "mount_nfs usage", 5),
    ("mkdir -p /tmp/nfs_test && echo 'YYZZ54321!' | sudo -S mount -t nfs 192.168.21.135:/volume1/aling /tmp/nfs_test 2>&1 && ls /tmp/nfs_test | head -10 && echo 'YYZZ54321!' | sudo -S umount /tmp/nfs_test", "NFS Mount Test /volume1/aling", 10),
    ("echo 'YYZZ54321!' | sudo -S showmount -e 192.168.21.135", "showmount as root", 8),
]

for cmd, label, timeout in checks:
    print(f"\n{'='*50}")
    print(f"  {label}")
    print(f"{'='*50}")
    print(f"$ {cmd}\n")
    out, err = run_with_timeout(client, cmd, timeout)
    if out.strip():
        lines = [l for l in out.splitlines() if "Password:" not in l]
        print("\n".join(lines))
    if err.strip():
        lines = [l for l in err.splitlines() if "Password:" not in l]
        if lines:
            print(f"[STDERR] {chr(10).join(lines)}")

client.close()
print("\nDone.")
