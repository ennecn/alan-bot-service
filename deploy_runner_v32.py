#!/usr/bin/env python3
"""Deploy runner v3.2 + hook v7.4: move notifications from hook to runner.

Root cause: Stop hook fires ~36s before Claude Code actually exits and the
runner writes results. The hook can't read the result in time.

Fix: Runner sends Telegram + relay + chat.inject directly after task completes.
Hook becomes a no-op for task sessions (just logs and exits).
"""
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")
sftp = c.open_sftp()

# ============================================================
# 1. Write new runner script section in dispatch
# ============================================================
print("1. Patching dispatch script with runner v3.2...")

with sftp.open("/Users/fangjin/claude-code-dispatch.sh", "r") as f:
    dispatch = f.read().decode("utf-8")

# Replace the entire RUNEOF heredoc content
old_run_start = "cat > \"$RUNNER_FILE\" << 'RUNEOF'"
old_run_end = "RUNEOF"

if old_run_start not in dispatch:
    print("   ERROR: RUNEOF heredoc not found!")
    c.close()
    sys.exit(1)

start_idx = dispatch.index(old_run_start)
# Find the closing RUNEOF (it's on its own line)
end_search_start = start_idx + len(old_run_start)
end_idx = dispatch.index("\nRUNEOF\n", end_search_start) + len("\nRUNEOF\n")

new_runner = r"""cat > "$RUNNER_FILE" << 'RUNEOF'
#!/bin/bash
# Task runner v3.2 - sends notifications directly (no hook dependency)
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

# Read task-meta.json for telegram_group and gateway_port
TELEGRAM_GROUP=""
GATEWAY_PORT="18789"
if [ -f "$WORKDIR/task-meta.json" ]; then
    TELEGRAM_GROUP=$($JQ -r '.telegram_group // ""' "$WORKDIR/task-meta.json" 2>/dev/null || echo "")
    GATEWAY_PORT=$($JQ -r '.gateway_port // "18789"' "$WORKDIR/task-meta.json" 2>/dev/null || echo "18789")
fi

# Telegram config
TG_BOT_TOKEN="8586496186:AAF5ZlW1811IbPKwvMr2FzeTmI7VIjDwTls"
TG_PROXY_IP="138.68.44.141"
TG_API="https://api.telegram.org/bot${TG_BOT_TOKEN}"
RELAY_BOT_TOKEN="7589272367:AAGYC28tn02qps-usiTiBnI0E-PktyxSrVs"
RELAY_CHAT_ID="-1003849405283"
RELAY_API="https://api.telegram.org/bot${RELAY_BOT_TOKEN}"

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

# ---- Run Claude Code ----
echo "[runner v3.2] Running with pipe-based output + direct notifications"

eval "$CLAUDE_CMD" 2>"$WORKDIR/task-output.txt" | tee "$WORKDIR/claude-result.txt"
EXIT_CODE=${PIPESTATUS[0]}

# Copy result to results dir + write completion marker
cp "$WORKDIR/claude-result.txt" "$RESULTS_DIR/claude-result.txt" 2>/dev/null
touch "$WORKDIR/.task-complete"

echo ""
echo "========================================================"
echo "  TASK COMPLETE (exit: $EXIT_CODE) at $(date)"
echo "  Result saved to: $WORKDIR/claude-result.txt"
echo "========================================================"

# ---- Send notifications directly from runner ----
CLEAN_RESULT=""
if [ -f "$WORKDIR/claude-result.txt" ] && [ -s "$WORKDIR/claude-result.txt" ]; then
    CLEAN_RESULT=$(cat "$WORKDIR/claude-result.txt")
fi

# Telegram notification to group (if configured)
if [ -n "$TELEGRAM_GROUP" ]; then
    if [ -n "$CLEAN_RESULT" ]; then
        SUMMARY=$(echo "$CLEAN_RESULT" | tail -c 600 | tr '\n' ' ')
    else
        SUMMARY="(no output)"
    fi
    MSG="Claude Code task done
Task: ${TASK_NAME}
Result:
${SUMMARY:0:500}"
    curl -s \
        --resolve "api.telegram.org:443:${TG_PROXY_IP}" \
        "${TG_API}/sendMessage" \
        --data-urlencode "chat_id=${TELEGRAM_GROUP}" \
        --data-urlencode "text=${MSG}" \
        --max-time 10 > /dev/null 2>&1 \
        && echo "[runner] Telegram sent to $TELEGRAM_GROUP" \
        || echo "[runner] Telegram send failed"
fi

# Relay clean result to Claude_test group
if [ -n "$CLEAN_RESULT" ]; then
    CONTENT_LEN=${#CLEAN_RESULT}
    if [ "$CONTENT_LEN" -gt 4000 ]; then
        RELAY_FILE="${RESULTS_DIR}/relay-${TASK_NAME}.txt"
        echo "$CLEAN_RESULT" > "$RELAY_FILE"
        CAPTION="[${TASK_NAME}] Claude Code result (${CONTENT_LEN} chars)"
        curl -s \
            --resolve "api.telegram.org:443:${TG_PROXY_IP}" \
            "${RELAY_API}/sendDocument" \
            -F "chat_id=${RELAY_CHAT_ID}" \
            -F "caption=${CAPTION}" \
            -F "document=@${RELAY_FILE};filename=${TASK_NAME}-result.txt" \
            --max-time 30 > /dev/null 2>&1 \
            && echo "[runner] Relay: sent document" \
            || echo "[runner] Relay: document send failed"
        rm -f "$RELAY_FILE"
    else
        RELAY_MSG="[${TASK_NAME}]
${CLEAN_RESULT}"
        curl -s \
            --resolve "api.telegram.org:443:${TG_PROXY_IP}" \
            "${RELAY_API}/sendMessage" \
            --data-urlencode "chat_id=${RELAY_CHAT_ID}" \
            --data-urlencode "text=${RELAY_MSG}" \
            --max-time 10 > /dev/null 2>&1 \
            && echo "[runner] Relay: sent to Claude_test" \
            || echo "[runner] Relay: send failed"
    fi
else
    echo "[runner] Relay: no content"
fi

# Chat.inject into bot session (background, 15s delay)
if [ -n "$TELEGRAM_GROUP" ]; then
    case "$TELEGRAM_GROUP" in
        -*)  SESSION_KEY="agent:main:telegram:group:${TELEGRAM_GROUP}" ;;
        *)   SESSION_KEY="agent:main:telegram:dm:${TELEGRAM_GROUP}" ;;
    esac
    if [ -n "$CLEAN_RESULT" ]; then
        RESULT_SUMMARY=$(echo "$CLEAN_RESULT" | head -c 800 | tr '\n' ' ')
    else
        RESULT_SUMMARY="(no output)"
    fi
    INJECT_TEXT="[Background] Task '${TASK_NAME}' completed. User notified via Telegram.
Working dir: ${WORKDIR}
Status: done (exit_code=${EXIT_CODE})
Summary: ${RESULT_SUMMARY}"

    (
        /opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "$INJECT_TEXT" "$SESSION_KEY" 15000 3 "$GATEWAY_PORT" \
            > /dev/null 2>&1 \
            && echo "[runner] Chat.inject sent" \
            || echo "[runner] Chat.inject failed (non-fatal)"
    ) &
fi

# Mark task as processed (prevents hook from re-processing)
touch "${RESULTS_DIR}/.processed-${TASK_NAME}"
mv "$WORKDIR/task-meta.json" "$WORKDIR/task-meta.json.done" 2>/dev/null || true
mv "${RESULTS_DIR}/task-meta.json" "${RESULTS_DIR}/task-meta.json.done" 2>/dev/null || true

# Write completion result
$JQ -n \
    --arg task_name "$TASK_NAME" \
    --arg workdir "$WORKDIR" \
    --argjson exit_code "$EXIT_CODE" \
    --arg completed_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{task_name: $task_name, workdir: $workdir, exit_code: $exit_code, completed_at: $completed_at, status: "completed"}' \
    > "$RESULTS_DIR/latest.json"

echo "Session stays alive 10min. Attach: tmux attach -t cc-$TASK_NAME"
sleep 600
RUNEOF
"""

dispatch = dispatch[:start_idx] + new_runner + dispatch[end_idx:]

with sftp.open("/Users/fangjin/claude-code-dispatch.sh", "wb") as f:
    f.write(dispatch.encode("utf-8"))

si, so, se = c.exec_command('grep "v3.2\\|direct notifications\\|Relay.*Claude_test" /Users/fangjin/claude-code-dispatch.sh | head -3')
print(f"   Markers: {so.read().decode().strip()}")

# ============================================================
# 2. Simplify hook: no-op for task sessions
# ============================================================
print("\n2. Writing simplified hook v7.4 (no-op for task sessions)...")

hook_content = r"""#!/bin/bash
# Claude Code Stop Hook v7.4: task notifications moved to runner
# This hook only handles non-task sessions (manual Claude Code usage)
# Task sessions are handled by runner v3.2 directly

set -uo pipefail

RESULT_DIR="/Users/fangjin/claude-code-results"
LOG="${RESULT_DIR}/hook.log"
JQ=/usr/bin/jq

mkdir -p "$RESULT_DIR"
log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" >> "$LOG"; }

log "=== Hook v7.4 fired ==="

INPUT=""
if [ -t 0 ]; then
    log "stdin is tty, skip"
elif [ -e /dev/stdin ]; then
    INPUT=$(timeout 2 cat /dev/stdin 2>/dev/null || cat /dev/stdin 2>/dev/null || true)
fi

SESSION_ID=$(echo "$INPUT" | $JQ -r '.session_id // "unknown"' 2>/dev/null || echo "unknown")
CWD=$(echo "$INPUT" | $JQ -r '.cwd // ""' 2>/dev/null || echo "")
EVENT=$(echo "$INPUT" | $JQ -r '.hook_event_name // "unknown"' 2>/dev/null || echo "unknown")
log "session=$SESSION_ID cwd=$CWD event=$EVENT"

# Task sessions: runner v3.2 handles notifications directly, skip here
if [ -n "$CWD" ] && [ -f "$CWD/task-meta.json" ]; then
    log "Task session (task-meta.json in cwd), runner handles notifications. Skipping."
    exit 0
fi
if [ -n "$CWD" ] && [ -f "$CWD/task-meta.json.done" ]; then
    log "Completed task session (task-meta.json.done in cwd). Skipping."
    exit 0
fi
if [ -f "${RESULT_DIR}/task-meta.json" ]; then
    TASK=$($JQ -r '.name // "unknown"' "${RESULT_DIR}/task-meta.json" 2>/dev/null || echo "unknown")
    SAFE_T=$(echo "$TASK" | tr -cd "a-zA-Z0-9_-" | head -c 60)
    if [ -f "${RESULT_DIR}/.processed-${SAFE_T}" ]; then
        log "Task $TASK already processed. Skipping."
        exit 0
    fi
fi

log "Non-task session, no action needed"
exit 0
"""

with sftp.open("/Users/fangjin/.claude/hooks/notify-openclaw.sh", "wb") as f:
    f.write(hook_content.encode("utf-8"))
sftp.close()

si, so, se = c.exec_command("chmod +x /Users/fangjin/.claude/hooks/notify-openclaw.sh")
so.read()

si, so, se = c.exec_command('head -3 /Users/fangjin/.claude/hooks/notify-openclaw.sh')
print(f"   Header: {so.read().decode().strip()}")
si, so, se = c.exec_command("wc -l /Users/fangjin/.claude/hooks/notify-openclaw.sh")
print(f"   Lines: {so.read().decode().strip()}")

# ============================================================
# 3. Clean up
# ============================================================
print("\n3. Cleaning stale files...")
cleanup = (
    "rm -f /Users/fangjin/claude-code-results/claude-result.txt "
    "/Users/fangjin/claude-code-results/.processed-* "
    "/Users/fangjin/claude-code-results/.hook-lock-* "
    "/Users/fangjin/claude-code-results/task-meta.json "
    "/Users/fangjin/claude-code-results/task-meta.json.done "
    "/Users/fangjin/claude-workspace/alin/claude-result.txt "
    "/Users/fangjin/claude-workspace/alin/task-output.txt "
    "/Users/fangjin/claude-workspace/alin/task-meta.json "
    "/Users/fangjin/claude-workspace/alin/task-meta.json.done "
    "/Users/fangjin/claude-workspace/alin/.task-complete"
)
si, so, se = c.exec_command(cleanup)
so.read()
print("   Done")

c.close()
print("\nDeployed runner v3.2 + hook v7.4!")
print("- Runner sends Telegram + relay + chat.inject directly after task completes")
print("- Hook is now a simple no-op for task sessions")
print("- No more timing issues between hook and runner")
