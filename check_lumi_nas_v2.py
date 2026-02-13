#!/usr/bin/env python3
"""Check Lumi bot's NAS access status vs aling (working reference). v2 - full docker path."""
import paramiko
import sys

DOCKER = "/usr/local/bin/docker"

def run_cmd(cmd, label=None):
    if label:
        print(f"\n{'='*60}")
        print(f"  {label}")
        print(f"{'='*60}")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    exit_code = stdout.channel.recv_exit_status()
    client.close()
    if out:
        print(out.rstrip())
    if err:
        print(f"[STDERR] {err.rstrip()}")
    print(f"[EXIT CODE] {exit_code}")
    return out, err, exit_code

D = DOCKER

# 1. Container status
run_cmd(
    f'{D} ps --filter name=lumi-gateway --format "table {{{{.Names}}}}\\t{{{{.Status}}}}\\t{{{{.Ports}}}}"',
    "1. Lumi container status"
)

# 2. NAS access inside Lumi
run_cmd(f'{D} exec lumi-gateway ls -la /mnt/nas/ 2>&1 | head -30', "2a. Lumi: ls /mnt/nas/")
run_cmd(f'{D} exec lumi-gateway find /mnt/nas/ -maxdepth 1 -type f 2>&1 | head -10', "2b. Lumi: files in /mnt/nas/")
run_cmd(f'{D} exec lumi-gateway df -h /mnt/nas/ 2>&1', "2c. Lumi: df /mnt/nas/")
run_cmd(f'{D} exec lumi-gateway cat /mnt/nas/test.txt 2>&1 || {D} exec lumi-gateway ls /mnt/nas/ 2>&1 | head -5', "2d. Lumi: read test file or list first files")

# 3. Lumi NAS skill
run_cmd(
    'ls -la ~/Desktop/p/docker-openclawd/deploy-lumi/config/skills/nas-access/',
    "3a. Lumi nas-access skill directory"
)
run_cmd(
    'cat ~/Desktop/p/docker-openclawd/deploy-lumi/config/skills/nas-access/*.md 2>/dev/null; cat ~/Desktop/p/docker-openclawd/deploy-lumi/config/skills/nas-access/*.json 2>/dev/null; cat ~/Desktop/p/docker-openclawd/deploy-lumi/config/skills/nas-access/*.yaml 2>/dev/null; cat ~/Desktop/p/docker-openclawd/deploy-lumi/config/skills/nas-access/*.yml 2>/dev/null',
    "3b. Lumi nas-access skill content"
)

# 4. Compare with aling
run_cmd(
    f'{D} ps --filter name=aling-gateway --format "table {{{{.Names}}}}\\t{{{{.Status}}}}"',
    "4a. Aling container status"
)
run_cmd(f'{D} exec aling-gateway ls -la /mnt/nas/ 2>&1 | head -30', "4b. Aling: ls /mnt/nas/")
run_cmd(f'{D} exec aling-gateway df -h /mnt/nas/ 2>&1', "4c. Aling: df /mnt/nas/")

# 5. Check aling NAS skill for comparison
run_cmd(
    'ls -la ~/Desktop/p/docker-openclawd/deploy-aling/config/skills/nas-access/ 2>&1',
    "5a. Aling nas-access skill directory"
)
run_cmd(
    'cat ~/Desktop/p/docker-openclawd/deploy-aling/config/skills/nas-access/*.md 2>/dev/null',
    "5b. Aling nas-access skill content"
)

# 6. Lumi logs for NAS errors
run_cmd(
    f'{D} logs lumi-gateway --tail 300 2>&1 | grep -i "nas\\|mount\\|nfs\\|smb\\|cifs\\|permission\\|denied\\|EACCES\\|ENOENT\\|/mnt" | tail -30',
    "6a. Lumi logs: NAS-related errors"
)
run_cmd(f'{D} logs lumi-gateway --tail 30 2>&1', "6b. Lumi recent logs (last 30)")

# 7. Docker inspect mounts
run_cmd(
    f'{D} inspect lumi-gateway --format "{{{{json .Mounts}}}}" 2>&1',
    "7a. Lumi container mount inspection"
)
run_cmd(
    f'{D} inspect aling-gateway --format "{{{{json .Mounts}}}}" 2>&1',
    "7b. Aling container mount inspection"
)

print(f"\n{'='*60}")
print("  DIAGNOSTIC COMPLETE")
print(f"{'='*60}")
