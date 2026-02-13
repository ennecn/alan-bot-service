#!/usr/bin/env python3
"""Check Lumi bot's NAS access status vs aling (working reference)."""
import paramiko
import sys

def run_cmd(cmd, label=None):
    if label:
        print(f"\n{'='*60}")
        print(f"  {label}")
        print(f"{'='*60}")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
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

# 1. Check if Lumi container is running
run_cmd(
    'docker ps --filter name=lumi-gateway --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
    "1. Lumi container status"
)

# 2. Test NAS access inside Lumi container
run_cmd(
    'docker exec lumi-gateway ls -la /mnt/nas/ 2>&1 | head -30',
    "2a. Lumi: ls /mnt/nas/"
)

run_cmd(
    'docker exec lumi-gateway ls -la /mnt/nas/ 2>&1 | head -5 && docker exec lumi-gateway find /mnt/nas/ -maxdepth 1 -type f 2>&1 | head -10',
    "2b. Lumi: find files in /mnt/nas/"
)

run_cmd(
    'docker exec lumi-gateway df -h /mnt/nas/ 2>&1',
    "2c. Lumi: df on /mnt/nas/"
)

# 3. Check Lumi docker-compose.yml for NAS mount config
run_cmd(
    'cat ~/Desktop/p/docker-openclawd/deploy-lumi/docker-compose.yml',
    "3. Lumi docker-compose.yml"
)

# 4. Check Lumi NAS skill configuration
run_cmd(
    'ls -la ~/Desktop/p/docker-openclawd/deploy-lumi/config/skills/ 2>&1',
    "4a. Lumi skills directory"
)

run_cmd(
    'find ~/Desktop/p/docker-openclawd/deploy-lumi/config/skills/ -iname "*nas*" -o -iname "*storage*" -o -iname "*mount*" 2>&1',
    "4b. Lumi NAS-related skills"
)

run_cmd(
    'for f in ~/Desktop/p/docker-openclawd/deploy-lumi/config/skills/*/skill.json; do echo "--- $f ---"; cat "$f" 2>/dev/null | head -20; done 2>&1',
    "4c. Lumi all skill.json files"
)

# 5. Compare with aling (working reference)
run_cmd(
    'docker ps --filter name=aling-gateway --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
    "5a. Aling container status"
)

run_cmd(
    'docker exec aling-gateway ls -la /mnt/nas/ 2>&1 | head -30',
    "5b. Aling: ls /mnt/nas/"
)

run_cmd(
    'docker exec aling-gateway df -h /mnt/nas/ 2>&1',
    "5c. Aling: df on /mnt/nas/"
)

# 5d. Compare aling docker-compose for NAS mounts
run_cmd(
    'grep -A2 -B2 -i "nas\\|nfs\\|smb\\|cifs\\|volume\\|mount" ~/Desktop/p/docker-openclawd/deploy-aling/docker-compose.yml 2>&1',
    "5d. Aling docker-compose NAS-related config"
)

# 5e. Compare: grep NAS mounts from both compose files side by side
run_cmd(
    'echo "=== LUMI volumes ===" && grep -i "volume\\|/mnt" ~/Desktop/p/docker-openclawd/deploy-lumi/docker-compose.yml 2>&1; echo "\\n=== ALING volumes ===" && grep -i "volume\\|/mnt" ~/Desktop/p/docker-openclawd/deploy-aling/docker-compose.yml 2>&1',
    "5e. Volume mounts comparison (Lumi vs Aling)"
)

# 6. Check recent Lumi logs for NAS-related errors
run_cmd(
    'docker logs lumi-gateway --tail 200 2>&1 | grep -i "nas\\|mount\\|nfs\\|smb\\|cifs\\|permission\\|denied\\|EACCES\\|ENOENT\\|/mnt" | tail -30',
    "6a. Lumi logs: NAS-related errors (last 200 lines)"
)

run_cmd(
    'docker logs lumi-gateway --tail 50 2>&1 | tail -30',
    "6b. Lumi recent logs (last 30 lines)"
)

# 7. Check host NAS mount status
run_cmd(
    'mount | grep -i "nas\\|nfs\\|smb\\|cifs\\|smbfs" 2>&1',
    "7. Host NAS mount status"
)

run_cmd(
    'ls -la /Volumes/ 2>&1',
    "7b. Host /Volumes/ listing"
)

print("\n" + "="*60)
print("  DIAGNOSTIC COMPLETE")
print("="*60)
