---
name: claude-code
description: Delegate programming and coding tasks to Claude Code, a dedicated coding agent. Use when the user asks to write code, debug, create scripts, modify files, or any software engineering task.
---

# Claude Code Skill

Delegate programming tasks to Claude Code — a dedicated coding agent that runs as a separate process. This keeps your conversation context clean while handling complex coding work.

## When to Use

Use this skill when the user asks you to:
- Write, create, or generate code / scripts / programs
- Debug or fix code issues
- Modify, refactor, or improve existing code files
- Create or edit configuration files
- Any multi-step programming task that would consume too much context

## When NOT to Use

Do NOT use this skill for:
- Explaining code concepts (just answer directly)
- Simple one-liner code snippets you can write inline
- Non-programming questions
- Tasks that don't involve writing/editing files

## How to Use

### Basic Usage

Run via `exec` with **`pty: true`** (required!):

```
exec /home/node/.openclaw/workspace/.claude-code/claude -p "YOUR_TASK_DESCRIPTION" --max-turns 10
```

**CRITICAL: You MUST use `pty: true` when calling exec.** Claude Code is a terminal application that requires a pseudo-terminal. Without PTY mode, it will hang with no output.

### Key Flags

| Flag | Description |
|------|-------------|
| `-p "prompt"` | **Required.** The task description in non-interactive mode |
| `--max-turns N` | Max agentic turns. Use 5-10 for simple tasks, 15-30 for complex ones |
| `--output-format text` | Plain text output (default) |
| `--output-format json` | JSON output with structured result |

### Working Directory

Claude Code runs in `/app` by default. To work in the persistent workspace:

```bash
cd /home/node/.openclaw/workspace && /home/node/.openclaw/workspace/.claude-code/claude -p "YOUR_TASK" --max-turns 10
```

Files created in `/home/node/.openclaw/workspace/` persist across container restarts.

### Examples

**Write a Python script:**
```
exec cd /home/node/.openclaw/workspace && /home/node/.openclaw/workspace/.claude-code/claude -p "Create a Python script called hello.py that prints hello world" --max-turns 5
```

**Debug a file:**
```
exec /home/node/.openclaw/workspace/.claude-code/claude -p "Read /home/node/.openclaw/workspace/script.py and fix any bugs" --max-turns 10
```

**Complex multi-file task:**
```
exec cd /home/node/.openclaw/workspace && /home/node/.openclaw/workspace/.claude-code/claude -p "Create a Flask web app with a REST API that has GET /health and POST /data endpoints. Put it in a directory called myapp/" --max-turns 20
```

Remember: always use `pty: true` with exec for all Claude Code commands.

## Important Notes

- **PTY mode is REQUIRED** — always use `pty: true` when calling exec. Without it, Claude Code hangs with no output
- **Always provide a clear, detailed prompt** — Claude Code works best with specific instructions
- **Set --max-turns appropriately** — too low and it may not finish; too high wastes API calls
- **Output goes to stdout** — you'll see Claude Code's final response as the exec result
- **Files persist in workspace** — anything written to `/home/node/.openclaw/workspace/` survives restarts
- **Claude Code can read/write/edit files, run commands** — it's a full coding agent
- **Timeout**: complex tasks may take 1-3 minutes. If exec times out, increase the timeout or reduce --max-turns
- **Language**: Write the prompt in the same language the user is using (Chinese prompt for Chinese users, etc.)
