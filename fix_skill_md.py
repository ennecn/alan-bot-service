#!/usr/bin/env python3
"""Fix SKILL.md: nodes tool command must be array, not string.

Root cause: nodes tool schema requires `command` as array of strings.
The model (gemini-3-flash) follows the SKILL.md examples literally,
passing command as a single string → "Validation failed for tool 'nodes': command: must be array"
"""
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = c.open_sftp()

bots = {
    "阿凛": {
        "deploy_dir": "deploy",
        "port": "18789",
        "workdir": "alin",
    },
    "阿澪": {
        "deploy_dir": "deploy-aling",
        "port": "18791",
        "workdir": "aling",
    },
    "Lain": {
        "deploy_dir": "deploy-lain",
        "port": "18790",
        "workdir": "lain",
    },
    "Lumi": {
        "deploy_dir": "deploy-lumi",
        "port": "18792",
        "workdir": "lumi",
    },
}

SKILL_TEMPLATE = '''---
name: claude-code
description: "DEFAULT skill for ALL programming tasks. Delegate ALL coding work to Claude Code on Mac Mini. Do NOT write code yourself."
---

# Claude Code Skill (MacMini Remote)

**This is your default tool for ALL programming tasks.** Whenever the user asks you to write code, create projects, build apps, write scripts, debug issues, or do any software engineering work, you MUST use this skill. Do NOT try to write code yourself in the chat.

Claude Code runs on the Mac Mini host in a tmux session with full file system access.

## When to Use

- Writing ANY code, scripts, programs, or projects
- Debugging, fixing, or refactoring code
- Installing packages, setting up projects, running builds
- ANY task that involves creating or modifying files on disk

## When NOT to Use

- Answering conceptual questions about programming
- Non-programming conversations

## Dispatch a Task

Use the `nodes` tool to run the dispatch script on MacMini.

**CRITICAL: The `command` parameter MUST be an array of strings, NOT a single string.**

```json
{{
  "action": "run",
  "node": "MacMini",
  "command": [
    "/Users/fangjin/claude-code-dispatch.sh",
    "-p", "TASK_DESCRIPTION",
    "-n", "TASK_NAME",
    "-g", "TELEGRAM_CHAT_ID",
    "-P", "{port}",
    "-w", "/Users/fangjin/claude-workspace/{workdir}"
  ]
}}
```

**Parameters:**
- `-p "prompt"` — **Required.** Detailed task description. Write in the user's language.
- `-n "name"` — Short task name for tracking (default: `task-<timestamp>`)
- `-g "chat_id"` — Telegram chat ID for completion notification.
- `-P {port}` — **Always pass this.** Gateway WebSocket port for this bot.
- `-t N` — Max agent turns (default: 50).
- `-w "/Users/fangjin/claude-workspace/{workdir}"` — Working directory.

### Example

User asks: "帮我写一个从1加到10的python脚本"

```json
{{
  "action": "run",
  "node": "MacMini",
  "command": [
    "/Users/fangjin/claude-code-dispatch.sh",
    "-p", "写一个Python脚本，计算从1加到10的和",
    "-n", "sum-1-to-10",
    "-g", "6564284621",
    "-P", "{port}",
    "-w", "/Users/fangjin/claude-workspace/{workdir}"
  ]
}}
```

After dispatching, tell the user the task is running and they'll be notified when it completes.

## Check Task Progress

```json
{{
  "action": "run",
  "node": "MacMini",
  "command": ["/Users/fangjin/claude-code-status.sh", "-n", "TASK_NAME", "-l", "20"]
}}
```

## List Active Tasks

```json
{{
  "action": "run",
  "node": "MacMini",
  "command": ["/Users/fangjin/claude-code-list.sh"]
}}
```

## Stop a Task

```json
{{
  "action": "run",
  "node": "MacMini",
  "command": ["/Users/fangjin/claude-code-stop.sh", "-n", "TASK_NAME"]
}}
```

## Read Final Results

```json
{{
  "action": "run",
  "node": "MacMini",
  "command": ["cat", "/Users/fangjin/claude-code-results/latest.json"]
}}
```

## Completion Flow

When Claude Code finishes:
1. A hook fires automatically
2. A Telegram message is sent to the chat (if `-g` was set)
3. Results are injected into your session history via `chat.inject`
4. You will see the completion in your conversation context

## Important Notes

- Runs independently — may take 1-30 minutes
- Don't wait — dispatch returns immediately
- Language — write the prompt in the user's language
- Always pass `-g` with the current chat ID
- Always pass `-P {port}` for this bot's Gateway port
- **command MUST be an array** — never pass it as a single string
'''

for name, cfg in bots.items():
    skill_path = f"/Users/fangjin/Desktop/p/docker-openclawd/{cfg['deploy_dir']}/config/skills/claude-code/SKILL.md"
    content = SKILL_TEMPLATE.format(port=cfg['port'], workdir=cfg['workdir'])

    try:
        with sftp.open(skill_path, 'w') as f:
            f.write(content)
        print(f"✓ {name}: updated SKILL.md (port={cfg['port']}, workdir={cfg['workdir']})")
    except Exception as e:
        print(f"✗ {name}: failed - {e}")

# Verify
print("\nVerification:")
def run(cmd):
    si, so, se = c.exec_command(cmd, timeout=15)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

for name, cfg in bots.items():
    skill_path = f"/Users/fangjin/Desktop/p/docker-openclawd/{cfg['deploy_dir']}/config/skills/claude-code/SKILL.md"
    r = run(f'grep -c "MUST be an array" "{skill_path}" 2>/dev/null')
    count = r.strip()
    r2 = run(f'grep -o "\\-P.*[0-9]*" "{skill_path}" 2>/dev/null | head -1')
    print(f"  {name}: array warning={count}, port={r2.strip()}")

sftp.close()
c.close()
print("\nDone! All 4 bots updated. Sessions need /new or /reset to pick up the new SKILL.md.")
