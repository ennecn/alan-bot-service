---
name: claude-code
description: "Delegate tasks to Claude Code on Mac Mini. ONLY use when user explicitly mentions CC or Claude Code."
---

# Claude Code Skill (MacMini Remote)

**Only use this skill when the user explicitly asks to use CC / Claude Code.** For example:
- "用CC写一个..." "让CC帮我..." "交给CC去做"
- "use claude code to..." "have CC do this"

If the user just asks you to write code or do programming tasks WITHOUT mentioning CC, handle it yourself directly in chat. Do NOT auto-delegate.

## Dispatch a Task

Use the `nodes` tool to run the dispatch script on MacMini.

**CRITICAL: The `command` parameter MUST be an array of strings, NOT a single string.**

```json
{
  "action": "run",
  "node": "MacMini",
  "command": [
    "/Users/fangjin/claude-code-dispatch.sh",
    "-p", "TASK_DESCRIPTION",
    "-n", "TASK_NAME",
    "-g", "TELEGRAM_CHAT_ID",
    "-P", "PORT_PLACEHOLDER",
    "-w", "/Users/fangjin/claude-workspace/WORKDIR_PLACEHOLDER"
  ]
}
```

**Parameters:**
- `-p "prompt"` - **Required.** Detailed task description. Write in the user's language.
- `-n "name"` - Short task name for tracking (default: task-TIMESTAMP)
- `-g "chat_id"` - Telegram chat ID for completion notification.
- `-P PORT_PLACEHOLDER` - **Always pass this.** Gateway WebSocket port for this bot.
- `-t N` - Max agent turns (default: 50).
- `-w "/Users/fangjin/claude-workspace/WORKDIR_PLACEHOLDER"` - Working directory.

### Example

User asks: "用CC写一个从1加到10的python脚本"

```json
{
  "action": "run",
  "node": "MacMini",
  "command": [
    "/Users/fangjin/claude-code-dispatch.sh",
    "-p", "写一个Python脚本，计算从1加到10的和",
    "-n", "sum-1-to-10",
    "-g", "6564284621",
    "-P", "PORT_PLACEHOLDER",
    "-w", "/Users/fangjin/claude-workspace/WORKDIR_PLACEHOLDER"
  ]
}
```

After dispatching, tell the user the task is running and they will be notified when it completes.

## Check Task Progress

```json
{"action": "run", "node": "MacMini", "command": ["/Users/fangjin/claude-code-status.sh", "-n", "TASK_NAME", "-l", "20"]}
```

## List Active Tasks

```json
{"action": "run", "node": "MacMini", "command": ["/Users/fangjin/claude-code-list.sh"]}
```

## Stop a Task

```json
{"action": "run", "node": "MacMini", "command": ["/Users/fangjin/claude-code-stop.sh", "-n", "TASK_NAME"]}
```

## Read Final Results

```json
{"action": "run", "node": "MacMini", "command": ["cat", "/Users/fangjin/claude-code-results/latest.json"]}
```

## Completion Flow

When Claude Code finishes:
1. A Telegram notification is sent to the user (via relay bot)
2. Results are injected into your session history via chat.inject
3. You will see the completion in your conversation context

## Important Notes

- Runs independently - may take 1-30 minutes
- Don't wait - dispatch returns immediately
- Language - write the prompt in the user's language
- Always pass `-g` with the current chat ID
- Always pass `-P PORT_PLACEHOLDER` for this bot's Gateway port
- **command MUST be an array** - never pass it as a single string
