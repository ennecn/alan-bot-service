#!/usr/bin/env python3
"""Deploy runner v3.3: fix duplicate notifications + add bot name to relay.

Changes from v3.2:
1. Remove @windclaw_bot (TG_BOT) notification — only @Claudebigboss_bot sends results
2. Add bot name to relay message: "[task-name] (via 阿凛)\nresult"
3. Bot name derived from workdir basename
"""
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")
sftp = c.open_sftp()

print("1. Reading dispatch script...")
with sftp.open("/Users/fangjin/claude-code-dispatch.sh", "r") as f:
    dispatch = f.read().decode("utf-8")

old_run_start = 'cat > "$RUNNER_FILE" << \'RUNEOF\''
if old_run_start not in dispatch:
    print("   ERROR: RUNEOF heredoc not found!")
    c.close()
    sys.exit(1)

start_idx = dispatch.index(old_run_start)
end_idx = dispatch.index("\nRUNEOF\n", start_idx + len(old_run_start)) + len("\nRUNEOF\n")

new_runner = r"""cat > "$RUNNER_FILE" << 'RUNEOF'
#!/bin/bash
# Task runner v3.3 - relay via @Claudebigboss_bot only, with bot name
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

# Derive bot name from workdir
BOT_DIR=$(basename "$WORKDIR")
case "$BOT_DIR" in
    alin)  BOT_NAME="阿凛" ;;
    aling) BOT_NAME="阿澪" ;;
    lain)  BOT_NAME="Lain" ;;
    lumi)  BOT_NAME="Lumi" ;;
    *)     BOT_NAME="$BOT_DIR" ;;
esac

# Relay bot config (@Claudebigboss_bot)
TG_PROXY_IP="138.68.44.141"
RELAY_BOT_TOKEN="7589272367:AAGYC28tn02qps-usiTiBnI0E-PktyxSrVs"
RELAY_CHAT_ID="-1003849405283"
RELAY_API="https://api.telegram.org/bot${RELAY_BOT_TOKEN}"

cd "$WORKDIR"

echo "========================================================"
echo "  Claude Code Task: $TASK_NAME (via $BOT_NAME)"
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
echo "[runner v3.3] Running with pipe-based output + direct notifications"

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

# ---- Read result ----
CLEAN_RESULT=""
if [ -f "$WORKDIR/claude-result.txt" ] && [ -s "$WORKDIR/claude-result.txt" ]; then
    CLEAN_RESULT=$(cat "$WORKDIR/claude-result.txt")
fi

# ---- Relay via @Claudebigboss_bot (only notification channel) ----
if [ -n "$CLEAN_RESULT" ]; then
    CONTENT_LEN=${#CLEAN_RESULT}
    if [ "$CONTENT_LEN" -gt 4000 ]; then
        RELAY_FILE="${RESULTS_DIR}/relay-${TASK_NAME}.txt"
        echo "$CLEAN_RESULT" > "$RELAY_FILE"
        CAPTION="[${TASK_NAME}] via ${BOT_NAME} (${CONTENT_LEN} chars)"
        curl -s \
            --resolve "api.telegram.org:443:${TG_PROXY_IP}" \
            "${RELAY_API}/sendDocument" \
            -F "chat_id=${RELAY_CHAT_ID}" \
            -F "caption=${CAPTION}" \
            -F "document=@${RELAY_FILE};filename=${TASK_NAME}-result.txt" \
            --max-time 30 > /dev/null 2>&1 \
            && echo "[runner] Relay: sent document via $BOT_NAME" \
            || echo "[runner] Relay: document send failed"
        rm -f "$RELAY_FILE"
    else
        RELAY_MSG="[${TASK_NAME}] via ${BOT_NAME}
${CLEAN_RESULT}"
        curl -s \
            --resolve "api.telegram.org:443:${TG_PROXY_IP}" \
            "${RELAY_API}/sendMessage" \
            --data-urlencode "chat_id=${RELAY_CHAT_ID}" \
            --data-urlencode "text=${RELAY_MSG}" \
            --max-time 10 > /dev/null 2>&1 \
            && echo "[runner] Relay: sent to Claude_test via $BOT_NAME" \
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

print("2. Writing updated dispatch script...")
with sftp.open("/Users/fangjin/claude-code-dispatch.sh", "wb") as f:
    f.write(dispatch.encode("utf-8"))
sftp.close()

# Verify
si, so, se = c.exec_command('grep -n "v3.3\\|BOT_NAME\\|windclaw\\|TG_BOT_TOKEN\\|TG_API" /Users/fangjin/claude-code-dispatch.sh')
print(f"   Grep results:\n{so.read().decode().strip()}")

# Verify no TG_BOT_TOKEN remains in runner
si, so, se = c.exec_command('grep -c "TG_BOT_TOKEN" /Users/fangjin/claude-code-dispatch.sh')
count = so.read().decode().strip()
if count == "0":
    print("   OK: TG_BOT_TOKEN removed (no @windclaw_bot notifications)")
else:
    print(f"   WARNING: TG_BOT_TOKEN still found {count} times!")

# Verify BOT_NAME mapping exists
si, so, se = c.exec_command('grep -c "BOT_NAME" /Users/fangjin/claude-code-dispatch.sh')
count = so.read().decode().strip()
print(f"   BOT_NAME references: {count}")

# Clean stale files
print("\n3. Cleaning stale files...")
si, so, se = c.exec_command(
    "rm -f /Users/fangjin/claude-code-results/.processed-* "
    "/Users/fangjin/claude-code-results/.hook-lock-*"
)
so.read()
for bot in ["alin", "aling", "lain", "lumi"]:
    si, so, se = c.exec_command(
        f"rm -f /Users/fangjin/claude-workspace/{bot}/claude-result.txt "
        f"/Users/fangjin/claude-workspace/{bot}/task-output.txt "
        f"/Users/fangjin/claude-workspace/{bot}/task-meta.json "
        f"/Users/fangjin/claude-workspace/{bot}/task-meta.json.done "
        f"/Users/fangjin/claude-workspace/{bot}/.task-complete"
    )
    so.read()
print("   Done")

c.close()
print("\nDeployed runner v3.3!")
print("- Removed @windclaw_bot duplicate notification")
print("- @Claudebigboss_bot relay now shows: [task-name] via BOT_NAME")
print("- Bot name derived from workdir: alin=阿凛, aling=阿澪, lain=Lain, lumi=Lumi")
