#!/usr/bin/env python3
"""Test NFS connectivity from Mac Mini to NAS at 192.168.21.135"""
import paramiko
import time

SUDO_PASS = 'YYZZ54321!'

def run(client, cmd, use_sudo=False, timeout=15):
    """Run a command, optionally with sudo password piped in."""
    if use_sudo:
        actual = f"echo '{SUDO_PASS}' | sudo -S {cmd}"
    else:
        actual = cmd
    print(f"\n{'='*60}")
    print(f"CMD: {cmd}")
    print(f"{'='*60}")
    stdin, stdout, stderr = client.exec_command(actual, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    # Filter out sudo password prompt noise
    err_lines = [l for l in err.splitlines() if 'Password:' not in l]
    err_clean = '\n'.join(err_lines).strip()
    if out.strip():
        print(f"STDOUT:\n{out.strip()}")
    if err_clean:
        print(f"STDERR:\n{err_clean}")
    return out.strip(), err_clean

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print("Connecting to Mac Mini (192.168.21.111)...")
    client.connect('192.168.21.111', username='fangjin', password=SUDO_PASS)
    print("Connected.\n")

    # 1. Check NFS exports
    run(client, "showmount -e 192.168.21.135", timeout=10)

    # 2. Check NFS ports
    run(client, "rpcinfo -p 192.168.21.135 2>&1 | head -20", timeout=10)

    # 3. Create test mount point
    run(client, "mkdir -p /tmp/nfs_test", use_sudo=True)

    # 4. Try NFS mount - path 1
    print("\n--- Trying mount path: /volume1/aling ---")
    out, err = run(client, "mount -t nfs -o resvport,rw 192.168.21.135:/volume1/aling /tmp/nfs_test", use_sudo=True, timeout=20)

    mount_ok = False
    if err and ('No such file' in err or 'does not exist' in err or 'denied' in err or 'not found' in err or 'failed' in err.lower()):
        print("\n--- First path failed, trying: /aling ---")
        out, err = run(client, "mount -t nfs -o resvport,rw 192.168.21.135:/aling /tmp/nfs_test", use_sudo=True, timeout=20)
        if not err or 'Password' in err:
            mount_ok = True
    else:
        mount_ok = True

    # Verify mount
    out_df, _ = run(client, "df -h /tmp/nfs_test")
    if '192.168.21.135' in out_df:
        mount_ok = True
        print("\n*** NFS MOUNT CONFIRMED ***")
    else:
        print("\n*** Mount may have failed, checking... ***")

    if mount_ok:
        # 5. Test read
        run(client, "ls -la /tmp/nfs_test/")

        # 6. Test write
        run(client, 'bash -c \'echo "nfs test $(date)" > /tmp/nfs_test/nfs_test.txt && cat /tmp/nfs_test/nfs_test.txt\'', use_sudo=True)

        # 7. Clean up test file
        run(client, "rm -f /tmp/nfs_test/nfs_test.txt", use_sudo=True)

        # 8. Unmount
        run(client, "umount /tmp/nfs_test", use_sudo=True)
        print("\n*** NFS test complete - CLEANUP DONE ***")
    else:
        print("\n*** NFS mount failed - skipping read/write tests ***")
        # Still try to unmount in case partial mount
        run(client, "umount /tmp/nfs_test 2>/dev/null", use_sudo=True)

    client.close()
    print("\nDone.")

if __name__ == '__main__':
    main()
