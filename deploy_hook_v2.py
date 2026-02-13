#!/usr/bin/env python3
"""Deploy updated hook (wake + message) and dispatch (telegram group support)"""
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

# ============================================================
# 1. Updated notify-openclaw.sh hook
# ============================================================
hook_sh = r'''#!/bin/bash
# Claude Code Stop Hook: notify AGI + send Telegram message
# Triggers: Stop (generation stopped) + SessionEnd (session ended)
# Adapted from github.com/win4r/claude-code-hooks for macOS

set -uo pipefail

RESULT_DIR="/Users/fangjin/claude-code-results"
META_FILE_DEFAULT="${RESULT_DIR}/task-meta.json"
LOG="${RESULT_DIR}/hook.log"
OPENCLAW_BIN="/opt/homebrew/bin/openclaw"
GATEWAY_URL="http://127.0.0.1:18789"
GATEWAY_TOKEN="mysecrettoken123"
JQ=/usr/bin/jq

mkdir -p "$RESULT_DIR"

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" >> "$LOG"; }

log "=== Hook fired ==="

# ---- Read stdin (Claude Code passes session info) ----
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

# ---- Deduplication: 30s lock ----
LOCK_FILE="${RESULT_DIR}/.hook-lock"
LOCK_AGE_LIMIT=30

if [ -f "$LOCK_FILE" ]; then
    # macOS stat: -f %m for modification time
    LOCK_TIME=$(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    AGE=$(( NOW - LOCK_TIME ))
    if [ "$AGE" -lt "$LOCK_AGE_LIMIT" ]; then
        log "Duplicate hook within ${AGE}s, skipping"
        exit 0
    fi
fi
touch "$LOCK_FILE"

# ---- Wait for tee pipe to flush ----
sleep 1

# ---- Read Claude Code output (multiple sources) ----
OUTPUT=""

# Source 1: task-output.txt in workdir (dispatch tee writes here)
if [ -n "$CWD" ] && [ -f "$CWD/task-output.txt" ] && [ -s "$CWD/task-output.txt" ]; then
    OUTPUT=$(tail -c 4000 "$CWD/task-output.txt")
    log "Output from $CWD/task-output.txt (${#OUTPUT} chars)"
fi

# Source 2: default result dir
if [ -z "$OUTPUT" ] && [ -f "${RESULT_DIR}/task-output.txt" ] && [ -s "${RESULT_DIR}/task-output.txt" ]; then
    OUTPUT=$(tail -c 4000 "${RESULT_DIR}/task-output.txt")
    log "Output from result dir fallback (${#OUTPUT} chars)"
fi

# Source 3: /tmp fallback
if [ -z "$OUTPUT" ] && [ -f "/tmp/claude-code-output.txt" ] && [ -s "/tmp/claude-code-output.txt" ]; then
    OUTPUT=$(tail -c 4000 /tmp/claude-code-output.txt)
    log "Output from /tmp fallback (${#OUTPUT} chars)"
fi

# Source 4: directory listing as last resort
if [ -z "$OUTPUT" ] && [ -n "$CWD" ] && [ -d "$CWD" ]; then
    FILES=$(ls -1t "$CWD" 2>/dev/null | head -20 | tr '\n' ', ')
    OUTPUT="Working dir: ${CWD}\nFiles: ${FILES}"
    log "Output from dir listing"
fi

# ---- Read task metadata ----
TASK_NAME="unknown"
TELEGRAM_GROUP=""
WORKDIR=""

# Try CWD first, then default location
META_FILE=""
if [ -n "$CWD" ] && [ -f "$CWD/task-meta.json" ]; then
    META_FILE="$CWD/task-meta.json"
elif [ -f "$META_FILE_DEFAULT" ]; then
    META_FILE="$META_FILE_DEFAULT"
fi

if [ -n "$META_FILE" ]; then
    TASK_NAME=$($JQ -r '.name // .task_name // "unknown"' "$META_FILE" 2>/dev/null || echo "unknown")
    TELEGRAM_GROUP=$($JQ -r '.telegram_group // ""' "$META_FILE" 2>/dev/null || echo "")
    WORKDIR=$($JQ -r '.workdir // ""' "$META_FILE" 2>/dev/null || echo "")
    log "Meta: task=$TASK_NAME group=$TELEGRAM_GROUP workdir=$WORKDIR"
fi

# ---- Write latest.json ----
$JQ -n \
    --arg sid "$SESSION_ID" \
    --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg cwd "$CWD" \
    --arg event "$EVENT" \
    --arg output "$OUTPUT" \
    --arg task "$TASK_NAME" \
    --arg group "$TELEGRAM_GROUP" \
    '{session_id: $sid, timestamp: $ts, cwd: $cwd, event: $event, output: $output, task_name: $task, telegram_group: $group, status: "done"}' \
    > "${RESULT_DIR}/latest.json" 2>/dev/null

log "Wrote latest.json"

# ---- Send Telegram message (if group specified) ----
if [ -n "$TELEGRAM_GROUP" ] && [ -x "$OPENCLAW_BIN" ]; then
    SUMMARY=$(echo "$OUTPUT" | tail -c 800 | tr '\n' ' ')
    MSG="Claude Code task done
Task: ${TASK_NAME}
Result:
\`\`\`
${SUMMARY:0:600}
\`\`\`"

    OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN" \
    OPENCLAW_GATEWAY="$GATEWAY_URL" \
    "$OPENCLAW_BIN" message send \
        --channel telegram \
        --target "$TELEGRAM_GROUP" \
        --message "$MSG" 2>/dev/null \
        && log "Sent Telegram message to $TELEGRAM_GROUP" \
        || log "Telegram send failed (non-fatal)"
fi

# ---- Write pending-wake.json (heartbeat fallback) ----
WAKE_FILE="${RESULT_DIR}/pending-wake.json"
$JQ -n \
    --arg task "$TASK_NAME" \
    --arg group "$TELEGRAM_GROUP" \
    --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg summary "$(echo "$OUTPUT" | head -c 500 | tr '\n' ' ')" \
    '{task_name: $task, telegram_group: $group, timestamp: $ts, summary: $summary, processed: false}' \
    > "$WAKE_FILE" 2>/dev/null

log "Wrote pending-wake.json"

# ---- Wake AGI via Gateway API ----
WAKE_TEXT="Claude Code task '${TASK_NAME}' completed. Read results from /Users/fangjin/claude-code-results/latest.json"
curl -s -X POST "${GATEWAY_URL}/api/cron/wake" \
    -H "Authorization: Bearer $GATEWAY_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"text\": $(echo "$WAKE_TEXT" | $JQ -Rs .), \"mode\": \"now\"}" \
    --max-time 5 \
    > /dev/null 2>&1 \
    && log "Wake event sent" \
    || log "Wake event failed (non-fatal, heartbeat fallback exists)"

log "=== Hook completed ==="
exit 0
'''

with sftp.file('/Users/fangjin/.claude/hooks/notify-openclaw.sh', 'w') as f:
    f.write(hook_sh)
print("[1/2] notify-openclaw.sh updated")

# ============================================================
# 2. Updated dispatch with -g telegram group support
# ============================================================
dispatch_sh = r'''#!/bin/bash
# claude-code-dispatch.sh - Dispatch Claude Code task in tmux session
export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:$PATH

PROMPT=""
TASK_NAME="task-$(date +%s)"
WORKDIR="/Users/fangjin/claude-workspace/alin"
MAX_TURNS=50
TELEGRAM_GROUP=""
TMUX=/opt/homebrew/bin/tmux
JQ=/usr/bin/jq

while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--prompt) PROMPT="$2"; shift 2;;
        -n|--name) TASK_NAME="$2"; shift 2;;
        -w|--workdir) WORKDIR="$2"; shift 2;;
        -t|--max-turns) MAX_TURNS="$2"; shift 2;;
        -g|--group) TELEGRAM_GROUP="$2"; shift 2;;
        *) shift;;
    esac
done

if [ -z "$PROMPT" ]; then
    echo '{"error": "prompt required (-p \"your prompt\")"}'
    exit 1
fi

SESSION_NAME="cc-${TASK_NAME}"
RESULTS_DIR="/Users/fangjin/claude-code-results"

$TMUX kill-session -t "$SESSION_NAME" 2>/dev/null
mkdir -p "$WORKDIR" "$RESULTS_DIR"

# Write task meta (hook reads this for telegram_group)
$JQ -n \
    --arg name "$TASK_NAME" \
    --arg session "$SESSION_NAME" \
    --arg prompt "$PROMPT" \
    --arg workdir "$WORKDIR" \
    --argjson max_turns "$MAX_TURNS" \
    --arg group "$TELEGRAM_GROUP" \
    --arg started "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{name: $name, session: $session, prompt: $prompt, workdir: $workdir, max_turns: $max_turns, telegram_group: $group, started_at: $started}' \
    > "$WORKDIR/task-meta.json"

# Also copy to results dir (hook checks both locations)
cp "$WORKDIR/task-meta.json" "$RESULTS_DIR/task-meta.json"

# Write prompt to file
PROMPT_FILE="$WORKDIR/.task-prompt.txt"
echo "$PROMPT" > "$PROMPT_FILE"

# Write runner script
RUNNER_FILE="$WORKDIR/.task-runner.sh"
cat > "$RUNNER_FILE" << 'RUNEOF'
#!/bin/bash
export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:$PATH
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null

PROMPT_FILE="$1"
WORKDIR="$2"
MAX_TURNS="$3"
RESULTS_DIR="$4"
TASK_NAME="$5"

PROMPT=$(cat "$PROMPT_FILE")
cd "$WORKDIR"

echo "========================================================"
echo "  Claude Code Task: $TASK_NAME"
echo "  Max Turns: $MAX_TURNS | Workdir: $WORKDIR"
echo "  Started: $(date)"
echo "========================================================"
echo ""

/opt/homebrew/bin/claude -p "$PROMPT" \
    --max-turns "$MAX_TURNS" \
    --verbose \
    --dangerously-skip-permissions \
    2>&1 | tee "$WORKDIR/task-output.txt"

EXIT_CODE=$?

echo ""
echo "========================================================"
echo "  TASK COMPLETE (exit: $EXIT_CODE) at $(date)"
echo "========================================================"

# Write completion result (hook also writes, this is backup)
/usr/bin/jq -n \
    --arg task_name "$TASK_NAME" \
    --arg workdir "$WORKDIR" \
    --argjson exit_code "$EXIT_CODE" \
    --arg completed_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{task_name: $task_name, workdir: $workdir, exit_code: $exit_code, completed_at: $completed_at, status: "completed"}' \
    > "$RESULTS_DIR/latest.json"

echo "Session stays alive 10min. Attach: tmux attach -t cc-$TASK_NAME"
sleep 600
RUNEOF
chmod +x "$RUNNER_FILE"

# Create tmux session
$TMUX new-session -d -s "$SESSION_NAME" -c "$WORKDIR" \
    "$RUNNER_FILE $PROMPT_FILE $WORKDIR $MAX_TURNS $RESULTS_DIR $TASK_NAME"

if $TMUX has-session -t "$SESSION_NAME" 2>/dev/null; then
    $JQ -n \
        --arg status "dispatched" \
        --arg task_name "$TASK_NAME" \
        --arg session "$SESSION_NAME" \
        --arg workdir "$WORKDIR" \
        --argjson max_turns "$MAX_TURNS" \
        --arg group "$TELEGRAM_GROUP" \
        '{status: $status, task_name: $task_name, session: $session, workdir: $workdir, max_turns: $max_turns, telegram_group: $group}'
else
    echo '{"error": "Failed to create tmux session"}'
    exit 1
fi
'''

with sftp.file('/Users/fangjin/claude-code-dispatch.sh', 'w') as f:
    f.write(dispatch_sh)
print("[2/2] claude-code-dispatch.sh updated")

# Make executable
stdin, stdout, stderr = client.exec_command(
    'chmod +x /Users/fangjin/.claude/hooks/notify-openclaw.sh '
    '/Users/fangjin/claude-code-dispatch.sh'
)
stdout.read()

sftp.close()
print("\n[DONE] Hook + dispatch updated")
client.close()
