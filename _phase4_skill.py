#!/usr/bin/env python3
"""Phase 4: Create claude-code skill for Alin in the gateway container."""
import paramiko, sys, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'
DEPLOY = '/Users/fangjin/Desktop/p/docker-openclawd/deploy'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=30):
    try:
        _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
        return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')
    except Exception as e:
        return f'TIMEOUT: {e}', ''

sftp = c.open_sftp()

# Check existing skills
print('=== Existing skills ===', flush=True)
out, _ = run(f'ls -la {DEPLOY}/config/skills/')
print(out.strip()[:500], flush=True)

# ============================================================
# Create claude-code skill
# ============================================================
print('\n=== Create claude-code skill ===', flush=True)

SKILL_DIR = f'{DEPLOY}/config/skills/claude-code'
run(f'mkdir -p {SKILL_DIR}')

# Create _meta.json
META = {
    "slug": "claude-code",
    "name": "Claude Code (MacMini)",
    "version": "1.0.0"
}
with sftp.file(f'{SKILL_DIR}/_meta.json', 'w') as f:
    f.write(json.dumps(META, indent=2))
print('  _meta.json created', flush=True)

# Create SKILL.md
SKILL_MD = r'''---
name: claude-code
description: Delegate complex programming tasks to Claude Code running on MacMini. Use when user asks for coding, debugging, scripting, or any software engineering task that benefits from file system access.
---

# Claude Code Skill (MacMini Remote)

Delegate programming and coding tasks to **Claude Code** running on the Mac Mini host machine. Claude Code runs as an independent process with full file system access, separate from your conversation context.

## When to Use

Use this skill when the user asks you to:
- Write, create, or generate code / scripts / programs
- Debug, fix, or refactor code
- Create or modify configuration files
- Any multi-step programming task
- Tasks requiring file system access on the Mac Mini

## When NOT to Use

- Simple code explanations (just answer directly)
- One-liner code snippets you can write inline
- Non-programming questions

## How to Dispatch a Task

### Step 1: Dispatch the task

Use the `nodes` tool to run the dispatch script on MacMini:

```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-dispatch.sh -p \"TASK_DESCRIPTION\" -n \"TASK_NAME\" -w /Users/fangjin/claude-workspace/alin")
```

**Parameters:**
- `-p "prompt"` — **Required.** The task description. Be specific and detailed. Write in the same language as the user.
- `-n "name"` — Optional. A short task name for tracking.
- `-w "/path"` — Optional. Working directory (default: `/Users/fangjin/claude-workspace/alin`)
- `-t N` — Optional. Max agent turns (default: 20)

### Step 2: Inform the user

After dispatching, tell the user:
- "任务已派发给 Claude Code！它正在 MacMini 上独立运行。"
- "完成后我会收到通知并发送结果摘要给你。"

### Step 3: Read results (after wake event)

When the wake event arrives (or user asks for status), read the results:

```
nodes(action="run", node="MacMini", command="cat /Users/fangjin/claude-code-results/latest.json")
```

Parse the JSON and summarize:
- `status` — "completed" if finished
- `output` — Claude Code's output (may be truncated)
- `task_name` — The task identifier
- `timestamp` — When it completed

### Step 4: Report to user

Format a clear summary:
1. Task status (completed/failed)
2. Key output highlights
3. Any files created or modified
4. Next steps if applicable

## Checking Task Progress

If the user asks about progress before completion:

```
nodes(action="run", node="MacMini", command="cat /Users/fangjin/claude-workspace/alin/task-output.txt 2>/dev/null | tail -20")
```

## Examples

### Example 1: Write a Python script

User: "帮我写一个爬虫脚本，爬取某网站的文章列表"

```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-dispatch.sh -p \"创建一个Python爬虫脚本，爬取网站文章列表。要求：使用requests和BeautifulSoup，支持分页，输出为JSON格式\" -n \"web-scraper\" -w /Users/fangjin/claude-workspace/alin")
```

### Example 2: Debug code

User: "我的 server.js 有 bug，帮我看看"

```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-dispatch.sh -p \"检查 /Users/fangjin/projects/myapp/server.js 的代码，找出并修复所有bug\" -n \"debug-server\" -w /Users/fangjin/projects/myapp")
```

## Important Notes

- **Claude Code runs independently** — It may take 1-10 minutes depending on task complexity
- **Don't wait** — The dispatch script returns immediately. Tell the user the task is running.
- **Results via hooks** — When Claude Code finishes, a hook writes results to `latest.json` and wakes the gateway
- **Language** — Write the prompt in the same language as the user (Chinese for Chinese users, etc.)
- **File persistence** — Files in the workspace persist across runs
- **MacMini access** — Claude Code has access to the Mac Mini's full file system
'''

with sftp.file(f'{SKILL_DIR}/SKILL.md', 'w') as f:
    f.write(SKILL_MD)
print('  SKILL.md created', flush=True)

# Verify
out, _ = run(f'ls -la {SKILL_DIR}/')
print(f'\n  Files:\n{out.strip()}', flush=True)

out, _ = run(f'cat {SKILL_DIR}/_meta.json')
print(f'\n  _meta.json: {out.strip()}', flush=True)

out, _ = run(f'head -10 {SKILL_DIR}/SKILL.md')
print(f'\n  SKILL.md (first 10 lines):\n{out.strip()[:300]}', flush=True)

# Hot reload: trigger skill reload in gateway
print('\n=== Reload skills ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw skills list 2>&1')
print(out.strip()[:800], flush=True)

sftp.close()
c.close()
print('\nPhase 4 complete!', flush=True)
