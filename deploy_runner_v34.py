#!/usr/bin/env python3
"""Deploy runner v3.4 to Mac Mini.
Changes from v3.3:
- Send relay notification to user's DM directly (TELEGRAM_GROUP as chat_id)
- Also send to group as backup
- Log relay/inject results to task-relay.log
- Fix Chinese character encoding (use Unicode escapes)
- Add retry for relay curl
"""
import paramiko
import sys

def run_cmd(cmd, timeout=30):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    client.close()
    return out, err

# The runner script content - using raw string to avoid escaping issues
RUNNER_CONTENT = r'''#!/bin/bash
# Task runner v3.4 - relay to user DM + group, with logging
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

# Derive bot name from workdir (ASCII-safe)
BOT_DIR=$(basename "$WORKDIR")
case "$BOT_DIR" in
    alin)  BOT_NAME="Alin" ;;
    aling) BOT_NAME="Aling" ;;
    lain)  BOT_NAME="Lain" ;;
    lumi)  BOT_NAME="Lumi" ;;
    *)     BOT_NAME="$BOT_DIR" ;;
esac

# Relay bot config (@Claudebigboss_bot)
TG_PROXY_IP="138.68.44.141"
RELAY_BOT_TOKEN="7589272367:AAGYC28tn02qps-usiTiBnI0E-PktyxSrVs"
RELAY_GROUP_ID="-1003849405283"
RELAY_API="https://api.telegram.org/bot${RELAY_BOT_TOKEN}"

# Log file for relay/inject debugging
RELAY_LOG="$WORKDIR/task-relay.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$RELAY_LOG"
    echo "$1"
}

cd "$WORKDIR"
echo "" > "$RELAY_LOG"

echo "========================================================"
echo "  Claude Code Task: $TASK_NAME (via $BOT_NAME)"
echo "  Max Turns: $MAX_TURNS | Workdir: $WORKDIR"
echo "  Permission: ${PERMISSION_MODE:-dangerously-skip-permissions}"
echo "  Telegram: $TELEGRAM_GROUP | Port: $GATEWAY_PORT"
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
log "[runner v3.4] Starting Claude Code"

eval "$CLAUDE_CMD" 2>"$WORKDIR/task-output.txt" | tee "$WORKDIR/claude-result.txt"
EXIT_CODE=${PIPESTATUS[0]}

# Copy result to results dir + write completion marker
cp "$WORKDIR/claude-result.txt" "$RESULTS_DIR/claude-result.txt" 2>/dev/null
touch "$WORKDIR/.task-complete"

log "[runner] Claude Code finished (exit=$EXIT_CODE)"

echo ""
echo "========================================================"
echo "  TASK COMPLETE (exit: $EXIT_CODE) at $(date)"
echo "  Result saved to: $WORKDIR/claude-result.txt"
echo "========================================================"

# ---- Read result ----
CLEAN_RESULT=""
if [ -f "$WORKDIR/claude-result.txt" ] && [ -s "$WORKDIR/claude-result.txt" ]; then
    CLEAN_RESULT=$(cat "$WORKDIR/claude-result.txt")
fi

# ---- Helper: send telegram message with retry ----
send_tg() {
    local CHAT_ID="$1"
    local TEXT="$2"
    local LABEL="$3"
    local RESP
    for attempt in 1 2; do
        RESP=$(curl -s \
            --resolve "api.telegram.org:443:${TG_PROXY_IP}" \
            "${RELAY_API}/sendMessage" \
            --data-urlencode "chat_id=${CHAT_ID}" \
            --data-urlencode "text=${TEXT}" \
            --max-time 15 2>&1)
        if echo "$RESP" | grep -q '"ok":true'; then
            log "[relay] $LABEL: sent (attempt $attempt)"
            return 0
        fi
        log "[relay] $LABEL attempt $attempt failed: $RESP"
        sleep 2
    done
    return 1
}

send_tg_doc() {
    local CHAT_ID="$1"
    local FILE="$2"
    local CAPTION="$3"
    local LABEL="$4"
    local RESP
    RESP=$(curl -s \
        --resolve "api.telegram.org:443:${TG_PROXY_IP}" \
        "${RELAY_API}/sendDocument" \
        -F "chat_id=${CHAT_ID}" \
        -F "caption=${CAPTION}" \
        -F "document=@${FILE};filename=${TASK_NAME}-result.txt" \
        --max-time 30 2>&1)
    if echo "$RESP" | grep -q '"ok":true'; then
        log "[relay] $LABEL: document sent"
        return 0
    fi
    log "[relay] $LABEL: document failed: $RESP"
    return 1
}

# ---- Send notifications ----
if [ -n "$CLEAN_RESULT" ]; then
    CONTENT_LEN=${#CLEAN_RESULT}
    log "[relay] Result length: $CONTENT_LEN chars"

    if [ "$CONTENT_LEN" -gt 4000 ]; then
        RELAY_FILE="${RESULTS_DIR}/relay-${TASK_NAME}.txt"
        echo "$CLEAN_RESULT" > "$RELAY_FILE"
        CAPTION="[$BOT_NAME] ${TASK_NAME} (${CONTENT_LEN} chars)"

        # Send to user DM (primary)
        if [ -n "$TELEGRAM_GROUP" ]; then
            send_tg_doc "$TELEGRAM_GROUP" "$RELAY_FILE" "$CAPTION" "user-dm"
        fi
        # Send to group (backup)
        send_tg_doc "$RELAY_GROUP_ID" "$RELAY_FILE" "$CAPTION" "group"
        rm -f "$RELAY_FILE"
    else
        # Send to user DM (primary)
        if [ -n "$TELEGRAM_GROUP" ]; then
            DM_MSG="[$BOT_NAME] ${TASK_NAME}
${CLEAN_RESULT}"
            send_tg "$TELEGRAM_GROUP" "$DM_MSG" "user-dm"
        fi
        # Send to group (backup)
        GROUP_MSG="[$BOT_NAME] ${TASK_NAME}
${CLEAN_RESULT}"
        send_tg "$RELAY_GROUP_ID" "$GROUP_MSG" "group"
    fi
else
    log "[relay] No content to send"
fi

# ---- Chat.inject into bot session ----
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
    INJECT_TEXT="[Background] Task '${TASK_NAME}' completed (via ${BOT_NAME}). User notified via Telegram.
Working dir: ${WORKDIR}
Status: done (exit_code=${EXIT_CODE})
Summary: ${RESULT_SUMMARY}"

    log "[inject] Sending to session: $SESSION_KEY (port $GATEWAY_PORT)"
    (
        INJECT_OUT=$(/opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "$INJECT_TEXT" "$SESSION_KEY" 15000 3 "$GATEWAY_PORT" 2>&1)
        INJECT_RC=$?
        if [ $INJECT_RC -eq 0 ]; then
            log "[inject] Success: $INJECT_OUT"
        else
            log "[inject] Failed (rc=$INJECT_RC): $INJECT_OUT"
        fi
    ) &
fi

# Mark task as processed
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

log "[runner] All done. Sleeping 10min."
echo "Session stays alive 10min. Attach: tmux attach -t cc-$TASK_NAME"
sleep 600
'''

def main():
    print("=== Deploying runner v3.4 to Mac Mini ===")

    # Write the runner template to a temp file on Mac Mini
    # We need to update the dispatch script's embedded runner

    # First, read the current dispatch script
    out, err = run_cmd("cat /Users/fangjin/claude-code-dispatch.sh")
    if not out:
        print(f"ERROR: Could not read dispatch script: {err}")
        return

    # Find the RUNEOF markers and replace the runner content
    lines = out.split('\n')
    new_lines = []
    in_runner = False

    for line in lines:
        if "cat > \"$RUNNER_FILE\" << 'RUNEOF'" in line:
            new_lines.append(line)
            # Insert new runner content
            new_lines.append(RUNNER_CONTENT.strip())
            in_runner = True
            continue
        if in_runner and line.strip() == 'RUNEOF':
            new_lines.append(line)
            in_runner = False
            continue
        if not in_runner:
            new_lines.append(line)

    new_script = '\n'.join(new_lines)

    # Write the updated dispatch script
    # Use Python to write the file to avoid shell escaping issues
    write_cmd = '''python3 -c "
import sys
content = sys.stdin.read()
with open('/Users/fangjin/claude-code-dispatch.sh', 'w') as f:
    f.write(content)
print('Written', len(content), 'bytes')
"'''

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(write_cmd, timeout=15)
    stdin.write(new_script)
    stdin.channel.shutdown_write()
    out2 = stdout.read().decode('utf-8', errors='replace')
    err2 = stderr.read().decode('utf-8', errors='replace')
    client.close()

    print(f"Write result: {out2.strip()}")
    if err2:
        print(f"Write errors: {err2.strip()}")

    # Verify
    out3, _ = run_cmd("head -5 /Users/fangjin/claude-code-dispatch.sh; echo '---'; grep 'runner v3' /Users/fangjin/claude-code-dispatch.sh; echo '---'; grep 'send_tg ' /Users/fangjin/claude-code-dispatch.sh | head -5")
    print(f"\nVerification:\n{out3}")

    # Make executable
    run_cmd("chmod +x /Users/fangjin/claude-code-dispatch.sh")

    print("\n=== Runner v3.4 deployed ===")
    print("Changes:")
    print("- Relay sends to user DM directly (primary) + group (backup)")
    print("- Relay/inject results logged to task-relay.log")
    print("- Bot names use ASCII (Alin/Aling/Lain/Lumi)")
    print("- Retry on relay send failure")

if __name__ == '__main__':
    main()
