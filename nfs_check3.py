#!/usr/bin/env python3
"""Final NFS investigation - UGREEN DXP4800 NFS status."""
import paramiko
import threading

def run_with_timeout(client, cmd, timeout_sec=8):
    result = {"out": "", "err": "", "done": False}
    def worker():
        try:
            stdin, stdout, stderr = client.exec_command(cmd)
            result["out"] = stdout.read().decode()
            result["err"] = stderr.read().decode()
        except Exception as e:
            result["err"] = str(e)
        result["done"] = True
    t = threading.Thread(target=worker, daemon=True)
    t.start()
    t.join(timeout_sec)
    if not result["done"]:
        return "[TIMED OUT]", ""
    return result["out"], result["err"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

checks = [
    # Verify port 111 is truly open (TCP connect vs RPC)
    ("python3 -c \"import socket; s=socket.socket(); s.settimeout(3); r=s.connect_ex(('192.168.21.135',111)); print(f'Port 111 connect: {r} (0=open)'); s.close()\"", "Port 111 raw TCP", 5),
    ("python3 -c \"import socket; s=socket.socket(); s.settimeout(3); r=s.connect_ex(('192.168.21.135',2049)); print(f'Port 2049 connect: {r} (0=open)'); s.close()\"", "Port 2049 raw TCP", 5),
    # Try rpcinfo with TCP explicitly
    ("rpcinfo -T tcp 192.168.21.135 2>&1 || true", "rpcinfo TCP", 8),
    # Check if NAS responds to NFS null procedure
    ("rpcinfo -T tcp 192.168.21.135 nfs 2>&1 || true", "rpcinfo NFS program", 8),
    # Check UGREEN UGOS web API (common ports)
    ("curl -sk --connect-timeout 3 http://192.168.21.135:9443/ 2>&1 | head -3 || echo 'port 9443 no response'", "UGOS Web UI 9443", 5),
    ("curl -sk --connect-timeout 3 https://192.168.21.135:443/ 2>&1 | head -3 || echo 'port 443 no response'", "UGOS Web UI 443", 5),
    # Check what Docker sees for the NAS mount
    ("docker exec deploy-openclaw-gateway-1 cat /proc/mounts 2>/dev/null | grep nas || echo 'no nas in container mounts'", "Container /proc/mounts NAS", 5),
    ("docker exec deploy-openclaw-gateway-1 ls -la /mnt/nas/ 2>/dev/null | head -10 || echo 'no /mnt/nas'", "Container /mnt/nas listing", 5),
    # Check if the SMB mount is working well for Docker
    ("docker exec deploy-openclaw-gateway-1 cat /mnt/nas/hello.txt 2>/dev/null || echo 'cannot read hello.txt from container'", "Container read test", 5),
    # Performance baseline - SMB
    ("dd if=/dev/zero bs=1M count=10 2>/dev/null | dd of=/Users/fangjin/nas/.nfs_test_write bs=1M 2>&1; rm -f /Users/fangjin/nas/.nfs_test_write", "SMB write speed (10MB)", 15),
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
        lines = [l for l in err.splitlines() if "Password:" not in l and "password" not in l.lower()]
        if lines:
            print(f"[STDERR] {chr(10).join(lines)}")

client.close()
print("\nDone.")
