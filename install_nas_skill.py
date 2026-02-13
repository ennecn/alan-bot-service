#!/usr/bin/env python3
"""
Create and install NAS access skill to all 4 OpenClaw bots.
"""
import paramiko
import sys

def run_cmd(cmd, verbose=True):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    if verbose:
        if out:
            print(out)
        if err:
            print(err, file=sys.stderr)
    return out, err

DOCKER = '/usr/local/bin/docker'
SKILL_NAME = 'nas-access'
TMP_DIR = f'/tmp/{SKILL_NAME}-skill'
TARGET_DIR = f'/home/node/.openclaw/skills/{SKILL_NAME}'

CONTAINERS = [
    'deploy-openclaw-gateway-1',  # Alin
    'aling-gateway',               # Aling
    'lain-gateway',                # Lain
    'lumi-gateway',                # Lumi
]

# ── Step 1: Create skill files on Mac Mini host ──
print('=' * 60)
print('Step 1: Creating NAS access skill...')
print('=' * 60)

# Create _meta.json
run_cmd(f"""
rm -rf {TMP_DIR}
mkdir -p {TMP_DIR}

cat > {TMP_DIR}/_meta.json << 'EOF'
{{
  "slug": "nas-access",
  "name": "NAS Access",
  "version": "1.0.0"
}}
EOF
""")

# Create SKILL.md
run_cmd(f"""cat > {TMP_DIR}/SKILL.md << 'SKILLEOF'
---
name: nas-access
description: "Access the shared NAS (Network Attached Storage) at /mnt/nas. Use for reading/writing shared files, storing persistent data, accessing shared resources (skills, guides, memory), and transferring files between bots. The NAS is a Synology device at 192.168.21.135 with 44TB storage."
---

# NAS Access Skill

Access the team's shared Synology NAS mounted at `/mnt/nas` inside the container. This is a 44TB network storage shared across all OpenClaw bots.

## When to Use

Use this skill when the user asks you to:
- Read or write files to shared storage
- Access shared resources (guides, skills, memory files)
- Store persistent data that should be available across bots
- Transfer or share files with other bots (Alin, Aling, Lain, Lumi)
- Back up important files
- Access books, documents, or media on the NAS

## NAS Details

| Property | Value |
|----------|-------|
| Device | Synology NAS |
| IP Address | 192.168.21.135 |
| Protocol | SMB (CIFS) |
| Share Name | `aling` |
| Container Mount | `/mnt/nas` |
| Total Storage | ~44 TB |
| Used | ~6.5 TB |

## Directory Structure

```
/mnt/nas/
├── MEMORY.md                    # 阿澪的长期记忆文件
├── shared/
│   ├── skills/                  # 共享 skill 文件备份
│   │   ├── claude-code-SKILL.md
│   │   ├── image-gen-SKILL.md
│   │   ├── container-persistence/
│   │   └── youtube-vision/
│   ├── guides/                  # 共享指南
│   │   └── onboarding.md
│   ├── memory/                  # 共享记忆
│   ├── resources/               # 共享资源
│   └── mailbox/                 # Bot 间消息传递
├── aling_profile/               # Aling 的个人资料
├── mksaas/                      # MkSaaS 项目文件
└── deploy-openclaw-macmini-guide.md  # 部署指南
```

## How to Use

### Reading Files

```bash
# List NAS root
ls /mnt/nas/

# Read a file
cat /mnt/nas/MEMORY.md

# List shared resources
ls /mnt/nas/shared/
ls /mnt/nas/shared/skills/
ls /mnt/nas/shared/guides/
```

### Writing Files

```bash
# Write a file to NAS
echo "content" > /mnt/nas/shared/my-file.txt

# Copy a file to NAS
cp /home/node/.openclaw/workspace/output.txt /mnt/nas/shared/

# Create a directory
mkdir -p /mnt/nas/shared/my-project/
```

### Bot-to-Bot File Sharing

Use the `/mnt/nas/shared/mailbox/` directory to exchange files between bots:

```bash
# Bot A writes a message/file
echo "Hello from Alin" > /mnt/nas/shared/mailbox/alin-to-lain.txt

# Bot B reads the message
cat /mnt/nas/shared/mailbox/alin-to-lain.txt
```

### Backing Up Files

```bash
# Back up workspace files to NAS
cp -r /home/node/.openclaw/workspace/project/ /mnt/nas/shared/backups/

# Back up a skill
cp /home/node/.openclaw/skills/my-skill/SKILL.md /mnt/nas/shared/skills/
```

## Important Notes

- **Read/Write access**: The NAS is mounted with full read/write permissions
- **Persistence**: Files on the NAS persist across container restarts and bot updates
- **Shared access**: All 4 bots (Alin, Aling, Lain, Lumi) can access the same NAS
- **Large files**: The NAS has ~37TB free space — suitable for large file storage
- **No exec**: You cannot execute scripts directly from `/mnt/nas/` — copy them to a local directory first
- **Speed**: NAS access is over the local network (LAN), so read/write speed is good but slower than local disk
- **Check mount**: If `/mnt/nas/` appears empty, the NAS mount may need to be re-established on the host

## Troubleshooting

If `/mnt/nas/` is empty:
1. The SMB mount on the Mac Mini host may have been lost
2. Ask the user to re-mount the NAS on the Mac Mini:
   ```
   mount -t smbfs '//alin:PASSWORD@192.168.21.135/aling' /private/tmp/nas
   ```
3. The Docker containers bind-mount `/tmp/nas` → `/mnt/nas`, so the host mount point must be `/private/tmp/nas` (or `/tmp/nas`)
SKILLEOF

echo "SKILL.md created ($(wc -l < {TMP_DIR}/SKILL.md) lines)"
echo "_meta.json created"
ls -la {TMP_DIR}/
""")

# ── Step 2: Install to all containers ──
print('=' * 60)
print('Step 2: Installing to all bot containers...')
print('=' * 60)

for container in CONTAINERS:
    print(f'\n  Installing to {container}...')
    install_cmd = f"""
# Remove old if exists
{DOCKER} exec {container} rm -rf {TARGET_DIR} 2>/dev/null || true

# Create directory
{DOCKER} exec {container} mkdir -p {TARGET_DIR}

# Copy files
{DOCKER} cp {TMP_DIR}/SKILL.md {container}:{TARGET_DIR}/SKILL.md
{DOCKER} cp {TMP_DIR}/_meta.json {container}:{TARGET_DIR}/_meta.json

# Verify
echo "  Files:"
{DOCKER} exec {container} ls -la {TARGET_DIR}/
echo "  Frontmatter:"
{DOCKER} exec {container} head -3 {TARGET_DIR}/SKILL.md
"""
    run_cmd(install_cmd)

# ── Step 3: Check NAS mount status ──
print('=' * 60)
print('Step 3: NAS mount status check...')
print('=' * 60)

for container in CONTAINERS:
    check_cmd = f"""
echo "  {container}: "
CONTENT=$({DOCKER} exec {container} ls /mnt/nas/ 2>/dev/null)
if [ -z "$CONTENT" ]; then
    echo "    /mnt/nas is EMPTY (NAS not mounted on host)"
else
    echo "    /mnt/nas has content: $CONTENT"
fi
"""
    run_cmd(check_cmd)

# Cleanup
run_cmd(f'rm -rf {TMP_DIR}')

print('\n' + '=' * 60)
print('Done! NAS access skill installed on all 4 bots.')
print('')
print('⚠ NAS mount needs to be re-established on Mac Mini.')
print('  The NAS was previously at /private/tmp/nas_test')
print('  Docker expects it at /private/tmp/nas (= /tmp/nas)')
print('')
print('  To fix, re-mount NAS to the correct path:')
print('  mount -t smbfs "//alin:PASSWORD@192.168.21.135/aling" /private/tmp/nas')
print('=' * 60)
