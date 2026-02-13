#!/usr/bin/env python3
"""Update hook to use Telegram Bot API directly via VPS proxy"""
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

hook_sh = r'''#!/bin/bash
# Claude Code Stop Hook: notify AGI + send Telegram message
# Triggers: Stop + SessionEnd
# Uses Telegram Bot API via VPS proxy (Mac Mini can't reach api.telegram.org directly)

set -uo pipefail

RESULT_DIR="/Users/fangjin/claude-code-results"
LOG="${RESULT_DIR}/hook.log"
JQ=/usr/bin/jq
GATEWAY_URL="http://127.0.0.1:18789"
GATEWAY_TOKEN="mysecrettoken123"

# Telegram Bot API (via VPS proxy to bypass GFW)
TG_BOT_TOKEN="8586496186:AAF5ZlW1811IbPKwvMr2FzeTmI7VIjDwTls"
TG_PROXY_IP="138.68.44.141"
TG_API="https://api.telegram.org/bot${TG_BOT_TOKEN}"

mkdir -p "$RESULT_DIR"

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" >> "$LOG"; }

log "=== Hook fired ==="

# ---- Read stdin ----
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
if [ -f "$LOCK_FILE" ]; then
    LOCK_TIME=$(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    AGE=$(( NOW - LOCK_TIME ))
    if [ "$AGE" -lt 30 ]; then
        log "Duplicate hook within ${AGE}s, skipping"
        exit 0
    fi
fi
touch "$LOCK_FILE"

# ---- Wait for tee pipe to flush ----
sleep 2

# ---- Read output (multiple sources) ----
OUTPUT=""

# Source 1: task-output.txt in CWD
if [ -n "$CWD" ] && [ -f "$CWD/task-output.txt" ] && [ -s "$CWD/task-output.txt" ]; then
    OUTPUT=$(tail -c 4000 "$CWD/task-output.txt")
    log "Output from $CWD/task-output.txt (${#OUTPUT} chars)"
fi

# Source 2: result dir fallback
if [ -z "$OUTPUT" ] && [ -f "${RESULT_DIR}/task-output.txt" ] && [ -s "${RESULT_DIR}/task-output.txt" ]; then
    OUTPUT=$(tail -c 4000 "${RESULT_DIR}/task-output.txt")
    log "Output from result dir (${#OUTPUT} chars)"
fi

# Source 3: directory listing
if [ -z "$OUTPUT" ] && [ -n "$CWD" ] && [ -d "$CWD" ]; then
    FILES=$(ls -1t "$CWD" 2>/dev/null | head -20 | tr '\n' ', ')
    OUTPUT="Working dir: ${CWD}\nFiles: ${FILES}"
    log "Output from dir listing"
fi

# ---- Read task metadata ----
TASK_NAME="unknown"
TELEGRAM_GROUP=""

META_FILE=""
if [ -n "$CWD" ] && [ -f "$CWD/task-meta.json" ]; then
    META_FILE="$CWD/task-meta.json"
elif [ -f "${RESULT_DIR}/task-meta.json" ]; then
    META_FILE="${RESULT_DIR}/task-meta.json"
fi

if [ -n "$META_FILE" ]; then
    TASK_NAME=$($JQ -r '.name // .task_name // "unknown"' "$META_FILE" 2>/dev/null || echo "unknown")
    TELEGRAM_GROUP=$($JQ -r '.telegram_group // ""' "$META_FILE" 2>/dev/null || echo "")
    log "Meta: task=$TASK_NAME group=$TELEGRAM_GROUP"
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

# ---- Send Telegram message via Bot API ----
if [ -n "$TELEGRAM_GROUP" ]; then
    SUMMARY=$(echo "$OUTPUT" | tail -c 600 | tr '\n' ' ')
    # Escape special chars for Telegram
    MSG="Claude Code task done
Task: ${TASK_NAME}
Result:
${SUMMARY:0:500}"

    TG_RESULT=$(curl -s \
        --resolve "api.telegram.org:443:${TG_PROXY_IP}" \
        "${TG_API}/sendMessage" \
        --data-urlencode "chat_id=${TELEGRAM_GROUP}" \
        --data-urlencode "text=${MSG}" \
        --max-time 10 2>&1)

    if echo "$TG_RESULT" | $JQ -e '.ok' > /dev/null 2>&1; then
        log "Telegram message sent to $TELEGRAM_GROUP"
    else
        log "Telegram send failed: $TG_RESULT"
    fi
fi

# ---- Write pending-wake.json (heartbeat fallback) ----
$JQ -n \
    --arg task "$TASK_NAME" \
    --arg group "$TELEGRAM_GROUP" \
    --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg summary "$(echo "$OUTPUT" | head -c 500 | tr '\n' ' ')" \
    '{task_name: $task, telegram_group: $group, timestamp: $ts, summary: $summary, processed: false}' \
    > "${RESULT_DIR}/pending-wake.json" 2>/dev/null

log "Wrote pending-wake.json"

# ---- Wake AGI via Gateway API ----
WAKE_TEXT="Claude Code task '${TASK_NAME}' completed. Read /Users/fangjin/claude-code-results/latest.json"
curl -s -X POST "${GATEWAY_URL}/api/cron/wake" \
    -H "Authorization: Bearer $GATEWAY_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"text\": $(echo "$WAKE_TEXT" | $JQ -Rs .), \"mode\": \"now\"}" \
    --max-time 5 \
    > /dev/null 2>&1 \
    && log "Wake event sent" \
    || log "Wake event failed (non-fatal)"

log "=== Hook completed ==="
exit 0
'''

with sftp.file('/Users/fangjin/.claude/hooks/notify-openclaw.sh', 'w') as f:
    f.write(hook_sh)
sftp.close()

stdin, stdout, stderr = client.exec_command('chmod +x /Users/fangjin/.claude/hooks/notify-openclaw.sh')
stdout.read()

print("[OK] Hook updated with Telegram Bot API via VPS proxy")
client.close()
