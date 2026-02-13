#!/usr/bin/env python3
"""Investigate NFS support on NAS (192.168.21.135) via Mac Mini SSH."""
import paramiko
import sys
import time
import socket

NAS_IP = "192.168.21.135"
PASSWORD = "YYZZ54321!"

def ssh_cmd(client, cmd, label=None, sudo=False, cmd_timeout=12):
    if label:
        print(f"\n{'='*60}")
        print(f"  {label}")
        print(f"{'='*60}")
    display_cmd = cmd
    if sudo:
        cmd = f"echo '{PASSWORD}' | sudo -S bash -c \"{cmd}\""
    print(f"$ {display_cmd}\n")
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=cmd_timeout)
        stdout.channel.settimeout(cmd_timeout)
        stderr.channel.settimeout(cmd_timeout)
        out = stdout.read().decode()
        err = stderr.read().decode()
    except (socket.timeout, TimeoutError):
        print("[TIMED OUT - command did not respond]")
        return "", "timeout"
    except Exception as e:
        print(f"[ERROR] {e}")
        return "", str(e)
    if out.strip():
        lines = [l for l in out.splitlines() if "Password:" not in l]
        if lines:
            print("\n".join(lines).rstrip())
    if err.strip():
        filtered = [l for l in err.splitlines()
                     if "Password:" not in l and "password" not in l.lower()]
        if filtered:
            print(f"[STDERR] {chr(10).join(filtered).rstrip()}")
    return out, err


def main():
    print("Connecting to Mac Mini (192.168.21.111)...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("192.168.21.111", username="fangjin", password=PASSWORD)
    print("Connected.\n")

    # ── 1. NAS NFS availability ──
    # Use timeout command to prevent showmount from hanging
    ssh_cmd(client, f"timeout 5 showmount -e {NAS_IP} 2>&1 || echo 'showmount failed/timed out'",
            "1a. NFS Exports on NAS")

    ssh_cmd(client, f"timeout 5 rpcinfo -p {NAS_IP} 2>&1 || echo 'rpcinfo failed/timed out'",
            "1b. NFS RPC Services on NAS")

    ssh_cmd(client, f"nc -z -w3 {NAS_IP} 111 && echo 'Port 111 (rpcbind) OPEN' || echo 'Port 111 (rpcbind) CLOSED'",
            "1c. NFS Port 111 Check")

    ssh_cmd(client, f"nc -z -w3 {NAS_IP} 2049 && echo 'Port 2049 (nfsd) OPEN' || echo 'Port 2049 (nfsd) CLOSED'",
            "1d. NFS Port 2049 Check")

    ssh_cmd(client, f"nc -z -w3 {NAS_IP} 445 && echo 'Port 445 (SMB) OPEN' || echo 'Port 445 (SMB) CLOSED'",
            "1e. SMB Port 445 Check (baseline)")

    # ── 2. Current SMB mounts ──
    ssh_cmd(client, f"mount | grep {NAS_IP} || echo 'No mounts from NAS found'",
            "2a. Current NAS Mounts")

    ssh_cmd(client, "cat ~/Library/LaunchAgents/com.fangjin.nas-mount.plist 2>/dev/null || echo 'plist not found'",
            "2b. NAS Mount LaunchAgent")

    ssh_cmd(client, "ls ~/Library/LaunchAgents/ 2>/dev/null | grep -i 'nas\\|mount' || echo 'No NAS/mount agents found'",
            "2c. NAS-related LaunchAgents")

    ssh_cmd(client, "cat /etc/auto_master 2>/dev/null || echo 'no auto_master'",
            "2d. /etc/auto_master")

    ssh_cmd(client, "cat /etc/fstab 2>/dev/null || echo 'no fstab'",
            "2e. /etc/fstab")

    # ── 3. macOS NFS client ──
    ssh_cmd(client, "which mount_nfs && echo 'mount_nfs found' || echo 'mount_nfs NOT found'",
            "3a. NFS Client Binary")

    ssh_cmd(client, "nfsstat -c 2>&1 | head -20 || echo 'nfsstat not available'",
            "3b. NFS Client Stats")

    ssh_cmd(client, "sw_vers",
            "3c. macOS Version")

    # ── 4. Test NFS mount ──
    ssh_cmd(client, "mkdir -p /tmp/nfs_test", "4a. Prepare NFS Test Dir")

    # Only attempt mount if port 2049 is open (checked earlier)
    ssh_cmd(client,
        f"timeout 5 mount -t nfs -o soft,timeo=30,retrans=1 {NAS_IP}:/volume1/aling /tmp/nfs_test 2>&1; echo EXIT:$?",
        "4b. Try NFS mount /volume1/aling", sudo=True)

    ssh_cmd(client, "ls /tmp/nfs_test/ 2>/dev/null | head -10 || echo 'mount point empty/failed'",
            "4c. Check mount contents")

    ssh_cmd(client, "umount /tmp/nfs_test 2>/dev/null; rmdir /tmp/nfs_test 2>/dev/null; true",
            "4d. Cleanup", sudo=True)

    # ── 5. Docker container NAS access ──
    ssh_cmd(client,
        'docker exec deploy-openclaw-gateway-1 ls /mnt/ 2>/dev/null || echo "Cannot list /mnt in container"',
        "5a. Container /mnt Contents")

    ssh_cmd(client,
        'docker exec deploy-openclaw-gateway-1 mount 2>/dev/null | head -20 || echo "Cannot get mounts"',
        "5b. Container Mount Table")

    ssh_cmd(client,
        "cat ~/Desktop/p/docker-openclawd/deploy/docker-compose.yml 2>/dev/null || echo 'compose file not found'",
        "5c. Docker Compose (deploy)")

    # ── 6. NAS identification ──
    ssh_cmd(client,
        f"timeout 3 curl -sk https://{NAS_IP}:5001/ 2>/dev/null | head -3 || echo 'DSM 5001 unreachable'",
        "6a. NAS Web UI (HTTPS:5001)")

    ssh_cmd(client,
        f"timeout 3 curl -sk http://{NAS_IP}:5000/ 2>/dev/null | head -3 || echo 'DSM 5000 unreachable'",
        "6b. NAS Web UI (HTTP:5000)")

    ssh_cmd(client,
        f'timeout 3 curl -sk "https://{NAS_IP}:5001/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d,indent=2))" 2>/dev/null | head -30 || echo "Synology API not available"',
        "6c. Synology API Probe")

    client.close()
    print(f"\n{'='*60}")
    print("  Investigation Complete")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
