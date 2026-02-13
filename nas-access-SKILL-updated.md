---
name: nas-access
description: "Access the shared NAS (Network Attached Storage) at /mnt/nas. Use for reading/writing shared files, storing persistent data, accessing shared resources (skills, guides, memory), and transferring files between bots. The NAS is a Synology device at 192.168.21.135 with 44TB storage. Can auto-mount if disconnected."
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
| Username | `alin` |
| Password | `yh7S8jNW` |
| Container Mount | `/mnt/nas` |
| Host Mount | `/tmp/nas` |
| Total Storage | ~44 TB |
| Used | ~6.5 TB |

## Auto-Mount on Access

**IMPORTANT**: Before accessing NAS files, always check if `/mnt/nas/` is mounted. If empty, mount it first:

```bash
# Check if NAS is mounted (should show files)
ls /mnt/nas/

# If empty, mount NAS on host via SSH
ssh fangjin@192.168.21.111 "mount -t smbfs '//alin:yh7S8jNW@192.168.21.135/aling' /tmp/nas"
```

**Why this is needed**: The Mac Mini's NAS mount can disconnect due to network issues or timeouts. Always verify before use.

## Directory Structure

```
/mnt/nas/
├── MEMORY.md                    # 阿凛的长期记忆文件
├── shared/
│   ├── skills/                  # 共享 skill 文件库
│   │   ├── claude-code-SKILL.md
│   │   ├── image-gen-SKILL.md
│   │   ├── container-persistence/
│   │   └── youtube-vision/
│   ├── guides/                  # 操作指南
│   │   └── onboarding.md
│   ├── memory/                  # 共享记忆
│   ├── resources/               # 共享资源
│   └── mailbox/                 # Bot 间消息传递
├── aling_profile/               # Aling 的个人数据
├── mksaas/                      # MkSaaS 项目文件
└── deploy-openclaw-macmini-guide.md  # 部署指南
```

## How to Use

### Reading Files

```bash
# Check mount first
if [ -z "$(ls -A /mnt/nas 2>/dev/null)" ]; then
    ssh fangjin@192.168.21.111 "mount -t smbfs '//alin:yh7S8jNW@192.168.21.135/aling' /tmp/nas"
    sleep 2
fi

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
# Check mount first
if [ -z "$(ls -A /mnt/nas 2>/dev/null)" ]; then
    ssh fangjin@192.168.21.111 "mount -t smbfs '//alin:yh7S8jNW@192.168.21.135/aling' /tmp/nas"
    sleep 2
fi

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

- **Auto-mount**: Always check if `/mnt/nas/` is empty before use. If empty, run the mount command via SSH
- **Read/Write access**: The NAS is mounted with full read/write permissions
- **Persistence**: Files on the NAS persist across container restarts and bot updates
- **Shared access**: All 4 bots (Alin, Aling, Lain, Lumi) can access the same NAS
- **Large files**: The NAS has ~37TB free space — suitable for large file storage
- **No exec**: You cannot execute scripts directly from `/mnt/nas/` — copy them to a local directory first
- **Speed**: NAS access is over the local network (LAN), so read/write speed is good but slower than local disk
- **SSH access**: Bots can SSH to the Mac Mini host (fangjin@192.168.21.111) to mount the NAS

## Troubleshooting

### If `/mnt/nas/` is empty:

1. **Auto-mount via SSH** (recommended):
   ```bash
   ssh fangjin@192.168.21.111 "mount -t smbfs '//alin:yh7S8jNW@192.168.21.135/aling' /tmp/nas"
   ```

2. **Check if already mounted on host**:
   ```bash
   ssh fangjin@192.168.21.111 "mount | grep nas"
   ```

3. **Verify network connectivity**:
   ```bash
   ssh fangjin@192.168.21.111 "ping -c 3 192.168.21.135"
   ```

### Common Issues:

- **Network timeout**: The SMB connection may timeout after inactivity. Just remount.
- **Mac Mini reboot**: Mounts are lost on reboot. A LaunchDaemon should auto-mount on boot.
- **Container restart**: The bind mount persists, but host mount may be lost.

### Permanent Solution:

A LaunchDaemon (`com.nas.mount`) should be installed on the Mac Mini to:
- Auto-mount NAS on boot
- Check and remount every 5 minutes if disconnected
- Log mount status to `/var/log/nas-mount.log`
