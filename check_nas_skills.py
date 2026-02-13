#!/usr/bin/env python3
"""Check NAS access skills on all 4 bots via Mac Mini SSH - v2."""
import paramiko

def run_cmd(cmd, label=None):
    if label:
        print(f"\n{'='*70}")
        print(f"  {label}")
        print(f"{'='*70}")
    # Expand ~ and ensure docker is in PATH
    full_cmd = f'export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"; {cmd}'
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(full_cmd, timeout=15)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    if out:
        print(out)
    if err:
        print(f"[STDERR] {err}")
    if not out and not err:
        print("[NO OUTPUT]")
    return out, err

base = "/Users/fangjin/Desktop/p/docker-openclawd"
bots = [
    ("Alin (deploy)", "deploy"),
    ("Aling (deploy-aling)", "deploy-aling"),
    ("Lain (deploy-lain)", "deploy-lain"),
    ("Lumi (deploy-lumi)", "deploy-lumi"),
]

# 1. List contents of nas-access skill dir for each bot (config)
for name, folder in bots:
    d = f"{base}/{folder}/config/skills/nas-access"
    run_cmd(f"ls -la '{d}/' 2>/dev/null || echo '[DIR NOT FOUND]'", f"config/skills/nas-access/ listing - {name}")

# 2. List contents of nas-access skill dir in workspace
for name, folder in bots:
    d = f"{base}/{folder}/workspace/skills/nas-access"
    run_cmd(f"ls -la '{d}/' 2>/dev/null || echo '[DIR NOT FOUND]'", f"workspace/skills/nas-access/ listing - {name}")

# 3. Read SKILL.md from config dirs (try all possible filenames)
for name, folder in bots:
    d = f"{base}/{folder}/config/skills/nas-access"
    run_cmd(
        f"for f in SKILL.md skill.md README.md; do "
        f"  if [ -f '{d}/'$f ]; then echo '--- '$f' ---'; cat '{d}/'$f; echo; fi; "
        f"done; "
        f"# Also show any file content: "
        f"for f in $(ls '{d}/' 2>/dev/null); do "
        f"  echo '=== '$f' ==='; cat '{d}/'$f 2>/dev/null; echo; "
        f"done",
        f"ALL files in config/skills/nas-access - {name}"
    )

# 4. Read SKILL.md from workspace dirs
for name, folder in bots:
    d = f"{base}/{folder}/workspace/skills/nas-access"
    run_cmd(
        f"for f in $(ls '{d}/' 2>/dev/null); do "
        f"  echo '=== '$f' ==='; cat '{d}/'$f 2>/dev/null; echo; "
        f"done || echo '[DIR NOT FOUND]'",
        f"ALL files in workspace/skills/nas-access - {name}"
    )

# 5. Check _meta.json in deploy-aling (the one not checked yet)
for name, folder in bots:
    d = f"{base}/{folder}/config/skills/nas-access"
    run_cmd(f"cat '{d}/_meta.json' 2>/dev/null || echo '[NOT FOUND]'", f"_meta.json - {name}")

# 6. Container mount checks with full docker path
containers = [
    ("deploy-openclaw-gateway-1", "Alin"),
    ("aling-gateway", "Aling"),
    ("lain-gateway", "Lain"),
    ("lumi-gateway", "Lumi"),
]
for cname, bname in containers:
    run_cmd(
        f"docker exec {cname} mount 2>/dev/null | grep -i nas || echo '[no nas mount]'",
        f"Container mount | grep nas - {bname} ({cname})"
    )

# 7. Detailed NAS mount info from one container
run_cmd(
    "docker exec deploy-openclaw-gateway-1 df -h /mnt/nas 2>/dev/null || echo '[not mounted]'",
    "df -h /mnt/nas (Alin container)"
)
run_cmd(
    "docker exec deploy-openclaw-gateway-1 ls -la /mnt/nas/ 2>/dev/null || echo '[not accessible]'",
    "ls -la /mnt/nas/ (Alin container)"
)

# 8. Check docker-compose NAS volume config for ALL bots
for name, folder in bots:
    run_cmd(
        f"grep -A10 -B2 -i nas '{base}/{folder}/docker-compose.yml' 2>/dev/null || echo '[no nas in compose]'",
        f"docker-compose.yml NAS config - {name}"
    )

print(f"\n{'='*70}")
print("  DONE")
print(f"{'='*70}")
