#!/usr/bin/env python3
"""Restart containers and verify NAS access."""
import paramiko
import time

def run_cmd(cmd, timeout=60):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    return out.strip(), err.strip()

def p(label, cmd, timeout=60):
    print(f"\n--- {label} ---")
    out, err = run_cmd(cmd, timeout)
    if out:
        try:
            print(out)
        except UnicodeEncodeError:
            print(out.encode('ascii', 'replace').decode('ascii'))
    if err:
        try:
            print(f"[STDERR] {err}")
        except UnicodeEncodeError:
            print(f"[STDERR] {err.encode('ascii', 'replace').decode('ascii')}")
    if not out and not err:
        print("(no output)")
    return out

DOCKER = "/usr/local/bin/docker"
CONTAINERS = ["deploy-openclaw-gateway-1", "aling-gateway", "lain-gateway", "lumi-gateway"]
NAMES = ["alin", "aling", "lain", "lumi"]

# Step 1: Restart all containers
print("=" * 70)
print("  RESTARTING CONTAINERS")
print("=" * 70)
for c in CONTAINERS:
    p(f"Restarting {c}", f"{DOCKER} restart {c}", timeout=120)

print("\nWaiting 15 seconds for containers to stabilize...")
time.sleep(15)

# Step 2: Verify containers are running
print("\n" + "=" * 70)
print("  VERIFYING CONTAINERS")
print("=" * 70)
p("Container status", f"{DOCKER} ps --format 'table {{{{.Names}}}}\\t{{{{.Status}}}}'")

# Step 3: Test NAS access in each container
print("\n" + "=" * 70)
print("  NAS ACCESS TESTS AFTER RESTART")
print("=" * 70)
for name, c in zip(NAMES, CONTAINERS):
    print(f"\n--- {name} ({c}) ---")

    # List root
    out, _ = run_cmd(f"{DOCKER} exec {c} sh -c 'ls /mnt/nas/ 2>&1'")
    print(f"  ls /mnt/nas/: {out[:200] if out else '(empty)'}")

    # Read MEMORY.md
    out, _ = run_cmd(f"{DOCKER} exec {c} sh -c 'head -3 /mnt/nas/MEMORY.md 2>&1'")
    print(f"  head MEMORY.md: {out[:200] if out else '(empty)'}")

    # Read hello.txt
    out, _ = run_cmd(f"{DOCKER} exec {c} sh -c 'cat /mnt/nas/hello.txt 2>&1'")
    print(f"  cat hello.txt: {out[:200] if out else '(empty)'}")

    # Write test
    out, _ = run_cmd(f"{DOCKER} exec {c} sh -c 'echo post-restart-{name} > /mnt/nas/shared/mailbox/restart-test-{name}.txt 2>&1 && echo WRITE_OK || echo WRITE_FAIL'")
    print(f"  write test: {out}")

    # Read back
    out, _ = run_cmd(f"{DOCKER} exec {c} sh -c 'cat /mnt/nas/shared/mailbox/restart-test-{name}.txt 2>&1'")
    print(f"  read back: {out}")

    # Check articles dir
    out, _ = run_cmd(f"{DOCKER} exec {c} sh -c 'ls /mnt/nas/articles/ 2>&1'")
    print(f"  ls articles/: {out[:200] if out else '(empty)'}")

    # Read article file
    out, _ = run_cmd(f"{DOCKER} exec {c} sh -c 'head -2 /mnt/nas/articles/dan_koe_how_to_fix_your_entire_life_in_1_day.md 2>&1'")
    try:
        print(f"  head article: {out[:200] if out else '(empty)'}")
    except UnicodeEncodeError:
        print(f"  head article: {out.encode('ascii','replace').decode('ascii')[:200]}")

print("\n" + "=" * 70)
print("  DONE")
print("=" * 70)
