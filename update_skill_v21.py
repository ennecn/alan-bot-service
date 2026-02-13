#!/usr/bin/env python3
"""Update SKILL.md with new -m flag documentation"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

# Read current SKILL.md
skill_dir = '/Users/fangjin/Desktop/p/docker-openclawd/deploy/config/skills/claude-code'
with sftp.file(f'{skill_dir}/SKILL.md', 'r') as f:
    content = f.read().decode()

# Add -m flag to Parameters section
old_params = '''- `-w "/path"` — Optional. Working directory (default: `/Users/fangjin/claude-workspace/alin`)'''
new_params = '''- `-w "/path"` — Optional. Working directory (default: `/Users/fangjin/claude-workspace/alin`)
- `-m "mode"` — Optional. Permission mode (`plan`, `acceptEdits`, `default`). If omitted, uses `--dangerously-skip-permissions`.'''

content = content.replace(old_params, new_params)

# Add trust helper to Important Notes
old_notes = '''- **Agent Teams** — Claude Code has Agent Teams enabled. For complex tasks, it may spawn sub-agents automatically.'''
new_notes = '''- **Agent Teams** — Claude Code has Agent Teams enabled. For complex tasks, it may spawn sub-agents automatically.
- **Workspace trust** — Default workspace is pre-trusted. For new directories, run: `nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-trust.sh /path/to/new/workspace")` before dispatching.
- **PTY handling** — Inside tmux, PTY is automatic. If running outside tmux, `script(1)` is used as fallback.'''

content = content.replace(old_notes, new_notes)

with sftp.file(f'{skill_dir}/SKILL.md', 'w') as f:
    f.write(content)
print("SKILL.md updated with -m flag and trust/PTY docs")

# Update _meta.json version
meta = '{\n  "slug": "claude-code",\n  "name": "Claude Code (MacMini)",\n  "version": "2.1.0"\n}'
with sftp.file(f'{skill_dir}/_meta.json', 'w') as f:
    f.write(meta)
print("_meta.json bumped to v2.1.0")

# Verify
stdin, stdout, stderr = client.exec_command(
    f'/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -c "permission" /home/node/.openclaw/skills/claude-code/SKILL.md 2>/dev/null'
)
print(f"Verify permission refs in container: {stdout.read().decode().strip()}")

sftp.close()
client.close()
