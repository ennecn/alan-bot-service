#!/usr/bin/env python3
"""Deep NAS investigation - container access tests."""
import paramiko
import sys

def run_cmd(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    return out.strip(), err.strip()

def p(label, cmd):
    print(f"\n--- {label} ---")
    print(f"$ {cmd}")
    out, err = run_cmd(cmd)
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
    if not out and not err: print("(no output)")
    return out

DOCKER = "/usr/local/bin/docker"
CONTAINERS = [
    ("alin",  "deploy-openclaw-gateway-1"),
    ("aling", "aling-gateway"),
    ("lain",  "lain-gateway"),
    ("lumi",  "lumi-gateway"),
]

print("=" * 70)
print("  NAS DEEP INVESTIGATION")
print("=" * 70)

# 1. Host NAS mount health
p("Host: NAS mount check", "mount | grep nas")
p("Host: NAS dir listing", "ls /Users/fangjin/nas/ 2>&1 | head -20")
p("Host: NAS test read", "cat /Users/fangjin/nas/MEMORY.md 2>&1 | head -5")
p("Host: /private/tmp/nas listing", "ls /private/tmp/nas/ 2>&1 | head -20")

# 2. Check each container
for bot, cname in CONTAINERS:
    print(f"\n{'='*70}")
    print(f"  CONTAINER: {bot} ({cname})")
    print(f"{'='*70}")

    # Check /mnt/nas mount point
    p(f"{bot}: /mnt/nas listing",
      f"{DOCKER} exec {cname} ls -la /mnt/nas/ 2>&1")

    # Check if it's a real mount or empty dir
    p(f"{bot}: /mnt/nas file count",
      f"{DOCKER} exec {cname} sh -c 'ls -1 /mnt/nas/ 2>&1 | wc -l'")

    # Try reading a known file
    p(f"{bot}: read MEMORY.md",
      f"{DOCKER} exec {cname} sh -c 'head -3 /mnt/nas/MEMORY.md 2>&1'")

    # Try writing a test file
    p(f"{bot}: write test",
      f"{DOCKER} exec {cname} sh -c 'echo test-{bot} > /tmp/nas_write_test.txt && cp /tmp/nas_write_test.txt /mnt/nas/shared/mailbox/test-{bot}.txt 2>&1 && echo WRITE_OK || echo WRITE_FAIL'")

    # Check mount info inside container
    p(f"{bot}: mount info",
      f"{DOCKER} exec {cname} sh -c 'mount 2>/dev/null | grep mnt'")

    # Check container mount config
    p(f"{bot}: inspect mounts",
      f"""{DOCKER} inspect {cname} --format '{{{{range .Mounts}}}}{{{{.Source}}}} -> {{{{.Destination}}}} ({{{{.RW}}}})\\n{{{{end}}}}'""")

    # Check if /mnt/nas exists and its type
    p(f"{bot}: /mnt/nas stat",
      f"{DOCKER} exec {cname} sh -c 'stat /mnt/nas/ 2>&1'")

    # Check permissions
    p(f"{bot}: /mnt/nas permissions",
      f"{DOCKER} exec {cname} sh -c 'id && ls -ld /mnt/nas/ 2>&1'")

    # Check if SSH is available (for remount)
    p(f"{bot}: ssh available",
      f"{DOCKER} exec {cname} sh -c 'which ssh 2>/dev/null && echo SSH_AVAILABLE || echo NO_SSH'")

# 3. Check alin's skill dir difference (it has 5 items vs 4 for others)
print(f"\n{'='*70}")
print("  SKILL DIR COMPARISON")
print(f"{'='*70}")
for bot_dir in ["deploy", "deploy-aling", "deploy-lain", "deploy-lumi"]:
    p(f"{bot_dir}: nas-access skill files",
      f"ls -la ~/Desktop/p/docker-openclawd/{bot_dir}/config/skills/nas-access/")

# 4. Check if there's a LaunchDaemon for NAS auto-mount
print(f"\n{'='*70}")
print("  NAS AUTO-MOUNT DAEMON")
print(f"{'='*70}")
p("LaunchDaemon check",
  "ls -la /Library/LaunchDaemons/*nas* ~/Library/LaunchAgents/*nas* 2>&1")
p("launchctl list nas",
  "launchctl list 2>&1 | grep -i nas")

# 5. NAS connectivity from host
print(f"\n{'='*70}")
print("  NAS CONNECTIVITY")
print(f"{'='*70}")
p("Ping NAS", "ping -c 2 -W 2 192.168.21.135 2>&1")
p("SMB port check", "nc -z -w 3 192.168.21.135 445 2>&1 && echo PORT_OPEN || echo PORT_CLOSED")

print(f"\n{'='*70}")
print("  INVESTIGATION COMPLETE")
print(f"{'='*70}")
