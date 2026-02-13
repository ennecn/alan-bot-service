#!/usr/bin/env python3
"""
Migrate all 4 OpenClaw bots from SMB bind mount to Docker native NFS volumes.
Replaces `/Users/fangjin/nas:/mnt/nas` with a named `nas` volume using NFS driver.
"""
import paramiko
import sys
import time
import re

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

BOTS = [
    {"name": "alin",  "dir": "/Users/fangjin/Desktop/p/docker-openclawd/deploy",       "container": None},
    {"name": "aling", "dir": "/Users/fangjin/Desktop/p/docker-openclawd/deploy-aling", "container": "aling-gateway"},
    {"name": "lain",  "dir": "/Users/fangjin/Desktop/p/docker-openclawd/deploy-lain",  "container": "lain-gateway"},
    {"name": "lumi",  "dir": "/Users/fangjin/Desktop/p/docker-openclawd/deploy-lumi",  "container": "lumi-gateway"},
]

NFS_VOLUME_BLOCK = """
volumes:
  nas:
    driver: local
    driver_opts:
      type: nfs
      o: "addr=192.168.21.135,rw,nfsvers=3,nolock,resvport"
      device: ":/volume1/aling"
"""

OLD_BIND_MOUNT = "      - /Users/fangjin/nas:/mnt/nas"
NEW_VOLUME_MOUNT = "      - nas:/mnt/nas"


def ssh_exec(client, cmd, timeout=60):
    """Execute command and return (stdout, stderr, exit_code)."""
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode()
    err = stderr.read().decode()
    return out, err, exit_code


def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)
    return client


def main():
    client = connect()
    print("=" * 60)
    print("NFS Volume Migration for OpenClaw Bots")
    print("=" * 60)

    # Step 1: Back up all docker-compose.yml files
    print("\n[Step 1] Backing up docker-compose.yml files...")
    for bot in BOTS:
        compose_file = f"{bot['dir']}/docker-compose.yml"
        backup_file = f"{compose_file}.bak.smb"
        cmd = f"cp '{compose_file}' '{backup_file}'"
        out, err, rc = ssh_exec(client, cmd)
        if rc != 0:
            print(f"  ERROR backing up {bot['name']}: {err}")
            sys.exit(1)
        print(f"  [{bot['name']}] Backed up to {backup_file}")

    # Step 2: Read, modify, and write each docker-compose.yml
    print("\n[Step 2] Updating docker-compose.yml files...")
    for bot in BOTS:
        compose_file = f"{bot['dir']}/docker-compose.yml"

        # Read current content
        out, err, rc = ssh_exec(client, f"cat '{compose_file}'")
        if rc != 0:
            print(f"  ERROR reading {bot['name']}: {err}")
            sys.exit(1)

        content = out

        # Check if already migrated
        if "nas:" in content and "driver: local" in content:
            print(f"  [{bot['name']}] Already has NFS volume config, skipping")
            continue

        # Replace bind mount with named volume
        if OLD_BIND_MOUNT not in content:
            # Try with different spacing
            alt = "      - /Users/fangjin/nas:/mnt/nas"
            if alt not in content:
                print(f"  WARNING [{bot['name']}] Could not find bind mount line")
                print(f"  Content around 'nas':")
                for line in content.split('\n'):
                    if 'nas' in line.lower():
                        print(f"    {line}")
                continue

        new_content = content.replace(OLD_BIND_MOUNT, NEW_VOLUME_MOUNT)

        # Check if there's already a top-level volumes: section
        # Top-level means at column 0, not indented
        has_top_level_volumes = bool(re.search(r'^volumes:', new_content, re.MULTILINE))

        if not has_top_level_volumes:
            # Append NFS volume block at the end
            new_content = new_content.rstrip() + "\n" + NFS_VOLUME_BLOCK.strip() + "\n"
        else:
            print(f"  WARNING [{bot['name']}] Already has top-level volumes: section")

        # Write back using heredoc to preserve content exactly
        # Escape any single quotes in content for shell safety
        escaped = new_content.replace("'", "'\\''")
        write_cmd = f"cat > '{compose_file}' << 'ENDOFYAML'\n{new_content}ENDOFYAML"
        out, err, rc = ssh_exec(client, write_cmd)
        if rc != 0:
            print(f"  ERROR writing {bot['name']}: {err}")
            sys.exit(1)

        # Verify the write
        out, err, rc = ssh_exec(client, f"cat '{compose_file}'")
        if "nas:" in out and "driver: local" in out and "nas:/mnt/nas" in out:
            print(f"  [{bot['name']}] Updated successfully")
        else:
            print(f"  ERROR [{bot['name']}] Verification failed!")
            print(out[:500])
            sys.exit(1)

    # Step 3: Restart all containers one by one
    print("\n[Step 3] Restarting containers...")
    client.close()

    for bot in BOTS:
        print(f"\n  [{bot['name']}] Stopping...")
        c = connect()
        cmd = f"cd {bot['dir']} && docker compose down"
        out, err, rc = ssh_exec(c, cmd, timeout=120)
        print(f"    down: rc={rc}")
        if err.strip():
            # docker compose prints to stderr normally
            for line in err.strip().split('\n'):
                if 'error' in line.lower() or 'fail' in line.lower():
                    print(f"    {line}")
        c.close()

        print(f"  [{bot['name']}] Starting...")
        c = connect()
        cmd = f"cd {bot['dir']} && docker compose up -d"
        out, err, rc = ssh_exec(c, cmd, timeout=120)
        print(f"    up: rc={rc}")
        if err.strip():
            for line in err.strip().split('\n'):
                if 'error' in line.lower() or 'fail' in line.lower():
                    print(f"    {line}")
        c.close()

        # Brief pause between bots
        time.sleep(3)

    # Step 4: Wait for containers to be ready, then verify
    print("\n[Step 4] Waiting 10s for containers to stabilize...")
    time.sleep(10)

    client = connect()

    # First, list running containers to get actual names
    print("\n  Running containers:")
    out, err, rc = ssh_exec(client, 'docker ps --format "{{.Names}}"')
    running = out.strip().split('\n')
    for name in running:
        print(f"    {name}")

    # Determine container names for each bot
    for bot in BOTS:
        if bot['container']:
            cname = bot['container']
        else:
            # alin uses default naming: deploy-openclaw-gateway-1
            cname = "deploy-openclaw-gateway-1"
        bot['resolved_container'] = cname

    print("\n[Step 5] Verifying NFS mount in each container...")
    for bot in BOTS:
        cname = bot['resolved_container']
        print(f"\n  [{bot['name']}] Container: {cname}")

        # Check if container is running
        if cname not in running:
            print(f"    WARNING: Container {cname} not found in running list!")
            # Try to find it
            for r in running:
                if bot['name'] in r.lower() or ('openclaw' in r.lower() and bot['name'] == 'alin'):
                    print(f"    Found possible match: {r}")
                    cname = r
                    break

        # Check mount
        out, err, rc = ssh_exec(client, f"docker exec {cname} ls /mnt/nas/ 2>&1 | head -10")
        if rc == 0 and out.strip():
            print(f"    ls /mnt/nas/: OK")
            for line in out.strip().split('\n')[:5]:
                print(f"      {line}")
        else:
            print(f"    ls /mnt/nas/: FAILED (rc={rc})")
            if err.strip():
                print(f"    stderr: {err.strip()}")
            if out.strip():
                print(f"    stdout: {out.strip()}")

        # Check mount type
        out, err, rc = ssh_exec(client, f"docker exec {cname} mount | grep /mnt/nas")
        if out.strip():
            print(f"    mount info: {out.strip()}")
        else:
            print(f"    mount info: not found (may still work via Docker volume)")

        # Check docker volume inspect
        # Volume name depends on project name
        dir_basename = bot['dir'].split('/')[-1]
        vol_name = f"{dir_basename}_nas"
        out, err, rc = ssh_exec(client, f"docker volume inspect {vol_name} 2>&1 | head -20")
        if rc == 0:
            print(f"    volume '{vol_name}': exists")
        else:
            print(f"    volume '{vol_name}': {err.strip() or out.strip()}")

    # Final summary
    print("\n" + "=" * 60)
    print("Migration complete. Summary of docker-compose.yml changes:")
    print(f"  - Replaced: {OLD_BIND_MOUNT}")
    print(f"  + With:     {NEW_VOLUME_MOUNT}")
    print(f"  + Added top-level NFS volume 'nas' (192.168.21.135:/volume1/aling, NFSv3)")
    print("  Backups saved as docker-compose.yml.bak.smb in each deploy dir")
    print("=" * 60)

    client.close()


if __name__ == '__main__':
    main()
