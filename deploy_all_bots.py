#!/usr/bin/env python3
"""Deploy Claude Code integration to all 4 OpenClaw bots on Mac Mini.
Updates: dispatch script, inject.js, hook, and SKILL.md for each bot."""
import paramiko

# Bot configurations
BOTS = {
    "deploy": {"name": "alin", "label": "\u963f\u51db", "port": 18789, "dir": "deploy"},
    "aling":  {"name": "aling", "label": "\u963f\u6fa0", "port": 18791, "dir": "deploy-aling"},
    "lain":   {"name": "lain", "label": "Lain", "port": 18790, "dir": "deploy-lain"},
    "lumi":   {"name": "lumi", "label": "Lumi", "port": 18792, "dir": "deploy-lumi"},
}

SKILL_BASE = "/Users/fangjin/Desktop/p/docker-openclawd"

# ============================================================
# 1. inject.js v10 - accepts port as 6th argument
# ============================================================
INJECT_JS = r'''#!/usr/bin/env node
// claude-code-inject.js v10 - chat.inject with configurable port
// Usage: node inject.js <message> <sessionKey> [delayMs] [maxRetries] [port]
const message = process.argv[2];
const sessionKeyOrMethod = process.argv[3] || 'wake';
const delayMs = parseInt(process.argv[4] || '0', 10);
const maxRetries = parseInt(process.argv[5] || '3', 10);
const port = process.argv[6] || '18789';
if (!message) { console.error('Usage: node inject.js <message> <sessionKey> [delayMs] [maxRetries] [port]'); process.exit(1); }

const isWake = sessionKeyOrMethod === 'wake';
const GATEWAY_URL = `ws://127.0.0.1:${port}`;
const GATEWAY_PASSWORD = process.env.OPENCLAW_GATEWAY_PASSWORD || 'openclaw123';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function trySend(attempt) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL);
    let step = 'connecting';
    const timer = setTimeout(() => { ws.close(); reject(new Error('TIMEOUT at ' + step)); }, 8000);
    ws.addEventListener('open', () => { step = 'waiting-challenge'; });
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          step = 'sending-connect';
          ws.send(JSON.stringify({
            type: 'req', id: 'c1', method: 'connect',
            params: { minProtocol: 3, maxProtocol: 3, client: { id: 'gateway-client', version: '1.0.0', platform: 'node', mode: 'backend' }, auth: { password: GATEWAY_PASSWORD } }
          }));
          return;
        }
        if (msg.type === 'res' && msg.id === 'c1') {
          if (!msg.ok) { clearTimeout(timer); ws.close(); reject(new Error('Connect failed: ' + JSON.stringify(msg.error))); return; }
          step = 'sending-action';
          if (isWake) {
            ws.send(JSON.stringify({ type: 'req', id: 'w1', method: 'wake', params: { mode: 'now', text: message } }));
          } else {
            ws.send(JSON.stringify({ type: 'req', id: 'w1', method: 'chat.inject', params: { sessionKey: sessionKeyOrMethod, message: message } }));
          }
          return;
        }
        if (msg.type === 'res' && msg.id === 'w1') {
          clearTimeout(timer); step = 'done';
          if (!msg.ok) { ws.close(); reject(new Error('Action failed: ' + JSON.stringify(msg.error))); return; }
          ws.close(); resolve('OK');
        }
      } catch(e) { clearTimeout(timer); ws.close(); reject(e); }
    });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error('WS error: ' + (e.message || e.type))); });
    ws.addEventListener('close', () => { clearTimeout(timer); });
  });
}

(async () => {
  if (delayMs > 0) await sleep(delayMs);
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await trySend(attempt);
      console.log(result);
      process.exit(0);
    } catch (e) {
      console.error('Attempt ' + attempt + '/' + maxRetries + ' failed: ' + e.message);
      if (attempt < maxRetries) await sleep(3000);
    }
  }
  console.error('All retries exhausted');
  process.exit(1);
})();
'''

# ============================================================
# 2. SKILL.md template (per-bot, with port and workspace)
# ============================================================
def make_skill(bot_name, bot_label, port, workspace):
    return f'''---
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

Use the `nodes` tool to run the dispatch script on MacMini:

```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-dispatch.sh -p \\"TASK_DESCRIPTION\\" -n \\"TASK_NAME\\" -g \\"TELEGRAM_CHAT_ID\\" -P {port} -t MAX_TURNS -w {workspace}")
```

**Parameters:**
- `-p "prompt"` — **Required.** Detailed task description. Write in the user's language.
- `-n "name"` — Short task name for tracking (default: `task-<timestamp>`)
- `-g "chat_id"` — Telegram chat ID for completion notification.
- `-P {port}` — **Always pass this.** Gateway WebSocket port for this bot.
- `-t N` — Max agent turns (default: 50).
- `-w "{workspace}"` — Working directory.

After dispatching, tell the user the task is running and they'll be notified when it completes.

## Check Task Progress

```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-status.sh -n TASK_NAME -l 20")
```

## List Active Tasks

```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-list.sh")
```

## Stop a Task

```
nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-stop.sh -n TASK_NAME")
```

## Read Final Results

```
nodes(action="run", node="MacMini", command="cat /Users/fangjin/claude-code-results/latest.json")
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
'''


# ============================================================
# 3. Build hook script (port-aware)
# ============================================================
_TC = "\u4efb\u52a1\u5b8c\u6210"
_TK = "\u4efb\u52a1"
_OK = "\u5df2\u5b8c\u6210"
_RN = "\u7ed3\u679c\u5df2\u901a\u8fc7 Telegram \u901a\u77e5\u7528\u6237"
_WD = "\u5de5\u4f5c\u76ee\u5f55"
_TS = "\u4efb\u52a1\u72b6\u6001"
_SM = "\u8f93\u51fa\u6458\u8981"

INJECT_LINE = (
    '    INJECT_TEXT="[{tc}] {tk} \'${{TASK_NAME}}\' {ok}\u3002{rn}\u3002\n'
    '{wd}: ${{CWD}}\n'
    '{ts}: {ok} (exit_code=0)\n'
    '{sm}: ${{RESULT_SUMMARY}}"'
).format(tc=_TC, tk=_TK, ok=_OK, rn=_RN, wd=_WD, ts=_TS, sm=_SM)

lines = []
def L(s=""): lines.append(s)

L("#!/bin/bash")
L("# Claude Code Stop Hook v4: multi-bot support with gateway_port")
L("")
L("set -uo pipefail")
L("")
L('RESULT_DIR="/Users/fangjin/claude-code-results"')
L('LOG="${RESULT_DIR}/hook.log"')
L("JQ=/usr/bin/jq")
L('TG_BOT_TOKEN="8586496186:AAF5ZlW1811IbPKwvMr2FzeTmI7VIjDwTls"')
L('TG_PROXY_IP="138.68.44.141"')
L('TG_API="https://api.telegram.org/bot${TG_BOT_TOKEN}"')
L("")
L('mkdir -p "$RESULT_DIR"')
L('log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" >> "$LOG"; }')
L("")
L('log "=== Hook fired ==="')
L("")
L('INPUT=""')
L("if [ -t 0 ]; then")
L('    log "stdin is tty, skip"')
L("elif [ -e /dev/stdin ]; then")
L('    INPUT=$(timeout 2 cat /dev/stdin 2>/dev/null || cat /dev/stdin 2>/dev/null || true)')
L("fi")
L("")
L('SESSION_ID=$(echo "$INPUT" | $JQ -r \'.session_id // "unknown"\' 2>/dev/null || echo "unknown")')
L('CWD=$(echo "$INPUT" | $JQ -r \'.cwd // ""\' 2>/dev/null || echo "")')
L('EVENT=$(echo "$INPUT" | $JQ -r \'.hook_event_name // "unknown"\' 2>/dev/null || echo "unknown")')
L('log "session=$SESSION_ID cwd=$CWD event=$EVENT"')
L("")
L("# Deduplication: 30s lock")
L('LOCK_FILE="${RESULT_DIR}/.hook-lock"')
L('if [ -f "$LOCK_FILE" ]; then')
L('    LOCK_TIME=$(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0)')
L("    NOW=$(date +%s)")
L("    AGE=$(( NOW - LOCK_TIME ))")
L('    if [ "$AGE" -lt 30 ]; then')
L('        log "Duplicate hook within ${AGE}s, skipping"')
L("        exit 0")
L("    fi")
L("fi")
L('touch "$LOCK_FILE"')
L("sleep 2")
L("")
L("# Read output")
L('OUTPUT=""')
L('if [ -n "$CWD" ] && [ -f "$CWD/task-output.txt" ] && [ -s "$CWD/task-output.txt" ]; then')
L('    OUTPUT=$(tail -c 4000 "$CWD/task-output.txt")')
L('elif [ -f "${RESULT_DIR}/task-output.txt" ] && [ -s "${RESULT_DIR}/task-output.txt" ]; then')
L('    OUTPUT=$(tail -c 4000 "${RESULT_DIR}/task-output.txt")')
L('elif [ -n "$CWD" ] && [ -d "$CWD" ]; then')
L("    FILES=$(ls -1t \"$CWD\" 2>/dev/null | head -20 | tr '\\n' ', ')")
L('    OUTPUT="Working dir: ${CWD}  Files: ${FILES}"')
L("fi")
L("")
L("# Read task metadata")
L('TASK_NAME="unknown"')
L('TELEGRAM_GROUP=""')
L('GATEWAY_PORT="18789"')
L('META_FILE=""')
L('if [ -n "$CWD" ] && [ -f "$CWD/task-meta.json" ]; then')
L('    META_FILE="$CWD/task-meta.json"')
L('elif [ -f "${RESULT_DIR}/task-meta.json" ]; then')
L('    META_FILE="${RESULT_DIR}/task-meta.json"')
L("fi")
L('if [ -n "$META_FILE" ]; then')
L('    TASK_NAME=$($JQ -r \'.name // .task_name // "unknown"\' "$META_FILE" 2>/dev/null || echo "unknown")')
L('    TELEGRAM_GROUP=$($JQ -r \'.telegram_group // ""\' "$META_FILE" 2>/dev/null || echo "")')
L('    GATEWAY_PORT=$($JQ -r \'.gateway_port // "18789"\' "$META_FILE" 2>/dev/null || echo "18789")')
L('    log "Meta: task=$TASK_NAME group=$TELEGRAM_GROUP port=$GATEWAY_PORT"')
L("fi")
L("")
L("# Write latest.json")
L("$JQ -n \\")
L('    --arg sid "$SESSION_ID" --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \\')
L('    --arg cwd "$CWD" --arg event "$EVENT" --arg output "$OUTPUT" \\')
L('    --arg task "$TASK_NAME" --arg group "$TELEGRAM_GROUP" \\')
L("    '{session_id: $sid, timestamp: $ts, cwd: $cwd, event: $event, output: $output, task_name: $task, telegram_group: $group, status: \"done\"}' \\")
L('    > "${RESULT_DIR}/latest.json" 2>/dev/null')
L('log "Wrote latest.json"')
L("")
L("# Send Telegram message")
L('if [ -n "$TELEGRAM_GROUP" ]; then')
L("    SUMMARY=$(echo \"$OUTPUT\" | tail -c 600 | tr '\\n' ' ')")
L('    MSG="Claude Code task done')
L('Task: ${TASK_NAME}')
L('Result:')
L('${SUMMARY:0:500}"')
L("    curl -s \\")
L('        --resolve "api.telegram.org:443:${TG_PROXY_IP}" \\')
L('        "${TG_API}/sendMessage" \\')
L('        --data-urlencode "chat_id=${TELEGRAM_GROUP}" \\')
L('        --data-urlencode "text=${MSG}" \\')
L("        --max-time 10 > /dev/null 2>&1 \\")
L('        && log "Telegram sent to $TELEGRAM_GROUP" \\')
L('        || log "Telegram send failed"')
L("fi")
L("")
L("# Write pending-wake.json")
L("$JQ -n \\")
L('    --arg task "$TASK_NAME" --arg group "$TELEGRAM_GROUP" \\')
L('    --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \\')
L("    --arg summary \"$(echo \"$OUTPUT\" | head -c 500 | tr '\\n' ' ')\" \\")
L("    '{task_name: $task, telegram_group: $group, timestamp: $ts, summary: $summary, processed: false}' \\")
L('    > "${RESULT_DIR}/pending-wake.json" 2>/dev/null')
L("")
L("# Inject results into bot session history (chat.inject via WebSocket)")
L('if [ -n "$TELEGRAM_GROUP" ]; then')
L("    case \"$TELEGRAM_GROUP\" in")
L('        -*)  SESSION_KEY="agent:main:telegram:group:${TELEGRAM_GROUP}" ;;')
L('        *)   SESSION_KEY="agent:main:telegram:dm:${TELEGRAM_GROUP}" ;;')
L("    esac")
L("    RESULT_SUMMARY=$(echo \"$OUTPUT\" | head -c 800 | tr '\\n' ' ')")
lines.append(INJECT_LINE)
L("")
L("    (")
L('        /opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "$INJECT_TEXT" "$SESSION_KEY" 15000 3 "$GATEWAY_PORT" \\')
L('            >> "$LOG" 2>&1 \\')
L('            && log "Chat.inject sent to $SESSION_KEY (port=$GATEWAY_PORT)" \\')
L('            || log "Chat.inject failed (non-fatal)"')
L("    ) &")
L('    log "Chat.inject scheduled (15s delay, port=$GATEWAY_PORT)"')
L("else")
L('    log "No telegram_group, skipping"')
L("fi")
L("")
L('log "=== Hook completed ==="')
L("exit 0")

HOOK_CONTENT = "\n".join(lines) + "\n"

# ============================================================
# 4. Patch dispatch script to accept -P port
# ============================================================
DISPATCH_PATCH = '''
# Add -P/--port to dispatch script if not already present
DISPATCH="/Users/fangjin/claude-code-dispatch.sh"
if ! grep -q "gateway_port" "$DISPATCH" 2>/dev/null; then
    # Add GATEWAY_PORT variable
    sed -i '' 's/PERMISSION_MODE=""/PERMISSION_MODE=""\nGATEWAY_PORT="18789"/' "$DISPATCH"
    # Add -P case
    sed -i '' 's/-m|--permission-mode) PERMISSION_MODE="$2"; shift 2;;/-m|--permission-mode) PERMISSION_MODE="$2"; shift 2;;\n        -P|--port) GATEWAY_PORT="$2"; shift 2;;/' "$DISPATCH"
    # Add gateway_port to jq args in task-meta.json
    sed -i '' 's/--arg perm "$PERMISSION_MODE"/--arg perm "$PERMISSION_MODE" \\\n    --arg port "$GATEWAY_PORT"/' "$DISPATCH"
    # Add gateway_port to jq output
    sed -i '' 's/permission_mode: $perm/permission_mode: $perm, gateway_port: $port/' "$DISPATCH"
    echo "PATCHED dispatch script"
else
    echo "dispatch script already patched"
fi
'''

# ============================================================
# DEPLOY
# ============================================================
print("Connecting to Mac Mini...")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

# Deploy inject.js v10
print("\n1. Deploying inject.js v10...")
sftp = c.open_sftp()
with sftp.open("/Users/fangjin/claude-code-inject.js", "wb") as f:
    f.write(INJECT_JS.encode("utf-8"))
sftp.close()
si, so, se = c.exec_command("head -3 /Users/fangjin/claude-code-inject.js")
print("   " + so.read().decode().strip().split("\n")[1])

# Deploy hook v4
print("\n2. Deploying hook v4 (port-aware)...")
sftp = c.open_sftp()
with sftp.open("/Users/fangjin/.claude/hooks/notify-openclaw.sh", "wb") as f:
    f.write(HOOK_CONTENT.encode("utf-8"))
sftp.close()
si, so, se = c.exec_command("chmod +x /Users/fangjin/.claude/hooks/notify-openclaw.sh")
so.read()
si, so, se = c.exec_command("wc -l /Users/fangjin/.claude/hooks/notify-openclaw.sh")
print("   " + so.read().decode().strip())

# Patch dispatch script
print("\n3. Patching dispatch script...")
si, so, se = c.exec_command(f"bash -c '{DISPATCH_PATCH}'")
print("   " + so.read().decode().strip())
err = se.read().decode().strip()
if err:
    print("   stderr: " + err)

# Deploy SKILL.md to all 4 bots
print("\n4. Deploying SKILL.md to all bots...")
for bot_key, bot in BOTS.items():
    skill_dir = f"{SKILL_BASE}/{bot['dir']}/config/skills/claude-code"
    workspace = f"/Users/fangjin/claude-workspace/{bot['name']}"
    skill_content = make_skill(bot["name"], bot["label"], bot["port"], workspace)
    meta_content = f'{{"slug":"claude-code","name":"Claude Code (MacMini)","version":"3.0.0"}}\n'

    # Ensure workspace exists
    si, so, se = c.exec_command(f"mkdir -p {workspace}")
    so.read()

    # Write SKILL.md
    sftp = c.open_sftp()
    with sftp.open(f"{skill_dir}/SKILL.md", "wb") as f:
        f.write(skill_content.encode("utf-8"))
    with sftp.open(f"{skill_dir}/_meta.json", "wb") as f:
        f.write(meta_content.encode("utf-8"))
    sftp.close()

    print(f"   {bot['label']} ({bot_key}): port={bot['port']} workspace={workspace}")

# Verify
print("\n5. Verification...")
si, so, se = c.exec_command("head -3 /Users/fangjin/claude-code-inject.js")
print("   inject.js:", so.read().decode().strip().split("\n")[1])
si, so, se = c.exec_command("grep gateway_port /Users/fangjin/claude-code-dispatch.sh | head -2")
out = so.read().decode().strip()
print("   dispatch:", out if out else "NOT PATCHED (may need manual check)")
si, so, se = c.exec_command("grep GATEWAY_PORT /Users/fangjin/.claude/hooks/notify-openclaw.sh | head -1")
print("   hook:", so.read().decode().strip())

for bot_key, bot in BOTS.items():
    skill_dir = f"{SKILL_BASE}/{bot['dir']}/config/skills/claude-code"
    si, so, se = c.exec_command(f"grep '\\-P ' {skill_dir}/SKILL.md | head -1")
    line = so.read().decode().strip()
    has_port = str(bot["port"]) in line
    print(f"   {bot['label']}: port={bot['port']} in SKILL.md = {has_port}")

c.close()
print("\nDone! All 4 bots updated.")
