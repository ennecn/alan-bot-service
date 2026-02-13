#!/usr/bin/env python3
"""Deploy updated Claude Code skill to the container"""
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

skill_md = '''---
name: claude-code
description: Delegate complex programming tasks to Claude Code running on MacMini via tmux. Use when user asks for coding, debugging, scripting, or any software engineering task that benefits from file system access. Supports progress monitoring, task management, and automatic Telegram notifications.
---

# Claude Code Skill (MacMini Remote)

Delegate programming tasks to **Claude Code** running on the Mac Mini host. Claude Code runs in a **tmux session** with full file system access, independent from your conversation. You can monitor progress, check status, and stop tasks at any time.

## When to Use

Use this skill when the user asks you to:
- Write, create, or generate code / scripts / programs
- Debug, fix, or refactor existing code
- Build projects (web apps, APIs, tools, games, etc.)
- Any multi-step programming task requiring file system access
- Tasks that benefit from Claude Code's Agent Teams (parallel agents)

## When NOT to Use

- Simple code explanations (answer directly)
- One-liner snippets you can write inline
- Non-programming questions

## Dispatch a Task

Use the `nodes` tool to run the dispatch script on MacMini:

```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-dispatch.sh -p \\"TASK_DESCRIPTION\\" -n \\"TASK_NAME\\" -g \\"TELEGRAM_CHAT_ID\\" -t MAX_TURNS -w /Users/fangjin/claude-workspace/alin")
```

**Parameters:**
- `-p "prompt"` — **Required.** Detailed task description. Write in the user's language.
- `-n "name"` — Optional. Short task name for tracking (default: `task-<timestamp>`)
- `-g "chat_id"` — Optional. Telegram chat ID for completion notification. Use the current conversation's chat ID so the user gets notified directly.
- `-t N` — Optional. Max agent turns (default: 50). Use higher for complex tasks.
- `-w "/path"` — Optional. Working directory (default: `/Users/fangjin/claude-workspace/alin`)

After dispatching, tell the user the task is running and they'll be notified when it completes.

## Check Task Progress

Query the current status of a running task:

```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-status.sh -n TASK_NAME")
```

The response JSON has:
- `status`: `"running"` | `"completed"` | `"no_active_task"`
- `recent_output`: Last 30 lines of the tmux pane (shows what Claude Code is doing)
- `result`: Completion details (when status is "completed")

For more output context, add `-l 50` for 50 lines.

## List Active Tasks

```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-list.sh")
```

Returns all active Claude Code tmux sessions with names and creation times.

## Stop a Task

Stop a specific task:
```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-stop.sh -n TASK_NAME")
```

Stop all tasks:
```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-stop.sh --all")
```

## Read Final Results

After a task completes (wake event received or status shows "completed"):

```
nodes(action="run", node="MacMini", command="cat /Users/fangjin/claude-code-results/latest.json")
```

For the full task output:
```
nodes(action="run", node="MacMini", command="tail -50 /Users/fangjin/claude-workspace/alin/task-output.txt")
```

## Completion Flow

When Claude Code finishes a task:
1. A **hook** fires automatically
2. Results are written to `/Users/fangjin/claude-code-results/latest.json`
3. If `-g` was set, a **Telegram message** is sent to that chat
4. A **wake event** is sent to the gateway to notify you
5. You receive the wake event and can read the results

If the wake event fails, results persist in `latest.json` and `pending-wake.json` for the next heartbeat.

## Examples

### Example 1: Build a web app

User: "帮我用 Next.js 写一个 TODO 应用"

```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-dispatch.sh -p \\"用 Next.js 创建一个 TODO 应用。要求：支持添加、删除、标记完成，使用 Tailwind CSS 美化界面，数据存储在 localStorage\\" -n \\"todo-app\\" -g \\"CHAT_ID\\" -t 30 -w /Users/fangjin/claude-workspace/alin/todo-app")
```

### Example 2: Debug code

User: "我的 server.js 有 bug"

```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-dispatch.sh -p \\"检查 /Users/fangjin/projects/myapp/server.js 的代码，找出并修复所有bug，运行测试确认修复\\" -n \\"debug-server\\" -g \\"CHAT_ID\\" -w /Users/fangjin/projects/myapp")
```

### Example 3: Check progress

User: "Claude Code 进度怎么样了？"

```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-status.sh -n todo-app -l 20")
```

## Important Notes

- **Runs independently** — Claude Code may take 1-30 minutes depending on complexity
- **Don't wait** — Dispatch returns immediately. Tell the user the task is running.
- **tmux sessions** — Each task runs in a named tmux session (`cc-TASK_NAME`). Sessions stay alive 10 minutes after completion.
- **Language** — Write the prompt in the user's language
- **File persistence** — Files in the workspace persist across runs
- **Telegram notification** — Always pass `-g` with the current chat ID so the user gets notified
- **Agent Teams** — Claude Code has Agent Teams enabled. For complex tasks, it may spawn sub-agents automatically.
'''

meta_json = '''{
  "slug": "claude-code",
  "name": "Claude Code (MacMini)",
  "version": "2.0.0"
}'''

skill_dir = '/Users/fangjin/Desktop/p/docker-openclawd/deploy/config/skills/claude-code'

with sftp.file(f'{skill_dir}/SKILL.md', 'w') as f:
    f.write(skill_md)
print("[1/2] SKILL.md updated")

with sftp.file(f'{skill_dir}/_meta.json', 'w') as f:
    f.write(meta_json)
print("[2/2] _meta.json updated to v2.0.0")

# Verify inside container
stdin, stdout, stderr = client.exec_command(
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 head -3 /home/node/.openclaw/skills/claude-code/SKILL.md 2>/dev/null'
)
print(f"\n[VERIFY] {stdout.read().decode().strip()}")

sftp.close()
client.close()
