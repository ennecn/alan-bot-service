#!/usr/bin/env python3
"""Hook v6 + Runner v3: capture Claude Code clean result + relay to Telegram group.

Changes:
1. Runner v3: splits stdout (clean result) -> claude-result.txt, stderr (verbose) -> task-output.txt
2. Hook v6: reads claude-result.txt and relays to Claude_test group via @Claudebigboss_bot
"""
import paramiko
import re

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

# ============================================================
# 1. New runner script (replaces the RUNEOF block in dispatch)
# ============================================================
RUNNER_V3 = r'''#!/bin/bash
# Task runner v3 - splits clean result from verbose output
# stdout (clean result) -> claude-result.txt
# stderr (verbose) -> task-output.txt + tmux display
export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:$PATH
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null

PROMPT_FILE="$1"
WORKDIR="$2"
MAX_TURNS="$3"
RESULTS_DIR="$4"
TASK_NAME="$5"
PERMISSION_MODE="$6"

PROMPT=$(cat "$PROMPT_FILE")
CLAUDE=/opt/homebrew/bin/claude
JQ=/usr/bin/jq

cd "$WORKDIR"

echo "========================================================"
echo "  Claude Code Task: $TASK_NAME"
echo "  Max Turns: $MAX_TURNS | Workdir: $WORKDIR"
echo "  Permission: ${PERMISSION_MODE:-dangerously-skip-permissions}"
echo "  Started: $(date)"
echo "========================================================"
echo ""

# ---- Build claude command ----
CLAUDE_CMD="$CLAUDE -p \"$PROMPT\" --max-turns $MAX_TURNS --verbose"

if [ -n "$PERMISSION_MODE" ]; then
    CLAUDE_CMD="$CLAUDE_CMD --permission-mode $PERMISSION_MODE"
else
    CLAUDE_CMD="$CLAUDE_CMD --dangerously-skip-permissions"
fi

# ---- Run Claude Code with split streams ----
# With --verbose: stderr = verbose debug, stdout = clean result text
# We capture them separately:
#   stdout -> tee claude-result.txt (also visible in tmux)
#   stderr -> tee task-output.txt (also visible in tmux via >&2)
echo "[runner] Running with split output capture (v3)"

eval "$CLAUDE_CMD" \
    > >(tee "$WORKDIR/claude-result.txt") \
    2> >(tee "$WORKDIR/task-output.txt" >&2)
EXIT_CODE=$?

# Wait for tee processes to flush
sleep 1

# Also copy result to results dir for hook
cp "$WORKDIR/claude-result.txt" "$RESULTS_DIR/claude-result.txt" 2>/dev/null

echo ""
echo "========================================================"
echo "  TASK COMPLETE (exit: $EXIT_CODE) at $(date)"
echo "  Result saved to: $WORKDIR/claude-result.txt"
echo "========================================================"

# Write completion result
$JQ -n \
    --arg task_name "$TASK_NAME" \
    --arg workdir "$WORKDIR" \
    --argjson exit_code "$EXIT_CODE" \
    --arg completed_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{task_name: $task_name, workdir: $workdir, exit_code: $exit_code, completed_at: $completed_at, status: "completed"}' \
    > "$RESULTS_DIR/latest.json"

echo "Session stays alive 10min. Attach: tmux attach -t cc-$TASK_NAME"
sleep 600'''

# ============================================================
# 2. Hook v6 - reads claude-result.txt for relay
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
L("# Claude Code Stop Hook v6: per-session dedup + relay clean result to Claude_test")
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
L("# Relay bot (sends clean Claude Code output to Claude_test group)")
L('RELAY_BOT_TOKEN="7589272367:AAGYC28tn02qps-usiTiBnI0E-PktyxSrVs"')
L('RELAY_CHAT_ID="-1003849405283"')
L('RELAY_API="https://api.telegram.org/bot${RELAY_BOT_TOKEN}"')
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
L("# Per-session 30s dedup lock")
L('SAFE_SID=$(echo "$SESSION_ID" | tr -cd "a-zA-Z0-9_-" | head -c 60)')
L('LOCK_FILE="${RESULT_DIR}/.hook-lock-${SAFE_SID}"')
L('if [ -f "$LOCK_FILE" ]; then')
L('    LOCK_TIME=$(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0)')
L("    NOW=$(date +%s)")
L("    AGE=$(( NOW - LOCK_TIME ))")
L('    if [ "$AGE" -lt 30 ]; then')
L('        log "Duplicate hook for session $SAFE_SID within ${AGE}s, skipping"')
L("        exit 0")
L("    fi")
L("fi")
L('touch "$LOCK_FILE"')
L('find "$RESULT_DIR" -name ".hook-lock-*" -mmin +5 -delete 2>/dev/null || true')
L("")
L("sleep 2")
L("")
L("# Read verbose output (for summary/inject)")
L('OUTPUT=""')
L('if [ -n "$CWD" ] && [ -f "$CWD/task-output.txt" ] && [ -s "$CWD/task-output.txt" ]; then')
L('    OUTPUT=$(tail -c 4000 "$CWD/task-output.txt")')
L('elif [ -f "${RESULT_DIR}/task-output.txt" ] && [ -s "${RESULT_DIR}/task-output.txt" ]; then')
L('    OUTPUT=$(tail -c 4000 "${RESULT_DIR}/task-output.txt")')
L("fi")
L("")
L("# Read CLEAN result (stdout captured by runner v3)")
L('CLEAN_RESULT=""')
L('if [ -n "$CWD" ] && [ -f "$CWD/claude-result.txt" ] && [ -s "$CWD/claude-result.txt" ]; then')
L('    CLEAN_RESULT=$(cat "$CWD/claude-result.txt")')
L('    log "Clean result: ${#CLEAN_RESULT} chars from $CWD/claude-result.txt"')
L('elif [ -f "${RESULT_DIR}/claude-result.txt" ] && [ -s "${RESULT_DIR}/claude-result.txt" ]; then')
L('    CLEAN_RESULT=$(cat "${RESULT_DIR}/claude-result.txt")')
L('    log "Clean result: ${#CLEAN_RESULT} chars from results dir"')
L("else")
L('    log "No claude-result.txt found"')
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
L("")
L("# Per-task result file")
L('SAFE_TASK=$(echo "$TASK_NAME" | tr -cd "a-zA-Z0-9_-" | head -c 60)')
L('if [ -n "$SAFE_TASK" ] && [ "$SAFE_TASK" != "unknown" ]; then')
L("    $JQ -n \\")
L('        --arg sid "$SESSION_ID" --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \\')
L('        --arg cwd "$CWD" --arg event "$EVENT" --arg output "$OUTPUT" \\')
L('        --arg task "$TASK_NAME" --arg group "$TELEGRAM_GROUP" --arg port "$GATEWAY_PORT" \\')
L("        '{session_id: $sid, timestamp: $ts, cwd: $cwd, event: $event, output: $output, task_name: $task, telegram_group: $group, gateway_port: $port, status: \"done\"}' \\")
L('        > "${RESULT_DIR}/result-${SAFE_TASK}.json" 2>/dev/null')
L("fi")
L("")
L("# Telegram notification (to user's chat)")
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
L("# ===== Relay CLEAN result to Claude_test group =====")
L('RELAY_CONTENT=""')
L('if [ -n "$CLEAN_RESULT" ]; then')
L('    RELAY_CONTENT="$CLEAN_RESULT"')
L('    log "Relay: using clean result"')
L('elif [ -n "$OUTPUT" ]; then')
L('    RELAY_CONTENT="$OUTPUT"')
L('    log "Relay: fallback to verbose output"')
L("fi")
L("")
L('if [ -n "$RELAY_CONTENT" ]; then')
L('    CONTENT_LEN=${#RELAY_CONTENT}')
L('    log "Relay: content=$CONTENT_LEN chars"')
L('    if [ "$CONTENT_LEN" -gt 4000 ]; then')
L('        RELAY_FILE="${RESULT_DIR}/relay-${SAFE_TASK:-output}.txt"')
L('        echo "$RELAY_CONTENT" > "$RELAY_FILE"')
L('        CAPTION="[${TASK_NAME}] Claude Code result (${CONTENT_LEN} chars)"')
L("        curl -s \\")
L('            --resolve "api.telegram.org:443:${TG_PROXY_IP}" \\')
L('            "${RELAY_API}/sendDocument" \\')
L('            -F "chat_id=${RELAY_CHAT_ID}" \\')
L('            -F "caption=${CAPTION}" \\')
L('            -F "document=@${RELAY_FILE};filename=${TASK_NAME}-result.txt" \\')
L("            --max-time 30 > /dev/null 2>&1 \\")
L('            && log "Relay: sent document to Claude_test" \\')
L('            || log "Relay: document send failed"')
L('        rm -f "$RELAY_FILE"')
L("    else")
L('        RELAY_MSG="[${TASK_NAME}]')
L('${RELAY_CONTENT}"')
L("        curl -s \\")
L('            --resolve "api.telegram.org:443:${TG_PROXY_IP}" \\')
L('            "${RELAY_API}/sendMessage" \\')
L('            --data-urlencode "chat_id=${RELAY_CHAT_ID}" \\')
L('            --data-urlencode "text=${RELAY_MSG}" \\')
L("            --max-time 10 > /dev/null 2>&1 \\")
L('            && log "Relay: sent to Claude_test" \\')
L('            || log "Relay: send failed"')
L("    fi")
L("else")
L('    log "Relay: no content"')
L("fi")
L("")
L("# Inject results into bot session history")
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
# 3. Deploy
# ============================================================
print("Deploying hook v6 + runner v3...")

# Deploy hook
print("\n1. Deploying hook v6...")
sftp = c.open_sftp()
with sftp.open("/Users/fangjin/.claude/hooks/notify-openclaw.sh", "wb") as f:
    f.write(HOOK_CONTENT.encode("utf-8"))
sftp.close()
si, so, se = c.exec_command("chmod +x /Users/fangjin/.claude/hooks/notify-openclaw.sh")
so.read()

si, so, se = c.exec_command("grep -c 'v6' /Users/fangjin/.claude/hooks/notify-openclaw.sh")
ver = so.read().decode().strip()
print(f"   Hook: {'v6 OK' if ver == '1' else 'WARNING'}")
si, so, se = c.exec_command("grep 'RELAY_BOT\\|RELAY_CHAT\\|claude-result' /Users/fangjin/.claude/hooks/notify-openclaw.sh | head -5")
print(f"   Config: {so.read().decode().strip()}")

# Deploy runner v3 by patching dispatch script
print("\n2. Patching dispatch with runner v3...")
sftp2 = c.open_sftp()
with sftp2.open("/Users/fangjin/claude-code-dispatch.sh", "r") as f:
    dispatch_content = f.read().decode("utf-8")

# Backup
with sftp2.open("/Users/fangjin/claude-code-dispatch.sh.bak-v2", "wb") as f:
    f.write(dispatch_content.encode("utf-8"))

# Replace RUNEOF heredoc block
pattern = r"cat > \"\$RUNNER_FILE\" << 'RUNEOF'\n.*?\nRUNEOF"
match = re.search(pattern, dispatch_content, re.DOTALL)
if match:
    replacement = "cat > \"$RUNNER_FILE\" << 'RUNEOF'\n" + RUNNER_V3 + "\nRUNEOF"
    new_dispatch = dispatch_content[:match.start()] + replacement + dispatch_content[match.end():]
    with sftp2.open("/Users/fangjin/claude-code-dispatch.sh", "wb") as f:
        f.write(new_dispatch.encode("utf-8"))
    print("   PATCHED dispatch with runner v3")
else:
    print("   ERROR: RUNEOF block not found!")
sftp2.close()

si, so, se = c.exec_command("chmod +x /Users/fangjin/claude-code-dispatch.sh")
so.read()

# Verify
si, so, se = c.exec_command("grep 'runner v3\\|claude-result\\|split.*output' /Users/fangjin/claude-code-dispatch.sh | head -5")
print(f"   Markers: {so.read().decode().strip()}")
si, so, se = c.exec_command("grep -c 'claude-result.txt' /Users/fangjin/claude-code-dispatch.sh")
print(f"   claude-result.txt refs: {so.read().decode().strip()}")

print("\n3. Line counts:")
si, so, se = c.exec_command("wc -l /Users/fangjin/.claude/hooks/notify-openclaw.sh")
print(f"   Hook: {so.read().decode().strip()}")
si, so, se = c.exec_command("wc -l /Users/fangjin/claude-code-dispatch.sh")
print(f"   Dispatch: {so.read().decode().strip()}")

c.close()
print("\nDone! Hook v6 + runner v3 deployed.")
print("- claude-result.txt: clean Claude Code output (stdout)")
print("- task-output.txt: verbose debug output (stderr)")
print("- Relay sends claude-result.txt to Claude_test group")
