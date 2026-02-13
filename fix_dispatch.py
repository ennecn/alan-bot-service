#!/usr/bin/env python3
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

new_dispatch = r'''#!/bin/bash
# claude-code-dispatch.sh - Dispatch a task to Claude Code
# Usage: claude-code-dispatch.sh -p "prompt" [-n name] [-w workdir] [-t max-turns]

export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/opt/homebrew/lib/node_modules/.bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null

PROMPT=""
TASK_NAME="task-$(date +%s)"
WORKDIR="/Users/fangjin/claude-workspace/alin"
MAX_TURNS=20

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

mkdir -p "$WORKDIR"

# Write task meta
cat > "$WORKDIR/task-meta.json" << TMEOF
{
    "name": "$TASK_NAME",
    "prompt": $(echo "$PROMPT" | jq -Rs .),
    "workdir": "$WORKDIR",
    "max_turns": $MAX_TURNS,
    "started_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
TMEOF

# Write prompt to temp file to avoid quoting issues
PROMPT_FILE=$(mktemp /tmp/claude-prompt-XXXXXX.txt)
echo "$PROMPT" > "$PROMPT_FILE"

# Write a runner script to avoid bash -c quoting hell
RUNNER_FILE=$(mktemp /tmp/claude-runner-XXXXXX.sh)
cat > "$RUNNER_FILE" << 'RUNEOF'
#!/bin/bash
export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/opt/homebrew/lib/node_modules/.bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null

PROMPT_FILE="$1"
WORKDIR="$2"
MAX_TURNS="$3"

PROMPT=$(cat "$PROMPT_FILE")
rm -f "$PROMPT_FILE"

cd "$WORKDIR" && \
/opt/homebrew/bin/claude -p "$PROMPT" \
    --max-turns "$MAX_TURNS" \
    --output-format json \
    --dangerously-skip-permissions \
    2>&1 | tee "$WORKDIR/task-output.txt"

rm -f "$0"
RUNEOF
chmod +x "$RUNNER_FILE"

nohup "$RUNNER_FILE" "$PROMPT_FILE" "$WORKDIR" "$MAX_TURNS" > /dev/null 2>&1 &
CLAUDE_PID=$!

cat << EOF
{
    "status": "dispatched",
    "task_name": "$TASK_NAME",
    "workdir": "$WORKDIR",
    "pid": $CLAUDE_PID,
    "max_turns": $MAX_TURNS,
    "message": "Claude Code running in background. Results -> /Users/fangjin/claude-code-results/latest.json"
}
EOF
'''

sftp = client.open_sftp()
with sftp.file('/Users/fangjin/claude-code-dispatch.sh', 'w') as f:
    f.write(new_dispatch)
sftp.close()

stdin, stdout, stderr = client.exec_command('chmod +x /Users/fangjin/claude-code-dispatch.sh')
stdout.read()

print("[OK] Updated dispatch script")
client.close()
