#!/usr/bin/env python3
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

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

RESULTS_DIR="/Users/fangjin/claude-code-results"

# Session doesn't exist at all
if ! $TMUX has-session -t "$SESSION_NAME" 2>/dev/null; then
    if [ -f "$RESULTS_DIR/latest.json" ]; then
        cat "$RESULTS_DIR/latest.json"
    else
        echo '{"status": "not_found", "session": "'"$SESSION_NAME"'"}'
    fi
    exit 0
fi

# Session exists - capture pane
PANE_CONTENT=$($TMUX capture-pane -t "$SESSION_NAME" -p -S -${LINES} 2>/dev/null)

# Detect if task completed (session alive but task done)
if echo "$PANE_CONTENT" | grep -q "TASK COMPLETE"; then
    STATUS="completed"
    # Read latest.json for structured result
    if [ -f "$RESULTS_DIR/latest.json" ]; then
        RESULT=$(cat "$RESULTS_DIR/latest.json")
        $JQ -n \
            --arg status "completed" \
            --arg session "$SESSION_NAME" \
            --arg output "$PANE_CONTENT" \
            --argjson result "$RESULT" \
            '{status: $status, session: $session, result: $result, recent_output: $output}'
        exit 0
    fi
fi

$JQ -n \
    --arg status "running" \
    --arg session "$SESSION_NAME" \
    --arg output "$PANE_CONTENT" \
    '{status: $status, session: $session, recent_output: $output}'
'''

with sftp.file('/Users/fangjin/claude-code-status.sh', 'w') as f:
    f.write(status_sh)
sftp.close()

stdin, stdout, stderr = client.exec_command('chmod +x /Users/fangjin/claude-code-status.sh')
stdout.read()

# Quick verify
stdin, stdout, stderr = client.exec_command('/Users/fangjin/claude-code-status.sh -n tmux-test')
print(stdout.read().decode().strip())

client.close()
