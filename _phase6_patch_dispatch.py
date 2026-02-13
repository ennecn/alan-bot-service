#!/usr/bin/env python3
"""Patch dispatch script to source shell profile for Claude Code auth."""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

DISPATCH_SCRIPT = r'''#!/bin/bash
# claude-code-dispatch.sh - Dispatch a task to Claude Code
# Usage: claude-code-dispatch.sh -p "prompt" [-n name] [-w workdir]
#
# Runs Claude Code in background and returns immediately.
# Results will be written to /Users/fangjin/claude-code-results/latest.json
# by the notify-openclaw.sh hook when Claude Code completes.

export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH

# Source shell profiles to pick up ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, etc.
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null

PROMPT=""
TASK_NAME="task-$(date +%s)"
WORKDIR="/Users/fangjin/claude-workspace/alin"
MAX_TURNS=20

# Parse arguments
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

# Ensure work dir exists
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

# Run Claude Code in background
# Source profiles inside the nohup block too, since it's a new shell
# Output is tee'd to task-output.txt so the hook can read it
nohup bash -c "
    [ -f \"$HOME/.bash_profile\" ] && source \"$HOME/.bash_profile\" 2>/dev/null
    [ -f \"$HOME/.zshrc\" ] && source \"$HOME/.zshrc\" 2>/dev/null
    cd \"$WORKDIR\" && \
    /opt/homebrew/bin/claude -p $(echo "$PROMPT" | jq -Rs .) \
        --max-turns $MAX_TURNS \
        --output-format json \
        --dangerously-skip-permissions \
        2>&1 | tee \"$WORKDIR/task-output.txt\"
" > /dev/null 2>&1 &

CLAUDE_PID=$!

# Return immediately with dispatch info
cat << EOF
{
    "status": "dispatched",
    "task_name": "$TASK_NAME",
    "workdir": "$WORKDIR",
    "pid": $CLAUDE_PID,
    "max_turns": $MAX_TURNS,
    "message": "Claude Code is running in background. Results will be written to /Users/fangjin/claude-code-results/latest.json when complete."
}
EOF
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

sftp = c.open_sftp()
with sftp.open('/Users/fangjin/claude-code-dispatch.sh', 'w') as f:
    f.write(DISPATCH_SCRIPT)
sftp.chmod('/Users/fangjin/claude-code-dispatch.sh', 0o755)
sftp.close()

print('Dispatch script updated with shell profile sourcing.', flush=True)

# Verify
PATH_CMD = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'
_, stdout, _ = c.exec_command(f'{PATH_CMD} && head -15 /Users/fangjin/claude-code-dispatch.sh', timeout=5)
print(stdout.read().decode('utf-8', errors='replace'), flush=True)

c.close()
print('Done.', flush=True)
