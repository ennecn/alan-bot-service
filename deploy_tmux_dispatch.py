#!/usr/bin/env python3
"""Deploy fixed tmux-based Claude Code dispatch system"""
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

# ============================================================
# 1. claude-code-dispatch.sh
# ============================================================
dispatch_sh = r'''#!/bin/bash
# claude-code-dispatch.sh - Dispatch Claude Code task in tmux session
export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:$PATH

PROMPT=""
TASK_NAME="task-$(date +%s)"
WORKDIR="/Users/fangjin/claude-workspace/alin"
MAX_TURNS=50
TMUX=/opt/homebrew/bin/tmux
JQ=/usr/bin/jq

while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--prompt) PROMPT="$2"; shift 2;;
        -n|--name) TASK_NAME="$2"; shift 2;;
        -w|--workdir) WORKDIR="$2"; shift 2;;
        -t|--max-turns) MAX_TURNS="$2"; shift 2;;
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

# Write task meta
cat > "$WORKDIR/task-meta.json" << TMEOF
{
    "name": "$TASK_NAME",
    "session": "$SESSION_NAME",
    "prompt": $(echo "$PROMPT" | $JQ -Rs .),
    "workdir": "$WORKDIR",
    "max_turns": $MAX_TURNS,
    "started_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
TMEOF

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

# --verbose for real-time progress in tmux pane
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

# Write completion result
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
    cat << EOF
{
    "status": "dispatched",
    "task_name": "$TASK_NAME",
    "session": "$SESSION_NAME",
    "workdir": "$WORKDIR",
    "max_turns": $MAX_TURNS
}
EOF
else
    echo '{"error": "Failed to create tmux session"}'
    exit 1
fi
'''

with sftp.file('/Users/fangjin/claude-code-dispatch.sh', 'w') as f:
    f.write(dispatch_sh)
print("[1/4] dispatch.sh")

# ============================================================
# 2. claude-code-status.sh
# ============================================================
status_sh = r'''#!/bin/bash
# claude-code-status.sh - Query Claude Code task progress
export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:$PATH
TMUX=/opt/homebrew/bin/tmux
JQ=/usr/bin/jq

TASK_NAME=""
LINES=30

while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--name) TASK_NAME="$2"; shift 2;;
        -l|--lines) LINES="$2"; shift 2;;
        *) shift;;
    esac
done

if [ -z "$TASK_NAME" ]; then
    SESSION_NAME=$($TMUX list-sessions -F "#{session_name}" 2>/dev/null | grep "^cc-" | tail -1)
    if [ -z "$SESSION_NAME" ]; then
        echo '{"status": "no_active_task"}'
        exit 0
    fi
else
    SESSION_NAME="cc-${TASK_NAME}"
fi

if ! $TMUX has-session -t "$SESSION_NAME" 2>/dev/null; then
    RESULTS_DIR="/Users/fangjin/claude-code-results"
    if [ -f "$RESULTS_DIR/latest.json" ]; then
        cat "$RESULTS_DIR/latest.json"
    else
        echo '{"status": "not_found", "session": "'"$SESSION_NAME"'"}'
    fi
    exit 0
fi

# Session running - capture pane
PANE_CONTENT=$($TMUX capture-pane -t "$SESSION_NAME" -p -S -${LINES} 2>/dev/null)

$JQ -n \
    --arg status "running" \
    --arg session "$SESSION_NAME" \
    --arg output "$PANE_CONTENT" \
    '{status: $status, session: $session, recent_output: $output}'
'''

with sftp.file('/Users/fangjin/claude-code-status.sh', 'w') as f:
    f.write(status_sh)
print("[2/4] status.sh")

# ============================================================
# 3. claude-code-list.sh
# ============================================================
list_sh = r'''#!/bin/bash
TMUX=/opt/homebrew/bin/tmux
SESSIONS=$($TMUX list-sessions -F '{"name":"#{session_name}","created":#{session_created},"attached":#{session_attached}}' 2>/dev/null | grep '"cc-')
if [ -z "$SESSIONS" ]; then
    echo '{"sessions": [], "count": 0}'
else
    echo '{"sessions": ['
    echo "$SESSIONS" | sed '$!s/$/,/'
    echo '], "count": '$(echo "$SESSIONS" | wc -l | tr -d ' ')'}'
fi
'''

with sftp.file('/Users/fangjin/claude-code-list.sh', 'w') as f:
    f.write(list_sh)
print("[3/4] list.sh")

# ============================================================
# 4. claude-code-stop.sh
# ============================================================
stop_sh = r'''#!/bin/bash
TMUX=/opt/homebrew/bin/tmux
TASK_NAME=""
STOP_ALL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--name) TASK_NAME="$2"; shift 2;;
        --all) STOP_ALL=true; shift;;
        *) shift;;
    esac
done

if [ "$STOP_ALL" = true ]; then
    SESSIONS=$($TMUX list-sessions -F "#{session_name}" 2>/dev/null | grep "^cc-")
    COUNT=0
    for s in $SESSIONS; do
        $TMUX kill-session -t "$s" 2>/dev/null
        COUNT=$((COUNT + 1))
    done
    echo "{\"stopped\": $COUNT}"
    exit 0
fi

if [ -z "$TASK_NAME" ]; then
    SESSION_NAME=$($TMUX list-sessions -F "#{session_name}" 2>/dev/null | grep "^cc-" | tail -1)
else
    SESSION_NAME="cc-${TASK_NAME}"
fi

if [ -z "$SESSION_NAME" ]; then
    echo '{"error": "No session found"}'
    exit 1
fi

if $TMUX has-session -t "$SESSION_NAME" 2>/dev/null; then
    $TMUX kill-session -t "$SESSION_NAME"
    echo "{\"stopped\": \"$SESSION_NAME\"}"
else
    echo "{\"error": "Session '"$SESSION_NAME"' not found"}"
fi
'''

with sftp.file('/Users/fangjin/claude-code-stop.sh', 'w') as f:
    f.write(stop_sh)
print("[4/4] stop.sh")

stdin, stdout, stderr = client.exec_command(
    'chmod +x /Users/fangjin/claude-code-dispatch.sh '
    '/Users/fangjin/claude-code-status.sh '
    '/Users/fangjin/claude-code-list.sh '
    '/Users/fangjin/claude-code-stop.sh'
)
stdout.read()

sftp.close()
print("\n[DONE] All scripts deployed (fixed jq path + verbose output)")
client.close()
