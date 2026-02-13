#!/usr/bin/env python3
"""Investigate NAS access across all 4 OpenClaw bots on Mac Mini."""
import paramiko
import sys

def run_cmd(cmd, label=None):
    """Execute command on Mac Mini via SSH, return (stdout, stderr)."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    return out, err

def section(title):
    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}")

def run_and_print(cmd, label=None):
    if label:
        print(f"\n--- {label} ---")
    print(f"$ {cmd}")
    out, err = run_cmd(cmd)
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(f"[STDERR] {err.rstrip()}")
    if not out.strip() and not err.strip():
        print("(no output)")
    return out, err

# Container name mapping
BOTS = {
    "alin":  {"container": "deploy-openclaw-gateway-1", "deploy_dir": "~/Desktop/p/docker-openclawd/deploy"},
    "aling": {"container": "aling-gateway",              "deploy_dir": "~/Desktop/p/docker-openclawd/deploy-aling"},
    "lain":  {"container": "lain-gateway",               "deploy_dir": "~/Desktop/p/docker-openclawd/deploy-lain"},
    "lumi":  {"container": "lumi-gateway",               "deploy_dir": "~/Desktop/p/docker-openclawd/deploy-lumi"},
}

if __name__ == '__main__':
    # ============================================================
    section("1. HOST NAS MOUNT STATUS")
    # ============================================================
    run_and_print("mount | grep -i nas || mount | grep -i smb || mount | grep -i cifs || echo 'No NAS/SMB/CIFS mounts found'",
                  "Host NAS/SMB mounts")
    run_and_print("ls -la /Volumes/ 2>/dev/null || echo '/Volumes not found'",
                  "Volumes directory")
    run_and_print("df -h | grep -i nas || df -h | grep -i smb || df -h | head -5",
                  "Disk usage (NAS-related)")

    # ============================================================
    section("2. DOCKER-COMPOSE NAS VOLUME CONFIG PER BOT")
    # ============================================================
    for bot, info in BOTS.items():
        d = info["deploy_dir"]
        run_and_print(
            f"grep -n -A5 -B2 -i 'nas\\|smb\\|mount\\|volume' {d}/docker-compose.yml 2>/dev/null || echo 'No NAS references in docker-compose.yml'",
            f"{bot} ({info['container']}) docker-compose.yml NAS references"
        )

    # ============================================================
    section("3. FULL VOLUMES SECTION FROM EACH DOCKER-COMPOSE")
    # ============================================================
    for bot, info in BOTS.items():
        d = info["deploy_dir"]
        # Extract volumes sections
        run_and_print(
            f"cat {d}/docker-compose.yml | grep -A30 'volumes:' | head -60",
            f"{bot} volumes sections"
        )

    # ============================================================
    section("4. CONTAINER NAS ACCESS CHECK")
    # ============================================================
    for bot, info in BOTS.items():
        c = info["container"]
        print(f"\n--- {bot} ({c}) ---")

        # Check if container is running
        out, _ = run_and_print(f"docker inspect --format '{{{{.State.Running}}}}' {c} 2>/dev/null")
        if 'true' not in out.lower():
            print(f"  [SKIP] Container not running")
            continue

        # Check /mnt/nas inside container
        run_and_print(f"docker exec {c} ls -la /mnt/nas/ 2>&1 || echo '/mnt/nas not found'",
                      f"{bot}: /mnt/nas contents")

        # Check /tmp/nas_test
        run_and_print(f"docker exec {c} ls -la /tmp/nas_test/ 2>&1 || echo '/tmp/nas_test not found'",
                      f"{bot}: /tmp/nas_test contents")

        # Check mount points inside container
        run_and_print(f"docker exec {c} mount 2>/dev/null | grep -i 'nas\\|smb\\|cifs' || echo 'No NAS mounts inside container'",
                      f"{bot}: container NAS mounts")

        # Check all bind mounts for this container
        run_and_print(
            f"docker inspect {c} --format '{{{{range .Mounts}}}}{{{{.Type}}}} {{{{.Source}}}} -> {{{{.Destination}}}} ({{{{.Mode}}}})\\n{{{{end}}}}'",
            f"{bot}: all container mounts"
        )

    # ============================================================
    section("5. NAS SKILLS CONFIGURATION")
    # ============================================================
    for bot, info in BOTS.items():
        c = info["container"]
        d = info["deploy_dir"]

        # Check skills directory on host
        run_and_print(
            f"ls -la {d}/config/skills/ 2>/dev/null | grep -i nas || echo 'No NAS skills in host config'",
            f"{bot}: host skills dir"
        )

        # Check skills inside container
        run_and_print(
            f"docker exec {c} ls -la /home/node/.openclaw/skills/ 2>/dev/null | grep -i nas || "
            f"docker exec {c} ls -la /app/config/skills/ 2>/dev/null | grep -i nas || "
            f"echo 'No NAS skills found in container'",
            f"{bot}: container skills"
        )

    # ============================================================
    section("6. NAS SKILL FILE CONTENTS")
    # ============================================================
    for bot, info in BOTS.items():
        d = info["deploy_dir"]
        # Try to find and cat the NAS skill config
        run_and_print(
            f"find {d}/config/skills -name '*nas*' -o -name '*NAS*' 2>/dev/null | head -10",
            f"{bot}: NAS skill files found"
        )
        run_and_print(
            f"for f in $(find {d}/config/skills -path '*nas*' -name '*.md' -o -path '*nas*' -name '*.json' -o -path '*nas*' -name '*.yml' -o -path '*nas*' -name '*.yaml' 2>/dev/null); do echo '=== '$f' ==='; cat $f; echo; done",
            f"{bot}: NAS skill file contents"
        )

    # ============================================================
    section("7. RECENT NAS-RELATED LOGS")
    # ============================================================
    for bot, info in BOTS.items():
        c = info["container"]
        run_and_print(
            f"docker logs {c} --tail 100 2>&1 | grep -i 'nas\\|smb\\|mount\\|permission' | tail -20 || echo 'No NAS-related logs'",
            f"{bot}: recent NAS logs"
        )

    # ============================================================
    section("8. HOST NAS CONNECTIVITY TEST")
    # ============================================================
    # Check if there's a NAS IP configured somewhere
    run_and_print(
        "grep -r 'nas\\|NAS\\|192.168' ~/Desktop/p/docker-openclawd/deploy*/config/skills/*nas* 2>/dev/null | head -20 || echo 'No NAS config found'",
        "NAS IP/config references"
    )
    # Check /etc/fstab for NAS
    run_and_print("cat /etc/fstab 2>/dev/null | grep -i nas || echo 'No NAS in fstab'",
                  "fstab NAS entries")
    # Check auto_master for NAS
    run_and_print("cat /etc/auto_master 2>/dev/null || echo 'No auto_master'",
                  "auto_master")

    print(f"\n{'='*70}")
    print("  INVESTIGATION COMPLETE")
    print(f"{'='*70}")
